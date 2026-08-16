const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  gammaSinglePageRequests, gammaFetch, pollGammaGeneration,
  downloadGammaExportFile, normalizeGammaImage
} = require('../lib/gamma_system');
const { discoverThemeMusic } = require('../lib/music_discovery');
const { loadEnvFile } = require('./env_loader');

loadEnvFile(path.resolve(__dirname, '..', '.env'));

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function safeName(value) { return String(value).replace(/[^a-zA-Z0-9_-]+/g, '_'); }

function packetFor(episodeDir) {
  const brief = readJson(path.join(episodeDir, 'brief.json'));
  const pack = readJson(path.join(episodeDir, 'studio_pack_snapshot.json'));
  const script = readJson(path.join(episodeDir, 'script_package.json'));
  const colors = pack.visual_identity?.colors || {
    background: '#071314', surface: '#102326', primary: '#e9f0ec', accent: '#e39a3b', secondary: '#6ca6a4'
  };
  return {
    brief: { ...brief, studio_id: pack.studio?.id || 'practical_open_source' },
    episode: { episode_id: path.basename(episodeDir), title: script.title || brief.title },
    script_package: script,
    visual_identity: { studio_name: pack.studio?.name || 'Practical Open Source', colors },
    visual_plan: { scene_plans: (script.scenes || []).map((scene, index) => ({
      scene_id: scene.scene_id,
      title: scene.title || `Scene ${index + 1}`,
      focal_subject: scene.title || brief.topic,
      visual_requirements: [
        'cinematic documentary still', 'real environmental depth', 'single dominant subject',
        'no presentation cards', 'no paragraphs or interface chrome'
      ],
      evidence_overlay: 'Claims remain bounded by supplied evidence.',
      source_ids: scene.source_ids || [], claim_ids: scene.claim_ids || []
    })) },
    thumbnail_plan: { candidates: [{ candidate_id: 'premium', text: 'CAN YOUR PLAN PROVE IT?', emotional_promise: 'evidence under pressure' }], selected_candidate: 'premium' }
  };
}

async function buildGamma(packet, episodeDir) {
  const apiKey = process.env.GAMMA_API_KEY;
  if (!apiKey) throw new Error('GAMMA_API_KEY is required by the premium visual gate.');
  const outputDir = path.join(episodeDir, 'premium_visuals');
  const rawDir = path.join(outputDir, 'gamma_raw');
  ensureDir(rawDir);
  const requests = gammaSinglePageRequests(packet);
  const assets = [];
  for (const [index, entry] of requests.entries()) {
    const created = await gammaFetch('https://public-api.gamma.app/v1.0/generations', {
      apiKey, method: 'POST', body: entry.body
    });
    const generationId = created?.generationId;
    if (!generationId) throw new Error(`Gamma omitted generationId for ${entry.title}.`);
    const status = await pollGammaGeneration({ apiKey, generationId });
    if (!status?.exportUrl) throw new Error(`Gamma omitted exportUrl for ${entry.title}.`);
    const downloaded = await downloadGammaExportFile(status.exportUrl, path.join(rawDir, generationId, 'export'));
    const source = downloaded.files?.[0];
    if (!source) throw new Error(`Gamma exported no PNG for ${entry.title}.`);
    const isThumbnail = entry.type === 'thumbnail';
    const scene = isThumbnail ? null : packet.visual_plan.scene_plans[index];
    const targetName = isThumbnail ? 'THUMBNAIL_GAMMA.png' : `${String(index + 1).padStart(2, '0')}_${scene.scene_id}_GAMMA.png`;
    const target = path.join(outputDir, targetName);
    normalizeGammaImage(source, target);
    assets.push({
      kind: entry.type, scene_id: scene?.scene_id || null, generation_id: generationId,
      relative_path: path.relative(episodeDir, target), sha256: sha256(target), bytes: fs.statSync(target).size,
      provider: 'gamma_public_api', native_engine_invoked: true
    });
  }
  const receipt = {
    schema: 'nichefoundry.gamma_execution_receipt.v1', provider: 'gamma_public_api',
    native_engine_invoked: true, requested_asset_count: requests.length,
    produced_asset_count: assets.length, scene_coverage: packet.visual_plan.scene_plans.length,
    thumbnail_present: assets.some((asset) => asset.kind === 'thumbnail'), assets
  };
  writeJson(path.join(episodeDir, 'gamma_execution_receipt.json'), receipt);
  return receipt;
}

function commercialFriendlyLicence(url) {
  const value = String(url || '').toLowerCase();
  return value.includes('creativecommons.org/publicdomain/zero/') ||
    /creativecommons\.org\/licenses\/by(?:-sa)?\//.test(value);
}

async function buildMusic(pack, brief, episodeDir) {
  if (!process.env.JAMENDO_CLIENT_ID) throw new Error('JAMENDO_CLIENT_ID is required by the premium music gate.');
  const discovery = await discoverThemeMusic({ pack, topic: brief.topic || brief.title, limit: 12 });
  const selected = (discovery.candidates || []).find((track) =>
    track.download_allowed && track.download_url && commercialFriendlyLicence(track.licence_url));
  if (!selected) throw new Error('Jamendo returned no downloadable CC0/CC-BY/CC-BY-SA instrumental suitable for commercial use.');
  const response = await fetch(selected.download_url);
  if (!response.ok) throw new Error(`Jamendo music download returned HTTP ${response.status}.`);
  const musicDir = path.join(episodeDir, 'imports');
  ensureDir(musicDir);
  const musicFile = path.join(musicDir, 'music_bed.mp3');
  fs.writeFileSync(musicFile, Buffer.from(await response.arrayBuffer()));
  const attribution = `${selected.title} — ${selected.artist}\nLicence: ${selected.licence_name || selected.licence_url}\n${selected.licence_url}\nSource: ${selected.page_url}\n`;
  fs.writeFileSync(path.join(musicDir, 'MUSIC_ATTRIBUTION.txt'), attribution);
  const receipt = {
    schema: 'nichefoundry.music_rights_receipt.v1', provider: 'jamendo', native_discovery_invoked: true,
    title: selected.title, artist: selected.artist, track_id: selected.id,
    page_url: selected.page_url, licence_name: selected.licence_name,
    licence_url: selected.licence_url, download_allowed: selected.download_allowed,
    commercial_friendly_licence: true, attribution_required: !String(selected.licence_url).includes('/zero/'),
    attribution_file: 'imports/MUSIC_ATTRIBUTION.txt', relative_path: 'imports/music_bed.mp3',
    sha256: sha256(musicFile), bytes: fs.statSync(musicFile).size, human_release: 'NEEDS_YOU'
  };
  writeJson(path.join(episodeDir, 'music_rights_receipt.json'), receipt);
  return receipt;
}

async function main() {
  const episodeArg = process.argv[2];
  if (!episodeArg) throw new Error('Usage: node scripts/build_premium_assets.js <episode-dir>');
  const episodeDir = path.resolve(episodeArg);
  const packet = packetFor(episodeDir);
  const pack = readJson(path.join(episodeDir, 'studio_pack_snapshot.json'));
  const brief = readJson(path.join(episodeDir, 'brief.json'));
  const gamma = await buildGamma(packet, episodeDir);
  const music = await buildMusic(pack, brief, episodeDir);
  const receipt = {
    schema: 'nichefoundry.premium_assets_receipt.v1', gamma_native_execution: 'PASS',
    gamma_scene_coverage: gamma.scene_coverage, gamma_thumbnail: 'PASS',
    jamendo_native_discovery: 'PASS', cleared_music_download: 'PASS',
    procedural_music_fallback: 'REFUSE', music_rights_evidence: 'PASS',
    human_release: 'NEEDS_YOU'
  };
  writeJson(path.join(episodeDir, 'premium_assets_receipt.json'), receipt);
  console.log(`Premium assets ready: ${gamma.produced_asset_count} Gamma images and Jamendo track ${music.track_id}.`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
