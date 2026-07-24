# Masterplan Pengembangan

## Tahap 1, MVP Operasional

Fokus tahap ini adalah stabilitas transaksi, stok, kas, dan laporan dasar. Seluruh fitur inti dalam source code saat ini termasuk tahap MVP.

## Tahap 2, Kontrol Keuangan

Tambahkan retur, pelunasan piutang, pembayaran utang pemasok, persetujuan pengeluaran, serta closing harian manager.

## Tahap 3, Multiunit

Aktifkan pengelolaan unit usaha, outlet, gudang, transfer stok, harga per outlet, dan dashboard konsolidasi.

## Tahap 4, Integrasi

Tambahkan payment gateway QRIS, WhatsApp receipt, ekspor akuntansi, dan integrasi perangkat barcode.

## Tahap 5, Ketahanan Offline

Implementasikan queue transaksi lokal menggunakan IndexedDB, client-generated transaction ID, idempotency key, sinkronisasi, serta resolusi konflik stok. Jangan menyatakan transaksi sukses sebelum server mengonfirmasi penyimpanan.
