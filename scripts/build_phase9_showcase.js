#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildVisualPackage, renderVisualPreviewAssets } = require('../lib/visual_system');
const { buildAudioPerformancePackage, produceAudioAssets } = require('../lib/audio_system');
const { buildRenderPlan, renderEpisode } = require('../lib/render_system');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.resolve(process.argv[2] || path.join(ROOT, 'showcase', 'phase9'));
const STUDIO_DIR = path.join(ROOT, 'studios', 'builtin');

const showcase = {
  failure_atlas: {
    beats: ['normal_operation', 'cascading_failure'],
    titles: ['A Bridge in Ordinary Wind', 'When Motion Fed Itself'],
    narration: [
      'At first, the bridge behaved like a flexible machine responding to ordinary wind.',
      'Then the deck twisted, the airflow changed, and each movement fed the next until stability vanished.'
    ]
  },
  history_under_glass: {
    beats: ['object_contradiction', 'qualified_meaning'],
    titles: ['One Shoe, Far from Rome', 'What the Leather Can Prove'],
    narration: [
      'A preserved leather shoe survives at the cold edge of the Roman world, carrying a very ordinary human footprint.',
      'Its stitching, wear, and place of discovery reveal frontier life, while leaving some identities beyond the evidence.'
    ]
  },
  practical_open_source: {
    beats: ['working_result_preview', 'validation'],
    titles: ['The Result First', 'Prove the Workflow'],
    narration: [
      'The goal is simple: turn a local audio file into a transcript without sending the recording to a remote service.',
      'A working command is not enough. Validate the output file, inspect its duration, and confirm the transcript is readable.'
    ]
  },
  puzzle_planet: {
    beats: ['mission_emergency', 'educational_payoff'],
    titles: ['Portal Failure on Dinosaur Island', 'Evidence Restores the Route'],
    narration: [
      'Explorer alert! The time portal has lost its fossil coordinates, and Dinosaur Island is closing around us.',
      'Use the evidence, restore the route, and carry one powerful clue about how fossils reveal vanished worlds.'
    ]
  }
};

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `${command} failed`);
}

function copy(file, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
}

async function main() {
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  const clips = [];
  const entries = [];

  for (const [studioId, content] of Object.entries(showcase)) {
    const pack = JSON.parse(fs.readFileSync(path.join(STUDIO_DIR, `${studioId}.json`), 'utf8'));
    const brief = { ...pack.samples[0], language: 'en', output_format: 'long_form' };
    const scriptPackage = {
      schema: 'nichefoundry.script_package.v1.0',
      scenes: content.beats.map((beat, index) => ({
        scene_id: `scene_${index + 1}`,
        story_beat: beat,
        beat_name: beat,
        title: content.titles[index],
        objective: index === 0 ? 'Establish the studio promise.' : 'Deliver the studio payoff.',
        narration: content.narration[index],
        estimated_duration_seconds: 5,
        claim_ids: [`claim_${index + 1}`],
        source_ids: [`source_${index + 1}`]
      }))
    };
    const timingPlan = { scenes: scriptPackage.scenes.map((scene) => ({ scene_id: scene.scene_id, target_duration_seconds: 7 })) };
    const studioDir = path.join(OUTPUT, studioId);
    fs.mkdirSync(studioDir, { recursive: true });
    const visualPackage = buildVisualPackage({ pack, brief, scriptPackage, episodeId: `showcase_${studioId}`, priorPackets: [], claims: claims });
    renderVisualPreviewAssets(studioDir, visualPackage, brief.working_title, brief.topic);
    const audioPackage = buildAudioPerformancePackage({ pack, brief, scriptPackage, timingPlan, episodeId: `showcase_${studioId}` });
    const audioProduction = await produceAudioAssets({ root: ROOT, episodeDir: studioDir, audioPackage, provider: 'espeak', force: true });
    const renderPlan = buildRenderPlan({
      episodeId: `showcase_${studioId}`,
      studioId,
      title: brief.working_title,
      scriptPackage,
      visualPackage,
      audioProduction,
      profileId: 'proxy'
    });
    const rendered = renderEpisode({ episodeDir: studioDir, renderPlan, force: true });
    if (!rendered.passed) throw new Error(`${studioId} render failed: ${JSON.stringify(rendered.render_qa_report)}`);

    const clip = path.join(OUTPUT, `${studioId}.mp4`);
    const thumb = path.join(OUTPUT, `${studioId}_thumbnail.png`);
    copy(path.join(studioDir, 'proxy.mp4'), clip);
    copy(path.join(studioDir, 'thumbnail.png'), thumb);
    clips.push(clip);
    entries.push({
      studio_id: studioId,
      name: pack.studio.name,
      clip: path.basename(clip),
      thumbnail: path.basename(thumb),
      duration_seconds: rendered.render_qa_report.probe.duration_seconds,
      dimensions: `${rendered.render_qa_report.probe.streams.find((stream) => stream.codec_type === 'video').width}x${rendered.render_qa_report.probe.streams.find((stream) => stream.codec_type === 'video').height}`,
      camera_grammar: renderPlan.scenes.map((scene) => scene.camera.id),
      qa_passed: rendered.passed,
      output_sha256: rendered.render_asset_hashes.assets.find((asset) => asset.relative_path === 'proxy.mp4')?.sha256 || null
    });
  }

  const concatFile = path.join(OUTPUT, 'concat.txt');
  fs.writeFileSync(concatFile, clips.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n') + '\n');
  run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', path.join(OUTPUT, 'NicheFoundry_Phase9_Four_Studio_Showreel.mp4')]);
  fs.rmSync(concatFile, { force: true });
  fs.writeFileSync(path.join(OUTPUT, 'showcase_manifest.json'), JSON.stringify({
    schema: 'nichefoundry.phase9_showcase.v1.0',
    generated_at: new Date().toISOString(),
    note: 'Generated by the Phase 9 production engine using governed SVG storyboards, local reference narration, studio camera grammar, embedded captions, and render QA.',
    entries
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(OUTPUT, 'README.md'), `# NicheFoundry Phase 9 Render Showcase\n\nThese clips were generated by the actual Phase 9 compositor. Each uses the same production kernel while preserving a different Studio Pack visual, host, motion, caption, and narrative grammar.\n\n${entries.map((entry) => `- **${entry.name}**: ${entry.clip}, ${entry.duration_seconds.toFixed(2)} seconds, ${entry.dimensions}, camera grammar ${entry.camera_grammar.join(' → ')}`).join('\n')}\n\nThe voices are deterministic local reference performances. The clips demonstrate orchestration, rendering, captions, audio integration, and visual identity rather than final premium casting.\n`);
  process.stdout.write(`${JSON.stringify({ output: OUTPUT, entries }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
