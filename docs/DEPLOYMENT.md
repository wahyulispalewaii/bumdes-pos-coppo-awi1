# Panduan Deployment

## Konfigurasi Cloudflare

Binding database harus bernama `DB`, karena seluruh Pages Function membaca database melalui `context.env.DB`.

```text
Binding name : DB
Resource     : bumdes-pos-coppo-awi-db
```

Environment production dan preview sebaiknya memakai database berbeda. Jangan menghubungkan deployment preview ke database transaksi produksi.

## Migrasi

Lokal:

```bash
npx wrangler d1 migrations apply DB --local
```

Production:

```bash
npx wrangler d1 migrations apply DB --remote
```

Wrangler mencatat migrasi yang telah diterapkan pada tabel migrasi D1. Jangan mengubah file migrasi lama setelah digunakan di production. Buat file migrasi baru untuk setiap perubahan skema.

## Cloudinary

Nilai berikut diperlukan agar fitur upload aktif:

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

`CLOUDINARY_API_SECRET` wajib disimpan sebagai encrypted secret. Frontend meminta signature ke endpoint `/api/uploads/signature`, lalu mengunggah file langsung ke Cloudinary.

Folder yang digunakan:

```text
bumdes-pos/products
bumdes-pos/branding
```

## Build dan output

Proyek tidak memerlukan proses bundling frontend. Direktori output Pages adalah:

```text
public
```

Pages Functions berada di:

```text
functions
```

File `_routes.json` membatasi invocation Functions hanya untuk `/api/*`, sehingga aset frontend dilayani secara statis.

## Domain

Setelah deployment selesai, custom domain dapat dihubungkan melalui menu Custom domains pada project Pages. Pastikan HTTPS aktif karena cookie session menggunakan atribut `Secure`.
