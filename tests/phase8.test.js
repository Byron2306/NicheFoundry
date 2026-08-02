const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { validateStudioPack } = require('../lib/studios');
const {
  buildHostProfile, buildPronunciationLexicon, applyPronunciations,
  buildAudioPerformancePackage, produceAudioAssets, validateExternalAudioRecord,
  audioProbe
} = require('../lib/audio_system');
const { verifyAudioAssetHashes } = require('../lib/evidence');
const { FoundryDatabase } = require('../lib/database');

const ROOT = path.resolve(__dirname, '..');
const STUDIO_DIR = path.join(ROOT, 'studios', 'builtin');
const STUDIO_IDS = ['failure_atlas', 'history_under_glass', 'practical_open_source', 'puzzle_planet'];

function loadPack(id) {
  return JSON.parse(fs.readFileSync(path.join(STUDIO_DIR, `${id}.json`), 'utf8'));
}

function minimalScript(studioId = 'practical_open_source') {
  const beats = studioId === 'failure_atlas'
    ? ['normal_operation', 'design_lesson']
    : studioId === 'history_under_glass'
      ? ['object_contradiction', 'qualified_meaning']
      : studioId === 'puzzle_planet'
        ? ['mission_emergency', 'educational_payoff']
        : ['working_result_preview', 'validation'];
  return {
    schema: 'nichefoundry.script_package.v1.0',
    scenes: beats.map((storyBeat, index) => ({
      scene_id: `scene_${index + 1}`,
      story_beat: storyBeat,
      narration: index === 0
        ? 'FFmpeg and SQLite make this verified result possible.'
        : 'Run --version, inspect ./output/report.json, and confirm the result.',
      estimated_duration_seconds: 4,
      claim_ids: [`claim_${index + 1}`],
      source_ids: [`source_${index + 1}`]
    }))
  };
}

function timingFor(script) {
  return { scenes: script.scenes.map((scene) => ({ scene_id: scene.scene_id, target_duration_seconds: 8 })) };
}

function packageFor(id, overrides = {}) {
  const pack = loadPack(id);
  const scriptPackage = overrides.scriptPackage || minimalScript(id);
  const brief = { ...pack.samples[0], language: 'en', pronunciation_overrides: overrides.pronunciation_overrides || [] };
  return {
    pack,
    scriptPackage,
    brief,
    audio: buildAudioPerformancePackage({
      pack, brief, scriptPackage, timingPlan: timingFor(scriptPackage), episodeId: `episode_${id}`
    })
  };
}

function commandAvailable(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return !result.error && result.status === 0;
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
  const deadline = Date.now() + 15000;
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
    env: {
      ...process.env,
      PORT: String(port), HOST: '127.0.0.1',
      FOUNDRY_DATA_DIR: dataDir,
      FOUNDRY_EPISODES_DIR: episodesDir,
      FOUNDRY_ALLOW_OFFLINE_SOURCE_FIXTURES: '1',
      ESPEAK_BIN: process.env.ESPEAK_BIN || 'espeak'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  const baseUrl = `http://127.0.0.1:${port}`;
  try { await waitForHealth(baseUrl, child); }
  catch (error) { throw new Error(`${error.message}\n${stderr.join('')}`); }
  return { child, baseUrl, dataDir, episodesDir };
}

async function stopServer(child) {
  if (!child) return;
  if (child.exitCode == null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2500))
    ]);
  }
  if (child.exitCode == null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2500))
    ]);
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
}

function cookieFrom(response) { return String(response.headers.get('set-cookie') || '').split(';')[0]; }
async function api(baseUrl, cookie, pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {})
    }
  });
}

async function jsonResponse(response) {
  const text = await response.text();
  assert.equal(response.ok, true, `HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}

test('Phase 8 built-in Studio Packs define four distinct valid host and sound identities', () => {
  const primaryHosts = [];
  const musicFamilies = [];
  const profileHashes = [];
  for (const id of STUDIO_IDS) {
    const { pack, audio } = packageFor(id);
    assert.equal(validateStudioPack(pack).passed, true, id);
    assert.equal(audio.audio_preflight_report.passed, true, JSON.stringify(audio.audio_preflight_report.issues));
    assert.equal(audio.audio_performance_plan.scenes.length, 2);
    assert.equal(audio.sound_design_plan.scenes.length, 2);
    assert.equal(audio.audio_performance_plan.mastering.sample_rate_hz, 48000);
    primaryHosts.push(audio.host_profile.primary_host.id);
    musicFamilies.push(audio.sound_design_plan.music_identity.family);
    profileHashes.push(audio.host_profile.profile_hash);
  }
  assert.equal(new Set(primaryHosts).size, 4);
  assert.equal(new Set(musicFamilies).size, 4);
  assert.equal(new Set(profileHashes).size, 4);
});

test('Phase 8 pronunciation engine detects technical language and honours editorial overrides', () => {
  const pack = loadPack('practical_open_source');
  const scriptPackage = minimalScript('practical_open_source');
  const lexicon = buildPronunciationLexicon(pack, scriptPackage, {
    pronunciation_overrides: [{ term: 'SQLite', spoken_form: 'S Q lite', review_required: false }]
  });
  const terms = new Map(lexicon.entries.map((item) => [item.term, item]));
  assert.equal(terms.get('FFmpeg').spoken_form, 'eff eff em peg');
  assert.equal(terms.get('SQLite').spoken_form, 'S Q lite');
  assert.equal(terms.get('--version').source, 'detected_flag');
  assert.ok([...terms.keys()].some((term) => term.includes('/output/report.json')));
  const spoken = applyPronunciations('Use FFmpeg, SQLite, and --version.', lexicon);
  assert.match(spoken, /eff eff em peg/);
  assert.match(spoken, /S Q lite/);
  assert.match(spoken, /double dash version/);
});

test('Phase 8 performance plans bind every scene to hosts, cache keys, timing, and sound cues', () => {
  for (const id of STUDIO_IDS) {
    const { audio } = packageFor(id);
    const scenes = audio.audio_performance_plan.scenes;
    assert.ok(scenes.every((scene) => scene.host_id && scene.spoken_text && scene.cache_key.length === 64));
    assert.ok(scenes.every((scene) => scene.output.narration_wav.endsWith('.wav') && scene.output.scene_mix_mp3.endsWith('.mp3')));
    assert.ok(scenes.every((scene) => scene.performance.pace_wpm > 100 && scene.target_duration_seconds > 0));
    assert.equal(new Set(scenes.map((scene) => scene.cache_key)).size, scenes.length);
    assert.ok(audio.sound_design_plan.scenes.some((scene) => scene.sfx_cues.length > 0));
  }
});

test('Phase 8 produces real mastered scene audio, verifies hashes, and reuses deterministic cache', { timeout: 120000 }, async (t) => {
  if (!commandAvailable('ffmpeg', ['-version']) || !commandAvailable('ffprobe', ['-version']) || !commandAvailable(process.env.ESPEAK_BIN || 'espeak', ['--version'])) {
    t.skip('FFmpeg, FFprobe, and eSpeak are required for the real audio production test.');
    return;
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase8-audio-'));
  try {
    const built = packageFor('failure_atlas');
    const first = await produceAudioAssets({ root: ROOT, episodeDir: temp, audioPackage: built.audio, provider: 'espeak', force: false });
    assert.equal(first.passed, true, JSON.stringify(first.performance_report));
    assert.equal(first.performance_report.scene_count, 2);
    assert.equal(first.performance_report.cache_hits, 0);
    assert.ok(first.audio_assets.length >= 8);
    fs.writeFileSync(path.join(temp, 'audio_asset_hashes.json'), `${JSON.stringify(first.audio_asset_hashes, null, 2)}\n`);
    const verification = verifyAudioAssetHashes(temp);
    assert.equal(verification.verified, true, JSON.stringify(verification.verification));
    const preview = audioProbe(path.join(temp, 'audio', 'episode_audio_preview.wav'));
    assert.equal(preview.sample_rate_hz, 48000);
    assert.equal(preview.channels, 2);
    assert.ok(preview.duration_seconds >= 7);
    const second = await produceAudioAssets({ root: ROOT, episodeDir: temp, audioPackage: built.audio, provider: 'espeak', force: false });
    assert.equal(second.passed, true);
    assert.equal(second.performance_report.cache_hits, 2);
    assert.equal(second.performance_report.cache_hit_ratio, 1);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Phase 8 consumes registered scene imports and rejects rights-free audio records', { timeout: 120000 }, async (t) => {
  if (!commandAvailable('ffmpeg', ['-version']) || !commandAvailable('ffprobe', ['-version']) || !commandAvailable(process.env.ESPEAK_BIN || 'espeak', ['--version'])) {
    t.skip('Audio toolchain unavailable.');
    return;
  }
  const invalid = validateExternalAudioRecord({ relative_path: 'imports/audio/voice.mp3', creator: 'Unknown', rights_status: 'cleared' });
  assert.equal(invalid.passed, false);
  assert.ok(invalid.issues.some((issue) => issue.includes('licence')));
  const valid = validateExternalAudioRecord({ relative_path: 'imports/audio/custom-voice.ogg', creator: 'Local narrator', licence: 'project-owned', rights_status: 'cleared' });
  assert.equal(valid.passed, true);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase8-import-'));
  try {
    const built = packageFor('history_under_glass');
    const importDir = path.join(temp, 'imports', 'audio');
    fs.mkdirSync(importDir, { recursive: true });
    const imported = path.join(importDir, 'custom-voice.ogg');
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-c:a', 'libvorbis', imported], { stdio: 'inherit' });
    fs.writeFileSync(path.join(temp, 'audio_imports.json'), `${JSON.stringify({ schema: 'nichefoundry.audio_imports.v1', assets: [{ scene_id: 'scene_1', relative_path: 'imports/audio/custom-voice.ogg', creator: 'Local narrator', licence: 'project-owned', rights_status: 'cleared' }] }, null, 2)}\n`);
    const result = await produceAudioAssets({ root: ROOT, episodeDir: temp, audioPackage: built.audio, provider: 'espeak', force: true });
    const importedScene = result.audio_manifest.scenes.find((scene) => scene.scene_id === 'scene_1');
    assert.equal(importedScene.provider, 'imported');
    assert.equal(result.audio_manifest.scenes.find((scene) => scene.scene_id === 'scene_2').provider, 'espeak');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Phase 8 persists audio packages and asset provenance in SQLite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase8-db-'));
  const database = new FoundryDatabase(path.join(temp, 'foundry.sqlite3'));
  try {
    const built = packageFor('puzzle_planet');
    const episodeId = built.audio.episode_id;
    database.db.prepare(`INSERT INTO episodes(episode_id,title,status,episode_dir,state_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run(episodeId, 'Audio', 'draft', 'episodes/audio', '{}', new Date().toISOString(), new Date().toISOString());
    const assets = [{ asset_id: 'audio_asset_1', scene_id: 'scene_1', asset_type: 'scene_mix_mp3', relative_path: 'audio/scenes/scene_1.mp3', status: 'ready', rights_status: 'cleared', licence: 'project-owned-output', provider: 'espeak', sha256: 'a'.repeat(64) }];
    const saved = database.saveAudioPackage(`episode:${episodeId}`, episodeId, built.pack.studio.id, { ...built.audio, production: { provider: 'espeak', audio_assets: assets } });
    assert.equal(saved.studio_id, 'puzzle_planet');
    assert.equal(saved.provider, 'espeak');
    assert.equal(database.getAudioPackageForEpisode(episodeId).audio_performance_plan.scenes.length, 2);
    assert.equal(database.listAudioAssets(episodeId).length, 1);
    assert.equal(database.listAudioPackages({ studioId: 'puzzle_planet' }).length, 1);
  } finally { database.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Phase 8 console contains every DOM target used by the Performance Forge client', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const ids = [
    'refreshAudioButton', 'audioProviderSelect', 'buildAudioButton', 'approveAudioButton',
    'hostIdentityStrip', 'hostProfileJson', 'pronunciationLexiconJson', 'audioPerformancePlanJson',
    'soundDesignJson', 'audioPreflightJson', 'loudnessReportJson', 'audioSceneList',
    'audioPreviewPlayer', 'audioAssetPath', 'audioAssetScene', 'audioAssetCreator',
    'audioAssetLicence', 'registerAudioAssetButton', 'audioApprovalJson'
  ];
  for (const id of ids) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `Missing Performance Forge DOM target ${id}`);
    assert.ok(app.includes(`getElementById("${id}")`) || app.includes(`getElementById('${id}')`), `Audio client does not use ${id}`);
  }
});

test('Phase 8 server wiring exposes guarded audio production, import, preview, and approval routes', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const evidence = fs.readFileSync(path.join(ROOT, 'lib', 'evidence.js'), 'utf8');
  for (const route of [
    '/api/audio-system',
    '/api/audio-packages',
    '/api/audio-assets/file',
    '/api/audio-system/build',
    '/api/audio-system/import',
    '/api/audio-system/approve'
  ]) assert.ok(server.includes(route), `Missing Phase 8 route ${route}`);
  assert.match(server, /A valid editorial approval is required before audio synthesis/);
  assert.match(server, /Audio production QA has not passed/);
  assert.match(server, /Audio paths must remain inside the episode audio directories/);
  assert.match(server, /audio_approval_bundle\.json/);
  for (const artifact of [
    'host_profile.json', 'pronunciation_lexicon.json', 'audio_performance_plan.json',
    'sound_design_plan.json', 'audio_preflight_report.json', 'audio_manifest.json',
    'audio_asset_hashes.json', 'loudness_report.json', 'audio_performance_report.json'
  ]) assert.ok(server.includes(artifact) || evidence.includes(artifact), `Missing approval-bound audio artifact ${artifact}`);
});
