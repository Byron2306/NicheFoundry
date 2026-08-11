const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SCHEMA_VERSION = '1.0';
const IMAGE_INPUTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff']);
const IMAGE_OUTPUTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff']);
const VIDEO_INPUTS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);
const VIDEO_OUTPUTS = new Set(['.mp4', '.mov', '.mkv', '.webm']);
const AUDIO_INPUTS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg']);

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
function safeRelative(value) {
  const normal = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normal || normal.includes('../') || normal === '..') throw new Error(`Unsafe relative path: ${value}`);
  return normal;
}
function resolveInside(root, relativePath) {
  const relative = safeRelative(relativePath);
  const absolute = path.resolve(root, relative);
  const base = path.resolve(root) + path.sep;
  if (!(absolute + path.sep).startsWith(base) && absolute !== path.resolve(root)) throw new Error(`Path escapes workspace: ${relativePath}`);
  return absolute;
}
function commandExists(command) {
  const result = spawnSync(command, ['-version'], { stdio: 'ignore', timeout: 8000, killSignal: 'SIGKILL' });
  return !result.error && result.status === 0;
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000, killSignal: 'SIGKILL', ...options
  });
  if (result.error) throw new Error(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  return result;
}
function extension(value) {
  return path.extname(String(value || '')).toLowerCase();
}
function positiveInt(value, name, { optional = false } = {}) {
  if ((value == null || value === '') && optional) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer.`);
  return number;
}
function nonNegativeNumber(value, name, { optional = false } = {}) {
  if ((value == null || value === '') && optional) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be a non-negative number.`);
  return number;
}
function boundedNumber(value, name, min, max, { optional = false } = {}) {
  if ((value == null || value === '') && optional) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return number;
}
function imageFilter(operations = {}) {
  const filters = [];
  const width = positiveInt(operations.width, 'width', { optional: true });
  const height = positiveInt(operations.height, 'height', { optional: true });
  const fit = operations.fit || 'contain';
  if (!['contain', 'cover', 'stretch'].includes(fit)) throw new Error(`Unsupported image fit: ${fit}`);
  if (width || height) {
    if (!width || !height) throw new Error('Image resize requires both width and height.');
    if (fit === 'contain') filters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`);
    else if (fit === 'cover') filters.push(`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`);
    else filters.push(`scale=${width}:${height}`);
  }
  const rotate = Number(operations.rotate || 0);
  if (![0, 90, 180, 270].includes(rotate)) throw new Error('rotate must be 0, 90, 180, or 270 degrees.');
  if (rotate === 90) filters.push('transpose=1');
  if (rotate === 180) filters.push('hflip,vflip');
  if (rotate === 270) filters.push('transpose=2');
  if (operations.flip === 'horizontal') filters.push('hflip');
  else if (operations.flip === 'vertical') filters.push('vflip');
  else if (operations.flip && operations.flip !== 'none') throw new Error(`Unsupported flip mode: ${operations.flip}`);
  return filters;
}
function videoScaleFilter(operations = {}) {
  const width = positiveInt(operations.width, 'width', { optional: true });
  const height = positiveInt(operations.height, 'height', { optional: true });
  if (!width && !height) return [];
  if (!width || !height) throw new Error('Video resize requires both width and height.');
  const fit = operations.fit || 'contain';
  if (fit === 'contain') return [`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`];
  if (fit === 'cover') return [`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`];
  if (fit === 'stretch') return [`scale=${width}:${height}`];
  throw new Error(`Unsupported video fit: ${fit}`);
}
function overlayExpression(position = 'bottom_right', margin = 24) {
  const m = positiveInt(margin, 'overlay margin');
  const positions = {
    top_left: `${m}:${m}`,
    top_right: `W-w-${m}:${m}`,
    bottom_left: `${m}:H-h-${m}`,
    bottom_right: `W-w-${m}:H-h-${m}`,
    center: '(W-w)/2:(H-h)/2'
  };
  if (!positions[position]) throw new Error(`Unsupported overlay position: ${position}`);
  return positions[position];
}
function probe(filePath) {
  const result = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', filePath]);
  const parsed = JSON.parse(result.stdout || '{}');
  return {
    duration_seconds: Number(Number(parsed.format?.duration || 0).toFixed(3)),
    size_bytes: Number(parsed.format?.size || 0),
    format_name: parsed.format?.format_name || null,
    streams: parsed.streams || []
  };
}

function buildImagePlan(request) {
  const input = safeRelative(request.input);
  const output = safeRelative(request.output);
  if (!IMAGE_INPUTS.has(extension(input))) throw new Error(`Unsupported image input format: ${extension(input)}`);
  if (!IMAGE_OUTPUTS.has(extension(output))) throw new Error(`Unsupported image output format: ${extension(output)}`);
  const operations = request.operations || {};
  const filters = imageFilter(operations);
  const quality = boundedNumber(operations.quality ?? 90, 'quality', 1, 100);
  return {
    schema: `nichefoundry.media_transform_plan.v${SCHEMA_VERSION}`,
    kind: 'image', input, output, operations: { ...operations, quality }, filters,
    preserve_source: true,
    metadata_policy: operations.strip_metadata === false ? 'preserve_when_supported' : 'strip',
    generated_at: new Date().toISOString()
  };
}

function buildVideoPlan(request) {
  const inputs = (request.inputs || (request.input ? [request.input] : [])).map(safeRelative);
  const output = safeRelative(request.output);
  if (!inputs.length) throw new Error('Video editing requires at least one input.');
  for (const input of inputs) if (!VIDEO_INPUTS.has(extension(input))) throw new Error(`Unsupported video input format: ${extension(input)}`);
  if (!VIDEO_OUTPUTS.has(extension(output))) throw new Error(`Unsupported video output format: ${extension(output)}`);
  const operations = request.operations || {};
  const start = nonNegativeNumber(operations.start_seconds, 'start_seconds', { optional: true });
  const duration = nonNegativeNumber(operations.duration_seconds, 'duration_seconds', { optional: true });
  const fps = boundedNumber(operations.fps, 'fps', 1, 120, { optional: true });
  const volume = boundedNumber(operations.volume ?? 1, 'volume', 0, 8);
  const videoFilters = videoScaleFilter(operations);
  if (operations.rotate) {
    const rotate = Number(operations.rotate);
    if (rotate === 90) videoFilters.push('transpose=1');
    else if (rotate === 180) videoFilters.push('hflip,vflip');
    else if (rotate === 270) videoFilters.push('transpose=2');
    else if (rotate !== 0) throw new Error('rotate must be 0, 90, 180, or 270 degrees.');
  }
  return {
    schema: `nichefoundry.media_transform_plan.v${SCHEMA_VERSION}`,
    kind: 'video', inputs, output,
    operations: { ...operations, start_seconds: start, duration_seconds: duration, fps, volume },
    video_filters: videoFilters,
    preserve_source: true,
    generated_at: new Date().toISOString()
  };
}

function buildTransformPlan(request) {
  if (!request || typeof request !== 'object') throw new Error('A transform request object is required.');
  const kind = String(request.kind || '').toLowerCase();
  const plan = kind === 'image' ? buildImagePlan(request) : kind === 'video' ? buildVideoPlan(request) : null;
  if (!plan) throw new Error(`Unsupported transform kind: ${request.kind}`);
  plan.plan_hash = hashObject({ ...plan, generated_at: undefined, plan_hash: undefined });
  return plan;
}

function executeImagePlan(workspaceDir, plan) {
  if (!commandExists('ffmpeg') || !commandExists('ffprobe')) throw new Error('FFmpeg and FFprobe are required for media transformation.');
  const input = resolveInside(workspaceDir, plan.input);
  const output = resolveInside(workspaceDir, plan.output);
  if (!fs.existsSync(input)) throw new Error(`Input image does not exist: ${plan.input}`);
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing output: ${plan.output}`);
  ensureDir(path.dirname(output));
  const args = ['-y', '-loglevel', 'error', '-i', input];
  if (plan.filters.length) args.push('-vf', plan.filters.join(','));
  const ext = extension(output);
  const quality = Number(plan.operations.quality || 90);
  if (['.jpg', '.jpeg'].includes(ext)) args.push('-q:v', String(Math.max(2, Math.min(31, Math.round((101 - quality) / 3.3)))));
  if (ext === '.webp') args.push('-quality', String(quality));
  if (plan.metadata_policy === 'strip') args.push('-map_metadata', '-1');
  args.push('-frames:v', '1', output);
  run('ffmpeg', args);
  return { output, probe: probe(output) };
}

function executeVideoPlan(workspaceDir, plan) {
  if (!commandExists('ffmpeg') || !commandExists('ffprobe')) throw new Error('FFmpeg and FFprobe are required for media transformation.');
  const inputs = plan.inputs.map((item) => resolveInside(workspaceDir, item));
  for (const [index, input] of inputs.entries()) if (!fs.existsSync(input)) throw new Error(`Input video does not exist: ${plan.inputs[index]}`);
  const output = resolveInside(workspaceDir, plan.output);
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing output: ${plan.output}`);
  ensureDir(path.dirname(output));
  const operations = plan.operations || {};
  const args = ['-y', '-loglevel', 'error'];
  if (operations.start_seconds != null && inputs.length === 1) args.push('-ss', String(operations.start_seconds));
  for (const input of inputs) args.push('-i', input);
  let externalAudioIndex = null;
  let overlayIndex = null;
  let subtitlePath = null;
  if (operations.replace_audio) {
    const audio = resolveInside(workspaceDir, safeRelative(operations.replace_audio));
    if (!AUDIO_INPUTS.has(extension(audio)) || !fs.existsSync(audio)) throw new Error('Replacement audio must be an existing supported audio file inside the workspace.');
    externalAudioIndex = inputs.length;
    args.push('-i', audio);
  }
  if (operations.overlay_image) {
    const overlay = resolveInside(workspaceDir, safeRelative(operations.overlay_image));
    if (!IMAGE_INPUTS.has(extension(overlay)) || !fs.existsSync(overlay)) throw new Error('Overlay image must be an existing supported image file inside the workspace.');
    overlayIndex = inputs.length + (externalAudioIndex == null ? 0 : 1);
    args.push('-i', overlay);
  }
  if (operations.subtitles) {
    subtitlePath = resolveInside(workspaceDir, safeRelative(operations.subtitles));
    if (!['.srt', '.vtt', '.ass'].includes(extension(subtitlePath)) || !fs.existsSync(subtitlePath)) throw new Error('Subtitles must be an existing SRT, VTT, or ASS file inside the workspace.');
  }
  const filters = [];
  let videoLabel = null;
  if (inputs.length > 1) {
    const concatInputs = inputs.map((_, index) => `[${index}:v:0][${index}:a:0]`).join('');
    filters.push(`${concatInputs}concat=n=${inputs.length}:v=1:a=1[vcat][acat]`);
    videoLabel = 'vcat';
  }
  const vf = [...plan.video_filters];
  if (operations.fps) vf.push(`fps=${operations.fps}`);
  if (subtitlePath && operations.burn_subtitles !== false) vf.push(`subtitles=${subtitlePath.replace(/:/g, '\\:').replace(/'/g, "\\'")}`);
  if (vf.length) {
    const sourceLabel = videoLabel ? `[${videoLabel}]` : '[0:v:0]';
    filters.push(`${sourceLabel}${vf.join(',')}[vfx]`);
    videoLabel = 'vfx';
  }
  if (overlayIndex != null) {
    const sourceLabel = videoLabel ? `[${videoLabel}]` : '[0:v:0]';
    const expression = overlayExpression(operations.overlay_position || 'bottom_right', operations.overlay_margin || 24);
    filters.push(`${sourceLabel}[${overlayIndex}:v:0]overlay=${expression}[vout]`);
    videoLabel = 'vout';
  }
  if (filters.length) args.push('-filter_complex', filters.join(';'));
  if (videoLabel) args.push('-map', `[${videoLabel}]`);
  else args.push('-map', '0:v:0');
  if (operations.mute) {
    args.push('-an');
  } else if (externalAudioIndex != null) {
    args.push('-map', `${externalAudioIndex}:a:0`);
  } else if (inputs.length > 1) {
    if (Number(operations.volume ?? 1) !== 1) {
      const existing = args.indexOf('-filter_complex');
      const current = existing >= 0 ? args[existing + 1] : '';
      const next = [current, `[acat]volume=${operations.volume}[aout]`].filter(Boolean).join(';');
      if (existing >= 0) args[existing + 1] = next;
      else args.push('-filter_complex', next);
      args.push('-map', '[aout]');
    } else args.push('-map', '[acat]');
  } else {
    if (Number(operations.volume ?? 1) !== 1) args.push('-af', `volume=${operations.volume}`);
    args.push('-map', '0:a?');
  }
  if (operations.duration_seconds != null && inputs.length === 1) args.push('-t', String(operations.duration_seconds));
  args.push('-c:v', operations.video_codec || 'libx264', '-preset', operations.preset || 'medium', '-crf', String(operations.crf ?? 20));
  if (!operations.mute) args.push('-c:a', operations.audio_codec || 'aac', '-b:a', operations.audio_bitrate || '192k');
  if (extension(output) === '.mp4' || extension(output) === '.mov') args.push('-movflags', '+faststart');
  args.push(output);
  run('ffmpeg', args);
  return { output, probe: probe(output) };
}

function executeTransform({ workspaceDir, request, dryRun = false }) {
  const root = path.resolve(workspaceDir);
  const plan = buildTransformPlan(request);
  const inputPaths = plan.kind === 'image' ? [plan.input] : plan.inputs;
  const inputRecords = inputPaths.map((relativePath) => {
    const absolutePath = resolveInside(root, relativePath);
    return {
      relative_path: relativePath,
      exists: fs.existsSync(absolutePath),
      sha256: fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile() ? fileHash(absolutePath) : null
    };
  });
  if (dryRun) return { plan, inputs: inputRecords, dry_run: true };
  if (inputRecords.some((item) => !item.exists)) throw new Error('One or more transform inputs do not exist.');
  const result = plan.kind === 'image' ? executeImagePlan(root, plan) : executeVideoPlan(root, plan);
  const receipt = {
    schema: `nichefoundry.media_transform_receipt.v${SCHEMA_VERSION}`,
    status: 'complete',
    kind: plan.kind,
    plan_hash: plan.plan_hash,
    source_assets: inputRecords,
    output: {
      relative_path: path.relative(root, result.output).replaceAll('\\', '/'),
      sha256: fileHash(result.output),
      size_bytes: fs.statSync(result.output).size,
      probe: result.probe
    },
    preserve_source: true,
    completed_at: new Date().toISOString()
  };
  const receiptPath = `${result.output}.receipt.json`;
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { plan, receipt, receipt_path: path.relative(root, receiptPath).replaceAll('\\', '/') };
}

module.exports = {
  IMAGE_INPUTS,
  IMAGE_OUTPUTS,
  VIDEO_INPUTS,
  VIDEO_OUTPUTS,
  AUDIO_INPUTS,
  buildTransformPlan,
  executeTransform,
  safeRelative,
  resolveInside,
  overlayExpression,
  hashObject
};
