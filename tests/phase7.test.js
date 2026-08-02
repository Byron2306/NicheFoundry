const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { validateStudioPack, buildStudioBlueprint } = require('../lib/studios');
const { buildChannelStrategy, assessEpisodeStrategy } = require('../lib/audience_strategy');
const { buildNarrativePackage } = require('../lib/story_engine');
const {
  buildVisualPackage, renderVisualPreviewAssets, validateVisualSystem,
  validateExternalAssetRecord, buildSimilarityReport
} = require('../lib/visual_system');
const { verifyVisualAssetHashes } = require('../lib/evidence');
const { FoundryDatabase } = require('../lib/database');

const ROOT = path.resolve(__dirname, '..');
const STUDIO_DIR = path.join(ROOT, 'studios', 'builtin');

function loadPack(id) {
  return JSON.parse(fs.readFileSync(path.join(STUDIO_DIR, `${id}.json`), 'utf8'));
}

function fixtureClaims(count = 14) {
  return Array.from({ length: count }, (_, index) => ({
    claim_id: `claim_${index + 1}`, source_id: `source_${(index % 3) + 1}`,
    source_url: `https://example.org/source-${(index % 3) + 1}`, source_title: `Independent Source ${(index % 3) + 1}`,
    subject: `Evidence unit ${index + 1}`,
    claim: `Evidence unit ${index + 1} establishes a distinct verified detail relevant to stage ${index + 1}.`,
    supporting_passage: `Evidence unit ${index + 1} establishes a distinct verified detail relevant to stage ${index + 1}.`,
    passage_start: 0, passage_end: 96, source_revision_id: `revision_${index + 1}`,
    status: 'supported', confidence: 0.92 - index * 0.01, claim_type: 'description'
  }));
}

function buildForPack(id, overrides = {}) {
  const pack = loadPack(id);
  const brief = { ...pack.samples[0], output_format: 'long_form', target_duration_minutes: 8, ...overrides };
  const strategy = buildChannelStrategy(pack, { episodes: [], opportunities: [] });
  const audience = assessEpisodeStrategy(pack, brief, { episodes: [], opportunities: [], channel_strategy: strategy });
  const archetype = pack.content.archetypes.find((item) => item.id === brief.archetype_id);
  const claims = fixtureClaims();
  const studioBlueprint = buildStudioBlueprint(pack, brief, claims);
  const story = buildNarrativePackage({ pack, archetype, brief, claims, sources: [], studioBlueprint, audienceAssessment: audience, priorPackets: [] });
  const episodeId = `episode_${id}`;
  const visual = buildVisualPackage({ pack, brief, scriptPackage: story.script_package, episodeId, priorPackets: [] });
  return { pack, brief, story, visual, episodeId };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Server exited early with code ${child.exitCode}`);
    try { const response = await fetch(`${baseUrl}/api/health`); if (response.ok) return; } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error('Timed out waiting for server.');
}

async function startServer(tempRoot, port) {
  const dataDir = path.join(tempRoot, 'data');
  const episodesDir = path.join(tempRoot, 'episodes');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(episodesDir, { recursive: true });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', FOUNDRY_DATA_DIR: dataDir, FOUNDRY_EPISODES_DIR: episodesDir, FOUNDRY_ALLOW_OFFLINE_SOURCE_FIXTURES: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);
  return { child, baseUrl, dataDir, episodesDir };
}

async function stopServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

function cookieFrom(response) { return String(response.headers.get('set-cookie') || '').split(';')[0]; }
async function api(baseUrl, cookie, pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) } });
}

test('Phase 7 built-in Studio Packs define valid executable visual constitutions', () => {
  const identities = [];
  for (const id of ['failure_atlas', 'history_under_glass', 'practical_open_source', 'puzzle_planet']) {
    const pack = loadPack(id);
    assert.equal(validateStudioPack(pack).passed, true);
    const visualValidation = validateVisualSystem(pack);
    assert.equal(visualValidation.passed, true, `${id}: ${visualValidation.issues.join('; ')}`);
    assert.ok(pack.visual_system.compositions.length >= 6);
    assert.ok(pack.visual_system.thumbnail_compositions.length >= 3);
    const built = buildForPack(id);
    assert.equal(built.visual.visual_report.passed, true, `${id}: ${built.visual.visual_report.issues.join('; ')}`);
    assert.ok(built.visual.visual_report.unique_compositions >= 4);
    identities.push(built.visual.visual_identity.identity_hash);
  }
  assert.equal(new Set(identities).size, 4);
});

test('Phase 7 creates materially different scene grammars and thumbnails for all pilots', () => {
  const outputs = ['failure_atlas', 'history_under_glass', 'practical_open_source', 'puzzle_planet'].map(buildForPack);
  const motifs = outputs.map((item) => item.visual.visual_identity.motif);
  const openingCompositions = outputs.map((item) => item.visual.visual_plan.scene_plans[0].composition);
  const thumbnailCompositions = outputs.map((item) => item.visual.thumbnail_plan.candidates[0].composition);
  assert.equal(new Set(motifs).size, 4);
  assert.equal(new Set(openingCompositions).size, 4);
  assert.equal(new Set(thumbnailCompositions).size, 4);
  for (const output of outputs) {
    assert.equal(output.visual.visual_plan.scene_plans.length, output.story.script_package.scenes.length);
    assert.ok(output.visual.visual_plan.scene_plans.every((scene) => scene.preview_path.endsWith('.svg') && scene.safe_area && scene.motion_cue));
    assert.ok(output.visual.thumbnail_plan.candidates.every((candidate) => candidate.text_word_count <= 7 && candidate.contrast_ratio >= 4.5));
  }
});

test('Phase 7 renders real SVG storyboards and independently verifies every hash', () => {
  const output = buildForPack('failure_atlas');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase7-assets-'));
  try {
    const hashes = renderVisualPreviewAssets(temp, output.visual, output.brief.working_title, output.brief.topic);
    fs.writeFileSync(path.join(temp, 'visual_asset_hashes.json'), `${JSON.stringify(hashes, null, 2)}\n`);
    const verification = verifyVisualAssetHashes(temp);
    assert.equal(hashes.complete, true);
    assert.equal(verification.verified, true, JSON.stringify(verification.verification));
    assert.equal(hashes.assets.length, output.visual.visual_plan.scene_plans.length + 1);
    const first = fs.readFileSync(path.join(temp, output.visual.visual_plan.scene_plans[0].preview_path), 'utf8');
    assert.match(first, /FAILURE ATLAS/);
    assert.match(first, /deterministic storyboard preview/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Phase 7 anti-template audit blocks a near-identical visual package and composition monoculture', () => {
  const output = buildForPack('history_under_glass');
  const current = output.visual.fingerprint_tokens;
  const prior = { episode: { episode_id: 'prior_visual', title: 'Prior visual clone' }, visual_package: { fingerprint_tokens: [...current] } };
  const clonedScenes = output.visual.visual_plan.scene_plans.map((scene) => ({ ...scene, composition: 'object_vitrine' }));
  const report = buildSimilarityReport(current, clonedScenes, [prior], output.episodeId);
  assert.equal(report.passed, false);
  assert.ok(report.maximum_library_similarity >= 0.99);
  assert.ok(report.largest_composition_share > 0.5);
  assert.ok(report.issues.length >= 2);
});

test('Phase 7 rejects imported assets without explicit rights and attribution evidence', () => {
  const invalid = validateExternalAssetRecord({ asset_id: 'asset_x', relative_path: 'imports/visuals/x.png', rights_status: 'cleared' });
  assert.equal(invalid.passed, false);
  assert.ok(invalid.issues.some((item) => item.includes('licence')));
  const valid = validateExternalAssetRecord({ asset_id: 'asset_x', relative_path: 'imports/visuals/x.png', rights_status: 'cleared', licence: 'CC BY 4.0', creator: 'Example Museum', generated_by: 'human_import' });
  assert.equal(valid.passed, true);
});

test('Phase 7 persists visual packages, fingerprints, and asset ledgers in SQLite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase7-db-'));
  const database = new FoundryDatabase(path.join(temp, 'foundry.sqlite3'));
  try {
    const output = buildForPack('practical_open_source');
    database.db.prepare(`INSERT INTO episodes(episode_id,title,status,episode_dir,state_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run(output.episodeId, 'Visual', 'draft', 'episodes/visual', '{}', new Date().toISOString(), new Date().toISOString());
    database.saveVisualPackage(`episode:${output.episodeId}`, output.episodeId, output.pack.studio.id, output.visual);
    const restored = database.getVisualPackageForEpisode(output.episodeId);
    assert.equal(restored.passed, true);
    assert.equal(restored.studio_id, 'practical_open_source');
    assert.match(restored.identity_hash, /^visual_identity_[a-f0-9]{32}$/);
    assert.equal(database.listVisualAssets(output.episodeId).length, output.visual.asset_manifest.assets.length);
    assert.equal(database.listVisualPackages({ studioId: 'practical_open_source' }).length, 1);
  } finally { database.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Phase 7 console contains every DOM target used by the Visual Foundry client', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const ids = [
    'previewVisualButton', 'refreshVisualButton', 'visualIdentityStrip', 'visualIdentityJson',
    'visualReportJson', 'thumbnailPlanJson', 'visualSimilarityJson', 'visualStoryboard',
    'assetProvenanceJson', 'visualAssetPath', 'visualAssetScene', 'visualAssetCreator',
    'visualAssetLicence', 'visualAssetReplaces', 'validateVisualAssetButton',
    'registerVisualAssetButton', 'visualAssetValidationJson'
  ];
  for (const id of ids) {
    assert.match(html, new RegExp(`id=[\"']${id}[\"']`), `Missing Visual Foundry DOM target ${id}`);
    assert.ok(app.includes(`getElementById("${id}")`) || app.includes(`getElementById('${id}')`), `Visual client does not use ${id}`);
  }
});

test('Phase 7 HTTP workflow generates approval-bound visual evidence and registers a licensed replacement', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase7-http-'));
  const port = await freePort();
  const running = await startServer(tempRoot, port);
  t.after(async () => { await stopServer(running.child); fs.rmSync(tempRoot, { recursive: true, force: true }); });
  const root = await fetch(`${running.baseUrl}/`);
  const cookie = cookieFrom(root);
  const brief = { ...loadPack('puzzle_planet').samples[0], output_format: 'long_form', target_duration_minutes: 6, target_persona_id: 'curious_child', viewer_job: 'Let me test myself', content_pillar_id: 'science_adventures' };
  const generated = await api(running.baseUrl, cookie, '/api/generate', { method: 'POST', body: JSON.stringify({ brief }) });
  assert.equal(generated.status, 200);
  const payload = await generated.json();
  const state = payload.state;
  assert.equal(state.visual_report.passed, true, JSON.stringify(state.visual_report.issues));
  assert.equal(state.qa.visual_system_passed, true);
  assert.equal(state.qa.status, 'blocked_pending_human_approval');
  const visualApi = await api(running.baseUrl, cookie, `/api/visual-system?episode_id=${encodeURIComponent(state.episode.episode_id)}`);
  assert.equal(visualApi.status, 200);
  const visual = await visualApi.json();
  assert.equal(visual.visual_asset_hashes.complete, true);
  assert.ok(visual.asset_manifest.assets.length >= state.script_package.scenes.length + 1);
  const previewPath = visual.visual_plan.scene_plans[0].preview_path;
  const previewResponse = await api(running.baseUrl, cookie, `/api/visual-assets/file?episode_id=${encodeURIComponent(state.episode.episode_id)}&path=${encodeURIComponent(previewPath)}`);
  assert.equal(previewResponse.status, 200);
  assert.match(previewResponse.headers.get('content-type') || '', /image\/svg\+xml/);
  assert.match(await previewResponse.text(), /deterministic storyboard preview/);
  const blockedPreview = await api(running.baseUrl, cookie, `/api/visual-assets/file?episode_id=${encodeURIComponent(state.episode.episode_id)}&path=${encodeURIComponent('../brief.json')}`);
  assert.equal(blockedPreview.status, 400);
  const episodeDir = path.join(running.episodesDir, state.episode.episode_id);
  const importDir = path.join(episodeDir, 'imports', 'visuals');
  fs.mkdirSync(importDir, { recursive: true });
  fs.writeFileSync(path.join(importDir, 'replacement.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#071629"/></svg>');
  const registration = await api(running.baseUrl, cookie, '/api/visual-assets/register', {
    method: 'POST', body: JSON.stringify({ episode_id: state.episode.episode_id, scene_id: state.script_package.scenes[1].scene_id, relative_path: 'imports/visuals/replacement.svg', creator: 'Local editorial team', licence: 'project-owned', rights_status: 'cleared', generated_by: 'human_import', replaces_asset_id: state.asset_manifest.assets[1].asset_id })
  });
  const registrationText = await registration.text();
  assert.equal(registration.status, 200, registrationText);
  const registered = JSON.parse(registrationText);
  assert.equal(registered.asset.rights_status, 'cleared');
  assert.equal(registered.state.editorial_evidence_current, false);
  assert.equal(registered.state.approved, false);
  assert.ok(registered.state.asset_manifest.assets.some((asset) => asset.relative_path === 'imports/visuals/replacement.svg'));
});
