const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const test = require('node:test');
const { validateStudioPack } = require('../lib/studios');
const {
  buildAudienceProfile,
  buildChannelStrategy,
  assessEpisodeStrategy,
  buildAudiencePortfolio,
  buildFatigueReport,
  buildFormatRotation
} = require('../lib/audience_strategy');
const { FoundryDatabase } = require('../lib/database');

const ROOT = path.resolve(__dirname, '..');
const STUDIO_DIR = path.join(ROOT, 'studios', 'builtin');

function loadPack(id) {
  return JSON.parse(fs.readFileSync(path.join(STUDIO_DIR, `${id}.json`), 'utf8'));
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
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000))
  ]);
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

test('Phase 5 built-in studios define validated personas, content pillars, promise tests, and rotation rules', () => {
  const ids = ['failure_atlas', 'history_under_glass', 'practical_open_source', 'puzzle_planet'];
  for (const id of ids) {
    const pack = loadPack(id);
    const validation = validateStudioPack(pack);
    assert.equal(validation.passed, true, `${id}: ${JSON.stringify(validation.issues)}`);
    assert.ok(pack.audience.personas.length >= 2);
    assert.ok(pack.channel_strategy.content_pillars.length >= 2);
    assert.ok(pack.channel_strategy.promise_tests.length >= 2);
    assert.equal(Math.round(pack.channel_strategy.content_pillars.reduce((sum, item) => sum + item.target_share, 0) * 100), 100);
    const profile = buildAudienceProfile(pack);
    assert.equal(profile.personas.length, pack.audience.personas.length);
    assert.match(profile.profile_hash, /^[a-f0-9]{64}$/);
  }
});

test('Phase 5 assigns materially different personas, viewer jobs, and pillars to the three pilot samples', () => {
  const results = ['failure_atlas', 'history_under_glass', 'practical_open_source'].map((id) => {
    const pack = loadPack(id);
    const strategy = buildChannelStrategy(pack, { episodes: [], opportunities: [] });
    const assessment = assessEpisodeStrategy(pack, pack.samples[0], { episodes: [], opportunities: [], channel_strategy: strategy });
    assert.equal(assessment.passed, true, `${id}: ${assessment.issues.join('; ')}`);
    assert.ok(assessment.audience_fit.score >= pack.channel_strategy.minimum_audience_fit_score);
    return {
      persona: assessment.audience_fit.persona.id,
      job: assessment.audience_fit.viewer_job.id,
      pillar: assessment.audience_fit.content_pillar.id
    };
  });
  assert.equal(new Set(results.map((item) => item.persona)).size, 3);
  assert.equal(new Set(results.map((item) => item.pillar)).size, 3);
  assert.ok(new Set(results.map((item) => item.job)).size >= 2);
});

test('Phase 5 blocks audience mismatch, channel-promise conflict, and disallowed output formats', () => {
  const failureAtlas = loadPack('failure_atlas');
  const mismatch = assessEpisodeStrategy(failureAtlas, {
    working_title: 'Cute Cartoon Bridge Boom for Toddlers',
    topic: 'a silly bridge explosion game for preschool children',
    story_premise: 'Use unrelated stock explosions and blame one engineer for laughs.',
    age_band: '5-7',
    audience_mode: 'made_for_kids',
    archetype_id: 'failure_chain',
    output_format: 'long_form',
    source_queries: ['bridge']
  }, { episodes: [], opportunities: [] });
  assert.equal(mismatch.passed, false);
  assert.ok(mismatch.issues.some((item) => /children|prohibited|studio fit/i.test(item)));

  const openSource = loadPack('practical_open_source');
  const invalidOutput = assessEpisodeStrategy(openSource, {
    ...openSource.samples[0],
    output_format: 'image_carousel'
  }, { episodes: [], opportunities: [] });
  assert.equal(invalidOutput.passed, false);
  assert.ok(invalidOutput.issues.some((item) => /not allowed/i.test(item)));
});

test('Phase 5 detects content fatigue and recommends a different pillar, archetype, output, and viewer job', () => {
  const pack = loadPack('failure_atlas');
  const records = [0, 1, 2].map((index) => ({
    record_id: `episode_${index}`,
    record_type: 'episode',
    title: `Bridge collapse failure chain ${index}`,
    created_at: `2026-07-${String(31 - index).padStart(2, '0')}T10:00:00.000Z`,
    archetype_id: 'failure_chain',
    output_format: 'long_form',
    persona_id: 'curious_systems_viewer',
    viewer_job_id: 'story',
    pillar_id: 'failure_reconstructions',
    content_role: 'core_pillar'
  }));
  const portfolio = buildAudiencePortfolio(pack, records);
  const fatigue = buildFatigueReport(pack, records);
  const rotation = buildFormatRotation(pack, records, portfolio, fatigue);
  assert.equal(fatigue.passed, false);
  assert.ok(fatigue.checks.some((item) => item.key === 'archetype_id' && !item.passed));
  assert.notEqual(rotation.recommended_content_pillar_id, 'failure_reconstructions');
  assert.notEqual(rotation.recommended_archetype_id, 'failure_chain');
  assert.ok(rotation.reasons.some((item) => /streak|underused/i.test(item)));
});

test('Phase 5 persists channel strategies and audience assessments in SQLite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase5-db-'));
  const database = new FoundryDatabase(path.join(temp, 'foundry.sqlite3'));
  try {
    const pack = loadPack('history_under_glass');
    const strategy = buildChannelStrategy(pack, { episodes: [], opportunities: [] });
    const assessment = assessEpisodeStrategy(pack, pack.samples[0], { episodes: [], opportunities: [], channel_strategy: strategy });
    database.saveChannelStrategy('history_under_glass:current', pack.studio.id, strategy);
    database.saveAudienceAssessment('assessment_test', pack.studio.id, assessment, null);
    assert.equal(database.getLatestChannelStrategy(pack.studio.id).studio_id, pack.studio.id);
    assert.equal(database.listChannelStrategies(pack.studio.id).length, 1);
    assert.equal(database.getAudienceAssessment('assessment_test').passed, true);
    assert.equal(database.listAudienceAssessments({ studioId: pack.studio.id }).length, 1);
  } finally {
    database.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Phase 5 HTTP workflow creates approval-bound audience evidence and exposes strategy endpoints', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase5-http-'));
  const port = await freePort();
  const running = await startServer(tempRoot, port);
  t.after(async () => {
    await stopServer(running.child);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const root = await fetch(`${running.baseUrl}/`);
  const cookie = cookieFrom(root);

  const strategyResponse = await api(running.baseUrl, cookie, '/api/audience-strategy?studio_id=puzzle_planet');
  assert.equal(strategyResponse.status, 200);
  const strategy = (await strategyResponse.json()).strategy;
  assert.equal(strategy.studio_id, 'puzzle_planet');
  assert.ok(strategy.content_pillars.length >= 3);

  const brief = {
    ...loadPack('puzzle_planet').samples[0],
    target_persona_id: 'curious_child',
    viewer_job: 'Let me test myself',
    content_pillar_id: 'science_adventures',
    output_format: 'long_form'
  };
  const assessResponse = await api(running.baseUrl, cookie, '/api/audience-strategy/assess', {
    method: 'POST', body: JSON.stringify({ studio_id: 'puzzle_planet', brief })
  });
  assert.equal(assessResponse.status, 200);
  assert.equal((await assessResponse.json()).assessment.passed, true);

  const generatedResponse = await api(running.baseUrl, cookie, '/api/generate', {
    method: 'POST', body: JSON.stringify({ brief })
  });
  assert.equal(generatedResponse.status, 200);
  const state = (await generatedResponse.json()).state;
  assert.equal(state.verification.audience_strategy.passed, true);
  assert.equal(state.stage_statuses[1].status, 'complete');
  assert.equal(state.qa.status, 'blocked_pending_human_approval');
  const episodeDir = path.join(running.episodesDir, state.episode.episode_id);
  for (const filename of ['audience_profile_snapshot.json', 'channel_strategy.json', 'audience_fit_report.json', 'fatigue_report.json', 'format_rotation.json']) {
    assert.equal(fs.existsSync(path.join(episodeDir, filename)), true, `${filename} missing`);
  }
  const bundle = JSON.parse(fs.readFileSync(path.join(episodeDir, 'approval_bundle.json'), 'utf8'));
  const bundleNames = new Set(bundle.files.map((item) => item.name));
  assert.equal(bundleNames.has('audience_fit_report.json'), true);
  assert.equal(bundleNames.has('channel_strategy.json'), true);
});

test('Phase 5 console contains every DOM target used by the audience strategy client', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const ids = [...script.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
  const missing = [...new Set(ids)].filter((id) => !new RegExp(`id=["']${id}["']`).test(html));
  assert.deepEqual(missing, []);
  for (const id of ['targetPersonaSelect', 'viewerJobSelect', 'contentPillarSelect', 'outputFormatSelect', 'assessAudienceButton', 'refreshAudienceButton', 'audienceProfileList', 'channelStrategyJson', 'audienceFitJson', 'fatigueJson', 'formatRotationJson']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});
