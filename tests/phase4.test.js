const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { FoundryDatabase } = require('../lib/database');
const { StudioRegistry } = require('../lib/studios');
const {
  ConnectorRegistry,
  validateConnectorDefinition,
  executeConnector,
  parseFeed,
  assertPublicAllowlistedUrl
} = require('../lib/connectors');
const {
  buildSourceHierarchyReport,
  buildFreshnessReport,
  buildConflictGraph,
  buildResearchGovernance
} = require('../lib/research_governance');

const ROOT = path.resolve(__dirname, '..');
const studioRegistry = new StudioRegistry({
  builtinDir: path.join(ROOT, 'studios', 'builtin'),
  customDir: path.join(ROOT, 'studios', 'custom')
});

function connectorRegistry(database = null, customDir = path.join(ROOT, 'connectors', 'custom')) {
  return new ConnectorRegistry({
    builtinDir: path.join(ROOT, 'connectors', 'builtin'),
    customDir,
    database
  });
}

function source(overrides = {}) {
  return {
    source_id: 'src_base',
    title: 'Official investigation record',
    source_url: 'https://agency.example/reports/record',
    provider: 'curated_packet',
    connector_id: 'curated_packet',
    publisher: 'Agency A',
    source_tier: 1,
    source_type: 'official_report',
    primary_source: true,
    eligible_for_claims: true,
    published_at: '2026-07-01T00:00:00Z',
    retrieved_at: '2026-08-01T00:00:00Z',
    extract: 'The official report states that the connection carried 120 kilonewtons before failure.',
    content_hash: 'hash-a',
    ...overrides
  };
}

function claim(overrides = {}) {
  return {
    claim_id: 'clm_base',
    source_id: 'src_base',
    source_title: 'Official investigation record',
    subject: 'connection load capacity',
    claim: 'The connection carried 120 kilonewtons before failure.',
    claim_type: 'factual',
    confidence: 0.94,
    status: 'supported',
    ...overrides
  };
}

test('Phase 4 loads seven guarded connector definitions and persists their metadata', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase4-registry-'));
  const db = new FoundryDatabase(path.join(temp, 'foundry.sqlite3'));
  try {
    const registry = connectorRegistry(db, path.join(temp, 'custom'));
    const connectors = registry.list();
    assert.equal(connectors.length, 7);
    assert.ok(connectors.every((item) => item.auth.secret_values_exposed === false));
    assert.equal(db.listConnectorDefinitions().length, 7);
    const invalid = JSON.parse(JSON.stringify(registry.get('rss_monitor')));
    invalid.connector.id = 'unsafe_runtime';
    invalid.connector.adapter = 'arbitrary_javascript';
    assert.equal(validateConnectorDefinition(invalid).passed, false);
  } finally {
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Phase 4 parses RSS and treats feed descriptions as discovery leads, not script evidence', async () => {
  const registry = connectorRegistry();
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Engineering Updates</title><item><title>Bridge report released</title><link>https://feeds.example/items/bridge</link><description>Investigators published a new bridge report.</description><pubDate>Fri, 31 Jul 2026 12:00:00 GMT</pubDate><guid>bridge-1</guid></item></channel></rss>`;
  assert.equal(parseFeed(xml, 'https://feeds.example/rss').length, 1);
  const run = await executeConnector(registry.get('rss_monitor'), {
    feed_urls: ['https://feeds.example/rss'],
    allowed_hosts: ['feeds.example']
  }, {
    skipDnsCheck: true,
    textFetcher: async (url) => ({ text: xml, finalUrl: String(url), headers: { 'content-type': 'application/rss+xml' } })
  });
  assert.equal(run.status, 'completed', run.error);
  assert.equal(run.candidates.length, 1);
  assert.equal(run.sources[0].eligible_for_claims, false);
  assert.match(run.warnings.join(' '), /not eligible for claim extraction/i);
});

test('Phase 4 blocks private and non-allowlisted connector targets', async () => {
  await assert.rejects(() => assertPublicAllowlistedUrl('https://127.0.0.1/private', ['127.0.0.1'], { skipDnsCheck: true }), /Private-network/);
  await assert.rejects(() => assertPublicAllowlistedUrl('https://evil.example/feed', ['trusted.example'], { skipDnsCheck: true }), /allowlist/);
  await assert.rejects(() => assertPublicAllowlistedUrl('http://trusted.example/feed', ['trusted.example'], { skipDnsCheck: true }), /HTTPS/);
});

test('Phase 4 YouTube public discovery creates market candidates without treating metadata as factual sources', async () => {
  const registry = connectorRegistry();
  const responses = [];
  const run = await executeConnector(registry.get('youtube_public_discovery'), { query: 'bridge engineering failures', max_results: 2 }, {
    env: { YOUTUBE_API_KEY: 'test-key' },
    jsonFetcher: async (url) => {
      responses.push(String(url));
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/search')) {
        assert.equal(parsed.searchParams.get('q'), 'bridge engineering failures');
        return { pageInfo: { totalResults: 40 }, items: [{ id: { videoId: 'vid1' } }, { id: { videoId: 'vid2' } }] };
      }
      return { items: [
        { id: 'vid1', snippet: { title: 'Why Bridges Twist', channelId: 'c1', channelTitle: 'Engineering Lab', publishedAt: '2026-07-01T00:00:00Z', description: 'A public explainer.' }, statistics: { viewCount: '100000', likeCount: '5000', commentCount: '300' }, contentDetails: { duration: 'PT8M' } },
        { id: 'vid2', snippet: { title: 'The Hidden Load Path', channelId: 'c2', channelTitle: 'Build Science', publishedAt: '2026-06-01T00:00:00Z', description: 'Another public explainer.' }, statistics: { viewCount: '25000', likeCount: '900', commentCount: '80' }, contentDetails: { duration: 'PT12M' } }
      ] };
    }
  });
  assert.equal(run.status, 'completed', run.error);
  assert.equal(responses.length, 2);
  assert.equal(run.sources.length, 0);
  assert.equal(run.candidates.length, 2);
  assert.equal(run.candidates[0].discovery_source, 'youtube_public_connector');
  assert.equal(run.input.query, 'bridge engineering failures');
  assert.doesNotMatch(JSON.stringify(run), /test-key/);
});

test('Phase 4 owned-channel analytics refreshes OAuth and never persists secret values', async () => {
  const registry = connectorRegistry();
  const env = {
    YOUTUBE_CLIENT_ID: 'client-id',
    YOUTUBE_CLIENT_SECRET: 'client-secret',
    YOUTUBE_REFRESH_TOKEN: 'refresh-secret'
  };
  const calls = [];
  const run = await executeConnector(registry.get('youtube_owned_analytics'), { lookback_days: 30 }, {
    env,
    jsonFetcher: async (url, options) => {
      calls.push({ url: String(url), headers: options.headers || {}, body: options.body || '' });
      if (String(url).includes('oauth2.googleapis.com/token')) return { access_token: 'temporary-access-token', expires_in: 3600 };
      assert.match(options.headers.Authorization, /^Bearer temporary-access-token$/);
      return {
        columnHeaders: [{ name: 'video' }, { name: 'views' }, { name: 'averageViewDuration' }],
        rows: [['abc123', 900, 182]]
      };
    }
  });
  assert.equal(run.status, 'completed', run.error);
  assert.equal(run.analytics[0].views, 900);
  assert.equal(calls.length, 2);
  const persisted = JSON.stringify(run);
  assert.doesNotMatch(persisted, /client-secret|refresh-secret|temporary-access-token/);
});

test('Phase 4 GitHub release connector produces primary freshness evidence and release opportunities', async () => {
  const registry = connectorRegistry();
  const run = await executeConnector(registry.get('github_releases'), { repositories: ['owner/project'], per_page: 2 }, {
    env: {},
    jsonFetcher: async (url) => {
      if (String(url).includes('/releases')) return [{
        id: 22,
        tag_name: 'v2.0.0',
        name: 'Version 2.0.0',
        body: 'Adds a new renderer and removes the deprecated command.',
        html_url: 'https://github.com/owner/project/releases/tag/v2.0.0',
        draft: false,
        prerelease: false,
        published_at: '2026-07-25T00:00:00Z',
        author: { login: 'maintainer' },
        assets: []
      }];
      return {
        full_name: 'owner/project',
        description: 'A test project',
        default_branch: 'main',
        pushed_at: '2026-07-25T00:00:00Z',
        updated_at: '2026-07-25T00:00:00Z',
        html_url: 'https://github.com/owner/project',
        stargazers_count: 100,
        forks_count: 10,
        open_issues_count: 3
      };
    }
  });
  assert.equal(run.status, 'completed', run.error);
  assert.equal(run.sources[0].source_tier, 1);
  assert.equal(run.sources[0].primary_source, true);
  assert.equal(run.candidates.length, 1);
  assert.equal(run.candidates[0].connector_evidence.release_id, 22);
});

test('Phase 4 enforces source independence, primary evidence, freshness, and conflict resolution', () => {
  const failure = studioRegistry.get('failure_atlas');
  const software = studioRegistry.get('practical_open_source');
  const onePublisher = [
    source({ source_id: 'src_a', source_url: 'https://agency.example/a', publisher: 'Agency A' }),
    source({ source_id: 'src_b', source_url: 'https://agency.example/b', publisher: 'Agency A', primary_source: false, source_tier: 2 })
  ];
  assert.equal(buildSourceHierarchyReport(failure, onePublisher).passed, false);
  const independent = [
    source({ source_id: 'src_a', source_url: 'https://agency.example/a', publisher: 'Agency A' }),
    source({ source_id: 'src_b', source_url: 'https://university.example/b', publisher: 'University B', primary_source: false, source_tier: 2 })
  ];
  assert.equal(buildSourceHierarchyReport(failure, independent).passed, true);

  const stale = buildFreshnessReport(software, [source({ source_id: 'src_old', published_at: '2020-01-01T00:00:00Z', source_type: 'official_release_record' })], { now: new Date('2026-08-01T00:00:00Z') });
  assert.equal(stale.passed, false);
  assert.equal(stale.entries[0].status, 'stale');

  const claims = [
    claim({ claim_id: 'clm_a', source_id: 'src_a', claim: 'The connection carried 120 kilonewtons before failure.' }),
    claim({ claim_id: 'clm_b', source_id: 'src_b', source_title: 'Independent laboratory report', claim: 'The connection carried 80 kilonewtons before failure.' })
  ];
  const graph = buildConflictGraph(claims, independent);
  assert.equal(graph.passed, false);
  assert.equal(graph.conflict_edges.length, 1);
  assert.ok(graph.nodes.every((node) => node.status === 'disputed'));

  const governance = buildResearchGovernance(failure, independent, claims);
  assert.equal(governance.passed, false);
  assert.equal(governance.human_review_required, true);
});

test('Phase 4 persists complete connector runs in SQLite', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase4-runs-'));
  const db = new FoundryDatabase(path.join(temp, 'foundry.sqlite3'));
  try {
    const registry = connectorRegistry(db, path.join(temp, 'custom'));
    const run = await executeConnector(registry.get('curated_packet'), { sources: [{
      title: 'Primary report', source_url: 'https://agency.example/report', publisher: 'Agency A', source_tier: 1, primary_source: true,
      extract: 'The official record documents the initiating event and the subsequent investigation findings.'
    }] });
    db.saveConnectorRun(run, { capability: 'research_sources' });
    assert.equal(db.getConnectorRun(run.run_id).run_id, run.run_id);
    assert.equal(db.listConnectorRuns({ connectorId: 'curated_packet' }).length, 1);
  } finally {
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Phase 4 console contains every DOM target used by the connector client', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const ids = [...client.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((match) => match[1]);
  const missing = [...new Set(ids)].filter((id) => !new RegExp(`id=["']${id}["']`).test(html));
  assert.deepEqual(missing, []);
});
