import Sidebar from './Sidebar';
import TopBar  from './TopBar';

interface DashboardLayoutProps {
  children:    React.ReactNode;
  breadcrumb?: string;
}

export default function DashboardLayout({ children, breadcrumb }: DashboardLayoutProps) {
  return (
    <div className="min-h-screen" style={{ background: '#F4F6FB', display: 'flex', overflowX: 'hidden' }}>
      <Sidebar />
      <div 
        style={{ 
          flex: 1, 
          marginLeft: '220px', 
          display: 'flex', 
          flexDirection: 'column',
          /* 🚀 FIXED: Forces content to stay within screen width */
          minWidth: 0, 
          overflowX: 'hidden' 
        }}
      >
        <TopBar breadcrumb={breadcrumb} />
        <main style={{ flex: 1, overflowX: 'hidden' }}>{children}</main>
      </div>
    </div>
  );
}