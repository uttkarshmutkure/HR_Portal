// ── Admin: User Management ────────────────────────────────────────────────
// Talks to hr-dev-manage-users via the API Gateway. Every call is superuser-gated
// server-side using requester_email — the frontend's activeRole is never trusted.

const MANAGE_USERS_URL = import.meta.env.VITE_MANAGE_USERS_URL;

export type UserRole = 'hr' | 'interviewer' | 'user';

export interface AdminUser {
  user_id: string;
  email: string;
  name: string;
  roles: UserRole[];
  status: 'active' | 'disabled';
  source: string;
  granted_by: string | null;
  created_at: string | null;
  last_login_at: string | null;
}

async function callManageUsers(payload: Record<string, any>): Promise<any> {
  const res = await fetch(MANAGE_USERS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const listUsers = async (requesterEmail: string): Promise<AdminUser[]> => {
  const data = await callManageUsers({ type: 'LIST_USERS', requester_email: requesterEmail });
  return data.users as AdminUser[];
};

export const grantAccess = async (
  requesterEmail: string,
  email: string,
  name: string,
  roles: UserRole[]
): Promise<{ user_id: string; updated_existing: boolean }> => {
  const data = await callManageUsers({
    type: 'GRANT_ACCESS',
    requester_email: requesterEmail,
    email,
    name,
    roles,
  });
  return { user_id: data.user_id, updated_existing: data.updated_existing };
};

export const setUserStatus = async (
  requesterEmail: string,
  userId: string,
  status: 'active' | 'disabled'
): Promise<void> => {
  await callManageUsers({
    type: 'SET_STATUS',
    requester_email: requesterEmail,
    user_id: userId,
    status,
  });
};