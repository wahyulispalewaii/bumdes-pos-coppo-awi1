# Ringkasan Database

## Entitas organisasi

- `organizations`
- `business_units`
- `outlets`

Struktur ini memungkinkan aplikasi berkembang dari satu toko menjadi beberapa unit usaha dan outlet tanpa mengubah fondasi data.

## Pengguna dan autentikasi

- `users`
- `user_outlet_access`
- `user_sessions`

Password tidak disimpan dalam bentuk teks. Session browser memakai token acak, sedangkan database hanya menyimpan hash token.

## Produk dan persediaan

- `categories`
- `units`
- `products`
- `stock_balances`
- `stock_movements`

`stock_balances` menyimpan saldo terkini. `stock_movements` menyimpan sejarah perubahan. Pengguna tidak mengedit saldo tanpa membuat mutasi.

## Penjualan

- `sales`
- `sale_items`
- `sale_payments`

Item transaksi menyimpan snapshot SKU, nama, satuan, harga jual, dan harga beli. Perubahan harga produk setelah transaksi tidak mengubah histori.

## Kas

- `cash_shifts`
- `cash_movements`
- `expenses`
- `expense_categories`

Kas seharusnya dihitung dari kas awal, penjualan tunai, kas masuk, dan kas keluar.

## Pembelian

- `suppliers`
- `purchases`
- `purchase_items`

Versi saat ini menerapkan penerimaan langsung. Saat pembelian disimpan dengan status `RECEIVED`, stok bertambah dan harga beli terbaru diperbarui.

## Audit

- `audit_logs`
- `app_settings`

Audit mencatat login, perubahan produk, stok, transaksi, shift, pengguna, dan konfigurasi.
