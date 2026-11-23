# Mami Lezza Dashboard

Dua dashboard berbasis [Google Sheet "Performa Mami Lezza"](https://docs.google.com/spreadsheets/d/1Z_g7Z6B_ZVQJyYvhE2kE_tBLoP0J3TsLAY9rNv813t0/edit?usp=sharing):

1. **Dashboard Mami Lezza** — KPI, tren, top Mami/barang, pie chart Nama Barang tiap bulan.
2. **Dashboard Utama: Omzet per Area** — ranking omzet tiap Area, matriks Area × Bulan, tren, komposisi brand, dan rincian omzet per Area × Brand. **Data diperbarui otomatis berkala.**

## Cara menjalankan (disarankan)

Butuh Python 3, tanpa `pip install`.

```bash
cd mami-lezza-dashboard
python3 server.py
# buka http://localhost:3000  → dashboard Omzet per Area
# http://localhost:3000/mami.html → dashboard Mami Lezza
```

Di macOS juga bisa klik dua kali **`start.command`** (server jalan + browser otomatis terbuka).

Opsi:

```bash
PORT=8080 python3 server.py                 # ganti port
REFRESH_SECONDS=600 python3 server.py       # ganti interval update sheet (default 300 detik)
```

### Pembaruan data berkala

- Server mengunduh ulang Google Sheet setiap **5 menit** (default) dan menyimpan hasilnya ke `public/data.js`.
- Browser dashboard Area mengecek API tiap **30 detik** dan otomatis menggambar ulang begitu ada data baru.
- Tombol **Refresh sekarang** memaksa pengunduhandata langsung.
- Indikator di kanan atas menampilkan status *Auto-update aktif* dan waktu data terakhir.
- Jika sheet/server tidak bisa diakses, dashboard tetap memakai data terakhir (status *Update gagal · data terakhir*) atau snapshot lokal (mode offline).

Endpoint API: `GET /api/omzet-area`, dan `GET /api/refresh` untuk force refresh.

## Buka tanpa server

`public/index.html` (Area) dan `public/mami.html` bisa dibuka langsung dari file. Dashboard Area akan berjalan dalam **mode offline (snapshot)** karena tidak ada API; data tetap tampil dari `public/data.js`.

## Perbarui data manual

```bash
cd mami-lezza-dashboard
python3 build_data.py
```

Script ini mengunduh CSV publik dari sheet, membersihkan data, lalu menimpa `public/data.js`. Jika sheet sedang tidak bisa diakses, dipakai `public/sheet_snapshot.csv.gz`.

## Fitur dashboard Omzet per Area

- Filter **Bulan (mm-jual)**, **Brand**, dan **Area**; klik bar/legenda untuk filter cepat.
- KPI: total omzet, area tertinggi, total qty, rata-rata omzet per area.
- Ranking omzet per Area dalam bar chart.
- **Matriks omzet Area × Bulan** dengan heatmap (hover untuk nilai pasti).
- Tren omzet bulanan multi-area (klik legenda untuk fokus ke satu area).
- Komposisi brand Lezza vs Hanarose, Top Nama Barang, Top Mami Lezza.
- Tabel rincian Area × Brand dan indikator auto-update.

## Upload ke GitHub

Upload isi folder `mami-lezza-dashboard/` (termasuk isi `public/`). File yang **tidak** perlu di-upload sudah ada di `.gitignore` (`.DS_Store`, `__pycache__/`, dll).

File `public/data.js` dan `public/sheet_snapshot.csv.gz` memang hasil generate, tapi sebaiknya tetap di-commit supaya dashboard langsung bisa dibuka tanpa server.

Catatan: **GitHub Pages hanya menyajikan file statis**, jadi `server.py` tidak jalan di sana. Di GitHub Pages dashboard tetap tampil memakai snapshot `data.js` (mode offline). Supaya auto-update berkala tetap aktif, jalankan `server.py` di lokal atau deploy ke platform yang mendukung Python (Render, Railway, VPS, Cloud Run, dll).

## Catatan data

- `value terjual` dibaca sebagai angka dengan **koma sebagai pemisah ribuan** (`"44,200.00"` → `44200`).
- Dipakai baris `02. Penjualan` + 476 baris akhir dengan status kosong (lanjutan penjualan Nov 2026); baris stok masuk/keluar tidak dihitung.
- Variasi huruf Area, Nama Mami Lezza, dan Nama Barang disatukan.

## Struktur

```
mami-lezza-dashboard/
├── build_data.py              # unduh + bersihkan data → public/data.js
├── server.py                  # auto-refresh + API + static server
├── start.command              # shortcut macOS
└── public/
    ├── index.html             # Dashboard Omzet per Area (utama)
    ├── mami.html              # Dashboard Mami Lezza
    ├── styles.css
    ├── app.js / area.js
    ├── data.js                # snapshot (generated)
    └── sheet_snapshot.csv.gz  # cadangan offline (generated)
```
