const fs = require("fs");
const path = require("path");
const { buildPacket, persistEpisode, studioRegistry } = require("../server");
const { scoreEpisodeFit } = require("../lib/studios");
const { buildAudioPerformancePackage, produceAudioAssets } = require("../lib/audio_system");
const { buildRenderPlan, renderEpisode } = require("../lib/render_system");

function titleCase(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function parseArgs(argv) {
  const flags = {
    topic: "",
    studioId: null,
    withAudio: false,
    withRender: false,
    audioProvider: "auto",
    renderProfile: "proxy",
    force: false
  };
  const positionals = [];
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--audio") flags.withAudio = true;
    else if (value === "--render") flags.withRender = true;
    else if (value === "--force") flags.force = true;
    else if (value === "--provider" && argv[index + 1]) {
      flags.audioProvider = argv[index + 1];
      index += 1;
    } else if (value === "--profile" && argv[index + 1]) {
      flags.renderProfile = argv[index + 1];
      index += 1;
    } else {
      positionals.push(value);
    }
  }
  flags.topic = String(positionals[0] || "").trim();
  flags.studioId = String(positionals[1] || "").trim() || null;
  if (flags.withRender) flags.withAudio = true;
  return flags;
}

function studioTopicBlueprint(studioId, topic) {
  const topicTitle = titleCase(topic);
  const normalizedTopic = String(topic || "").toLowerCase();
  const topicText = String(topic || "").trim();
  const revealMatch = topicText.match(/^(?:what|how|why|when|where|who)\s+(.+?)\s+reveal(?:s)?\s+about\s+(.+)$/i);
  const primaryHistoryFocus = revealMatch ? revealMatch[1].trim() : topicText
    .replace(/^(what|how|why|when|where|who)\s+/i, "")
    .trim();
  const secondaryHistoryFocus = revealMatch ? revealMatch[2].trim() : "";
  if (studioId === "puzzle_planet") {
    const isSpace = /\bspace\b/i.test(topic);
    return {
      working_title: `${topicTitle} Rescue Mission`,
      story_premise: `A family-safe adventure quiz where viewers complete a mission about ${topic} by answering clear, evidence-based questions with real explanations.`,
      source_queries: isSpace
        ? ["solar system", "planets", "moons", "space exploration"]
        : [topic, `${topic} science`, `${topic} nature`, `${topic} geography`],
      visual_direction: `Use the Puzzle Planet mission style: bold progress, friendly diagrams, clear answer cards, and adventurous ${topic} environments.`,
      age_band: "8-13",
      audience_mode: "family",
      contains_synthetic_media: true,
      question_count: 8,
      countdown_seconds: 8,
      archetype_id: "adventure_quiz"
    };
  }

  if (studioId === "failure_atlas") {
    return {
      working_title: `Why ${topicTitle} Failed`,
      story_premise: `Reconstruct how ${topic} failed, separate the trigger from the deeper conditions, and end with the design lesson supported by evidence.`,
      source_queries: [`${topic} investigation`, `${topic} accident report`, `${topic} failure analysis`, `${topic} design flaw`],
      visual_direction: "Use Failure Atlas grammar: calm diagrams, stepwise system reconstruction, visible force paths, and no sensational imagery.",
      age_band: "13+",
      audience_mode: "general_family",
      contains_synthetic_media: true,
      question_count: 6,
      countdown_seconds: 8,
      archetype_id: "failure_chain"
    };
  }

  if (studioId === "history_under_glass") {
    const inscriptionTopic = /\b(inscription|inscriptions|tablet|tablets|archive|archives|papyrus|manuscript|decree|edict|graffiti)\b/i.test(normalizedTopic);
    const routeTopic = /\b(route|trade|journey|voyage|migration|exchange|provenance|map)\b/i.test(normalizedTopic);
    const mythTopic = /\b(myth|legend|debunk|claim|did .* really|true or false)\b/i.test(normalizedTopic);
    const sourceQueries = inscriptionTopic
      ? [
          `"${primaryHistoryFocus}"`,
          secondaryHistoryFocus ? `"${primaryHistoryFocus}" "${secondaryHistoryFocus}"` : `"${primaryHistoryFocus}" primary source`,
          `"${primaryHistoryFocus}" inscription`,
          `"${primaryHistoryFocus}" translation`
        ]
      : routeTopic
        ? [`"${primaryHistoryFocus}"`, `"${primaryHistoryFocus}" map`, `"${primaryHistoryFocus}" trade route`, `"${primaryHistoryFocus}" provenance`]
        : mythTopic
          ? [`"${primaryHistoryFocus}"`, `"${primaryHistoryFocus}" primary sources`, `"${primaryHistoryFocus}" historians`, `"${primaryHistoryFocus}" evidence`]
          : [`"${primaryHistoryFocus}"`, `"${primaryHistoryFocus}" primary sources`, `"${primaryHistoryFocus}" museum collection`, `"${primaryHistoryFocus}" archive`];
    return {
      working_title: `${topicTitle} Under Glass`,
      story_premise: `Use verified records and artifacts to explain what ${topic} reveals about everyday life, power, and change over time.`,
      source_queries: sourceQueries,
      visual_direction: "Use History Under Glass grammar: archival textures, object close-ups, restrained motion, and careful contextual labels.",
      age_band: "13+",
      audience_mode: "general_family",
      contains_synthetic_media: true,
      question_count: 6,
      countdown_seconds: 8
    };
  }

  if (studioId === "practical_open_source") {
    return {
      working_title: `${topicTitle} Explained`,
      story_premise: `Teach ${topic} through a practical open-source workflow, showing what it does, how it works, and where it breaks in real use.`,
      source_queries: [`${topic} documentation`, `${topic} github`, `${topic} tutorial`, `${topic} release notes`],
      visual_direction: "Use Practical Open Source grammar: clean terminals, product diagrams, highlighted diffs, and purposeful callouts instead of hype.",
      age_band: "13+",
      audience_mode: "general_family",
      contains_synthetic_media: true,
      question_count: 6,
      countdown_seconds: 8,
      archetype_id: "guided_tutorial"
    };
  }

  return {
    working_title: topicTitle,
    story_premise: `Create an episode about ${topic}.`,
    source_queries: [topic],
    visual_direction: "Apply the studio visual grammar.",
    age_band: "13+",
    audience_mode: "general_family",
    contains_synthetic_media: true,
    question_count: 6,
    countdown_seconds: 8
  };
}

function makeBrief(topic, studioId) {
  return {
    topic,
    studio_id: studioId,
    ...studioTopicBlueprint(studioId, topic)
  };
}

function chooseBestStudio(topic, requestedStudioId) {
  if (requestedStudioId) return { studio_id: requestedStudioId, brief: makeBrief(topic, requestedStudioId) };
  const candidates = studioRegistry.list().map((studio) => {
    const brief = makeBrief(topic, studio.studio_id);
    const pack = studioRegistry.get(studio.studio_id);
    return {
      studio_id: studio.studio_id,
      studio_name: studio.name,
      brief,
      fit: scoreEpisodeFit(pack, brief)
    };
  }).sort((left, right) => Number(right.fit.score || 0) - Number(left.fit.score || 0));
  return candidates[0];
}

function writeAudioPlanningFiles(episodeDir, audioPackage) {
  for (const [name, payload] of Object.entries({
    "host_profile.json": audioPackage.host_profile,
    "pronunciation_lexicon.json": audioPackage.pronunciation_lexicon,
    "audio_performance_plan.json": audioPackage.audio_performance_plan,
    "sound_design_plan.json": audioPackage.sound_design_plan,
    "audio_preflight_report.json": audioPackage.audio_preflight_report
  })) {
    writeJson(path.join(episodeDir, name), payload);
  }
}

async function produceEpisodeMedia({ packet, audioProvider, renderProfile, force }) {
  const root = path.resolve(__dirname, "..");
  const episodeDir = path.resolve(root, packet.episode_dir);
  const brief = readJson(path.join(episodeDir, "brief.json"));
  const pack = readJson(path.join(episodeDir, "studio_pack_snapshot.json"));
  const scriptPackage = readJson(path.join(episodeDir, "script_package.json"));
  const timingPlan = readJson(path.join(episodeDir, "timing_plan.json"));

  const audioPackage = buildAudioPerformancePackage({
    pack,
    brief,
    scriptPackage,
    timingPlan,
    episodeId: packet.episode.episode_id
  });
  writeAudioPlanningFiles(episodeDir, audioPackage);
  if (!audioPackage.passed) {
    throw new Error(`Audio preflight failed: ${(audioPackage.audio_preflight_report?.issues || []).join(" ")}`);
  }

  const audioProduction = await produceAudioAssets({
    root,
    episodeDir,
    audioPackage,
    provider: audioProvider,
    force
  });
  writeJson(path.join(episodeDir, "audio_manifest.json"), audioProduction.audio_manifest);
  writeJson(path.join(episodeDir, "audio_asset_hashes.json"), audioProduction.audio_asset_hashes);
  writeJson(path.join(episodeDir, "loudness_report.json"), audioProduction.loudness_report);
  writeJson(path.join(episodeDir, "audio_performance_report.json"), audioProduction.performance_report);

  const visualPackage = {
    visual_plan: readJson(path.join(episodeDir, "visual_plan.json")),
    asset_manifest: readJson(path.join(episodeDir, "asset_manifest.json")),
    visual_report: readJson(path.join(episodeDir, "visual_report.json"))
  };
  const renderPlan = buildRenderPlan({
    episodeId: packet.episode.episode_id,
    studioId: brief.studio_id || packet.episode?.studio?.id,
    title: packet.episode.title,
    scriptPackage,
    visualPackage,
    audioProduction,
    profileId: renderProfile,
    outputFormat: brief.output_format || "long_form"
  });
  const renderProduction = renderEpisode({ episodeDir, renderPlan, force });
  return { episodeDir, audioPackage, audioProduction, renderProduction };
}

async function main() {
  const flags = parseArgs(process.argv);
  if (!flags.topic) {
    console.error("Usage: node scripts/backend_autopilot.js <topic> [studio_id] [--audio] [--render] [--provider auto|piper|elevenlabs|espeak] [--profile proxy|final|vertical_proxy|vertical_final] [--force]");
    process.exit(1);
  }

  const selected = chooseBestStudio(flags.topic, flags.studioId);
  if (!selected?.studio_id) {
    console.error("No installed studio is available.");
    process.exit(1);
  }

  const brief = {
    ...selected.brief,
    allow_low_fit: !selected.fit?.passed
  };

  const packet = await buildPacket(brief);
  persistEpisode(packet);

  let media = null;
  if (flags.withAudio) {
    media = await produceEpisodeMedia({
      packet,
      audioProvider: flags.audioProvider,
      renderProfile: flags.renderProfile,
      force: flags.force
    });
  }

  console.log(JSON.stringify({
    topic: flags.topic,
    studio_id: brief.studio_id,
    title: packet.episode?.title,
    episode_id: packet.episode?.episode_id,
    fit_score: packet.studio_fit_report?.score,
    fit_passed: packet.studio_fit_report?.passed,
    source_titles: (packet.sourcePacket || []).map((source) => source.title),
    episode_dir: packet.episode_dir,
    audio: media ? {
      provider: media.audioProduction.provider,
      scene_count: media.audioProduction.performance_report.scene_count,
      passed: media.audioProduction.performance_report.passed,
      preview_audio: media.audioProduction.audio_manifest.episode_preview
    } : null,
    render: media ? {
      profile: flags.renderProfile,
      passed: media.renderProduction.passed,
      output: media.renderProduction.render_manifest.output,
      captions: media.renderProduction.render_manifest.captions,
      thumbnail: media.renderProduction.render_manifest.thumbnail
    } : null
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
