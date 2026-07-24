# MODE LOGIN SEDERHANA

Versi ini menggunakan database D1 `db_bumdes-pos-coppo-awi` dengan ID `56016eba-b9df-49b9-8cd3-da84f066db32`.

Kredensial bawaan:

- Admin: `admin` / `admin`
- Kasir: `kasir` / `kasir`

Akun tidak dikunci ketika password salah selama `SIMPLE_LOGIN_ENABLED=true`. Tombol login cepat tersedia pada halaman masuk.

## Deploy pembaruan

1. Ganti isi repository dengan versi ini atau salin file yang berubah.
2. Commit dan push ke branch `main`.
3. Jalankan migrasi production:

```bash
npm install
npx wrangler login
npm run db:migrate:remote
```

4. Cloudflare Pages akan redeploy otomatis. Jika tidak, pilih **Deployments > Retry deployment**.
5. Buka aplikasi dengan jendela incognito atau lakukan hard refresh `Ctrl+Shift+R`.

## Mengembalikan login ketat

Ubah `SIMPLE_LOGIN_ENABLED` menjadi `false` pada `wrangler.jsonc` atau Environment Variables Cloudflare, lalu deploy ulang.
