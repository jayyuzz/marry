import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  extractContent,
  normalizeAnalysisResult,
  normalizeRoadmapResult
} from '../ai-utils.js';

test('extracts content from a normal OpenAI-compatible response', () => {
  const raw = JSON.stringify({ choices: [{ message: { content: '{"skor":72}' } }] });
  assert.equal(extractContent(raw), '{"skor":72}');
});

test('extracts content from a JSON response followed by data DONE', () => {
  const raw = fs.readFileSync(new URL('../raw-test.json', import.meta.url), 'utf8');
  assert.match(extractContent(raw), /\"skor\":80/);
});

test('extracts content from newline-delimited SSE chunks', () => {
  const raw = [
    'data: {"choices":[{"delta":{"content":"{\\"skor\\":"}}]}',
    'data: {"choices":[{"delta":{"content":"72}"}}]}',
    'data: [DONE]'
  ].join('\n');
  assert.equal(extractContent(raw), '{"skor":72}');
});

test('normalizes analysis and roadmap response shapes', () => {
  const analysis = normalizeAnalysisResult({ skor: 120, estimasiPermintaan: -2, platform: ['Gumroad'] });
  assert.equal(analysis.skor, 100);
  assert.equal(analysis.estimasiPermintaan, 0);
  assert.deepEqual(analysis.platform, ['Gumroad']);
  assert.deepEqual(normalizeRoadmapResult({ fase: [{ kegiatan: ['Build MVP'] }] }).fase[0].kegiatan, ['Build MVP']);
});

test('rejects a non-object roadmap response', () => {
  assert.throws(() => normalizeRoadmapResult(null), /invalid roadmap object/);
});
