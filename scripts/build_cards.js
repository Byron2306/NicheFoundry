const fs = require("fs");
const path = require("path");

const WIDTH = 1920;
const HEIGHT = 1080;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text, maxChars) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });

  if (current) {
    lines.push(current);
  }

  return lines;
}

function renderLines(lines, x, y, fontSize, lineHeight, color, weight) {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" fill="${color}" font-size="${fontSize}" font-weight="${weight}" font-family="'Trebuchet MS', 'Avenir Next', sans-serif">${escapeXml(line)}</text>`
    )
    .join("\n");
}

function paletteColors(palette) {
  const mapping = {
    fern: "#456b52",
    amber: "#e5a93d",
    sky: "#8fd0f2",
    sea: "#2a6388",
    sand: "#d9be88",
    sunset: "#ed7c5b",
    parchment: "#d8c7a4",
    bronze: "#a56a43",
    navy: "#24364f",
    coral: "#e56f5a",
    teal: "#3a8c8a",
    gold: "#f1c24f"
  };

  return (palette || []).map((item) => mapping[item] || "#5c6b73");
}

function backgroundSvg(card) {
  const colors = paletteColors(card.palette);
  const colorA = colors[0] || "#24414f";
  const colorB = colors[1] || "#d7a245";
  const colorC = colors[2] || "#f4efe2";

  return `
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${colorA}" />
        <stop offset="45%" stop-color="${colorB}" />
        <stop offset="100%" stop-color="${colorC}" />
      </linearGradient>
      <linearGradient id="panel" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#f7f1df" />
        <stop offset="100%" stop-color="#f1e5c6" />
      </linearGradient>
      <linearGradient id="inkBand" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="rgba(20,31,41,0.92)" />
        <stop offset="100%" stop-color="rgba(20,31,41,0.58)" />
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="rgba(11,18,26,0.22)" />
      </filter>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
    <circle cx="1570" cy="150" r="290" fill="rgba(255,255,255,0.10)" />
    <circle cx="250" cy="950" r="360" fill="rgba(255,255,255,0.07)" />
    <path d="M0 820 C280 720, 420 1010, 760 900 S1460 700, 1920 860 L1920 1080 L0 1080 Z" fill="rgba(22,53,72,0.20)" />
    <rect x="96" y="88" rx="40" ry="40" width="1728" height="904" fill="rgba(13,20,28,0.12)" />
    <rect x="124" y="120" rx="34" ry="34" width="1672" height="840" fill="url(#panel)" filter="url(#shadow)" />
    <rect x="124" y="120" rx="34" ry="34" width="1672" height="146" fill="url(#inkBand)" />
  `;
}

function iconStrip(card) {
  const tags = (card.icon_tags || []).slice(0, 4);
  return tags
    .map((tag, index) => {
      const x = 300 + index * 250;
      return `
        <rect x="${x - 92}" y="824" rx="26" ry="26" width="184" height="54" fill="rgba(20,31,41,0.10)" />
        <text x="${x}" y="859" text-anchor="middle" fill="#20303c" font-size="22" font-weight="800" font-family="'Trebuchet MS', 'Avenir Next', sans-serif">${escapeXml(tag.toUpperCase())}</text>
      `;
    })
    .join("\n");
}

function renderOptions(card) {
  return (card.answer_options || [])
    .map((option, index) => {
      const rowY = 420 + index * 110;
      return `
        <rect x="220" y="${rowY}" rx="24" ry="24" width="1480" height="88" fill="rgba(255,255,255,0.42)" stroke="rgba(28,44,52,0.12)" />
        <rect x="240" y="${rowY + 14}" rx="20" ry="20" width="96" height="60" fill="#20303c" />
        <text x="288" y="${rowY + 54}" text-anchor="middle" fill="#ffffff" font-size="30" font-weight="800" font-family="'Trebuchet MS', 'Avenir Next', sans-serif">${escapeXml(option.label)}</text>
        <text x="370" y="${rowY + 56}" fill="#1c2c34" font-size="34" font-weight="700" font-family="'Trebuchet MS', 'Avenir Next', sans-serif">${escapeXml(option.text)}</text>
      `;
    })
    .join("\n");
}

function renderCard(card, index, total) {
  const bodyLines = wrapText(card.body, card.type === "question_card" ? 40 : 50);
  const supportLines = wrapText(card.supporting_text || "", 56);
  const promptLines = wrapText(card.illustration_prompt || "", 72);
  const badge = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;

  let middle = "";

  if (card.type === "question_card") {
    middle = `
      ${renderLines(bodyLines, 220, 326, 52, 62, "#1c2c34", 800)}
      ${renderOptions(card)}
    `;
  } else if (card.type === "countdown_card") {
    middle = `
      ${renderLines(bodyLines, 220, 332, 58, 68, "#1c2c34", 800)}
      <circle cx="960" cy="610" r="184" fill="rgba(255,255,255,0.46)" stroke="#20303c" stroke-width="18" />
      <circle cx="960" cy="610" r="150" fill="rgba(32,48,60,0.06)" stroke="rgba(32,48,60,0.16)" stroke-width="4" />
      <text x="960" y="592" text-anchor="middle" fill="#20303c" font-size="34" font-weight="800" font-family="'Trebuchet MS', 'Avenir Next', sans-serif">MAKE YOUR CHOICE</text>
      <text x="960" y="675" text-anchor="middle" fill="#20303c" font-size="104" font-weight="900" font-family="'Trebuchet MS', 'Avenir Next', sans-serif">${escapeXml(card.body.replace("Countdown: ", "").replace(" seconds", "s"))}</text>
    `;
  } else if (card.type === "answer_card") {
    middle = `
      <rect x="220" y="326" rx="28" ry="28" width="1480" height="152" fill="rgba(255,255,255,0.42)" />
      ${renderLines([card.body], 260, 418, 72, 82, "#1c2c34", 900)}
      ${renderLines(supportLines, 220, 530, 36, 46, "#1c2c34", 600)}
      <text x="220" y="770" fill="#20303c" font-size="22" font-weight="800" font-family="'Trebuchet MS', 'Avenir Next', sans-serif">SOURCE NOTE</text>
      ${renderLines([card.citation || ""], 220, 810, 22, 30, "#1c2c34", 500)}
    `;
  } else {
    middle = `
      ${renderLines(bodyLines, 220, 360, 46, 58, "#1c2c34", 700)}
      ${renderLines(promptLines.slice(0, 4), 220, 648, 24, 30, "rgba(28,44,52,0.72)", 500)}
    `;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  ${backgroundSvg(card)}
  <text x="220" y="208" fill="rgba(255,255,255,0.78)" font-size="24" font-weight="800" font-family="'Trebuchet MS', 'Avenir Next', sans-serif">${escapeXml(card.type.replace(/_/g, " ").toUpperCase())}</text>
  <text x="1700" y="208" text-anchor="end" fill="rgba(255,255,255,0.78)" font-size="24" font-weight="800" font-family="'Trebuchet MS', 'Avenir Next', sans-serif">${badge}</text>
  ${renderLines([card.headline], 220, 222, 66, 76, "#ffffff", 900)}
  ${middle}
  ${iconStrip(card)}
</svg>`;
}

function main() {
  const episodeDir = process.argv[2];
  if (!episodeDir) {
    console.error("Usage: node scripts/build_cards.js <episode-dir>");
    process.exit(1);
  }

  const visualManifest = readJson(path.join(episodeDir, "visual_manifest.json"));
  const renderManifest = readJson(path.join(episodeDir, "render_manifest.json"));
  const cardsDir = path.join(episodeDir, "cards");
  ensureDir(cardsDir);

  if (visualManifest.schema === "nichefoundry.visual_manifest.phase7.v1") {
    renderManifest.slides.forEach((slide) => {
      const card = visualManifest.cards.find((item) => item.card_id === slide.card_id);
      if (!card?.preview_path) throw new Error(`Missing Phase 7 preview path for ${slide.card_id}`);
      const sourcePath = path.join(episodeDir, card.preview_path);
      if (!fs.existsSync(sourcePath)) throw new Error(`Missing generated Phase 7 preview asset ${card.preview_path}`);
      const outputPath = path.join(episodeDir, slide.asset_path.replace(/\.png$/, ".svg"));
      ensureDir(path.dirname(outputPath));
      fs.copyFileSync(sourcePath, outputPath);
    });
    console.log(`Built ${renderManifest.slides.length} Phase 7 studio-native card SVGs in ${path.relative(process.cwd(), cardsDir)}`);
    return;
  }

  renderManifest.slides.forEach((slide, index) => {
    const card = visualManifest.cards.find((item) => item.card_id === slide.card_id);
    if (!card) {
      throw new Error(`Missing card definition for ${slide.card_id}`);
    }
    const svg = renderCard(card, index, renderManifest.slides.length);
    const outputPath = path.join(episodeDir, slide.asset_path.replace(/\.png$/, ".svg"));
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, svg);
  });

  console.log(`Built ${renderManifest.slides.length} card SVGs in ${path.relative(process.cwd(), cardsDir)}`);
}

main();
