PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO organizations (
  id, code, name, legal_name, village_name, district_name, regency_name, province_name,
  address, phone, email, logo_url, receipt_footer
) VALUES (
  'org-coppo-awi', 'COPPOAWI', 'BUMDes Coppo Awi', 'Badan Usaha Milik Desa Coppo Awi',
  'Desa Gattareng', 'Marioriwawo', 'Soppeng', 'Sulawesi Selatan',
  'Desa Gattareng, Kecamatan Marioriwawo, Kabupaten Soppeng', '', '',
  '/assets/img/logo-bumdes.webp', 'Terima kasih telah berbelanja di BUMDes Coppo Awi.'
);

INSERT OR IGNORE INTO business_units (id, organization_id, code, name, business_type, description)
VALUES ('unit-toko', 'org-coppo-awi', 'TOKO', 'Toko BUMDes', 'RETAIL', 'Unit perdagangan dan penjualan kebutuhan masyarakat.');

INSERT OR IGNORE INTO outlets (id, business_unit_id, code, name, address)
VALUES ('outlet-utama', 'unit-toko', 'OUT01', 'Outlet Utama', 'Desa Gattareng, Kecamatan Marioriwawo');

INSERT OR IGNORE INTO users (
  id, organization_id, username, full_name, password_hash, role, default_outlet_id, must_change_password
) VALUES (
  'user-admin', 'org-coppo-awi', 'admin', 'Administrator BUMDes',
  'pbkdf2_sha256$120000$X9V-gnOUgog8zJnj1r7xsg$55hDGY-r1MZ5ncvFmWEKwkgALb4jgVYV6akQt0z5bg8',
  'ADMIN', 'outlet-utama', 0
);

INSERT OR IGNORE INTO users (
  id, organization_id, username, full_name, password_hash, role, default_outlet_id, must_change_password
) VALUES (
  'user-kasir', 'org-coppo-awi', 'kasir', 'Kasir Utama',
  'pbkdf2_sha256$120000$dhPTRfj5zpM_Y-uQ2qGlPw$E2ZlNBis89oKPs-gDdSefyIKZ-YNLMzMj2sCNk6n1PE',
  'CASHIER', 'outlet-utama', 0
);

INSERT OR IGNORE INTO user_outlet_access (id, user_id, outlet_id) VALUES
  ('uoa-admin-utama', 'user-admin', 'outlet-utama'),
  ('uoa-kasir-utama', 'user-kasir', 'outlet-utama');

INSERT OR IGNORE INTO units (id, code, name) VALUES
  ('unit-pcs', 'PCS', 'Pcs'),
  ('unit-bungkus', 'BKS', 'Bungkus'),
  ('unit-botol', 'BTL', 'Botol'),
  ('unit-kilogram', 'KG', 'Kilogram'),
  ('unit-liter', 'LTR', 'Liter'),
  ('unit-paket', 'PKT', 'Paket');

INSERT OR IGNORE INTO categories (id, business_unit_id, name, description) VALUES
  ('cat-sembako', 'unit-toko', 'Sembako', 'Kebutuhan pokok masyarakat'),
  ('cat-minuman', 'unit-toko', 'Minuman', 'Air minum dan minuman kemasan'),
  ('cat-makanan', 'unit-toko', 'Makanan Ringan', 'Makanan ringan dan camilan'),
  ('cat-desa', 'unit-toko', 'Produk Desa', 'Produk unggulan dan hasil usaha warga'),
  ('cat-jasa', 'unit-toko', 'Jasa', 'Layanan nonpersediaan');

INSERT OR IGNORE INTO expense_categories (id, organization_id, name, category_type) VALUES
  ('exp-listrik', 'org-coppo-awi', 'Listrik dan Utilitas', 'OPERATING'),
  ('exp-transport', 'org-coppo-awi', 'Transportasi', 'OPERATING'),
  ('exp-atk', 'org-coppo-awi', 'ATK', 'OPERATING'),
  ('exp-maintenance', 'org-coppo-awi', 'Perawatan', 'OPERATING'),
  ('exp-other', 'org-coppo-awi', 'Operasional Lainnya', 'OTHER');

INSERT OR IGNORE INTO suppliers (id, business_unit_id, code, name, phone, address)
VALUES ('supplier-umum', 'unit-toko', 'SUP001', 'Pemasok Umum', '', 'Kabupaten Soppeng');

INSERT OR IGNORE INTO customers (id, business_unit_id, code, name)
VALUES ('customer-general', 'unit-toko', 'GENERAL', 'Pelanggan Umum');

INSERT OR IGNORE INTO products (
  id, business_unit_id, category_id, unit_id, sku, barcode, name, purchase_price, selling_price, minimum_stock, track_stock
) VALUES
  ('prod-beras-5kg', 'unit-toko', 'cat-sembako', 'unit-pcs', 'BRP-5KG', '899000000001', 'Beras Premium 5 Kg', 68000, 75000, 5, 1),
  ('prod-minyak-1l', 'unit-toko', 'cat-sembako', 'unit-botol', 'MGK-1L', '899000000002', 'Minyak Goreng 1 Liter', 16500, 18500, 10, 1),
  ('prod-gula-1kg', 'unit-toko', 'cat-sembako', 'unit-kilogram', 'GLP-1KG', '899000000003', 'Gula Pasir 1 Kg', 15500, 17500, 8, 1),
  ('prod-air-600', 'unit-toko', 'cat-minuman', 'unit-botol', 'AIR-600', '899000000004', 'Air Mineral 600 ml', 2500, 4000, 12, 1),
  ('prod-kopi-desa', 'unit-toko', 'cat-desa', 'unit-bungkus', 'KOP-DESA', '899000000005', 'Kopi Bubuk Desa', 18000, 25000, 5, 1),
  ('prod-keripik', 'unit-toko', 'cat-desa', 'unit-bungkus', 'KRP-DSA', '899000000006', 'Keripik Singkong Desa', 8000, 12000, 8, 1),
  ('prod-snack', 'unit-toko', 'cat-makanan', 'unit-bungkus', 'SNK-001', '899000000007', 'Makanan Ringan', 4500, 7000, 10, 1),
  ('prod-admin', 'unit-toko', 'cat-jasa', 'unit-paket', 'JSA-ADM', NULL, 'Jasa Administrasi', 0, 5000, 0, 0);

INSERT OR IGNORE INTO stock_balances (id, outlet_id, product_id, quantity) VALUES
  ('stock-beras-5kg', 'outlet-utama', 'prod-beras-5kg', 20),
  ('stock-minyak-1l', 'outlet-utama', 'prod-minyak-1l', 35),
  ('stock-gula-1kg', 'outlet-utama', 'prod-gula-1kg', 25),
  ('stock-air-600', 'outlet-utama', 'prod-air-600', 48),
  ('stock-kopi-desa', 'outlet-utama', 'prod-kopi-desa', 15),
  ('stock-keripik', 'outlet-utama', 'prod-keripik', 18),
  ('stock-snack', 'outlet-utama', 'prod-snack', 30),
  ('stock-admin', 'outlet-utama', 'prod-admin', 0);

INSERT OR IGNORE INTO stock_movements (
  id, outlet_id, product_id, movement_type, reference_type, reference_id,
  quantity_before, quantity_change, quantity_after, unit_cost, notes, created_by
) VALUES
  ('mov-open-beras', 'outlet-utama', 'prod-beras-5kg', 'OPENING_BALANCE', 'SEED', 'seed', 0, 20, 20, 68000, 'Stok awal sistem', 'user-admin'),
  ('mov-open-minyak', 'outlet-utama', 'prod-minyak-1l', 'OPENING_BALANCE', 'SEED', 'seed', 0, 35, 35, 16500, 'Stok awal sistem', 'user-admin'),
  ('mov-open-gula', 'outlet-utama', 'prod-gula-1kg', 'OPENING_BALANCE', 'SEED', 'seed', 0, 25, 25, 15500, 'Stok awal sistem', 'user-admin'),
  ('mov-open-air', 'outlet-utama', 'prod-air-600', 'OPENING_BALANCE', 'SEED', 'seed', 0, 48, 48, 2500, 'Stok awal sistem', 'user-admin'),
  ('mov-open-kopi', 'outlet-utama', 'prod-kopi-desa', 'OPENING_BALANCE', 'SEED', 'seed', 0, 15, 15, 18000, 'Stok awal sistem', 'user-admin'),
  ('mov-open-keripik', 'outlet-utama', 'prod-keripik', 'OPENING_BALANCE', 'SEED', 'seed', 0, 18, 18, 8000, 'Stok awal sistem', 'user-admin'),
  ('mov-open-snack', 'outlet-utama', 'prod-snack', 'OPENING_BALANCE', 'SEED', 'seed', 0, 30, 30, 4500, 'Stok awal sistem', 'user-admin');

INSERT OR IGNORE INTO app_settings (id, organization_id, setting_key, setting_value, updated_by) VALUES
  ('setting-tax-enabled', 'org-coppo-awi', 'tax_enabled', 'false', 'user-admin'),
  ('setting-tax-rate', 'org-coppo-awi', 'tax_rate', '0', 'user-admin'),
  ('setting-negative-stock', 'org-coppo-awi', 'allow_negative_stock', 'false', 'user-admin'),
  ('setting-low-stock', 'org-coppo-awi', 'show_low_stock_alert', 'true', 'user-admin');
