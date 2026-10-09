import { useEffect, useState } from 'react';
import { Loader2, Plus, X, UserSquare2, Building2, Power, User, Search } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useToast } from '../ToastContext';
import { listUsers, grantAccess, setUserStatus, AdminUser, UserRole } from '../../../services/adminUsers';

const FONT = 'Inter, sans-serif';
const T = {
  orange: '#F07C2D', orangeLight: '#FFF7ED', orangeBorder: 'rgba(240,124,45,0.3)',
  navy: '#1D194B', white: '#FFFFFF', bg: '#F4F6FB',
  gray50: '#F9FAFB', gray100: '#F3F4F6', gray200: '#E5E7EB',
  gray400: '#9CA3AF', gray600: '#6B7280', text: '#111827', textSub: '#6B7280',
  green: '#10B981', greenBg: '#ECFDF5', greenText: '#065F46',
  red: '#DC2626', redBg: '#FEF2F2',
};

const ROLE_OPTIONS: { value: UserRole; label: string; icon: any }[] = [
  { value: 'hr', label: 'HR', icon: Building2 },
  { value: 'interviewer', label: 'Interviewer', icon: UserSquare2 },
  { value: 'user', label: 'User', icon: User },
];

function RoleBadge({ role }: { role: UserRole }) {
  const styles: Record<UserRole, { bg: string; color: string }> = {
    hr: { bg: '#EFF6FF', color: '#1D4ED8' },
    interviewer: { bg: '#F5F3FF', color: '#6D28D9' },
    user: { bg: '#ECFDF5', color: '#065F46' },
  };
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600,
      fontFamily: FONT, background: styles[role].bg, color: styles[role].color,
    }}>
      {role}
    </span>
  );
}

// ── Grant / Edit modal ───────────────────────────────────────────────────
function UserFormModal({ editingUser, onClose, onSaved }: {
  editingUser: AdminUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [name, setName] = useState(editingUser?.name || '');
  const [email, setEmail] = useState(editingUser?.email || '');
  const [roles, setRoles] = useState<UserRole[]>(editingUser?.roles || []);
  const [isSaving, setIsSaving] = useState(false);

  const toggleRole = (role: UserRole) => {
    setRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  };

  const handleSave = async () => {
    if (!name || !email || roles.length === 0) return;
    setIsSaving(true);
    try {
      await grantAccess(user!.email, email, name, roles);
      showToast(editingUser ? 'User updated successfully' : 'Access granted successfully', 'success');
      onSaved();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to save user', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: T.white, borderRadius: '14px', width: '100%', maxWidth: '440px', overflow: 'hidden', boxShadow: '0 24px 48px rgba(0,0,0,0.14)', fontFamily: FONT }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.gray100}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: T.text }}>
            {editingUser ? 'Edit User' : 'Grant Access'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.gray400, display: 'flex', padding: '2px' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px', display: 'block' }}>Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Priya Sharma"
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px', display: 'block' }}>Email</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="priya@atgeirsolutions.com"
              disabled={!!editingUser}
              style={{
                width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E5E7EB',
                fontSize: '13px', outline: 'none', boxSizing: 'border-box',
                background: editingUser ? '#F9FAFB' : '#fff',
                color: editingUser ? '#9CA3AF' : '#111827',
                cursor: editingUser ? 'not-allowed' : 'text',
              }}
            />
            {editingUser && (
              <p style={{ fontSize: '10px', color: T.gray400, marginTop: '4px' }}>Email can't be changed — it's the account identifier.</p>
            )}
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '8px', display: 'block' }}>Roles</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {ROLE_OPTIONS.map(({ value, label, icon: Icon }) => {
                const active = roles.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleRole(value)}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px',
                      padding: '10px 6px', borderRadius: '8px',
                      border: active ? `1px solid ${T.orange}` : '1px solid #E5E7EB',
                      background: active ? T.orangeLight : '#fff',
                      cursor: 'pointer', transition: 'all .15s',
                    }}
                  >
                    <Icon size={15} color={active ? T.orange : T.gray400} />
                    <span style={{ fontSize: '11px', fontWeight: 500, color: active ? '#9A3412' : T.gray600 }}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: `1px solid ${T.gray100}`, display: 'flex', justifyContent: 'flex-end', gap: '8px', background: T.gray50 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 500, background: T.white, border: `1px solid ${T.gray200}`, cursor: 'pointer', color: T.textSub }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name || !email || roles.length === 0 || isSaving}
            style={{
              padding: '7px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 500,
              background: T.orange, color: T.white, border: 'none',
              cursor: (!name || !email || roles.length === 0 || isSaving) ? 'not-allowed' : 'pointer',
              opacity: (!name || !email || roles.length === 0 || isSaving) ? 0.5 : 1,
            }}
          >
            {isSaving ? 'Saving…' : editingUser ? 'Save Changes' : 'Grant Access'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm dialog for status toggle ────────────────────────────────────
function ConfirmDialog({ message, confirmLabel, confirmColor, onConfirm, onCancel, isLoading }: {
  message: string; confirmLabel: string; confirmColor: string;
  onConfirm: () => void; onCancel: () => void; isLoading: boolean;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '24px 28px', width: '340px', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', fontFamily: FONT }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '8px' }}>Are you sure?</div>
        <div style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.6, marginBottom: '20px' }}>{message}</div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button disabled={isLoading} onClick={onCancel} style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 500, background: '#F9FAFB', color: '#374151', border: '0.5px solid #E5E7EB', borderRadius: '7px', cursor: isLoading ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button disabled={isLoading} onClick={onConfirm} style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 500, background: confirmColor, color: '#fff', border: 'none', borderRadius: '7px', cursor: isLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: isLoading ? 0.7 : 1 }}>
            {isLoading && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main tab ─────────────────────────────────────────────────────────────
export default function UsersTab() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<AdminUser | null>(null);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const loadUsers = async () => {
    if (!user?.email) return;
    setLoading(true);
    setError(null);
    try {
      setUsers(await listUsers(user.email));
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, [user?.email]);

  const openAddModal = () => { setEditingUser(null); setShowForm(true); };
  const openEditModal = (u: AdminUser) => { setEditingUser(u); setShowForm(true); };

  const handleToggleStatus = async () => {
    if (!confirmTarget || !user?.email) return;
    setIsTogglingStatus(true);
    const newStatus = confirmTarget.status === 'active' ? 'disabled' : 'active';
    try {
      await setUserStatus(user.email, confirmTarget.user_id, newStatus);
      showToast(`${confirmTarget.name} ${newStatus === 'active' ? 'enabled' : 'disabled'}`, 'success');
      setConfirmTarget(null);
      loadUsers();
    } catch (err: any) {
      showToast(err.message || 'Failed to update status', 'error');
    } finally {
      setIsTogglingStatus(false);
    }
  };
  const q = searchQuery.trim().toLowerCase();
  const visibleUsers = users.filter(u => !q ||
    u.name.toLowerCase().includes(q) ||
    u.email.toLowerCase().includes(q) ||
    u.roles.some(r => r.toLowerCase().includes(q)));
  return (
    <div style={{ fontFamily: FONT }}>
      {showForm && (
        <UserFormModal
          editingUser={editingUser}
          onClose={() => setShowForm(false)}
          onSaved={loadUsers}
        />
      )}
      {confirmTarget && (
        <ConfirmDialog
          message={
            confirmTarget.status === 'active'
              ? `Disable access for ${confirmTarget.name}? They won't be able to log in until re-enabled.`
              : `Re-enable access for ${confirmTarget.name}?`
          }
          confirmLabel={confirmTarget.status === 'active' ? 'Disable' : 'Enable'}
          confirmColor={confirmTarget.status === 'active' ? T.red : T.green}
          onConfirm={handleToggleStatus}
          onCancel={() => !isTogglingStatus && setConfirmTarget(null)}
          isLoading={isTogglingStatus}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: T.text }}>User Access</div>
          <div style={{ fontSize: '11px', color: T.textSub, marginTop: '2px' }}>{users.length} user{users.length !== 1 ? 's' : ''} total</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ position: 'relative', width: '220px' }}>
            <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: T.gray400, pointerEvents: 'none' }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search users…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px 7px 30px', fontSize: '12px', fontFamily: FONT, borderRadius: '7px', border: `0.5px solid ${T.gray200}`, outline: 'none', color: T.text, background: T.white }}
            />
          </div>
          <button
            onClick={openAddModal}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 500, background: T.orange, color: T.white, border: 'none', cursor: 'pointer' }}
          >
            <Plus size={13} /> Grant Access
          </button>
        </div>
      </div>

      <div style={{ background: T.white, border: `0.5px solid ${T.gray200}`, borderRadius: '10px', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
            <Loader2 size={16} color={T.orange} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : error ? (
          <div style={{ padding: '40px', textAlign: 'center', color: T.red, fontSize: '12px' }}>{error}</div>
        ) : visibleUsers.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: T.gray400, fontSize: '12px' }}>{users.length === 0 ? 'No users yet.' : 'No users match your search.'}</div>
        ) : (
          visibleUsers.map((u, i) => (
            <div
              key={u.user_id}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
                borderBottom: i < visibleUsers.length - 1 ? `0.5px solid ${T.gray100}` : 'none',
                opacity: u.status === 'disabled' ? 0.55 : 1,
              }}
            >
              <div style={{
                width: '32px', height: '32px', borderRadius: '50%', background: T.gray100,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 700, color: T.gray600, flexShrink: 0,
              }}>
                {u.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: T.text }}>{u.name}</div>
                <div style={{ fontSize: '11px', color: T.gray600 }}>{u.email}</div>
              </div>

              <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                {u.roles.map(r => <RoleBadge key={r} role={r} />)}
              </div>

              <span style={{
                padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 500,
                background: u.status === 'active' ? T.greenBg : T.redBg,
                color: u.status === 'active' ? T.greenText : T.red,
                flexShrink: 0,
              }}>
                {u.status}
              </span>

              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button
                  onClick={() => openEditModal(u)}
                  style={{ padding: '5px 10px', fontSize: '11px', fontWeight: 500, background: T.white, border: `0.5px solid ${T.gray200}`, borderRadius: '6px', color: T.textSub, cursor: 'pointer' }}
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmTarget(u)}
                  title={u.status === 'active' ? 'Disable access' : 'Enable access'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '5px 10px', fontSize: '11px', fontWeight: 500, borderRadius: '6px', cursor: 'pointer',
                    background: u.status === 'active' ? T.redBg : T.greenBg,
                    color: u.status === 'active' ? T.red : T.greenText,
                    border: `0.5px solid ${u.status === 'active' ? '#FCA5A5' : '#6EE7B7'}`,
                  }}
                >
                  <Power size={11} /> {u.status === 'active' ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}