function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asText(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asTextArray(value) {
  return Array.isArray(value) ? value.map(asText).filter(Boolean) : [];
}

function messageContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => typeof part === 'string' ? part : asText(part?.text)).join('');
  }
  return '';
}

// Handles regular OpenAI-compatible JSON and SSE responses, including captures
// where a JSON response is immediately followed by `data: [DONE]`.
export function extractContent(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return '';

  try {
    const content = messageContent(JSON.parse(text));
    if (content) return content;
  } catch {
    // Continue with the tolerant SSE/prefix parsing below.
  }

  const marker = text.indexOf('data:');
  if (text.startsWith('{') && marker > 0) {
    try {
      const content = messageContent(JSON.parse(text.slice(0, marker).trim()));
      if (content) return content;
    } catch {
      // The prefix was not a complete JSON response; try SSE lines.
    }
  }

  let content = '';
  for (const line of text.split(/\r?\n/)) {
    const data = line.trimStart().startsWith('data:')
      ? line.trimStart().slice(5).trim()
      : '';
    if (!data || data === '[DONE]') continue;
    try {
      const payload = JSON.parse(data);
      const delta = payload?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') content += delta;
      else if (Array.isArray(delta)) content += delta.map(part => asText(part?.text)).join('');
    } catch {
      // Ignore malformed SSE chunks and let the caller report an empty result.
    }
  }
  return content;
}

export function parseJSON(text) {
  let value = String(text || '').trim();
  const fence = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) value = fence[1].trim();
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start !== -1 && end !== -1) value = value.slice(start, end + 1);

  try {
    return JSON.parse(value);
  } catch {
    const err = new Error('Failed to parse the AI response into JSON.');
    err.status = 502;
    throw err;
  }
}

export function clampNum(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

export function normalizeAnalysisResult(value) {
  if (!isObject(value)) {
    const err = new Error('The AI returned an invalid analysis object.');
    err.status = 502;
    throw err;
  }

  return {
    ...value,
    skor: clampNum(value.skor),
    rekomendasi: asText(value.rekomendasi),
    ringkasan: asText(value.ringkasan),
    pasarTerbaik: asTextArray(value.pasarTerbaik),
    estimasiPermintaan: clampNum(value.estimasiPermintaan),
    tingkatKompetisi: clampNum(value.tingkatKompetisi),
    hargaOptimal: isObject(value.hargaOptimal) ? {
      ...value.hargaOptimal,
      min: value.hargaOptimal.min ?? '',
      maks: value.hargaOptimal.maks ?? '',
      mataUang: asText(value.hargaOptimal.mataUang || 'USD'),
      model: asText(value.hargaOptimal.model)
    } : { min: '', maks: '', mataUang: 'USD', model: '' },
    platform: asTextArray(value.platform),
    estimasiPendapatan: asText(value.estimasiPendapatan),
    kelebihan: asTextArray(value.kelebihan),
    kekurangan: asTextArray(value.kekurangan),
    langkahPertama: asTextArray(value.langkahPertama),
    bahasaKonten: asText(value.bahasaKonten)
  };
}

export function normalizeRoadmapResult(value) {
  if (!isObject(value) || !Array.isArray(value.fase)) {
    const err = new Error('The AI returned an invalid roadmap object.');
    err.status = 502;
    throw err;
  }

  return {
    ...value,
    ringkasan: asText(value.ringkasan),
    totalWaktu: asText(value.totalWaktu),
    fase: value.fase.filter(isObject).map((phase, index) => ({
      ...phase,
      nama: asText(phase.nama || `Phase ${index + 1}`),
      durasi: asText(phase.durasi),
      tujuan: asText(phase.tujuan),
      kegiatan: asTextArray(phase.kegiatan),
      keluaran: asText(phase.keluaran)
    }))
  };
}
