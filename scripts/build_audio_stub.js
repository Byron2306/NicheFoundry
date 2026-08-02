const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PIPER_BIN_CANDIDATES = [
  process.env.PIPER_BIN,
  path.join(ROOT, "tools", "piper", "piper"),
  path.join(ROOT, ".venv-piper", "bin", "piper"),
  "piper"
].filter(Boolean);
const PIPER_MODEL_CANDIDATES = [
  ...(process.env.PIPER_MODEL_DIR ? [{
    name: process.env.PIPER_MODEL_NAME || "custom",
    dir: path.resolve(process.env.PIPER_MODEL_DIR),
    model: process.env.PIPER_MODEL_FILE || `${process.env.PIPER_MODEL_NAME || "model"}.onnx`,
    config: process.env.PIPER_CONFIG_FILE || `${process.env.PIPER_MODEL_NAME || "model"}.onnx.json`
  }] : []),
  {
    name: "en_US-lessac-high",
    dir: path.join(__dirname, "..", "assets", "piper", "en_US-lessac-high"),
    model: "en_US-lessac-high.onnx",
    config: "en_US-lessac-high.onnx.json"
  },
  {
    name: "en_US-lessac-medium",
    dir: path.join(__dirname, "..", "assets", "piper", "en_US-lessac-medium"),
    model: "en_US-lessac-medium.onnx",
    config: "en_US-lessac-medium.onnx.json"
  }
];

const ROLE_STYLES = {
  main_host: { volume: 1.03, lengthScale: 0.98, sentenceSilence: 0.14 },
  countdown_host: { volume: 1.06, lengthScale: 0.94, sentenceSilence: 0.1 },
  answer_reveal: { volume: 1.04, lengthScale: 0.97, sentenceSilence: 0.12 }
};
const AUDIO_CHECK_STYLE = { volume: 1.05, lengthScale: 0.96, sentenceSilence: 0.1 };

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFileLabel(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
}

function sanitizeForSpeech(text) {
  return String(text || "")
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/["]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", ["-loglevel", "error", ...args], {
    stdio: "pipe",
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "ffmpeg failed");
  }
}

function runFfprobe(args) {
  const result = spawnSync("ffprobe", args, {
    stdio: "pipe",
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "ffprobe failed");
  }
  return result.stdout.trim();
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} failed`);
  }
}

function resolvePiperBinary() {
  for (const candidate of PIPER_BIN_CANDIDATES) {
    if (candidate === "piper") {
      const check = spawnSync(candidate, ["--help"], { stdio: "ignore" });
      if (!check.error) return candidate;
      continue;
    }
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolvePiperModel() {
  for (const candidate of PIPER_MODEL_CANDIDATES) {
    const modelPath = path.join(candidate.dir, candidate.model);
    const configPath = path.join(candidate.dir, candidate.config);
    if (fs.existsSync(modelPath) && fs.existsSync(configPath)) {
      return {
        name: candidate.name,
        modelPath,
        configPath
      };
    }
  }
  return null;
}

function getAudioDurationSeconds(filePath) {
  const stdout = runFfprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
  return Number(stdout || 0);
}

function synthesizeSpeech(text, audioPath, textPath, style) {
  const selectedModel = resolvePiperModel();
  if (!selectedModel) {
    throw new Error("Piper model files are missing.");
  }
  fs.writeFileSync(textPath, `${text}\n`);
  const piperBin = resolvePiperBinary();
  if (!piperBin) throw new Error("Piper executable is missing. Set PIPER_BIN or install piper on PATH.");
  runCommand(piperBin, [
    "-m",
    selectedModel.modelPath,
    "-c",
    selectedModel.configPath,
    "-i",
    textPath,
    "-f",
    audioPath,
    "--length-scale",
    String(style.lengthScale),
    "--sentence-silence",
    String(style.sentenceSilence),
    "--volume",
    String(style.volume)
  ]);
}

function padSpeechToDuration(audioPath, durationSeconds) {
  const paddedPath = `${audioPath}.padded.wav`;
  runFfmpeg([
    "-y",
    "-i",
    audioPath,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-filter_complex",
    "[0:a][1:a]concat=n=2:v=0:a=1[a]",
    "-map",
    "[a]",
    "-t",
    String(durationSeconds),
    "-c:a",
    "pcm_s16le",
    paddedPath
  ]);
  fs.renameSync(paddedPath, audioPath);
}

function enhanceSpeech(audioPath) {
  const enhancedPath = `${audioPath}.enhanced.wav`;
  runFfmpeg([
    "-y",
    "-i",
    audioPath,
    "-af",
    "highpass=f=80,lowpass=f=12000,loudnorm=I=-18:TP=-2:LRA=9",
    "-ar",
    "44100",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    enhancedPath
  ]);
  fs.renameSync(enhancedPath, audioPath);
}

function buildAudioCheckClip(audioDir) {
  const speechTextPath = path.join(audioDir, "audio_check.speech.txt");
  const speechPath = path.join(audioDir, "audio_check_voice.wav");
  const outputPath = path.join(audioDir, "audio_check.mp3");
  const wavOutputPath = path.join(audioDir, "audio_check.wav");
  const message =
    "Audio check. If you can hear this voice after three beeps, the offline narrator is working.";

  synthesizeSpeech(message, speechPath, speechTextPath, AUDIO_CHECK_STYLE);
  enhanceSpeech(speechPath);

  runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=0.25",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono:d=0.15",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=0.25",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono:d=0.15",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=0.25",
    "-i",
    speechPath,
    "-filter_complex",
    "[0:a][1:a][2:a][3:a][4:a][5:a]concat=n=6:v=0:a=1[base];[base]loudnorm=I=-17:TP=-1.5:LRA=8[a]",
    "-map",
    "[a]",
    "-ar",
    "44100",
    "-ac",
    "1",
    "-q:a",
    "2",
    "-c:a",
    "libmp3lame",
    outputPath
  ]);

  runFfmpeg([
    "-y",
    "-i",
    outputPath,
    "-c:a",
    "pcm_s16le",
    wavOutputPath
  ]);

  fs.unlinkSync(speechTextPath);
  fs.unlinkSync(speechPath);
  return outputPath;
}

function buildSceneAudio(scene, audioPath) {
  const style = ROLE_STYLES[scene.role] || ROLE_STYLES.main_host;
  const cleanText = sanitizeForSpeech(scene.voiceover);
  const wavPath = audioPath.replace(/\.mp3$/, ".wav");
  const textPath = `${wavPath}.speech.txt`;
  synthesizeSpeech(cleanText, wavPath, textPath, style);
  enhanceSpeech(wavPath);
  const actualDuration = getAudioDurationSeconds(wavPath);
  const targetDuration = Number(scene.duration_seconds) || actualDuration;
  if (actualDuration < targetDuration) {
    padSpeechToDuration(wavPath, targetDuration);
  }
  runFfmpeg([
    "-y",
    "-i",
    wavPath,
    "-ar",
    "44100",
    "-ac",
    "1",
    "-q:a",
    "2",
    "-c:a",
    "libmp3lame",
    audioPath
  ]);
  fs.unlinkSync(textPath);
  fs.unlinkSync(wavPath);
  const selectedModel = resolvePiperModel();
  return {
    voice: `piper:${selectedModel ? selectedModel.name : "unknown"}`,
    actual_duration_seconds: Number(getAudioDurationSeconds(audioPath).toFixed(3))
  };
}

function main() {
  const episodeArg = process.argv[2];
  const episodeDir = episodeArg ? path.resolve(episodeArg) : null;
  if (!episodeDir) {
    console.error("Usage: node scripts/build_audio_stub.js <episode-dir>");
    process.exit(1);
  }
  if (!resolvePiperBinary() || !resolvePiperModel()) {
    console.error("Piper engine or model is missing. Set PIPER_BIN and PIPER_MODEL_DIR, install the optional local voice pack, or place models under assets/piper.");
    process.exit(1);
  }

  const scriptManifest = readJson(path.join(episodeDir, "script_manifest.json"));
  const narrationManifest = readJson(path.join(episodeDir, "narration_manifest.json"));
  const audioDir = path.join(episodeDir, "audio");
  ensureDir(audioDir);

  const scenes = scriptManifest.scenes.map((scene, index) => {
    const narrationScene = narrationManifest.scenes[index];
    const basename = narrationScene
      ? narrationScene.filename.replace(/\.mp3$/, ".txt")
      : `${String(index).padStart(3, "0")}_${sanitizeFileLabel(scene.scene_id)}.txt`;
    const filePath = path.join(audioDir, basename);
    const targetAudio = basename.replace(/\.txt$/, ".mp3");
    const audioPath = path.join(audioDir, targetAudio);
    const payload = [
      `scene_id: ${scene.scene_id}`,
      `card_id: ${scene.card_id}`,
      `role: ${scene.role}`,
      `duration_seconds: ${scene.duration_seconds}`,
      "",
      scene.voiceover
    ].join("\n");
    fs.writeFileSync(filePath, `${payload}\n`);
    const speech = buildSceneAudio(scene, audioPath);

    return {
      scene_id: scene.scene_id,
      role: scene.role,
      duration_seconds: scene.duration_seconds,
      source_text: path.relative(episodeDir, filePath),
      target_audio: path.relative(episodeDir, audioPath),
      voice: speech.voice,
      actual_duration_seconds: speech.actual_duration_seconds,
      status: "offline_tts_ready"
    };
  });

  const manifest = {
    generated_at: new Date().toISOString(),
    mode: "offline_piper",
    note: "These clips were synthesized locally with Piper plus light mastering, then padded when needed to preserve scene timing.",
    audio_check: path.relative(episodeDir, buildAudioCheckClip(audioDir)),
    scenes
  };

  fs.writeFileSync(path.join(episodeDir, "audio_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built ${scenes.length} offline narration clips in ${path.relative(process.cwd(), audioDir)}`);
}

main();
