export const rupiah = (value = 0) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(Number(value) || 0);

export const number = (value = 0, digits = 0) => new Intl.NumberFormat('id-ID', {
  maximumFractionDigits: digits,
}).format(Number(value) || 0);

export const dateID = (value, options = {}) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', ...options,
  }).format(date);
};

export const dateTimeID = (value) => dateID(value, { hour: '2-digit', minute: '2-digit' });

export const today = () => {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};

export const monthStart = () => `${today().slice(0, 8)}01`;

export const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export const debounce = (fn, wait = 300) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

export const uuid = () => crypto.randomUUID();

export function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export function statusClass(status = '') {
  const normalized = String(status).toUpperCase();
  if (['COMPLETED', 'PAID', 'OPEN', 'RECEIVED', 'ACTIVE', 'REVIEWED'].includes(normalized)) return 'success';
  if (['VOIDED', 'FAILED', 'CANCELLED', 'INACTIVE'].includes(normalized)) return 'danger';
  if (['CLOSED', 'PENDING', 'DRAFT', 'CREDIT'].includes(normalized)) return 'warning';
  return 'neutral';
}

export function paymentLabel(method) {
  return ({ CASH: 'Tunai', QRIS: 'QRIS', TRANSFER: 'Transfer', EWALLET: 'E-Wallet', CREDIT: 'Piutang', OTHER: 'Lainnya' })[method] || method || '-';
}

export function roleLabel(role) {
  return ({ ADMIN: 'Administrator', MANAGER: 'Manajer', FINANCE: 'Keuangan', INVENTORY: 'Persediaan', CASHIER: 'Kasir', VIEWER: 'Pemantau' })[role] || role;
}

export function downloadCsv(filename, rows) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [headers.map(quote).join(','), ...rows.map((row) => headers.map((header) => quote(row[header])).join(','))].join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
