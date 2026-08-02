const fs = require("fs");
const path = require("path");
const { loadEnvFile } = require("./env_loader");

loadEnvFile(path.resolve(__dirname, "..", ".env"));

const ROLE_VOICE_ENV = {
  main_host: "ELEVENLABS_VOICE_ID_MAIN_HOST",
  countdown_host: "ELEVENLABS_VOICE_ID_COUNTDOWN_HOST",
  answer_reveal: "ELEVENLABS_VOICE_ID_ANSWER_REVEAL"
};

const ROLE_VOICE_SETTINGS = {
  main_host: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
  countdown_host: { stability: 0.35, similarity_boost: 0.78, style: 0.35, use_speaker_boost: true },
  answer_reveal: { stability: 0.5, similarity_boost: 0.82, style: 0.28, use_speaker_boost: true }
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFileLabel(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
}

function getVoiceIdForRole(role) {
  const envName = ROLE_VOICE_ENV[role];
  return (envName && process.env[envName]) || process.env.ELEVENLABS_VOICE_ID || "";
}

function getOutputFileName(sceneId) {
  return `${sanitizeFileLabel(sceneId)}.mp3`;
}

async function synthesizeScene({ apiKey, modelId, voiceId, text, role, outputPath }) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
      Accept: "audio/mpeg"
    },
    body: JSON.stringify({
      model_id: modelId,
      text,
      voice_settings: ROLE_VOICE_SETTINGS[role] || ROLE_VOICE_SETTINGS.main_host
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs request failed (${response.status}): ${errorText}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, audioBuffer);
}

async function main() {
  const episodeArg = process.argv[2];
  const episodeDir = episodeArg ? path.resolve(episodeArg) : null;
  if (!episodeDir) {
    console.error("Usage: node scripts/generate_elevenlabs.js <episode-dir>");
    process.exit(1);
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
  if (!apiKey) {
    console.error("Missing ELEVENLABS_API_KEY.");
    process.exit(1);
  }

  const scriptManifest = readJson(path.join(episodeDir, "script_manifest.json"));
  const importsManifestPath = path.join(episodeDir, "imports", "import_manifest.json");
  const importsManifest = fs.existsSync(importsManifestPath) ? readJson(importsManifestPath) : null;
  const elevenlabsDir = path.join(episodeDir, "imports", "elevenlabs");
  ensureDir(elevenlabsDir);

  const results = [];
  for (const scene of scriptManifest.scenes) {
    const voiceId = getVoiceIdForRole(scene.role);
    if (!voiceId) {
      throw new Error(
        `Missing voice ID for role ${scene.role}. Set ${ROLE_VOICE_ENV[scene.role] || "ELEVENLABS_VOICE_ID"}.`
      );
    }

    const manifestItem = importsManifest
      ? importsManifest.elevenlabs.find((item) => item.scene_id === scene.scene_id)
      : null;
    const preferredFile = manifestItem ? manifestItem.preferred_mp3 : getOutputFileName(scene.scene_id);
    const outputPath = path.join(elevenlabsDir, preferredFile);

    await synthesizeScene({
      apiKey,
      modelId,
      voiceId,
      text: scene.voiceover,
      role: scene.role,
      outputPath
    });

    results.push({
      scene_id: scene.scene_id,
      role: scene.role,
      voice_id: voiceId,
      model_id: modelId,
      output: path.relative(episodeDir, outputPath)
    });
  }

  writeJson(path.join(elevenlabsDir, "generation_report.json"), {
    generated_at: new Date().toISOString(),
    model_id: modelId,
    scenes: results
  });
  console.log(`Generated ${results.length} ElevenLabs clips in ${path.relative(process.cwd(), elevenlabsDir)}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
