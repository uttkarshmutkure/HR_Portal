import { createContext, useContext, useState, ReactNode } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";
import { clearHrChatStore } from "./layout/HrChatWidget";

export type Role = "hr" | "interviewer" | "user";

interface AuthUser {
  id: string;
  name: string;
  email: string;
  roles: Role[];
}

interface StoredSession {
  user: AuthUser;
  activeRole: Role;
  loginTimestamp: number;
}

export interface LoginResult {
  error: string | null;
  activeRole: Role | null;
}

interface AuthContextType {
  user: AuthUser | null;
  activeRole: Role | null;
  isAuthenticated: boolean;
  sessionExpired: boolean;
  login: (email: string) => Promise<LoginResult>;
  switchRole: (role: Role) => void; // for users who have more than one role
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = "hiredesk_session";
const SESSION_DURATION_MS = 1 * 60 * 60 * 1000; // 1 hour
const CHECK_LOGIN_URL = import.meta.env.VITE_CHECK_LOGIN_URL as string;

// If someone has several roles, they land on the first match in this list
const ROLE_PRIORITY: Role[] = ["hr", "interviewer", "user"];

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

  async function login(email: string): Promise<LoginResult> {
    let data: any;
    try {
      const res = await fetch(CHECK_LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      data = await res.json();
    } catch {
      return { error: "Could not reach the server. Please try again.", activeRole: null };
    }

    if (!data.allowed) {
      return { error: data.reason || data.error || "Login failed.", activeRole: null };
    }

    const fetchedUser: AuthUser = {
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
      roles: data.user.roles,
    };

    const chosenRole = ROLE_PRIORITY.find((r) => fetchedUser.roles.includes(r));
    if (!chosenRole) {
      return { error: "No valid role is assigned to this account.", activeRole: null };
    }

    const session: StoredSession = {
      user: fetchedUser,
      activeRole: chosenRole,
      loginTimestamp: Date.now(),
    };

    setUser(fetchedUser);
    setActiveRole(chosenRole);
    setSessionExpired(false);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { error: null, activeRole: chosenRole };
  }

  function switchRole(role: Role) {
    if (!user || !user.roles.includes(role)) return;
    setActiveRole(role);
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const session: StoredSession = JSON.parse(raw);
      localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, activeRole: role }));
    }
  }

  function logout() {
    signOut(auth).catch(() => {});
    setUser(null);
    setActiveRole(null);
    setSessionExpired(false);
    localStorage.removeItem(SESSION_KEY);
    clearHrChatStore();
  }

  return (
    <AuthContext.Provider
      value={{ user, activeRole, isAuthenticated: !!user, sessionExpired, login, switchRole, logout }}
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