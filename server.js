// marry — analisis prospek pasar internasional untuk produk digital kecil.
// Backend: Express + gateway AI lokal (9router) via API OpenAI-compatible.

import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  clampNum,
  extractContent,
  normalizeAnalysisResult,
  normalizeRoadmapResult,
  parseJSON
} from './ai-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
app.set('trust proxy', TRUST_PROXY);

const AI_BASE_URL = (process.env.AI_BASE_URL || 'http://localhost:20128/v1').replace(/\/$/, '');
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'oc/muse-spark-1.3-contributor-free';

// ===== Visitor Tracking =====
const VISITORS_FILE = path.join(__dirname, 'visitors.json');
const activeVisitors = new Map();
const aiRequests = new Map();
const AI_RATE_WINDOW_MS = 15 * 60 * 1000;
const AI_RATE_LIMIT = 20;

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || 'local';
}

function isLocalIp(ip) {
  return !ip || ip === 'local' || ip.startsWith('127.') || ip.startsWith('::1') ||
    ip === '::ffff:127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.');
}

function consumeAiRequest(ip) {
  const now = Date.now();
  const current = aiRequests.get(ip);
  if (!current || now - current.startedAt >= AI_RATE_WINDOW_MS) {
    aiRequests.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= AI_RATE_LIMIT) return false;
  current.count += 1;
  return true;
}

function aiRateLimit(req, res, next) {
  if (!consumeAiRequest(clientIp(req))) {
    return res.status(429).json({ error: 'Too many AI requests. Please try again later.' });
  }
  next();
}

function getOnlineCount() {
  const cutoff = Date.now() - 120000; // 2 minutes
  for (const [k, v] of activeVisitors) {
    if (v < cutoff) activeVisitors.delete(k);
  }
  return Math.max(1, activeVisitors.size);
}

function loadVisitors() {
  try {
    if (fs.existsSync(VISITORS_FILE)) return JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8'));
  } catch {}
  return { total: 0, countries: {} };
}

function saveVisitors(data) {
  try { fs.writeFileSync(VISITORS_FILE, JSON.stringify(data), 'utf8'); } catch {}
}

app.use(express.json());

// Track visitor on every page load (non-blocking, runs before static)
app.use((req, res, next) => {
  const ip = clientIp(req);
  activeVisitors.set(ip, Date.now());

  if (req.path === '/' || req.path === '/index.html') {
    (async () => {
      try {
        let country = 'Indonesia';
        let flag = '🇮🇩';
        let code = 'id';

        if (!isLocalIp(ip)) {
          try {
            const geo = await fetch(`https://ipapi.co/${ip}/json/`, { signal: AbortSignal.timeout(3000) }).then(r => r.json());
            if (geo?.country_name) {
              country = geo.country_name;
              code = (geo.country_code || '').toLowerCase();
              flag = geo.country_code ? String.fromCodePoint(...[...geo.country_code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '🌐';
            }
          } catch {}
        }

        const v = loadVisitors();
        v.total = (v.total || 0) + 1;
        if (!v.countries) v.countries = {};
        v.countries[country] = { count: ((v.countries[country]?.count) || 0) + 1, flag, code: code || v.countries[country]?.code || 'id' };
        saveVisitors(v);
      } catch {}
    })();
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// GET /api/visitors — return visitor stats & active online
app.get('/api/visitors', (req, res) => {
  const ip = clientIp(req);
  activeVisitors.set(ip, Date.now());
  const v = loadVisitors();
  const topCountries = Object.entries(v.countries || {})
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([name, d]) => ({
      name,
      count: d.count,
      flag: d.flag,
      code: d.code || (name.toLowerCase() === 'indonesia' ? 'id' : '')
    }));
  res.json({
    total: v.total || 0,
    uniqueCountries: Object.keys(v.countries || {}).length,
    online: getOnlineCount(),
    topCountries
  });
});

// ===== Prompt analisis =====
const SYSTEM_PROMPT = `You are an experienced international market analyst for small digital products.
Your task: analyze the GLOBAL (overseas) market prospects for a digital product sold by an Indonesian creator,
and return the result as valid JSON (no markdown, no extra text — raw JSON only).

Required JSON format (all numbers 0-100):
{
  "skor": 0-100,
  "rekomendasi": "STRONG GO / CAUTION / NOT WORTH IT",
  "ringkasan": "1-2 sentence conclusion",
  "pasarTerbaik": ["Country/Language", "..."],
  "estimasiPermintaan": 0-100,
  "tingkatKompetisi": 0-100,
  "hargaOptimal": { "min": 5, "maks": 29, "mataUang": "USD", "model": "one-time / subscription" },
  "platform": ["Gumroad", "Amazon KDP", "..."],
  "estimasiPendapatan": "realistic monthly income range description in USD",
  "kelebihan": ["...", "..."],
  "kekurangan": ["...", "..."],
  "langkahPertama": ["...", "..."],
  "bahasaKonten": "best content language for the market"
}

Honest, balanced analysis principles:
- Base on realistic patterns of real digital product markets (ebook, app, template, mini-course).
- Don't always say STRONG GO; sensible criticism is valuable.
- Make pasarTerbaik specific (e.g. "US (English)", "Germany", "Australia"), not generic.
- platform must match product type (e.g. recipe ebook -> Amazon KDP + Gumroad; phone app -> App Store + Google Play; template -> Etsy + Gumroad).
- estimasiPendapatan in USD, a range not a single fixed number.
- The user message may require a specific output LANGUAGE and a FOCUS COUNTRY — honor both strictly.`;


// ===== Prompt roadmap (langkah awal → akhir) =====
const SYSTEM_PROMPT_ROADMAP = `You are a digital product launch consultant for an Indonesian creator selling overseas (international market).
Build an execution plan from start to end for the given product idea: research → creation → validation → launch → managing the business.

Return valid JSON (no markdown, no extra text — raw JSON only):
{
  "ringkasan": "one-sentence plan overview",
  "totalWaktu": "e.g. 8-12 weeks",
  "fase": [
    {
      "nama": "Phase name (start → end)",
      "durasi": "week 1",
      "tujuan": "one sentence goal of the phase",
      "kegiatan": ["concrete steps...", "..."],
      "keluaran": "deliverable of this phase"
    },
    ... (4-7 phases is enough, dense & executable)
  ]
}

Principles:
- Order from start to release/end (validation, build product, launch, further marketing, scale).
- Each activity specific & doable by 1 person (no team), no big capital assumption.
- Phases need not reach register a company; stop once product is live & earning (or clearly when to stop).
- The user message may require a specific output LANGUAGE and a FOCUS COUNTRY — honor both strictly.`;

// ===== Handler panggilan AI =====
// Tahan dua format respons dari gateway:
//  1) JSON biasa (OpenAI-compatible non-stream)
//  2) SSE rumah streaming (data: {...}\n\n... data: [DONE])
async function callAI(inputProduk, opts) {
  const system = opts?.system || SYSTEM_PROMPT;
  const userPrompt = `Product idea: "${inputProduk}"
${opts?.user || 'Analyze its overseas market prospects honestly, then return JSON in the required format.'}`;

  if (!AI_API_KEY || AI_API_KEY === 'GANTI_ME') {
    const err = new Error('AI_API_KEY not set. Open http://localhost:20128/dashboard, copy a key, fill it in .env.');
    err.status = 503;
    throw err;
  }

  const body = {
    model: AI_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.6,
    max_tokens: 1500
  };

  let resp;
  try {
    resp = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    const err = new Error('AI gateway unreachable. Make sure 9router is running (9router -t).');
    err.status = 502;
    throw err;
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    const err = new Error(`AI gateway error (${resp.status}): ${txt.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  const rawText = await resp.text();
  const content = extractContent(rawText);
  if (!content) {
    const err = new Error('Empty response from the model.');
    err.status = 502;
    throw err;
  }
  return parseJSON(content);
}

// ===== Routes =====
app.get('/api/health', (req, res) => {
  res.json({ ok: true, aiConfigured: Boolean(AI_API_KEY && AI_API_KEY !== 'GANTI_ME') });
});

app.post('/api/analyze', aiRateLimit, async (req, res) => {
  const input = (req.body?.produk || '').trim();
  const bahasaUser = (req.body?._userPrompt || '').trim();
  if (!input) return res.status(400).json({ error: 'Fill in your product idea first.' });
  if (input.length > 500) return res.status(400).json({ error: 'Description too long (max 500 characters).' });

  try {
    const result = normalizeAnalysisResult(await callAI(input, { user: bahasaUser || undefined }));
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/roadmap', aiRateLimit, async (req, res) => {
  const input = (req.body?.produk || '').trim();
  const bahasaUser = (req.body?._userPrompt || '').trim();
  if (!input) return res.status(400).json({ error: 'Fill in your product idea first.' });
  if (input.length > 500) return res.status(400).json({ error: 'Description too long (max 500 characters).' });

  try {
    const result = normalizeRoadmapResult(await callAI(input, {
      system: SYSTEM_PROMPT_ROADMAP,
      user: [bahasaUser, 'Build a step-by-step plan from start to end, then return JSON in the required format.'].filter(Boolean).join('\n')
    }));
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Keep API errors JSON-shaped and avoid exposing Express/body-parser stack traces.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof SyntaxError && err.status === 400 && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON request body.' });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: 'Internal server error.' });
});

let server = app.listen(PORT, () => {
  console.log(`marry berjalan → http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
