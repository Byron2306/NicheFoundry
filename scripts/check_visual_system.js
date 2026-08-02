const fs = require('fs');
const path = require('path');
const os = require('os');
const { validateStudioPack, buildStudioBlueprint } = require('../lib/studios');
const { buildChannelStrategy, assessEpisodeStrategy } = require('../lib/audience_strategy');
const { buildNarrativePackage } = require('../lib/story_engine');
const { buildVisualPackage, renderVisualPreviewAssets, validateVisualSystem } = require('../lib/visual_system');
const { verifyVisualAssetHashes } = require('../lib/evidence');

const root = path.resolve(__dirname, '..');
const studioDir = path.join(root, 'studios', 'builtin');

function claims(count = 14) {
  return Array.from({ length: count }, (_, index) => ({
    claim_id: `claim_${index + 1}`, source_id: `source_${(index % 3) + 1}`,
    source_url: `https://example.org/source-${(index % 3) + 1}`, source_title: `Source ${(index % 3) + 1}`,
    subject: `Evidence ${index + 1}`, claim: `Evidence ${index + 1} supports a distinct part of the programme.`,
    supporting_passage: `Evidence ${index + 1} supports a distinct part of the programme.`,
    status: 'supported', confidence: 0.9, claim_type: 'description'
  }));
}

(async () => {
  const results = [];
  for (const filename of fs.readdirSync(studioDir).filter((name) => name.endsWith('.json')).sort()) {
    const pack = JSON.parse(fs.readFileSync(path.join(studioDir, filename), 'utf8'));
    const packValidation = validateStudioPack(pack);
    const visualValidation = validateVisualSystem(pack);
    const brief = { ...pack.samples[0], output_format: 'long_form', target_duration_minutes: 7 };
    const strategy = buildChannelStrategy(pack, { episodes: [], opportunities: [] });
    const audience = assessEpisodeStrategy(pack, brief, { episodes: [], opportunities: [], channel_strategy: strategy });
    const archetype = pack.content.archetypes.find((item) => item.id === brief.archetype_id);
    const evidence = claims();
    const blueprint = buildStudioBlueprint(pack, brief, evidence);
    const story = await buildNarrativePackage({ pack, archetype, brief, claims: evidence, sources: [], studioBlueprint: blueprint, audienceAssessment: audience, priorPackets: [] });
    const episodeId = `visual_check_${pack.studio.id}`;
    const visual = buildVisualPackage({ pack, brief, scriptPackage: story.script_package, episodeId, priorPackets: [], claims: evidence });
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `${episodeId}-`));
    const hashes = renderVisualPreviewAssets(temp, visual, brief.working_title, brief.topic);
    fs.writeFileSync(path.join(temp, 'visual_asset_hashes.json'), `${JSON.stringify(hashes, null, 2)}\n`);
    const hashVerification = verifyVisualAssetHashes(temp);
    results.push({
      studio_id: pack.studio.id, pack_valid: packValidation.passed, visual_constitution_valid: visualValidation.passed,
      visual_report_passed: visual.visual_report.passed, scenes: visual.visual_plan.scene_plans.length,
      assets: visual.asset_manifest.assets.length, unique_compositions: visual.visual_report.unique_compositions,
      identity_hash: visual.visual_identity.identity_hash, generated_assets_verified: hashVerification.verified
    });
    fs.rmSync(temp, { recursive: true, force: true });
  }
  const passed = results.every((item) => item.pack_valid && item.visual_constitution_valid && item.visual_report_passed && item.generated_assets_verified);
  console.log(JSON.stringify({ checked_at: new Date().toISOString(), passed, studios: results }, null, 2));
  if (!passed) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
