PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT,
  village_name TEXT,
  district_name TEXT,
  regency_name TEXT,
  province_name TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  logo_url TEXT,
  logo_public_id TEXT,
  receipt_footer TEXT,
  currency TEXT NOT NULL DEFAULT 'IDR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Makassar',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS business_units (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  business_type TEXT,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS outlets (
  id TEXT PRIMARY KEY,
  business_unit_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_unit_id, code),
  FOREIGN KEY (business_unit_id) REFERENCES business_units(id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','MANAGER','FINANCE','INVENTORY','CASHIER','VIEWER')),
  default_outlet_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0,1)),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (default_outlet_id) REFERENCES outlets(id)
);

CREATE TABLE IF NOT EXISTS user_outlet_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, outlet_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  business_unit_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_unit_id, name),
  FOREIGN KEY (business_unit_id) REFERENCES business_units(id)
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  business_unit_id TEXT NOT NULL,
  category_id TEXT,
  unit_id TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  purchase_price INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  selling_price INTEGER NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  minimum_stock REAL NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  track_stock INTEGER NOT NULL DEFAULT 1 CHECK (track_stock IN (0,1)),
  image_url TEXT,
  image_public_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_unit_id) REFERENCES business_units(id),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (unit_id) REFERENCES units(id)
);

CREATE TABLE IF NOT EXISTS stock_balances (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (outlet_id, product_id),
  FOREIGN KEY (outlet_id) REFERENCES outlets(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('OPENING_BALANCE','PURCHASE','SALE','SALE_VOID','RETURN_IN','RETURN_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT','STOCK_OPNAME','TRANSFER_IN','TRANSFER_OUT')),
  reference_type TEXT,
  reference_id TEXT,
  quantity_before REAL NOT NULL,
  quantity_change REAL NOT NULL,
  quantity_after REAL NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  business_unit_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  contact_person TEXT,
  bank_account TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_unit_id, code),
  FOREIGN KEY (business_unit_id) REFERENCES business_units(id)
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  business_unit_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  credit_limit INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_unit_id, code),
  FOREIGN KEY (business_unit_id) REFERENCES business_units(id)
);

CREATE TABLE IF NOT EXISTS cash_shifts (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','REVIEWED')),
  opening_cash INTEGER NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  expected_cash INTEGER,
  actual_cash INTEGER,
  cash_difference INTEGER,
  opening_notes TEXT,
  closing_notes TEXT,
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id),
  FOREIGN KEY (cashier_id) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_unit_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  shift_id TEXT NOT NULL,
  transaction_number TEXT NOT NULL UNIQUE,
  customer_id TEXT,
  customer_name_snapshot TEXT,
  cashier_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('DRAFT','HELD','COMPLETED','VOIDED','REFUNDED','PARTIALLY_REFUNDED')),
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount_total INTEGER NOT NULL DEFAULT 0,
  tax_total INTEGER NOT NULL DEFAULT 0,
  grand_total INTEGER NOT NULL DEFAULT 0,
  cost_total INTEGER NOT NULL DEFAULT 0,
  profit_total INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  completed_at TEXT,
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (business_unit_id) REFERENCES business_units(id),
  FOREIGN KEY (outlet_id) REFERENCES outlets(id),
  FOREIGN KEY (shift_id) REFERENCES cash_shifts(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (cashier_id) REFERENCES users(id),
  FOREIGN KEY (voided_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_sku_snapshot TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  unit_name_snapshot TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS sale_payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH','QRIS','TRANSFER','EWALLET','CREDIT','OTHER')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  tendered_amount INTEGER NOT NULL DEFAULT 0 CHECK (tendered_amount >= 0),
  change_amount INTEGER NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
  reference_number TEXT,
  status TEXT NOT NULL DEFAULT 'PAID' CHECK (status IN ('PENDING','PAID','FAILED','REFUNDED')),
  paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category_type TEXT NOT NULL DEFAULT 'OPERATING' CHECK (category_type IN ('OPERATING','CAPITAL','OTHER')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, name),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  shift_id TEXT,
  category_id TEXT NOT NULL,
  expense_number TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH','QRIS','TRANSFER','EWALLET','OTHER')),
  description TEXT NOT NULL,
  attachment_url TEXT,
  attachment_public_id TEXT,
  expense_date TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (outlet_id) REFERENCES outlets(id),
  FOREIGN KEY (shift_id) REFERENCES cash_shifts(id),
  FOREIGN KEY (category_id) REFERENCES expense_categories(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('IN','OUT')),
  category TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shift_id) REFERENCES cash_shifts(id),
  FOREIGN KEY (outlet_id) REFERENCES outlets(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  supplier_id TEXT,
  purchase_number TEXT NOT NULL UNIQUE,
  invoice_number TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('DRAFT','RECEIVED','CANCELLED')),
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount_total INTEGER NOT NULL DEFAULT 0,
  grand_total INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  due_amount INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('CASH','QRIS','TRANSFER','EWALLET','CREDIT','OTHER')),
  purchase_date TEXT NOT NULL,
  received_at TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  received_quantity REAL NOT NULL CHECK (received_quantity >= 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_value_json TEXT,
  new_value_json TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  setting_value TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, setting_key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_org_role ON users(organization_id, role);
CREATE INDEX IF NOT EXISTS idx_sessions_token_expiry ON user_sessions(token_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_products_business_active ON products(business_unit_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_stock_balance_outlet_product ON stock_balances(outlet_id, product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_date ON stock_movements(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_outlet_date ON stock_movements(outlet_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_outlet_date ON sales(outlet_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_sales_cashier_date ON sales(cashier_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_sales_status_date ON sales(status, completed_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_payments_sale_method ON sale_payments(sale_id, payment_method);
CREATE INDEX IF NOT EXISTS idx_shifts_cashier_status ON cash_shifts(cashier_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_outlet_date ON expenses(outlet_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_purchases_outlet_date ON purchases(outlet_id, purchase_date);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TRIGGER IF NOT EXISTS prevent_negative_stock_insert
BEFORE INSERT ON stock_balances
WHEN NEW.quantity < 0
BEGIN
  SELECT RAISE(ABORT, 'Stok tidak mencukupi');
END;

CREATE TRIGGER IF NOT EXISTS prevent_negative_stock_update
BEFORE UPDATE OF quantity ON stock_balances
WHEN NEW.quantity < 0
BEGIN
  SELECT RAISE(ABORT, 'Stok tidak mencukupi');
END;
