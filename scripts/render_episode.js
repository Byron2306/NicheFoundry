const fs = require('fs');
const path = require('path');
const { buildRenderPlan, renderEpisode } = require('../lib/render_system');

function readJson(dir, name) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) throw new Error(`${name} is required.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const episodeArg = process.argv[2];
  const profile = process.argv[3] || 'final';
  if (!episodeArg) {
    console.error('Usage: node scripts/render_episode.js <episode-dir> [proxy|final|vertical_proxy|vertical_final]');
    process.exit(1);
  }
  const episodeDir = path.resolve(episodeArg);
  const episode = readJson(episodeDir, 'episode.json');
  const brief = readJson(episodeDir, 'brief.json');
  const scriptPackage = readJson(episodeDir, 'script_package.json');
  const visualPackage = {
    visual_plan: readJson(episodeDir, 'visual_plan.json'),
    asset_manifest: readJson(episodeDir, 'asset_manifest.json'),
    visual_report: readJson(episodeDir, 'visual_report.json')
  };
  const audioProduction = {
    audio_manifest: readJson(episodeDir, 'audio_manifest.json'),
    performance_report: readJson(episodeDir, 'audio_performance_report.json')
  };
  const renderPlan = buildRenderPlan({
    episodeId: episode.episode_id,
    studioId: brief.studio_id || episode.studio?.id,
    title: episode.title,
    scriptPackage,
    visualPackage,
    audioProduction,
    profileId: profile,
    outputFormat: brief.output_format || 'long_form'
  });
  const production = renderEpisode({ episodeDir, renderPlan, force: process.argv.includes('--force') });
  console.log(JSON.stringify({ passed: production.passed, output: production.render_manifest.output, qa: production.render_qa_report }, null, 2));
}

try { main(); }
catch (error) { console.error(error.stack || error.message); process.exit(1); }
