#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { discoverThemeMusic, discoverOpenverseMusic, fetchOpenverseTrack } = require('../lib/music_discovery');

const ROOT = path.resolve(__dirname, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    if (!(key in process.env)) process.env[key] = trimmed.slice(index + 1).trim();
  }
}

function parseArgs(argv) {
  const options = { studio: 'practical_open_source', topic: '', limit: 5, select: '1', provider: 'openverse' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--episode') options.episode = argv[++index];
    else if (value === '--studio') options.studio = argv[++index];
    else if (value === '--topic') options.topic = argv[++index];
    else if (value === '--limit') options.limit = Number(argv[++index]);
    else if (value === '--select') options.select = argv[++index];
    else if (value === '--openverse-id') options.openverseId = argv[++index];
    else if (value === '--provider') options.provider = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.episode) throw new Error('--episode is required.');
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10) throw new Error('--limit must be 1 to 10.');
  if (!['openverse', 'mixed'].includes(options.provider)) throw new Error('--provider must be openverse or mixed.');
  return options;
}

function safeName(value) {
  return String(value || 'track').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'track';
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function extensionFor(track) {
  const declared = String(track.filetype || '').toLowerCase();
  if (['mp3', 'ogg', 'wav', 'm4a'].includes(declared)) return declared;
  try {
    const extension = path.extname(new URL(track.download_url).pathname).slice(1).toLowerCase();
    if (['mp3', 'ogg', 'wav', 'm4a'].includes(extension)) return extension;
  } catch {}
  return 'mp3';
}

function probe(filePath) {
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', filePath
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Downloaded track is not valid audio: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

async function download(url, target) {
  const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'NicheFoundry/1.0 (licensed media download)' } });
  if (!response.ok) throw new Error(`Music download returned HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 16_000) throw new Error('Downloaded music file is unexpectedly small.');
  fs.writeFileSync(target, bytes);
}

async function main() {
  loadEnvFile(path.join(ROOT, '.env'));
  const options = parseArgs(process.argv.slice(2));
  const episodeDir = path.resolve(options.episode);
  if (!fs.existsSync(episodeDir)) throw new Error(`Episode directory does not exist: ${episodeDir}`);
  const packPath = path.join(ROOT, 'studios', 'builtin', `${options.studio}.json`);
  if (!fs.existsSync(packPath)) throw new Error(`Unknown built-in studio: ${options.studio}`);
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  const discovery = options.openverseId
    ? {
        provider: 'openverse',
        rights_policy: 'CC0, Public Domain Mark, or CC BY only; commercial use and adaptation required.',
        candidates: [await fetchOpenverseTrack({ id: options.openverseId, pack, topic: options.topic })],
        issues: []
      }
    : options.provider === 'openverse'
      ? await discoverOpenverseMusic({ pack, topic: options.topic, limit: options.limit })
      : await discoverThemeMusic({ pack, topic: options.topic, limit: options.limit });
  if (!discovery.candidates.length) throw new Error(`No commercially reusable music found. ${discovery.issues.join(' ')}`);

  const choicesDir = path.join(episodeDir, 'imports', 'music_choices');
  fs.mkdirSync(choicesDir, { recursive: true });
  const downloaded = [];
  for (let index = 0; index < discovery.candidates.length; index += 1) {
    const track = discovery.candidates[index];
    if (!track.rights?.passed) continue;
    const extension = extensionFor(track);
    const fileName = `${String(index + 1).padStart(2, '0')}-${safeName(track.artist)}-${safeName(track.title)}.${extension}`;
    const target = path.join(choicesDir, fileName);
    if (!fs.existsSync(target)) await download(track.download_url, target);
    downloaded.push({
      rank: index + 1,
      ...track,
      local_path: path.relative(episodeDir, target).replaceAll(path.sep, '/'),
      sha256: sha256(target),
      probe: probe(target)
    });
  }
  if (!downloaded.length) throw new Error('Discovery returned tracks, but none passed the rights gate and media validation.');

  const selected = /^\d+$/.test(options.select)
    ? downloaded.find((item) => item.rank === Number(options.select))
    : downloaded.find((item) => String(item.id) === options.select);
  if (!selected) throw new Error(`Selected track '${options.select}' is not in the downloaded candidate set.`);
  const selectedSource = path.join(episodeDir, selected.local_path);
  const selectedExtension = path.extname(selectedSource).slice(1);
  for (const extension of ['wav', 'mp3', 'm4a', 'ogg']) {
    fs.rmSync(path.join(episodeDir, 'imports', `music_bed.${extension}`), { force: true });
  }
  const selectedTarget = path.join(episodeDir, 'imports', `music_bed.${selectedExtension}`);
  fs.copyFileSync(selectedSource, selectedTarget);

  const receipt = {
    schema: 'nichefoundry.commercial_music_selection.v1',
    created_at: new Date().toISOString(),
    episode: path.basename(episodeDir),
    topic: options.topic,
    studio: options.studio,
    rights_policy: discovery.rights_policy,
    discovery_provider: discovery.provider,
    selected: { ...selected, promoted_path: path.relative(episodeDir, selectedTarget).replaceAll(path.sep, '/') },
    candidates: downloaded,
    human_music_review_required: true,
    attribution_must_ship_with_publication: Boolean(selected.rights.attribution_required)
  };
  fs.writeFileSync(path.join(choicesDir, 'COMMERCIAL_MUSIC_RECEIPT.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  const attribution = selected.attribution || `"${selected.title}" by ${selected.artist}, ${selected.licence_name}; ${selected.licence_url}`;
  fs.writeFileSync(
    path.join(episodeDir, 'imports', 'MUSIC_ATTRIBUTION.md'),
    `# Music Attribution\n\n${attribution}\n\nSource: ${selected.page_url}\n\nThe track was trimmed, looped, faded, and mixed beneath narration.\n`
  );
  process.stdout.write(`${JSON.stringify({ selected: selected.title, artist: selected.artist, licence: selected.licence_name, output: selectedTarget, candidates: downloaded.length }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
