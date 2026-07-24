export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

export function ok(data: unknown = null, message = 'Berhasil'): Response {
  return json({ success: true, message, data });
}

export function fail(message: string, status = 400, details?: unknown): Response {
  return json({ success: false, message, details }, status);
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 1_000_000) throw new HttpError(413, 'Ukuran permintaan terlalu besar.');
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new HttpError(415, 'Content-Type harus application/json.');
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Format JSON tidak valid.');
  }
}

export function requireString(value: unknown, label: string, maxLength = 255): string {
  const result = String(value ?? '').trim();
  if (!result) throw new HttpError(422, `${label} wajib diisi.`);
  if (result.length > maxLength) throw new HttpError(422, `${label} maksimal ${maxLength} karakter.`);
  return result;
}

export function optionalString(value: unknown, maxLength = 1000): string | null {
  if (value === undefined || value === null || value === '') return null;
  const result = String(value).trim();
  if (result.length > maxLength) throw new HttpError(422, `Teks maksimal ${maxLength} karakter.`);
  return result || null;
}

export function requireNumber(value: unknown, label: string, min = 0): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min) throw new HttpError(422, `${label} tidak valid.`);
  return result;
}

export function integerMoney(value: unknown, label: string, min = 0): number {
  return Math.round(requireNumber(value, label, min));
}

export function getClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

export function dateRange(url: URL): { from: string; to: string } {
  const now = new Date();
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const today = local.toISOString().slice(0, 10);
  const from = url.searchParams.get('from') || today;
  const to = url.searchParams.get('to') || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new HttpError(422, 'Format tanggal harus YYYY-MM-DD.');
  }
  return { from, to };
}

export function pagination(url: URL, max = 200): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), max);
  const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);
  return { limit, offset };
}
