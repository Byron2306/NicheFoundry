const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { buildVisualPackage, renderVisualPreviewAssets } = require('../lib/visual_system');
const { buildAudioPerformancePackage, produceAudioAssets } = require('../lib/audio_system');
const {
  RENDER_PROFILES, buildRenderPlan, validateRenderPlan, buildCaptions,
  renderEpisode, videoProbe, verifyRenderAssetHashes, renderApprovalBundle,
  cameraGrammar
} = require('../lib/render_system');
const { FoundryDatabase } = require('../lib/database');

const ROOT = path.resolve(__dirname, '..');
const STUDIO_DIR = path.join(ROOT, 'studios', 'builtin');
const STUDIO_IDS = ['failure_atlas', 'history_under_glass', 'practical_open_source', 'puzzle_planet'];

function loadPack(id) {
  return JSON.parse(fs.readFileSync(path.join(STUDIO_DIR, `${id}.json`), 'utf8'));
}

function commandAvailable(command, args = ['-version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function scriptFor(studioId = 'failure_atlas') {
  const beats = studioId === 'failure_atlas'
    ? ['normal_operation', 'design_lesson']
    : studioId === 'history_under_glass'
      ? ['object_contradiction', 'qualified_meaning']
      : studioId === 'practical_open_source'
        ? ['working_result_preview', 'validation']
        : ['mission_emergency', 'educational_payoff'];
  return {
    schema: 'nichefoundry.script_package.v1.0',
    scenes: beats.map((beat, index) => ({
      scene_id: `scene_${index + 1}`,
      story_beat: beat,
      beat_name: beat,
      title: index === 0 ? 'The opening condition' : 'The resolved lesson',
      objective: index === 0 ? 'Establish the initial state.' : 'Deliver the useful payoff.',
      narration: index === 0
        ? 'The system appeared stable while hidden forces accumulated beneath the visible surface.'
        : 'The evidence reveals why the final design lesson matters beyond this single case.',
      estimated_duration_seconds: 5,
      claim_ids: [`claim_${index + 1}`],
      source_ids: [`source_${index + 1}`]
    }))
  };
}

async function makeFixture(studioId = 'failure_atlas') {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `nichefoundry-phase9-${studioId}-`));
  const pack = loadPack(studioId);
  const brief = { ...pack.samples[0], language: 'en' };
  const scriptPackage = scriptFor(studioId);
  const timingPlan = { scenes: scriptPackage.scenes.map((scene) => ({ scene_id: scene.scene_id, target_duration_seconds: 7 })) };
  const visualPackage = buildVisualPackage({ pack, brief, scriptPackage, episodeId: `episode_${studioId}`, priorPackets: [] });
  renderVisualPreviewAssets(temp, visualPackage, brief.working_title, brief.topic);
  const audioPackage = buildAudioPerformancePackage({ pack, brief, scriptPackage, timingPlan, episodeId: `episode_${studioId}` });
  const audioProduction = await produceAudioAssets({ root: ROOT, episodeDir: temp, audioPackage, provider: 'espeak', force: true });
  return { temp, pack, brief, scriptPackage, visualPackage, audioPackage, audioProduction };
}

function cleanup(fixture) {
  if (fixture?.temp) fs.rmSync(fixture.temp, { recursive: true, force: true });
}

test('Phase 9 exposes four render profiles and distinct studio camera grammars', () => {
  assert.deepEqual(Object.keys(RENDER_PROFILES).sort(), ['final', 'proxy', 'vertical_final', 'vertical_proxy']);
  const identities = STUDIO_IDS.map((id) => cameraGrammar(id, 'reveal', 0).id);
  assert.equal(new Set(identities).size, 4);
  assert.equal(RENDER_PROFILES.final.width, 1920);
  assert.equal(RENDER_PROFILES.vertical_final.height, 1920);
});

test('Phase 9 render plans bind story, visual, audio, camera, transitions, and captions scene by scene', async (t) => {
  if (!commandAvailable('ffmpeg') || !commandAvailable('ffprobe') || !commandAvailable(process.env.ESPEAK_BIN || 'espeak', ['--version'])) {
    t.skip('FFmpeg, FFprobe, and eSpeak are required.');
    return;
  }
  const fixture = await makeFixture('history_under_glass');
  try {
    const plan = buildRenderPlan({ episodeId: 'episode_history', studioId: 'history_under_glass', title: fixture.brief.working_title, scriptPackage: fixture.scriptPackage, visualPackage: fixture.visualPackage, audioProduction: fixture.audioProduction, profileId: 'proxy' });
    const validation = validateRenderPlan(plan);
    assert.equal(validation.passed, true, JSON.stringify(validation));
    assert.equal(plan.scenes.length, 2);
    assert.ok(plan.scenes.every((scene) => scene.visual_path && scene.audio_path && scene.camera.id && scene.transition.id));
    assert.equal(plan.scenes[0].camera.id, 'museum_reveal');
    const captions = buildCaptions(plan);
    assert.ok(captions.cue_count >= 2);
    assert.match(captions.srt, /00:00:00,\d{3} -->/);
    assert.ok(captions.cues.every((cue, index) => index === 0 || cue.start_seconds >= captions.cues[index - 1].end_seconds));
  } finally { cleanup(fixture); }
});

test('Phase 9 prefers registered imported scene replacements over storyboard previews', async (t) => {
  if (!commandAvailable('ffmpeg') || !commandAvailable('ffprobe') || !commandAvailable(process.env.ESPEAK_BIN || 'espeak', ['--version'])) {
    t.skip('FFmpeg, FFprobe, and eSpeak are required.');
    return;
  }
  const fixture = await makeFixture('history_under_glass');
  try {
    const importsDir = path.join(fixture.temp, 'imports', 'visuals');
    fs.mkdirSync(importsDir, { recursive: true });
    const scenePng = path.join(importsDir, 'scene_1_gamma.png');
    const thumbnailPng = path.join(importsDir, 'thumbnail_gamma.png');
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(fixture.temp, 'visuals', 'scenes', '01_scene_1.svg'), '-frames:v', '1', scenePng], { stdio: 'inherit' });
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=1280x720:d=1', '-frames:v', '1', thumbnailPng], { stdio: 'inherit' });
    const originalSceneAsset = fixture.visualPackage.asset_manifest.assets.find((asset) => asset.scene_id === 'scene_1');
    const originalThumbnailAsset = fixture.visualPackage.asset_manifest.assets.find((asset) => asset.role === 'thumbnail');
    fixture.visualPackage.asset_manifest.assets.push({
      asset_id: 'replacement_scene_1',
      episode_id: 'episode_history_under_glass',
      scene_id: 'scene_1',
      asset_type: 'imported_scene_asset',
      media_type: 'image/png',
      relative_path: 'imports/visuals/scene_1_gamma.png',
      role: 'scene_replacement',
      status: 'replacement_ready',
      generated_by: 'test',
      licence: 'project_owned_generated_asset',
      rights_status: 'cleared',
      synthetic: true,
      disclosure_required: false,
      source_ids: [],
      claim_ids: [],
      replaces_asset_id: originalSceneAsset.asset_id,
      sha256: 'placeholder'
    });
    fixture.visualPackage.asset_manifest.assets.push({
      asset_id: 'replacement_thumbnail',
      episode_id: 'episode_history_under_glass',
      scene_id: null,
      asset_type: 'thumbnail_replacement',
      media_type: 'image/png',
      relative_path: 'imports/visuals/thumbnail_gamma.png',
      role: 'thumbnail',
      status: 'replacement_ready',
      generated_by: 'test',
      licence: 'project_owned_generated_asset',
      rights_status: 'cleared',
      synthetic: true,
      disclosure_required: false,
      source_ids: [],
      claim_ids: [],
      replaces_asset_id: originalThumbnailAsset.asset_id,
      sha256: 'placeholder'
    });
    const plan = buildRenderPlan({
      episodeId: 'episode_history',
      studioId: 'history_under_glass',
      title: fixture.brief.working_title,
      scriptPackage: fixture.scriptPackage,
      visualPackage: fixture.visualPackage,
      audioProduction: fixture.audioProduction,
      profileId: 'proxy'
    });
    assert.equal(plan.scenes[0].visual_path, 'imports/visuals/scene_1_gamma.png');
    const result = renderEpisode({ episodeDir: fixture.temp, renderPlan: plan, force: true });
    assert.equal(result.passed, true, JSON.stringify(result.render_qa_report));
    assert.ok(fs.existsSync(path.join(fixture.temp, 'thumbnail.png')));
    const generated = fs.readFileSync(path.join(fixture.temp, 'thumbnail.png'));
    const imported = fs.readFileSync(thumbnailPng);
    assert.equal(generated.equals(imported), true);
  } finally { cleanup(fixture); }
});

test('Phase 9 rejects unsafe render asset paths before FFmpeg receives them', () => {
  const plan = {
    episode_id: 'episode_unsafe', studio_id: 'failure_atlas', scenes: [{
      scene_id: 'scene_1', visual_path: '../secret.svg', audio_path: 'audio/scene.wav',
      duration_seconds: 2, caption_text: 'Unsafe', camera: cameraGrammar('failure_atlas', '', 0), transition: { fade_in_seconds: 0.1, fade_out_seconds: 0.1 }
    }]
  };
  const validation = validateRenderPlan(plan);
  assert.equal(validation.passed, true, 'Schema validation remains non-I/O; path safety is enforced during plan construction and rendering.');
  assert.throws(() => buildRenderPlan({
    episodeId: 'episode_unsafe', studioId: 'failure_atlas', title: 'Unsafe',
    scriptPackage: { scenes: [{ scene_id: 'scene_1', narration: 'Unsafe', estimated_duration_seconds: 2 }] },
    visualPackage: { visual_plan: { scene_plans: [{ scene_id: 'scene_1', preview_path: '../secret.svg' }] }, asset_manifest: { assets: [] } },
    audioProduction: { audio_manifest: { scenes: [{ scene_id: 'scene_1', target_audio: 'audio/scene.wav', resolved_duration_seconds: 2 }] } },
    profileId: 'proxy'
  }), /Unsafe relative path/);
});

test('Phase 9 renders real proxy and final programmes with video, audio, embedded subtitles, captions, and thumbnail', { timeout: 240000 }, async (t) => {
  if (!commandAvailable('ffmpeg') || !commandAvailable('ffprobe') || !commandAvailable(process.env.ESPEAK_BIN || 'espeak', ['--version'])) {
    t.skip('FFmpeg, FFprobe, and eSpeak are required for real render verification.');
    return;
  }
  const fixture = await makeFixture('failure_atlas');
  try {
    const proxyPlan = buildRenderPlan({ episodeId: 'episode_failure', studioId: 'failure_atlas', title: fixture.brief.working_title, scriptPackage: fixture.scriptPackage, visualPackage: fixture.visualPackage, audioProduction: fixture.audioProduction, profileId: 'proxy' });
    const proxy = renderEpisode({ episodeDir: fixture.temp, renderPlan: proxyPlan, force: true });
    assert.equal(proxy.passed, true, JSON.stringify(proxy.render_qa_report));
    const proxyProbe = videoProbe(path.join(fixture.temp, 'proxy.mp4'));
    assert.ok(proxyProbe.streams.some((stream) => stream.codec_type === 'video'));
    assert.ok(proxyProbe.streams.some((stream) => stream.codec_type === 'audio'));
    assert.ok(proxyProbe.streams.some((stream) => stream.codec_type === 'subtitle'));
    assert.equal(proxyProbe.streams.find((stream) => stream.codec_type === 'video').width, 960);
    assert.ok(fs.existsSync(path.join(fixture.temp, 'captions.srt')));
    assert.ok(fs.existsSync(path.join(fixture.temp, 'thumbnail.png')));

    const second = renderEpisode({ episodeDir: fixture.temp, renderPlan: proxyPlan, sceneIds: ['scene_2'] });
    assert.equal(second.render_qa_report.segment_cache_hits, 1);
    assert.equal(second.render_manifest.scenes.find((scene) => scene.scene_id === 'scene_1').segment_cache_hit, true);
    assert.equal(second.render_manifest.scenes.find((scene) => scene.scene_id === 'scene_2').segment_cache_hit, false);

    const finalPlan = buildRenderPlan({ episodeId: 'episode_failure', studioId: 'failure_atlas', title: fixture.brief.working_title, scriptPackage: fixture.scriptPackage, visualPackage: fixture.visualPackage, audioProduction: fixture.audioProduction, profileId: 'final' });
    const final = renderEpisode({ episodeDir: fixture.temp, renderPlan: finalPlan, force: true });
    assert.equal(final.passed, true, JSON.stringify(final.render_qa_report));
    const finalProbe = videoProbe(path.join(fixture.temp, 'final.mp4'));
    const finalVideo = finalProbe.streams.find((stream) => stream.codec_type === 'video');
    assert.equal(finalVideo.width, 1920);
    assert.equal(finalVideo.height, 1080);
    assert.equal(verifyRenderAssetHashes(fixture.temp, final.render_asset_hashes).passed, true);
    const bundle = renderApprovalBundle(fixture.temp);
    assert.equal(bundle.complete, true);
    assert.equal(bundle.files.length, 8);
  } finally { cleanup(fixture); }
});

test('Phase 9 render hashes detect post-render mutation', { timeout: 180000 }, async (t) => {
  if (!commandAvailable('ffmpeg') || !commandAvailable('ffprobe') || !commandAvailable(process.env.ESPEAK_BIN || 'espeak', ['--version'])) {
    t.skip('Render toolchain unavailable.');
    return;
  }
  const fixture = await makeFixture('puzzle_planet');
  try {
    const plan = buildRenderPlan({ episodeId: 'episode_puzzle', studioId: 'puzzle_planet', title: fixture.brief.working_title, scriptPackage: fixture.scriptPackage, visualPackage: fixture.visualPackage, audioProduction: fixture.audioProduction, profileId: 'proxy' });
    const result = renderEpisode({ episodeDir: fixture.temp, renderPlan: plan, force: true });
    assert.equal(verifyRenderAssetHashes(fixture.temp, result.render_asset_hashes).passed, true);
    fs.appendFileSync(path.join(fixture.temp, 'captions.srt'), '\nMUTATED\n');
    const verification = verifyRenderAssetHashes(fixture.temp, result.render_asset_hashes);
    assert.equal(verification.passed, false);
    assert.ok(verification.issues.some((issue) => issue.includes('captions.srt')));
  } finally { cleanup(fixture); }
});

test('Phase 9 persists render packages and segment provenance in SQLite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase9-db-'));
  const database = new FoundryDatabase(path.join(temp, 'foundry.sqlite3'));
  try {
    const episodeId = 'episode_render_db';
    const stamp = new Date().toISOString();
    database.db.prepare(`INSERT INTO episodes(episode_id,title,status,episode_dir,state_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run(episodeId, 'Render', 'draft', 'episodes/render', '{}', stamp, stamp);
    const renderPackage = {
      passed: true,
      render_plan: { plan_hash: 'a'.repeat(64), profile: { id: 'final' } },
      render_assets: [{ asset_id: 'render_asset_1', scene_id: 'scene_1', asset_type: 'render_segment', relative_path: 'renders/segments/final/001_scene_1.mp4', status: 'ready', sha256: 'b'.repeat(64) }]
    };
    const saved = database.saveRenderPackage(`episode:${episodeId}`, episodeId, 'failure_atlas', renderPackage);
    assert.equal(saved.profile_id, 'final');
    assert.equal(database.getRenderPackageForEpisode(episodeId).passed, true);
    assert.equal(database.listRenderAssets(episodeId).length, 1);
    assert.equal(database.listRenderPackages({ studioId: 'failure_atlas' }).length, 1);
  } finally { database.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Phase 9 console contains every Programme Compositor DOM target', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const ids = [
    'refreshRenderButton', 'renderProfileSelect', 'renderSceneIds', 'buildRenderButton', 'approveRenderButton',
    'renderPlanJson', 'renderQaJson', 'captionTrackJson', 'renderApprovalJson', 'renderSegmentList', 'renderPreviewPlayer'
  ];
  for (const id of ids) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `Missing Programme Compositor DOM target ${id}`);
    assert.ok(app.includes(`getElementById("${id}")`) || app.includes(`getElementById('${id}')`), `Render client does not use ${id}`);
  }
});

test('Phase 9 server exposes guarded render planning, production, preview, persistence, and approval routes', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const evidence = fs.readFileSync(path.join(ROOT, 'lib', 'evidence.js'), 'utf8');
  for (const route of [
    '/api/render-system', '/api/render-packages', '/api/render-system/plan',
    '/api/render-assets/file', '/api/render-system/build', '/api/render-system/approve'
  ]) assert.ok(server.includes(route), `Missing Phase 9 route ${route}`);
  assert.match(server, /A valid audio-performance approval is required before rendering/);
  assert.match(server, /A passing final render is required before render approval/);
  assert.match(server, /render_approval_bundle\.json/);
  assert.match(server, /Render asset is not registered in the episode ledger/);
  assert.match(server, /Content-Range/);
  assert.match(server, /createReadStream/);
  for (const artifact of ['render_plan.json', 'caption_track.json', 'render_manifest_v2.json', 'render_asset_hashes.json', 'render_qa_report.json', 'final.mp4', 'captions.srt', 'thumbnail.png']) {
    assert.ok(server.includes(artifact) || evidence.includes(artifact), `Missing render evidence artifact ${artifact}`);
  }
});
