# marry 💍

**Live:** https://marry.myap.web.id

Market-prospect analyzer for small digital products (ebooks, apps, templates, courses, presets). Describe a product, pick a target country, and get a structured analysis plus an execution roadmap, in 50+ languages.
*Analisis prospek pasar internasional untuk produk digital kecil.*

## Features
- `/api/analyze`: AI-generated market analysis (demand, competition, pricing, score)
- `/api/roadmap`: step-by-step execution roadmap for the product
- 140+ built-in trending product ideas as one-click starting points
- Membership / Supabase auth and Ko-fi webhook for supporter tiers
- Rate-limited AI endpoints, visitor statistics by country

## Stack
Node.js · Express · Supabase · OpenAI-compatible AI gateway · Vercel (serverless)

## Run locally
```bash
cp .env.example .env     # set AI_API_KEY, AI_BASE_URL, Supabase keys
npm install
npm start                # http://localhost:3000
npm test                 # parser / schema-normalisation tests
```

## API
- `POST /api/analyze` `{ "produk": "..." }` returns the analysis as JSON
- `POST /api/roadmap` `{ "produk": "..." }` returns the roadmap as JSON
- `GET /api/health` returns status (`aiConfigured` true/false)
- `GET /api/visitors` returns visitor and top-country stats

## Structure
- `server.js`: Express backend and AI gateway calls
- `ai-utils.js`: AI response parsing, schema normalisation, score helpers
- `supabase.js`: Supabase client
- `public/index.html`: single-page UI
- `test/`: unit tests

> `TRUST_PROXY` must stay `false` unless the app sits behind a reverse proxy you trust.
