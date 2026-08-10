import { createContext, useContext, useState, ReactNode } from "react";
import { signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "../../firebase";

export type Role = "hr" | "interviewer";

interface AuthUser {
  id: string;
  name: string;
  email: string;
  roles: Role[]; // a user can have one or both roles
}

interface StoredSession {
  user: AuthUser;
  activeRole: Role;
  loginTimestamp: number;
}

interface AuthContextType {
  user: AuthUser | null;
  activeRole: Role | null;
  isAuthenticated: boolean;
  sessionExpired: boolean; // true only if a session existed but has timed out
  // returns null on success, or an error message string on failure
  // login: (requestedRole: Role) => Promise<string | null>;
  login: (email: string, requestedRole: Role) => Promise<string | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = "hiredesk_session";
const SESSION_DURATION_MS = 1 * 60 * 60 * 1000; // 8 hours
const CHECK_LOGIN_URL ="https://asia-south1-atgeir-moae-dev.cloudfunctions.net/hr-dev-check-login"; // TODO: replace with your actual deployed function URL

function readSession(): StoredSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  const parsed: StoredSession = JSON.parse(raw);
  const isExpired = Date.now() - parsed.loginTimestamp > SESSION_DURATION_MS;
  return isExpired ? null : parsed;
}

function hadExpiredSession(): boolean {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return false;
  const parsed: StoredSession = JSON.parse(raw);
  return Date.now() - parsed.loginTimestamp > SESSION_DURATION_MS;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial = readSession();
  const [user, setUser] = useState<AuthUser | null>(initial?.user ?? null);
  const [activeRole, setActiveRole] = useState<Role | null>(initial?.activeRole ?? null);
  const [sessionExpired, setSessionExpired] = useState<boolean>(!initial && hadExpiredSession());

  /* ── TEMP: Google popup login, commented out for testing ────────────────
  async function login(requestedRole: Role): Promise<string | null> {
    let verifiedEmail: string;

    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (!result.user.email) {
        await signOut(auth);
        return "Could not read email from Google account.";
      }
      verifiedEmail = result.user.email;
    } catch (err) {
      return "Google sign-in failed or was cancelled.";
    }

    let data: any;
    try {
      const res = await fetch(CHECK_LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verifiedEmail, role: requestedRole }),
      });
      data = await res.json();
    } catch (err) {
      return "Could not reach the server. Please try again.";
    }

    if (!data.allowed) {
      return data.reason || "Login failed.";
    }

    const fetchedUser: AuthUser = {
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
      roles: data.user.roles,
    };

    const session: StoredSession = {
      user: fetchedUser,
      activeRole: requestedRole,
      loginTimestamp: Date.now(),
    };

    setUser(fetchedUser);
    setActiveRole(requestedRole);
    setSessionExpired(false);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return null;
  }
  ── END TEMP comment-out ─────────────────────────────────────────────── */

  // ── TEMP: direct email login for testing per-interviewer visibility ──────
  async function login(email: string, requestedRole: Role): Promise<string | null> {
    let data: any;
    try {
      const res = await fetch(CHECK_LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: requestedRole }),
      });
      data = await res.json();
    } catch (err) {
      return "Could not reach the server. Please try again.";
    }

    if (!data.allowed) {
      return data.reason || "Login failed.";
    }

    const fetchedUser: AuthUser = {
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
      roles: data.user.roles,
    };

    const session: StoredSession = {
      user: fetchedUser,
      activeRole: requestedRole,
      loginTimestamp: Date.now(),
    };

    setUser(fetchedUser);
    setActiveRole(requestedRole);
    setSessionExpired(false);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return null;
  }

  function logout() {
    signOut(auth).catch(() => {});
    setUser(null);
    setActiveRole(null);
    setSessionExpired(false);
    localStorage.removeItem(SESSION_KEY);
  }

  return (
    <AuthContext.Provider
      value={{ user, activeRole, isAuthenticated: !!user, sessionExpired, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

// // ── Placeholder only — delete once Firebase Auth + Firestore roles are wired in ──
// async function mockFetchUser(email: string): Promise<AuthUser | null> {
//   const fakeDb: Record<string, AuthUser> = {
//     "hr@atgeir.com": { id: "1", name: "HR User", email, roles: ["hr"] },
//     "interviewer@atgeir.com": { id: "2", name: "Interviewer User", email, roles: ["interviewer"] },
//     "both@atgeir.com": { id: "3", name: "Dual Role User", email, roles: ["hr", "interviewer"] },
//   };
//   return fakeDb[email] ?? null;
// }
