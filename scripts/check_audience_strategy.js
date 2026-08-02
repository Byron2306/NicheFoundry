const fs = require('fs');
const path = require('path');
const { validateStudioPack } = require('../lib/studios');
const { buildChannelStrategy, assessEpisodeStrategy } = require('../lib/audience_strategy');

const root = path.resolve(__dirname, '..');
const studioDir = path.join(root, 'studios', 'builtin');
const files = fs.readdirSync(studioDir).filter((name) => name.endsWith('.json')).sort();
let failed = false;
for (const filename of files) {
  const pack = JSON.parse(fs.readFileSync(path.join(studioDir, filename), 'utf8'));
  const validation = validateStudioPack(pack);
  const strategy = buildChannelStrategy(pack, { episodes: [], opportunities: [] });
  const sample = pack.samples?.[0];
  const assessment = sample ? assessEpisodeStrategy(pack, sample, { episodes: [], opportunities: [], channel_strategy: strategy }) : null;
  const result = {
    studio_id: pack.studio.id,
    version: pack.studio.version,
    valid: validation.passed,
    personas: strategy.audience_profile.personas.length,
    content_pillars: strategy.content_pillars.length,
    channel_promise: strategy.channel_promise,
    sample_audience_fit: assessment ? {
      passed: assessment.passed,
      score: assessment.audience_fit.score,
      persona: assessment.audience_fit.persona?.name,
      viewer_job: assessment.audience_fit.viewer_job?.label,
      content_pillar: assessment.audience_fit.content_pillar?.name,
      output_format: assessment.audience_fit.output_format,
      issues: assessment.issues
    } : null,
    format_rotation: strategy.format_rotation
  };
  console.log(JSON.stringify(result, null, 2));
  if (!validation.passed || !assessment?.passed) failed = true;
}
if (failed) process.exitCode = 1;
