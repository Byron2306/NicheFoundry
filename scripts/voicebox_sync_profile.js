const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { loadEnvFile } = require('./env_loader');

loadEnvFile(path.resolve(__dirname, '..', '.env'));

const ROOT = path.resolve(__dirname, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function prepareVoiceboxSample(filePath, maxDurationSeconds = 29) {
  const tempPath = path.join(
    os.tmpdir(),
    `voicebox-sample-${process.pid}-${Date.now()}-${path.basename(filePath)}`
  );
  execFileSync('ffmpeg', [
    '-y',
    '-i', filePath,
    '-t', String(maxDurationSeconds),
    '-ac', '1',
    '-ar', '24000',
    '-c:a', 'pcm_s16le',
    tempPath
  ], { stdio: 'ignore' });
  return tempPath;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch (_error) {}
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${(text || '').slice(0, 400)}`);
  }
  return payload;
}

async function main() {
  const apiUrl = (process.env.VOICEBOX_API_URL || 'http://127.0.0.1:17493').replace(/\/+$/, '');
  const profileName = process.argv[2] || process.env.VOICEBOX_PROFILE || 'NicheFoundry Narrator';
  const referenceManifestPath = path.join(ROOT, 'assets', 'voices', 'elevenlabs_curator', 'voice_reference_manifest.json');
  if (!fs.existsSync(referenceManifestPath)) {
    throw new Error('voice_reference_manifest.json is missing. Run `npm run build:voice-reference` first.');
  }

  const referenceManifest = readJson(referenceManifestPath);
  const profiles = await fetchJson(`${apiUrl}/profiles`);
  let profile = profiles.find((item) => String(item.name || '').toLowerCase() === profileName.toLowerCase());
  if (!profile) {
    profile = await fetchJson(`${apiUrl}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: profileName,
        description: 'Synced from approved NicheFoundry ElevenLabs narration samples.',
        language: process.env.VOICEBOX_LANGUAGE || 'en',
        voice_type: 'cloned',
        default_engine: process.env.VOICEBOX_ENGINE || 'qwen'
      })
    });
  }

  const existingSamples = await fetchJson(`${apiUrl}/profiles/${encodeURIComponent(profile.id)}/samples`);
  const existingTexts = new Set(existingSamples.map((item) => String(item.reference_text || '').trim()));

  let added = 0;
  for (const sample of referenceManifest.samples || []) {
    const filePath = path.join(ROOT, sample.sample);
    if (!fs.existsSync(filePath)) continue;
    const referenceText = `${sample.episode} ${sample.scene_id}`.trim();
    if (existingTexts.has(referenceText)) continue;
    const uploadPath = prepareVoiceboxSample(filePath);
    const form = new FormData();
    form.append('reference_text', referenceText);
    form.append('file', new Blob([fs.readFileSync(uploadPath)]), path.basename(uploadPath));
    try {
      await fetchJson(`${apiUrl}/profiles/${encodeURIComponent(profile.id)}/samples`, {
        method: 'POST',
        body: form
      });
      added += 1;
    } finally {
      fs.rmSync(uploadPath, { force: true });
    }
  }

  console.log(`Voicebox profile ready: ${profile.name} (${profile.id}), added ${added} new samples.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
