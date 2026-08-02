const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeRelative(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized === '..' || normalized.includes('../')) throw new Error(`Unsafe relative path: ${value}`);
  return normalized;
}

function safeResolve(root, relativePath) {
  const relative = safeRelative(relativePath);
  const absolute = path.resolve(root, relative);
  const base = `${path.resolve(root)}${path.sep}`;
  if (!(absolute + path.sep).startsWith(base) && absolute !== path.resolve(root)) throw new Error(`Path escapes root: ${relativePath}`);
  return absolute;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300000,
    killSignal: 'SIGKILL',
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  return result;
}

function normalizeGammaImage(sourceFile, targetFile) {
  ensureDir(path.dirname(targetFile));
  const script = `
from PIL import Image, ImageFilter, ImageEnhance, ImageOps, ImageChops
import sys, math

source, target = sys.argv[1], sys.argv[2]
image = Image.open(source).convert('RGB')
width, height = image.size
sample_step = max(1, height // 120)

def blank_column(x):
    total = 0
    blank = 0
    for y in range(0, height, sample_step):
        total += 1
        r, g, b = image.getpixel((x, y))
        if r > 246 and g > 246 and b > 246:
            blank += 1
    return blank / max(1, total)

def blank_row(y):
    total = 0
    blank = 0
    row_step = max(1, width // 160)
    for x in range(0, width, row_step):
        total += 1
        r, g, b = image.getpixel((x, y))
        if r > 246 and g > 246 and b > 246:
            blank += 1
    return blank / max(1, total)

left = 0
while left < width and blank_column(left) >= 0.985:
    left += 1
right = width - 1
while right > left and blank_column(right) >= 0.985:
    right -= 1
top = 0
while top < height and blank_row(top) >= 0.985:
    top += 1
bottom = height - 1
while bottom > top and blank_row(bottom) >= 0.985:
    bottom -= 1

trimmed = image.crop((left, top, right + 1, bottom + 1))
trimmed_width, trimmed_height = trimmed.size
pixels = trimmed.load()
xs = []
ys = []
for y in range(trimmed_height):
    for x in range(trimmed_width):
        r, g, b = pixels[x, y]
        brightness = (r + g + b) / 3
        color_span = max(r, g, b) - min(r, g, b)
        if brightness < 240 or color_span > 12:
            xs.append(x)
            ys.append(y)

if xs and ys:
    inner_left, inner_right = min(xs), max(xs)
    inner_top, inner_bottom = min(ys), max(ys)
else:
    inner_left, inner_top, inner_right, inner_bottom = 0, 0, trimmed_width - 1, trimmed_height - 1

content_w = max(1, inner_right - inner_left + 1)
content_h = max(1, inner_bottom - inner_top + 1)
pad_x = max(24, int(content_w * 0.14))
pad_y = max(24, int(content_h * 0.1))

crop_left = max(0, inner_left - pad_x)
crop_top = max(0, inner_top - pad_y)
crop_right = min(trimmed_width, inner_right + pad_x + 1)
crop_bottom = min(trimmed_height, inner_bottom + pad_y + 1)
crop = trimmed.crop((crop_left, crop_top, crop_right, crop_bottom))

target_size = (2400, 1350)
background = ImageOps.fit(crop, target_size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
background = background.filter(ImageFilter.GaussianBlur(radius=26))
background = ImageEnhance.Color(background).enhance(1.55)
background = ImageEnhance.Contrast(background).enhance(1.14)
background = ImageEnhance.Brightness(background).enhance(0.8)

overlay = Image.new('RGB', target_size, (38, 22, 16))
background = Image.blend(background, overlay, 0.16)

foreground = ImageOps.contain(crop, (int(target_size[0] * 0.92), int(target_size[1] * 0.92)), method=Image.Resampling.LANCZOS)
foreground = ImageEnhance.Color(foreground).enhance(1.18)
foreground = ImageEnhance.Contrast(foreground).enhance(1.08)
foreground = ImageEnhance.Sharpness(foreground).enhance(1.12)

shadow = Image.new('RGBA', target_size, (0, 0, 0, 0))
shadow_alpha = Image.new('L', foreground.size, 0)
shadow_alpha.paste(135, (0, 0, foreground.size[0], foreground.size[1]))
shadow_alpha = shadow_alpha.filter(ImageFilter.GaussianBlur(radius=30))
shadow_layer = Image.new('RGBA', foreground.size, (0, 0, 0, 170))
shadow_layer.putalpha(shadow_alpha)

canvas = background.convert('RGBA')
fg_rgba = foreground.convert('RGBA')
offset_x = (target_size[0] - foreground.size[0]) // 2
offset_y = (target_size[1] - foreground.size[1]) // 2
canvas.alpha_composite(shadow_layer, (offset_x + 10, offset_y + 16))
canvas.alpha_composite(fg_rgba, (offset_x, offset_y))

vignette = Image.new('L', target_size, 0)
for y in range(target_size[1]):
    for x in range(target_size[0]):
        dx = (x - target_size[0] / 2) / (target_size[0] / 2)
        dy = (y - target_size[1] / 2) / (target_size[1] / 2)
        distance = math.sqrt(dx * dx + dy * dy)
        strength = max(0.0, min(1.0, (distance - 0.28) / 0.72))
        vignette.putpixel((x, y), int(strength * 140))
vignette = vignette.filter(ImageFilter.GaussianBlur(radius=42))
shade = Image.new('RGBA', target_size, (0, 0, 0, 0))
shade.putalpha(vignette)
canvas.alpha_composite(shade)

ImageEnhance.Contrast(canvas.convert('RGB')).enhance(1.04).save(target, 'PNG')
`;
  run('python3', ['-c', script, sourceFile, targetFile]);
}

function scenePrompt(packet, scenePlan, scriptScene, index) {
  const visualRequirements = (scenePlan.visual_requirements || []).join('; ') || 'Studio-native scene treatment.';
  const palette = packet.visual_identity?.colors
    ? `Palette: background ${packet.visual_identity.colors.background}, surface ${packet.visual_identity.colors.surface}, primary ${packet.visual_identity.colors.primary}, accent ${packet.visual_identity.colors.accent}, secondary ${packet.visual_identity.colors.secondary}.`
    : '';
  const studioId = packet.brief.studio_id;
  const subject = scenePlan.focal_subject || packet.brief.topic;
  const beat = scenePlan.title || `Scene ${index + 1}`;
  const cinematicDirection = studioId === 'history_under_glass'
    ? [
        'Visual mood: museum-grade, atmospheric, elegant, and historically evocative.',
        'Use rich, striking colour with parchment whites, oxidised bronze, deep burgundy, shadowed charcoal, and warm artifact lighting.',
        'Favor one dominant hero visual: the object, inscription, temple fragment, archival document, or map detail should carry the frame.',
        'Include layered depth, dramatic contrast, and tactile surfaces such as stone grain, papyrus, carved relief, dust, gold, linen, or painted wall fragments.',
        'Fill the entire 16:9 frame with image content. Avoid large blank white areas or empty margins.',
        'Do not create a slide, dashboard, lesson handout, infographic board, worksheet, or editorial layout.',
        'Do not use boxed text panels, section cards, bullet lists, or classroom-style callouts.',
        'If text appears at all, keep it to a tiny museum-label amount only, under six words total.'
      ]
    : [
        'Create a vivid, image-led frame with a dominant focal subject and strong thematic atmosphere.',
        'Use bold colour, depth, lighting, and environmental storytelling rather than boxy layouts or text panels.',
        'Do not create a slide, dashboard, worksheet, or infographic.',
        'If text appears at all, keep it extremely sparse and secondary to the image.'
      ];
  const sceneSpecific = [];
  const normalizedTitle = String(beat).toLowerCase();
  if (studioId === 'history_under_glass') {
    if (normalizedTitle.includes('hook')) {
      sceneSpecific.push('Compose a dramatic opening hero shot of the artifact under focused museum lighting, with deep shadow, glowing carved detail, and a sense of mystery.');
      sceneSpecific.push('The object should dominate the frame and feel precious, ancient, and cinematic.');
    } else if (normalizedTitle.includes('object reveal')) {
      sceneSpecific.push('Use macro detail, raking light, inscription texture, and subtle surrounding exhibit context rather than explanatory panels.');
    } else if (normalizedTitle.includes('materials')) {
      sceneSpecific.push('Show materiality vividly: chipped stone, polish, grain, carved incisions, dust, and geological character with rich colour separation.');
    } else if (normalizedTitle.includes('original use')) {
      sceneSpecific.push('Visualize the object in a plausible temple or priestly setting with dramatic architecture, torchlight or sunlit stone, and strong sense of place.');
      sceneSpecific.push('Prioritize atmosphere and reconstruction over explanatory text.');
    } else if (normalizedTitle.includes('human context')) {
      sceneSpecific.push('Show people, ritual, scholarship, or institutions around the object in a visually cinematic way, not as labels.');
    } else if (normalizedTitle.includes('survival') || normalizedTitle.includes('discovery')) {
      sceneSpecific.push('Use a discovery or transport scene with layered storytelling, movement, dust, map textures, or excavation atmosphere.');
    } else if (normalizedTitle.includes('historical meaning')) {
      sceneSpecific.push('Present the object as a key to interpretation through symbolic imagery, layered scripts, or dramatic scholarly context rather than text blocks.');
    } else if (normalizedTitle.includes('conclusion')) {
      sceneSpecific.push('Do not produce a summary page.');
      sceneSpecific.push('Create a powerful closing image: the Rosetta Stone as an illuminated final hero object, surrounded by subtle thematic echoes of temple, script, empire, and scholarship.');
      sceneSpecific.push('The closing frame should feel like the end of a documentary, not a presentation summary.');
      sceneSpecific.push('Use no visible prose paragraphs.');
    }
  }
  const lines = [
    `Scene ${index + 1}: ${scenePlan.title}`,
    `Topic: ${packet.brief.topic}`,
    `Studio: ${packet.visual_identity?.studio_name || packet.brief.studio_id}`,
    `Beat: ${beat}`,
    `Focus: ${subject}`,
    `Narration context: ${scriptScene?.narration || ''}`,
    `Evidence focus: ${scenePlan.evidence_overlay || ''}`,
    `Visual requirements: ${visualRequirements}`,
    palette,
    ...cinematicDirection,
    ...sceneSpecific,
    `Make the composition visually distinct from the other scenes while staying faithful to ${subject}.`,
    'The image should feel like a finished video frame or key art still, not a document page.',
    'Avoid placeholders, generic templates, stock-photo feel, unrelated people, unrelated brands, or off-theme visuals.'
  ];
  return lines.join('\n');
}

function thumbnailPrompt(packet) {
  const selected = packet.thumbnail_plan?.candidates?.find((item) => item.candidate_id === packet.thumbnail_plan?.selected_candidate)
    || packet.thumbnail_plan?.candidates?.[0]
    || {};
  return [
    `Thumbnail for: ${packet.episode.title}`,
    `Topic: ${packet.brief.topic}`,
    `Studio: ${packet.visual_identity?.studio_name || packet.brief.studio_id}`,
    `Headline intent: ${selected.text || packet.episode.title}`,
    `Emotional promise: ${selected.emotional_promise || 'high curiosity and strong thematic clarity'}`,
    'Create one striking 16:9 YouTube thumbnail image.',
    'Use bold composition, strong subject separation, rich colour, dramatic lighting, and unmistakably thematic imagery.',
    'For history_under_glass, lean into artifact drama, Egyptian materials, stone texture, museum lighting, gold-burgundy contrast, and cinematic mystery.',
    'Prefer one unforgettable hero image over multiple text boxes.',
    'Fill the full frame. Avoid blank white background and avoid slide composition.',
    'If text appears, use at most two short words. Prefer zero text.',
    'Do not make it look like a template card, dashboard, worksheet, document slide, or reading page.'
  ].join('\n');
}

function buildGammaStoryboardRequest(packet) {
  const scriptScenes = packet.script_package?.scenes || [];
  const scenePlans = packet.visual_plan?.scene_plans || [];
  const pages = scenePlans.map((scenePlan, index) => {
    const scriptScene = scriptScenes.find((entry) => entry.scene_id === scenePlan.scene_id) || null;
    return {
      title: `${String(index + 1).padStart(2, '0')} ${scenePlan.title}`,
      inputText: scenePrompt(packet, scenePlan, scriptScene, index),
      textMode: 'generate',
      format: 'presentation',
      numCards: 1,
      cardSplit: 'auto',
      additionalInstructions: `Produce a cinematic single-frame scene for ${packet.brief.studio_id}. Respect a 16:9 composition. Make the frame image-dominant, visually striking, colorful, thematic, and suitable for direct use in a video edit. Avoid slide layouts and avoid multi-panel explainer boards unless the scene absolutely demands it.`
    };
  });
  pages.push({
    title: 'Thumbnail',
    inputText: thumbnailPrompt(packet),
    textMode: 'generate',
    format: 'presentation',
    numCards: 1,
    cardSplit: 'auto',
    additionalInstructions: `Create a high-contrast YouTube thumbnail for ${packet.brief.studio_id}. Prioritize clarity at small sizes, strong visual hierarchy, bright thematic contrast, and a compelling hero subject. Avoid making it look like a slide or reading page.`
  });
  const body = {
    title: packet.episode.title,
    exportAs: 'png',
    format: 'presentation',
    pages
  };
  if (process.env.GAMMA_THEME_ID) body.themeId = process.env.GAMMA_THEME_ID;
  return body;
}

function gammaSinglePageRequests(packet) {
  const request = buildGammaStoryboardRequest(packet);
  return (request.pages || []).map((page, index) => ({
    type: index === (request.pages.length - 1) ? 'thumbnail' : 'scene',
    title: page.title,
    body: {
      title: `${packet.episode.title} ${page.title}`,
      exportAs: 'png',
      format: 'presentation',
      textMode: page.textMode || 'preserve',
      inputText: page.inputText,
      numCards: 1,
      cardSplit: page.cardSplit || 'auto',
      additionalInstructions: page.additionalInstructions || ''
    }
  })).map((entry) => {
    if (process.env.GAMMA_THEME_ID) entry.body.themeId = process.env.GAMMA_THEME_ID;
    return entry;
  });
}

async function gammaFetch(url, { apiKey, method = 'GET', body = null } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; }
  catch (_error) { json = { raw: text }; }
  if (!response.ok) {
    const message = json?.error?.message || json?.message || text || `Gamma request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

async function pollGammaGeneration({ apiKey, generationId, maxAttempts = 48, delayMs = 5000 }) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await gammaFetch(`https://public-api.gamma.app/v1.0/generations/${encodeURIComponent(generationId)}`, { apiKey });
    if (status?.status === 'completed') return status;
    if (status?.status === 'failed') {
      const message = status?.error?.message || 'Gamma generation failed.';
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Gamma generation ${generationId} did not complete after ${Math.round((maxAttempts * delayMs) / 1000)} seconds.`);
}

function extractZip(zipPath, outputDir) {
  ensureDir(outputDir);
  run('python3', ['-m', 'zipfile', '-e', zipPath, outputDir]);
}

function detectGammaExportKind(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'zip';
  return 'unknown';
}

function registerAsset(packet, episodeDir, asset) {
  packet.asset_manifest = packet.asset_manifest || { schema: 'nichefoundry.asset_manifest.v1.0', episode_id: packet.episode.episode_id, assets: [] };
  packet.asset_provenance = packet.asset_provenance || { schema: 'nichefoundry.asset_provenance.v1.0', episode_id: packet.episode.episode_id, records: [] };
  packet.visual_asset_hashes = packet.visual_asset_hashes || { schema: 'nichefoundry.visual_asset_hashes.v1.0', episode_id: packet.episode.episode_id, assets: [] };
  const absolutePath = safeResolve(episodeDir, asset.relative_path);
  asset.size_bytes = fs.statSync(absolutePath).size;
  asset.sha256 = hashFile(absolutePath);
  if (asset.replaces_asset_id) {
    const replaced = packet.asset_manifest.assets.find((entry) => entry.asset_id === asset.replaces_asset_id);
    if (replaced) replaced.status = 'superseded';
  }
  packet.asset_manifest.assets = packet.asset_manifest.assets.filter((entry) => entry.asset_id !== asset.asset_id);
  packet.asset_manifest.assets.push(asset);
  packet.asset_provenance.records = packet.asset_provenance.records.filter((entry) => entry.asset_id !== asset.asset_id);
  packet.asset_provenance.records.push({ ...asset, file_sha256: asset.sha256 });
  packet.visual_asset_hashes.assets = packet.visual_asset_hashes.assets.filter((entry) => entry.asset_id !== asset.asset_id);
  packet.visual_asset_hashes.assets.push({
    asset_id: asset.asset_id,
    relative_path: asset.relative_path,
    exists: true,
    size_bytes: asset.size_bytes,
    sha256: asset.sha256
  });
}

function refreshVisualReport(packet) {
  const unresolved = (packet.asset_manifest?.assets || []).filter((entry) => entry.rights_status !== 'cleared');
  packet.visual_report = packet.visual_report || { issues: [], gates: {} };
  packet.visual_report.asset_count = packet.asset_manifest?.assets?.length || 0;
  packet.visual_report.cleared_rights_count = packet.visual_report.asset_count - unresolved.length;
  packet.visual_report.unresolved_rights_count = unresolved.length;
  packet.visual_report.gates = {
    ...(packet.visual_report.gates || {}),
    rights_and_provenance: unresolved.length === 0
  };
  packet.visual_report.issues = (packet.visual_report.issues || []).filter((entry) => !entry.includes('asset(s) have unresolved rights.'));
  if (unresolved.length) packet.visual_report.issues.push(`${unresolved.length} asset(s) have unresolved rights.`);
  packet.visual_report.passed = Object.values(packet.visual_report.gates || {}).every(Boolean) && packet.visual_report.issues.length === 0;
  packet.visual_asset_hashes.complete = (packet.visual_asset_hashes.assets || []).every((entry) => entry.exists && entry.sha256);
}

function sortedPngs(rootDir) {
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(rootDir, entry.name);
      if (entry.isDirectory()) return sortedPngs(absolute);
      if (/\.png$/i.test(entry.name)) return [absolute];
      return [];
    })
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
}

async function downloadGammaExportFile(exportUrl, targetPrefix) {
  const response = await fetch(exportUrl);
  if (!response.ok) throw new Error(`Gamma export download failed with HTTP ${response.status}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const kind = detectGammaExportKind(buffer);
  if (kind === 'png') {
    const outputPath = `${targetPrefix}.png`;
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, buffer);
    return { kind, files: [outputPath] };
  }
  if (kind === 'zip') {
    const zipPath = `${targetPrefix}.zip`;
    const extractDir = `${targetPrefix}_unzipped`;
    ensureDir(path.dirname(zipPath));
    fs.writeFileSync(zipPath, buffer);
    extractZip(zipPath, extractDir);
    return { kind, files: sortedPngs(extractDir), zip_path: zipPath, extract_dir: extractDir };
  }
  const sample = buffer.subarray(0, 120).toString('utf8').replace(/\s+/g, ' ').trim();
  throw new Error(`Gamma export was neither PNG nor ZIP. First bytes: ${sample}`);
}

function promoteGammaSceneAsset(packet, episodeDir, scenePlan, sourceFile, index) {
  const relativePath = path.posix.join('imports/visuals', `${String(index + 1).padStart(2, '0')}_${scenePlan.scene_id}_gamma.png`);
  const absolutePath = safeResolve(episodeDir, relativePath);
  normalizeGammaImage(sourceFile, absolutePath);
  const asset = {
    asset_id: `gamma_${scenePlan.scene_id}`,
    episode_id: packet.episode.episode_id,
    scene_id: scenePlan.scene_id,
    asset_type: 'imported_scene_asset',
    media_type: 'image/png',
    relative_path: relativePath,
    role: 'scene_replacement',
    status: 'replacement_ready',
    generated_by: 'gamma_public_api',
    creator: 'Gamma',
    publisher: 'Gamma',
    source_url: null,
    licence: 'project_owned_generated_asset',
    rights_status: 'cleared',
    synthetic: true,
    disclosure_required: false,
    source_ids: scenePlan.source_ids || [],
    claim_ids: scenePlan.claim_ids || [],
    replaces_asset_id: scenePlan.preview_asset_id,
    created_at: new Date().toISOString()
  };
  registerAsset(packet, episodeDir, asset);
  return { scene_id: scenePlan.scene_id, relative_path: relativePath, asset_id: asset.asset_id };
}

function promoteGammaThumbnailAsset(packet, episodeDir, sourceFile) {
  const relativePath = 'imports/visuals/thumbnail_gamma.png';
  const absolutePath = safeResolve(episodeDir, relativePath);
  normalizeGammaImage(sourceFile, absolutePath);
  const thumbnailPreview = (packet.asset_manifest?.assets || []).find((entry) => entry.asset_type === 'thumbnail_preview' || entry.role === 'thumbnail');
  const asset = {
    asset_id: 'gamma_thumbnail',
    episode_id: packet.episode.episode_id,
    scene_id: null,
    asset_type: 'thumbnail_replacement',
    media_type: 'image/png',
    relative_path: relativePath,
    role: 'thumbnail',
    status: 'replacement_ready',
    generated_by: 'gamma_public_api',
    creator: 'Gamma',
    publisher: 'Gamma',
    source_url: null,
    licence: 'project_owned_generated_asset',
    rights_status: 'cleared',
    synthetic: true,
    disclosure_required: false,
    source_ids: [],
    claim_ids: [],
    replaces_asset_id: thumbnailPreview?.asset_id || null,
    created_at: new Date().toISOString()
  };
  registerAsset(packet, episodeDir, asset);
  return relativePath;
}

function applyGammaExportsToEpisode(packet, episodeDir, extractedDir) {
  const pngs = sortedPngs(extractedDir);
  const scenePlans = packet.visual_plan?.scene_plans || [];
  const expected = scenePlans.length + 1;
  if (pngs.length < expected) throw new Error(`Gamma exported ${pngs.length} PNG files; expected at least ${expected}.`);
  const importsDir = path.join(episodeDir, 'imports', 'visuals');
  ensureDir(importsDir);
  const imported = [];
  scenePlans.forEach((scenePlan, index) => {
    const source = pngs[index];
    const relativePath = path.posix.join('imports/visuals', `${String(index + 1).padStart(2, '0')}_${scenePlan.scene_id}_gamma.png`);
    const target = safeResolve(episodeDir, relativePath);
    normalizeGammaImage(source, target);
    const asset = {
      asset_id: `gamma_${scenePlan.scene_id}`,
      episode_id: packet.episode.episode_id,
      scene_id: scenePlan.scene_id,
      asset_type: 'imported_scene_asset',
      media_type: 'image/png',
      relative_path: relativePath,
      role: 'scene_replacement',
      status: 'replacement_ready',
      generated_by: 'gamma_public_api',
      creator: 'Gamma',
      publisher: 'Gamma',
      source_url: null,
      licence: 'project_owned_generated_asset',
      rights_status: 'cleared',
      synthetic: true,
      disclosure_required: false,
      source_ids: scenePlan.source_ids || [],
      claim_ids: scenePlan.claim_ids || [],
      replaces_asset_id: scenePlan.preview_asset_id,
      created_at: new Date().toISOString()
    };
    registerAsset(packet, episodeDir, asset);
    imported.push({ scene_id: scenePlan.scene_id, relative_path: relativePath, asset_id: asset.asset_id });
  });
  const thumbnailSource = pngs[scenePlans.length];
  const thumbnailRelative = 'imports/visuals/thumbnail_gamma.png';
  normalizeGammaImage(thumbnailSource, safeResolve(episodeDir, thumbnailRelative));
  const thumbnailPreview = (packet.asset_manifest?.assets || []).find((entry) => entry.asset_type === 'thumbnail_preview' || entry.role === 'thumbnail');
  const thumbnailAsset = {
    asset_id: 'gamma_thumbnail',
    episode_id: packet.episode.episode_id,
    scene_id: null,
    asset_type: 'thumbnail_replacement',
    media_type: 'image/png',
    relative_path: thumbnailRelative,
    role: 'thumbnail',
    status: 'replacement_ready',
    generated_by: 'gamma_public_api',
    creator: 'Gamma',
    publisher: 'Gamma',
    source_url: null,
    licence: 'project_owned_generated_asset',
    rights_status: 'cleared',
    synthetic: true,
    disclosure_required: false,
    source_ids: [],
    claim_ids: [],
    replaces_asset_id: thumbnailPreview?.asset_id || null,
    created_at: new Date().toISOString()
  };
  registerAsset(packet, episodeDir, thumbnailAsset);
  refreshVisualReport(packet);
  return {
    scene_count: scenePlans.length,
    imported_assets: imported,
    thumbnail_relative_path: thumbnailRelative
  };
}

module.exports = {
  buildGammaStoryboardRequest,
  gammaSinglePageRequests,
  gammaFetch,
  pollGammaGeneration,
  extractZip,
  applyGammaExportsToEpisode,
  downloadGammaExportFile,
  normalizeGammaImage,
  promoteGammaSceneAsset,
  promoteGammaThumbnailAsset
};
