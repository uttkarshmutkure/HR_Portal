import { Link, useLocation } from 'react-router';

const FONT = 'Inter, sans-serif';

export default function TopBar({ breadcrumb }: { breadcrumb?: string }) {
  const location = useLocation();
  const pathParts = location.pathname.split('/').filter(Boolean);

  // ── Smarter Breadcrumb Parser ──
  const getBreadcrumbLinks = () => {
    if (!breadcrumb) return [];
    const labels = breadcrumb.split(' / ');

    const jobId       = (pathParts[0] === 'jobs' && pathParts[1]) ? pathParts[1] : null;
    const candidateId = (pathParts[2] === 'candidates' && pathParts[3]) ? pathParts[3] : null;

    return labels.map((label, index) => {
      let path = '';

      if (label === 'Dashboard') {
        path = '/dashboard';
      }
      else if (label === 'Jobs' || label === 'All Jobs') {
        path = '/jobs';
      }
      // Label right after "Jobs" → the job title link
      else if (labels[index - 1] === 'Jobs' || labels[index - 1] === 'All Jobs') {
        path = jobId ? `/jobs/${jobId}` : '/jobs';
      }
      else if (label.includes('Shortlisted')) {
        path = jobId ? `/jobs/${jobId}/shortlisted` : '/shortlisted';
      }
      else if (label.includes('Pipeline')) {
        path = jobId ? `/jobs/${jobId}/pipeline` : '/interviews';
      }
      // Label right before "Timeline" → candidate detail page
      else if (labels[index + 1] === 'Timeline' && jobId && candidateId) {
        path = `/jobs/${jobId}/candidates/${candidateId}`;
      }
      // Candidate name (last non-timeline crumb on candidate page)
      else if (jobId && candidateId) {
        path = `/jobs/${jobId}/candidates/${candidateId}`;
      }
      else {
        path = location.pathname;
      }

      return { label, path, isLast: index === labels.length - 1 };
    });
  };

  const links = getBreadcrumbLinks();

  return (
    <div style={{ background: '#fff', borderBottom: '0.5px solid #E5E7EB', height: '56px', display: 'flex', alignItems: 'center', padding: '0 24px', gap: '12px', position: 'sticky', top: 0, zIndex: 40 }}>

      {/* ── Dynamic Clickable Breadcrumbs ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontFamily: FONT }}>
        {links.map((link, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {link.isLast ? (
              <span style={{ color: '#111827', fontWeight: 500 }}>{link.label}</span>
            ) : (
              <Link
                to={link.path}
                style={{ color: '#9CA3AF', textDecoration: 'none', transition: 'color 0.15s ease' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#F07C2D')}
                onMouseLeave={e => (e.currentTarget.style.color = '#9CA3AF')}
              >
                {link.label}
              </Link>
            )}
            {!link.isLast && <span style={{ color: '#D1D5DB' }}>/</span>}
          </div>
        ))}
      </div>

      {/* ── Right Side Controls ── */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ background: '#ECFDF5', border: '0.5px solid #A7F3D0', color: '#059669', padding: '6px 12px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600, fontFamily: FONT }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }} />
          System Online
        </div>
      </div>
    </div>
  );
}