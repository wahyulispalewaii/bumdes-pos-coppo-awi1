PRAGMA foreign_keys = ON;

-- Mode login sederhana untuk database production yang sudah berjalan.
-- Kredensial bawaan:
--   admin / admin
--   kasir / kasir

INSERT INTO users (
  id, organization_id, username, full_name, password_hash, role,
  default_outlet_id, is_active, must_change_password, failed_login_count, locked_until
) VALUES (
  'user-admin', 'org-coppo-awi', 'admin', 'Administrator BUMDes',
  'pbkdf2_sha256$120000$X9V-gnOUgog8zJnj1r7xsg$55hDGY-r1MZ5ncvFmWEKwkgALb4jgVYV6akQt0z5bg8',
  'ADMIN', 'outlet-utama', 1, 0, 0, NULL
)
ON CONFLICT(username) DO UPDATE SET
  password_hash = excluded.password_hash,
  role = 'ADMIN',
  default_outlet_id = 'outlet-utama',
  is_active = 1,
  must_change_password = 0,
  failed_login_count = 0,
  locked_until = NULL,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO users (
  id, organization_id, username, full_name, password_hash, role,
  default_outlet_id, is_active, must_change_password, failed_login_count, locked_until
) VALUES (
  'user-kasir', 'org-coppo-awi', 'kasir', 'Kasir Utama',
  'pbkdf2_sha256$120000$dhPTRfj5zpM_Y-uQ2qGlPw$E2ZlNBis89oKPs-gDdSefyIKZ-YNLMzMj2sCNk6n1PE',
  'CASHIER', 'outlet-utama', 1, 0, 0, NULL
)
ON CONFLICT(username) DO UPDATE SET
  password_hash = excluded.password_hash,
  role = 'CASHIER',
  default_outlet_id = 'outlet-utama',
  is_active = 1,
  must_change_password = 0,
  failed_login_count = 0,
  locked_until = NULL,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO user_outlet_access (id, user_id, outlet_id)
SELECT 'uoa-simple-admin', id, 'outlet-utama' FROM users WHERE username = 'admin' COLLATE NOCASE
ON CONFLICT(user_id, outlet_id) DO NOTHING;

INSERT INTO user_outlet_access (id, user_id, outlet_id)
SELECT 'uoa-simple-kasir', id, 'outlet-utama' FROM users WHERE username = 'kasir' COLLATE NOCASE
ON CONFLICT(user_id, outlet_id) DO NOTHING;

DELETE FROM user_sessions
WHERE user_id IN (SELECT id FROM users WHERE username IN ('admin', 'kasir') COLLATE NOCASE);
