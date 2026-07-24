#!/usr/bin/env python3
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]

def main() -> int:
    database = sqlite3.connect(':memory:')
    database.execute('PRAGMA foreign_keys=ON')
    for migration in sorted((ROOT / 'migrations').glob('*.sql')):
        database.executescript(migration.read_text(encoding='utf-8'))

    assert database.execute('SELECT COUNT(*) FROM products').fetchone()[0] >= 8
    assert database.execute('SELECT COUNT(*) FROM users').fetchone()[0] >= 2
    assert database.execute("SELECT COUNT(*) FROM users WHERE username='admin' AND role='ADMIN'").fetchone()[0] == 1

    try:
        database.execute("UPDATE stock_balances SET quantity=-1 WHERE product_id='prod-beras-5kg'")
    except sqlite3.IntegrityError as exc:
        assert 'Stok tidak mencukupi' in str(exc)
    else:
        raise AssertionError('Trigger stok negatif tidak bekerja.')

    required = [
        ROOT / 'public/index.html',
        ROOT / 'public/assets/css/app.css',
        ROOT / 'public/assets/js/app.js',
        ROOT / 'functions/api/[[path]].ts',
        ROOT / 'public/assets/img/logo-bumdes.webp',
        ROOT / 'wrangler.jsonc',
    ]
    missing = [str(path.relative_to(ROOT)) for path in required if not path.exists()]
    if missing:
        raise AssertionError(f'File wajib tidak ditemukan: {missing}')

    print('Verifikasi berhasil: migrasi, seed, trigger stok, dan file utama valid.')
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f'Verifikasi gagal: {exc}', file=sys.stderr)
        raise
