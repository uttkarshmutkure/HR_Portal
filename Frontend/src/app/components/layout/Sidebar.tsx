import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { User, LogOut } from 'lucide-react';
import { useAuth } from '../AuthContext';

// ── Nav structure ──────────────────────────────────────────────────────────────
const NAV = [
  {
    section: 'Main',
    items: [
      { label: 'Dashboard',   path: '/dashboard',   roles: ['hr'],                   icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
      { label: 'Jobs',        path: '/jobs',        roles: ['hr', 'interviewer'],    icon: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
      { label: 'Shortlisted', path: '/shortlisted', roles: ['hr'],                   icon: 'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z' },
    ],
  },
  {
    section: 'Pipeline',
    items: [
      { label: 'Interviews',  path: '/interviews',  roles: ['hr', 'interviewer'],    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
      //{ label: 'Timeline',    path: '/timeline',    icon: 'M13 17h8m0 0V9m0 8l-8-8-4 4-6-6' },
      { label: 'Feedback',    path: '/feedback',    roles: ['hr', 'interviewer'],    icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' },
    ],
  },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {d.split('M').filter(Boolean).map((seg, i) => (
        <path key={i} d={`M${seg}`} />
      ))}
    </svg>
  );
}

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, activeRole, logout } = useAuth();

  const displayName = user?.email ?? 'Unknown user';
  const roleLabel = activeRole === 'hr' ? 'HR Manager' : activeRole === 'interviewer' ? 'Interviewer' : '';
  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : '??';

  function handleLogout() {
    logout();
    navigate('/');
  }

  const [showUserMenu, setShowUserMenu] = useState(false);

  // ── Smarter Active State Logic ──
  const isActive = (path: string) => {
    const curr = location.pathname;

    if (path === '/dashboard') {
      return curr === '/dashboard' || curr === '/';
    }
    if (path === '/jobs') {
       return curr === '/jobs' || (curr.startsWith('/jobs/') && !curr.includes('/shortlisted') && !curr.includes('/pipeline') && !curr.includes('/candidates'));
    }
    if (path === '/shortlisted') {
      return curr === '/shortlisted' || curr.includes('/shortlisted');
    }
    if (path === '/interviews') {
      return curr === '/interviews' || curr.includes('/pipeline');
    }
    if (path === '/timeline') {
      return curr === '/timeline' || curr.includes('/timeline');
    }
    if (path === '/feedback') {
      return curr === '/feedback' || curr.includes('/feedback');
    }

    return curr === path || curr.startsWith(path + '/');
  };

  return (
    <div
      className="fixed left-0 top-0 h-screen flex flex-col"
      style={{ width: '220px', background: '#0F0D2A', fontFamily: 'Inter, sans-serif' }}
    >
      {/* ── Logo ── */}
      <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="/company-logo1.png" alt="Atgeir Solutions" style={{ height: '32px', width: 'auto', objectFit: 'contain' }} />
        </div>
        <div style={{ marginTop: '8px', fontSize: '10px', fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(240,124,45,0.5)' }}>
          HR Screening Platform
        </div>
      </div>

      {/* ── Nav ── */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {NAV.map((group) => {
          const visibleItems = group.items.filter(
            (item) => activeRole && item.roles.includes(activeRole)
          );
          if (visibleItems.length === 0) return null;

          return (
          <div key={group.section} style={{ marginBottom: '4px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.2)', padding: '12px 10px 5px' }}>
              {group.section}
            </div>
            {visibleItems.map((item) => {
              const active = isActive(item.path);
              return (
                <Link
                  key={item.label}
                  to={item.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    marginBottom: '1px',
                    fontSize: '13px',
                    fontWeight: active ? 500 : 400,
                    color: active ? '#F07C2D' : 'rgba(255,255,255,0.45)',
                    background: active ? 'rgba(240,124,45,0.1)' : 'transparent',
                    textDecoration: 'none',
                    position: 'relative',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)';
                      (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                      (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.45)';
                    }
                  }}
                >
                  {/* Active indicator */}
                  {active && (
                    <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: '3px', height: '20px', background: '#F07C2D', borderRadius: '0 3px 3px 0' }} />
                  )}

                  {/* Icon box */}
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '7px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? 'rgba(240,124,45,0.15)' : 'rgba(255,255,255,0.05)',
                  }}>
                    <NavIcon d={item.icon} />
                  </div>

                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
          );
        })}
      </nav>

      {/* ── Divider ── */}
      <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '0 16px' }} />

      {/* ── User footer ── */}
      <div style={{ padding: '12px 10px', position: 'relative' }}>
        {showUserMenu && (
          <div style={{
            position: 'absolute', bottom: '100%', left: '10px', right: '10px',
            marginBottom: '6px',
            background: '#1a1740', borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.1)',
            overflow: 'hidden',
            boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
          }}>
            <button
              onClick={handleLogout}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '13px', color: '#ff9b9b', fontFamily: 'Inter, sans-serif',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,107,107,0.08)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <LogOut size={14} /> Logout
            </button>
          </div>
        )}

        <div
          onClick={() => setShowUserMenu(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px', borderRadius: '10px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
            cursor: 'pointer',
          }}
        >
          <div style={{
            width: '34px', height: '34px', borderRadius: '10px', flexShrink: 0,
            background: 'linear-gradient(135deg, #F07C2D 0%, #ff9f5e 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff' }}>{initials}</span>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>{roleLabel}</div>
          </div>
        </div>
      </div>
    </div>
  );
}