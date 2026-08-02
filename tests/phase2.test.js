const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  StudioRegistry,
  validateStudioPack,
  scoreEpisodeFit,
  buildStudioBlueprint,
  assessResearchPolicy
} = require('../lib/studios');

const ROOT = path.resolve(__dirname, '..');

function registry(customDir = path.join(ROOT, 'studios', 'custom')) {
  return new StudioRegistry({ builtinDir: path.join(ROOT, 'studios', 'builtin'), customDir });
}

const bridgeBrief = {
  studio_id: 'failure_atlas',
  archetype_id: 'failure_chain',
  working_title: 'The Bridge That Twisted Itself Apart',
  topic: 'Tacoma Narrows Bridge collapse and aeroelastic flutter',
  story_premise: 'Reconstruct the engineering failure chain and design lessons.',
  source_queries: ['Tacoma Narrows Bridge', 'Aeroelasticity']
};

const sampleClaims = [
  { claim_id: 'clm_1', source_id: 'src_1', confidence: 0.95 },
  { claim_id: 'clm_2', source_id: 'src_1', confidence: 0.91 },
  { claim_id: 'clm_3', source_id: 'src_2', confidence: 0.88 },
  { claim_id: 'clm_4', source_id: 'src_2', confidence: 0.84 },
  { claim_id: 'clm_5', source_id: 'src_3', confidence: 0.81 },
  { claim_id: 'clm_6', source_id: 'src_3', confidence: 0.79 }
];

test('Phase 2 ships three specialist pilots plus the Puzzle Planet compatibility pack with strong niche depth', () => {
  const foundry = registry();
  const studios = foundry.list();
  const ids = new Set(studios.map((studio) => studio.studio_id));
  for (const required of ['failure_atlas', 'history_under_glass', 'practical_open_source', 'puzzle_planet']) {
    assert.equal(ids.has(required), true, `${required} missing`);
  }
  for (const studio of studios) {
    assert.ok(studio.depth_score >= 90, `${studio.studio_id} depth too weak: ${studio.depth_score}`);
    assert.ok(studio.archetypes.length >= 2);
  }
});

test('Phase 2 topic fit discriminates between specialist studios instead of accepting every topic', () => {
  const foundry = registry();
  const failureFit = scoreEpisodeFit(foundry.get('failure_atlas'), bridgeBrief);
  const softwareFit = scoreEpisodeFit(foundry.get('practical_open_source'), bridgeBrief);
  const historyFit = scoreEpisodeFit(foundry.get('history_under_glass'), bridgeBrief);
  assert.equal(failureFit.passed, true, JSON.stringify(failureFit, null, 2));
  assert.equal(softwareFit.passed, false);
  assert.equal(historyFit.passed, false);
  assert.ok(failureFit.score > softwareFit.score);
  assert.ok(softwareFit.negative_matches.includes('bridge collapse'));
});

test('Phase 2 builds materially different story maps, visual rules, and compliance rules from the same claim ledger', () => {
  const foundry = registry();
  const failure = buildStudioBlueprint(foundry.get('failure_atlas'), bridgeBrief, sampleClaims);
  const softwareBrief = {
    ...bridgeBrief,
    studio_id: 'practical_open_source',
    archetype_id: 'guided_tutorial',
    working_title: 'Repair a Broken Docker Compose Deployment',
    topic: 'open source Docker Compose troubleshooting on Debian Linux',
    story_premise: 'Diagnose a failed local service and prove the repaired deployment works.',
    source_queries: ['Docker Compose', 'Debian']
  };
  const software = buildStudioBlueprint(foundry.get('practical_open_source'), softwareBrief, sampleClaims);
  assert.equal(failure.story_map[0].name, 'normal_operation');
  assert.equal(software.story_map[0].name, 'outcome_preview');
  assert.notDeepEqual(failure.visual_direction.language, software.visual_direction.language);
  assert.notDeepEqual(failure.compliance.required_checks, software.compliance.required_checks);
  assert.equal(failure.story_map.flatMap((beat) => beat.claim_ids).length, sampleClaims.length);
});

test('Phase 2 validates and installs a custom pack, while rejecting a broad generic content factory', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase2-studios-'));
  try {
    const foundry = registry(temp);
    const base = JSON.parse(JSON.stringify(foundry.get('history_under_glass')));
    base.studio.id = 'material_food_histories';
    base.studio.name = 'Material Food Histories';
    base.studio.version = '1.0.0';
    base.studio.domain = 'historical cooking tools, preserved recipes, food vessels, and material evidence of everyday food systems';
    base.studio.tagline = 'Read food history through the tools at the table.';
    base.fit.keywords = ['cooking tool', 'recipe manuscript', 'food vessel', 'kitchen archaeology', 'historical diet', 'hearth', 'pottery residue'];
    base.fit.topic_examples = ['a Roman cooking pot residue study', 'a medieval recipe manuscript', 'Victorian kitchen labour'];
    base.samples[0].studio_id = base.studio.id;
    const validation = validateStudioPack(base);
    assert.equal(validation.passed, true, JSON.stringify(validation, null, 2));
    const installed = foundry.install(base);
    assert.equal(installed.studio.studio.id, base.studio.id);
    assert.equal(fs.existsSync(path.join(temp, `${base.studio.id}.json`)), true);

    const broad = JSON.parse(JSON.stringify(base));
    broad.studio.id = 'generic_content';
    broad.studio.domain = 'history';
    broad.fit.keywords = ['history', 'facts', 'videos', 'interesting', 'content'];
    broad.fit.topic_examples = ['history facts', 'interesting history', 'history video'];
    const rejected = validateStudioPack(broad);
    assert.equal(rejected.passed, false);
    assert.ok(rejected.issues.some((entry) => entry.message.includes('Niche depth score') || entry.path === '$.studio.domain'));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Phase 2 research policy distinguishes provisional source gaps from hard source-count failures', () => {
  const foundry = registry();
  const pack = foundry.get('failure_atlas');
  const oneSource = assessResearchPolicy(pack, [{ provider: 'mediawiki_action_api', retrieval_status: 'retrieved' }]);
  assert.equal(oneSource.passed, false);
  const twoSources = assessResearchPolicy(pack, [
    { provider: 'mediawiki_action_api', retrieval_status: 'retrieved' },
    { provider: 'mediawiki_action_api', retrieval_status: 'retrieved' }
  ]);
  assert.equal(twoSources.passed, true);
  assert.equal(twoSources.provisional, true);
  assert.ok(twoSources.warnings.some((message) => message.includes('primary source')));
});

test('Phase 2 console contains every DOM target used by the Studio Pack client', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const ids = [...client.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((match) => match[1]);
  const missing = [...new Set(ids)].filter((id) => !new RegExp(`id=["']${id}["']`).test(html));
  assert.deepEqual(missing, []);
});
