const fs = require('fs');
const path = require('path');
const { StudioRegistry, buildStudioBlueprint } = require('../lib/studios');
const { buildChannelStrategy, assessEpisodeStrategy } = require('../lib/audience_strategy');
const { buildNarrativePackage } = require('../lib/story_engine');

const root = path.resolve(__dirname, '..');
const registry = new StudioRegistry({
  builtinDir: path.join(root, 'studios', 'builtin'),
  customDir: path.resolve(process.env.FOUNDRY_CUSTOM_STUDIOS_DIR || path.join(root, 'studios', 'custom'))
});

function fixtureClaims(count = 14) {
  return Array.from({ length: count }, (_, index) => ({
    claim_id: `story_check_claim_${index + 1}`,
    source_id: `story_check_source_${(index % 3) + 1}`,
    source_url: `https://example.org/story-check-${(index % 3) + 1}`,
    source_title: `Story Check Source ${(index % 3) + 1}`,
    subject: `Evidence unit ${index + 1}`,
    claim: `Evidence unit ${index + 1} establishes a distinct supported detail for narrative stage ${index + 1}.`,
    supporting_passage: `Evidence unit ${index + 1} establishes a distinct supported detail for narrative stage ${index + 1}.`,
    status: 'supported',
    confidence: 0.9,
    claim_type: 'description'
  }));
}

(async () => {
  const reports = [];
  for (const record of registry.list()) {
    const pack = registry.get(record.studio_id);
    const brief = { ...pack.samples[0], output_format: pack.samples[0]?.output_format || 'long_form' };
    const archetype = pack.content.archetypes.find((item) => item.id === brief.archetype_id) || pack.content.archetypes[0];
    const claims = fixtureClaims(Math.max(14, archetype.required_story_beats.length * 2));
    const channelStrategy = buildChannelStrategy(pack, { episodes: [], opportunities: [] });
    const audienceAssessment = assessEpisodeStrategy(pack, brief, {
      episodes: [],
      opportunities: [],
      channel_strategy: channelStrategy
    });
    const studioBlueprint = buildStudioBlueprint(pack, brief, claims);
    const story = await buildNarrativePackage({
      pack,
      archetype,
      brief,
      claims,
      sources: [],
      studioBlueprint,
      audienceAssessment,
      priorPackets: []
    });
    reports.push({
      studio_id: pack.studio.id,
      studio_name: pack.studio.name,
      narrative_mode: story.narrative_blueprint.narrative_mode,
      archetype_id: archetype.id,
      selected_hook_type: story.narrative_blueprint.selected_hook.type,
      scene_count: story.script_package.scenes.length,
      grounded_claim_count: story.story_report.grounded_claim_count,
      estimated_duration_minutes: story.story_report.estimated_duration_minutes,
      passed: story.story_report.passed,
      issues: story.story_report.issues
    });
  }

  const output = {
    schema: 'nichefoundry.story_engine_check.v1.0',
    checked_at: new Date().toISOString(),
    studio_count: reports.length,
    passed: reports.length > 0 && reports.every((item) => item.passed),
    studios: reports
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.passed) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
