const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function runScript(scriptName, episodeDir) {
  const scriptPath = path.join(__dirname, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, episodeDir], {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  const episodeDir = process.argv[2];
  if (!episodeDir) {
    console.error("Usage: node scripts/build_episode.js <episode-dir>");
    process.exit(1);
  }

  ensureDir(path.join(episodeDir, "imports", "canva"));
  ensureDir(path.join(episodeDir, "imports", "elevenlabs"));

  runScript("build_cards.js", episodeDir);
  runScript("build_audio_stub.js", episodeDir);
  runScript("prepare_imports.js", episodeDir);
  runScript("render_episode.js", episodeDir);

  const renderManifest = readJson(path.join(episodeDir, "render_manifest.json"));
  const scriptManifest = readJson(path.join(episodeDir, "script_manifest.json"));

  const storyboard = {
    generated_at: new Date().toISOString(),
    output: {
      cards_dir: "cards",
      audio_dir: "audio",
      canva_import_dir: "imports/canva",
      elevenlabs_import_dir: "imports/elevenlabs",
      preview_timeline: "timeline_preview.json",
      preview_video: "final_preview.mp4"
    },
    totals: {
      cards: renderManifest.slides.length,
      scenes: scriptManifest.scenes.length,
      runtime_seconds: scriptManifest.scenes.reduce(
        (sum, scene) => sum + Number(scene.duration_seconds || 0),
        0
      )
    },
    timeline: scriptManifest.scenes.map((scene, index) => {
      const slide = renderManifest.slides.find((item) => item.card_id === scene.card_id);
      return {
        order: index,
        scene_id: scene.scene_id,
        card_id: scene.card_id,
        card_asset: slide ? slide.asset_path.replace(/\.png$/, ".svg") : null,
        duration_seconds: scene.duration_seconds,
        role: scene.role
      };
    })
  };

  writeJson(path.join(episodeDir, "timeline_preview.json"), storyboard);
  console.log(`Built local production assets for ${path.basename(episodeDir)}`);
}

main();
