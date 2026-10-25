# marry 💍

Analisis prospek pasar internasional untuk produk digital kecil (ebook, aplikasi, template, course, preset, dll).

## Cara jalan

```bash
cd E:\VIbe\Projects\marry
copy .env.example .env   # lalu isi AI_API_KEY dari dashboard 9router
npm install
npm start
# buka http://localhost:3000
# jalankan test parser/normalisasi
npm test
```

## Alur API

- `POST /api/analyze` body `{ "produk": "..." }` → hasil analisis JSON
- `POST /api/roadmap` body `{ "produk": "..." }` → roadmap eksekusi JSON
- `GET /api/health` → cek status (aiConfigured true/false)
- `GET /api/visitors` → statistik visitor dan negara teratas

## Struktur

- `server.js` — backend Express + panggilan ke gateway AI
- `ai-utils.js` — parser response AI, normalisasi schema, dan helper skor
- `public/index.html` — UI satu halaman
- `.env` — konfigurasi (copy dari `.env.example`, jangan di-commit)

Catatan: `TRUST_PROXY` harus tetap `false` kecuali aplikasi berada di belakang reverse proxy yang benar-benar dipercaya. Endpoint AI memiliki batas request sederhana untuk mencegah penyalahgunaan.
