const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { StudioRegistry } = require('../lib/studios');
const { FoundryDatabase } = require('../lib/database');
const {
  discoverStudioSeeds,
  discoverMediaWiki,
  scoreOpportunity,
  buildCannibalizationReport,
  clusterOpportunities,
  buildPortfolioReport,
  buildSeriesPlan,
  buildEditorialCalendar,
  transitionLifecycle,
  opportunityToBrief
} = require('../lib/opportunities');

const ROOT = path.resolve(__dirname, '..');
const registry = new StudioRegistry({
  builtinDir: path.join(ROOT, 'studios', 'builtin'),
  customDir: path.join(ROOT, 'studios', 'custom')
});

function strongBridgeCandidate(overrides = {}) {
  return {
    title: 'The Walkway Connection That Failed Under Load',
    topic: 'Hyatt Regency walkway structural connection failure and load-path redesign',
    angle: 'Trace the original load path, the connection change, the collapse chain, the investigation, and the transferable design lesson.',
    viewer_job: 'teach me how a failure unfolded',
    source_hints: ['Hyatt Regency walkway collapse', 'NBS Building Science Series 143'],
    series_hint: 'Small connection changes with large structural consequences',
    content_role: 'core_pillar',
    signals: {
      audience_demand: 0.72,
      content_gap: 0.68,
      series_potential: 0.82,
      visual_potential: 0.9,
      monetization_alignment: 0.55,
      evidence_availability: 0.92,
      production_burden: 0.48,
      policy_risk: 0.4,
      freshness_risk: 0.08
    },
    ...overrides
  };
}

test('Phase 3 scores specialist opportunities transparently and rejects off-niche candidates', () => {
  const failure = registry.get('failure_atlas');
  const software = registry.get('practical_open_source');
  const scored = scoreOpportunity(failure, strongBridgeCandidate());
  const wrongStudio = scoreOpportunity(software, strongBridgeCandidate());
  assert.equal(scored.fit.passed, true, JSON.stringify(scored.fit, null, 2));
  assert.ok(scored.opportunity_score >= 60, JSON.stringify(scored, null, 2));
  assert.equal(scored.signal_provenance.audience_demand, 'operator_or_provider_signal');
  assert.equal(scored.signal_provenance.studio_authority_fit, 'studio_pack_fit_engine');
  assert.equal(wrongStudio.fit.passed, false);
  assert.equal(wrongStudio.decision, 'reject_fit');
});

test('Phase 3 labels heuristic signals as proxies and blocks cannibalising opportunities', () => {
  const pack = registry.get('failure_atlas');
  const proxy = scoreOpportunity(pack, {
    title: 'Why Flexible Bridges Twist in Wind',
    topic: 'suspension bridge aeroelastic flutter failure mechanism',
    angle: 'Explain the load path and flutter mechanism.',
    source_hints: ['Aeroelasticity']
  });
  assert.equal(proxy.signal_provenance.audience_demand, 'documented_proxy_heuristic');
  const duplicate = scoreOpportunity(pack, {
    ...strongBridgeCandidate(),
    opportunity_id: 'opp_duplicate',
    title: 'The Walkway Connection That Failed Under Load'
  });
  const report = buildCannibalizationReport(duplicate, [{
    ...strongBridgeCandidate(),
    opportunity_id: 'opp_existing',
    lifecycle: 'approved'
  }]);
  assert.equal(report.passed, false);
  assert.ok(report.blocking_matches[0].similarity >= report.threshold);
});

test('Phase 3 discovers Studio Pack seeds and MediaWiki search candidates without inventing live demand', async () => {
  const pack = registry.get('history_under_glass');
  const seeds = discoverStudioSeeds(pack);
  assert.ok(seeds.length >= pack.fit.topic_examples.length);
  assert.ok(seeds.every((item) => item.studio_id === pack.studio.id));

  const mockFetcher = async (url) => {
    assert.equal(url.searchParams.get('list'), 'search');
    return {
      query: {
        search: [
          { pageid: 10, title: 'Roman glass', snippet: 'Glass objects reveal trade and daily life.', wordcount: 2400, timestamp: '2026-01-01T00:00:00Z' },
          { pageid: 11, title: 'Roman pottery', snippet: 'Ceramic evidence records food and exchange.', wordcount: 3200, timestamp: '2026-01-01T00:00:00Z' }
        ]
      }
    };
  };
  const discovered = await discoverMediaWiki(pack, 'Roman artefacts', { apiBase: 'https://example.test/w/api.php', fetcher: mockFetcher });
  assert.equal(discovered.length, 2);
  assert.equal(discovered[0].discovery_source, 'mediawiki_search');
  assert.ok(discovered[0].signals.evidence_availability > 0.5);
  assert.equal(discovered[0].signals.audience_demand, undefined);
});

test('Phase 3 clusters related opportunities, produces a portfolio report, series plan, and diversified calendar', () => {
  const pack = registry.get('failure_atlas');
  const raw = [
    strongBridgeCandidate({ title: 'The Walkway Connection Change', opportunity_id: 'opp_a', content_role: 'core_pillar' }),
    strongBridgeCandidate({ title: 'How Load Paths Fail at Connections', topic: 'structural connection load path failure', opportunity_id: 'opp_b', content_role: 'search_evergreen' }),
    {
      title: 'The Mars Orbiter Lost to Unit Conversion',
      topic: 'Mars Climate Orbiter unit conversion systems engineering failure',
      angle: 'Trace the interface mismatch and governance lesson.',
      source_hints: ['Mars Climate Orbiter'],
      content_role: 'experimental',
      signals: { audience_demand: 0.7, content_gap: 0.65, series_potential: 0.72, visual_potential: 0.72, monetization_alignment: 0.45, evidence_availability: 0.85, production_burden: 0.4, policy_risk: 0.18, freshness_risk: 0.05 }
    }
  ].map((item) => scoreOpportunity(pack, item));
  const clusters = clusterOpportunities(raw);
  assert.ok(clusters.length >= 2);
  const membership = new Map();
  clusters.forEach((cluster) => cluster.opportunity_ids.forEach((id) => membership.set(id, cluster.cluster_id)));
  const enriched = raw.map((item) => ({ ...item, cluster_id: membership.get(item.opportunity_id), cannibalization: { passed: true } }));
  const portfolio = buildPortfolioReport(enriched);
  assert.equal(portfolio.total_active, 3);
  assert.equal(portfolio.roles.length, 5);
  const plan = buildSeriesPlan(pack, enriched);
  assert.ok(plan.series.length >= 2);
  const calendar = buildEditorialCalendar(pack, enriched, { start_date: '2026-08-01', weeks: 2, slots_per_week: 2 });
  assert.equal(calendar.entries.length, 3);
  assert.notEqual(calendar.entries[0].cluster_id, calendar.entries[1].cluster_id, 'calendar should penalise immediate cluster repetition when alternatives exist');
});

test('Phase 3 persists opportunity lifecycle, plans, and calendars in SQLite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase3-db-'));
  const db = new FoundryDatabase(path.join(temp, 'foundry.sqlite3'));
  try {
    const pack = registry.get('failure_atlas');
    const opportunity = scoreOpportunity(pack, strongBridgeCandidate({ opportunity_id: 'opp_persist' }));
    opportunity.cannibalization = { passed: true, blocking_matches: [], warnings: [] };
    opportunity.lifecycle = 'screened';
    db.upsertOpportunity(opportunity);
    assert.equal(db.getOpportunity('opp_persist').title, opportunity.title);
    transitionLifecycle('screened', 'researched');
    db.updateOpportunityLifecycle('opp_persist', 'researched', { ...opportunity, lifecycle: 'researched' });
    assert.equal(db.getOpportunity('opp_persist').lifecycle, 'researched');
    assert.throws(() => transitionLifecycle('screened', 'scheduled'), /Invalid lifecycle jump/);

    const brief = opportunityToBrief(pack, db.getOpportunity('opp_persist'));
    assert.equal(brief.opportunity_id, 'opp_persist');
    assert.equal(brief.studio_id, 'failure_atlas');

    const plan = buildSeriesPlan(pack, [db.getOpportunity('opp_persist')]);
    db.saveSeriesPlan('series_plan_test', pack.studio.id, plan);
    assert.equal(db.listSeriesPlans(pack.studio.id).length, 1);
    const calendar = buildEditorialCalendar(pack, [{ ...db.getOpportunity('opp_persist'), cannibalization: { passed: true }, cluster_id: 'cluster_1' }], { start_date: '2026-08-01' });
    db.saveEditorialCalendar('calendar_test', pack.studio.id, calendar);
    assert.equal(db.listEditorialCalendars(pack.studio.id).length, 1);
  } finally {
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Phase 3 console contains every DOM target used by the opportunity client', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const ids = [...client.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((match) => match[1]);
  const missing = [...new Set(ids)].filter((id) => !new RegExp(`id=["']${id}["']`).test(html));
  assert.deepEqual(missing, []);
});
