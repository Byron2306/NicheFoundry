const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const RENDER_SCHEMA_VERSION = '1.0';

const RENDER_PROFILES = Object.freeze({
  proxy: {
    id: 'proxy', width: 960, height: 540, fps: 24, crf: 28, preset: 'veryfast',
    audio_bitrate: '128k', video_bitrate_hint: '1.5M', suffix: 'proxy'
  },
  final: {
    id: 'final', width: 1920, height: 1080, fps: 30, crf: 20, preset: 'medium',
    audio_bitrate: '192k', video_bitrate_hint: '8M', suffix: 'final'
  },
  vertical_proxy: {
    id: 'vertical_proxy', width: 540, height: 960, fps: 24, crf: 28, preset: 'veryfast',
    audio_bitrate: '128k', video_bitrate_hint: '1.5M', suffix: 'vertical_proxy'
  },
  vertical_final: {
    id: 'vertical_final', width: 1080, height: 1920, fps: 30, crf: 20, preset: 'medium',
    audio_bitrate: '192k', video_bitrate_hint: '8M', suffix: 'vertical_final'
  }
});

function hashBuffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function hashObject(value) {
  return hashBuffer(Buffer.from(JSON.stringify(value)));
}
function fileHash(filePath) {
  return hashBuffer(fs.readFileSync(filePath));
}
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}
function commandExists(command) {
  const result = spawnSync(command, ['-version'], { stdio: 'ignore', timeout: 8000, killSignal: 'SIGKILL' });
  return !result.error && result.status === 0;
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000, killSignal: 'SIGKILL', ...options
  });
  if (result.error) throw new Error(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  return result;
}
function safeRelative(value) {
  const normal = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normal || normal.includes('../') || normal === '..') throw new Error(`Unsafe relative path: ${value}`);
  return normal;
}
function resolveInside(root, relativePath) {
  const relative = safeRelative(relativePath);
  const absolute = path.resolve(root, relative);
  const base = path.resolve(root) + path.sep;
  if (!(absolute + path.sep).startsWith(base) && absolute !== path.resolve(root)) throw new Error(`Path escapes episode directory: ${relativePath}`);
  return absolute;
}
function profileById(profileId = 'proxy') {
  const profile = RENDER_PROFILES[profileId];
  if (!profile) throw new Error(`Unknown render profile: ${profileId}`);
  const category = profileId.includes('proxy') ? 'PROXY' : 'FINAL';
  const preset = process.env[`FOUNDRY_${category}_RENDER_PRESET`] || process.env.FOUNDRY_RENDER_PRESET || profile.preset;
  const crfValue = process.env[`FOUNDRY_${category}_RENDER_CRF`] || process.env.FOUNDRY_RENDER_CRF;
  const crf = crfValue == null || crfValue === '' ? profile.crf : Number(crfValue);
  const allowedPresets = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']);
  if (!allowedPresets.has(preset)) throw new Error(`Unsupported FFmpeg render preset: ${preset}`);
  if (!Number.isFinite(crf) || crf < 0 || crf > 51) throw new Error(`Render CRF must be between 0 and 51; received ${crfValue}.`);
  return { ...profile, preset, crf };
}

function activeVisualAsset(visualPackage, scenePlan) {
  const assets = visualPackage?.asset_manifest?.assets || [];
  const sceneAssets = assets.filter((asset) => asset.scene_id === scenePlan.scene_id && asset.asset_type !== 'thumbnail_preview');
  const replacement = sceneAssets.find((asset) => ['ready', 'registered', 'replacement_ready'].includes(asset.status) && asset.replaces_asset_id);
  const latestReady = [...sceneAssets].reverse().find((asset) => !['superseded', 'failed'].includes(asset.status));
  return replacement || latestReady || {
    asset_id: scenePlan.preview_asset_id,
    relative_path: scenePlan.preview_path,
    sha256: null,
    status: 'planned'
  };
}

function activeThumbnailAsset(visualPackage) {
  const assets = visualPackage?.asset_manifest?.assets || [];
  const replacement = [...assets].reverse().find((asset) => asset.role === 'thumbnail' && ['ready', 'registered', 'replacement_ready'].includes(asset.status) && asset.replaces_asset_id);
  const latest = [...assets].reverse().find((asset) => asset.role === 'thumbnail' && !['superseded', 'failed'].includes(asset.status));
  return replacement || latest || {
    asset_id: 'thumbnail_preview',
    relative_path: 'visuals/thumbnail.svg',
    sha256: null,
    status: 'planned'
  };
}

function audioSceneFor(audioProduction, sceneId) {
  const manifest = audioProduction?.audio_manifest || audioProduction?.production?.audio_manifest || audioProduction?.audio_production?.audio_manifest;
  return (manifest?.scenes || []).find((scene) => scene.scene_id === sceneId) || null;
}

function cameraGrammar(studioId, motionCue, index) {
  const cue = String(motionCue || '').toLowerCase();
  if (studioId === 'failure_atlas') {
    return index % 2 === 0
      ? { id: 'forensic_push', zoom_rate: 0.0007, max_zoom: 1.09, pan_x: 'center', pan_y: 'center' }
      : { id: 'load_path_drift', zoom_rate: 0.00045, max_zoom: 1.07, pan_x: 'right', pan_y: 'center' };
  }
  if (studioId === 'history_under_glass') {
    if (/macro|carved|tight crop/i.test(cue)) return { id: 'inscription_macro_push', zoom_rate: 0.00082, max_zoom: 1.12, pan_x: 'center', pan_y: 'upper' };
    if (/lateral|scan/i.test(cue)) return { id: 'archive_lateral_scan', zoom_rate: 0.00044, max_zoom: 1.075, pan_x: index % 2 ? 'left_to_right' : 'right', pan_y: 'center' };
    if (/label|callout|reveal/i.test(cue)) return { id: 'label_reveal_push', zoom_rate: 0.00068, max_zoom: 1.105, pan_x: index % 2 ? 'left' : 'right', pan_y: 'center' };
    return index % 2 === 0
      ? { id: 'museum_reveal', zoom_rate: 0.00066, max_zoom: 1.1, pan_x: 'center', pan_y: 'upper' }
      : { id: 'archive_drift', zoom_rate: 0.00052, max_zoom: 1.085, pan_x: 'left_to_right', pan_y: 'center' };
  }
  if (studioId === 'practical_open_source') {
    return index % 2 === 0
      ? { id: 'terminal_scan', zoom_rate: 0.00025, max_zoom: 1.04, pan_x: 'left_to_right', pan_y: 'center' }
      : { id: 'verification_lock', zoom_rate: 0.0005, max_zoom: 1.065, pan_x: 'center', pan_y: 'lower' };
  }
  return index % 2 === 0
    ? { id: 'expedition_surge', zoom_rate: 0.00075, max_zoom: 1.1, pan_x: 'center', pan_y: 'upper' }
    : { id: 'map_glide', zoom_rate: 0.00045, max_zoom: 1.07, pan_x: 'right', pan_y: 'lower' };
}

function transitionGrammar(studioId, sceneIndex, sceneCount) {
  if (sceneIndex === 0) return { id: 'identity_open', fade_in_seconds: 0.45, fade_out_seconds: 0.18 };
  if (sceneIndex === sceneCount - 1) return { id: 'identity_resolve', fade_in_seconds: 0.18, fade_out_seconds: 0.65 };
  return {
    id: studioId === 'practical_open_source' ? 'precision_cut'
      : studioId === 'history_under_glass' ? 'gallery_dissolve'
        : studioId === 'failure_atlas' ? 'evidence_cut' : 'mission_wipe',
    fade_in_seconds: 0.16,
    fade_out_seconds: 0.16
  };
}

function splitCaptionText(text, maxWords = 8) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let index = 0; index < words.length; index += maxWords) chunks.push(words.slice(index, index + maxWords).join(' '));
  return chunks.length ? chunks : [''];
}
function srtTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function buildCaptions(renderPlan) {
  let cursor = 0;
  let cueIndex = 1;
  const cues = [];
  for (const scene of renderPlan.scenes) {
    const chunks = splitCaptionText(scene.caption_text, renderPlan.caption_policy.max_words_per_cue);
    const usable = Math.max(0.4, scene.duration_seconds - 0.24);
    const slice = usable / Math.max(1, chunks.length);
    chunks.forEach((text, index) => {
      const start = cursor + index * slice + 0.06;
      const end = Math.min(cursor + scene.duration_seconds - 0.06, cursor + (index + 1) * slice);
      cues.push({ index: cueIndex++, scene_id: scene.scene_id, start_seconds: Number(start.toFixed(3)), end_seconds: Number(Math.max(start + 0.2, end).toFixed(3)), text });
    });
    cursor += scene.duration_seconds;
  }
  const srt = cues.map((cue) => `${cue.index}\n${srtTimestamp(cue.start_seconds)} --> ${srtTimestamp(cue.end_seconds)}\n${cue.text}\n`).join('\n');
  return {
    schema: `nichefoundry.caption_track.v${RENDER_SCHEMA_VERSION}`,
    language: renderPlan.caption_policy.language,
    format: 'srt', cue_count: cues.length,
    duration_seconds: Number(cursor.toFixed(3)), cues, srt
  };
}

function buildRenderPlan({ episodeId, studioId, title, scriptPackage, visualPackage, audioProduction, profileId = 'proxy', outputFormat = 'long_form' }) {
  const profile = profileById(profileId);
  const storyScenes = scriptPackage?.scenes || [];
  const visualScenes = visualPackage?.visual_plan?.scene_plans || [];
  const scenes = storyScenes.map((story, index) => {
    const visual = visualScenes.find((item) => item.scene_id === story.scene_id);
    const audio = audioSceneFor(audioProduction, story.scene_id);
    if (!visual) throw new Error(`Visual plan is missing scene ${story.scene_id}.`);
    if (!audio?.target_audio && !audio?.scene_mix_wav) throw new Error(`Audio production is missing scene ${story.scene_id}.`);
    const visualAsset = activeVisualAsset(visualPackage, visual);
    const duration = Number(audio.resolved_duration_seconds || audio.probe?.duration_seconds || story.estimated_duration_seconds || 5);
    const camera = cameraGrammar(studioId, visual.motion_cue, index);
    const transition = transitionGrammar(studioId, index, storyScenes.length);
    return {
      scene_id: story.scene_id,
      scene_index: index,
      story_beat: story.story_beat || story.beat_name || visual.beat_name,
      title: story.title || visual.title,
      caption_text: story.narration || audio.narration_text || '',
      duration_seconds: Number(Math.max(0.8, duration).toFixed(3)),
      visual_asset_id: visualAsset.asset_id,
      visual_path: safeRelative(visualAsset.relative_path || visual.preview_path),
      visual_sha256: visualAsset.sha256 || null,
      audio_path: safeRelative(audio.target_audio || audio.scene_mix_wav),
      audio_sha256: audio.sha256 || null,
      composition: visual.composition,
      camera,
      transition,
      claim_ids: story.claim_ids || visual.claim_ids || [],
      source_ids: story.source_ids || visual.source_ids || []
    };
  });
  const plan = {
    schema: `nichefoundry.render_plan.v${RENDER_SCHEMA_VERSION}`,
    episode_id: episodeId,
    studio_id: studioId,
    title,
    output_format: outputFormat,
    profile,
    caption_policy: {
      language: 'en', max_words_per_cue: 8, minimum_cue_seconds: 0.7,
      delivery: 'sidecar_srt_and_embedded_mov_text', burn_in_proxy: false
    },
    visual_asset_manifest: visualPackage?.asset_manifest || { assets: [] },
    scenes,
    total_duration_seconds: Number(scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0).toFixed(3)),
    plan_hash: null,
    generated_at: new Date().toISOString()
  };
  plan.plan_hash = hashObject({ episode_id: episodeId, studio_id: studioId, profile, caption_policy: plan.caption_policy, scenes });
  return plan;
}

function validateRenderPlan(plan) {
  const issues = [];
  const warnings = [];
  if (!plan?.episode_id) issues.push('episode_id is required.');
  if (!plan?.studio_id) issues.push('studio_id is required.');
  if (!(plan?.scenes || []).length) issues.push('Render plan has no scenes.');
  const ids = new Set();
  for (const scene of plan?.scenes || []) {
    if (!scene.scene_id) issues.push('A render scene has no scene_id.');
    if (ids.has(scene.scene_id)) issues.push(`Duplicate render scene ${scene.scene_id}.`);
    ids.add(scene.scene_id);
    if (!scene.visual_path) issues.push(`Scene ${scene.scene_id} has no visual path.`);
    if (!scene.audio_path) issues.push(`Scene ${scene.scene_id} has no audio path.`);
    if (!(scene.duration_seconds > 0)) issues.push(`Scene ${scene.scene_id} has no positive duration.`);
    if (!scene.caption_text) warnings.push(`Scene ${scene.scene_id} has no caption text.`);
  }
  return { passed: issues.length === 0, issues, warnings, scene_count: plan?.scenes?.length || 0, checked_at: new Date().toISOString() };
}

function imageProbe(filePath) {
  const result = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'json', filePath]);
  const parsed = JSON.parse(result.stdout || '{}');
  return parsed.streams?.[0] || null;
}
function videoProbe(filePath) {
  const result = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', filePath]);
  const parsed = JSON.parse(result.stdout || '{}');
  return {
    duration_seconds: Number(Number(parsed.format?.duration || 0).toFixed(3)),
    size_bytes: Number(parsed.format?.size || 0),
    bit_rate: Number(parsed.format?.bit_rate || 0),
    streams: parsed.streams || []
  };
}

function materializeVisual(episodeDir, scene, profile, renderDir) {
  const source = resolveInside(episodeDir, scene.visual_path);
  if (!fs.existsSync(source)) throw new Error(`Visual file does not exist: ${scene.visual_path}`);
  const ext = path.extname(source).toLowerCase();
  if (!['.svg', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error(`Unsupported visual format: ${ext}`);
  if (ext !== '.svg') return source;
  const png = path.join(renderDir, 'materialized', `${String(scene.scene_index + 1).padStart(3, '0')}_${scene.scene_id}_${profile.width}x${profile.height}.png`);
  ensureDir(path.dirname(png));
  const fingerprint = hashObject({ source: fileHash(source), width: profile.width, height: profile.height });
  const metaPath = `${png}.json`;
  const prior = readJson(metaPath, {});
  if (fs.existsSync(png) && prior.fingerprint === fingerprint) return png;
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', source, '-vf', `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`, '-frames:v', '1', '-update', '1', png]);
  writeJson(metaPath, { fingerprint, source: scene.visual_path, generated_at: new Date().toISOString() });
  return png;
}

function panExpression(mode, axis, dimension, zoomDimension) {
  if (axis === 'x') {
    if (mode === 'right') return `max(0,iw-iw/zoom)`;
    if (mode === 'left') return '0';
    if (mode === 'left_to_right') return `min(max(0,iw-iw/zoom),on*0.35)`;
    return `(iw-iw/zoom)/2`;
  }
  if (mode === 'upper') return '0';
  if (mode === 'lower') return `max(0,ih-ih/zoom)`;
  return `(ih-ih/zoom)/2`;
}

function segmentFingerprint(episodeDir, scene, profile) {
  const visual = resolveInside(episodeDir, scene.visual_path);
  const audio = resolveInside(episodeDir, scene.audio_path);
  return hashObject({
    scene: { ...scene, visual_sha256: fs.existsSync(visual) ? fileHash(visual) : null, audio_sha256: fs.existsSync(audio) ? fileHash(audio) : null },
    profile
  });
}

function renderSceneSegment({ episodeDir, renderDir, scene, profile, force = false }) {
  const audioPath = resolveInside(episodeDir, scene.audio_path);
  if (!fs.existsSync(audioPath)) throw new Error(`Audio file does not exist: ${scene.audio_path}`);
  const imagePath = materializeVisual(episodeDir, scene, profile, renderDir);
  const segmentsDir = path.join(renderDir, 'segments', profile.id);
  ensureDir(segmentsDir);
  const output = path.join(segmentsDir, `${String(scene.scene_index + 1).padStart(3, '0')}_${scene.scene_id}.mp4`);
  const metadataPath = `${output}.json`;
  const fingerprint = segmentFingerprint(episodeDir, scene, profile);
  const prior = readJson(metadataPath, {});
  if (!force && fs.existsSync(output) && prior.fingerprint === fingerprint) {
    return { ...prior, output_path: path.relative(episodeDir, output), cache_hit: true, fingerprint };
  }
  const frames = Math.max(1, Math.ceil(scene.duration_seconds * profile.fps));
  const z = `min(zoom+${scene.camera.zoom_rate},${scene.camera.max_zoom})`;
  const x = panExpression(scene.camera.pan_x, 'x');
  const y = panExpression(scene.camera.pan_y, 'y');
  const fadeOutStart = Math.max(0, scene.duration_seconds - Number(scene.transition.fade_out_seconds || 0.16));
  const filter = [
    `scale=${Math.ceil(profile.width * 1.12)}:${Math.ceil(profile.height * 1.12)}:force_original_aspect_ratio=increase`,
    `crop=${Math.ceil(profile.width * 1.12)}:${Math.ceil(profile.height * 1.12)}`,
    `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${profile.width}x${profile.height}:fps=${profile.fps}`,
    `fade=t=in:st=0:d=${scene.transition.fade_in_seconds || 0.16}`,
    `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${scene.transition.fade_out_seconds || 0.16}`,
    'format=yuv420p'
  ].join(',');
  run('ffmpeg', [
    '-y', '-loglevel', 'error', '-loop', '1', '-i', imagePath, '-i', audioPath,
    '-vf', filter, '-map', '0:v:0', '-map', '1:a:0', '-t', String(scene.duration_seconds),
    '-r', String(profile.fps), '-c:v', 'libx264', '-preset', profile.preset, '-crf', String(profile.crf),
    '-c:a', 'aac', '-b:a', profile.audio_bitrate, '-ar', '48000', '-ac', '2', '-movflags', '+faststart', output
  ]);
  const probe = videoProbe(output);
  const record = {
    scene_id: scene.scene_id, scene_index: scene.scene_index, output_path: path.relative(episodeDir, output),
    fingerprint, cache_hit: false, sha256: fileHash(output), size_bytes: fs.statSync(output).size,
    probe, camera: scene.camera, transition: scene.transition, generated_at: new Date().toISOString()
  };
  writeJson(metadataPath, record);
  return record;
}

function concatSegments(episodeDir, renderDir, profile, segmentRecords, captionsPath, outputPath) {
  const listPath = path.join(renderDir, `concat_${profile.id}.txt`);
  fs.writeFileSync(listPath, segmentRecords.map((record) => `file '${resolveInside(episodeDir, record.output_path).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const basePath = path.join(renderDir, `${profile.id}_base.mp4`);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', basePath]);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', basePath, '-i', captionsPath,
    '-map', '0:v:0', '-map', '0:a:0', '-map', '1:0', '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text',
    '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English', '-movflags', '+faststart', outputPath]);
  return { base_path: basePath, concat_list_path: listPath };
}

function detectBlackFrames(filePath) {
  const result = run('ffmpeg', ['-hide_banner', '-nostats', '-i', filePath, '-vf', 'blackdetect=d=0.5:pix_th=0.10', '-an', '-f', 'null', '-'], { timeout: 180000 });
  const matches = [...String(result.stderr || '').matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)];
  return matches.map((match) => ({ start_seconds: Number(match[1]), end_seconds: Number(match[2]), duration_seconds: Number(match[3]) }));
}

function verifyCaptionTrack(track, videoDuration) {
  const issues = [];
  let previousEnd = 0;
  for (const cue of track.cues || []) {
    if (!(cue.end_seconds > cue.start_seconds)) issues.push(`Caption cue ${cue.index} has invalid timing.`);
    if (cue.start_seconds < previousEnd - 0.01) issues.push(`Caption cue ${cue.index} overlaps the previous cue.`);
    if (cue.end_seconds > videoDuration + 0.25) issues.push(`Caption cue ${cue.index} exceeds the programme duration.`);
    previousEnd = cue.end_seconds;
  }
  return { passed: issues.length === 0, issues, cue_count: track.cues?.length || 0, final_cue_end_seconds: previousEnd };
}

function renderEpisode({ episodeDir, renderPlan, force = false, sceneIds = null }) {
  if (!commandExists('ffmpeg') || !commandExists('ffprobe')) throw new Error('FFmpeg and FFprobe are required for rendering.');
  const validation = validateRenderPlan(renderPlan);
  if (!validation.passed) throw new Error(`Render plan is invalid: ${validation.issues.join(' ')}`);
  const profile = renderPlan.profile;
  const renderDir = path.join(episodeDir, 'renders');
  ensureDir(renderDir);
  const selected = sceneIds ? new Set(sceneIds) : null;
  const segmentRecords = [];
  for (const scene of renderPlan.scenes) {
    const shouldForce = force || Boolean(selected?.has(scene.scene_id));
    segmentRecords.push(renderSceneSegment({ episodeDir, renderDir, scene, profile, force: shouldForce }));
  }
  const captions = buildCaptions(renderPlan);
  const captionsPath = path.join(episodeDir, profile.id.includes('vertical') ? 'captions_vertical.srt' : 'captions.srt');
  fs.writeFileSync(captionsPath, captions.srt);
  const outputName = profile.id === 'final' ? 'final.mp4'
    : profile.id === 'proxy' ? 'proxy.mp4'
      : profile.id === 'vertical_final' ? 'final_vertical.mp4' : 'proxy_vertical.mp4';
  const outputPath = path.join(episodeDir, outputName);
  concatSegments(episodeDir, renderDir, profile, segmentRecords, captionsPath, outputPath);
  const thumbnailAsset = activeThumbnailAsset({ asset_manifest: renderPlan.visual_asset_manifest });
  const thumbnailSource = resolveInside(episodeDir, thumbnailAsset.relative_path || 'visuals/thumbnail.svg');
  const thumbnailPng = path.join(episodeDir, 'thumbnail.png');
  if (!fs.existsSync(thumbnailSource)) throw new Error(`${thumbnailAsset.relative_path || 'visuals/thumbnail.svg'} is required.`);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', thumbnailSource, '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2', '-frames:v', '1', '-update', '1', thumbnailPng]);
  const probe = videoProbe(outputPath);
  const videoStream = probe.streams.find((stream) => stream.codec_type === 'video');
  const audioStream = probe.streams.find((stream) => stream.codec_type === 'audio');
  const subtitleStream = probe.streams.find((stream) => stream.codec_type === 'subtitle');
  const durationDrift = renderPlan.total_duration_seconds
    ? (probe.duration_seconds - renderPlan.total_duration_seconds) / renderPlan.total_duration_seconds : 0;
  const blackFrames = detectBlackFrames(outputPath);
  const captionVerification = verifyCaptionTrack(captions, probe.duration_seconds);
  const issues = [];
  const warnings = [];
  if (!videoStream) issues.push('Final render has no video stream.');
  if (!audioStream) issues.push('Final render has no audio stream.');
  if (!subtitleStream) issues.push('Final render has no embedded subtitle stream.');
  if (videoStream && (Number(videoStream.width) !== profile.width || Number(videoStream.height) !== profile.height)) issues.push(`Video dimensions are ${videoStream.width}x${videoStream.height}; expected ${profile.width}x${profile.height}.`);
  if (Math.abs(durationDrift) > 0.03) issues.push(`Programme duration drift is ${(durationDrift * 100).toFixed(1)}%.`);
  else if (Math.abs(durationDrift) > 0.015) warnings.push(`Programme duration drift is ${(durationDrift * 100).toFixed(1)}%.`);
  const severeBlackFrames = blackFrames.filter((frame) => frame.duration_seconds > 2.0);
  const reviewBlackFrames = blackFrames.filter((frame) => frame.duration_seconds > 0.8 && frame.duration_seconds <= 2.0);
  if (severeBlackFrames.length) issues.push(`${severeBlackFrames.length} black interval(s) exceed 2.0 seconds.`);
  if (reviewBlackFrames.length) warnings.push(`${reviewBlackFrames.length} black interval(s) exceed 0.8 seconds.`);
  issues.push(...captionVerification.issues);
  const assetRecords = [
    { name: outputName, relative_path: outputName, kind: 'video', sha256: fileHash(outputPath), size_bytes: fs.statSync(outputPath).size },
    { name: path.basename(captionsPath), relative_path: path.basename(captionsPath), kind: 'captions', sha256: fileHash(captionsPath), size_bytes: fs.statSync(captionsPath).size },
    { name: 'thumbnail.png', relative_path: 'thumbnail.png', kind: 'thumbnail', sha256: fileHash(thumbnailPng), size_bytes: fs.statSync(thumbnailPng).size },
    ...segmentRecords.map((segment) => ({ name: `segment:${segment.scene_id}`, relative_path: segment.output_path, kind: 'render_segment', sha256: segment.sha256, size_bytes: segment.size_bytes }))
  ];
  const hashes = {
    schema: `nichefoundry.render_asset_hashes.v${RENDER_SCHEMA_VERSION}`,
    complete: assetRecords.every((asset) => asset.sha256 && asset.size_bytes > 0), assets: assetRecords,
    generated_at: new Date().toISOString()
  };
  const qaReport = {
    schema: `nichefoundry.render_qa_report.v${RENDER_SCHEMA_VERSION}`,
    passed: issues.length === 0,
    profile_id: profile.id,
    output: outputName,
    probe,
    expected_duration_seconds: renderPlan.total_duration_seconds,
    duration_drift_ratio: Number(durationDrift.toFixed(5)),
    scene_count: renderPlan.scenes.length,
    segment_count: segmentRecords.length,
    segment_cache_hits: segmentRecords.filter((record) => record.cache_hit).length,
    embedded_subtitles: Boolean(subtitleStream),
    captions: captionVerification,
    black_intervals: blackFrames,
    thumbnail: { ...imageProbe(thumbnailPng), sha256: fileHash(thumbnailPng) },
    issues, warnings, checked_at: new Date().toISOString()
  };
  const manifest = {
    schema: `nichefoundry.render_manifest.v${RENDER_SCHEMA_VERSION}`,
    episode_id: renderPlan.episode_id,
    studio_id: renderPlan.studio_id,
    profile,
    output: outputName,
    captions: path.basename(captionsPath),
    thumbnail: 'thumbnail.png',
    scenes: renderPlan.scenes.map((scene) => {
      const segment = segmentRecords.find((record) => record.scene_id === scene.scene_id);
      return { ...scene, segment_path: segment.output_path, segment_sha256: segment.sha256, segment_cache_hit: segment.cache_hit };
    }),
    total_duration_seconds: probe.duration_seconds,
    plan_hash: renderPlan.plan_hash,
    generated_at: new Date().toISOString()
  };
  writeJson(path.join(episodeDir, 'render_plan.json'), renderPlan);
  writeJson(path.join(episodeDir, 'caption_track.json'), captions);
  writeJson(path.join(episodeDir, 'render_manifest_v2.json'), manifest);
  writeJson(path.join(episodeDir, 'render_asset_hashes.json'), hashes);
  writeJson(path.join(episodeDir, 'render_qa_report.json'), qaReport);
  return { passed: qaReport.passed, render_plan: renderPlan, caption_track: captions, render_manifest: manifest, render_asset_hashes: hashes, render_qa_report: qaReport };
}

function verifyRenderAssetHashes(episodeDir, hashes) {
  const issues = [];
  const verified = [];
  for (const asset of hashes?.assets || []) {
    let absolute;
    try { absolute = resolveInside(episodeDir, asset.relative_path); }
    catch (error) { issues.push(error.message); continue; }
    if (!fs.existsSync(absolute)) { issues.push(`${asset.relative_path} is missing.`); continue; }
    const current = fileHash(absolute);
    if (current !== asset.sha256) issues.push(`${asset.relative_path} hash does not match.`);
    verified.push({ relative_path: asset.relative_path, sha256: current, matches: current === asset.sha256 });
  }
  return { passed: issues.length === 0 && verified.length === (hashes?.assets || []).length, issues, verified };
}

function renderApprovalBundle(episodeDir) {
  const names = ['render_plan.json', 'caption_track.json', 'render_manifest_v2.json', 'render_asset_hashes.json', 'render_qa_report.json', 'final.mp4', 'captions.srt', 'thumbnail.png'];
  const files = names.map((name) => {
    const absolute = path.join(episodeDir, name);
    return { name, exists: fs.existsSync(absolute), sha256: fs.existsSync(absolute) ? fileHash(absolute) : null, size_bytes: fs.existsSync(absolute) ? fs.statSync(absolute).size : 0 };
  });
  const bundle = { schema: `nichefoundry.render_approval_bundle.v${RENDER_SCHEMA_VERSION}`, complete: files.every((file) => file.exists && file.sha256), files };
  writeJson(path.join(episodeDir, 'render_approval_bundle.json'), bundle);
  return bundle;
}

module.exports = {
  RENDER_SCHEMA_VERSION,
  RENDER_PROFILES,
  buildRenderPlan,
  validateRenderPlan,
  buildCaptions,
  renderEpisode,
  videoProbe,
  verifyRenderAssetHashes,
  renderApprovalBundle,
  cameraGrammar,
  transitionGrammar,
  hashObject,
  fileHash
};
