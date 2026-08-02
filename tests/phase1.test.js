const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { retrieveWikipediaSources } = require('../lib/research');
const { atomizeClaims, coverageReport } = require('../lib/claims');
const { generateRuleQuestions } = require('../lib/generator');
const { runEditorialAudit } = require('../lib/quality');
const { verifySourcesArtifact, verifyClaimsArtifact } = require('../lib/evidence');

const brief = {
  working_title: 'Failure Atlas Test',
  topic: 'bridge engineering failures',
  story_premise: 'Trace how small engineering weaknesses can cascade.',
  age_band: '13+',
  difficulty: 'mixed',
  question_count: 6,
  countdown_seconds: 8,
  audience_mode: 'general_family',
  contains_synthetic_media: false,
  source_mode: 'wikipedia',
  source_queries: ['Tacoma Narrows Bridge', 'Bridge engineering']
};

function mockWikiFetcher(url) {
  const title = url.searchParams.get('titles');
  const extracts = {
    'Tacoma Narrows Bridge': [
      'The Tacoma Narrows Bridge was a suspension bridge in the United States.',
      'The first bridge opened to traffic on July 1, 1940.',
      'It collapsed into Puget Sound on November 7, 1940.',
      'The collapse followed aeroelastic flutter in high winds.',
      'No human life was lost during the collapse.'
    ].join(' '),
    'Bridge engineering': [
      'Bridge engineering is an engineering discipline concerned with the design and construction of bridges.',
      'Engineers consider loads, materials, foundations, geometry, and environmental conditions.',
      'Structural analysis estimates how forces move through a bridge.',
      'Inspection can reveal corrosion, cracking, fatigue, and movement.',
      'Maintenance reduces the chance that small defects develop into severe damage.'
    ].join(' ')
  };
  return Promise.resolve({
    query: {
      pages: [{
        pageid: title === 'Tacoma Narrows Bridge' ? 101 : 202,
        title,
        canonicalurl: `https://example.test/wiki/${encodeURIComponent(title)}`,
        extract: extracts[title],
        revisions: [{ revid: title === 'Tacoma Narrows Bridge' ? 1001 : 2002, parentid: 1, timestamp: '2026-07-31T10:00:00Z', sha1: `sha-${title}` }]
      }]
    }
  });
}

test('Phase 1 retrieves revisioned sources, extracts claims, generates bound questions, and passes the independent critic', async () => {
  const sources = await retrieveWikipediaSources(brief, { fetcher: mockWikiFetcher, apiBase: 'https://example.test/w/api.php' });
  assert.equal(sources.length, 2);
  assert.equal(sources[0].provider, 'mediawiki_action_api');
  assert.ok(sources[0].revision_id);
  assert.match(sources[0].content_hash, /^[a-f0-9]{64}$/);

  const claims = atomizeClaims(sources, brief);
  const coverage = coverageReport(sources, claims, brief.question_count);
  assert.equal(coverage.sufficient_claims, true);
  assert.ok(claims.length >= 6);
  assert.ok(claims.every((claim) => claim.supporting_passage && claim.source_id));

  const questions = generateRuleQuestions(brief, claims);
  assert.equal(questions.length, 6);
  assert.ok(questions.every((question) => question.claim_ids.length === 1));
  assert.ok(questions.every((question) => question.citation_spans[0].passage));
  assert.ok(questions.every((question) => !/workflow|youtube|source packet|approval/i.test(question.question)));

  const episode = { episode_id: 'phase1-test', title: brief.working_title, questions };
  const audit = runEditorialAudit(episode, brief, claims, sources, []);
  assert.equal(audit.passed, true, JSON.stringify(audit, null, 2));

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase1-evidence-'));
  try {
    fs.writeFileSync(path.join(tempRoot, 'sources.json'), JSON.stringify(sources));
    fs.writeFileSync(path.join(tempRoot, 'claims.json'), JSON.stringify(claims));
    assert.equal(verifySourcesArtifact(tempRoot).verified, true);
    assert.equal(verifyClaimsArtifact(tempRoot).verified, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Phase 1 critic blocks meta questions and library duplicates', async () => {
  const sources = await retrieveWikipediaSources(brief, { fetcher: mockWikiFetcher, apiBase: 'https://example.test/w/api.php' });
  const claims = atomizeClaims(sources, brief);
  const questions = generateRuleQuestions(brief, claims);
  questions[0] = {
    ...questions[0],
    question: 'Why is this source packet included in the YouTube workflow?'
  };
  const duplicateQuestion = { ...questions[1] };
  const prior = [{ episode: { episode_id: 'older-episode', questions: [duplicateQuestion] } }];
  const episode = { episode_id: 'new-episode', title: brief.working_title, questions };
  const audit = runEditorialAudit(episode, brief, claims, sources, prior);
  assert.equal(audit.passed, false);
  assert.ok(audit.issues.some((issue) => issue.includes('meta_or_workflow_content')));
  assert.ok(audit.duplicate_report.findings.some((finding) => finding.scope === 'library'));
});
