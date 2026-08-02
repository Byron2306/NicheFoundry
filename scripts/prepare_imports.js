const fs = require("fs");
const path = require("path");

const ADOBE_PRESET_BY_TYPE = {
  cover: "Cinematic educational title slide",
  mission_brief: "Explorer journal mission briefing slide",
  question_card: "Bold quiz question slide with four answer rows",
  countdown_card: "Minimal suspense countdown slide",
  answer_card: "Answer reveal slide with fact callout",
  final_score: "Celebration outro score slide"
};

const ADOBE_STOCK_KEYWORDS_BY_TYPE = {
  cover: ["dinosaur jungle", "prehistoric adventure", "cinematic explorer kids"],
  mission_brief: ["field journal texture", "explorer map", "dinosaur island landscape"],
  question_card: ["museum exhibit background", "science infographic texture", "dinosaur fossil pattern"],
  countdown_card: ["countdown timer graphic", "dramatic jungle fog", "game show suspense"],
  answer_card: ["dinosaur skeleton exhibit", "science badge", "discovery celebration"],
  final_score: ["victory badge", "explorer sticker", "celebration confetti science"]
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeText(filePath, content) {
  fs.writeFileSync(filePath, content);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function buildCsv(rows) {
  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function titleCase(value) {
  return String(value || "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getAdobePreset(type) {
  return ADOBE_PRESET_BY_TYPE[type] || "Educational presentation slide";
}

function getAdobeStockKeywords(type, theme) {
  return [...(ADOBE_STOCK_KEYWORDS_BY_TYPE[type] || []), ...(theme.icon_tags || [])];
}

function buildVisualStoryboardHtml(title, platformName, episodeId, theme, items) {
  const palette = (theme.palette || []).join(", ");
  const cards = items
    .map(
      (item) => `
      <article class="card">
        <div class="eyebrow">${escapeHtml(item.typeLabel)} • ${escapeHtml(item.preferred_png)}</div>
        <h2>${escapeHtml(item.card_id)}</h2>
        <p class="headline">${escapeHtml(item.headline)}</p>
        <p><strong>${escapeHtml(platformName)} preset:</strong> ${escapeHtml(item.preset)}</p>
        <p><strong>Stock keywords:</strong> ${escapeHtml(item.stock_keywords.join(", "))}</p>
        <p><strong>On-screen text:</strong> ${escapeHtml(item.on_screen_text || "n/a")}</p>
        <p><strong>Layout:</strong> ${escapeHtml(item.layout)}</p>
        <p><strong>Motion feel:</strong> ${escapeHtml(item.motion)}</p>
        <p><strong>Visual note:</strong> ${escapeHtml(item.visual_note)}</p>
        <p><strong>Illustration prompt:</strong> ${escapeHtml(item.illustration_prompt)}</p>
        <p><strong>Export to:</strong> <code>${escapeHtml(item.target_path)}</code></p>
      </article>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} - ${escapeHtml(episodeId)}</title>
  <style>
    :root {
      --ink: #1d2934;
      --paper: #f5ecd8;
      --gold: #d89a34;
      --fern: #466d55;
      --sky: #8bbdd6;
      --panel: rgba(255,255,255,0.78);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Trebuchet MS", "Avenir Next", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top right, rgba(255,255,255,0.24), transparent 28%),
        linear-gradient(135deg, var(--fern), #28485d 45%, var(--gold));
      min-height: 100vh;
    }
    .wrap {
      max-width: 1220px;
      margin: 0 auto;
      padding: 40px 24px 80px;
    }
    .hero {
      background: linear-gradient(135deg, rgba(17,26,34,0.94), rgba(17,26,34,0.66));
      color: white;
      border-radius: 28px;
      padding: 28px;
      box-shadow: 0 22px 50px rgba(8, 14, 20, 0.22);
    }
    .hero h1 { margin: 0 0 10px; font-size: 42px; }
    .hero p { margin: 8px 0; line-height: 1.5; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 18px;
      margin-top: 24px;
    }
    .card {
      background: var(--panel);
      backdrop-filter: blur(10px);
      border-radius: 22px;
      padding: 18px;
      box-shadow: 0 16px 34px rgba(18, 25, 33, 0.12);
    }
    .card h2 {
      margin: 4px 0 8px;
      font-size: 26px;
    }
    .card p {
      margin: 8px 0;
      line-height: 1.45;
    }
    .eyebrow {
      font-size: 12px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(29,41,52,0.68);
    }
    .headline {
      font-size: 18px;
      font-weight: 700;
    }
    code {
      background: rgba(17,26,34,0.08);
      padding: 2px 6px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>${escapeHtml(title)}</h1>
      <p><strong>Episode:</strong> ${escapeHtml(episodeId)}</p>
      <p><strong>Theme:</strong> ${escapeHtml(theme.backdrop || "")}</p>
      <p><strong>Palette:</strong> ${escapeHtml(palette)}</p>
      <p><strong>Motion style:</strong> ${escapeHtml(theme.motion_style || "")}</p>
      <p>Build each slide in ${escapeHtml(platformName)} at 1920x1080, use Adobe Stock assets where helpful, then export as PNG using the filenames shown on each card.</p>
    </section>
    <section class="grid">
      ${cards}
    </section>
  </div>
</body>
</html>
`;
}

function main() {
  const episodeArg = process.argv[2];
  const episodeDir = episodeArg ? path.resolve(episodeArg) : null;
  if (!episodeDir) {
    console.error("Usage: node scripts/prepare_imports.js <episode-dir>");
    process.exit(1);
  }

  const scriptManifest = readJson(path.join(episodeDir, "script_manifest.json"));
  const renderManifest = readJson(path.join(episodeDir, "render_manifest.json"));
  const audioManifest = readJson(path.join(episodeDir, "audio_manifest.json"));
  const visualManifest = readJson(path.join(episodeDir, "visual_manifest.json"));

  const importsDir = path.join(episodeDir, "imports");
  const canvaDir = path.join(importsDir, "canva");
  const elevenlabsDir = path.join(importsDir, "elevenlabs");
  const promptsDir = path.join(importsDir, "prompts");
  const canvaPromptsDir = path.join(promptsDir, "canva");
  const adobePromptsDir = path.join(promptsDir, "adobe");
  const elevenlabsPromptsDir = path.join(promptsDir, "elevenlabs");

  [importsDir, canvaDir, elevenlabsDir, promptsDir, canvaPromptsDir, adobePromptsDir, elevenlabsPromptsDir].forEach(ensureDir);

  const canvaRows = [["order", "card_id", "type", "preferred_png", "fallback_png", "on_screen_text", "visual_note"]];
  const adobeRows = [["order", "card_id", "type", "adobe_preset", "stock_keywords", "preferred_png", "fallback_png"]];
  const elevenlabsRows = [["order", "scene_id", "role", "preferred_mp3", "fallback_mp3", "duration_seconds", "voiceover"]];

  const manifest = {
    generated_at: new Date().toISOString(),
    episode_id: scriptManifest.episode_id,
    note: "Export Adobe or Canva PNGs and ElevenLabs MP3s using the preferred filenames below. The renderer will fall back to local assets if imports are missing.",
    adobe: [],
    canva: [],
    elevenlabs: []
  };
  const visualStoryboardItems = [];

  scriptManifest.scenes.forEach((scene, index) => {
    const slide = renderManifest.slides.find((item) => item.card_id === scene.card_id);
    const audio = audioManifest.scenes.find((item) => item.scene_id === scene.scene_id);
    const visualCard = visualManifest.cards.find((item) => item.card_id === scene.card_id);
    if (!slide || !audio) {
      throw new Error(`Missing import metadata for scene ${scene.scene_id}`);
    }
    if (!visualCard) {
      throw new Error(`Missing visual metadata for card ${scene.card_id}`);
    }

    const canvaPromptPath = path.join(canvaPromptsDir, `${scene.card_id}.txt`);
    const adobePromptPath = path.join(adobePromptsDir, `${scene.card_id}.txt`);
    const elevenlabsPromptPath = path.join(elevenlabsPromptsDir, `${scene.scene_id}.txt`);
    const stockKeywords = getAdobeStockKeywords(slide.type, visualManifest.theme || {});
    const preset = getAdobePreset(slide.type);

    const visualItem = {
      order: index,
      card_id: scene.card_id,
      type: slide.type,
      typeLabel: titleCase(slide.type),
      headline: visualCard.headline,
      layout: visualCard.layout,
      illustration_prompt: visualCard.illustration_prompt,
      motion: visualCard.motion,
      preset,
      stock_keywords: stockKeywords,
      preferred_png: `${scene.card_id}.png`,
      fallback_png: path.basename(slide.asset_path),
      target_path: path.relative(episodeDir, path.join(canvaDir, `${scene.card_id}.png`)),
      on_screen_text: scene.on_screen_text,
      visual_note: scene.visual_note,
      prompt_file: path.relative(episodeDir, adobePromptPath)
    };

    const elevenlabsItem = {
      order: index,
      scene_id: scene.scene_id,
      role: scene.role,
      preferred_mp3: `${scene.scene_id}.mp3`,
      fallback_mp3: path.basename(audio.target_audio),
      target_path: path.relative(episodeDir, path.join(elevenlabsDir, `${scene.scene_id}.mp3`)),
      duration_seconds: scene.duration_seconds,
      voiceover: scene.voiceover,
      prompt_file: path.relative(episodeDir, elevenlabsPromptPath)
    };

    manifest.adobe.push(visualItem);
    manifest.canva.push(visualItem);
    manifest.elevenlabs.push(elevenlabsItem);
    visualStoryboardItems.push(visualItem);

    canvaRows.push([
      index,
      scene.card_id,
      slide.type,
      visualItem.preferred_png,
      visualItem.fallback_png,
      scene.on_screen_text,
      scene.visual_note
    ]);

    adobeRows.push([
      index,
      scene.card_id,
      slide.type,
      preset,
      stockKeywords.join(" | "),
      visualItem.preferred_png,
      visualItem.fallback_png
    ]);

    elevenlabsRows.push([
      index,
      scene.scene_id,
      scene.role,
      elevenlabsItem.preferred_mp3,
      elevenlabsItem.fallback_mp3,
      scene.duration_seconds,
      scene.voiceover
    ]);

    writeText(
      canvaPromptPath,
      [
        `card_id: ${scene.card_id}`,
        `type: ${slide.type}`,
        `export_png_as: ${scene.card_id}.png`,
        `headline: ${visualCard.headline}`,
        `layout: ${visualCard.layout}`,
        `motion: ${visualCard.motion}`,
        "",
        `on_screen_text: ${scene.on_screen_text}`,
        `visual_note: ${scene.visual_note}`,
        "",
        `illustration_prompt: ${visualCard.illustration_prompt}`
      ].join("\n") + "\n"
    );

    writeText(
      adobePromptPath,
      [
        `card_id: ${scene.card_id}`,
        `type: ${slide.type}`,
        `export_png_as: ${scene.card_id}.png`,
        `adobe_preset: ${preset}`,
        `stock_keywords: ${stockKeywords.join(", ")}`,
        `headline: ${visualCard.headline}`,
        `layout: ${visualCard.layout}`,
        `motion: ${visualCard.motion}`,
        "",
        `on_screen_text: ${scene.on_screen_text}`,
        `visual_note: ${scene.visual_note}`,
        "",
        `illustration_prompt: ${visualCard.illustration_prompt}`
      ].join("\n") + "\n"
    );

    writeText(
      elevenlabsPromptPath,
      [
        `scene_id: ${scene.scene_id}`,
        `role: ${scene.role}`,
        `export_mp3_as: ${scene.scene_id}.mp3`,
        `target_duration_seconds: ${scene.duration_seconds}`,
        "",
        scene.voiceover
      ].join("\n") + "\n"
    );
  });

  writeJson(path.join(importsDir, "import_manifest.json"), manifest);
  writeText(path.join(importsDir, "canva_export_list.csv"), buildCsv(canvaRows));
  writeText(path.join(importsDir, "adobe_export_list.csv"), buildCsv(adobeRows));
  writeText(path.join(importsDir, "elevenlabs_lines.csv"), buildCsv(elevenlabsRows));
  writeText(
    path.join(importsDir, "canva_storyboard.html"),
    buildVisualStoryboardHtml("Canva Storyboard", "Canva", scriptManifest.episode_id, visualManifest.theme || {}, visualStoryboardItems)
  );
  writeText(
    path.join(importsDir, "adobe_storyboard.html"),
    buildVisualStoryboardHtml("Adobe Storyboard", "Adobe Express", scriptManifest.episode_id, visualManifest.theme || {}, visualStoryboardItems)
  );
  writeText(
    path.join(importsDir, "canva_brief.md"),
    [
      `# Canva Brief: ${scriptManifest.episode_id}`,
      "",
      `Theme backdrop: ${visualManifest.theme?.backdrop || ""}`,
      `Palette: ${(visualManifest.theme?.palette || []).join(", ")}`,
      `Motion style: ${visualManifest.theme?.motion_style || ""}`,
      "",
      "Build guidance:",
      "- Create a 1920x1080 presentation in Canva.",
      "- Keep typography big and mobile-legible.",
      "- Question cards need all four options visible at once.",
      "- Countdown cards should feel suspenseful and uncluttered.",
      "- Answer cards should have a strong reveal moment plus one fact line.",
      "",
      "Export:",
      "- Export each slide as PNG.",
      "- Rename files to match `canva_export_list.csv`.",
      "- Put them in `imports/canva/`."
    ].join("\n") + "\n"
  );
  writeText(
    path.join(importsDir, "adobe_brief.md"),
    [
      `# Adobe Brief: ${scriptManifest.episode_id}`,
      "",
      `Theme backdrop: ${visualManifest.theme?.backdrop || ""}`,
      `Palette: ${(visualManifest.theme?.palette || []).join(", ")}`,
      `Motion style: ${visualManifest.theme?.motion_style || ""}`,
      "",
      "Build guidance:",
      "- Create a 1920x1080 presentation in Adobe Express.",
      "- Start from the recommended preset family for each slide.",
      "- Use Adobe Stock imagery and background textures to avoid flat slides.",
      "- Keep typography big and mobile-legible.",
      "- Question cards need all four options visible at once.",
      "- Countdown cards should feel suspenseful and uncluttered.",
      "- Answer cards should have a strong reveal moment plus one fact line.",
      "",
      "Export:",
      "- Export each slide as PNG.",
      "- Rename files to match `adobe_export_list.csv`.",
      "- Put them in `imports/canva/` because the renderer already watches that folder."
    ].join("\n") + "\n"
  );
  writeText(
    path.join(importsDir, "adobe_stock_keywords.md"),
    [
      `# Adobe Stock Keywords: ${scriptManifest.episode_id}`,
      "",
      ...visualStoryboardItems.map((item) => `- ${item.card_id}: ${item.stock_keywords.join(", ")}`)
    ].join("\n") + "\n"
  );
  writeText(
    path.join(importsDir, "README.md"),
    [
      "# Imports",
      "",
      "1. Build the episode once so manifests and folders exist.",
      "2. Use `adobe_storyboard.html`, `adobe_brief.md`, and `adobe_export_list.csv` for the Adobe-first visual workflow.",
      "3. Or use `canva_storyboard.html`, `canva_brief.md`, and `canva_export_list.csv` for the Canva workflow.",
      "4. Use `elevenlabs_lines.csv` or `npm run generate:elevenlabs -- episodes/<episode-id>` for narration.",
      "5. Put exported PNGs in `imports/canva/` and MP3s in `imports/elevenlabs/`.",
      "6. Run `npm run render:episode -- episodes/<episode-id>` to render with imported assets.",
      "",
      "Preferred PNG names are the short IDs like `Q1_question.png`."
    ].join("\n") + "\n"
  );

  console.log(`Prepared Adobe, Canva, and ElevenLabs import kit in ${path.relative(process.cwd(), importsDir)}`);
}

main();
