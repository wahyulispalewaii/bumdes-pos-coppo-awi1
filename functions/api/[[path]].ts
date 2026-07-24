import type { AuthUser, Env, RequestContext } from '../lib/types';
import { HttpError, dateRange, fail, getClientIp, integerMoney, json, ok, optionalString, pagination, readJson, requireNumber, requireString } from '../lib/http';
import { assertOutletAccess, assertRoles, clearSessionCookie, createSession, getCurrentUser, hashPassword, revokeSession, sessionCookie, verifyPassword } from '../lib/auth';
import { auditStatement, writeAudit } from '../lib/audit';
import { createCloudinarySignature } from '../lib/cloudinary';

type JsonRecord = Record<string, unknown>;

const PRODUCT_WRITE_ROLES: AuthUser['role'][] = ['ADMIN', 'MANAGER', 'INVENTORY'];
const REPORT_ROLES: AuthUser['role'][] = ['ADMIN', 'MANAGER', 'FINANCE', 'INVENTORY', 'VIEWER'];
const MANAGEMENT_ROLES: AuthUser['role'][] = ['ADMIN', 'MANAGER'];

function normalizePath(pathname: string): string[] {
  return pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

function isMethod(request: Request, method: string): boolean {
  return request.method.toUpperCase() === method;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function localDateTimeParts(): { date: string; time: string } {
  const value = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  return { date: value.slice(0, 10).replace(/-/g, ''), time: value.slice(11, 19).replace(/:/g, '') };
}

function documentNumber(prefix: string, outletCode = 'OUT01'): string {
  const { date, time } = localDateTimeParts();
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
  return `${prefix}-${outletCode}-${date}-${time}-${suffix}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function utcRangeForMakassar(from: string, to: string): { start: string; end: string } {
  return {
    start: new Date(`${from}T00:00:00.000+08:00`).toISOString(),
    end: new Date(`${to}T23:59:59.999+08:00`).toISOString(),
  };
}

function requireUser(ctx: RequestContext): AuthUser {
  if (!ctx.user) throw new HttpError(401, 'Sesi tidak valid atau sudah berakhir. Silakan masuk kembali.');
  return ctx.user;
}

async function getOutlet(env: Env, user: AuthUser, requestedOutletId?: unknown): Promise<{ id: string; code: string; name: string; business_unit_id: string }> {
  const outletId = String(requestedOutletId || user.default_outlet_id || '').trim();
  if (!outletId) throw new HttpError(422, 'Outlet belum ditentukan.');
  await assertOutletAccess(env, user, outletId);
  const outlet = await env.DB.prepare(`
    SELECT id, code, name, business_unit_id FROM outlets WHERE id = ? AND is_active = 1 LIMIT 1
  `).bind(outletId).first<{ id: string; code: string; name: string; business_unit_id: string }>();
  if (!outlet) throw new HttpError(404, 'Outlet tidak ditemukan atau sudah nonaktif.');
  return outlet;
}

async function currentShift(env: Env, userId: string): Promise<Record<string, unknown> | null> {
  return await env.DB.prepare(`
    SELECT cs.*, o.name AS outlet_name, o.code AS outlet_code
    FROM cash_shifts cs
    JOIN outlets o ON o.id = cs.outlet_id
    WHERE cs.cashier_id = ? AND cs.status = 'OPEN'
    ORDER BY cs.opened_at DESC LIMIT 1
  `).bind(userId).first<Record<string, unknown>>();
}

async function login(ctx: RequestContext): Promise<Response> {
  const body = await readJson<JsonRecord>(ctx.request);
  const username = requireString(body.username, 'Username', 80).trim().toLowerCase();
  const password = requireString(body.password, 'Password', 200).trim();
  const simpleLoginEnabled = String(ctx.env.SIMPLE_LOGIN_ENABLED ?? 'true').toLowerCase() !== 'false';

  const user = await ctx.env.DB.prepare(`
    SELECT id, organization_id, username, full_name, email, phone, password_hash, role,
           default_outlet_id, is_active, must_change_password, failed_login_count, locked_until
    FROM users WHERE username = ? COLLATE NOCASE LIMIT 1
  `).bind(username).first<Record<string, unknown>>();

  if (!user || Number(user.is_active) !== 1) {
    await writeAudit(ctx.env, { action: 'LOGIN_FAILED', entityType: 'AUTH', newValue: { username }, ip: ctx.ip, userAgent: ctx.userAgent });
    throw new HttpError(401, 'Username atau password salah.');
  }

  // Mode login sederhana menyediakan kredensial bawaan yang mudah digunakan.
  // Nonaktifkan dengan SIMPLE_LOGIN_ENABLED=false setelah operasional stabil.
  const simpleCredentialValid = simpleLoginEnabled && (
    (username === 'admin' && password.toLowerCase() === 'admin') ||
    (username === 'kasir' && password.toLowerCase() === 'kasir')
  );
  const storedCredentialValid = await verifyPassword(password, String(user.password_hash));
  const valid = simpleCredentialValid || storedCredentialValid;

  if (!valid) {
    // Pada mode sederhana, akun tidak dikunci akibat salah memasukkan password.
    if (!simpleLoginEnabled) {
      const failedCount = Number(user.failed_login_count || 0) + 1;
      const lockedUntil = failedCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await ctx.env.DB.prepare(`UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(failedCount, lockedUntil, user.id).run();
    }
    await writeAudit(ctx.env, { userId: String(user.id), action: 'LOGIN_FAILED', entityType: 'AUTH', entityId: String(user.id), ip: ctx.ip, userAgent: ctx.userAgent });
    throw new HttpError(401, 'Username atau password salah.');
  }

  const session = await createSession(ctx.env, String(user.id), ctx.ip, ctx.userAgent);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE users SET failed_login_count = 0, locked_until = NULL, must_change_password = CASE WHEN ? = 1 THEN 0 ELSE must_change_password END, last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(simpleLoginEnabled ? 1 : 0, user.id),
    auditStatement(ctx.env, { userId: String(user.id), action: 'LOGIN_SUCCESS', entityType: 'AUTH', entityId: String(user.id), ip: ctx.ip, userAgent: ctx.userAgent }),
  ]);

  const response = ok({
    user: {
      id: user.id,
      organization_id: user.organization_id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      default_outlet_id: user.default_outlet_id,
      must_change_password: simpleLoginEnabled ? 0 : user.must_change_password,
    },
  }, 'Login berhasil.');
  response.headers.append('Set-Cookie', sessionCookie(session.token, session.expiresAt));
  return response;
}

async function logout(ctx: RequestContext): Promise<Response> {
  if (ctx.user) {
    await writeAudit(ctx.env, { userId: ctx.user.id, action: 'LOGOUT', entityType: 'AUTH', entityId: ctx.user.id, ip: ctx.ip, userAgent: ctx.userAgent });
  }
  await revokeSession(ctx.env, ctx.request);
  const response = ok(null, 'Anda telah keluar.');
  response.headers.append('Set-Cookie', clearSessionCookie());
  return response;
}

async function authMe(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  const outletAccess = await ctx.env.DB.prepare(`
    SELECT o.id, o.code, o.name, bu.name AS business_unit_name
    FROM user_outlet_access uoa
    JOIN outlets o ON o.id = uoa.outlet_id
    JOIN business_units bu ON bu.id = o.business_unit_id
    WHERE uoa.user_id = ? AND o.is_active = 1
    ORDER BY o.name
  `).bind(user.id).all<Record<string, unknown>>();
  const organization = await ctx.env.DB.prepare(`SELECT * FROM organizations WHERE id = ? LIMIT 1`).bind(user.organization_id).first<Record<string, unknown>>();
  return ok({ user, organization, outlets: outletAccess.results || [] });
}

async function changePassword(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  const body = await readJson<JsonRecord>(ctx.request);
  const currentPassword = requireString(body.current_password, 'Password saat ini', 200);
  const newPassword = requireString(body.new_password, 'Password baru', 200);
  if (newPassword.length < 4) {
    throw new HttpError(422, 'Password baru minimal 4 karakter.');
  }
  const record = await ctx.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first<{ password_hash: string }>();
  if (!record || !(await verifyPassword(currentPassword, record.password_hash))) throw new HttpError(401, 'Password saat ini tidak sesuai.');
  const passwordHash = await hashPassword(newPassword);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(passwordHash, user.id),
    ctx.env.DB.prepare(`UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ?`).bind(user.id),
    auditStatement(ctx.env, { userId: user.id, action: 'CHANGE_PASSWORD', entityType: 'USER', entityId: user.id, ip: ctx.ip, userAgent: ctx.userAgent }),
  ]);
  const response = ok(null, 'Password berhasil diperbarui. Silakan login kembali.');
  response.headers.append('Set-Cookie', clearSessionCookie());
  return response;
}

async function bootstrap(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  const [categories, units, expenseCategories, suppliers, organization, outlets] = await Promise.all([
    ctx.env.DB.prepare(`SELECT id, name FROM categories WHERE is_active = 1 ORDER BY name`).all(),
    ctx.env.DB.prepare(`SELECT id, code, name FROM units WHERE is_active = 1 ORDER BY name`).all(),
    ctx.env.DB.prepare(`SELECT id, name, category_type FROM expense_categories WHERE is_active = 1 ORDER BY name`).all(),
    ctx.env.DB.prepare(`SELECT id, code, name, phone FROM suppliers WHERE is_active = 1 ORDER BY name`).all(),
    ctx.env.DB.prepare(`SELECT * FROM organizations WHERE id = ? LIMIT 1`).bind(user.organization_id).first(),
    ctx.env.DB.prepare(`
      SELECT DISTINCT o.id, o.code, o.name, o.business_unit_id, bu.name AS business_unit_name
      FROM outlets o JOIN business_units bu ON bu.id = o.business_unit_id
      LEFT JOIN user_outlet_access uoa ON uoa.outlet_id = o.id
      WHERE o.is_active = 1 AND (? IN ('ADMIN','MANAGER','FINANCE') OR uoa.user_id = ?)
      ORDER BY o.name
    `).bind(user.role, user.id).all(),
  ]);
  return ok({
    user,
    organization,
    categories: categories.results || [],
    units: units.results || [],
    expense_categories: expenseCategories.results || [],
    suppliers: suppliers.results || [],
    outlets: outlets.results || [],
    current_shift: await currentShift(ctx.env, user.id),
    cloudinary_enabled: Boolean(ctx.env.CLOUDINARY_CLOUD_NAME && ctx.env.CLOUDINARY_API_KEY && ctx.env.CLOUDINARY_API_SECRET),
  });
}

async function dashboard(ctx: RequestContext, url: URL): Promise<Response> {
  const user = requireUser(ctx);
  const { from, to } = dateRange(url);
  const outlet = await getOutlet(ctx.env, user, url.searchParams.get('outlet_id'));
  const { start, end } = utcRangeForMakassar(from, to);

  const [sales, payments, expenses, lowStock, topProducts, recentSales, daily] = await Promise.all([
    ctx.env.DB.prepare(`
      SELECT COALESCE(SUM(grand_total),0) AS sales_total, COUNT(*) AS transactions_count,
             COALESCE(SUM(profit_total),0) AS gross_profit,
             COALESCE(AVG(grand_total),0) AS average_transaction
      FROM sales WHERE outlet_id = ? AND status = 'COMPLETED' AND completed_at BETWEEN ? AND ?
    `).bind(outlet.id, start, end).first(),
    ctx.env.DB.prepare(`
      SELECT sp.payment_method, COALESCE(SUM(sp.amount),0) AS total
      FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
      WHERE s.outlet_id = ? AND s.status = 'COMPLETED' AND sp.status = 'PAID' AND s.completed_at BETWEEN ? AND ?
      GROUP BY sp.payment_method
    `).bind(outlet.id, start, end).all(),
    ctx.env.DB.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE outlet_id = ? AND expense_date BETWEEN ? AND ?`)
      .bind(outlet.id, from, to).first(),
    ctx.env.DB.prepare(`
      SELECT COUNT(*) AS total FROM products p JOIN stock_balances sb ON sb.product_id = p.id
      WHERE sb.outlet_id = ? AND p.is_active = 1 AND p.track_stock = 1 AND sb.quantity <= p.minimum_stock
    `).bind(outlet.id).first(),
    ctx.env.DB.prepare(`
      SELECT si.product_name_snapshot AS name, SUM(si.quantity) AS quantity, SUM(si.line_total) AS total
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.outlet_id = ? AND s.status = 'COMPLETED' AND s.completed_at BETWEEN ? AND ?
      GROUP BY si.product_id, si.product_name_snapshot ORDER BY quantity DESC LIMIT 5
    `).bind(outlet.id, start, end).all(),
    ctx.env.DB.prepare(`
      SELECT s.id, s.transaction_number, s.grand_total, s.completed_at, u.full_name AS cashier_name
      FROM sales s JOIN users u ON u.id = s.cashier_id
      WHERE s.outlet_id = ? ORDER BY s.created_at DESC LIMIT 6
    `).bind(outlet.id).all(),
    ctx.env.DB.prepare(`
      SELECT date(datetime(completed_at,'+8 hours')) AS date, SUM(grand_total) AS total
      FROM sales WHERE outlet_id = ? AND status = 'COMPLETED' AND completed_at BETWEEN ? AND ?
      GROUP BY date(datetime(completed_at,'+8 hours')) ORDER BY date
    `).bind(outlet.id, start, end).all(),
  ]);

  const paymentMap: Record<string, number> = {};
  for (const row of payments.results || []) paymentMap[String((row as JsonRecord).payment_method)] = Number((row as JsonRecord).total || 0);

  return ok({
    range: { from, to }, outlet,
    metrics: {
      sales_total: Number((sales as JsonRecord)?.sales_total || 0),
      transactions_count: Number((sales as JsonRecord)?.transactions_count || 0),
      gross_profit: Number((sales as JsonRecord)?.gross_profit || 0),
      average_transaction: Math.round(Number((sales as JsonRecord)?.average_transaction || 0)),
      expenses_total: Number((expenses as JsonRecord)?.total || 0),
      net_operating: Number((sales as JsonRecord)?.gross_profit || 0) - Number((expenses as JsonRecord)?.total || 0),
      cash_total: paymentMap.CASH || 0,
      noncash_total: Object.entries(paymentMap).filter(([key]) => key !== 'CASH').reduce((sum, [, value]) => sum + value, 0),
      low_stock_count: Number((lowStock as JsonRecord)?.total || 0),
    },
    payments: paymentMap,
    top_products: topProducts.results || [],
    recent_sales: recentSales.results || [],
    daily_sales: daily.results || [],
  });
}

async function listProducts(ctx: RequestContext, url: URL): Promise<Response> {
  const user = requireUser(ctx);
  const outlet = await getOutlet(ctx.env, user, url.searchParams.get('outlet_id'));
  const search = `%${(url.searchParams.get('q') || '').trim()}%`;
  const categoryId = url.searchParams.get('category_id') || '';
  const activeOnly = url.searchParams.get('active') !== 'all';
  const { limit, offset } = pagination(url, 500);
  const rows = await ctx.env.DB.prepare(`
    SELECT p.*, c.name AS category_name, u.name AS unit_name, u.code AS unit_code,
           COALESCE(sb.quantity,0) AS stock_quantity
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    JOIN units u ON u.id = p.unit_id
    LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.outlet_id = ?
    WHERE (p.name LIKE ? OR p.sku LIKE ? OR COALESCE(p.barcode,'') LIKE ?)
      AND (? = '' OR p.category_id = ?)
      AND (? = 0 OR p.is_active = 1)
    ORDER BY p.name LIMIT ? OFFSET ?
  `).bind(outlet.id, search, search, search, categoryId, categoryId, activeOnly ? 1 : 0, limit, offset).all();
  return ok({ outlet, products: rows.results || [] });
}

async function createProduct(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, PRODUCT_WRITE_ROLES);
  const body = await readJson<JsonRecord>(ctx.request);
  const outlet = await getOutlet(ctx.env, user, body.outlet_id);
  const id = crypto.randomUUID();
  const sku = requireString(body.sku, 'SKU', 80).toUpperCase();
  const name = requireString(body.name, 'Nama produk', 180);
  const unitId = requireString(body.unit_id, 'Satuan', 100);
  const categoryId = optionalString(body.category_id, 100);
  const purchasePrice = integerMoney(body.purchase_price, 'Harga beli');
  const sellingPrice = integerMoney(body.selling_price, 'Harga jual');
  const minimumStock = requireNumber(body.minimum_stock ?? 0, 'Stok minimum');
  const initialStock = requireNumber(body.initial_stock ?? 0, 'Stok awal');
  const trackStock = asBoolean(body.track_stock, true);
  const barcode = optionalString(body.barcode, 100);
  const imageUrl = optionalString(body.image_url, 1000);
  const imagePublicId = optionalString(body.image_public_id, 500);
  const statements: D1PreparedStatement[] = [
    ctx.env.DB.prepare(`
      INSERT INTO products (
        id, business_unit_id, category_id, unit_id, sku, barcode, name, description,
        purchase_price, selling_price, minimum_stock, track_stock, image_url, image_public_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, outlet.business_unit_id, categoryId, unitId, sku, barcode, name, optionalString(body.description, 1000), purchasePrice, sellingPrice, minimumStock, trackStock ? 1 : 0, imageUrl, imagePublicId),
    ctx.env.DB.prepare(`INSERT INTO stock_balances (id, outlet_id, product_id, quantity) VALUES (?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), outlet.id, id, trackStock ? initialStock : 0),
  ];
  if (trackStock && initialStock > 0) {
    statements.push(ctx.env.DB.prepare(`
      INSERT INTO stock_movements (
        id, outlet_id, product_id, movement_type, reference_type, reference_id,
        quantity_before, quantity_change, quantity_after, unit_cost, notes, created_by
      ) VALUES (?, ?, ?, 'OPENING_BALANCE', 'PRODUCT', ?, 0, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), outlet.id, id, id, initialStock, initialStock, purchasePrice, 'Stok awal produk', user.id));
  }
  statements.push(auditStatement(ctx.env, { userId: user.id, action: 'CREATE_PRODUCT', entityType: 'PRODUCT', entityId: id, newValue: { sku, name, sellingPrice, initialStock }, ip: ctx.ip, userAgent: ctx.userAgent }));
  await ctx.env.DB.batch(statements);
  return ok({ id }, 'Produk berhasil ditambahkan.');
}

async function updateProduct(ctx: RequestContext, productId: string): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, PRODUCT_WRITE_ROLES);
  const body = await readJson<JsonRecord>(ctx.request);
  const old = await ctx.env.DB.prepare('SELECT * FROM products WHERE id = ? LIMIT 1').bind(productId).first<JsonRecord>();
  if (!old) throw new HttpError(404, 'Produk tidak ditemukan.');
  const name = requireString(body.name ?? old.name, 'Nama produk', 180);
  const sku = requireString(body.sku ?? old.sku, 'SKU', 80).toUpperCase();
  const purchasePrice = integerMoney(body.purchase_price ?? old.purchase_price, 'Harga beli');
  const sellingPrice = integerMoney(body.selling_price ?? old.selling_price, 'Harga jual');
  const minimumStock = requireNumber(body.minimum_stock ?? old.minimum_stock, 'Stok minimum');
  const isActive = asBoolean(body.is_active, Number(old.is_active) === 1);
  const trackStock = asBoolean(body.track_stock, Number(old.track_stock) === 1);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`
      UPDATE products SET category_id = ?, unit_id = ?, sku = ?, barcode = ?, name = ?, description = ?,
        purchase_price = ?, selling_price = ?, minimum_stock = ?, track_stock = ?, image_url = ?, image_public_id = ?,
        is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(
      optionalString(body.category_id ?? old.category_id, 100), requireString(body.unit_id ?? old.unit_id, 'Satuan', 100), sku,
      optionalString(body.barcode ?? old.barcode, 100), name, optionalString(body.description ?? old.description, 1000),
      purchasePrice, sellingPrice, minimumStock, trackStock ? 1 : 0,
      optionalString(body.image_url ?? old.image_url, 1000), optionalString(body.image_public_id ?? old.image_public_id, 500), isActive ? 1 : 0, productId,
    ),
    auditStatement(ctx.env, { userId: user.id, action: 'UPDATE_PRODUCT', entityType: 'PRODUCT', entityId: productId, oldValue: old, newValue: { ...body, sku, name, purchasePrice, sellingPrice }, ip: ctx.ip, userAgent: ctx.userAgent }),
  ]);
  return ok({ id: productId }, 'Produk berhasil diperbarui.');
}

async function createCategory(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, PRODUCT_WRITE_ROLES);
  const body = await readJson<JsonRecord>(ctx.request);
  const outlet = await getOutlet(ctx.env, user, body.outlet_id);
  const id = crypto.randomUUID();
  const name = requireString(body.name, 'Nama kategori', 120);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`INSERT INTO categories (id, business_unit_id, name, description) VALUES (?, ?, ?, ?)`)
      .bind(id, outlet.business_unit_id, name, optionalString(body.description, 500)),
    auditStatement(ctx.env, { userId: user.id, action: 'CREATE_CATEGORY', entityType: 'CATEGORY', entityId: id, newValue: { name }, ip: ctx.ip, userAgent: ctx.userAgent }),
  ]);
  return ok({ id, name }, 'Kategori berhasil ditambahkan.');
}

async function stockList(ctx: RequestContext, url: URL): Promise<Response> {
  const user = requireUser(ctx);
  const outlet = await getOutlet(ctx.env, user, url.searchParams.get('outlet_id'));
  const search = `%${(url.searchParams.get('q') || '').trim()}%`;
  const rows = await ctx.env.DB.prepare(`
    SELECT p.id, p.sku, p.name, p.purchase_price, p.selling_price, p.minimum_stock, p.track_stock,
           c.name AS category_name, u.name AS unit_name, COALESCE(sb.quantity,0) AS quantity,
           CASE WHEN p.track_stock = 1 AND COALESCE(sb.quantity,0) <= p.minimum_stock THEN 1 ELSE 0 END AS is_low
    FROM products p
    JOIN units u ON u.id = p.unit_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.outlet_id = ?
    WHERE p.is_active = 1 AND (p.name LIKE ? OR p.sku LIKE ?)
    ORDER BY is_low DESC, p.name
  `).bind(outlet.id, search, search).all();
  return ok({ outlet, stocks: rows.results || [] });
}

async function adjustStock(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, PRODUCT_WRITE_ROLES);
  const body = await readJson<JsonRecord>(ctx.request);
  const outlet = await getOutlet(ctx.env, user, body.outlet_id);
  const productId = requireString(body.product_id, 'Produk', 100);
  const mode = requireString(body.mode, 'Jenis penyesuaian', 30).toUpperCase();
  const quantity = requireNumber(body.quantity, 'Jumlah', 0.000001);
  const notes = requireString(body.notes, 'Alasan penyesuaian', 500);
  const product = await ctx.env.DB.prepare(`
    SELECT p.id, p.name, p.purchase_price, p.track_stock, COALESCE(sb.quantity,0) AS current_quantity
    FROM products p LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.outlet_id = ?
    WHERE p.id = ? LIMIT 1
  `).bind(outlet.id, productId).first<JsonRecord>();
  if (!product) throw new HttpError(404, 'Produk tidak ditemukan.');
  if (Number(product.track_stock) !== 1) throw new HttpError(422, 'Produk jasa tidak menggunakan stok.');
  const before = Number(product.current_quantity || 0);
  let change = 0;
  let movementType = 'ADJUSTMENT_IN';
  if (mode === 'IN') change = quantity;
  else if (mode === 'OUT') { change = -quantity; movementType = 'ADJUSTMENT_OUT'; }
  else if (mode === 'SET') { change = quantity - before; movementType = 'STOCK_OPNAME'; }
  else throw new HttpError(422, 'Mode penyesuaian harus IN, OUT, atau SET.');
  const after = before + change;
  if (after < 0) throw new HttpError(422, 'Stok tidak mencukupi untuk pengurangan tersebut.');
  const movementId = crypto.randomUUID();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`INSERT INTO stock_balances (id, outlet_id, product_id, quantity) VALUES (?, ?, ?, ?)
      ON CONFLICT(outlet_id, product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP`)
      .bind(crypto.randomUUID(), outlet.id, productId, after),
    ctx.env.DB.prepare(`
      INSERT INTO stock_movements (
        id, outlet_id, product_id, movement_type, reference_type, reference_id,
        quantity_before, quantity_change, quantity_after, unit_cost, notes, created_by
      ) VALUES (?, ?, ?, ?, 'ADJUSTMENT', ?, ?, ?, ?, ?, ?, ?)
    `).bind(movementId, outlet.id, productId, movementType, movementId, before, change, after, Number(product.purchase_price || 0), notes, user.id),
    auditStatement(ctx.env, { userId: user.id, action: 'ADJUST_STOCK', entityType: 'STOCK', entityId: productId, oldValue: { quantity: before }, newValue: { quantity: after, change, notes }, ip: ctx.ip, userAgent: ctx.userAgent }),
  ]);
  return ok({ product_id: productId, quantity_before: before, quantity_change: change, quantity_after: after }, 'Stok berhasil disesuaikan.');
}

async function stockMovements(ctx: RequestContext, url: URL): Promise<Response> {
  const user = requireUser(ctx);
  const outlet = await getOutlet(ctx.env, user, url.searchParams.get('outlet_id'));
  const { limit, offset } = pagination(url, 300);
  const productId = url.searchParams.get('product_id') || '';
  const rows = await ctx.env.DB.prepare(`
    SELECT sm.*, p.sku, p.name AS product_name, u.full_name AS user_name
    FROM stock_movements sm JOIN products p ON p.id = sm.product_id JOIN users u ON u.id = sm.created_by
    WHERE sm.outlet_id = ? AND (? = '' OR sm.product_id = ?)
    ORDER BY sm.created_at DESC LIMIT ? OFFSET ?
  `).bind(outlet.id, productId, productId, limit, offset).all();
  return ok({ movements: rows.results || [] });
}

async function createSale(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, ['ADMIN', 'MANAGER', 'CASHIER']);
  const body = await readJson<JsonRecord>(ctx.request);
  const outlet = await getOutlet(ctx.env, user, body.outlet_id);
  const shift = await currentShift(ctx.env, user.id);
  if (!shift || String(shift.outlet_id) !== outlet.id) throw new HttpError(409, 'Buka shift kasir pada outlet ini sebelum melakukan transaksi.');

  const idempotencyKey = requireString(body.idempotency_key, 'Idempotency key', 120);
  const existing = await ctx.env.DB.prepare(`SELECT id, transaction_number, grand_total FROM sales WHERE idempotency_key = ? LIMIT 1`)
    .bind(idempotencyKey).first<JsonRecord>();
  if (existing) return ok(existing, 'Transaksi sebelumnya sudah tercatat.');

  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(422, 'Keranjang transaksi masih kosong.');
  if (body.items.length > 100) throw new HttpError(422, 'Maksimal 100 jenis produk per transaksi.');

  const requestedItems = body.items.map((raw) => {
    const item = raw as JsonRecord;
    return { productId: requireString(item.product_id, 'Produk', 100), quantity: requireNumber(item.quantity, 'Jumlah', 0.000001) };
  });
  const uniqueIds = [...new Set(requestedItems.map((item) => item.productId))];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const productsResult = await ctx.env.DB.prepare(`
    SELECT p.id, p.sku, p.name, p.selling_price, p.purchase_price, p.track_stock, u.name AS unit_name,
           COALESCE(sb.quantity,0) AS stock_quantity
    FROM products p JOIN units u ON u.id = p.unit_id
    LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.outlet_id = ?
    WHERE p.id IN (${placeholders}) AND p.is_active = 1
  `).bind(outlet.id, ...uniqueIds).all<JsonRecord>();
  const productMap = new Map((productsResult.results || []).map((row) => [String(row.id), row]));
  if (productMap.size !== uniqueIds.length) throw new HttpError(422, 'Terdapat produk tidak aktif atau tidak ditemukan.');

  const consolidated = new Map<string, number>();
  for (const item of requestedItems) consolidated.set(item.productId, (consolidated.get(item.productId) || 0) + item.quantity);
  const calculatedItems: Array<JsonRecord> = [];
  let subtotal = 0;
  let costTotal = 0;
  for (const [productId, quantity] of consolidated.entries()) {
    const product = productMap.get(productId)!;
    const sellingPrice = Number(product.selling_price || 0);
    const purchasePrice = Number(product.purchase_price || 0);
    const lineTotal = Math.round(sellingPrice * quantity);
    const lineCost = Math.round(purchasePrice * quantity);
    if (Number(product.track_stock) === 1 && Number(product.stock_quantity || 0) < quantity) {
      throw new HttpError(422, `Stok ${String(product.name)} tidak mencukupi. Tersedia ${Number(product.stock_quantity || 0)}.`);
    }
    subtotal += lineTotal;
    costTotal += lineCost;
    calculatedItems.push({ ...product, quantity, line_total: lineTotal, line_cost: lineCost });
  }

  const discountTotal = integerMoney(body.discount_total ?? 0, 'Diskon');
  if (discountTotal > subtotal) throw new HttpError(422, 'Diskon tidak boleh melebihi subtotal.');
  const taxTotal = integerMoney(body.tax_total ?? 0, 'Pajak');
  const grandTotal = subtotal - discountTotal + taxTotal;
  if (grandTotal < 0) throw new HttpError(422, 'Total transaksi tidak valid.');

  if (!Array.isArray(body.payments) || body.payments.length === 0) throw new HttpError(422, 'Metode pembayaran wajib dipilih.');
  const allowedMethods = new Set(['CASH', 'QRIS', 'TRANSFER', 'EWALLET', 'CREDIT', 'OTHER']);
  const payments = body.payments.map((raw) => {
    const payment = raw as JsonRecord;
    const method = requireString(payment.payment_method, 'Metode pembayaran', 20).toUpperCase();
    if (!allowedMethods.has(method)) throw new HttpError(422, 'Metode pembayaran tidak valid.');
    const amount = integerMoney(payment.amount, 'Nominal pembayaran');
    const tendered = method === 'CASH' ? integerMoney(payment.tendered_amount ?? amount, 'Uang diterima') : amount;
    if (method === 'CASH' && tendered < amount) throw new HttpError(422, 'Uang tunai yang diterima kurang dari nominal pembayaran.');
    return { method, amount, tendered, change: Math.max(0, tendered - amount), reference: optionalString(payment.reference_number, 150) };
  });
  const paymentTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (paymentTotal !== grandTotal) throw new HttpError(422, 'Jumlah alokasi pembayaran harus sama dengan total transaksi.');

  const saleId = crypto.randomUUID();
  const transactionNumber = documentNumber('SL', outlet.code);
  const completedAt = isoNow();
  const profitTotal = grandTotal - costTotal;
  const statements: D1PreparedStatement[] = [
    ctx.env.DB.prepare(`
      INSERT INTO sales (
        id, organization_id, business_unit_id, outlet_id, shift_id, transaction_number, customer_id,
        customer_name_snapshot, cashier_id, status, subtotal, discount_total, tax_total, grand_total,
        cost_total, profit_total, notes, idempotency_key, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      saleId, user.organization_id, outlet.business_unit_id, outlet.id, shift.id, transactionNumber,
      optionalString(body.customer_id, 100), optionalString(body.customer_name, 180) || 'Pelanggan Umum', user.id,
      subtotal, discountTotal, taxTotal, grandTotal, costTotal, profitTotal, optionalString(body.notes, 500), idempotencyKey, completedAt,
    ),
  ];

  for (const item of calculatedItems) {
    statements.push(ctx.env.DB.prepare(`
      INSERT INTO sale_items (
        id, sale_id, product_id, product_sku_snapshot, product_name_snapshot, unit_name_snapshot,
        quantity, unit_price, unit_cost, discount_amount, tax_amount, line_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `).bind(crypto.randomUUID(), saleId, item.id, item.sku, item.name, item.unit_name, item.quantity, item.selling_price, item.purchase_price, item.line_total));
    if (Number(item.track_stock) === 1) {
      const before = Number(item.stock_quantity || 0);
      const after = before - Number(item.quantity);
      statements.push(ctx.env.DB.prepare(`UPDATE stock_balances SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE outlet_id = ? AND product_id = ?`)
        .bind(item.quantity, outlet.id, item.id));
      statements.push(ctx.env.DB.prepare(`
        INSERT INTO stock_movements (
          id, outlet_id, product_id, movement_type, reference_type, reference_id,
          quantity_before, quantity_change, quantity_after, unit_cost, notes, created_by
        ) VALUES (?, ?, ?, 'SALE', 'SALE', ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), outlet.id, item.id, saleId, before, -Number(item.quantity), after, item.purchase_price, transactionNumber, user.id));
    }
  }

  for (const payment of payments) {
    statements.push(ctx.env.DB.prepare(`
      INSERT INTO sale_payments (
        id, sale_id, payment_method, amount, tendered_amount, change_amount, reference_number, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PAID', ?)
    `).bind(crypto.randomUUID(), saleId, payment.method, payment.amount, payment.tendered, payment.change, payment.reference, user.id));
  }
  statements.push(auditStatement(ctx.env, { userId: user.id, action: 'CREATE_SALE', entityType: 'SALE', entityId: saleId, newValue: { transactionNumber, grandTotal, itemCount: calculatedItems.length }, ip: ctx.ip, userAgent: ctx.userAgent }));

  await ctx.env.DB.batch(statements);
  return ok({ id: saleId, transaction_number: transactionNumber, grand_total: grandTotal, change_total: payments.reduce((sum, payment) => sum + payment.change, 0) }, 'Transaksi berhasil disimpan.');
}

async function listSales(ctx: RequestContext, url: URL): Promise<Response> {
  const user = requireUser(ctx);
  const outlet = await getOutlet(ctx.env, user, url.searchParams.get('outlet_id'));
  const { limit, offset } = pagination(url, 300);
  const status = url.searchParams.get('status') || '';
  const query = `%${(url.searchParams.get('q') || '').trim()}%`;
  const { from, to } = dateRange(url);
  const { start, end } = utcRangeForMakassar(from, to);
  const rows = await ctx.env.DB.prepare(`
    SELECT s.id, s.transaction_number, s.status, s.subtotal, s.discount_total, s.tax_total, s.grand_total,
           s.profit_total, s.customer_name_snapshot, s.completed_at, s.voided_at, s.void_reason,
           u.full_name AS cashier_name,
           GROUP_CONCAT(sp.payment_method, ', ') AS payment_methods
    FROM sales s JOIN users u ON u.id = s.cashier_id
    LEFT JOIN sale_payments sp ON sp.sale_id = s.id
    WHERE s.outlet_id = ? AND COALESCE(s.completed_at,s.created_at) BETWEEN ? AND ?
      AND (? = '' OR s.status = ?) AND (s.transaction_number LIKE ? OR COALESCE(s.customer_name_snapshot,'') LIKE ?)
    GROUP BY s.id ORDER BY s.created_at DESC LIMIT ? OFFSET ?
  `).bind(outlet.id, start, end, status, status, query, query, limit, offset).all();
  return ok({ sales: rows.results || [] });
}

async function saleDetail(ctx: RequestContext, saleId: string): Promise<Response> {
  const user = requireUser(ctx);
  const sale = await ctx.env.DB.prepare(`
    SELECT s.*, u.full_name AS cashier_name, o.name AS outlet_name, o.code AS outlet_code
    FROM sales s JOIN users u ON u.id = s.cashier_id JOIN outlets o ON o.id = s.outlet_id
    WHERE s.id = ? LIMIT 1
  `).bind(saleId).first<JsonRecord>();
  if (!sale) throw new HttpError(404, 'Transaksi tidak ditemukan.');
  await assertOutletAccess(ctx.env, user, String(sale.outlet_id));
  const [items, payments, organization] = await Promise.all([
    ctx.env.DB.prepare(`SELECT * FROM sale_items WHERE sale_id = ? ORDER BY created_at`).bind(saleId).all(),
    ctx.env.DB.prepare(`SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY created_at`).bind(saleId).all(),
    ctx.env.DB.prepare(`SELECT * FROM organizations WHERE id = ?`).bind(sale.organization_id).first(),
  ]);
  return ok({ sale, items: items.results || [], payments: payments.results || [], organization });
}

async function voidSale(ctx: RequestContext, saleId: string): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, MANAGEMENT_ROLES);
  const body = await readJson<JsonRecord>(ctx.request);
  const reason = requireString(body.reason, 'Alasan pembatalan', 500);
  const sale = await ctx.env.DB.prepare(`SELECT * FROM sales WHERE id = ? LIMIT 1`).bind(saleId).first<JsonRecord>();
  if (!sale) throw new HttpError(404, 'Transaksi tidak ditemukan.');
  if (sale.status !== 'COMPLETED') throw new HttpError(409, 'Hanya transaksi selesai yang dapat dibatalkan.');
  await assertOutletAccess(ctx.env, user, String(sale.outlet_id));
  const items = await ctx.env.DB.prepare(`
    SELECT si.*, p.track_stock, COALESCE(sb.quantity,0) AS current_quantity
    FROM sale_items si JOIN products p ON p.id = si.product_id
    LEFT JOIN stock_balances sb ON sb.product_id = si.product_id AND sb.outlet_id = ?
    WHERE si.sale_id = ?
  `).bind(sale.outlet_id, saleId).all<JsonRecord>();
  const statements: D1PreparedStatement[] = [
    ctx.env.DB.prepare(`UPDATE sales SET status = 'VOIDED', voided_at = CURRENT_TIMESTAMP, voided_by = ?, void_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(user.id, reason, saleId),
    ctx.env.DB.prepare(`UPDATE sale_payments SET status = 'REFUNDED' WHERE sale_id = ?`).bind(saleId),
  ];
  for (const item of items.results || []) {
    if (Number(item.track_stock) !== 1) continue;
    const before = Number(item.current_quantity || 0);
    const quantity = Number(item.quantity || 0);
    statements.push(ctx.env.DB.prepare(`UPDATE stock_balances SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE outlet_id = ? AND product_id = ?`)
      .bind(quantity, sale.outlet_id, item.product_id));
    statements.push(ctx.env.DB.prepare(`
      INSERT INTO stock_movements (
        id, outlet_id, product_id, movement_type, reference_type, reference_id,
        quantity_before, quantity_change, quantity_after, unit_cost, notes, created_by
      ) VALUES (?, ?, ?, 'SALE_VOID', 'SALE', ?, ?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), sale.outlet_id, item.product_id, saleId, before, quantity, before + quantity, item.unit_cost, reason, user.id));
  }
  statements.push(auditStatement(ctx.env, { userId: user.id, action: 'VOID_SALE', entityType: 'SALE', entityId: saleId, oldValue: sale, newValue: { status: 'VOIDED', reason }, ip: ctx.ip, userAgent: ctx.userAgent }));
  await ctx.env.DB.batch(statements);
  return ok({ id: saleId }, 'Transaksi berhasil dibatalkan dan stok telah dikembalikan.');
}

async function openShift(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, ['ADMIN', 'MANAGER', 'CASHIER']);
  const body = await readJson<JsonRecord>(ctx.request);
  if (await currentShift(ctx.env, user.id)) throw new HttpError(409, 'Anda masih memiliki shift yang terbuka.');
  const outlet = await getOutlet(ctx.env, user, body.outlet_id);
  const openingCash = integerMoney(body.opening_cash ?? 0, 'Kas awal');
  const id = crypto.randomUUID();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`INSERT INTO cash_shifts (id, outlet_id, cashier_id, opening_cash, opening_notes) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, outlet.id, user.id, openingCash, optionalString(body.notes, 500)),
    auditStatement(ctx.env, { userId: user.id, action: 'OPEN_SHIFT', entityType: 'CASH_SHIFT', entityId: id, newValue: { outlet: outlet.name, openingCash }, ip: ctx.ip, userAgent: ctx.userAgent }),
  ]);
  return ok({ id, outlet, opening_cash: openingCash }, 'Shift kasir berhasil dibuka.');
}

async function shiftExpectedCash(env: Env, shiftId: string): Promise<{ opening: number; cashSales: number; cashIn: number; cashOut: number; expected: number }> {
  const shift = await env.DB.prepare(`SELECT opening_cash FROM cash_shifts WHERE id = ?`).bind(shiftId).first<{ opening_cash: number }>();
  if (!shift) throw new HttpError(404, 'Shift tidak ditemukan.');
  const cashSales = await env.DB.prepare(`
    SELECT COALESCE(SUM(sp.amount),0) AS total FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
    WHERE s.shift_id = ? AND s.status = 'COMPLETED' AND sp.status = 'PAID' AND sp.payment_method = 'CASH'
  `).bind(shiftId).first<{ total: number }>();
  const movements = await env.DB.prepare(`
    SELECT COALESCE(SUM(CASE WHEN movement_type='IN' THEN amount ELSE 0 END),0) AS cash_in,
           COALESCE(SUM(CASE WHEN movement_type='OUT' THEN amount ELSE 0 END),0) AS cash_out
    FROM cash_movements WHERE shift_id = ?
  `).bind(shiftId).first<{ cash_in: number; cash_out: number }>();
  const opening = Number(shift.opening_cash || 0);
  const sales = Number(cashSales?.total || 0);
  const cashIn = Number(movements?.cash_in || 0);
  const cashOut = Number(movements?.cash_out || 0);
  return { opening, cashSales: sales, cashIn, cashOut, expected: opening + sales + cashIn - cashOut };
}

async function closeShift(ctx: RequestContext, shiftId: string): Promise<Response> {
  const user = requireUser(ctx);
  const body = await readJson<JsonRecord>(ctx.request);
  const shift = await ctx.env.DB.prepare(`SELECT * FROM cash_shifts WHERE id = ? LIMIT 1`).bind(shiftId).first<JsonRecord>();
  if (!shift) throw new HttpError(404, 'Shift tidak ditemukan.');
  if (String(shift.cashier_id) !== user.id && !MANAGEMENT_ROLES.includes(user.role)) throw new HttpError(403, 'Anda tidak dapat menutup shift pengguna lain.');
  if (shift.status !== 'OPEN') throw new HttpError(409, 'Shift ini sudah ditutup.');
  const breakdown = await shiftExpectedCash(ctx.env, shiftId);
  const actualCash = integerMoney(body.actual_cash, 'Kas aktual');
  const difference = actualCash - breakdown.expected;
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`
      UPDATE cash_shifts SET status = 'CLOSED', expected_cash = ?, actual_cash = ?, cash_difference = ?,
        closing_notes = ?, closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(breakdown.expected, actualCash, difference, optionalString(body.notes, 500), shiftId),
    auditStatement(ctx.env, { userId: user.id, action: 'CLOSE_SHIFT', entityType: 'CASH_SHIFT', entityId: shiftId, oldValue: shift, newValue: { ...breakdown, actualCash, difference }, ip: ctx.ip, userAgent: ctx.userAgent }),
  ]);
  return ok({ id: shiftId, ...breakdown, actual_cash: actualCash, difference }, 'Shift berhasil ditutup.');
}

async function listShifts(ctx: RequestContext, url: URL): Promise<Response> {
  const user = requireUser(ctx);
  const outlet = await getOutlet(ctx.env, user, url.searchParams.get('outlet_id'));
  const { limit, offset } = pagination(url, 200);
  const rows = await ctx.env.DB.prepare(`
    SELECT cs.*, u.full_name AS cashier_name, o.name AS outlet_name
    FROM cash_shifts cs JOIN users u ON u.id = cs.cashier_id JOIN outlets o ON o.id = cs.outlet_id
    WHERE cs.outlet_id = ? AND (? IN ('ADMIN','MANAGER','FINANCE') OR cs.cashier_id = ?)
    ORDER BY cs.opened_at DESC LIMIT ? OFFSET ?
  `).bind(outlet.id, user.role, user.id, limit, offset).all();
  return ok({ current: await currentShift(ctx.env, user.id), shifts: rows.results || [] });
}

async function createExpense(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, ['ADMIN', 'MANAGER', 'FINANCE', 'CASHIER']);
  const body = await readJson<JsonRecord>(ctx.request);
  const outlet = await getOutlet(ctx.env, user, body.outlet_id);
  const amount = integerMoney(body.amount, 'Jumlah pengeluaran', 1);
  const paymentMethod = requireString(body.payment_method, 'Metode pembayaran', 20).toUpperCase();
  if (!['CASH', 'QRIS', 'TRANSFER', 'EWALLET', 'OTHER'].includes(paymentMethod)) throw new HttpError(422, 'Metode pembayaran tidak valid.');
  const categoryId = requireString(body.category_id, 'Kategori pengeluaran', 100);
  const description = requireString(body.description, 'Keterangan', 500);
  let shift: Record<string, unknown> | null = null;
  if (paymentMethod === 'CASH') {
    shift = await currentShift(ctx.env, user.id);
    if (!shift || shift.outlet_id !== outlet.id) throw new HttpError(409, 'Pengeluaran tunai harus dicatat saat shift kasir aktif.');
  }
  const id = crypto.randomUUID();
  const expenseNumber = documentNumber('EXP', outlet.code);
  const expenseDate = String(body.expense_date || new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const statements: D1PreparedStatement[] = [
    ctx.env.DB.prepare(`
      INSERT INTO expenses (
        id, organization_id, outlet_id, shift_id, category_id, expense_number, amount, payment_method,
        description, attachment_url, attachment_public_id, expense_date, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, user.organization_id, outlet.id, shift?.id || null, categoryId, expenseNumber, amount, paymentMethod, description,
      optionalString(body.attachment_url, 1000), optionalString(body.attachment_public_id, 500), expenseDate, user.id),
  ];
  if (paymentMethod === 'CASH' && shift) {
    statements.push(ctx.env.DB.prepare(`
      INSERT INTO cash_movements (id, shift_id, outlet_id, movement_type, category, amount, reference_type, reference_id, description, created_by)
      VALUES (?, ?, ?, 'OUT', 'EXPENSE', ?, 'EXPENSE', ?, ?, ?)
    `).bind(crypto.randomUUID(), shift.id, outlet.id, amount, id, description, user.id));
  }
  statements.push(auditStatement(ctx.env, { userId: user.id, action: 'CREATE_EXPENSE', entityType: 'EXPENSE', entityId: id, newValue: { expenseNumber, amount, paymentMethod, description }, ip: ctx.ip, userAgent: ctx.userAgent }));
  await ctx.env.DB.batch(statements);
  return ok({ id, expense_number: expenseNumber }, 'Pengeluaran berhasil dicatat.');
}

async function listExpenses(ctx: RequestContext, url: URL): Promise<Response> {
  const user = requireUser(ctx);
  const outlet = await getOutlet(ctx.env, user, url.searchParams.get('outlet_id'));
  const { from, to } = dateRange(url);
  const { limit, offset } = pagination(url, 300);
  const rows = await ctx.env.DB.prepare(`
    SELECT e.*, ec.name AS category_name, u.full_name AS created_by_name
    FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id JOIN users u ON u.id = e.created_by
    WHERE e.outlet_id = ? AND e.expense_date BETWEEN ? AND ? ORDER BY e.expense_date DESC, e.created_at DESC LIMIT ? OFFSET ?
  `).bind(outlet.id, from, to, limit, offset).all();
  return ok({ expenses: rows.results || [] });
}

async function listSuppliers(ctx: RequestContext): Promise<Response> {
  requireUser(ctx);
  const rows = await ctx.env.DB.prepare(`SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name`).all();
  return ok({ suppliers: rows.results || [] });
}

async function createSupplier(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, PRODUCT_WRITE_ROLES);
  const body = await readJson<JsonRecord>(ctx.request);
  const outlet = await getOutlet(ctx.env, user, body.outlet_id);
  const id = crypto.randomUUID();
  const code = requireString(body.code, 'Kode pemasok', 40).toUpperCase();
  const name = requireString(body.name, 'Nama pemasok', 180);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`INSERT INTO suppliers (id, business_unit_id, code, name, phone, address, contact_person, bank_account, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, outlet.business_unit_id, code, name, optionalString(body.phone, 50), optionalString(body.address, 500), optionalString(body.contact_person, 150), optionalString(body.bank_account, 150), optionalString(body.notes, 500)),
    auditStatement(ctx.env, { userId: user.id, action: 'CREATE_SUPPLIER', entityType: 'SUPPLIER', entityId: id, newValue: { code, name }, ip: ctx.ip, userAgent: ctx.userAgent }),
  ]);
  return ok({ id, code, name }, 'Pemasok berhasil ditambahkan.');
}

async function createPurchase(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, PRODUCT_WRITE_ROLES);
  const body = await readJson<JsonRecord>(ctx.request);
  const outlet = await getOutlet(ctx.env, user, body.outlet_id);
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(422, 'Item pembelian wajib diisi.');
  const itemInputs = body.items.map((raw) => {
    const item = raw as JsonRecord;
    return {
      productId: requireString(item.product_id, 'Produk', 100),
      quantity: requireNumber(item.quantity, 'Jumlah', 0.000001),
      unitCost: integerMoney(item.unit_cost, 'Harga beli'),
    };
  });
  const ids = [...new Set(itemInputs.map((item) => item.productId))];
  const placeholders = ids.map(() => '?').join(',');
  const products = await ctx.env.DB.prepare(`
    SELECT p.id, p.name, p.track_stock, p.purchase_price, COALESCE(sb.quantity,0) AS current_quantity
    FROM products p LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.outlet_id = ?
    WHERE p.id IN (${placeholders}) AND p.is_active = 1
  `).bind(outlet.id, ...ids).all<JsonRecord>();
  const productMap = new Map((products.results || []).map((row) => [String(row.id), row]));
  if (productMap.size !== ids.length) throw new HttpError(422, 'Terdapat produk pembelian yang tidak valid.');
  const subtotal = itemInputs.reduce((sum, item) => sum + Math.round(item.quantity * item.unitCost), 0);
  const discount = integerMoney(body.discount_total ?? 0, 'Diskon pembelian');
  if (discount > subtotal) throw new HttpError(422, 'Diskon tidak boleh melebihi subtotal.');
  const grandTotal = subtotal - discount;
  const paidAmount = integerMoney(body.paid_amount ?? grandTotal, 'Jumlah dibayar');
  if (paidAmount > grandTotal) throw new HttpError(422, 'Jumlah dibayar tidak boleh melebihi total pembelian.');
  const purchaseId = crypto.randomUUID();
  const purchaseNumber = documentNumber('PO', outlet.code);
  const purchaseDate = String(body.purchase_date || new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const statements: D1PreparedStatement[] = [
    ctx.env.DB.prepare(`
      INSERT INTO purchases (
        id, outlet_id, supplier_id, purchase_number, invoice_number, status, subtotal, discount_total,
        grand_total, paid_amount, due_amount, payment_method, purchase_date, received_at, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(purchaseId, outlet.id, optionalString(body.supplier_id, 100), purchaseNumber, optionalString(body.invoice_number, 100), subtotal, discount, grandTotal, paidAmount,
      grandTotal - paidAmount, optionalString(body.payment_method, 20) || (paidAmount < grandTotal ? 'CREDIT' : 'TRANSFER'), purchaseDate, isoNow(), optionalString(body.notes, 500), user.id),
  ];
  for (const item of itemInputs) {
    const product = productMap.get(item.productId)!;
    const before = Number(product.current_quantity || 0);
    const after = before + item.quantity;
    statements.push(ctx.env.DB.prepare(`INSERT INTO purchase_items (id, purchase_id, product_id, quantity, received_quantity, unit_cost, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), purchaseId, item.productId, item.quantity, item.quantity, item.unitCost, Math.round(item.quantity * item.unitCost)));
    statements.push(ctx.env.DB.prepare(`UPDATE products SET purchase_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(item.unitCost, item.productId));
    if (Number(product.track_stock) === 1) {
      statements.push(ctx.env.DB.prepare(`INSERT INTO stock_balances (id, outlet_id, product_id, quantity) VALUES (?, ?, ?, ?)
        ON CONFLICT(outlet_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP`)
        .bind(crypto.randomUUID(), outlet.id, item.productId, item.quantity));
      statements.push(ctx.env.DB.prepare(`
        INSERT INTO stock_movements (
          id, outlet_id, product_id, movement_type, reference_type, reference_id,
          quantity_before, quantity_change, quantity_after, unit_cost, notes, created_by
        ) VALUES (?, ?, ?, 'PURCHASE', 'PURCHASE', ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), outlet.id, item.productId, purchaseId, before, item.quantity, after, item.unitCost, purchaseNumber, user.id));
    }
  }
  statements.push(auditStatement(ctx.env, { userId: user.id, action: 'CREATE_PURCHASE', entityType: 'PURCHASE', entityId: purchaseId, newValue: { purchaseNumber, grandTotal, itemCount: itemInputs.length }, ip: ctx.ip, userAgent: ctx.userAgent }));
  await ctx.env.DB.batch(statements);
  return ok({ id: purchaseId, purchase_number: purchaseNumber, grand_total: grandTotal }, 'Pembelian diterima dan stok berhasil ditambahkan.');
}

async function listPurchases(ctx: RequestContext, url: URL): Promise<Response> {
  const user = requireUser(ctx);
  const outlet = await getOutlet(ctx.env, user, url.searchParams.get('outlet_id'));
  const { from, to } = dateRange(url);
  const { limit, offset } = pagination(url, 300);
  const rows = await ctx.env.DB.prepare(`
    SELECT p.*, s.name AS supplier_name, u.full_name AS created_by_name
    FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id JOIN users u ON u.id = p.created_by
    WHERE p.outlet_id = ? AND p.purchase_date BETWEEN ? AND ? ORDER BY p.purchase_date DESC, p.created_at DESC LIMIT ? OFFSET ?
  `).bind(outlet.id, from, to, limit, offset).all();
  return ok({ purchases: rows.results || [] });
}

async function reportSummary(ctx: RequestContext, url: URL): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, REPORT_ROLES);
  const outlet = await getOutlet(ctx.env, user, url.searchParams.get('outlet_id'));
  const { from, to } = dateRange(url);
  const { start, end } = utcRangeForMakassar(from, to);
  const [summary, payments, daily, products, expenses, stock] = await Promise.all([
    ctx.env.DB.prepare(`
      SELECT COALESCE(SUM(grand_total),0) AS omzet, COALESCE(SUM(cost_total),0) AS hpp,
             COALESCE(SUM(profit_total),0) AS laba_kotor, COUNT(*) AS transaksi
      FROM sales WHERE outlet_id = ? AND status='COMPLETED' AND completed_at BETWEEN ? AND ?
    `).bind(outlet.id, start, end).first(),
    ctx.env.DB.prepare(`
      SELECT sp.payment_method, SUM(sp.amount) AS total FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id
      WHERE s.outlet_id=? AND s.status='COMPLETED' AND sp.status='PAID' AND s.completed_at BETWEEN ? AND ? GROUP BY sp.payment_method ORDER BY total DESC
    `).bind(outlet.id, start, end).all(),
    ctx.env.DB.prepare(`
      SELECT date(datetime(completed_at,'+8 hours')) AS date, COUNT(*) AS transactions, SUM(grand_total) AS omzet, SUM(profit_total) AS profit
      FROM sales WHERE outlet_id=? AND status='COMPLETED' AND completed_at BETWEEN ? AND ? GROUP BY date(datetime(completed_at,'+8 hours')) ORDER BY date
    `).bind(outlet.id, start, end).all(),
    ctx.env.DB.prepare(`
      SELECT si.product_name_snapshot AS name, SUM(si.quantity) AS quantity, SUM(si.line_total) AS sales, SUM(si.unit_cost*si.quantity) AS cost
      FROM sale_items si JOIN sales s ON s.id=si.sale_id
      WHERE s.outlet_id=? AND s.status='COMPLETED' AND s.completed_at BETWEEN ? AND ?
      GROUP BY si.product_id,si.product_name_snapshot ORDER BY sales DESC LIMIT 20
    `).bind(outlet.id, start, end).all(),
    ctx.env.DB.prepare(`
      SELECT ec.name, SUM(e.amount) AS total FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id
      WHERE e.outlet_id=? AND e.expense_date BETWEEN ? AND ? GROUP BY e.category_id,ec.name ORDER BY total DESC
    `).bind(outlet.id, from, to).all(),
    ctx.env.DB.prepare(`
      SELECT COALESCE(SUM(sb.quantity*p.purchase_price),0) AS stock_value,
             SUM(CASE WHEN p.track_stock=1 AND sb.quantity<=p.minimum_stock THEN 1 ELSE 0 END) AS low_stock
      FROM stock_balances sb JOIN products p ON p.id=sb.product_id WHERE sb.outlet_id=? AND p.is_active=1
    `).bind(outlet.id).first(),
  ]);
  const expensesTotal = (expenses.results || []).reduce((sum, row) => sum + Number((row as JsonRecord).total || 0), 0);
  const gross = Number((summary as JsonRecord)?.laba_kotor || 0);
  return ok({
    range: { from, to }, outlet,
    summary: { ...(summary as JsonRecord), expenses: expensesTotal, net_operating: gross - expensesTotal, ...(stock as JsonRecord) },
    payments: payments.results || [], daily: daily.results || [], products: products.results || [], expenses: expenses.results || [],
  });
}

async function listUsers(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, MANAGEMENT_ROLES);
  const rows = await ctx.env.DB.prepare(`
    SELECT u.id,u.username,u.full_name,u.email,u.phone,u.role,u.is_active,u.must_change_password,u.last_login_at,u.created_at,
           o.name AS default_outlet_name
    FROM users u LEFT JOIN outlets o ON o.id=u.default_outlet_id WHERE u.organization_id=? ORDER BY u.full_name
  `).bind(user.organization_id).all();
  return ok({ users: rows.results || [] });
}

async function createUser(ctx: RequestContext): Promise<Response> {
  const actor = requireUser(ctx);
  assertRoles(actor, ['ADMIN']);
  const body = await readJson<JsonRecord>(ctx.request);
  const username = requireString(body.username, 'Username', 80).toLowerCase();
  const fullName = requireString(body.full_name, 'Nama lengkap', 180);
  const password = requireString(body.password, 'Password', 200);
  const role = requireString(body.role, 'Role', 20).toUpperCase() as AuthUser['role'];
  if (!['ADMIN','MANAGER','FINANCE','INVENTORY','CASHIER','VIEWER'].includes(role)) throw new HttpError(422, 'Role tidak valid.');
  const outlet = await getOutlet(ctx.env, actor, body.default_outlet_id);
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`
      INSERT INTO users (id,organization_id,username,full_name,email,phone,password_hash,role,default_outlet_id,must_change_password)
      VALUES (?,?,?,?,?,?,?,?,?,0)
    `).bind(id, actor.organization_id, username, fullName, optionalString(body.email, 180), optionalString(body.phone, 50), passwordHash, role, outlet.id),
    ctx.env.DB.prepare(`INSERT INTO user_outlet_access (id,user_id,outlet_id) VALUES (?,?,?)`).bind(crypto.randomUUID(), id, outlet.id),
    auditStatement(ctx.env, { userId: actor.id, action: 'CREATE_USER', entityType: 'USER', entityId: id, newValue: { username, fullName, role, outlet: outlet.name }, ip: ctx.ip, userAgent: ctx.userAgent }),
  ]);
  return ok({ id }, 'Pengguna berhasil ditambahkan.');
}

async function updateUser(ctx: RequestContext, userId: string): Promise<Response> {
  const actor = requireUser(ctx);
  assertRoles(actor, ['ADMIN']);
  if (actor.id === userId && (ctx.request.method === 'DELETE')) throw new HttpError(422, 'Akun yang sedang digunakan tidak dapat dihapus.');
  const body = await readJson<JsonRecord>(ctx.request);
  const old = await ctx.env.DB.prepare(`SELECT id,full_name,email,phone,role,is_active,default_outlet_id FROM users WHERE id=?`).bind(userId).first<JsonRecord>();
  if (!old) throw new HttpError(404, 'Pengguna tidak ditemukan.');
  const role = requireString(body.role ?? old.role, 'Role', 20).toUpperCase();
  if (!['ADMIN','MANAGER','FINANCE','INVENTORY','CASHIER','VIEWER'].includes(role)) throw new HttpError(422, 'Role tidak valid.');
  const outlet = await getOutlet(ctx.env, actor, body.default_outlet_id ?? old.default_outlet_id);
  const statements: D1PreparedStatement[] = [
    ctx.env.DB.prepare(`UPDATE users SET full_name=?,email=?,phone=?,role=?,default_outlet_id=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(requireString(body.full_name ?? old.full_name, 'Nama lengkap', 180), optionalString(body.email ?? old.email, 180), optionalString(body.phone ?? old.phone, 50), role, outlet.id, asBoolean(body.is_active, Number(old.is_active) === 1) ? 1 : 0, userId),
    ctx.env.DB.prepare(`INSERT INTO user_outlet_access (id,user_id,outlet_id) VALUES (?,?,?) ON CONFLICT(user_id,outlet_id) DO NOTHING`).bind(crypto.randomUUID(), userId, outlet.id),
  ];
  if (body.reset_password) {
    const password = requireString(body.reset_password, 'Password baru', 200);
    statements.push(ctx.env.DB.prepare(`UPDATE users SET password_hash=?,must_change_password=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(await hashPassword(password), userId));
    statements.push(ctx.env.DB.prepare(`UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=?`).bind(userId));
  }
  statements.push(auditStatement(ctx.env, { userId: actor.id, action: 'UPDATE_USER', entityType: 'USER', entityId: userId, oldValue: old, newValue: body, ip: ctx.ip, userAgent: ctx.userAgent }));
  await ctx.env.DB.batch(statements);
  return ok({ id: userId }, 'Pengguna berhasil diperbarui.');
}

async function getSettings(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  const organization = await ctx.env.DB.prepare(`SELECT * FROM organizations WHERE id=?`).bind(user.organization_id).first();
  const settings = await ctx.env.DB.prepare(`SELECT setting_key,setting_value FROM app_settings WHERE organization_id=?`).bind(user.organization_id).all<JsonRecord>();
  return ok({ organization, settings: Object.fromEntries((settings.results || []).map((row) => [String(row.setting_key), row.setting_value])) });
}

async function updateSettings(ctx: RequestContext): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, MANAGEMENT_ROLES);
  const body = await readJson<JsonRecord>(ctx.request);
  const old = await ctx.env.DB.prepare(`SELECT * FROM organizations WHERE id=?`).bind(user.organization_id).first();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`
      UPDATE organizations SET name=?,legal_name=?,village_name=?,district_name=?,regency_name=?,province_name=?,address=?,phone=?,email=?,
        logo_url=?,logo_public_id=?,receipt_footer=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).bind(
      requireString(body.name, 'Nama BUMDes', 180), optionalString(body.legal_name, 250), optionalString(body.village_name, 150),
      optionalString(body.district_name, 150), optionalString(body.regency_name, 150), optionalString(body.province_name, 150),
      optionalString(body.address, 500), optionalString(body.phone, 50), optionalString(body.email, 180),
      optionalString(body.logo_url, 1000) || '/assets/img/logo-bumdes.webp', optionalString(body.logo_public_id, 500),
      optionalString(body.receipt_footer, 500), user.organization_id,
    ),
    auditStatement(ctx.env, { userId: user.id, action: 'UPDATE_SETTINGS', entityType: 'ORGANIZATION', entityId: user.organization_id, oldValue: old, newValue: body, ip: ctx.ip, userAgent: ctx.userAgent }),
  ]);
  return ok(null, 'Pengaturan identitas BUMDes berhasil diperbarui.');
}

async function auditList(ctx: RequestContext, url: URL): Promise<Response> {
  const user = requireUser(ctx);
  assertRoles(user, MANAGEMENT_ROLES);
  const { limit, offset } = pagination(url, 300);
  const rows = await ctx.env.DB.prepare(`
    SELECT a.*,u.full_name AS user_name,u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
    ORDER BY a.created_at DESC LIMIT ? OFFSET ?
  `).bind(limit, offset).all();
  return ok({ logs: rows.results || [] });
}

async function route(ctx: RequestContext, parts: string[], url: URL): Promise<Response> {
  const [root, id, action] = parts;

  if (root === 'health' && isMethod(ctx.request, 'GET')) return ok({ status: 'healthy', app: ctx.env.APP_NAME || 'BUMDes POS', timestamp: isoNow() });
  if (root === 'auth' && id === 'login' && isMethod(ctx.request, 'POST')) return login(ctx);

  ctx.user = await getCurrentUser(ctx.env, ctx.request) || undefined;

  if (root === 'auth' && id === 'logout' && isMethod(ctx.request, 'POST')) return logout(ctx);
  if (root === 'auth' && id === 'me' && isMethod(ctx.request, 'GET')) return authMe(ctx);
  if (root === 'auth' && id === 'change-password' && isMethod(ctx.request, 'POST')) return changePassword(ctx);
  if (root === 'bootstrap' && isMethod(ctx.request, 'GET')) return bootstrap(ctx);
  if (root === 'dashboard' && isMethod(ctx.request, 'GET')) return dashboard(ctx, url);

  if (root === 'products' && !id && isMethod(ctx.request, 'GET')) return listProducts(ctx, url);
  if (root === 'products' && !id && isMethod(ctx.request, 'POST')) return createProduct(ctx);
  if (root === 'products' && id && isMethod(ctx.request, 'PUT')) return updateProduct(ctx, id);
  if (root === 'categories' && !id && isMethod(ctx.request, 'GET')) {
    requireUser(ctx); const rows = await ctx.env.DB.prepare(`SELECT * FROM categories WHERE is_active=1 ORDER BY name`).all(); return ok({ categories: rows.results || [] });
  }
  if (root === 'categories' && !id && isMethod(ctx.request, 'POST')) return createCategory(ctx);
  if (root === 'units' && isMethod(ctx.request, 'GET')) {
    requireUser(ctx); const rows = await ctx.env.DB.prepare(`SELECT * FROM units WHERE is_active=1 ORDER BY name`).all(); return ok({ units: rows.results || [] });
  }

  if (root === 'stocks' && !id && isMethod(ctx.request, 'GET')) return stockList(ctx, url);
  if (root === 'stocks' && id === 'adjust' && isMethod(ctx.request, 'POST')) return adjustStock(ctx);
  if (root === 'stocks' && id === 'movements' && isMethod(ctx.request, 'GET')) return stockMovements(ctx, url);

  if (root === 'sales' && !id && isMethod(ctx.request, 'GET')) return listSales(ctx, url);
  if (root === 'sales' && !id && isMethod(ctx.request, 'POST')) return createSale(ctx);
  if (root === 'sales' && id && !action && isMethod(ctx.request, 'GET')) return saleDetail(ctx, id);
  if (root === 'sales' && id && action === 'void' && isMethod(ctx.request, 'POST')) return voidSale(ctx, id);

  if (root === 'shifts' && !id && isMethod(ctx.request, 'GET')) return listShifts(ctx, url);
  if (root === 'shifts' && id === 'open' && isMethod(ctx.request, 'POST')) return openShift(ctx);
  if (root === 'shifts' && id && action === 'close' && isMethod(ctx.request, 'POST')) return closeShift(ctx, id);
  if (root === 'shifts' && id && action === 'expected' && isMethod(ctx.request, 'GET')) { requireUser(ctx); return ok(await shiftExpectedCash(ctx.env, id)); }

  if (root === 'expenses' && !id && isMethod(ctx.request, 'GET')) return listExpenses(ctx, url);
  if (root === 'expenses' && !id && isMethod(ctx.request, 'POST')) return createExpense(ctx);
  if (root === 'expense-categories' && isMethod(ctx.request, 'GET')) {
    const user = requireUser(ctx); const rows = await ctx.env.DB.prepare(`SELECT * FROM expense_categories WHERE organization_id=? AND is_active=1 ORDER BY name`).bind(user.organization_id).all(); return ok({ categories: rows.results || [] });
  }

  if (root === 'suppliers' && !id && isMethod(ctx.request, 'GET')) return listSuppliers(ctx);
  if (root === 'suppliers' && !id && isMethod(ctx.request, 'POST')) return createSupplier(ctx);
  if (root === 'purchases' && !id && isMethod(ctx.request, 'GET')) return listPurchases(ctx, url);
  if (root === 'purchases' && !id && isMethod(ctx.request, 'POST')) return createPurchase(ctx);

  if (root === 'reports' && id === 'summary' && isMethod(ctx.request, 'GET')) return reportSummary(ctx, url);
  if (root === 'users' && !id && isMethod(ctx.request, 'GET')) return listUsers(ctx);
  if (root === 'users' && !id && isMethod(ctx.request, 'POST')) return createUser(ctx);
  if (root === 'users' && id && isMethod(ctx.request, 'PUT')) return updateUser(ctx, id);
  if (root === 'settings' && isMethod(ctx.request, 'GET')) return getSettings(ctx);
  if (root === 'settings' && isMethod(ctx.request, 'PUT')) return updateSettings(ctx);
  if (root === 'audit' && isMethod(ctx.request, 'GET')) return auditList(ctx, url);
  if (root === 'uploads' && id === 'signature' && isMethod(ctx.request, 'POST')) {
    const user = requireUser(ctx); assertRoles(user, PRODUCT_WRITE_ROLES);
    const body = await readJson<JsonRecord>(ctx.request);
    return ok(await createCloudinarySignature(ctx.env, String(body.folder || 'bumdes-pos')));
  }

  throw new HttpError(404, 'Endpoint API tidak ditemukan.');
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const request = context.request;
  const url = new URL(request.url);
  const ctx: RequestContext = {
    env: context.env,
    request,
    ip: getClientIp(request),
    userAgent: request.headers.get('User-Agent') || 'unknown',
  };
  try {
    return await route(ctx, normalizePath(url.pathname), url);
  } catch (error) {
    if (error instanceof HttpError) return fail(error.message, error.status, error.details);
    const message = error instanceof Error ? error.message : 'Kesalahan internal tidak dikenal.';
    console.error('API error', { path: url.pathname, method: request.method, message, error });
    const friendly = message.includes('UNIQUE constraint failed') ? 'Data yang sama sudah terdaftar.'
      : message.includes('Stok tidak mencukupi') ? 'Stok tidak mencukupi.'
      : 'Terjadi kesalahan pada server. Silakan coba kembali.';
    return fail(friendly, 500);
  }
};
