const crypto = require('crypto');

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','been','being','by','for','from','had','has','have','he','her','hers','him','his','i','in','into','is','it','its','of','on','or','our','ours','she','that','the','their','theirs','them','they','this','those','to','was','we','were','what','when','where','which','who','why','will','with','you','your'
]);

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripCitations(value) {
  return normalizeWhitespace(String(value || '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*citation needed[^)]*\)/gi, ''));
}

function normalizedText(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value, { keepStopWords = false, minLength = 2 } = {}) {
  return normalizedText(value)
    .split(' ')
    .filter(Boolean)
    .filter((token) => token.length >= minLength)
    .filter((token) => keepStopWords || !STOP_WORDS.has(token));
}

function tokenSet(value, options) {
  return new Set(tokens(value, options));
}

function jaccard(left, right) {
  const a = left instanceof Set ? left : tokenSet(left);
  const b = right instanceof Set ? right : tokenSet(right);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function lexicalOverlap(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / Math.min(a.size, b.size);
}

function splitSentences(value) {
  const clean = stripCitations(value)
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];
  return clean
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter(Boolean);
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function stableId(prefix, value, length = 16) {
  return `${prefix}_${sha256Text(value).slice(0, length)}`;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function seededNumber(value) {
  const hex = sha256Text(value).slice(0, 12);
  return Number.parseInt(hex, 16);
}

function deterministicShuffle(items, seed) {
  const output = [...items];
  let state = seededNumber(seed) || 1;
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    const swap = state % (index + 1);
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

module.exports = {
  STOP_WORDS,
  normalizeWhitespace,
  stripCitations,
  normalizedText,
  tokens,
  tokenSet,
  jaccard,
  lexicalOverlap,
  splitSentences,
  sha256Text,
  stableId,
  clamp,
  deterministicShuffle
};
