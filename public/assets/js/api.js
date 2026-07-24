export class ApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export async function api(path, options = {}) {
  const config = {
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json', ...(options.headers || {}) },
    ...options,
  };
  if (config.body && !(config.body instanceof FormData) && typeof config.body !== 'string') {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(config.body);
  }
  const response = await fetch(`/api/${path.replace(/^\//, '')}`, config);
  const type = response.headers.get('content-type') || '';
  let payload = null;
  if (type.includes('application/json')) payload = await response.json().catch(() => null);
  else payload = await response.text().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new ApiError(payload?.message || `Permintaan gagal (${response.status})`, response.status, payload?.details);
  }
  return payload?.data ?? payload;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body });
export const put = (path, body) => api(path, { method: 'PUT', body });
