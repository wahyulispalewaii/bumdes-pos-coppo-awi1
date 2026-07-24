# Checklist Pengujian

## Autentikasi

- Login dengan akun valid berhasil.
- Lima login gagal mengunci akun sementara.
- Logout mencabut session.
- Pengguna nonaktif tidak dapat login.
- Ganti password mencabut session lama.

## Produk dan stok

- Produk baru membuat saldo stok awal.
- Produk jasa tidak membutuhkan stok.
- Penyesuaian stok menghasilkan mutasi.
- Pengurangan melebihi stok ditolak.
- Trigger database menolak saldo negatif.

## Penjualan

- Penjualan membutuhkan shift aktif.
- Harga diambil dari database, bukan input browser.
- Pembayaran harus sama dengan grand total.
- Penjualan mengurangi stok dan membuat mutasi.
- Request dengan idempotency key sama tidak membuat transaksi kedua.
- Void mengembalikan stok dan mengubah pembayaran menjadi refunded.

## Shift

- Pengguna hanya dapat memiliki satu shift aktif.
- Pengeluaran tunai membutuhkan shift aktif.
- Kas seharusnya sesuai kas awal + penjualan tunai + kas masuk - kas keluar.
- Selisih tersimpan saat shift ditutup.
- Shift yang sudah ditutup tidak dapat ditutup lagi.

## Role

- Kasir tidak dapat mengubah produk.
- Inventory tidak dapat mengelola pengguna.
- Viewer tidak dapat membuat transaksi.
- Hanya admin atau manager yang dapat void transaksi.
- Pengguna nonmanajemen hanya melihat outlet yang diberikan.

## Laporan

- Omzet hanya menghitung transaksi `COMPLETED`.
- Transaksi `VOIDED` tidak masuk omzet.
- HPP berasal dari snapshot harga beli pada item transaksi.
- Pengeluaran sesuai filter outlet dan tanggal.
