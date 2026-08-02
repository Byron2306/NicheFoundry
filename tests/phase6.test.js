const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const test = require('node:test');
const { buildStudioBlueprint, validateStudioPack } = require('../lib/studios');
const { buildChannelStrategy, assessEpisodeStrategy } = require('../lib/audience_strategy');
const {
  buildNarrativePackage,
  critiqueScriptPackage,
  requestedDurationMinutes
} = require('../lib/story_engine');
const { FoundryDatabase } = require('../lib/database');

const ROOT = path.resolve(__dirname, '..');
const STUDIO_DIR = path.join(ROOT, 'studios', 'builtin');

function loadPack(id) {
  return JSON.parse(fs.readFileSync(path.join(STUDIO_DIR, `${id}.json`), 'utf8'));
}

function fixtureClaims(count = 14) {
  return Array.from({ length: count }, (_, index) => ({
    claim_id: `claim_${index + 1}`,
    source_id: `source_${(index % 3) + 1}`,
    source_url: `https://example.org/source-${(index % 3) + 1}`,
    source_title: `Independent Source ${(index % 3) + 1}`,
    subject: `Evidence unit ${index + 1}`,
    claim: `Evidence unit ${index + 1} establishes a distinct verified detail relevant to stage ${index + 1}.`,
    supporting_passage: `Evidence unit ${index + 1} establishes a distinct verified detail relevant to stage ${index + 1}.`,
    passage_start: 0,
    passage_end: 96,
    source_revision_id: `revision_${index + 1}`,
    status: 'supported',
    confidence: 0.92 - index * 0.01,
    claim_type: 'description'
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
  return { pack, brief, archetype, claims, audience, studioBlueprint, story };
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
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (_error) {}
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
      PORT: String(port),
      HOST: '127.0.0.1',
      FOUNDRY_DATA_DIR: dataDir,
      FOUNDRY_EPISODES_DIR: episodesDir,
      FOUNDRY_ALLOW_OFFLINE_SOURCE_FIXTURES: '1'
    },
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

function cookieFrom(response) {
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

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

test('Phase 6 Studio Packs define executable story-engine constitutions', () => {
  for (const id of ['failure_atlas', 'history_under_glass', 'practical_open_source', 'puzzle_planet']) {
    const pack = loadPack(id);
    const validation = validateStudioPack(pack);
    assert.equal(validation.passed, true, `${id}: ${JSON.stringify(validation.issues)}`);
    assert.ok(pack.story_engine.narrative_mode);
    assert.ok(pack.story_engine.default_target_minutes >= 1);
    assert.ok(pack.story_engine.retention_devices.length >= 4);
    assert.ok(pack.story_engine.required_passes.includes('evidence'));
    assert.ok(pack.story_engine.required_passes.includes('sensationalism'));
  }
});

test('Phase 6 creates materially different full programmes for the four studios', () => {
  const outputs = ['failure_atlas', 'history_under_glass', 'practical_open_source', 'puzzle_planet'].map((id) => buildForPack(id));
  for (const output of outputs) {
    assert.equal(output.story.story_report.passed, true, `${output.pack.studio.id}: ${output.story.story_report.issues.join('; ')}`);
    assert.equal(output.story.script_package.passed, true);
    assert.equal(output.story.script_package.scenes.length, output.archetype.required_story_beats.length + 2);
    assert.deepEqual(output.story.narrative_blueprint.required_story_beats, output.archetype.required_story_beats);
    assert.ok(output.story.script_package.claim_ids.length >= output.archetype.required_story_beats.length);
    assert.ok(output.story.script_package.estimated_duration_seconds > 75);
    assert.ok(output.story.script_package.scenes.every((scene) => scene.objective && scene.retention_device && scene.narration));
  }
  assert.equal(new Set(outputs.map((item) => item.story.narrative_blueprint.narrative_mode)).size, 4);
  assert.equal(new Set(outputs.map((item) => item.story.narrative_blueprint.selected_hook.type)).size, 4);
  assert.equal(new Set(outputs.map((item) => item.story.script_package.scenes[1].beat_name)).size, 4);
});

test('Phase 6 narrative critic blocks hype, unknown claims, and library-near-duplicate scripts', () => {
  const output = buildForPack('failure_atlas');
  const mutated = JSON.parse(JSON.stringify(output.story.script_package));
  mutated.scenes[1].narration = 'You will not believe this shocking truth.';
  mutated.scenes[1].script_segments.push({ type: 'claim', text: 'Invented.', claim_id: 'missing_claim', source_id: 'missing_source' });
  mutated.full_narration = mutated.scenes.map((scene) => scene.narration).join('\n\n');
  const critic = critiqueScriptPackage(mutated, {
    pack: output.pack,
    archetype: output.archetype,
    brief: output.brief,
    claims: output.claims,
    narrativeBlueprint: output.story.narrative_blueprint,
    priorPackets: [{ episode: { episode_id: 'prior_episode' }, script_package: { full_narration: mutated.full_narration } }]
  });
  assert.equal(critic.passed, false);
  assert.ok(critic.issues.some((item) => item.startsWith('sensationalism:')));
  assert.ok(critic.issues.some((item) => item.startsWith('unknown_claim:')));
  assert.ok(critic.issues.includes('library_script_near_duplicate'));
});

test('Phase 6 duration planning refuses to pad thin evidence into a requested long programme', () => {
  const pack = loadPack('history_under_glass');
  const archetype = pack.content.archetypes[0];
  const plan = requestedDurationMinutes({ output_format: 'long_form', target_duration_minutes: 20 }, pack, archetype, 3);
  assert.equal(plan.requested, 20);
  assert.ok(plan.evidence_supported_max < plan.requested);
  assert.equal(plan.resolved, plan.evidence_supported_max);
  assert.equal(plan.bounded_by_evidence, true);
});

test('Phase 6 persists story packages and script hashes in SQLite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase6-db-'));
  const database = new FoundryDatabase(path.join(temp, 'foundry.sqlite3'));
  try {
    const output = buildForPack('practical_open_source');
    database.db.prepare(`INSERT INTO episodes(episode_id,title,status,episode_dir,state_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run('episode_story', 'Story', 'draft', 'episodes/story', '{}', new Date().toISOString(), new Date().toISOString());
    database.saveStoryPackage('episode:episode_story', 'episode_story', output.pack.studio.id, output.archetype.id, output.story.script_package);
    const restored = database.getStoryPackageForEpisode('episode_story');
    assert.equal(restored.passed, true);
    assert.equal(restored.studio_id, 'practical_open_source');
    assert.equal(restored.scenes.length, output.story.script_package.scenes.length);
    assert.match(restored.script_hash, /^script_[a-f0-9]{32}$/);
    assert.equal(database.listStoryPackages({ studioId: 'practical_open_source' }).length, 1);
  } finally {
    database.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Phase 6 HTTP workflow produces approval-bound narrative artifacts and story endpoints', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase6-http-'));
  const port = await freePort();
  const running = await startServer(tempRoot, port);
  t.after(async () => {
    await stopServer(running.child);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const root = await fetch(`${running.baseUrl}/`);
  const cookie = cookieFrom(root);
  const brief = {
    ...loadPack('puzzle_planet').samples[0],
    target_persona_id: 'curious_child',
    viewer_job: 'Let me test myself',
    content_pillar_id: 'science_adventures',
    output_format: 'long_form',
    target_duration_minutes: 6
  };
  const preview = await api(running.baseUrl, cookie, '/api/story-engine/preview', { method: 'POST', body: JSON.stringify({ brief }) });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).narrative_blueprint.required_story_beats.length, 6);
  const generated = await api(running.baseUrl, cookie, '/api/generate', { method: 'POST', body: JSON.stringify({ brief }) });
  assert.equal(generated.status, 200);
  const state = (await generated.json()).state;
  assert.equal(state.verification.story_engine.passed, true);
  assert.equal(state.stage_statuses[6].status, 'complete');
  assert.equal(state.qa.story_engine_passed, true);
  assert.equal(state.qa.status, 'blocked_pending_human_approval');
  assert.ok(state.script_package.scenes.length >= 8);
  const episodeDir = path.join(running.episodesDir, state.episode.episode_id);
  for (const filename of ['narrative_blueprint.json', 'script_package.json', 'timing_plan.json', 'story_report.json', 'script.md']) {
    assert.equal(fs.existsSync(path.join(episodeDir, filename)), true, `${filename} missing`);
  }
  const bundle = JSON.parse(fs.readFileSync(path.join(episodeDir, 'approval_bundle.json'), 'utf8'));
  const names = new Set(bundle.files.map((item) => item.name));
  assert.equal(names.has('script_package.json'), true);
  assert.equal(names.has('script.md'), true);
  const storyResponse = await api(running.baseUrl, cookie, '/api/story-engine');
  assert.equal(storyResponse.status, 200);
  const story = await storyResponse.json();
  assert.equal(story.story_report.passed, true);
  assert.equal(story.script_package.script_hash_basis, state.script_package.script_hash_basis);
});

test('Phase 6 console contains every DOM target used by the story client', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const ids = [...script.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
  const missing = [...new Set(ids)].filter((id) => !new RegExp(`id=["']${id}["']`).test(html));
  assert.deepEqual(missing, []);
  for (const id of ['previewStoryButton', 'refreshStoryButton', 'narrativeBlueprintJson', 'storyReportJson', 'timingPlanJson', 'scriptCriticJson', 'scriptPreview']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});
