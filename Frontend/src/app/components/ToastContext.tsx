import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

const FONT = 'Inter, sans-serif';

// 1. Create the Context
const ToastContext = createContext<any>(null);

// 2. Custom Hook so any file can use it easily
export const useToast = () => useContext(ToastContext);

// 3. The Provider that wraps your app
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500); // Auto-hide after 3.5 seconds
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      
      {/* The Floating UI Card */}
      {toast && (
        <div style={{
          position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
          background: '#fff', 
          border: `1px solid ${toast.type === 'success' ? '#6EE7B7' : '#FCA5A5'}`,
          borderLeft: `4px solid ${toast.type === 'success' ? '#10B981' : '#EF4444'}`,
          borderRadius: '8px', padding: '12px 16px', 
          display: 'flex', alignItems: 'center', gap: '12px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.1)', 
          fontFamily: FONT,
          transition: 'all 0.3s ease'
        }}>
          {toast.type === 'success' ? <CheckCircle size={18} color="#10B981" /> : <XCircle size={18} color="#EF4444" />}
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#111827' }}>{toast.message}</span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: '8px', color: '#9CA3AF', display: 'flex', alignItems: 'center' }}>
            <X size={14} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}