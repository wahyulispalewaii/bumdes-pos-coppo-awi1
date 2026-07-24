import type { Env } from './types';
import { HttpError } from './http';

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createCloudinarySignature(env: Env, folder: string): Promise<Record<string, string | number>> {
  const cloudName = env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new HttpError(503, 'Cloudinary belum dikonfigurasi pada environment Cloudflare Pages.');
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const safeFolder = folder.replace(/[^a-zA-Z0-9_\/-]/g, '').slice(0, 120) || 'bumdes-pos';
  const params = `folder=${safeFolder}&timestamp=${timestamp}`;
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(params + apiSecret));
  return {
    cloudName,
    apiKey,
    timestamp,
    folder: safeFolder,
    signature: toHex(digest),
  };
}
