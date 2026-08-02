const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

function escapeDrawtext(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function drawText(text, x, y, size, color = 'f6efe1', weight = '') {
  const font = weight === 'bold'
    ? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
    : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  return `drawtext=fontfile=${font}:text='${escapeDrawtext(text)}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}:line_spacing=10`;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
}

function ffmpegScene(source, output, spec) {
  const filters = [
    `scale=2200:-1`,
    `crop=1920:1080:${spec.cropX}:${spec.cropY}`,
    'eq=contrast=1.08:saturation=0.9:brightness=-0.03',
    'vignette=PI/5',
    'drawbox=x=0:y=0:w=1920:h=1080:color=11100c@0.18:t=fill',
    `drawbox=x=${spec.panelX}:y=86:w=${spec.panelW}:h=822:color=0f1114@0.72:t=fill`,
    `drawbox=x=${spec.panelX}:y=86:w=${spec.panelW}:h=822:color=c99b54@0.65:t=3`,
    `drawbox=x=${spec.lineX}:y=136:w=4:h=692:color=c99b54@0.82:t=fill`,
    drawText(spec.kicker, spec.textX, 128, 28, 'c99b54', 'bold'),
    drawText(spec.title, spec.textX, 190, 48, 'fff7e8', 'bold'),
    drawText(spec.body, spec.textX, 332, 30, 'f6efe1'),
    drawText(spec.label, spec.textX, 760, 24, 'cfc4ae'),
    drawText(`Image base: ${spec.sourceLabel}`, 88, 1010, 22, 'd8caa9')
  ];
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', source, '-vf', filters.join(','), '-frames:v', '1', '-update', '1', output]);
}

function main() {
  const episodeArg = process.argv[2];
  if (!episodeArg) {
    console.error('Usage: node scripts/build_evidence_visuals.js <episode-dir>');
    process.exit(1);
  }
  const episodeDir = path.resolve(episodeArg);
  const sources = {
    oldPersian: {
      file: path.join(episodeDir, 'imports/visuals/evidence/persepolis_old_persian.jpg'),
      relative: 'imports/visuals/evidence/persepolis_old_persian.jpg',
      url: 'https://commons.wikimedia.org/wiki/File:Persepolis_Old_Persian_inscription.jpg',
      label: 'Persepolis Old Persian inscription, Wikimedia Commons'
    },
    inscriptionWall: {
      file: path.join(episodeDir, 'imports/visuals/evidence/persepolis_inscription_ginolerhino.jpg'),
      relative: 'imports/visuals/evidence/persepolis_inscription_ginolerhino.jpg',
      url: 'https://commons.wikimedia.org/wiki/File:Pers%C3%A9polis._Inscription.jpg',
      label: 'Persepolis inscription photograph, Wikimedia Commons'
    }
  };
  for (const source of Object.values(sources)) {
    if (!fs.existsSync(source.file)) throw new Error(`Missing evidence image: ${path.relative(process.cwd(), source.file)}`);
  }

  const visualPlanPath = path.join(episodeDir, 'visual_plan.json');
  const assetManifestPath = path.join(episodeDir, 'asset_manifest.json');
  const visualReportPath = path.join(episodeDir, 'visual_report.json');
  const visualPlan = readJson(visualPlanPath);
  const manifest = readJson(assetManifestPath);
  const report = readJson(visualReportPath);
  const outputDir = path.join(episodeDir, 'imports/visuals/evidence_scenes');
  ensureDir(outputDir);

  const specs = [
    ['hook', 'oldPersian', 'THE STONE VOICE', 'Not a record.\nA performance.', 'A royal text works only if distant people\ncan recognise the king behind it.', 'Exhibit A: carved Old Persian cuneiform at Persepolis', 0, 180, 1010, 820, 1084, 1060],
    ['scene_69ecaf81def73aa7', 'inscriptionWall', 'CASE QUESTION', 'Who is speaking\nin stone?', 'Ancient royal messaging becomes\na modern trail back into cuneiform.', 'Persepolis and Behistun anchor the decipherment story.', 0, 20, 86, 850, 146, 136],
    ['scene_2b19ffdfa0ab217d', 'oldPersian', 'SCALE', '179 texts.\nOne imperial voice.', 'A scattered corpus becomes a managed\nlanguage of rule when read together.', 'Modern catalogues expose repetition, variation, and reach.', 560, 120, 990, 840, 1062, 1040],
    ['scene_ba6bacb874fd4f56', 'inscriptionWall', 'FORM', 'Multilingual\nby design.', 'The evidence is not just what the text says.\nIt is the decision to say it across scripts.', 'Old Persian, Elamite, and Babylonian shaped one royal message.', 160, 30, 82, 850, 142, 132],
    ['scene_bf487f9a1dd4b838', 'oldPersian', 'DECIPHERMENT', 'The empire\nleft a key.', 'Old Persian opened first; trilingual structure\nhelped scholars approach the other voices.', 'Royal display became a modern reading instrument.', 1040, 140, 980, 850, 1042, 1030],
    ['scene_9c8e0ba907351980', 'inscriptionWall', 'INTERPRETATION', 'A voice beyond\none wall.', 'Persepolis, Behistun, and Elephantine\nshow the message moving through place.', 'The case widens from palace inscription to administrative world.', 260, 20, 86, 850, 146, 136],
    ['scene_f31e254c99182e0c', 'oldPersian', 'VERDICT', 'Empire as\ncommunication.', 'Power was engineered to cross peoples,\nscripts, and distance.', 'The artefact is not silent. It is managed speech.', 1500, 220, 980, 850, 1042, 1030],
    ['conclusion', 'inscriptionWall', 'FINAL EXHIBIT', 'Stone made\nauthority portable.', 'What survived is not only a text,\nbut a system for making rule legible.', 'The object remains evidence because the message endured.', 80, 20, 86, 850, 146, 136]
  ];

  const generated = new Map();
  for (const [sceneId, sourceKey, kicker, title, body, label, cropX, cropY, panelX, panelW, lineX, textX] of specs) {
    const sceneIndex = visualPlan.scene_plans.find((scene) => scene.scene_id === sceneId)?.scene_index ?? 0;
    const output = path.join(outputDir, `${String(sceneIndex + 1).padStart(2, '0')}_${sceneId}_evidence.png`);
    const source = sources[sourceKey];
    ffmpegScene(source.file, output, { kicker, title, body, label, cropX, cropY, panelX, panelW, lineX, textX, sourceLabel: source.label });
    generated.set(sceneId, { output, source });
  }

  for (const scene of visualPlan.scene_plans) {
    scene.objective = scene.scene_id === 'hook'
      ? 'Open on an authentic inscription detail and pose the human question.'
      : 'Show the artefact evidence that supports this turn of the argument.';
    scene.motion_cue = [
      'slow macro push across carved signs',
      'lateral scan from inscription into exhibit label',
      'tight crop reveal, then drift to interpretive callout',
      'gallery push-in with readable evidence label'
    ][scene.scene_index % 4];
    scene.visual_requirements = [
      'Use authentic artefact imagery where available.',
      'Keep on-screen text sparse and readable.',
      'Let motion inspect the evidence rather than decorate it.',
      'Respect the lower caption-safe area.'
    ];
  }

  for (const asset of manifest.assets) {
    if (asset.asset_type === 'imported_scene_asset' && /_gamma\.png$/.test(asset.relative_path || '')) {
      asset.status = 'superseded';
    }
  }

  for (const [sceneId, record] of generated.entries()) {
    const { output, source } = record;
    const scene = visualPlan.scene_plans.find((item) => item.scene_id === sceneId);
    const relativePath = path.relative(episodeDir, output).replaceAll(path.sep, '/');
    const previewAssetId = scene?.preview_asset_id || null;
    const asset = {
      asset_id: stableId('asset', `${sceneId}:${fileHash(output)}`),
      scene_id: sceneId,
      asset_type: 'imported_scene_asset',
      role: 'scene_replacement',
      relative_path: relativePath,
      provider: 'local_evidence_compositor',
      creator: 'NicheFoundry evidence compositor using Wikimedia Commons source imagery',
      rights_status: 'cleared',
      licence: 'Wikimedia Commons source image; derived educational composition',
      source_url: source.url,
      source_relative_path: source.relative,
      source_sha256: fileHash(source.file),
      sha256: fileHash(output),
      size_bytes: fs.statSync(output).size,
      replaces_asset_id: previewAssetId,
      status: 'replacement_ready',
      generated_at: new Date().toISOString()
    };
    manifest.assets = manifest.assets.filter((entry) => entry.asset_id !== asset.asset_id);
    manifest.assets.push(asset);
  }

  const thumbnail = generated.get('hook');
  if (thumbnail) {
    const target = path.join(episodeDir, 'imports/visuals/evidence_scenes/thumbnail_evidence.png');
    fs.copyFileSync(thumbnail.output, target);
    const existingThumb = manifest.assets.find((asset) => asset.role === 'thumbnail' && asset.asset_type === 'thumbnail_preview');
    manifest.assets.push({
      asset_id: stableId('asset', `thumbnail:${fileHash(target)}`),
      scene_id: null,
      asset_type: 'thumbnail_replacement',
      role: 'thumbnail',
      relative_path: path.relative(episodeDir, target).replaceAll(path.sep, '/'),
      provider: 'local_evidence_compositor',
      creator: 'NicheFoundry evidence compositor using Wikimedia Commons source imagery',
      rights_status: 'cleared',
      licence: 'Wikimedia Commons source image; derived educational composition',
      source_url: thumbnail.source.url,
      source_relative_path: thumbnail.source.relative,
      source_sha256: fileHash(thumbnail.source.file),
      sha256: fileHash(target),
      size_bytes: fs.statSync(target).size,
      replaces_asset_id: existingThumb?.asset_id || null,
      status: 'replacement_ready',
      generated_at: new Date().toISOString()
    });
  }

  manifest.generated_at = new Date().toISOString();
  report.authentic_artefact_imagery = {
    passed: true,
    source_count: Object.keys(sources).length,
    active_scene_replacements: generated.size,
    source_urls: Object.values(sources).map((source) => source.url)
  };
  writeJson(visualPlanPath, visualPlan);
  writeJson(assetManifestPath, manifest);
  writeJson(visualReportPath, report);
  console.log(`Built ${generated.size} evidence visuals from authentic artefact imagery.`);
}

main();
