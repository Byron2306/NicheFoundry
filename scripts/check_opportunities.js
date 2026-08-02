const path = require('path');
const { StudioRegistry } = require('../lib/studios');
const {
  discoverStudioSeeds,
  scoreOpportunity,
  buildCannibalizationReport,
  clusterOpportunities,
  buildPortfolioReport
} = require('../lib/opportunities');

const ROOT = path.resolve(__dirname, '..');
const registry = new StudioRegistry({
  builtinDir: path.join(ROOT, 'studios', 'builtin'),
  customDir: path.join(ROOT, 'studios', 'custom')
});

let failed = false;
for (const summary of registry.list()) {
  const pack = registry.get(summary.studio_id);
  const scored = discoverStudioSeeds(pack).map((candidate) => scoreOpportunity(pack, candidate));
  const audited = scored.map((candidate) => ({
    ...candidate,
    cannibalization: buildCannibalizationReport(candidate, scored.filter((item) => item.opportunity_id !== candidate.opportunity_id))
  }));
  const clusters = clusterOpportunities(audited);
  const portfolio = buildPortfolioReport(audited);
  const fitCount = audited.filter((item) => item.fit.passed).length;
  const blockedCount = audited.filter((item) => !item.cannibalization.passed).length;
  console.log(`${pack.studio.name}: ${audited.length} seeds, ${fitCount} fit, ${clusters.length} clusters, ${blockedCount} cannibalisation blocks`);
  if (!audited.length || fitCount === 0 || clusters.length === 0 || portfolio.roles.length !== 5) failed = true;
}

if (failed) process.exitCode = 1;
