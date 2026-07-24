> **Versi login sederhana:** Admin `admin/admin`, Kasir `kasir/kasir`. Database: `db_bumdes-pos-coppo-awi`. Lihat `SIMPLE_LOGIN_DEPLOY.md`.

# BUMDes Coppo Awi POS

Aplikasi web kasir sederhana untuk **BUMDes Coppo Awi, Desa Gattareng, Kecamatan Marioriwawo, Kabupaten Soppeng**. Proyek ini disiapkan agar dapat langsung dikembangkan dan dideploy menggunakan Cloudflare Pages, Pages Functions, Cloudflare D1, dan Cloudinary.

## Fitur yang sudah tersedia

- Login berbasis session cookie dan role-based access control.
- Dashboard omzet, laba kotor, pengeluaran, stok minimum, produk terlaris, dan tren penjualan.
- Kasir dengan pencarian produk, kategori, keranjang, pembayaran tunai, QRIS, transfer, e-wallet, piutang, dan struk.
- Idempotency key untuk mencegah transaksi ganda.
- Produk, kategori, satuan, harga beli, harga jual, stok awal, dan foto Cloudinary.
- Stok berjalan, mutasi stok, penyesuaian masuk, keluar, dan stok opname.
- Pembelian dan penerimaan stok dari pemasok.
- Shift kasir, kas awal, kas seharusnya, kas aktual, dan selisih kas.
- Pengeluaran operasional dan pergerakan kas tunai.
- Riwayat transaksi, detail transaksi, serta void dengan pengembalian stok otomatis.
- Laporan omzet, HPP, laba kotor, hasil operasional, metode pembayaran, produk, pengeluaran, dan nilai persediaan.
- Manajemen pengguna dan role.
- Pengaturan identitas, logo, alamat, dan footer struk.
- Audit log untuk aktivitas penting.
- PWA shell untuk membuka antarmuka saat koneksi tidak stabil. Finalisasi transaksi tetap membutuhkan koneksi server.

## Teknologi

```text
Frontend        : HTML, CSS, JavaScript ES Modules, PWA
Backend         : Cloudflare Pages Functions, TypeScript
Database        : Cloudflare D1
Media Storage   : Cloudinary signed upload
Deployment      : Cloudflare Pages
```

## Akun awal

Setelah migrasi seed diterapkan:

```text
Administrator
Username : admin
Password : Admin123!

Kasir
Username : kasir
Password : Kasir123!
```

Kedua akun ditandai untuk mengganti password awal. Jangan menggunakan password bawaan pada sistem produksi.

## Persyaratan

- Node.js 20 atau lebih baru.
- Akun Cloudflare.
- Project Cloudflare Pages.
- Database Cloudflare D1.
- Akun Cloudinary untuk unggahan foto dinamis.

## Menjalankan secara lokal

### 1. Instal dependensi

```bash
npm install
```

### 2. Login Wrangler

```bash
npx wrangler login
```

### 3. Buat database D1

```bash
npm run db:create
```

Salin `database_id` yang dihasilkan ke `wrangler.jsonc`:

```json
{
  "binding": "DB",
  "database_name": "bumdes-pos-coppo-awi-db",
  "database_id": "ID_DATABASE_ANDA"
}
```

### 4. Terapkan migrasi lokal

```bash
npm run db:migrate:local
```

### 5. Konfigurasi Cloudinary lokal

Salin file contoh:

```bash
cp .dev.vars.example .dev.vars
```

Isi konfigurasi Cloudinary:

```dotenv
CLOUDINARY_CLOUD_NAME="cloud_name_anda"
CLOUDINARY_API_KEY="api_key_anda"
CLOUDINARY_API_SECRET="api_secret_anda"
```

Jika Cloudinary belum dikonfigurasi, aplikasi tetap berfungsi. Logo lokal bawaan tetap tampil dan produk dapat disimpan tanpa foto.

### 6. Jalankan aplikasi

```bash
npm run dev
```

Buka alamat lokal yang ditampilkan Wrangler, biasanya `http://localhost:8788`.

## Deployment Cloudflare Pages

### 1. Buat Pages project

Gunakan salah satu metode berikut:

- Hubungkan repository GitHub ke Cloudflare Pages.
- Deploy langsung melalui Wrangler.

Perintah deploy langsung:

```bash
npm run deploy
```

### 2. Hubungkan D1

Pada Cloudflare Dashboard:

```text
Workers & Pages
→ Pilih project Pages
→ Settings
→ Bindings
→ Add binding
→ D1 database
```

Gunakan nama binding:

```text
DB
```

### 3. Terapkan migrasi remote

```bash
npm run db:migrate:remote
```

### 4. Tambahkan variabel dan secret Cloudinary

Pada project Pages:

```text
Settings
→ Variables and Secrets
```

Tambahkan variabel biasa:

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
APP_NAME
SESSION_TTL_HOURS
```

Tambahkan sebagai encrypted secret:

```text
CLOUDINARY_API_SECRET
```

Jangan menyimpan API secret Cloudinary di frontend, repository, atau `wrangler.jsonc`.

## Struktur proyek

```text
bumdes-pos-coppo-awi/
├── public/                    # Frontend statis
│   ├── assets/css/app.css
│   ├── assets/js/
│   ├── assets/img/            # Logo BUMDes dan favicon
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── service-worker.js
│   ├── _headers
│   └── _routes.json
├── functions/                 # Cloudflare Pages Functions
│   ├── api/[[path]].ts        # Router API
│   ├── lib/                   # Auth, HTTP, audit, Cloudinary
│   └── _middleware.ts
├── migrations/               # Skema dan seed D1
├── docs/                     # Dokumentasi teknis
├── types/                    # Tipe minimal Cloudflare untuk typecheck
├── wrangler.jsonc
├── package.json
└── tsconfig.json
```

## Model keamanan

- Password menggunakan PBKDF2-SHA256 dengan salt unik.
- Session token acak hanya disimpan pada cookie `HttpOnly`, `Secure`, dan `SameSite=Strict`.
- Token session disimpan dalam bentuk hash SHA-256 pada database.
- Backend memeriksa role dan akses outlet untuk setiap operasi sensitif.
- Query menggunakan D1 prepared statements.
- Transaksi penjualan menggunakan `D1 batch()` untuk menyatukan transaksi, item, pembayaran, stok, dan audit log.
- Trigger database mencegah stok menjadi negatif.
- Transaksi selesai tidak diedit. Koreksi dilakukan melalui proses void.
- Unggahan Cloudinary menggunakan signature yang dibuat server-side.
- Header CSP membatasi sumber script, gambar, dan koneksi.

## Catatan produksi

Sebelum digunakan secara operasional:

1. Ganti seluruh password awal.
2. Verifikasi nama, alamat, nomor telepon, serta logo pada menu Pengaturan.
3. Periksa harga dan stok awal seluruh produk.
4. Uji printer struk pada perangkat kasir.
5. Uji alur buka shift, transaksi, pengeluaran tunai, dan tutup shift.
6. Batasi role pengguna sesuai tugas.
7. Buat prosedur ekspor dan backup D1 berkala.
8. Gunakan database preview terpisah dari production.

## Pengembangan lanjutan

Struktur proyek siap dikembangkan untuk:

- Banyak unit usaha dan banyak outlet.
- Retur penjualan dan retur pembelian.
- Transfer stok antaroutlet.
- Piutang dan pelunasan pelanggan.
- Utang dan pembayaran pemasok.
- Harga grosir dan level pelanggan.
- Integrasi QRIS payment gateway.
- Laporan akuntansi double-entry.
- Offline transaction queue dengan mekanisme resolusi konflik.
