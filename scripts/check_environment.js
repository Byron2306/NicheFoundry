const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const { StudioRegistry } = require("../lib/studios");
const { ConnectorRegistry } = require("../lib/connectors");

function commandStatus(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    available: !result.error && result.status === 0,
    detail: result.error?.message || String(result.stdout || result.stderr || "").split(/\r?\n/)[0]
  };
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

const piperBinary = firstExisting([
  process.env.PIPER_BIN,
  path.join(ROOT, "tools", "piper", "piper"),
  path.join(ROOT, ".venv-piper", "bin", "piper")
]);
const piperOnPath = commandStatus("piper", ["--help"]);
const modelRoot = path.resolve(process.env.PIPER_MODEL_DIR || path.join(ROOT, "assets", "piper"));
const models = fs.existsSync(modelRoot)
  ? fs.readdirSync(modelRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => fs.existsSync(path.join(modelRoot, name, `${name}.onnx`)))
  : [];

const studioRegistry = new StudioRegistry({
  builtinDir: path.join(ROOT, "studios", "builtin"),
  customDir: path.resolve(process.env.FOUNDRY_CUSTOM_STUDIOS_DIR || path.join(ROOT, "studios", "custom"))
});

const connectorRegistry = new ConnectorRegistry({
  builtinDir: path.join(ROOT, "connectors", "builtin"),
  customDir: path.resolve(process.env.FOUNDRY_CUSTOM_CONNECTORS_DIR || path.join(ROOT, "connectors", "custom"))
});

const report = {
  node: {
    version: process.version,
    supported: Number(process.versions.node.split(".")[0]) >= 22
  },
  ffmpeg: commandStatus(process.env.FFMPEG_BIN || "ffmpeg", ["-version"]),
  ffprobe: commandStatus(process.env.FFPROBE_BIN || "ffprobe", ["-version"]),
  research: {
    provider: "connector_registry",
    user_agent_configured: Boolean(process.env.FOUNDRY_USER_AGENT),
    max_source_characters: Number(process.env.FOUNDRY_MAX_SOURCE_CHARS || 30000),
    installed_connectors: connectorRegistry.list().length,
    configured_connectors: connectorRegistry.list().filter((item) => item.auth.configured).map((item) => item.connector_id),
    connectors_missing_environment: connectorRegistry.list().filter((item) => !item.auth.configured).map((item) => ({ connector_id: item.connector_id, missing_env: item.auth.missing_env }))
  },
  generator: {
    mode: process.env.FOUNDRY_GENERATOR_MODE || "rules",
    ollama_model: process.env.OLLAMA_MODEL || null,
    ollama_base_url: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
    ollama_cli: commandStatus("ollama", ["--version"])
  },
  studios: {
    installed: studioRegistry.list().length,
    packs: studioRegistry.list().map((studio) => ({
      studio_id: studio.studio_id,
      version: studio.version,
      depth_score: studio.depth_score,
      source: studio.source
    }))
  },
  audio: {
    espeak: commandStatus(process.env.ESPEAK_BIN || "espeak", ["--version"]),
    voicebox: commandStatus("curl", ["-fsS", `${(process.env.VOICEBOX_API_URL || "http://127.0.0.1:17493").replace(/\/+$/, "")}/health`]),
    kokoro: commandStatus(process.env.KOKORO_COMMAND || path.join(ROOT, ".venv-kokoro", "bin", "python"), ["--version"]),
    provider_order: ["imported", "voicebox", "kokoro", "piper", "elevenlabs", "openvoice", "espeak"],
    voicebox_configured: Boolean(process.env.VOICEBOX_PROFILE),
    voicebox_api_url: process.env.VOICEBOX_API_URL || "http://127.0.0.1:17493",
    voicebox_profile: process.env.VOICEBOX_PROFILE || null,
    voicebox_model_size: process.env.VOICEBOX_MODEL_SIZE || "0.6B",
    kokoro_configured: Boolean(fs.existsSync(path.join(ROOT, "scripts", "kokoro_synthesize.py")) && (process.env.KOKORO_COMMAND || fs.existsSync(path.join(ROOT, ".venv-kokoro", "bin", "python")))),
    elevenlabs_configured: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID),
    openvoice_configured: Boolean(process.env.OPENVOICE_REFERENCE_AUDIO || fs.existsSync(path.join(ROOT, "assets", "voices", "elevenlabs_curator", "reference.wav"))),
    kokoro_command: process.env.KOKORO_COMMAND || path.join(ROOT, ".venv-kokoro", "bin", "python"),
    openvoice_command: process.env.OPENVOICE_COMMAND || path.join(ROOT, ".venv-openvoice", "bin", "python"),
    sample_rate_hz: 48000,
    scene_level_cache: true
  },
  editorial: {
    roles: 7,
    required_review_tasks: 7,
    scene_and_timeline_comments: true,
    immutable_snapshots: true,
    final_signoff_required: true
  },
  publishing: {
    youtube_credentials_configured: Boolean(process.env.YOUTUBE_ACCESS_TOKEN || (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN)),
    credential_mode: process.env.YOUTUBE_ACCESS_TOKEN ? "static_access_token" : (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN) ? "oauth_refresh_token" : "missing",
    initial_privacy: "private",
    resumable_upload: true,
    processing_poll: true,
    captions_upload: true,
    thumbnail_upload: true,
    remote_metadata_verification: true,
    explicit_schedule_confirmation: true,
    upload_chunk_size_bytes: Number(process.env.YOUTUBE_UPLOAD_CHUNK_SIZE || 8 * 1024 * 1024)
  },
  render: {
    profiles: ["proxy", "final", "vertical_proxy", "vertical_final"],
    scene_segment_cache: true,
    partial_rerender: true,
    embedded_subtitles: true,
    final_approval_required: true,
    proxy_preset_override: process.env.FOUNDRY_PROXY_RENDER_PRESET || process.env.FOUNDRY_RENDER_PRESET || null,
    final_preset_override: process.env.FOUNDRY_FINAL_RENDER_PRESET || process.env.FOUNDRY_RENDER_PRESET || null,
    proxy_crf_override: process.env.FOUNDRY_PROXY_RENDER_CRF || process.env.FOUNDRY_RENDER_CRF || null,
    final_crf_override: process.env.FOUNDRY_FINAL_RENDER_CRF || process.env.FOUNDRY_RENDER_CRF || null
  },
  piper: {
    available: Boolean(piperBinary || piperOnPath.available),
    binary: piperBinary || (piperOnPath.available ? "piper (PATH)" : null),
    models,
    model_root: modelRoot
  },
  console: {
    host: process.env.HOST || "127.0.0.1",
    remote_auth_configured: Boolean(process.env.FOUNDRY_AUTH_TOKEN),
    data_dir: path.resolve(process.env.FOUNDRY_DATA_DIR || path.join(ROOT, "data")),
    episodes_dir: path.resolve(process.env.FOUNDRY_EPISODES_DIR || path.join(ROOT, "episodes"))
  }
};

console.log(JSON.stringify(report, null, 2));
const requiredReady = report.node.supported && report.ffmpeg.available && report.ffprobe.available;
if (!requiredReady) process.exitCode = 1;
