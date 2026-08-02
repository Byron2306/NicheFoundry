const fs = require('fs');
const path = require('path');
const { buildAudioPerformancePackage, STUDIO_AUDIO_DEFAULTS } = require('../lib/audio_system');
const { StudioRegistry } = require('../lib/studios');

const root = path.resolve(__dirname, '..');
const registry = new StudioRegistry({ builtinDir: path.join(root, 'studios', 'builtin'), customDir: path.join(root, 'studios', 'custom'), database: null });
let failures = 0;
for (const summary of registry.list()) {
  const pack = registry.get(summary.studio_id);
  const archetype = pack.content.archetypes.find((item) => item.id === pack.content.default_archetype) || pack.content.archetypes[0];
  const scenes = archetype.required_story_beats.map((beat, index) => ({ scene_id: `check_${index + 1}`, story_beat: beat, narration: `Scene ${index + 1} explains ${beat.replaceAll('_', ' ')} with verified evidence.` }));
  const output = buildAudioPerformancePackage({ pack, brief: { language: 'en' }, scriptPackage: { scenes }, timingPlan: { scenes: [] }, episodeId: `check_${pack.studio.id}` });
  const ok = output.passed && output.audio_performance_plan.scenes.length === scenes.length && STUDIO_AUDIO_DEFAULTS[pack.studio.id];
  console.log(`${ok ? 'PASS' : 'FAIL'} ${pack.studio.id}: ${output.host_profile.primary_host.name}; ${scenes.length} performances; ${output.pronunciation_lexicon.entries.length} lexicon entries`);
  if (!ok) failures += 1;
}
if (failures) process.exit(1);
