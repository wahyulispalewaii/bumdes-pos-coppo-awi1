import { ApiError, get, post, put } from './api.js';
import { dateID, dateTimeID, debounce, downloadCsv, escapeHtml, formObject, monthStart, number, paymentLabel, roleLabel, rupiah, statusClass, today, uuid } from './utils.js';

const state = {
  user: null,
  organization: null,
  outlets: [],
  categories: [],
  units: [],
  expenseCategories: [],
  suppliers: [],
  cloudinaryEnabled: false,
  currentOutletId: null,
  currentShift: null,
  currentView: 'dashboard',
  cart: [],
  posProducts: [],
  posCategory: '',
  posSearch: '',
};

const el = {
  loginScreen: document.querySelector('#login-screen'),
  appShell: document.querySelector('#app-shell'),
  loginForm: document.querySelector('#login-form'),
  loginButton: document.querySelector('#login-button'),
  sidebar: document.querySelector('#sidebar'),
  sidebarNav: document.querySelector('#sidebar-nav'),
  content: document.querySelector('#page-content'),
  title: document.querySelector('#page-title'),
  subtitle: document.querySelector('#page-subtitle'),
  outletSelect: document.querySelector('#global-outlet-select'),
  shiftBadge: document.querySelector('#shift-badge'),
  modalRoot: document.querySelector('#modal-root'),
  toastRoot: document.querySelector('#toast-root'),
};

const NAV = [
  { section: 'Utama' },
  { id: 'dashboard', label: 'Dashboard', icon: '⌂', roles: ['ADMIN','MANAGER','FINANCE','INVENTORY','CASHIER','VIEWER'] },
  { id: 'pos', label: 'Kasir', icon: '🛒', roles: ['ADMIN','MANAGER','CASHIER'] },
  { id: 'transactions', label: 'Transaksi', icon: '▤', roles: ['ADMIN','MANAGER','FINANCE','CASHIER','VIEWER'] },
  { section: 'Persediaan' },
  { id: 'products', label: 'Produk', icon: '▦', roles: ['ADMIN','MANAGER','INVENTORY','VIEWER'] },
  { id: 'inventory', label: 'Stok', icon: '◫', roles: ['ADMIN','MANAGER','INVENTORY','VIEWER'] },
  { id: 'purchases', label: 'Pembelian', icon: '🚚', roles: ['ADMIN','MANAGER','INVENTORY','FINANCE'] },
  { section: 'Kas dan Keuangan' },
  { id: 'shifts', label: 'Shift Kasir', icon: '◷', roles: ['ADMIN','MANAGER','FINANCE','CASHIER'] },
  { id: 'expenses', label: 'Pengeluaran', icon: '↘', roles: ['ADMIN','MANAGER','FINANCE','CASHIER'] },
  { id: 'reports', label: 'Laporan', icon: '▥', roles: ['ADMIN','MANAGER','FINANCE','INVENTORY','VIEWER'] },
  { section: 'Administrasi' },
  { id: 'users', label: 'Pengguna', icon: '♙', roles: ['ADMIN','MANAGER'] },
  { id: 'audit', label: 'Audit Log', icon: '◎', roles: ['ADMIN','MANAGER'] },
  { id: 'settings', label: 'Pengaturan', icon: '⚙', roles: ['ADMIN','MANAGER'] },
];

const VIEW_META = {
  dashboard: ['Dashboard', 'Ringkasan operasional dan performa usaha'],
  pos: ['Kasir', 'Transaksi penjualan cepat dan terkontrol'],
  transactions: ['Transaksi', 'Riwayat penjualan dan pembatalan transaksi'],
  products: ['Data Produk', 'Kelola katalog, harga, dan kategori produk'],
  inventory: ['Persediaan', 'Pantau stok dan rekam penyesuaian persediaan'],
  purchases: ['Pembelian', 'Penerimaan barang dari pemasok dan penambahan stok'],
  shifts: ['Shift Kasir', 'Rekonsiliasi kas awal, kas aktual, dan selisih'],
  expenses: ['Pengeluaran', 'Pencatatan biaya operasional BUMDes'],
  reports: ['Laporan', 'Analisis omzet, laba kotor, pembayaran, dan persediaan'],
  users: ['Pengguna', 'Kelola akun, peran, dan akses aplikasi'],
  audit: ['Audit Log', 'Jejak aktivitas penting dan perubahan data'],
  settings: ['Pengaturan', 'Identitas BUMDes dan konfigurasi branding'],
};

function toast(message, type = 'success', title = '') {
  const node = document.createElement('div');
  const presentation = {
    success: { icon: '✓', title: 'Berhasil' },
    warning: { icon: '!', title: 'Peringatan' },
    error: { icon: '⚠', title: 'Terjadi kesalahan' },
    info: { icon: 'i', title: 'Informasi' },
  }[type] || { icon: 'i', title: 'Informasi' };

  node.className = `toast ${type}`;
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  node.innerHTML = `
    <div>${presentation.icon}</div>
    <div>
      <strong>${escapeHtml(title || presentation.title)}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;

  el.toastRoot.append(node);
  setTimeout(() => node.remove(), 4200);
}

function loading() {
  el.content.innerHTML = '<div class="loading-state"><span class="spinner"></span><p>Memuat data...</p></div>';
}

function emptyState(title, text, icon = '◇') {
  return `<div class="empty-state"><div><div class="empty-icon">${icon}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div></div>`;
}

function setButtonLoading(button, isLoading, loadingText = 'Memproses...') {
  if (!button) return;
  if (isLoading) {
    button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="inline-spinner"></span>${loadingText}`;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.original || button.innerHTML;
  }
}

function modal({ title, subtitle = '', body = '', size = '', footer = '' }) {
  el.modalRoot.innerHTML = `
    <div class="modal-backdrop" data-modal-close="backdrop">
      <section class="modal ${size}" role="dialog" aria-modal="true">
        <header class="modal-header">
          <div><h3>${escapeHtml(title)}</h3>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>
          <button class="icon-button" data-modal-close="button" aria-label="Tutup">×</button>
        </header>
        <div class="modal-body">${body}</div>
        ${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}
      </section>
    </div>`;
  const backdrop = el.modalRoot.querySelector('.modal-backdrop');
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target.closest('[data-modal-close="button"]')) closeModal();
  });
  document.addEventListener('keydown', onEscapeModal, { once: true });
  return el.modalRoot.querySelector('.modal');
}

function onEscapeModal(event) { if (event.key === 'Escape') closeModal(); }
function closeModal() { el.modalRoot.innerHTML = ''; }

function confirmDialog(title, message, confirmText = 'Konfirmasi', danger = false) {
  return new Promise((resolve) => {
    modal({
      title,
      body: `<div class="alert ${danger ? 'danger' : 'warning'}">${escapeHtml(message)}</div>`,
      footer: `<button class="button outline" data-cancel>Batal</button><button class="button ${danger ? 'danger' : 'primary'}" data-confirm>${escapeHtml(confirmText)}</button>`,
    });
    el.modalRoot.querySelector('[data-cancel]').onclick = () => { closeModal(); resolve(false); };
    el.modalRoot.querySelector('[data-confirm]').onclick = () => { closeModal(); resolve(true); };
  });
}

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== '' && value !== undefined && value !== null) search.set(key, value);
  return search.toString();
}

function roleCan(...roles) { return roles.includes(state.user?.role); }
function outletId() { return state.currentOutletId || state.user?.default_outlet_id || state.outlets[0]?.id; }

async function loadBootstrap() {
  const data = await get('bootstrap');
  state.user = data.user;
  state.organization = data.organization;
  state.outlets = data.outlets || [];
  state.categories = data.categories || [];
  state.units = data.units || [];
  state.expenseCategories = data.expense_categories || [];
  state.suppliers = data.suppliers || [];
  state.currentShift = data.current_shift || null;
  state.cloudinaryEnabled = data.cloudinary_enabled;
  state.currentOutletId = state.currentOutletId || state.user.default_outlet_id || state.outlets[0]?.id;
  updateShell();
}

function updateShell() {
  const org = state.organization || {};
  document.querySelector('#sidebar-org-name').textContent = org.name || 'BUMDes Coppo Awi';
  const logo = org.logo_url || '/assets/img/logo-bumdes-small.webp';
  document.querySelector('#sidebar-logo').src = logo;
  document.querySelector('#current-user-name').textContent = state.user.full_name;
  document.querySelector('#current-user-role').textContent = roleLabel(state.user.role).toUpperCase();
  document.querySelector('#user-avatar').textContent = state.user.full_name.trim().charAt(0).toUpperCase();
  el.outletSelect.innerHTML = state.outlets.map((outlet) => `<option value="${escapeHtml(outlet.id)}" ${outlet.id === state.currentOutletId ? 'selected' : ''}>${escapeHtml(outlet.name)}</option>`).join('');
  renderNav();
  updateShiftBadge();
}

function renderNav() {
  let html = '';
  let sectionHasVisible = false;
  for (let index = 0; index < NAV.length; index += 1) {
    const item = NAV[index];
    if (item.section) {
      sectionHasVisible = NAV.slice(index + 1).find((next) => next.section || next.roles?.includes(state.user.role))?.roles?.includes(state.user.role);
      if (sectionHasVisible) html += `<div class="nav-section-title">${escapeHtml(item.section)}</div>`;
      continue;
    }
    if (!item.roles.includes(state.user.role)) continue;
    html += `<button class="nav-item ${item.id === state.currentView ? 'active' : ''}" data-nav="${item.id}"><span class="nav-icon">${item.icon}</span><span>${escapeHtml(item.label)}</span></button>`;
  }
  el.sidebarNav.innerHTML = html;
  el.sidebarNav.querySelectorAll('[data-nav]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.nav)));
}

function updateShiftBadge() {
  if (state.currentShift) {
    el.shiftBadge.className = 'status-chip success';
    el.shiftBadge.textContent = `Shift aktif · ${state.currentShift.outlet_name}`;
  } else {
    el.shiftBadge.className = 'status-chip neutral';
    el.shiftBadge.textContent = 'Shift belum dibuka';
  }
}

async function showApp() {
  el.loginScreen.classList.add('hidden');
  el.appShell.classList.remove('hidden');
  await loadBootstrap();
  await navigate(state.currentView, false);
  if (state.user.must_change_password) setTimeout(openChangePassword, 500);
}

function showLogin({ clearForm = false } = {}) {
  el.appShell.classList.add('hidden');
  el.loginScreen.classList.remove('hidden');

  state.user = null;
  state.currentShift = null;
  state.cart = [];
  state.posProducts = [];

  if (clearForm) el.loginForm.reset();
  window.setTimeout(() => document.querySelector('#login-username')?.focus(), 0);
}

async function navigate(view, refreshNav = true) {
  const allowed = NAV.find((item) => item.id === view)?.roles?.includes(state.user.role);
  if (!allowed) view = 'dashboard';
  state.currentView = view;
  const [title, subtitle] = VIEW_META[view];
  el.title.textContent = title;
  el.subtitle.textContent = subtitle;
  if (refreshNav) renderNav();
  el.sidebar.classList.remove('open');
  loading();
  try {
    const renderer = {
      dashboard: renderDashboard,
      pos: renderPos,
      transactions: renderTransactions,
      products: renderProducts,
      inventory: renderInventory,
      purchases: renderPurchases,
      shifts: renderShifts,
      expenses: renderExpenses,
      reports: renderReports,
      users: renderUsers,
      audit: renderAudit,
      settings: renderSettings,
    }[view];
    await renderer();
  } catch (error) {
    handleError(error);
    el.content.innerHTML = `<div class="alert danger">${escapeHtml(error.message || 'Gagal memuat halaman.')}</div>`;
  }
}

function handleError(error, options = {}) {
  const { authAction = false, title = '' } = options;
  const message = error?.message || 'Terjadi kesalahan tidak dikenal.';

  if (error instanceof ApiError) {
    if (error.status === 401) {
      if (authAction) {
        toast(message, 'error', title || 'Autentikasi gagal');
      } else {
        showLogin();
        toast(
          'Sesi Anda tidak valid atau telah berakhir. Silakan masuk kembali.',
          'warning',
          'Sesi berakhir',
        );
      }
      return;
    }

    if (error.status === 423) {
      toast(message, 'warning', title || 'Akun terkunci');
      return;
    }

    if (error.status === 403) {
      toast(message, 'warning', title || 'Akses ditolak');
      return;
    }

    if (error.status === 422 || error.status === 400 || error.status === 409) {
      toast(message, 'warning', title || 'Periksa kembali data');
      return;
    }

    if (error.status === 429) {
      toast(message, 'warning', title || 'Terlalu banyak permintaan');
      return;
    }
  }

  if (!navigator.onLine) {
    toast(
      'Periksa koneksi internet Anda, lalu ulangi permintaan.',
      'warning',
      'Koneksi terputus',
    );
    return;
  }

  toast(message, 'error', title);
}

function metricCard(label, value, foot, icon, tone = '') {
  return `<article class="card metric-card ${tone}"><div class="metric-icon">${icon}</div><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${value}</div><div class="metric-foot">${escapeHtml(foot)}</div></article>`;
}

function barChart(rows, key = 'total') {
  if (!rows?.length) return emptyState('Belum ada data', 'Grafik akan muncul setelah terdapat transaksi.', '▥');
  const max = Math.max(...rows.map((row) => Number(row[key] || 0)), 1);
  return `<div class="chart-bars">${rows.map((row) => {
    const height = Math.max(3, Math.round((Number(row[key] || 0) / max) * 150));
    return `<div class="chart-bar-item"><div class="chart-bar" style="height:${height}px" data-value="${escapeHtml(rupiah(row[key]))}"></div><div class="chart-label">${escapeHtml(String(row.date || '').slice(5))}</div></div>`;
  }).join('')}</div>`;
}

async function renderDashboard() {
  const from = monthStart();
  const to = today();
  el.content.innerHTML = `
    <div class="page-toolbar">
      <div class="toolbar-group">
        <label class="toolbar-field"><span>Dari tanggal</span><input id="dash-from" type="date" value="${from}"></label>
        <label class="toolbar-field"><span>Sampai tanggal</span><input id="dash-to" type="date" value="${to}"></label>
        <button id="dash-filter" class="button secondary compact">Terapkan</button>
      </div>
      <button id="dash-refresh" class="button outline compact">↻ Muat ulang</button>
    </div>
    <div id="dashboard-data"><div class="loading-state"><span class="spinner"></span><p>Menyiapkan dashboard...</p></div></div>`;
  const load = async () => {
    const container = document.querySelector('#dashboard-data');
    container.innerHTML = '<div class="loading-state"><span class="spinner"></span><p>Memuat ringkasan...</p></div>';
    const data = await get(`dashboard?${query({ outlet_id: outletId(), from: document.querySelector('#dash-from').value, to: document.querySelector('#dash-to').value })}`);
    const m = data.metrics;
    const topMax = Math.max(...(data.top_products || []).map((row) => Number(row.quantity || 0)), 1);
    container.innerHTML = `
      <div class="grid metrics">
        ${metricCard('Omzet', rupiah(m.sales_total), `${number(m.transactions_count)} transaksi`, 'Rp')}
        ${metricCard('Laba kotor', rupiah(m.gross_profit), `Setelah HPP, sebelum biaya`, '↗', 'info')}
        ${metricCard('Pengeluaran', rupiah(m.expenses_total), `Biaya operasional periode ini`, '↘', 'warning')}
        ${metricCard('Stok minimum', number(m.low_stock_count), m.low_stock_count ? 'Perlu segera diperiksa' : 'Persediaan dalam kondisi aman', '!', m.low_stock_count ? 'danger' : '')}
      </div>
      <div class="grid two" style="margin-top:18px">
        <article class="card"><header class="card-header"><div><h3>Tren Penjualan</h3><p>Omzet harian pada periode terpilih</p></div><span class="badge">${escapeHtml(data.range.from)} s.d. ${escapeHtml(data.range.to)}</span></header><div class="card-body">${barChart(data.daily_sales)}</div></article>
        <article class="card"><header class="card-header"><div><h3>Produk Terlaris</h3><p>Berdasarkan kuantitas produk terjual</p></div></header><div class="card-body">
          ${(data.top_products || []).length ? `<div class="progress-list">${data.top_products.map((row) => `<div class="progress-row"><strong>${escapeHtml(row.name)}</strong><div class="progress-track"><div class="progress-fill" style="width:${Math.max(4, Number(row.quantity || 0) / topMax * 100)}%"></div></div><span>${number(row.quantity,2)}</span></div>`).join('')}</div>` : emptyState('Belum ada penjualan', 'Produk terlaris akan tampil setelah transaksi tercatat.', '▦')}
        </div></article>
      </div>
      <div class="grid two" style="margin-top:18px">
        <article class="card"><header class="card-header"><div><h3>Komposisi Pembayaran</h3><p>Tunai dan non-tunai</p></div></header><div class="card-body"><div class="kv-list">
          <div class="kv-row"><span>Tunai</span><strong>${rupiah(m.cash_total)}</strong></div>
          <div class="kv-row"><span>Non-tunai</span><strong>${rupiah(m.noncash_total)}</strong></div>
          <div class="kv-row"><span>Rata-rata transaksi</span><strong>${rupiah(m.average_transaction)}</strong></div>
          <div class="kv-row"><span>Hasil operasional sementara</span><strong class="${m.net_operating < 0 ? 'text-danger' : 'text-success'}">${rupiah(m.net_operating)}</strong></div>
        </div></div></article>
        <article class="card"><header class="card-header"><div><h3>Transaksi Terbaru</h3><p>Aktivitas penjualan terakhir pada outlet</p></div><button class="button ghost compact" data-go-transactions>Lihat semua</button></header><div class="table-wrap">
          ${(data.recent_sales || []).length ? `<table class="data-table"><thead><tr><th>Nomor</th><th>Kasir</th><th>Waktu</th><th class="align-right">Total</th></tr></thead><tbody>${data.recent_sales.map((row) => `<tr><td class="table-title">${escapeHtml(row.transaction_number)}</td><td>${escapeHtml(row.cashier_name)}</td><td>${dateTimeID(row.completed_at)}</td><td class="money align-right">${rupiah(row.grand_total)}</td></tr>`).join('')}</tbody></table>` : emptyState('Belum ada transaksi', 'Transaksi terbaru akan tampil di sini.', '▤')}
        </div></article>
      </div>`;
    container.querySelector('[data-go-transactions]')?.addEventListener('click', () => navigate('transactions'));
  };
  document.querySelector('#dash-filter').onclick = () => load().catch(handleError);
  document.querySelector('#dash-refresh').onclick = () => load().catch(handleError);
  await load();
}

function cartSubtotal() { return state.cart.reduce((sum, item) => sum + Math.round(item.selling_price * item.quantity), 0); }
function cartCount() { return state.cart.reduce((sum, item) => sum + item.quantity, 0); }

function renderCartHtml() {
  if (!state.cart.length) return `${emptyState('Keranjang kosong', 'Pilih produk untuk memulai transaksi.', '🛒')}<div class="cart-summary"><div class="summary-row total"><span>Total</span><strong>${rupiah(0)}</strong></div></div><div class="cart-actions"><button class="button primary full" disabled>Bayar</button></div>`;
  return `<div class="cart-items">${state.cart.map((item) => `
    <div class="cart-item" data-cart-id="${item.id}">
      <div><div class="cart-item-name">${escapeHtml(item.name)}</div><div class="cart-item-price">${rupiah(item.selling_price)} / ${escapeHtml(item.unit_name)}</div>
        <div class="qty-control"><button data-cart-minus>−</button><span>${number(item.quantity,2)}</span><button data-cart-plus>+</button></div>
      </div>
      <div><div class="cart-item-total">${rupiah(item.selling_price * item.quantity)}</div><button class="cart-remove" data-cart-remove>Hapus</button></div>
    </div>`).join('')}</div>
    <div class="cart-summary"><div class="summary-row"><span>${number(cartCount(),2)} item</span><strong>${rupiah(cartSubtotal())}</strong></div><div class="summary-row total"><span>Total</span><strong>${rupiah(cartSubtotal())}</strong></div></div>
    <div class="cart-actions"><button id="pay-cart" class="button primary full">Bayar ${rupiah(cartSubtotal())}</button><button id="clear-cart" class="button outline full">Kosongkan keranjang</button></div>`;
}

function bindCartEvents() {
  document.querySelectorAll('[data-cart-id]').forEach((row) => {
    const item = state.cart.find((entry) => entry.id === row.dataset.cartId);
    row.querySelector('[data-cart-minus]').onclick = () => { item.quantity -= 1; if (item.quantity <= 0) state.cart = state.cart.filter((x) => x.id !== item.id); refreshCart(); };
    row.querySelector('[data-cart-plus]').onclick = () => {
      if (item.track_stock && item.quantity + 1 > item.stock_quantity) return toast('Jumlah melebihi stok yang tersedia.', 'warning');
      item.quantity += 1; refreshCart();
    };
    row.querySelector('[data-cart-remove]').onclick = () => { state.cart = state.cart.filter((x) => x.id !== item.id); refreshCart(); };
  });
  document.querySelector('#pay-cart')?.addEventListener('click', openPaymentModal);
  document.querySelector('#clear-cart')?.addEventListener('click', async () => { if (await confirmDialog('Kosongkan keranjang?', 'Seluruh produk dalam keranjang akan dihapus.', 'Kosongkan', true)) { state.cart = []; refreshCart(); } });
}

function refreshCart() {
  const container = document.querySelector('#cart-content');
  if (!container) return;
  container.innerHTML = renderCartHtml();
  document.querySelector('#cart-count').textContent = `${number(cartCount(),2)} item`;
  bindCartEvents();
}

function renderProductCards() {
  const container = document.querySelector('#pos-product-grid');
  if (!container) return;
  const search = state.posSearch.toLowerCase();
  const products = state.posProducts.filter((product) => (!state.posCategory || product.category_id === state.posCategory) && (!search || product.name.toLowerCase().includes(search) || product.sku.toLowerCase().includes(search) || String(product.barcode || '').includes(search)));
  container.innerHTML = products.length ? products.map((product) => {
    const noStock = Number(product.track_stock) === 1 && Number(product.stock_quantity) <= 0;
    const low = Number(product.track_stock) === 1 && Number(product.stock_quantity) <= Number(product.minimum_stock);
    const initial = escapeHtml(product.name.charAt(0).toUpperCase());
    return `<button class="product-card" data-product-id="${product.id}" ${noStock ? 'disabled' : ''}>
      <div class="product-image">${product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="">` : initial}</div>
      <div class="product-name">${escapeHtml(product.name)}</div>
      <div class="product-meta"><span class="product-price">${rupiah(product.selling_price)}</span><span class="product-stock ${low ? 'low' : ''}">${Number(product.track_stock) === 1 ? `Stok ${number(product.stock_quantity,2)}` : 'Jasa'}</span></div>
    </button>`;
  }).join('') : emptyState('Produk tidak ditemukan', 'Coba gunakan kata kunci atau kategori lain.', '⌕');
  container.querySelectorAll('[data-product-id]').forEach((button) => button.addEventListener('click', () => addToCart(button.dataset.productId)));
}

function addToCart(productId) {
  const product = state.posProducts.find((entry) => entry.id === productId);
  if (!product) return;
  const existing = state.cart.find((item) => item.id === productId);
  if (existing) {
    if (Number(product.track_stock) === 1 && existing.quantity + 1 > Number(product.stock_quantity)) return toast('Stok produk tidak mencukupi.', 'warning');
    existing.quantity += 1;
  } else {
    state.cart.push({ ...product, quantity: 1, track_stock: Number(product.track_stock) === 1, stock_quantity: Number(product.stock_quantity) });
  }
  refreshCart();
}

async function renderPos() {
  if (!state.currentShift) {
    el.content.innerHTML = `<div class="alert warning">Shift kasir belum dibuka. Transaksi penjualan hanya dapat diproses dalam shift aktif.</div><div style="margin-top:14px"><button id="open-shift-from-pos" class="button primary">Buka Shift Sekarang</button></div>`;
    document.querySelector('#open-shift-from-pos').onclick = openShiftModal;
    return;
  }
  el.content.innerHTML = `
    <div class="pos-layout">
      <section class="pos-products">
        <div class="page-toolbar" style="margin-bottom:0"><div class="search-box"><input id="pos-search" placeholder="Cari nama, SKU, atau scan barcode" autocomplete="off"></div><span class="status-chip success">${escapeHtml(state.currentShift.outlet_name)}</span></div>
        <div id="pos-categories" class="pos-category-row"><button class="category-pill active" data-category="">Semua</button>${state.categories.map((category) => `<button class="category-pill" data-category="${category.id}">${escapeHtml(category.name)}</button>`).join('')}</div>
        <div id="pos-product-grid" class="product-grid"><div class="loading-state"><span class="spinner"></span></div></div>
      </section>
      <aside class="card cart-panel"><div class="cart-header"><h3>Keranjang</h3><span id="cart-count" class="badge">${number(cartCount(),2)} item</span></div><div id="cart-content">${renderCartHtml()}</div></aside>
    </div>`;
  state.posProducts = (await get(`products?${query({ outlet_id: outletId(), limit: 500 })}`)).products;
  state.posCategory = '';
  state.posSearch = '';
  renderProductCards();
  bindCartEvents();
  document.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
    state.posCategory = button.dataset.category;
    document.querySelectorAll('[data-category]').forEach((node) => node.classList.toggle('active', node === button));
    renderProductCards();
  }));
  document.querySelector('#pos-search').addEventListener('input', debounce((event) => { state.posSearch = event.target.value; renderProductCards(); }, 160));
}

function openPaymentModal() {
  if (!state.cart.length) return;
  const total = cartSubtotal();
  modal({
    title: 'Pembayaran', subtitle: 'Pilih metode dan konfirmasi penerimaan pembayaran',
    body: `<div class="payment-total"><span>Total yang harus dibayar</span><strong>${rupiah(total)}</strong></div>
      <div class="payment-grid">${[['CASH','Tunai','💵'],['QRIS','QRIS','▦'],['TRANSFER','Transfer','⇄'],['EWALLET','E-Wallet','▣'],['CREDIT','Piutang','◴'],['OTHER','Lainnya','＋']].map(([id,label,icon]) => `<button class="payment-option ${id === 'CASH' ? 'active' : ''}" data-payment="${id}"><div style="font-size:23px;margin-bottom:6px">${icon}</div>${label}</button>`).join('')}</div>
      <form id="payment-form" class="form-grid">
        <input type="hidden" name="payment_method" value="CASH">
        <label class="field"><span>Uang diterima / nominal</span><input name="tendered_amount" type="number" min="0" step="1" value="${total}" required></label>
        <label class="field"><span>Nomor referensi</span><input name="reference_number" placeholder="Opsional untuk non-tunai" disabled></label>
        <label class="field span-2"><span>Nama pelanggan</span><input name="customer_name" value="Pelanggan Umum" maxlength="180"></label>
        <label class="field span-2"><span>Catatan transaksi</span><textarea name="notes" placeholder="Opsional"></textarea></label>
        <div class="span-2"><div class="quick-cash">${[total, Math.ceil(total/10000)*10000, Math.ceil(total/50000)*50000, Math.ceil(total/100000)*100000].filter((v,i,a) => a.indexOf(v) === i).map((amount) => `<button type="button" data-quick-cash="${amount}">${rupiah(amount)}</button>`).join('')}</div></div>
        <div class="span-2 alert info" id="payment-change">Kembalian: <strong>${rupiah(0)}</strong></div>
      </form>`,
    footer: `<button class="button outline" data-modal-close="button">Batal</button><button id="confirm-payment" class="button primary">Simpan Transaksi</button>`,
  });
  const form = document.querySelector('#payment-form');
  const tendered = form.elements.tendered_amount;
  const reference = form.elements.reference_number;
  const updateChange = () => {
    const method = form.elements.payment_method.value;
    const change = method === 'CASH' ? Math.max(0, Number(tendered.value || 0) - total) : 0;
    document.querySelector('#payment-change').innerHTML = `${method === 'CASH' ? 'Kembalian' : 'Nominal pembayaran'}: <strong>${rupiah(method === 'CASH' ? change : total)}</strong>`;
  };
  document.querySelectorAll('[data-payment]').forEach((button) => button.onclick = () => {
    document.querySelectorAll('[data-payment]').forEach((node) => node.classList.toggle('active', node === button));
    form.elements.payment_method.value = button.dataset.payment;
    const isCash = button.dataset.payment === 'CASH';
    tendered.value = total;
    reference.disabled = isCash;
    reference.required = !isCash && button.dataset.payment !== 'OTHER';
    updateChange();
  });
  document.querySelectorAll('[data-quick-cash]').forEach((button) => button.onclick = () => { tendered.value = button.dataset.quickCash; updateChange(); });
  tendered.addEventListener('input', updateChange);
  document.querySelector('#confirm-payment').onclick = async (event) => {
    const button = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = formObject(form);
    const method = values.payment_method;
    const received = Number(values.tendered_amount || 0);
    if (method === 'CASH' && received < total) return toast('Uang diterima masih kurang.', 'warning');
    setButtonLoading(button, true, 'Menyimpan...');
    try {
      const result = await post('sales', {
        outlet_id: outletId(), idempotency_key: uuid(), customer_name: values.customer_name,
        notes: values.notes, discount_total: 0, tax_total: 0,
        items: state.cart.map((item) => ({ product_id: item.id, quantity: item.quantity })),
        payments: [{ payment_method: method, amount: total, tendered_amount: method === 'CASH' ? received : total, reference_number: values.reference_number }],
      });
      const receiptCart = state.cart.map((item) => ({ ...item }));
      state.cart = [];
      closeModal();
      toast(`Transaksi ${result.transaction_number} berhasil disimpan.`);
      await showReceipt(result, receiptCart, method, received);
      await renderPos();
    } catch (error) { handleError(error); setButtonLoading(button, false); }
  };
}

async function showReceipt(result, items, method, tendered) {
  const org = state.organization;
  const total = result.grand_total;
  modal({
    title: 'Transaksi Berhasil', subtitle: result.transaction_number, size: '',
    body: `<div id="receipt-area" class="receipt">
      <img class="receipt-logo" src="${escapeHtml(org.logo_url || '/assets/img/logo-bumdes.webp')}" alt="Logo">
      <div class="receipt-center"><strong>${escapeHtml(org.name)}</strong><br>${escapeHtml(org.address || '')}<br>${escapeHtml(org.phone || '')}</div>
      <hr class="receipt-rule"><div class="receipt-row"><span>No.</span><strong>${escapeHtml(result.transaction_number)}</strong></div><div class="receipt-row"><span>Kasir</span><span>${escapeHtml(state.user.full_name)}</span></div><div class="receipt-row"><span>Waktu</span><span>${escapeHtml(new Date().toLocaleString('id-ID'))}</span></div>
      <hr class="receipt-rule"><div class="receipt-items">${items.map((item) => `<div><div>${escapeHtml(item.name)}</div><div class="receipt-row"><span>${number(item.quantity,2)} × ${rupiah(item.selling_price)}</span><span>${rupiah(item.quantity * item.selling_price)}</span></div></div>`).join('')}</div>
      <hr class="receipt-rule"><div class="receipt-row"><strong>TOTAL</strong><strong>${rupiah(total)}</strong></div><div class="receipt-row"><span>${paymentLabel(method)}</span><span>${rupiah(method === 'CASH' ? tendered : total)}</span></div>${method === 'CASH' ? `<div class="receipt-row"><span>Kembali</span><span>${rupiah(Math.max(0,tendered-total))}</span></div>` : ''}<hr class="receipt-rule"><div class="receipt-center">${escapeHtml(org.receipt_footer || 'Terima kasih.')}</div>
    </div>`,
    footer: `<button class="button outline" data-modal-close="button">Tutup</button><button id="print-receipt" class="button primary">Cetak Struk</button>`,
  });
  document.querySelector('#print-receipt').onclick = () => printReceipt(document.querySelector('#receipt-area').outerHTML);
}

function printReceipt(html) {
  const win = window.open('', '_blank', 'width=420,height=700');
  win.document.write(`<!doctype html><html><head><title>Struk</title><style>body{font-family:monospace;width:300px;margin:20px auto;font-size:11px;line-height:1.5}.receipt-logo{display:block;width:80px;height:80px;object-fit:cover;border-radius:50%;margin:0 auto 8px}.receipt-center{text-align:center}.receipt-rule{border:0;border-top:1px dashed #333;margin:10px 0}.receipt-row{display:flex;justify-content:space-between;gap:10px}.receipt-items{display:grid;gap:5px}</style></head><body>${html}<script>window.onload=()=>{window.print();window.close()}<\/script></body></html>`);
  win.document.close();
}

async function renderTransactions() {
  el.content.innerHTML = `
    <div class="page-toolbar"><div class="toolbar-group">
      <label class="toolbar-field"><span>Dari</span><input id="sales-from" type="date" value="${monthStart()}"></label>
      <label class="toolbar-field"><span>Sampai</span><input id="sales-to" type="date" value="${today()}"></label>
      <label class="toolbar-field"><span>Status</span><select id="sales-status"><option value="">Semua</option><option>COMPLETED</option><option>VOIDED</option></select></label>
      <div class="search-box"><input id="sales-search" placeholder="Cari nomor transaksi atau pelanggan"></div>
      <button id="sales-filter" class="button secondary compact">Terapkan</button>
    </div></div>
    <article class="card"><div id="sales-table" class="table-wrap"><div class="loading-state"><span class="spinner"></span></div></div></article>`;
  const load = async () => {
    const data = await get(`sales?${query({ outlet_id: outletId(), from: document.querySelector('#sales-from').value, to: document.querySelector('#sales-to').value, status: document.querySelector('#sales-status').value, q: document.querySelector('#sales-search').value, limit: 200 })}`);
    const container = document.querySelector('#sales-table');
    container.innerHTML = data.sales.length ? `<table class="data-table"><thead><tr><th>Nomor Transaksi</th><th>Waktu</th><th>Kasir</th><th>Pembayaran</th><th>Status</th><th class="align-right">Total</th><th>Aksi</th></tr></thead><tbody>${data.sales.map((sale) => `<tr>
      <td><div class="table-title">${escapeHtml(sale.transaction_number)}</div><div class="table-subtitle">${escapeHtml(sale.customer_name_snapshot || 'Pelanggan Umum')}</div></td>
      <td>${dateTimeID(sale.completed_at)}</td><td>${escapeHtml(sale.cashier_name)}</td><td>${escapeHtml((sale.payment_methods || '').split(',').map((x) => paymentLabel(x.trim())).join(', '))}</td>
      <td><span class="status-chip ${statusClass(sale.status)}">${escapeHtml(sale.status)}</span></td><td class="money align-right">${rupiah(sale.grand_total)}</td>
      <td><div class="table-actions"><button class="button outline compact" data-sale-detail="${sale.id}">Detail</button>${sale.status === 'COMPLETED' && roleCan('ADMIN','MANAGER') ? `<button class="button danger compact" data-sale-void="${sale.id}">Void</button>` : ''}</div></td>
    </tr>`).join('')}</tbody></table>` : emptyState('Tidak ada transaksi', 'Belum ada transaksi pada periode atau filter ini.', '▤');
    container.querySelectorAll('[data-sale-detail]').forEach((button) => button.onclick = () => openSaleDetail(button.dataset.saleDetail));
    container.querySelectorAll('[data-sale-void]').forEach((button) => button.onclick = () => openVoidSale(button.dataset.saleVoid, load));
  };
  document.querySelector('#sales-filter').onclick = () => load().catch(handleError);
  await load();
}

async function openSaleDetail(id) {
  try {
    const data = await get(`sales/${id}`);
    const s = data.sale;
    modal({
      title: s.transaction_number, subtitle: `${dateTimeID(s.completed_at)} · ${s.cashier_name}`, size: 'large',
      body: `<div class="grid two"><div class="card"><div class="card-body"><div class="kv-list">
        <div class="kv-row"><span>Pelanggan</span><strong>${escapeHtml(s.customer_name_snapshot || 'Pelanggan Umum')}</strong></div>
        <div class="kv-row"><span>Status</span><strong>${escapeHtml(s.status)}</strong></div>
        <div class="kv-row"><span>Subtotal</span><strong>${rupiah(s.subtotal)}</strong></div>
        <div class="kv-row"><span>Diskon</span><strong>${rupiah(s.discount_total)}</strong></div>
        <div class="kv-row"><span>Total</span><strong>${rupiah(s.grand_total)}</strong></div>
      </div></div></div><div class="card"><div class="card-body"><div class="kv-list">${data.payments.map((p) => `<div class="kv-row"><span>${paymentLabel(p.payment_method)}</span><strong>${rupiah(p.amount)}</strong></div>`).join('')}<div class="kv-row"><span>Laba kotor</span><strong>${rupiah(s.profit_total)}</strong></div></div></div></div></div>
      <h3 class="section-title">Item transaksi</h3><div class="card table-wrap"><table class="data-table"><thead><tr><th>Produk</th><th>Jumlah</th><th class="align-right">Harga</th><th class="align-right">Subtotal</th></tr></thead><tbody>${data.items.map((item) => `<tr><td><div class="table-title">${escapeHtml(item.product_name_snapshot)}</div><div class="table-subtitle">${escapeHtml(item.product_sku_snapshot)}</div></td><td>${number(item.quantity,2)} ${escapeHtml(item.unit_name_snapshot)}</td><td class="money align-right">${rupiah(item.unit_price)}</td><td class="money align-right">${rupiah(item.line_total)}</td></tr>`).join('')}</tbody></table></div>
      ${s.void_reason ? `<div class="alert danger" style="margin-top:14px"><strong>Alasan pembatalan:</strong> ${escapeHtml(s.void_reason)}</div>` : ''}`,
      footer: `<button class="button outline" data-modal-close="button">Tutup</button>`,
    });
  } catch (error) { handleError(error); }
}

function openVoidSale(id, reload) {
  modal({ title: 'Batalkan Transaksi', subtitle: 'Stok produk akan dikembalikan secara otomatis.', body: `<form id="void-form"><label class="field"><span>Alasan pembatalan</span><textarea name="reason" required minlength="5" placeholder="Jelaskan alasan pembatalan transaksi"></textarea></label></form>`, footer: `<button class="button outline" data-modal-close="button">Batal</button><button id="void-submit" class="button danger">Batalkan Transaksi</button>` });
  document.querySelector('#void-submit').onclick = async (event) => {
    const form = document.querySelector('#void-form'); if (!form.reportValidity()) return;
    const button = event.currentTarget; setButtonLoading(button, true, 'Membatalkan...');
    try { await post(`sales/${id}/void`, formObject(form)); closeModal(); toast('Transaksi berhasil dibatalkan.'); await reload(); }
    catch (error) { handleError(error); setButtonLoading(button, false); }
  };
}

async function renderProducts() {
  el.content.innerHTML = `<div class="page-toolbar"><div class="toolbar-group"><div class="search-box"><input id="product-search" placeholder="Cari nama, SKU, atau barcode"></div><label class="toolbar-field"><span>Kategori</span><select id="product-category"><option value="">Semua kategori</option>${state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select></label><button id="product-filter" class="button secondary compact">Terapkan</button></div>${roleCan('ADMIN','MANAGER','INVENTORY') ? `<div class="toolbar-group"><button id="add-category" class="button outline compact">+ Kategori</button><button id="add-product" class="button primary compact">+ Produk Baru</button></div>` : ''}</div><article class="card"><div id="product-table" class="table-wrap"><div class="loading-state"><span class="spinner"></span></div></div></article>`;
  const load = async () => {
    const data = await get(`products?${query({ outlet_id: outletId(), q: document.querySelector('#product-search').value, category_id: document.querySelector('#product-category').value, active: 'all', limit: 500 })}`);
    const container = document.querySelector('#product-table');
    container.innerHTML = data.products.length ? `<table class="data-table"><thead><tr><th>Produk</th><th>Kategori</th><th>Satuan</th><th class="align-right">Harga Beli</th><th class="align-right">Harga Jual</th><th class="align-right">Stok</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${data.products.map((p) => `<tr><td><div class="table-title">${escapeHtml(p.name)}</div><div class="table-subtitle">${escapeHtml(p.sku)}${p.barcode ? ` · ${escapeHtml(p.barcode)}` : ''}</div></td><td>${escapeHtml(p.category_name || '-')}</td><td>${escapeHtml(p.unit_name)}</td><td class="money align-right">${rupiah(p.purchase_price)}</td><td class="money align-right">${rupiah(p.selling_price)}</td><td class="align-right ${Number(p.track_stock) && Number(p.stock_quantity) <= Number(p.minimum_stock) ? 'text-danger' : ''}">${Number(p.track_stock) ? number(p.stock_quantity,2) : 'Nonstok'}</td><td><span class="status-chip ${Number(p.is_active) ? 'success' : 'danger'}">${Number(p.is_active) ? 'Aktif' : 'Nonaktif'}</span></td><td>${roleCan('ADMIN','MANAGER','INVENTORY') ? `<button class="button outline compact" data-edit-product="${p.id}">Edit</button>` : '-'}</td></tr>`).join('')}</tbody></table>` : emptyState('Produk belum tersedia', 'Tambahkan produk pertama untuk mulai menggunakan kasir.', '▦');
    container.querySelectorAll('[data-edit-product]').forEach((button) => button.onclick = () => openProductModal(data.products.find((p) => p.id === button.dataset.editProduct), load));
  };
  document.querySelector('#product-filter').onclick = () => load().catch(handleError);
  document.querySelector('#add-product')?.addEventListener('click', () => openProductModal(null, load));
  document.querySelector('#add-category')?.addEventListener('click', () => openCategoryModal());
  await load();
}

function productForm(product = {}) {
  return `<form id="product-form" class="form-grid">
    <label class="field"><span>Nama produk</span><input name="name" required maxlength="180" value="${escapeHtml(product.name || '')}"></label>
    <label class="field"><span>SKU</span><input name="sku" required maxlength="80" value="${escapeHtml(product.sku || '')}"></label>
    <label class="field"><span>Barcode</span><input name="barcode" maxlength="100" value="${escapeHtml(product.barcode || '')}"></label>
    <label class="field"><span>Kategori</span><select name="category_id"><option value="">Tanpa kategori</option>${state.categories.map((c) => `<option value="${c.id}" ${c.id === product.category_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Satuan</span><select name="unit_id" required>${state.units.map((u) => `<option value="${u.id}" ${u.id === product.unit_id ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Harga beli</span><input name="purchase_price" type="number" min="0" required value="${Number(product.purchase_price || 0)}"></label>
    <label class="field"><span>Harga jual</span><input name="selling_price" type="number" min="0" required value="${Number(product.selling_price || 0)}"></label>
    <label class="field"><span>Stok minimum</span><input name="minimum_stock" type="number" min="0" step="0.01" value="${Number(product.minimum_stock || 0)}"></label>
    ${product.id ? '' : `<label class="field"><span>Stok awal</span><input name="initial_stock" type="number" min="0" step="0.01" value="0"></label>`}
    <label class="checkbox-field"><input name="track_stock" type="checkbox" ${product.track_stock === undefined || Number(product.track_stock) ? 'checked' : ''}> Produk menggunakan stok</label>
    ${product.id ? `<label class="checkbox-field"><input name="is_active" type="checkbox" ${Number(product.is_active) ? 'checked' : ''}> Produk aktif</label>` : ''}
    <label class="field span-2"><span>Deskripsi</span><textarea name="description">${escapeHtml(product.description || '')}</textarea></label>
    <input type="hidden" name="image_url" value="${escapeHtml(product.image_url || '')}"><input type="hidden" name="image_public_id" value="${escapeHtml(product.image_public_id || '')}">
    <div class="span-2 upload-box"><div class="upload-preview">${product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="">` : '▦'}</div><div class="upload-info"><strong>Foto produk</strong><p>${state.cloudinaryEnabled ? 'Unggah JPG, PNG, atau WebP maksimal 2 MB.' : 'Cloudinary belum dikonfigurasi. Produk tetap dapat disimpan tanpa foto.'}</p><input id="product-image-file" type="file" accept="image/png,image/jpeg,image/webp" ${state.cloudinaryEnabled ? '' : 'disabled'}></div></div>
  </form>`;
}

function openProductModal(product, reload) {
  modal({ title: product ? 'Edit Produk' : 'Tambah Produk', subtitle: product ? product.sku : 'Masukkan data katalog dan stok awal.', body: productForm(product || {}), size: 'large', footer: `<button class="button outline" data-modal-close="button">Batal</button><button id="save-product" class="button primary">Simpan Produk</button>` });
  const fileInput = document.querySelector('#product-image-file');
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { fileInput.value = ''; return toast('Ukuran foto maksimal 2 MB.', 'warning'); }
    try {
      const uploaded = await uploadCloudinary(file, 'bumdes-pos/products');
      const form = document.querySelector('#product-form');
      form.elements.image_url.value = uploaded.secure_url;
      form.elements.image_public_id.value = uploaded.public_id;
      document.querySelector('.upload-preview').innerHTML = `<img src="${escapeHtml(uploaded.secure_url)}" alt="Preview">`;
      toast('Foto berhasil diunggah.');
    } catch (error) { handleError(error); }
  });
  document.querySelector('#save-product').onclick = async (event) => {
    const form = document.querySelector('#product-form'); if (!form.reportValidity()) return;
    const values = formObject(form);
    const payload = { ...values, outlet_id: outletId(), track_stock: form.elements.track_stock.checked, is_active: product ? form.elements.is_active.checked : true, purchase_price: Number(values.purchase_price), selling_price: Number(values.selling_price), minimum_stock: Number(values.minimum_stock), initial_stock: Number(values.initial_stock || 0) };
    const button = event.currentTarget; setButtonLoading(button, true, 'Menyimpan...');
    try { product ? await put(`products/${product.id}`, payload) : await post('products', payload); closeModal(); toast(product ? 'Produk berhasil diperbarui.' : 'Produk berhasil ditambahkan.'); await loadBootstrap(); await reload(); }
    catch (error) { handleError(error); setButtonLoading(button, false); }
  };
}

function openCategoryModal() {
  modal({ title: 'Tambah Kategori', body: `<form id="category-form" class="form-grid"><label class="field"><span>Nama kategori</span><input name="name" required maxlength="120"></label><label class="field span-2"><span>Deskripsi</span><textarea name="description"></textarea></label></form>`, footer: `<button class="button outline" data-modal-close="button">Batal</button><button id="save-category" class="button primary">Simpan</button>` });
  document.querySelector('#save-category').onclick = async (event) => {
    const form = document.querySelector('#category-form'); if (!form.reportValidity()) return;
    const button = event.currentTarget; setButtonLoading(button, true);
    try { await post('categories', { ...formObject(form), outlet_id: outletId() }); closeModal(); toast('Kategori berhasil ditambahkan.'); await loadBootstrap(); if (state.currentView === 'products') await renderProducts(); }
    catch (error) { handleError(error); setButtonLoading(button, false); }
  };
}

async function uploadCloudinary(file, folder) {
  const signed = await post('uploads/signature', { folder });
  const form = new FormData();
  form.append('file', file); form.append('api_key', signed.apiKey); form.append('timestamp', signed.timestamp); form.append('folder', signed.folder); form.append('signature', signed.signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(signed.cloudName)}/image/upload`, { method: 'POST', body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Gagal mengunggah ke Cloudinary.');
  return data;
}

async function renderInventory() {
  el.content.innerHTML = `<div class="page-toolbar"><div class="toolbar-group"><div class="search-box"><input id="stock-search" placeholder="Cari produk atau SKU"></div><button id="stock-filter" class="button secondary compact">Terapkan</button></div><button id="stock-movements" class="button outline compact">Riwayat Mutasi</button></div><article class="card"><div id="stock-table" class="table-wrap"><div class="loading-state"><span class="spinner"></span></div></div></article>`;
  const load = async () => {
    const data = await get(`stocks?${query({ outlet_id: outletId(), q: document.querySelector('#stock-search').value })}`);
    const container = document.querySelector('#stock-table');
    container.innerHTML = data.stocks.length ? `<table class="data-table"><thead><tr><th>Produk</th><th>Kategori</th><th class="align-right">Stok</th><th class="align-right">Minimum</th><th class="align-right">Nilai Stok</th><th>Kondisi</th><th>Aksi</th></tr></thead><tbody>${data.stocks.map((p) => `<tr><td><div class="table-title">${escapeHtml(p.name)}</div><div class="table-subtitle">${escapeHtml(p.sku)} · ${escapeHtml(p.unit_name)}</div></td><td>${escapeHtml(p.category_name || '-')}</td><td class="align-right">${Number(p.track_stock) ? number(p.quantity,2) : 'Nonstok'}</td><td class="align-right">${Number(p.track_stock) ? number(p.minimum_stock,2) : '-'}</td><td class="money align-right">${Number(p.track_stock) ? rupiah(Number(p.quantity)*Number(p.purchase_price)) : '-'}</td><td><span class="status-chip ${Number(p.is_low) ? 'danger' : 'success'}">${Number(p.is_low) ? 'Stok minimum' : 'Aman'}</span></td><td>${roleCan('ADMIN','MANAGER','INVENTORY') && Number(p.track_stock) ? `<button class="button outline compact" data-adjust="${p.id}">Sesuaikan</button>` : '-'}</td></tr>`).join('')}</tbody></table>` : emptyState('Belum ada produk', 'Tambahkan produk dan stok awal terlebih dahulu.', '◫');
    container.querySelectorAll('[data-adjust]').forEach((button) => button.onclick = () => openStockAdjust(data.stocks.find((p) => p.id === button.dataset.adjust), load));
  };
  document.querySelector('#stock-filter').onclick = () => load().catch(handleError);
  document.querySelector('#stock-movements').onclick = openStockMovements;
  await load();
}

function openStockAdjust(product, reload) {
  modal({ title: 'Penyesuaian Stok', subtitle: `${product.name} · Stok saat ini ${number(product.quantity,2)}`, body: `<form id="adjust-form" class="form-grid"><label class="field"><span>Mode</span><select name="mode"><option value="IN">Tambah stok</option><option value="OUT">Kurangi stok</option><option value="SET">Tetapkan hasil opname</option></select></label><label class="field"><span>Jumlah</span><input name="quantity" type="number" min="0.01" step="0.01" required></label><label class="field span-2"><span>Alasan penyesuaian</span><textarea name="notes" required minlength="5" placeholder="Contoh: hasil stok opname, barang rusak, koreksi penerimaan"></textarea></label></form>`, footer: `<button class="button outline" data-modal-close="button">Batal</button><button id="save-adjust" class="button primary">Simpan Penyesuaian</button>` });
  document.querySelector('#save-adjust').onclick = async (event) => {
    const form = document.querySelector('#adjust-form'); if (!form.reportValidity()) return;
    const values = formObject(form); const button = event.currentTarget; setButtonLoading(button, true);
    try { await post('stocks/adjust', { ...values, outlet_id: outletId(), product_id: product.id, quantity: Number(values.quantity) }); closeModal(); toast('Stok berhasil disesuaikan.'); await reload(); }
    catch (error) { handleError(error); setButtonLoading(button, false); }
  };
}

async function openStockMovements() {
  try {
    const data = await get(`stocks/movements?${query({ outlet_id: outletId(), limit: 200 })}`);
    modal({ title: 'Riwayat Mutasi Stok', subtitle: 'Setiap perubahan stok tercatat dan tidak dapat dihapus.', size: 'xlarge', body: data.movements.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Waktu</th><th>Produk</th><th>Jenis</th><th class="align-right">Sebelum</th><th class="align-right">Perubahan</th><th class="align-right">Setelah</th><th>Pengguna</th><th>Catatan</th></tr></thead><tbody>${data.movements.map((m) => `<tr><td>${dateTimeID(m.created_at)}</td><td><div class="table-title">${escapeHtml(m.product_name)}</div><div class="table-subtitle">${escapeHtml(m.sku)}</div></td><td><span class="badge">${escapeHtml(m.movement_type)}</span></td><td class="align-right">${number(m.quantity_before,2)}</td><td class="align-right ${Number(m.quantity_change)<0?'text-danger':'text-success'}">${Number(m.quantity_change)>0?'+':''}${number(m.quantity_change,2)}</td><td class="align-right">${number(m.quantity_after,2)}</td><td>${escapeHtml(m.user_name)}</td><td>${escapeHtml(m.notes || '-')}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Belum ada mutasi', 'Riwayat perubahan stok akan tampil di sini.', '◫'), footer: `<button class="button outline" data-modal-close="button">Tutup</button>` });
  } catch (error) { handleError(error); }
}

async function renderShifts() {
  const data = await get(`shifts?${query({ outlet_id: outletId(), limit: 100 })}`);
  state.currentShift = data.current;
  updateShiftBadge();
  const current = data.current;
  let expected = null;
  if (current) expected = await get(`shifts/${current.id}/expected`);
  el.content.innerHTML = `${current ? `<section class="shift-hero"><h3>Shift sedang aktif</h3><p>${escapeHtml(current.outlet_name)} · Dibuka ${dateTimeID(current.opened_at)}</p><div class="shift-stats"><div class="shift-stat"><span>Kas awal</span><strong>${rupiah(expected.opening)}</strong></div><div class="shift-stat"><span>Penjualan tunai</span><strong>${rupiah(expected.cashSales)}</strong></div><div class="shift-stat"><span>Kas keluar</span><strong>${rupiah(expected.cashOut)}</strong></div><div class="shift-stat"><span>Kas seharusnya</span><strong>${rupiah(expected.expected)}</strong></div></div><div style="margin-top:18px;position:relative;z-index:1"><button id="close-shift" class="button warning">Tutup Shift</button></div></section>` : `<div class="alert info">Belum ada shift aktif untuk akun Anda.</div><div style="margin-top:14px"><button id="open-shift" class="button primary">Buka Shift</button></div>`}
  <h3 class="section-title">Riwayat Shift</h3><article class="card"><div class="table-wrap">${data.shifts.length ? `<table class="data-table"><thead><tr><th>Kasir</th><th>Dibuka</th><th>Ditutup</th><th class="align-right">Kas Awal</th><th class="align-right">Seharusnya</th><th class="align-right">Aktual</th><th class="align-right">Selisih</th><th>Status</th></tr></thead><tbody>${data.shifts.map((s) => `<tr><td>${escapeHtml(s.cashier_name)}</td><td>${dateTimeID(s.opened_at)}</td><td>${dateTimeID(s.closed_at)}</td><td class="money align-right">${rupiah(s.opening_cash)}</td><td class="money align-right">${s.expected_cash === null ? '-' : rupiah(s.expected_cash)}</td><td class="money align-right">${s.actual_cash === null ? '-' : rupiah(s.actual_cash)}</td><td class="money align-right ${Number(s.cash_difference)<0?'text-danger':Number(s.cash_difference)>0?'text-warning':''}">${s.cash_difference === null ? '-' : rupiah(s.cash_difference)}</td><td><span class="status-chip ${statusClass(s.status)}">${escapeHtml(s.status)}</span></td></tr>`).join('')}</tbody></table>` : emptyState('Belum ada riwayat shift', 'Buka shift untuk memulai kegiatan kasir.', '◷')}</div></article>`;
  document.querySelector('#open-shift')?.addEventListener('click', openShiftModal);
  document.querySelector('#close-shift')?.addEventListener('click', () => openCloseShift(current, expected));
}

function openShiftModal() {
  modal({ title: 'Buka Shift Kasir', subtitle: 'Masukkan jumlah uang tunai awal di laci kasir.', body: `<form id="open-shift-form" class="form-grid"><label class="field"><span>Outlet</span><select name="outlet_id">${state.outlets.map((o) => `<option value="${o.id}" ${o.id===outletId()?'selected':''}>${escapeHtml(o.name)}</option>`).join('')}</select></label><label class="field"><span>Kas awal</span><input name="opening_cash" type="number" min="0" value="0" required></label><label class="field span-2"><span>Catatan</span><textarea name="notes" placeholder="Opsional"></textarea></label></form>`, footer: `<button class="button outline" data-modal-close="button">Batal</button><button id="open-shift-submit" class="button primary">Buka Shift</button>` });
  document.querySelector('#open-shift-submit').onclick = async (event) => {
    const form = document.querySelector('#open-shift-form'); if (!form.reportValidity()) return;
    const values = formObject(form); const button = event.currentTarget; setButtonLoading(button, true);
    try { await post('shifts/open', { ...values, opening_cash: Number(values.opening_cash) }); closeModal(); toast('Shift berhasil dibuka.'); state.currentOutletId = values.outlet_id; await loadBootstrap(); await navigate(state.currentView); }
    catch (error) { handleError(error); setButtonLoading(button, false); }
  };
}

function openCloseShift(shift, expected) {
  modal({ title: 'Tutup Shift', subtitle: 'Hitung seluruh uang tunai fisik sebelum menutup shift.', body: `<div class="kv-list" style="margin-bottom:18px"><div class="kv-row"><span>Kas awal</span><strong>${rupiah(expected.opening)}</strong></div><div class="kv-row"><span>Penjualan tunai</span><strong>${rupiah(expected.cashSales)}</strong></div><div class="kv-row"><span>Kas masuk</span><strong>${rupiah(expected.cashIn)}</strong></div><div class="kv-row"><span>Kas keluar</span><strong>${rupiah(expected.cashOut)}</strong></div><div class="kv-row"><span>Kas seharusnya</span><strong>${rupiah(expected.expected)}</strong></div></div><form id="close-shift-form" class="form-grid"><label class="field"><span>Kas aktual</span><input name="actual_cash" type="number" min="0" value="${expected.expected}" required></label><label class="field span-2"><span>Catatan penutupan</span><textarea name="notes" placeholder="Jelaskan jika terdapat selisih"></textarea></label><div id="shift-difference" class="span-2 alert info">Selisih: <strong>${rupiah(0)}</strong></div></form>`, footer: `<button class="button outline" data-modal-close="button">Batal</button><button id="close-shift-submit" class="button warning">Tutup Shift</button>` });
  const input = document.querySelector('[name="actual_cash"]');
  input.oninput = () => { const diff = Number(input.value || 0) - expected.expected; document.querySelector('#shift-difference').className = `span-2 alert ${diff === 0 ? 'success' : 'warning'}`; document.querySelector('#shift-difference').innerHTML = `Selisih: <strong>${rupiah(diff)}</strong>`; };
  document.querySelector('#close-shift-submit').onclick = async (event) => {
    const form = document.querySelector('#close-shift-form'); if (!form.reportValidity()) return;
    const values = formObject(form); const button = event.currentTarget; setButtonLoading(button, true, 'Menutup...');
    try { const result = await post(`shifts/${shift.id}/close`, { ...values, actual_cash: Number(values.actual_cash) }); closeModal(); toast(`Shift ditutup. Selisih kas ${rupiah(result.difference)}.`); await loadBootstrap(); await renderShifts(); }
    catch (error) { handleError(error); setButtonLoading(button, false); }
  };
}

async function renderExpenses() {
  el.content.innerHTML = `<div class="page-toolbar"><div class="toolbar-group"><label class="toolbar-field"><span>Dari</span><input id="expense-from" type="date" value="${monthStart()}"></label><label class="toolbar-field"><span>Sampai</span><input id="expense-to" type="date" value="${today()}"></label><button id="expense-filter" class="button secondary compact">Terapkan</button></div><button id="add-expense" class="button primary compact">+ Catat Pengeluaran</button></div><article class="card"><div id="expense-table" class="table-wrap"><div class="loading-state"><span class="spinner"></span></div></div></article>`;
  const load = async () => {
    const data = await get(`expenses?${query({ outlet_id: outletId(), from: document.querySelector('#expense-from').value, to: document.querySelector('#expense-to').value, limit: 200 })}`);
    const total = data.expenses.reduce((sum, x) => sum + Number(x.amount), 0);
    document.querySelector('#expense-table').innerHTML = data.expenses.length ? `<table class="data-table"><thead><tr><th>Nomor</th><th>Tanggal</th><th>Kategori</th><th>Keterangan</th><th>Pembayaran</th><th>Dicatat Oleh</th><th class="align-right">Jumlah</th></tr></thead><tbody>${data.expenses.map((e) => `<tr><td class="table-title">${escapeHtml(e.expense_number)}</td><td>${dateID(e.expense_date)}</td><td>${escapeHtml(e.category_name)}</td><td>${escapeHtml(e.description)}</td><td>${paymentLabel(e.payment_method)}</td><td>${escapeHtml(e.created_by_name)}</td><td class="money align-right">${rupiah(e.amount)}</td></tr>`).join('')}<tr><td colspan="6" class="align-right"><strong>Total</strong></td><td class="money align-right"><strong>${rupiah(total)}</strong></td></tr></tbody></table>` : emptyState('Belum ada pengeluaran', 'Pengeluaran operasional akan tampil di sini.', '↘');
  };
  document.querySelector('#expense-filter').onclick = () => load().catch(handleError);
  document.querySelector('#add-expense').onclick = () => openExpenseModal(load);
  await load();
}

function openExpenseModal(reload) {
  modal({ title: 'Catat Pengeluaran', subtitle: 'Pengeluaran tunai akan mengurangi kas pada shift aktif.', body: `<form id="expense-form" class="form-grid"><label class="field"><span>Tanggal</span><input name="expense_date" type="date" value="${today()}" required></label><label class="field"><span>Kategori</span><select name="category_id" required>${state.expenseCategories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select></label><label class="field"><span>Jumlah</span><input name="amount" type="number" min="1" required></label><label class="field"><span>Metode pembayaran</span><select name="payment_method"><option value="CASH">Tunai</option><option value="TRANSFER">Transfer</option><option value="QRIS">QRIS</option><option value="EWALLET">E-Wallet</option><option value="OTHER">Lainnya</option></select></label><label class="field span-2"><span>Keterangan</span><textarea name="description" required minlength="4"></textarea></label></form>`, footer: `<button class="button outline" data-modal-close="button">Batal</button><button id="save-expense" class="button primary">Simpan Pengeluaran</button>` });
  document.querySelector('#save-expense').onclick = async (event) => {
    const form = document.querySelector('#expense-form'); if (!form.reportValidity()) return;
    const values = formObject(form); const button = event.currentTarget; setButtonLoading(button, true);
    try { await post('expenses', { ...values, outlet_id: outletId(), amount: Number(values.amount) }); closeModal(); toast('Pengeluaran berhasil dicatat.'); await reload(); }
    catch (error) { handleError(error); setButtonLoading(button, false); }
  };
}

async function renderPurchases() {
  el.content.innerHTML = `<div class="page-toolbar"><div class="toolbar-group"><label class="toolbar-field"><span>Dari</span><input id="purchase-from" type="date" value="${monthStart()}"></label><label class="toolbar-field"><span>Sampai</span><input id="purchase-to" type="date" value="${today()}"></label><button id="purchase-filter" class="button secondary compact">Terapkan</button></div><div class="toolbar-group"><button id="add-supplier" class="button outline compact">+ Pemasok</button><button id="add-purchase" class="button primary compact">+ Penerimaan Barang</button></div></div><article class="card"><div id="purchase-table" class="table-wrap"><div class="loading-state"><span class="spinner"></span></div></div></article>`;
  const load = async () => {
    const data = await get(`purchases?${query({ outlet_id: outletId(), from: document.querySelector('#purchase-from').value, to: document.querySelector('#purchase-to').value, limit: 200 })}`);
    document.querySelector('#purchase-table').innerHTML = data.purchases.length ? `<table class="data-table"><thead><tr><th>Nomor</th><th>Tanggal</th><th>Pemasok</th><th>No. Faktur</th><th>Status</th><th class="align-right">Dibayar</th><th class="align-right">Utang</th><th class="align-right">Total</th></tr></thead><tbody>${data.purchases.map((p) => `<tr><td class="table-title">${escapeHtml(p.purchase_number)}</td><td>${dateID(p.purchase_date)}</td><td>${escapeHtml(p.supplier_name || '-')}</td><td>${escapeHtml(p.invoice_number || '-')}</td><td><span class="status-chip ${statusClass(p.status)}">${escapeHtml(p.status)}</span></td><td class="money align-right">${rupiah(p.paid_amount)}</td><td class="money align-right ${Number(p.due_amount)>0?'text-warning':''}">${rupiah(p.due_amount)}</td><td class="money align-right">${rupiah(p.grand_total)}</td></tr>`).join('')}</tbody></table>` : emptyState('Belum ada pembelian', 'Penerimaan barang dari pemasok akan tampil di sini.', '🚚');
  };
  document.querySelector('#purchase-filter').onclick = () => load().catch(handleError);
  document.querySelector('#add-purchase').onclick = () => openPurchaseModal(load);
  document.querySelector('#add-supplier').onclick = openSupplierModal;
  await load();
}

async function openPurchaseModal(reload) {
  let products;
  try { products = (await get(`products?${query({ outlet_id: outletId(), limit: 500 })}`)).products.filter((p) => Number(p.track_stock)); }
  catch (error) { return handleError(error); }
  modal({ title: 'Penerimaan Barang', subtitle: 'Stok bertambah segera setelah dokumen disimpan.', size: 'xlarge', body: `<form id="purchase-form"><div class="form-grid three"><label class="field"><span>Tanggal</span><input name="purchase_date" type="date" value="${today()}" required></label><label class="field"><span>Pemasok</span><select name="supplier_id"><option value="">Tanpa pemasok</option>${state.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}</select></label><label class="field"><span>No. faktur</span><input name="invoice_number"></label><label class="field"><span>Diskon</span><input name="discount_total" type="number" min="0" value="0"></label><label class="field"><span>Jumlah dibayar</span><input name="paid_amount" type="number" min="0" value="0"></label><label class="field"><span>Metode</span><select name="payment_method"><option value="TRANSFER">Transfer</option><option value="CASH">Tunai</option><option value="CREDIT">Kredit</option><option value="QRIS">QRIS</option><option value="OTHER">Lainnya</option></select></label></div><h3 class="section-title">Item Pembelian</h3><div id="purchase-items"></div><button type="button" id="add-purchase-row" class="button secondary compact" style="margin-top:10px">+ Tambah Baris</button><label class="field" style="margin-top:16px"><span>Catatan</span><textarea name="notes"></textarea></label><div id="purchase-summary" class="alert info" style="margin-top:14px">Total pembelian: <strong>${rupiah(0)}</strong></div></form>`, footer: `<button class="button outline" data-modal-close="button">Batal</button><button id="save-purchase" class="button primary">Simpan dan Tambah Stok</button>` });
  const rows = [];
  const rowsContainer = document.querySelector('#purchase-items');
  const addRow = () => {
    rows.push({ key: uuid() });
    drawRows();
  };
  const drawRows = () => {
    rowsContainer.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Produk</th><th>Jumlah</th><th>Harga Beli</th><th class="align-right">Subtotal</th><th></th></tr></thead><tbody>${rows.map((row, index) => `<tr data-purchase-row="${row.key}"><td><select class="select" data-field="product_id"><option value="">Pilih produk</option>${products.map((p) => `<option value="${p.id}" data-cost="${p.purchase_price}" ${p.id===row.product_id?'selected':''}>${escapeHtml(p.name)} · ${escapeHtml(p.sku)}</option>`).join('')}</select></td><td><input class="input" data-field="quantity" type="number" min="0.01" step="0.01" value="${row.quantity || 1}"></td><td><input class="input" data-field="unit_cost" type="number" min="0" value="${row.unit_cost || 0}"></td><td class="money align-right">${rupiah((row.quantity||0)*(row.unit_cost||0))}</td><td><button type="button" class="icon-button small" data-remove-row="${index}">×</button></td></tr>`).join('')}</tbody></table></div>`;
    rowsContainer.querySelectorAll('[data-purchase-row]').forEach((tr) => {
      const row = rows.find((x) => x.key === tr.dataset.purchaseRow);
      tr.querySelectorAll('[data-field]').forEach((input) => input.addEventListener('change', () => {
        row[input.dataset.field] = input.dataset.field === 'product_id' ? input.value : Number(input.value || 0);
        if (input.dataset.field === 'product_id') { const option = input.selectedOptions[0]; row.unit_cost = Number(option.dataset.cost || 0); }
        drawRows(); updatePurchaseSummary();
      }));
    });
    rowsContainer.querySelectorAll('[data-remove-row]').forEach((button) => button.onclick = () => { rows.splice(Number(button.dataset.removeRow), 1); drawRows(); updatePurchaseSummary(); });
  };
  const updatePurchaseSummary = () => {
    const subtotal = rows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.unit_cost || 0), 0);
    const discount = Number(document.querySelector('[name="discount_total"]').value || 0);
    document.querySelector('#purchase-summary').innerHTML = `Total pembelian: <strong>${rupiah(Math.max(0,subtotal-discount))}</strong>`;
  };
  addRow();
  document.querySelector('#add-purchase-row').onclick = addRow;
  document.querySelector('[name="discount_total"]').oninput = updatePurchaseSummary;
  document.querySelector('#save-purchase').onclick = async (event) => {
    const form = document.querySelector('#purchase-form'); if (!form.reportValidity()) return;
    const items = rows.filter((row) => row.product_id && row.quantity > 0).map((row) => ({ product_id: row.product_id, quantity: row.quantity, unit_cost: row.unit_cost }));
    if (!items.length) return toast('Tambahkan minimal satu item pembelian.', 'warning');
    const values = formObject(form); const subtotal = items.reduce((sum,x)=>sum+x.quantity*x.unit_cost,0); if (!Number(values.paid_amount)) values.paid_amount = Math.max(0, subtotal-Number(values.discount_total||0));
    const button = event.currentTarget; setButtonLoading(button, true, 'Menyimpan...');
    try { await post('purchases', { ...values, outlet_id: outletId(), items, paid_amount: Number(values.paid_amount), discount_total: Number(values.discount_total) }); closeModal(); toast('Pembelian tersimpan dan stok bertambah.'); await reload(); }
    catch (error) { handleError(error); setButtonLoading(button, false); }
  };
}

function openSupplierModal() {
  modal({ title: 'Tambah Pemasok', body: `<form id="supplier-form" class="form-grid"><label class="field"><span>Kode</span><input name="code" required maxlength="40"></label><label class="field"><span>Nama pemasok</span><input name="name" required maxlength="180"></label><label class="field"><span>Telepon</span><input name="phone"></label><label class="field"><span>Kontak person</span><input name="contact_person"></label><label class="field span-2"><span>Alamat</span><textarea name="address"></textarea></label></form>`, footer: `<button class="button outline" data-modal-close="button">Batal</button><button id="save-supplier" class="button primary">Simpan</button>` });
  document.querySelector('#save-supplier').onclick = async (event) => {
    const form = document.querySelector('#supplier-form'); if (!form.reportValidity()) return; const button = event.currentTarget; setButtonLoading(button,true);
    try { await post('suppliers',{...formObject(form),outlet_id:outletId()}); closeModal(); toast('Pemasok berhasil ditambahkan.'); await loadBootstrap(); if(state.currentView==='purchases') await renderPurchases(); }
    catch(error){handleError(error);setButtonLoading(button,false);}
  };
}

async function renderReports() {
  el.content.innerHTML = `<div class="page-toolbar no-print"><div class="toolbar-group"><label class="toolbar-field"><span>Dari</span><input id="report-from" type="date" value="${monthStart()}"></label><label class="toolbar-field"><span>Sampai</span><input id="report-to" type="date" value="${today()}"></label><button id="report-filter" class="button secondary compact">Terapkan</button></div><div class="toolbar-group"><button id="report-csv" class="button outline compact">Unduh CSV</button><button id="report-print" class="button primary compact">Cetak Laporan</button></div></div><div id="report-content"><div class="loading-state"><span class="spinner"></span></div></div>`;
  let currentData;
  const load = async () => {
    currentData = await get(`reports/summary?${query({ outlet_id: outletId(), from: document.querySelector('#report-from').value, to: document.querySelector('#report-to').value })}`);
    const s = currentData.summary;
    const paymentTotal = currentData.payments.reduce((sum, row) => sum + Number(row.total), 0) || 1;
    document.querySelector('#report-content').innerHTML = `<div class="card" style="margin-bottom:18px"><div class="card-body" style="display:flex;gap:18px;align-items:center"><img src="${escapeHtml(state.organization.logo_url || '/assets/img/logo-bumdes.webp')}" alt="Logo" style="width:75px;height:75px;border-radius:50%;object-fit:cover"><div><h2 style="margin:0 0 5px">Laporan Operasional ${escapeHtml(state.organization.name)}</h2><div class="muted">${escapeHtml(currentData.outlet.name)} · Periode ${dateID(currentData.range.from)} s.d. ${dateID(currentData.range.to)}</div><div class="muted">${escapeHtml(state.organization.address || '')}</div></div></div></div>
      <div class="grid metrics">
        ${metricCard('Omzet', rupiah(s.omzet), `${number(s.transaksi)} transaksi`, 'Rp')}
        ${metricCard('Harga Pokok', rupiah(s.hpp), 'Nilai modal produk terjual', '◫', 'warning')}
        ${metricCard('Laba Kotor', rupiah(s.laba_kotor), 'Omzet dikurangi HPP', '↗', 'info')}
        ${metricCard('Hasil Operasional', rupiah(s.net_operating), `Pengeluaran ${rupiah(s.expenses)}`, '◎', Number(s.net_operating)<0?'danger':'')}
      </div>
      <div class="grid two" style="margin-top:18px"><article class="card"><header class="card-header"><div><h3>Penjualan Harian</h3><p>Omzet per tanggal</p></div></header><div class="card-body">${barChart(currentData.daily,'omzet')}</div></article><article class="card"><header class="card-header"><div><h3>Metode Pembayaran</h3><p>Komposisi penerimaan penjualan</p></div></header><div class="card-body"><div class="progress-list">${currentData.payments.map((row) => `<div class="progress-row"><strong>${paymentLabel(row.payment_method)}</strong><div class="progress-track"><div class="progress-fill" style="width:${Number(row.total)/paymentTotal*100}%"></div></div><span>${rupiah(row.total)}</span></div>`).join('') || '<span class="muted">Belum ada data</span>'}</div></div></article></div>
      <div class="grid two" style="margin-top:18px"><article class="card"><header class="card-header"><div><h3>Penjualan Produk</h3><p>Produk dengan nilai penjualan tertinggi</p></div></header><div class="table-wrap">${currentData.products.length ? `<table class="data-table"><thead><tr><th>Produk</th><th class="align-right">Jumlah</th><th class="align-right">Penjualan</th><th class="align-right">Margin</th></tr></thead><tbody>${currentData.products.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td class="align-right">${number(p.quantity,2)}</td><td class="money align-right">${rupiah(p.sales)}</td><td class="money align-right">${rupiah(Number(p.sales)-Number(p.cost))}</td></tr>`).join('')}</tbody></table>` : emptyState('Belum ada penjualan','Data produk akan tampil di sini.','▦')}</div></article><article class="card"><header class="card-header"><div><h3>Pengeluaran per Kategori</h3><p>Komposisi biaya operasional</p></div></header><div class="card-body"><div class="kv-list">${currentData.expenses.map((e) => `<div class="kv-row"><span>${escapeHtml(e.name)}</span><strong>${rupiah(e.total)}</strong></div>`).join('') || '<span class="muted">Belum ada pengeluaran</span>'}<div class="kv-row"><span>Nilai persediaan saat ini</span><strong>${rupiah(s.stock_value)}</strong></div><div class="kv-row"><span>Produk stok minimum</span><strong>${number(s.low_stock)}</strong></div></div></div></article></div>`;
  };
  document.querySelector('#report-filter').onclick = () => load().catch(handleError);
  document.querySelector('#report-print').onclick = () => window.print();
  document.querySelector('#report-csv').onclick = () => {
    if (!currentData) return;
    downloadCsv(`laporan-penjualan-${currentData.range.from}-${currentData.range.to}.csv`, currentData.products.map((p) => ({ Produk:p.name, Jumlah:p.quantity, Penjualan:p.sales, HPP:p.cost, Margin:Number(p.sales)-Number(p.cost) })));
  };
  await load();
}

async function renderUsers() {
  const data = await get('users');
  el.content.innerHTML = `<div class="page-toolbar"><div></div>${roleCan('ADMIN') ? `<button id="add-user" class="button primary compact">+ Pengguna Baru</button>` : ''}</div><article class="card"><div class="table-wrap">${data.users.length ? `<table class="data-table"><thead><tr><th>Pengguna</th><th>Role</th><th>Outlet</th><th>Kontak</th><th>Login Terakhir</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${data.users.map((u) => `<tr><td><div class="table-title">${escapeHtml(u.full_name)}</div><div class="table-subtitle">@${escapeHtml(u.username)}</div></td><td><span class="badge">${escapeHtml(roleLabel(u.role))}</span></td><td>${escapeHtml(u.default_outlet_name || '-')}</td><td>${escapeHtml(u.phone || u.email || '-')}</td><td>${dateTimeID(u.last_login_at)}</td><td><span class="status-chip ${Number(u.is_active)?'success':'danger'}">${Number(u.is_active)?'Aktif':'Nonaktif'}</span></td><td>${roleCan('ADMIN') ? `<button class="button outline compact" data-edit-user="${u.id}">Edit</button>` : '-'}</td></tr>`).join('')}</tbody></table>` : emptyState('Belum ada pengguna','Tambahkan akun untuk petugas BUMDes.','♙')}</div></article>`;
  document.querySelector('#add-user')?.addEventListener('click', () => openUserModal(null));
  document.querySelectorAll('[data-edit-user]').forEach((button) => button.onclick = () => openUserModal(data.users.find((u) => u.id === button.dataset.editUser)));
}

function openUserModal(user) {
  modal({ title: user ? 'Edit Pengguna' : 'Tambah Pengguna', subtitle: user ? `@${user.username}` : 'Buat akun baru sesuai tugas petugas.', body: `<form id="user-form" class="form-grid">${user ? '' : `<label class="field"><span>Username</span><input name="username" required maxlength="80"></label>`}<label class="field"><span>Nama lengkap</span><input name="full_name" required value="${escapeHtml(user?.full_name || '')}"></label><label class="field"><span>Role</span><select name="role">${['ADMIN','MANAGER','FINANCE','INVENTORY','CASHIER','VIEWER'].map((role) => `<option value="${role}" ${role===user?.role?'selected':''}>${roleLabel(role)}</option>`).join('')}</select></label><label class="field"><span>Outlet utama</span><select name="default_outlet_id">${state.outlets.map((o)=>`<option value="${o.id}" ${o.id===user?.default_outlet_id?'selected':''}>${escapeHtml(o.name)}</option>`).join('')}</select></label><label class="field"><span>Email</span><input name="email" type="email" value="${escapeHtml(user?.email || '')}"></label><label class="field"><span>Telepon</span><input name="phone" value="${escapeHtml(user?.phone || '')}"></label><label class="field"><span>${user ? 'Reset password (opsional)' : 'Password awal'}</span><input name="${user ? 'reset_password' : 'password'}" type="password" ${user?'':'required'} minlength="4"></label>${user ? `<label class="checkbox-field"><input name="is_active" type="checkbox" ${Number(user.is_active)?'checked':''}> Akun aktif</label>` : ''}</form>`, footer: `<button class="button outline" data-modal-close="button">Batal</button><button id="save-user" class="button primary">Simpan Pengguna</button>` });
  document.querySelector('#save-user').onclick = async (event) => {
    const form=document.querySelector('#user-form'); if(!form.reportValidity())return; const values=formObject(form); if(user) values.is_active=form.elements.is_active.checked; const button=event.currentTarget; setButtonLoading(button,true);
    try { user ? await put(`users/${user.id}`,values) : await post('users',values); closeModal(); toast('Data pengguna berhasil disimpan.'); await renderUsers(); }
    catch(error){handleError(error);setButtonLoading(button,false);}
  };
}

async function renderAudit() {
  const data = await get('audit?limit=250');
  el.content.innerHTML = `<article class="card"><div class="table-wrap">${data.logs.length ? `<table class="data-table"><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aktivitas</th><th>Entitas</th><th>Alamat IP</th><th>Ringkasan</th></tr></thead><tbody>${data.logs.map((log) => `<tr><td>${dateTimeID(log.created_at)}</td><td><div class="table-title">${escapeHtml(log.user_name || 'Sistem')}</div><div class="table-subtitle">${escapeHtml(log.username || '-')}</div></td><td><span class="badge">${escapeHtml(log.action)}</span></td><td>${escapeHtml(log.entity_type)}${log.entity_id?`<div class="table-subtitle">${escapeHtml(log.entity_id)}</div>`:''}</td><td>${escapeHtml(log.ip_address || '-')}</td><td class="muted">${escapeHtml((log.new_value_json || log.old_value_json || '-').slice(0,120))}</td></tr>`).join('')}</tbody></table>` : emptyState('Audit log kosong','Aktivitas penting akan tercatat otomatis.','◎')}</div></article>`;
}

async function renderSettings() {
  const data = await get('settings');
  const org = data.organization;
  el.content.innerHTML = `<div class="grid two"><article class="card"><header class="card-header"><div><h3>Identitas BUMDes</h3><p>Digunakan pada aplikasi, struk, dan laporan.</p></div></header><div class="card-body"><form id="settings-form" class="form-grid"><label class="field"><span>Nama BUMDes</span><input name="name" required value="${escapeHtml(org.name || '')}"></label><label class="field"><span>Nama legal</span><input name="legal_name" value="${escapeHtml(org.legal_name || '')}"></label><label class="field"><span>Desa</span><input name="village_name" value="${escapeHtml(org.village_name || '')}"></label><label class="field"><span>Kecamatan</span><input name="district_name" value="${escapeHtml(org.district_name || '')}"></label><label class="field"><span>Kabupaten</span><input name="regency_name" value="${escapeHtml(org.regency_name || '')}"></label><label class="field"><span>Provinsi</span><input name="province_name" value="${escapeHtml(org.province_name || '')}"></label><label class="field"><span>Telepon</span><input name="phone" value="${escapeHtml(org.phone || '')}"></label><label class="field"><span>Email</span><input name="email" type="email" value="${escapeHtml(org.email || '')}"></label><label class="field span-2"><span>Alamat</span><textarea name="address">${escapeHtml(org.address || '')}</textarea></label><label class="field span-2"><span>Footer struk</span><textarea name="receipt_footer">${escapeHtml(org.receipt_footer || '')}</textarea></label><input type="hidden" name="logo_url" value="${escapeHtml(org.logo_url || '/assets/img/logo-bumdes.webp')}"><input type="hidden" name="logo_public_id" value="${escapeHtml(org.logo_public_id || '')}"></form></div></article><article class="card"><header class="card-header"><div><h3>Logo dan Branding</h3><p>Logo bawaan telah disisipkan dari aset yang Anda unggah.</p></div></header><div class="card-body"><div class="upload-box" style="align-items:flex-start"><div class="upload-preview" style="width:140px;height:140px;border-radius:50%"><img id="settings-logo-preview" src="${escapeHtml(org.logo_url || '/assets/img/logo-bumdes.webp')}" alt="Logo"></div><div class="upload-info"><strong>Logo utama</strong><p>Logo digunakan di halaman login, sidebar, laporan, dan struk transaksi.</p><input id="settings-logo-file" type="file" accept="image/png,image/jpeg,image/webp" ${state.cloudinaryEnabled?'':'disabled'}><div class="help-text">${state.cloudinaryEnabled?'Cloudinary aktif. File maksimum 2 MB.':'Cloudinary belum dikonfigurasi. Sistem memakai logo lokal bawaan.'}</div></div></div><div class="alert info" style="margin-top:16px">Aset lokal tersedia pada <strong>/assets/img/logo-bumdes.webp</strong>. Logo tetap tampil meskipun Cloudinary belum aktif.</div><button id="save-settings" class="button primary full" style="margin-top:18px">Simpan Pengaturan</button></div></article></div>`;
  const file=document.querySelector('#settings-logo-file');
  file?.addEventListener('change',async()=>{const selected=file.files[0];if(!selected)return;if(selected.size>2*1024*1024){file.value='';return toast('Ukuran logo maksimal 2 MB.','warning');}try{const uploaded=await uploadCloudinary(selected,'bumdes-pos/branding');const form=document.querySelector('#settings-form');form.elements.logo_url.value=uploaded.secure_url;form.elements.logo_public_id.value=uploaded.public_id;document.querySelector('#settings-logo-preview').src=uploaded.secure_url;toast('Logo berhasil diunggah.');}catch(error){handleError(error);}});
  document.querySelector('#save-settings').onclick=async(event)=>{const form=document.querySelector('#settings-form');if(!form.reportValidity())return;const button=event.currentTarget;setButtonLoading(button,true);try{await put('settings',formObject(form));toast('Pengaturan berhasil disimpan.');await loadBootstrap();await renderSettings();}catch(error){handleError(error);setButtonLoading(button,false);}};
}

function openChangePassword() {
  modal({ title: 'Ganti Password', subtitle: 'Password baru cukup minimal 4 karakter.', body: `<form id="password-form" class="form-grid"><label class="field span-2"><span>Password saat ini</span><input name="current_password" type="password" required></label><label class="field"><span>Password baru</span><input name="new_password" type="password" required minlength="4"></label><label class="field"><span>Ulangi password baru</span><input name="confirm_password" type="password" required minlength="4"></label><div class="span-2 help-text">Minimal 4 karakter.</div></form>`, footer: `<button class="button outline" data-modal-close="button">Nanti</button><button id="change-password-submit" class="button primary">Ganti Password</button>` });
  document.querySelector('#change-password-submit').onclick=async(event)=>{const form=document.querySelector('#password-form');if(!form.reportValidity())return;const values=formObject(form);if(values.new_password!==values.confirm_password)return toast('Konfirmasi password tidak sama.','warning');const button=event.currentTarget;setButtonLoading(button,true);try{await post('auth/change-password',values);closeModal();showLogin({clearForm:true});toast('Password diperbarui. Silakan masuk kembali menggunakan password baru.','success','Password berhasil diubah');}catch(error){handleError(error,{authAction:true,title:'Gagal mengganti password'});setButtonLoading(button,false);}};
}

el.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setButtonLoading(el.loginButton, true, 'Memeriksa...');
  try {
    const values = formObject(el.loginForm);
    await post('auth/login', values);
    el.loginForm.reset();
    await showApp();
    toast('Selamat datang di BUMDes Coppo Awi POS.');
  } catch (error) {
    handleError(error, { authAction: true, title: 'Login gagal' });
  } finally {
    setButtonLoading(el.loginButton, false);
  }
});

document.querySelector('#toggle-password').addEventListener('click', () => {
  const input = document.querySelector('#login-password'); input.type = input.type === 'password' ? 'text' : 'password';
});

document.querySelectorAll('[data-quick-login]').forEach((button) => {
  button.addEventListener('click', () => {
    const role = button.dataset.quickLogin;
    document.querySelector('#login-username').value = role;
    document.querySelector('#login-password').value = role;
    el.loginForm.requestSubmit();
  });
});
document.querySelector('#logout-button').addEventListener('click', async () => {
  try { await post('auth/logout', {}); } catch {}
  showLogin({ clearForm: true });
  toast('Anda telah keluar dari aplikasi.', 'success', 'Logout berhasil');
});
document.querySelector('#mobile-menu-button').addEventListener('click', () => el.sidebar.classList.toggle('open'));
document.querySelector('#quick-pos-button').addEventListener('click', () => navigate('pos'));
el.outletSelect.addEventListener('change', async () => { state.currentOutletId = el.outletSelect.value; state.cart = []; await navigate(state.currentView); });
document.querySelector('.user-card').addEventListener('dblclick', openChangePassword);

window.addEventListener('online', () => toast('Koneksi internet kembali tersedia.'));
window.addEventListener('offline', () => toast('Anda sedang offline. Transaksi tidak dapat diselesaikan.', 'warning'));

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));

(async function init() {
  try {
    await get('auth/me');
    await showApp();
  } catch (error) {
    showLogin();
    if (!(error instanceof ApiError && error.status === 401)) {
      handleError(error, { authAction: true, title: 'Aplikasi belum dapat dimuat' });
    }
  }
})();
