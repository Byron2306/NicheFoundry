const fs = require('fs');
const path = require('path');
const { buildAudioPerformancePackage, produceAudioAssets } = require('../lib/audio_system');
const { loadEnvFile } = require('./env_loader');

loadEnvFile(path.resolve(__dirname, '..', '.env'));

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

async function main() {
  const episodeArg = process.argv[2];
  const providerIndex = process.argv.indexOf('--provider');
  const provider = providerIndex >= 0 ? process.argv[providerIndex + 1] : 'auto';
  const force = process.argv.includes('--force');
  if (!episodeArg) {
    console.error('Usage: node scripts/build_audio_performance.js <episode-dir> [--provider auto|voicebox|kokoro|openvoice|piper|elevenlabs|espeak] [--force]');
    process.exit(1);
  }
  const root = path.resolve(__dirname, '..');
  const episodeDir = path.resolve(episodeArg);
  const brief = readJson(path.join(episodeDir, 'brief.json'));
  const pack = readJson(path.join(episodeDir, 'studio_pack_snapshot.json'));
  const scriptPackage = readJson(path.join(episodeDir, 'script_package.json'));
  const timingPlan = readJson(path.join(episodeDir, 'timing_plan.json'));
  const audioPackage = buildAudioPerformancePackage({ pack, brief, scriptPackage, timingPlan, episodeId: path.basename(episodeDir) });
  for (const [name, payload] of Object.entries({
    'host_profile.json': audioPackage.host_profile,
    'pronunciation_lexicon.json': audioPackage.pronunciation_lexicon,
    'audio_performance_plan.json': audioPackage.audio_performance_plan,
    'sound_design_plan.json': audioPackage.sound_design_plan,
    'audio_preflight_report.json': audioPackage.audio_preflight_report
  })) writeJson(path.join(episodeDir, name), payload);
  if (!audioPackage.passed) throw new Error(`Audio preflight failed: ${audioPackage.audio_preflight_report.issues.join(' ')}`);
  if (provider === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
    const totalCharacters = audioPackage.audio_performance_plan.scenes
      .reduce((sum, scene) => sum + String(scene.spoken_text || '').length, 0);
    console.log(`ElevenLabs character request: ${totalCharacters} characters across ${audioPackage.audio_performance_plan.scenes.length} scenes.`);
  }
  const production = await produceAudioAssets({ root, episodeDir, audioPackage, provider, force });
  writeJson(path.join(episodeDir, 'audio_manifest.json'), production.audio_manifest);
  writeJson(path.join(episodeDir, 'audio_asset_hashes.json'), production.audio_asset_hashes);
  writeJson(path.join(episodeDir, 'loudness_report.json'), production.loudness_report);
  writeJson(path.join(episodeDir, 'audio_performance_report.json'), production.performance_report);
  console.log(`Audio ready: ${production.performance_report.scene_count} scenes, provider ${production.provider}, ${production.performance_report.cache_hits} cache hits.`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
