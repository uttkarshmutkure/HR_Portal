import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, BrainCircuit, Lock, ShieldCheck, Users, Zap } from "lucide-react";
import { useAuth } from "../components/AuthContext";

// ── Design tokens (same as the old landing page) ───────────────────────────
const T = {
  orange: "#F07C2D",
  orangeDim: "rgba(240,124,45,0.15)",
  navy: "#1D194B",
  navyDeep: "#0F0D2E",
  white: "#FFFFFF",
  offWhite: "#F4F6FB",
  gray50: "#F9FAFB",
  gray200: "#E5E7EB",
  gray400: "#9CA3AF",
  gray600: "#6B7280",
  textPrimary: "#111827",
  font: "'Inter', sans-serif",
};

// ── Where each role lands after login ──────────────────────────────────────
const ROLE_HOME: Record<string, string> = {
  hr: "/dashboard",
  interviewer: "/jobs",
  user: "/jobs",
};

const CSS = `
.hd-root {
  min-height: 100vh;
  background: ${T.offWhite};
  font-family: ${T.font};
  color: #fff;
  overflow-x: hidden;
}

/* ── Hero (login) ── */
.hd-hero {
  position: relative;
  min-height: 100vh;
  background: ${T.navyDeep};
  overflow: hidden;
  display: flex; flex-direction: column;
}
.hd-bg {
  position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background:
    radial-gradient(circle at 15% 15%, rgba(120,110,230,0.14) 0%, transparent 45%),
    radial-gradient(circle at 90% 90%, rgba(240,124,45,0.10) 0%, transparent 45%),
    linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px) 0 0 / 57px 57px,
    linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px) 0 0 / 57px 57px;
}
.hd-topbar {
  position: relative; z-index: 3;
  display: flex; align-items: center; gap: 14px;
  padding: 24px 48px 0;
}
.hd-main {
  position: relative; z-index: 3;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  align-items: center;
  gap: 48px;
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 48px 48px;
  box-sizing: border-box;
}
.hd-title {
  font-size: clamp(32px, 3.8vw, 48px);
  font-weight: 800;
  letter-spacing: -0.035em;
  line-height: 1.08;
  margin: 18px 0 16px;
}
.hd-lead {
  font-size: 15px; line-height: 1.65;
  color: rgba(255,255,255,0.6);
  max-width: 480px; margin: 0 0 24px;
}
.hd-points { list-style: none; padding: 0; margin: 0 0 28px; display: grid; gap: 10px; }
.hd-points li {
  display: flex; align-items: center; gap: 12px;
  font-size: 14px; color: rgba(255,255,255,0.72);
}
.hd-stats { display: flex; gap: 0; }
.hd-stat { padding: 0 28px; border-right: 1px solid rgba(255,255,255,0.12); }
.hd-stat:first-child { padding-left: 0; }
.hd-stat:last-child { border-right: none; }
.hd-card {
  width: 100%; max-width: 400px; justify-self: end;
  background: rgba(255,255,255,0.045);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 22px;
  padding: 36px 32px 26px;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 30px 80px rgba(0,0,0,0.45);
  text-align: center;
  animation: hdCardIn 0.5s ease both;
}
.hd-input {
  width: 100%; box-sizing: border-box;
  padding: 12px 14px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.04);
  color: #fff; font-size: 14px; font-family: inherit; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.hd-input::placeholder { color: rgba(255,255,255,0.35); }
.hd-input:focus { border-color: ${T.orange}; box-shadow: 0 0 0 3px ${T.orangeDim}; }
.hd-btn {
  width: 100%; margin-top: 14px;
  display: flex; align-items: center; justify-content: center; gap: 9px;
  padding: 12px; border-radius: 10px; border: none;
  background: ${T.orange}; color: #fff;
  font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer;
  box-shadow: 0 8px 24px rgba(240,124,45,0.25);
  transition: transform 0.15s, box-shadow 0.15s;
}
.hd-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 30px rgba(240,124,45,0.35); }
.hd-btn:disabled { opacity: 0.7; cursor: default; }
.hd-trust {
  display: flex; justify-content: center; gap: 18px; flex-wrap: wrap;
  margin-top: 26px; font-size: 12.5px; color: rgba(255,255,255,0.42);
}
.hd-trust span { display: inline-flex; align-items: center; gap: 6px; }
.hd-banner {
  position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 50;
  background: #2a1a1a; border: 1px solid rgba(255,107,107,0.4);
  color: #ff9b9b; font-size: 13px; padding: 10px 18px; border-radius: 10px;
}
.hd-scroll {
  position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 3;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  pointer-events: none;
}

/* ── Sections below the hero ── */
.hd-section { padding: 80px 24px; }
.hd-eyebrow {
  font-size: 11px; font-weight: 600; color: ${T.orange};
  letter-spacing: 0.12em; text-transform: uppercase;
  margin: 0 0 12px; text-align: center;
}
.hd-h2 {
  font-size: 30px; font-weight: 700; color: ${T.textPrimary};
  letter-spacing: -0.025em; margin: 0 0 48px; text-align: center;
}
.hd-feature {
  background: ${T.white};
  border: 0.5px solid ${T.gray200};
  border-radius: 16px;
  padding: 28px 24px;
  transition: transform 0.22s ease, box-shadow 0.22s ease;
}
.hd-feature:hover { transform: translateY(-5px); box-shadow: 0 16px 40px rgba(0,0,0,0.07); }
.hd-cta-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 13px 26px; border-radius: 10px; border: none;
  background: ${T.orange}; color: #fff;
  font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: opacity 0.15s;
}
.hd-cta-btn:hover { opacity: 0.88; }

@keyframes hdCardIn {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (max-width: 900px) {
  .hd-topbar { padding: 20px 20px 0; }
  .hd-main { grid-template-columns: 1fr; gap: 36px; padding: 24px 20px 64px; }
  .hd-card { justify-self: center; padding: 36px 24px 28px; }
  .hd-stat { padding: 0 16px; }
  .hd-footer { flex-direction: column; gap: 12px; padding: 24px 20px !important; }
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
.hd-root :focus-visible { outline: 2px solid ${T.orange}; outline-offset: 2px; }
`;

// ── Floating particle network ──────────────────────────────────────────────
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animId = 0;
    let W = 0, H = 0;
    const COUNT = 60, MAX_DIST = 150, SPEED = 0.22;

    type P = { x: number; y: number; vx: number; vy: number; r: number; o: number };
    let ps: P[] = [];

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width = W * devicePixelRatio;
      canvas.height = H * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    const init = () => {
      ps = Array.from({ length: COUNT }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * SPEED,
        vy: (Math.random() - 0.5) * SPEED,
        r: Math.random() * 1.6 + 0.6,
        o: Math.random() * 0.2 + 0.1,
      }));
    };
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      if (!reduceMotion) {
        for (const p of ps) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > W) p.vx *= -1;
          if (p.y < 0 || p.y > H) p.vy *= -1;
        }
      }
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const dx = ps[i].x - ps[j].x, dy = ps[i].y - ps[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < MAX_DIST) {
            ctx.beginPath();
            ctx.moveTo(ps[i].x, ps[i].y);
            ctx.lineTo(ps[j].x, ps[j].y);
            ctx.strokeStyle = `rgba(240,124,45,${(1 - d / MAX_DIST) * 0.1})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      for (const p of ps) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(240,124,45,${p.o})`;
        ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    };

    const ro = new ResizeObserver(() => { resize(); init(); });
    ro.observe(canvas.parentElement!);
    resize();
    init();
    draw();

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
}

// ── Small building blocks ──────────────────────────────────────────────────
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="hd-stat">
      <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: "10.5px", marginTop: "5px", color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon, title, desc, accentColor, accentBg,
}: {
  icon: any; title: string; desc: string; accentColor: string; accentBg: string;
}) {
  return (
    <div className="hd-feature">
      <div style={{
        width: "44px", height: "44px", borderRadius: "12px", background: accentBg,
        display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "18px",
      }}>
        <Icon size={22} color={accentColor} />
      </div>
      <h3 style={{ fontSize: "15px", fontWeight: 600, color: T.textPrimary, letterSpacing: "-0.015em", margin: "0 0 8px" }}>
        {title}
      </h3>
      <p style={{ fontSize: "13px", color: T.gray600, lineHeight: 1.65, margin: 0 }}>{desc}</p>
    </div>
  );
}

function CandidateRow({
  initials, name, exp, skills, score, color,
}: {
  initials: string; name: string; exp: string; skills: string; score: number; color: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "12px",
      padding: "11px 16px", borderBottom: `0.5px solid ${T.gray200}`,
    }}>
      <div style={{
        width: "36px", height: "36px", borderRadius: "50%", background: color,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: T.white, fontSize: "12px", fontWeight: 700, flexShrink: 0,
      }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: T.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {name}
        </div>
        <div style={{ fontSize: "11px", color: T.gray400, marginTop: "1px" }}>
          {exp} · {skills}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: "16px", fontWeight: 700, color: T.orange, lineHeight: 1 }}>{score}%</div>
        <div style={{ fontSize: "9px", color: T.gray400, marginTop: "2px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          AI match
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const { login, isAuthenticated, activeRole, sessionExpired } = useAuth();
  const navigate = useNavigate();

  // Already signed in -> skip the form
  useEffect(() => {
    if (isAuthenticated && activeRole) {
      navigate(ROLE_HOME[activeRole] ?? "/", { replace: true });
    }
  }, [isAuthenticated, activeRole, navigate]);

  // Session-expired notice (auto-hides)
  useEffect(() => {
    if (!sessionExpired) return;
    setShowExpired(true);
    const t = setTimeout(() => setShowExpired(false), 4000);
    return () => clearTimeout(t);
  }, [sessionExpired]);

  // Every call-to-action below the hero brings the visitor back to the sign-in field
  function goToSignIn() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => emailRef.current?.focus({ preventScroll: true }), 450);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error: failMessage, activeRole: role } = await login(email);

    setLoading(false);

    if (failMessage || !role) {
      setError(failMessage ?? "Login failed.");
      return;
    }
    navigate(ROLE_HOME[role] ?? "/");
  }

  return (
    <div className="hd-root">
      <style>{CSS}</style>

      {showExpired && (
        <div className="hd-banner" role="alert">
          Session expired. Sign in again to continue.
        </div>
      )}

      {/* ══ Hero: product intro + sign-in ══════════════════════════════════ */}
      <section className="hd-hero">
        <div className="hd-bg" />
        <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }}>
          <ParticleCanvas />
        </div>

        <header className="hd-topbar">
          <img
            src="/company-logo1.png"
            alt="Atgeir Solutions"
            style={{ height: "26px", width: "auto", objectFit: "contain" }}
          />
          <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.15)" }} />
          <span style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.45)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            HireDesk
          </span>
        </header>

        <div className="hd-main">
          {/* Left: product intro */}
          <div>
            <div
              style={{
                display: "inline-flex", alignItems: "center", gap: "8px",
                padding: "6px 14px", borderRadius: "24px",
                background: T.orangeDim, border: "1px solid rgba(240,124,45,0.35)",
                color: T.orange, fontSize: "12px", fontWeight: 600,
              }}
            >
              <BrainCircuit size={14} />
              AI-Powered Candidate Screening
            </div>

            <h1 className="hd-title">
              Hire smarter.
              <br />
              <span style={{ color: T.orange }}>Screen faster.</span>
            </h1>

            <p className="hd-lead">
              Atgeir HireDesk uses AI to rank resumes, surface skill gaps, and move
              candidates through your pipeline, all without the spreadsheets.
            </p>

            <ul className="hd-points">
              <li><Users size={15} color={T.orange} /> Shortlist hundreds of resumes in minutes</li>
              <li><ShieldCheck size={15} color={T.orange} /> Scores based on skills and experience, not gut feel</li>
              <li><ArrowRight size={15} color={T.orange} /> Interviews, feedback, and offers in one pipeline</li>
            </ul>

            <div className="hd-stats">
              <Stat value="10×" label="Faster shortlisting" />
              <Stat value="94%" label="Avg AI accuracy" />
              <Stat value="3 min" label="Setup per role" />
            </div>
          </div>

          {/* Right: sign-in card */}
          <form className="hd-card" onSubmit={handleSubmit}>
            <div style={{ fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.14em", color: T.orange }}>
              WELCOME BACK
            </div>
            <h2 style={{ fontSize: "26px", fontWeight: 800, letterSpacing: "-0.02em", margin: "10px 0 8px" }}>
              Sign in
            </h2>
            <p style={{ fontSize: "14px", lineHeight: 1.6, color: "rgba(255,255,255,0.55)", margin: "0 0 22px" }}>
              Use your work email. We'll take you to the right workspace for your role.
            </p>

            <input
              ref={emailRef}
              className="hd-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@atgeirsoultions.com"
              autoComplete="email"
              aria-label="Work email"
              required
            />

            {error && (
              <div
                role="alert"
                style={{
                  marginTop: "14px", padding: "10px 12px", borderRadius: "10px",
                  background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.28)",
                  color: "#ff9b9b", fontSize: "13px", lineHeight: 1.5, textAlign: "left",
                }}
              >
                {error}
              </div>
            )}

            <button className="hd-btn" type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"} <ArrowRight size={16} />
            </button>

            <div className="hd-trust">
              <span><Lock size={13} /> Secure</span>
              <span><ShieldCheck size={13} /> Role-based access</span>
            </div>
          </form>
        </div>

        <div className="hd-scroll" aria-hidden="true">
          <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Scroll
          </span>
          <div style={{ width: "1px", height: "28px", background: "linear-gradient(to bottom, rgba(255,255,255,0.28), transparent)" }} />
        </div>
      </section>

      {/* ══ UI preview ═════════════════════════════════════════════════════ */}
      <section className="hd-section" style={{ background: T.offWhite, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <p className="hd-eyebrow">See it in action</p>
        <h2 className="hd-h2">Your shortlist, in seconds.</h2>

        <div style={{
          width: "100%", maxWidth: "680px", background: T.white,
          border: `0.5px solid ${T.gray200}`, borderRadius: "16px",
          overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.06)",
        }}>
          <div style={{
            padding: "14px 16px", borderBottom: `0.5px solid ${T.gray200}`,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap",
          }}>
            <div>
              <span style={{ fontSize: "13px", fontWeight: 600, color: T.textPrimary }}>Senior Backend Engineer</span>
              <span style={{
                marginLeft: "10px", padding: "2px 8px", borderRadius: "20px",
                background: "#ECFDF5", color: "#065F46", fontSize: "10px", fontWeight: 600,
              }}>
                AI screening done
              </span>
            </div>
            <span style={{ fontSize: "11px", color: T.gray400 }}>48 resumes processed</span>
          </div>

          <CandidateRow initials="AR" name="Arjun Reddy"    exp="8 yrs" skills="Python, FastAPI"     score={94} color="#F07C2D" />
          <CandidateRow initials="PM" name="Priya Mehta"    exp="6 yrs" skills="Node.js, PostgreSQL" score={88} color="#8B5CF6" />
          <CandidateRow initials="SK" name="Samir Kulkarni" exp="7 yrs" skills="Go, Kubernetes"      score={83} color="#3B82F6" />
          <CandidateRow initials="AJ" name="Ananya Joshi"   exp="5 yrs" skills="Django, Redis"       score={79} color="#10B981" />

          <div style={{
            padding: "12px 16px", background: T.gray50, borderTop: `0.5px solid ${T.gray200}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: "11px", color: T.gray400 }}>Ranked by AI match score</span>
            <button
              type="button"
              onClick={goToSignIn}
              style={{
                fontSize: "11px", fontWeight: 600, color: T.orange, background: "none",
                border: "none", cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: "4px",
              }}
            >
              Sign in to shortlist <ArrowRight size={11} />
            </button>
          </div>
        </div>
      </section>

      {/* ══ Feature cards ══════════════════════════════════════════════════ */}
      <section className="hd-section" style={{ background: T.white }}>
        <div style={{ maxWidth: "980px", margin: "0 auto" }}>
          <p className="hd-eyebrow">Built for HR teams</p>
          <h2 className="hd-h2">Everything you need. Nothing you don't.</h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
            <FeatureCard
              icon={Zap}
              title="Instant AI shortlisting"
              desc="Rank hundreds of resumes in minutes. The AI extracts skills, matches must-haves, and scores each candidate so you don't have to."
              accentColor="#F07C2D"
              accentBg="#FFF0E6"
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Objective, every time"
              desc="Scores are based strictly on hard data: verified experience, required skills, and role fit. No gut feelings. No unconscious bias."
              accentColor="#10B981"
              accentBg="#ECFDF5"
            />
            <FeatureCard
              icon={Users}
              title="End-to-end pipeline"
              desc="From AI shortlist to offer letter: schedule interviews, collect structured feedback, and generate offers without switching tools."
              accentColor="#3B82F6"
              accentBg="#EFF6FF"
            />
          </div>
        </div>
      </section>

      {/* ══ CTA banner ═════════════════════════════════════════════════════ */}
      <section className="hd-section" style={{ background: T.navy, padding: "72px 24px", textAlign: "center" }}>
        <h2 style={{ fontSize: "28px", fontWeight: 700, color: T.white, letterSpacing: "-0.025em", margin: "0 0 14px" }}>
          Ready to cut your time-to-shortlist?
        </h2>
        <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.55)", margin: "0 0 32px" }}>
          Your next great hire is already in the pile.
        </p>
        <button type="button" className="hd-cta-btn" onClick={goToSignIn}>
          Sign in to open dashboard <ArrowRight size={15} />
        </button>
      </section>

      {/* ══ Footer ═════════════════════════════════════════════════════════ */}
      <footer
        className="hd-footer"
        style={{
          background: T.navyDeep, padding: "28px 40px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderTop: "0.5px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img src="/company-logo1.png" alt="Atgeir" style={{ height: "22px", opacity: 0.6 }} />
          <span style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.12)" }} />
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>HireDesk</span>
        </div>
        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>
          © {new Date().getFullYear()} Atgeir Solutions
        </span>
      </footer>
    </div>
  );
}