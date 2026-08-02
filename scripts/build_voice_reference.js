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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  return result;
}

function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function findElevenLabsNarration() {
  const episodesDir = path.join(ROOT, 'episodes');
  if (!fs.existsSync(episodesDir)) return [];
  const results = [];
  for (const episodeName of fs.readdirSync(episodesDir)) {
    const episodeDir = path.join(episodesDir, episodeName);
    const reportPath = path.join(episodeDir, 'audio_performance_report.json');
    const manifestPath = path.join(episodeDir, 'audio_manifest.json');
    if (!fs.existsSync(reportPath) || !fs.existsSync(manifestPath)) continue;
    const report = readJson(reportPath);
    if (report.provider !== 'elevenlabs') continue;
    const manifest = readJson(manifestPath);
    for (const scene of manifest.scenes || []) {
      const wav = path.join(episodeDir, scene.narration_wav || '');
      if (!fs.existsSync(wav)) continue;
      const size = fs.statSync(wav).size;
      if (size < 250000) continue;
      results.push({
        episode: episodeName,
        scene_id: scene.scene_id,
        wav,
        duration_seconds: Number(scene.probe?.duration_seconds || 0),
        size
      });
    }
  }
  return results.sort((left, right) => right.duration_seconds - left.duration_seconds || right.size - left.size);
}

function main() {
  const outDir = path.resolve(process.argv[2] || path.join(ROOT, 'assets', 'voices', 'elevenlabs_curator'));
  const maxClips = Number(process.env.OPENVOICE_REFERENCE_CLIPS || 8);
  ensureDir(outDir);
  const samplesDir = path.join(outDir, 'samples');
  ensureDir(samplesDir);
  const samples = findElevenLabsNarration().slice(0, maxClips);
  if (!samples.length) {
    throw new Error('No ElevenLabs narration samples found. Generate at least one ElevenLabs episode or place reference WAVs manually.');
  }
  const normalized = [];
  samples.forEach((sample, index) => {
    const target = path.join(samplesDir, `${String(index + 1).padStart(2, '0')}_${sample.episode}_${sample.scene_id}.wav`);
    run('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', sample.wav,
      '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,highpass=f=75,lowpass=f=14500,loudnorm=I=-20:TP=-2:LRA=9',
      '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', target
    ]);
    normalized.push({ ...sample, target });
  });
  const concatList = path.join(outDir, 'reference_concat.txt');
  fs.writeFileSync(concatList, normalized.map((sample) => `file '${sample.target.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const reference = path.join(outDir, 'reference.wav');
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatList, '-t', String(Number(process.env.OPENVOICE_REFERENCE_SECONDS || 90)), '-c:a', 'pcm_s16le', reference]);
  const manifest = {
    generated_at: new Date().toISOString(),
    reference_audio: path.relative(ROOT, reference),
    reference_sha256: fileHash(reference),
    sample_count: normalized.length,
    source_provider: 'elevenlabs',
    consent_note: 'Use only with voices you own, created, licensed, or have explicit permission to clone.',
    samples: normalized.map((sample) => ({
      episode: sample.episode,
      scene_id: sample.scene_id,
      source: path.relative(ROOT, sample.wav),
      sample: path.relative(ROOT, sample.target),
      duration_seconds: sample.duration_seconds,
      sha256: fileHash(sample.target)
    }))
  };
  fs.writeFileSync(path.join(outDir, 'voice_reference_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built OpenVoice reference: ${path.relative(process.cwd(), reference)} from ${normalized.length} ElevenLabs clips.`);
}

try { main(); }
catch (error) { console.error(error.stack || error.message); process.exit(1); }
