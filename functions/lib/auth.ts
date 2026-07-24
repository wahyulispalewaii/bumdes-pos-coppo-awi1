import type { AuthUser, Env } from './types';
import { HttpError } from './http';

const SESSION_COOKIE = 'bumdes_session';
const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string, iterations = 120000): Promise<string> {
  if (password.length < 4) throw new HttpError(422, 'Password minimal 4 karakter.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return `pbkdf2_sha256$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const [algorithm, iterationText, saltText, hashText] = encoded.split('$');
    if (algorithm !== 'pbkdf2_sha256') return false;
    const iterations = Number(iterationText);
    const salt = base64UrlToBytes(saltText);
    const expected = base64UrlToBytes(hashText);
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      key,
      expected.length * 8,
    );
    const actual = new Uint8Array(bits);
    if (actual.length !== expected.length) return false;
    let mismatch = 0;
    for (let index = 0; index < actual.length; index += 1) mismatch |= actual[index] ^ expected[index];
    return mismatch === 0;
  } catch {
    return false;
  }
}

export function parseCookies(request: Request): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = request.headers.get('Cookie') || '';
  for (const pair of header.split(';')) {
    const [rawKey, ...parts] = pair.trim().split('=');
    if (!rawKey) continue;
    cookies[decodeURIComponent(rawKey)] = decodeURIComponent(parts.join('='));
  }
  return cookies;
}

export async function getCurrentUser(env: Env, request: Request): Promise<AuthUser | null> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const result = await env.DB.prepare(`
    SELECT u.id, u.organization_id, u.username, u.full_name, u.email, u.phone,
           u.role, u.default_outlet_id, u.must_change_password
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
      AND u.is_active = 1
    LIMIT 1
  `).bind(tokenHash).first<AuthUser>();
  return result || null;
}

export async function createSession(env: Env, userId: string, ip: string, userAgent: string): Promise<{ token: string; expiresAt: string }> {
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(token);
  const hours = Math.min(Math.max(Number(env.SESSION_TTL_HOURS || 12), 1), 72);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO user_sessions (id, user_id, token_hash, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), userId, tokenHash, ip, userAgent.slice(0, 500), expiresAt).run();
  return { token, expiresAt };
}

export async function revokeSession(env: Env, request: Request): Promise<void> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ?').bind(tokenHash).run();
}

export function sessionCookie(token: string, expiresAt: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function assertRoles(user: AuthUser, roles: AuthUser['role'][]): void {
  if (!roles.includes(user.role)) throw new HttpError(403, 'Anda tidak memiliki hak akses untuk tindakan ini.');
}

export function canAccessAllOutlets(user: AuthUser): boolean {
  return ['ADMIN', 'MANAGER', 'FINANCE'].includes(user.role);
}

export async function assertOutletAccess(env: Env, user: AuthUser, outletId: string): Promise<void> {
  if (canAccessAllOutlets(user)) return;
  const access = await env.DB.prepare('SELECT 1 AS allowed FROM user_outlet_access WHERE user_id = ? AND outlet_id = ? LIMIT 1')
    .bind(user.id, outletId).first<{ allowed: number }>();
  if (!access) throw new HttpError(403, 'Anda tidak memiliki akses ke outlet tersebut.');
}
