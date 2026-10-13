import { useNavigate } from 'react-router';
import { Briefcase, ArrowRight } from 'lucide-react';
import DashboardLayout from '../components/layout/DashboardLayout';

const FONT = 'Inter, sans-serif';

export default function PlaceholderPage({ title, message }: { title: string, message: string }) {
  const navigate = useNavigate();

  return (
    <DashboardLayout breadcrumb={`Dashboard / ${title}`}>
      <div style={{ padding: '60px 20px', fontFamily: FONT, display: 'flex', justifyContent: 'center' }}>
        <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '14px', padding: '40px', textAlign: 'center', maxWidth: '440px', width: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Briefcase size={28} style={{ color: '#F07C2D' }} />
          </div>
          
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginBottom: '10px', letterSpacing: '-0.01em' }}>
            {title}
          </h2>
          
          <p style={{ fontSize: '13px', color: '#6B7280', lineHeight: 1.6, marginBottom: '24px' }}>
            {message}
          </p>
          
          <button
            onClick={() => navigate('/jobs')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '8px', background: '#1D194B', color: '#fff', fontSize: '13px', fontWeight: 500, border: 'none', cursor: 'pointer', transition: 'opacity 0.2s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.9'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
          >
            Go to Jobs <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}