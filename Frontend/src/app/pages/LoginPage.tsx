// import { useState } from "react";
// import { useNavigate } from "react-router";
// import { ArrowRight, Building2, UserSquare2 } from "lucide-react";
// import { useAuth, Role } from "../components/AuthContext";

// const T = {
//   orange: "#F07C2D",
//   navyDeep: "#0F0D2E",
//   font: "'Inter', sans-serif",
// };

// export default function LoginPage() {
//   const [email, setEmail] = useState("");
//   const [role, setRole] = useState<Role>("hr");
//   const [error, setError] = useState("");
//   const [loading, setLoading] = useState(false);

//   const { login } = useAuth();
//   const navigate = useNavigate();

//   async function handleSubmit(e: React.FormEvent) {
//     e.preventDefault();
//     setError("");
//     setLoading(true);

//     const failMessage = await login(email, role);

//     setLoading(false);

//     if (failMessage) {
//       setError(failMessage);
//       return;
//     }

//     navigate(role === "hr" ? "/dashboard" : "/jobs");
//   }

//   return (
//     <div style={{
//       minHeight: "100vh", background: T.navyDeep, fontFamily: T.font,
//       display: "flex", alignItems: "center", justifyContent: "center", padding: "24px",
//     }}>
//       <form onSubmit={handleSubmit} style={{
//         width: "100%", maxWidth: "380px",
//         background: "rgba(255,255,255,0.04)",
//         border: "0.5px solid rgba(255,255,255,0.1)",
//         borderRadius: "16px", padding: "36px 32px",
//         backdropFilter: "blur(8px)",
//       }}>
//         <h1 style={{ color: "#fff", fontSize: "22px", fontWeight: 700, marginBottom: "6px" }}>
//           Welcome back
//         </h1>
//         <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "13px", marginBottom: "28px" }}>
//           Log in to HireDesk
//         </p>

//         {/* Role selector */}
//         <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
//           <RoleOption
//             active={role === "hr"}
//             icon={Building2}
//             label="HR"
//             onClick={() => setRole("hr")}
//           />
//           <RoleOption
//             active={role === "interviewer"}
//             icon={UserSquare2}
//             label="Interviewer"
//             onClick={() => setRole("interviewer")}
//           />
//         </div>

//         <label style={labelStyle}>Email</label>
//         <input
//           style={inputStyle}
//           type="email"
//           value={email}
//           onChange={(e) => setEmail(e.target.value)}
//           placeholder="you@atgeir.com"
//           required
//         />

//         {error && (
//           <p style={{ color: "#ff6b6b", fontSize: "12.5px", marginTop: "10px", marginBottom: 0 }}>
//             {error}
//           </p>
//         )}

//         <button
//           type="submit"
//           disabled={loading}
//           style={{
//             marginTop: "22px", width: "100%",
//             display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
//             padding: "12px", borderRadius: "10px",
//             background: T.orange, color: "#fff",
//             fontSize: "14px", fontWeight: 600, border: "none",
//             cursor: loading ? "default" : "pointer",
//             opacity: loading ? 0.7 : 1,
//           }}
//         >
//           {loading ? "Signing in..." : "Sign in"} <ArrowRight size={15} />
//         </button>
//       </form>
//     </div>
//   );
// }

// function RoleOption({ active, icon: Icon, label, onClick }: {
//   active: boolean; icon: any; label: string; onClick: () => void;
// }) {
//   return (
//     <button
//       type="button"
//       onClick={onClick}
//       style={{
//         flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
//         padding: "14px 8px", borderRadius: "10px",
//         border: active ? `1px solid ${T.orange}` : "1px solid rgba(255,255,255,0.12)",
//         background: active ? "rgba(240,124,45,0.12)" : "transparent",
//         cursor: "pointer", transition: "all 0.15s",
//       }}
//     >
//       <Icon size={18} color={active ? T.orange : "rgba(255,255,255,0.5)"} />
//       <span style={{
//         fontSize: "12px", fontWeight: 600,
//         color: active ? "#fff" : "rgba(255,255,255,0.5)",
//       }}>
//         {label}
//       </span>
//     </button>
//   );
// }

// const labelStyle: React.CSSProperties = {
//   display: "block", color: "rgba(255,255,255,0.5)", fontSize: "12px",
//   marginBottom: "6px", marginTop: "14px",
// };

// const inputStyle: React.CSSProperties = {
//   width: "100%", padding: "10px 12px", borderRadius: "8px",
//   border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)",
//   color: "#fff", fontSize: "13px", outline: "none", boxSizing: "border-box",
// };


import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, ArrowLeft, Building2, UserSquare2 } from "lucide-react";
import { useAuth, Role } from "../components/AuthContext";

// ── Design tokens (shared with landing page) ───────────────────────────────
const T = {
  orange:      "#F07C2D",
  orangeDim:   "rgba(240,124,45,0.15)",
  navy:        "#1D194B",
  navyDeep:    "#0F0D2E",
  font:        "'Inter', sans-serif",
};

// ── Particle canvas (same network effect as the landing page hero) ────────
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let W = 0, H = 0;

    const PARTICLE_COUNT = 60;
    const MAX_DIST = 150;
    const SPEED = 0.22;

    type Particle = { x: number; y: number; vx: number; vy: number; r: number; opacity: number };
    let particles: Particle[] = [];

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width = W * devicePixelRatio;
      canvas.height = H * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    };

    const init = () => {
      particles = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * SPEED,
        vy: (Math.random() - 0.5) * SPEED,
        r: Math.random() * 1.6 + 0.6,
        opacity: Math.random() * 0.2 + 0.08,
      }));
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MAX_DIST) {
            const alpha = (1 - dist / MAX_DIST) * 0.09;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(240,124,45,${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(240,124,45,${p.opacity})`;
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

// ── Main Page ────────────────────────────────────────────────────────────
// export default function LoginPage() {
//   const [role, setRole] = useState<Role>("hr");
//   const [error, setError] = useState("");
//   const [loading, setLoading] = useState(false);

//   const { login } = useAuth();
//   const navigate = useNavigate();

//   async function handleSubmit(e: React.FormEvent) {
//     e.preventDefault();
//     setError("");
//     setLoading(true);

//     const failMessage = await login(role);
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("hr");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const failMessage = await login(email, role);

    setLoading(false);

    if (failMessage) {
      setError(failMessage);
      return;
    }

    navigate(role === "hr" ? "/dashboard" : "/jobs");
  }

  return (
    <div style={{
      position: "relative",
      minHeight: "100vh", background: T.navyDeep, fontFamily: T.font,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px", overflow: "hidden",
    }}>
      {/* Background layers */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 0,
        background: `radial-gradient(circle at 50% 30%, rgba(240,124,45,0.08) 0%, transparent 55%)`,
      }} />
      <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <ParticleCanvas />
      </div>

      {/* Back to home */}
      <a
        href="/"
        onClick={(e) => { e.preventDefault(); navigate("/"); }}
        style={{
          position: "absolute", top: "28px", left: "32px", zIndex: 2,
          display: "flex", alignItems: "center", gap: "6px",
          fontSize: "13px", color: "rgba(255,255,255,0.4)",
          textDecoration: "none", fontFamily: T.font,
          transition: "color 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.75)"}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.4)"}
      >
        <ArrowLeft size={14} /> Back to home
      </a>

      {/* Card */}
      <form
        onSubmit={handleSubmit}
        style={{
          position: "relative", zIndex: 2,
          width: "100%", maxWidth: "400px",
          background: "rgba(255,255,255,0.035)",
          border: "0.5px solid rgba(255,255,255,0.1)",
          borderRadius: "20px", padding: "40px 36px",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
          animation: "cardIn 0.5s ease both",
        }}
      >
        {/* Logo mark */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "28px" }}>
          <img
            src="/company-logo1.png"
            alt="Atgeir Solutions"
            style={{ height: "24px", width: "auto", objectFit: "contain" }}
          />
          <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.15)" }} />
          <span style={{
            fontSize: "10.5px", fontWeight: 600, color: "rgba(255,255,255,0.4)",
            letterSpacing: "0.14em", textTransform: "uppercase",
          }}>
            HireDesk
          </span>
        </div>

        <h1 style={{ color: "#fff", fontSize: "24px", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "6px" }}>
          Welcome back
        </h1>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "13px", marginBottom: "30px" }}>
          Sign in to continue to your workspace
        </p>

        {/* Role selector */}
        <p style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "10px" }}>
          I am logging in as
        </p>
        <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
          <RoleOption
            active={role === "hr"}
            icon={Building2}
            label="HR"
            sub="Full access"
            onClick={() => setRole("hr")}
          />
          <RoleOption
            active={role === "interviewer"}
            icon={UserSquare2}
            label="Interviewer"
            sub="Your interviews"
            onClick={() => setRole("interviewer")}
          />
        </div>

        <label style={labelStyle}>Email address</label>
        <input
          style={inputStyle}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@atgeir.com"
          onFocus={e => (e.currentTarget.style.borderColor = T.orange)}
          onBlur={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)")}
          required
        />

        {error && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: "8px",
            marginTop: "14px", padding: "10px 12px",
            background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.25)",
            borderRadius: "8px",
          }}>
            <p style={{ color: "#ff9b9b", fontSize: "12.5px", margin: 0, lineHeight: 1.5 }}>
              {error}
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: "24px", width: "100%",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            padding: "13px", borderRadius: "10px",
            background: T.orange, color: "#fff",
            fontSize: "14px", fontWeight: 600, border: "none",
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.7 : 1,
            boxShadow: "0 8px 24px rgba(240,124,45,0.25)",
            transition: "transform 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={e => {
            if (loading) return;
            (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
            (e.currentTarget as HTMLElement).style.boxShadow = "0 12px 30px rgba(240,124,45,0.35)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.transform = "none";
            (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(240,124,45,0.25)";
          }}
        >
          {/* {loading ? "Signing in..." : "Sign in with Google"} <ArrowRight size={15} /> */}
          {loading ? "Signing in..." : "Sign in"} <ArrowRight size={15} />
        </button>
      </form>

      <style>{`
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; transition: none !important; }
        }
        :focus-visible {
          outline: 2px solid ${T.orange};
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}

function RoleOption({ active, icon: Icon, label, sub, onClick }: {
  active: boolean; icon: any; label: string; sub: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "7px",
        padding: "16px 8px", borderRadius: "12px",
        border: active ? `1px solid ${T.orange}` : "1px solid rgba(255,255,255,0.1)",
        background: active ? T.orangeDim : "rgba(255,255,255,0.02)",
        cursor: "pointer", transition: "all 0.15s",
      }}
    >
      <div style={{
        width: "34px", height: "34px", borderRadius: "9px",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: active ? "rgba(240,124,45,0.18)" : "rgba(255,255,255,0.05)",
      }}>
        <Icon size={17} color={active ? T.orange : "rgba(255,255,255,0.5)"} />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: active ? "#fff" : "rgba(255,255,255,0.6)" }}>
          {label}
        </div>
        <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.32)", marginTop: "1px" }}>
          {sub}
        </div>
      </div>
    </button>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", color: "rgba(255,255,255,0.5)", fontSize: "12px",
  marginBottom: "7px",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "11px 13px", borderRadius: "9px",
  border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)",
  color: "#fff", fontSize: "13.5px", outline: "none", boxSizing: "border-box",
  transition: "border-color 0.15s",
};
