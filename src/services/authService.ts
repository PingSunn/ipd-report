export type UserRole = 'NURSE' | 'WARD_HEAD';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: UserRole;
  status: UserStatus;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  profileComplete: boolean;
  suggestedFirstName: string | null;
  suggestedLastName: string | null;
}

export interface UserProfileInput {
  firstName: string;
  lastName: string;
  nickname: string;
}

export interface AuthSession {
  user: AuthUser;
}

export interface DirectoryUser extends AuthUser {
  createdAt: string;
  lastSeenAt: string | null;
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  invitedByName?: string | null;
}

export class AuthApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeRole(value: unknown): UserRole {
  const role = String(value ?? '').toUpperCase().replace(/[-\s]/g, '_');
  return role === 'WARD_HEAD' || role === 'WARDHEAD' || role === 'HEAD' ? 'WARD_HEAD' : 'NURSE';
}

function normalizeStatus(value: unknown): UserStatus {
  return String(value ?? '').toUpperCase() === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
}

function splitDisplayName(name: string): { firstName: string | null; lastName: string | null } {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

function userFrom(value: unknown): AuthUser | null {
  if (!isObject(value)) return null;
  const id = asString(value.id) ?? asString(value.userId);
  const email = asString(value.email);
  if (!id || !email) return null;
  const name = asString(value.name) ?? email;
  const firstName = asString(value.firstName);
  const lastName = asString(value.lastName);
  const nickname = asString(value.nickname);
  const suggested = splitDisplayName(name);
  return {
    id,
    email: email.toLowerCase(),
    name,
    image: asString(value.image) ?? asString(value.imageUrl),
    role: normalizeRole(value.role),
    status: typeof value.active === 'boolean' ? (value.active ? 'ACTIVE' : 'SUSPENDED') : normalizeStatus(value.status),
    firstName,
    lastName,
    nickname,
    profileComplete: typeof value.profileComplete === 'boolean' ? value.profileComplete : Boolean(firstName && lastName && nickname),
    suggestedFirstName: asString(value.suggestedFirstName) ?? suggested.firstName,
    suggestedLastName: asString(value.suggestedLastName) ?? suggested.lastName,
  };
}

function userFromResponse(value: unknown): AuthUser | null {
  if (!isObject(value)) return null;
  const data = isObject(value.data) ? value.data : value;
  const direct = userFrom(data.user);
  if (direct) return direct;
  const session = isObject(data.session) ? data.session : null;
  return userFrom(session?.user);
}

function errorText(value: unknown, fallback: string): { message: string; code?: string } {
  if (!isObject(value)) return { message: fallback };
  const message = asString(value.error) ?? asString(value.message) ?? fallback;
  const code = asString(value.code) ?? undefined;
  return { message, code };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const body = await readJson(response);
  if (!response.ok) {
    const error = errorText(body, response.status === 401 ? 'กรุณาเข้าสู่ระบบอีกครั้ง' : 'เกิดข้อผิดพลาดจากเซิร์ฟเวอร์');
    throw new AuthApiError(error.message, response.status, error.code);
  }
  return body;
}

export async function getSession(): Promise<AuthSession | null> {
  let response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 404) {
    response = await fetch('/api/auth/get-session', { credentials: 'same-origin', cache: 'no-store' });
  }
  if (response.status === 401 || response.status === 204) return null;
  const body = await readJson(response);
  if (!response.ok) {
    const error = errorText(body, 'ไม่สามารถตรวจสอบ session ได้');
    throw new AuthApiError(error.message, response.status, error.code);
  }
  const user = userFromResponse(body);
  return user ? { user } : null;
}

export async function signInWithGoogle(callbackUrl: string): Promise<void> {
  const body = await requestJson('/api/auth/sign-in/social', {
    method: 'POST',
    body: JSON.stringify({ provider: 'google', callbackURL: callbackUrl }),
  });
  const redirectUrl = isObject(body) ? asString(body.url) ?? asString(body.redirectUrl) : null;
  if (redirectUrl) window.location.assign(redirectUrl);
  else window.location.assign(callbackUrl);
}

export async function signOut(): Promise<void> {
  await requestJson('/api/auth/sign-out', { method: 'POST', body: '{}' });
}

export async function updateCurrentProfile(profile: UserProfileInput): Promise<void> {
  const body = await requestJson('/api/profile', { method: 'PATCH', body: JSON.stringify(profile) });
  const data = isObject(body) && isObject(body.profile) ? body.profile : null;
  const firstName = asString(data?.firstName);
  const lastName = asString(data?.lastName);
  const nickname = asString(data?.nickname);
  if (!firstName || !lastName || !nickname) throw new AuthApiError('เซิร์ฟเวอร์ส่งข้อมูลโปรไฟล์ไม่ครบถ้วน', 500);
}

function arrayFrom<T>(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (isObject(value) && Array.isArray(value[key])) return value[key];
  if (isObject(value) && isObject(value.data) && Array.isArray(value.data[key])) return value.data[key];
  return [];
}

function directoryUser(value: unknown): DirectoryUser | null {
  const user = userFrom(value);
  if (!user || !isObject(value)) return null;
  return {
    ...user,
    createdAt: asString(value.createdAt) ?? new Date(0).toISOString(),
    lastSeenAt: asString(value.lastSeenAt) ?? asString(value.lastLoginAt),
  };
}

function invitation(value: unknown): InvitationSummary | null {
  if (!isObject(value)) return null;
  const id = asString(value.id);
  const email = asString(value.email);
  const expiresAt = asString(value.expiresAt);
  if (!id || !email || !expiresAt) return null;
  const status = String(value.status ?? (value.acceptedAt ? 'ACCEPTED' : value.revokedAt ? 'REVOKED' : new Date(expiresAt).getTime() <= Date.now() ? 'EXPIRED' : 'PENDING')).toUpperCase();
  const safeStatus: InvitationStatus = status === 'ACCEPTED' || status === 'EXPIRED' || status === 'REVOKED' ? status : 'PENDING';
  return {
    id,
    email: email.toLowerCase(),
    role: normalizeRole(value.role),
    status: safeStatus,
    expiresAt,
    createdAt: asString(value.createdAt) ?? new Date(0).toISOString(),
    invitedByName: asString(value.invitedByName),
  };
}

export async function getDirectory(): Promise<{ users: DirectoryUser[]; invitations: InvitationSummary[] }> {
  const [usersBody, invitationsBody] = await Promise.all([
    requestJson('/api/users'),
    requestJson('/api/invitations'),
  ]);
  return {
    users: arrayFrom(usersBody, 'users').map(directoryUser).filter((value): value is DirectoryUser => value !== null),
    invitations: arrayFrom(invitationsBody, 'invitations').map(invitation).filter((value): value is InvitationSummary => value !== null),
  };
}

export async function inviteUser(email: string, role: UserRole): Promise<void> {
  await requestJson('/api/invitations', { method: 'POST', body: JSON.stringify({ email, role: role === 'WARD_HEAD' ? 'ward_head' : 'nurse' }) });
}

export async function revokeInvitation(id: string): Promise<void> {
  await requestJson(`/api/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function reinviteUser(id: string): Promise<void> {
  await requestJson(`/api/invitations/${encodeURIComponent(id)}`, { method: 'POST', body: '{}' });
}

export async function updateUser(id: string, update: { role?: UserRole; status?: UserStatus }): Promise<void> {
  const payload: { role?: 'nurse' | 'ward_head'; active?: boolean } = {};
  if (update.role) payload.role = update.role === 'WARD_HEAD' ? 'ward_head' : 'nurse';
  if (update.status) payload.active = update.status === 'ACTIVE';
  await requestJson(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
