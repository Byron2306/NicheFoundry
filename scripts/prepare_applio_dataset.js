const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  return result;
}

function collectApprovedElevenLabsNarration() {
  const episodesDir = path.join(ROOT, 'episodes');
  if (!fs.existsSync(episodesDir)) return [];
  const clips = [];
  for (const episodeName of fs.readdirSync(episodesDir)) {
    const episodeDir = path.join(episodesDir, episodeName);
    const reportPath = path.join(episodeDir, 'audio_performance_report.json');
    const manifestPath = path.join(episodeDir, 'audio_manifest.json');
    if (!fs.existsSync(reportPath) || !fs.existsSync(manifestPath)) continue;
    const report = readJson(reportPath);
    if (report.provider !== 'elevenlabs') continue;
    const manifest = readJson(manifestPath);
    for (const scene of manifest.scenes || []) {
      const source = path.join(episodeDir, scene.narration_wav || '');
      if (!fs.existsSync(source)) continue;
      const size = fs.statSync(source).size;
      if (size < 180000) continue;
      clips.push({
        episode: episodeName,
        scene_id: scene.scene_id,
        source,
        duration_seconds: Number(scene.probe?.duration_seconds || 0),
        spoken_text: scene.spoken_text || '',
        size
      });
    }
  }
  return clips.sort((a, b) => b.duration_seconds - a.duration_seconds || b.size - a.size);
}

function main() {
  const outDir = path.resolve(process.argv[2] || path.join(ROOT, 'exports', 'applio_dataset'));
  const maxClips = Number(process.env.APPLIO_DATASET_CLIPS || 24);
  ensureDir(outDir);
  const wavDir = path.join(outDir, 'wavs');
  ensureDir(wavDir);
  const clips = collectApprovedElevenLabsNarration().slice(0, maxClips);
  if (!clips.length) throw new Error('No approved ElevenLabs narration clips were found.');

  const rows = [];
  const manifest = {
    generated_at: new Date().toISOString(),
    generated_from: 'approved ElevenLabs narration clips',
    clip_count: 0,
    source_provider: 'elevenlabs',
    consent_note: 'Train only on voices you own, created, licensed, or have explicit permission to clone.',
    clips: []
  };

  clips.forEach((clip, index) => {
    const name = `${String(index + 1).padStart(2, '0')}_${clip.episode}_${clip.scene_id}.wav`;
    const target = path.join(wavDir, name);
    run('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', clip.source,
      '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,highpass=f=70,lowpass=f=14500,loudnorm=I=-18:TP=-2:LRA=7',
      '-ar', '40000', '-ac', '1', '-c:a', 'pcm_s16le', target
    ]);
    const rel = path.relative(outDir, target);
    rows.push(`${rel}|${clip.spoken_text.replace(/\r?\n/g, ' ').trim()}`);
    manifest.clips.push({
      episode: clip.episode,
      scene_id: clip.scene_id,
      source: path.relative(ROOT, clip.source),
      output: rel,
      duration_seconds: clip.duration_seconds,
      text: clip.spoken_text,
      sha256: fileHash(target)
    });
  });

  manifest.clip_count = manifest.clips.length;
  fs.writeFileSync(path.join(outDir, 'metadata.list'), rows.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'dataset_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'README.txt'), [
    'Applio training dataset prepared by NicheFoundry.',
    '',
    'Files:',
    '- wavs/: normalized mono training clips at 40 kHz PCM16',
    '- metadata.list: pipe-delimited relative_path|text',
    '- dataset_manifest.json: provenance and hashes',
    '',
    'Recommended next step:',
    '- Upload this folder to the Applio Google Colab UI and follow the training notebook flow.',
    '',
    'Important:',
    '- Use only approved, rights-cleared voices.'
  ].join('\n'));
  console.log(`Prepared Applio dataset: ${outDir} (${manifest.clip_count} clips)`);
}

try { main(); }
catch (error) { console.error(error.stack || error.message); process.exit(1); }
