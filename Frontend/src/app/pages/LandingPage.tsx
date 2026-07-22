import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, BrainCircuit, Zap, ShieldCheck, Users } from 'lucide-react';

// ── Design Tokens ─────────────────────────────────────────────────────────────
const T = {
  orange:      '#F07C2D',
  orangeLight: '#FFF0E6',
  orangeDim:   'rgba(240,124,45,0.15)',
  navy:        '#1D194B',
  navyDeep:    '#0F0D2E',
  white:       '#FFFFFF',
  offWhite:    '#F4F6FB',
  gray50:      '#F9FAFB',
  gray200:     '#E5E7EB',
  gray400:     '#9CA3AF',
  gray600:     '#6B7280',
  gray800:     '#1F2937',
  textPrimary: '#111827',
  font:        "'Inter', sans-serif",
};

// ── Canvas particle network (the "video" background) ─────────────────────────
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let W = 0, H = 0;

    const PARTICLE_COUNT = 72;
    const MAX_DIST       = 160;
    const SPEED          = 0.28;

    type Particle = {
      x: number; y: number;
      vx: number; vy: number;
      r: number; opacity: number;
    };

    let particles: Particle[] = [];

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width  = W * devicePixelRatio;
      canvas.height = H * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    };

    const init = () => {
      particles = Array.from({ length: PARTICLE_COUNT }, () => ({
        x:       Math.random() * W,
        y:       Math.random() * H,
        vx:      (Math.random() - 0.5) * SPEED,
        vy:      (Math.random() - 0.5) * SPEED,
        r:       Math.random() * 1.8 + 0.6,
        opacity: Math.random() * 0.22 + 0.08,
      }));
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      // Update positions
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
      }

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MAX_DIST) {
            const alpha = (1 - dist / MAX_DIST) * 0.10;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(240,124,45,${alpha})`;
            ctx.lineWidth   = 0.5;
            ctx.stroke();
          }
        }
      }

      // Draw nodes
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
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        display: 'block',
      }}
    />
  );
}

// ── Feature Card ──────────────────────────────────────────────────────────────
function FeatureCard({
  icon: Icon, title, desc, accentColor, accentBg,
}: {
  icon: any; title: string; desc: string;
  accentColor: string; accentBg: string;
}) {
  return (
    <div
      style={{
        background: T.white,
        border: `0.5px solid ${T.gray200}`,
        borderRadius: '16px',
        padding: '28px 24px',
        transition: 'transform 0.22s ease, box-shadow 0.22s ease',
        cursor: 'default',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform  = 'translateY(-5px)';
        el.style.boxShadow  = '0 16px 40px rgba(0,0,0,0.07)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform  = 'none';
        el.style.boxShadow  = 'none';
      }}
    >
      <div style={{
        width: '44px', height: '44px', borderRadius: '12px',
        background: accentBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '18px',
      }}>
        <Icon size={22} color={accentColor} />
      </div>
      <h3 style={{
        fontSize: '15px', fontWeight: 600, color: T.textPrimary,
        fontFamily: T.font, letterSpacing: '-0.015em', marginBottom: '8px',
      }}>
        {title}
      </h3>
      <p style={{
        fontSize: '13px', color: T.gray600,
        fontFamily: T.font, lineHeight: 1.65, margin: 0,
      }}>
        {desc}
      </p>
    </div>
  );
}

// ── Stat Pill ─────────────────────────────────────────────────────────────────
function StatPill({ value, label }: { value: string; label: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '0 28px', borderRight: `0.5px solid rgba(255,255,255,0.12)`,
    }}>
      <span style={{
        fontSize: '28px', fontWeight: 700, color: T.white,
        fontFamily: T.font, letterSpacing: '-0.03em', lineHeight: 1,
      }}>
        {value}
      </span>
      <span style={{
        fontSize: '11px', color: 'rgba(255,255,255,0.5)',
        fontFamily: T.font, marginTop: '5px', letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
    </div>
  );
}

// ── Candidate Preview Card ────────────────────────────────────────────────────
function CandidateRow({
  initials, name, exp, skills, score, color,
}: {
  initials: string; name: string; exp: string;
  skills: string; score: number; color: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '11px 16px',
      borderBottom: `0.5px solid ${T.gray200}`,
    }}>
      <div style={{
        width: '36px', height: '36px', borderRadius: '50%',
        background: color, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: T.white,
        fontSize: '12px', fontWeight: 700, fontFamily: T.font, flexShrink: 0,
      }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '13px', fontWeight: 600, color: T.textPrimary,
          fontFamily: T.font, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {name}
        </div>
        <div style={{ fontSize: '11px', color: T.gray400, fontFamily: T.font, marginTop: '1px' }}>
          {exp} · {skills}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: T.orange, fontFamily: T.font, lineHeight: 1 }}>
          {score}%
        </div>
        <div style={{ fontSize: '9px', color: T.gray400, fontFamily: T.font, marginTop: '2px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          AI match
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: T.offWhite, fontFamily: T.font, display: 'flex', flexDirection: 'column' }}>

      {/* ── Navbar ────────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        background: 'rgba(15,13,46,0.6)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        borderBottom: '0.5px solid rgba(255,255,255,0.08)',
        padding: '0 40px',
        height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <img
            src="/company-logo.png"
            alt="Atgeir Solutions"
            style={{ height: '30px', width: 'auto', objectFit: 'contain' }}
          />
          <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.15)' }} />
          <span style={{
            fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.14em', textTransform: 'uppercase',
          }}>
            HireDesk
          </span>
        </div>

        <button
          onClick={() => navigate('/dashboard')}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            padding: '8px 18px', borderRadius: '8px',
            background: T.navy, color: T.white,
            fontSize: '13px', fontWeight: 500,
            fontFamily: T.font, border: 'none', cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.85'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
        >
          Open dashboard <ArrowRight size={14} />
        </button>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section style={{
        position: 'relative',
        background: T.navyDeep,
        overflow: 'hidden',
        minHeight: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '100px 24px 120px',
      }}>
        {/* Layer 1 — background video */}
        <video
          autoPlay
          muted
          loop
          playsInline
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover',
            opacity: 0.85,
            zIndex: 0,
          }}
        >
          <source src="/hero-bg.mp4" type="video/mp4" />
        </video>

        {/* Layer 2 — subtle overlay: just enough to darken edges + keep text readable */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 1,
          background: `linear-gradient(to bottom,
            rgba(15,13,46,0.72) 0%,
            rgba(15,13,46,0.35) 30%,
            rgba(15,13,46,0.35) 70%,
            rgba(15,13,46,0.80) 100%
          )`,
          pointerEvents: 'none',
        }} />

        {/* Layer 3 — particle canvas (orange network floating on top) */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
          <ParticleCanvas />
        </div>

        {/* Layer 4 — Hero content */}
        <div style={{ position: 'relative', zIndex: 3, textAlign: 'center', maxWidth: '780px' }}>

          {/* Eyebrow badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '7px',
            padding: '6px 16px', borderRadius: '24px',
            background: T.orangeDim,
            border: `0.5px solid rgba(240,124,45,0.35)`,
            color: T.orange, fontSize: '12px', fontWeight: 600,
            letterSpacing: '0.02em', marginBottom: '28px',
            animation: 'fadeUp 0.5s ease both',
          }}>
            <BrainCircuit size={14} />
            AI-Powered Candidate Screening
          </div>

          {/* Headline */}
          <h1 style={{
            fontSize: 'clamp(36px, 6vw, 58px)',
            fontWeight: 800,
            color: T.white,
            letterSpacing: '-0.035em',
            lineHeight: 1.1,
            marginBottom: '22px',
            animation: 'fadeUp 0.65s ease both',
          }}>
            Hire smarter.{' '}
            <span style={{ color: T.orange }}>Screen faster.</span>
          </h1>

          {/* Subhead */}
          <p style={{
            fontSize: '16px',
            color: 'rgba(255,255,255,0.58)',
            lineHeight: 1.7,
            maxWidth: '560px',
            margin: '0 auto 40px',
            animation: 'fadeUp 0.8s ease both',
          }}>
            Atgeir HireDesk uses AI to rank resumes, surface skill gaps, and move
            candidates through your pipeline — all without the spreadsheets.
          </p>

          {/* CTA */}
          <div style={{ animation: 'fadeUp 0.95s ease both', display: 'flex', justifyContent: 'center', gap: '12px' }}>
            <button
              onClick={() => navigate('/dashboard')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '9px',
                padding: '14px 28px', borderRadius: '10px',
                background: T.orange, color: T.white,
                fontSize: '14px', fontWeight: 600,
                fontFamily: T.font, border: 'none', cursor: 'pointer',
                boxShadow: '0 0 0 0 rgba(240,124,45,0)',
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.transform  = 'translateY(-2px)';
                el.style.boxShadow  = '0 8px 28px rgba(240,124,45,0.45)';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.transform  = 'none';
                el.style.boxShadow  = '0 0 0 0 rgba(240,124,45,0)';
              }}
            >
              Open dashboard <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{
          position: 'relative', zIndex: 3,
          display: 'flex', justifyContent: 'center',
          marginTop: '72px',
          animation: 'fadeUp 1.1s ease both',
        }}>
          <div style={{
            display: 'flex',
            background: 'rgba(255,255,255,0.05)',
            border: '0.5px solid rgba(255,255,255,0.1)',
            borderRadius: '16px',
            padding: '24px 0',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}>
            <StatPill value="10×"  label="Faster shortlisting" />
            <StatPill value="94%"  label="Avg AI accuracy" />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 28px' }}>
              <span style={{ fontSize: '28px', fontWeight: 700, color: T.white, fontFamily: T.font, letterSpacing: '-0.03em', lineHeight: 1 }}>
                3 min
              </span>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontFamily: T.font, marginTop: '5px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Setup per role
              </span>
            </div>
          </div>
        </div>

        {/* Scroll nudge */}
        <div style={{
          position: 'absolute', bottom: '36px', left: '50%',
          transform: 'translateX(-50%)', zIndex: 3,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
          animation: 'fadeUp 1.4s ease both',
        }}>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.28)', fontFamily: T.font, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Scroll</span>
          <div style={{ width: '1px', height: '28px', background: 'linear-gradient(to bottom, rgba(255,255,255,0.28), transparent)' }} />
        </div>
      </section>

      {/* ── UI Preview ────────────────────────────────────────────────────── */}
      <section style={{
        background: T.offWhite,
        padding: '80px 24px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        <p style={{
          fontSize: '11px', fontWeight: 600, color: T.orange,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          marginBottom: '12px', fontFamily: T.font,
        }}>
          See it in action
        </p>
        <h2 style={{
          fontSize: '30px', fontWeight: 700, color: T.textPrimary,
          letterSpacing: '-0.025em', marginBottom: '48px',
          fontFamily: T.font, textAlign: 'center',
        }}>
          Your shortlist, in seconds.
        </h2>

        {/* Mock candidate list */}
        <div style={{
          width: '100%', maxWidth: '680px',
          background: T.white,
          border: `0.5px solid ${T.gray200}`,
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.06)',
        }}>
          {/* Card header */}
          <div style={{
            padding: '14px 16px',
            borderBottom: `0.5px solid ${T.gray200}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <span style={{ fontSize: '13px', fontWeight: 600, color: T.textPrimary, fontFamily: T.font }}>
                Senior Backend Engineer
              </span>
              <span style={{
                marginLeft: '10px', padding: '2px 8px', borderRadius: '20px',
                background: '#ECFDF5', color: '#065F46',
                fontSize: '10px', fontWeight: 600, fontFamily: T.font,
              }}>
                AI screening done
              </span>
            </div>
            <span style={{ fontSize: '11px', color: T.gray400, fontFamily: T.font }}>
              48 resumes processed
            </span>
          </div>

          {/* Rows */}
          <CandidateRow initials="AR" name="Arjun Reddy"       exp="8 yrs" skills="Python, FastAPI"     score={94} color="#F07C2D" />
          <CandidateRow initials="PM" name="Priya Mehta"       exp="6 yrs" skills="Node.js, PostgreSQL" score={88} color="#8B5CF6" />
          <CandidateRow initials="SK" name="Samir Kulkarni"    exp="7 yrs" skills="Go, Kubernetes"      score={83} color="#3B82F6" />
          <CandidateRow initials="AJ" name="Ananya Joshi"      exp="5 yrs" skills="Django, Redis"       score={79} color="#10B981" />

          {/* Footer */}
          <div style={{
            padding: '12px 16px', background: T.gray50,
            borderTop: `0.5px solid ${T.gray200}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '11px', color: T.gray400, fontFamily: T.font }}>
              Ranked by AI match score
            </span>
            <button
              onClick={() => navigate('/dashboard')}
              style={{
                fontSize: '11px', fontWeight: 600, color: T.orange,
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: T.font, display: 'flex', alignItems: 'center', gap: '4px',
              }}
            >
              Shortlist & move to pipeline <ArrowRight size={11} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Feature Cards ────────────────────────────────────────────────── */}
      <section style={{ background: T.white, padding: '80px 24px' }}>
        <div style={{ maxWidth: '980px', margin: '0 auto' }}>
          <p style={{
            fontSize: '11px', fontWeight: 600, color: T.orange,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            marginBottom: '12px', fontFamily: T.font, textAlign: 'center',
          }}>
            Built for HR teams
          </p>
          <h2 style={{
            fontSize: '30px', fontWeight: 700, color: T.textPrimary,
            letterSpacing: '-0.025em', marginBottom: '48px',
            fontFamily: T.font, textAlign: 'center',
          }}>
            Everything you need. Nothing you don't.
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '20px',
          }}>
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
              desc="Scores are based strictly on hard data — verified experience, required skills, and role fit. No gut feelings. No unconscious bias."
              accentColor="#10B981"
              accentBg="#ECFDF5"
            />
            <FeatureCard
              icon={Users}
              title="End-to-end pipeline"
              desc="From AI shortlist to offer letter — schedule interviews, collect structured feedback, and generate offers without switching tools."
              accentColor="#3B82F6"
              accentBg="#EFF6FF"
            />
          </div>
        </div>
      </section>

      {/* ── CTA Banner ────────────────────────────────────────────────────── */}
      <section style={{
        background: T.navy,
        padding: '72px 24px',
        textAlign: 'center',
      }}>
        <h2 style={{
          fontSize: '28px', fontWeight: 700, color: T.white,
          letterSpacing: '-0.025em', marginBottom: '14px', fontFamily: T.font,
        }}>
          Ready to cut your time-to-shortlist?
        </h2>
        <p style={{
          fontSize: '14px', color: 'rgba(255,255,255,0.55)',
          marginBottom: '32px', fontFamily: T.font,
        }}>
          Your next great hire is already in the pile.
        </p>
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '13px 26px', borderRadius: '10px',
            background: T.orange, color: T.white,
            fontSize: '14px', fontWeight: 600,
            fontFamily: T.font, border: 'none', cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.88'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
        >
          Open dashboard <ArrowRight size={15} />
        </button>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer style={{
        background: T.navyDeep,
        padding: '28px 40px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderTop: '0.5px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img src="/company-logo.png" alt="Atgeir" style={{ height: '22px', opacity: 0.6 }} />
          <span style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.12)' }} />
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontFamily: T.font }}>
            HireDesk
          </span>
        </div>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)', fontFamily: T.font }}>
          © {new Date().getFullYear()} Atgeir Solutions
        </span>
      </footer>

      {/* ── Global animations ──────────────────────────────────────────────── */}
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; transition: none !important; }
        }
        :focus-visible {
          outline: 2px solid #F07C2D;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}