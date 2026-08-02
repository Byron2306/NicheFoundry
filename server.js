const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { FoundryDatabase, nowIso } = require("./lib/database");
const { inspectEpisodeArtifacts, deriveQa, sha256File, safeResolve } = require("./lib/evidence");
const { atomizeClaims, coverageReport } = require("./lib/claims");
const { ConnectorRegistry, executeConnector, runResearchConnectorPlan, validateConnectorDefinition } = require("./lib/connectors");
const { buildResearchGovernance } = require("./lib/research_governance");
const { generateQuestions } = require("./lib/generator");
const { buildNarrativePackage, buildNarrativeBlueprint, buildScriptPackage, scriptPackageToMarkdown } = require("./lib/story_engine");
const { buildVisualPackage, renderVisualPreviewAssets, validateExternalAssetRecord } = require("./lib/visual_system");
const {
  buildGammaStoryboardRequest,
  gammaSinglePageRequests,
  gammaFetch,
  pollGammaGeneration,
  downloadGammaExportFile,
  promoteGammaSceneAsset,
  promoteGammaThumbnailAsset
} = require("./lib/gamma_system");
const { buildAudioPerformancePackage, produceAudioAssets, validateExternalAudioRecord } = require("./lib/audio_system");
const { discoverThemeMusic } = require("./lib/music_discovery");
const { buildRenderPlan, renderEpisode, renderApprovalBundle, verifyRenderAssetHashes } = require("./lib/render_system");
const {
  REVIEW_ROLES, buildReviewTasks, buildQueues, reviewCoverage, buildDependencyMap,
  captureSnapshot, compareSnapshots, buildReviewManifest, buildFinalSignoffBundle, reviewExportMarkdown
} = require("./lib/editorial_cockpit");
const {
  sha256Value: sha256PublishingValue,
  buildMetadataPackage, buildComplianceReport, buildPublishingPackage,
  buildPublishingVerification, writePublishingArtifacts, refreshAccessToken,
  initiateResumableUpload, queryResumableOffset, uploadVideoChunks,
  pollVideoProcessing, uploadThumbnail, uploadCaptions, verifyRemotePublication,
  updateVideoRelease, redactPublishingPackage
} = require("./lib/publishing_system");
const { validateStructure, runEditorialAudit } = require("./lib/quality");
const { StudioRegistry, scoreEpisodeFit, buildStudioBlueprint, assessResearchPolicy, hashObject } = require("./lib/studios");
const {
  buildAudienceProfile, buildChannelStrategy, assessEpisodeStrategy,
  strategyRecordFromEpisode, strategyRecordFromOpportunity
} = require("./lib/audience_strategy");
const {
  LIFECYCLE, scoreOpportunity, buildCannibalizationReport, clusterOpportunities,
  buildPortfolioReport, buildCompetitorMap, buildSignalCoverage, buildSeriesPlan, buildEditorialCalendar, discoverStudioSeeds,
  discoverMediaWiki, transitionLifecycle, opportunityToBrief
} = require("./lib/opportunities");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const EPISODES_DIR = path.resolve(process.env.FOUNDRY_EPISODES_DIR || path.join(ROOT, "episodes"));
const DATA_DIR = path.resolve(process.env.FOUNDRY_DATA_DIR || path.join(ROOT, "data"));
const DATABASE_PATH = path.join(DATA_DIR, "foundry.sqlite3");
const BUILTIN_STUDIOS_DIR = path.join(ROOT, "studios", "builtin");
const CUSTOM_STUDIOS_DIR = path.resolve(process.env.FOUNDRY_CUSTOM_STUDIOS_DIR || path.join(ROOT, "studios", "custom"));
const BUILTIN_CONNECTORS_DIR = path.join(ROOT, "connectors", "builtin");
const CUSTOM_CONNECTORS_DIR = path.resolve(process.env.FOUNDRY_CUSTOM_CONNECTORS_DIR || path.join(ROOT, "connectors", "custom"));
const BODY_LIMIT_BYTES = Number(process.env.BODY_LIMIT_BYTES || 1024 * 1024);
const AUTH_TOKEN = process.env.FOUNDRY_AUTH_TOKEN || "";
const LOCAL_SESSION_TOKEN = crypto.randomBytes(32).toString("hex");

if (!["127.0.0.1", "localhost", "::1"].includes(HOST) && !AUTH_TOKEN) {
  throw new Error("FOUNDRY_AUTH_TOKEN is required when HOST is not loopback.");
}

ensureDir(DATA_DIR);
const database = new FoundryDatabase(DATABASE_PATH);
const studioRegistry = new StudioRegistry({ builtinDir: BUILTIN_STUDIOS_DIR, customDir: CUSTOM_STUDIOS_DIR, database });
const connectorRegistry = new ConnectorRegistry({ builtinDir: BUILTIN_CONNECTORS_DIR, customDir: CUSTOM_CONNECTORS_DIR, database });

const stageDefinitions = [
  "Opportunity intelligence and portfolio fit",
  "Audience and channel strategy fit",
  "Studio selection and fit validation",
  "Episode brief",
  "Connector research and source hierarchy",
  "Claim graph and conflict audit",
  "Narrative architecture and script passes",
  "Visual language, assets, and provenance",
  "Audio host, pronunciation, and performance plan",
  "Deterministic validation",
  "Editorial audit",
  "Duplicate and safety audit",
  "Gamma storyboard generation",
  "Human editorial approval gate",
  "Narration synthesis, sound design, and mastering",
  "Human audio performance review",
  "Scene compositor and local video rendering",
  "Captions, thumbnail, and render QA",
  "Human render review",
  "Publishing metadata and compliance preflight",
  "Final editorial sign-off",
  "Private resumable YouTube upload",
  "YouTube processing, captions, and thumbnail",
  "Remote publication verification",
  "Controlled schedule or private release"
];

function normalizedWords(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function sourceLikelyMatchesTopic(brief, source, allSources = []) {
  const topic = String(brief?.topic || '').trim();
  const title = String(source?.title || '').trim();
  if (!topic || !title) return true;
  const normalizedTopic = topic.toLowerCase();
  const normalizedTitle = title.toLowerCase();
  const specificTopicSignals = [
    'inscription',
    'inscriptions',
    'tablet',
    'tablets',
    'manuscript',
    'manuscripts',
    'papyrus',
    'archive',
    'archives',
    'decree',
    'edict',
    'graffiti',
    'coin',
    'coins'
  ].filter((signal) => normalizedTopic.includes(signal));
  if (specificTopicSignals.length && !specificTopicSignals.some((signal) => normalizedTitle.includes(signal))) {
    return false;
  }
  const exactTitlePresent = allSources.some((item) => String(item?.title || '').trim().toLowerCase() === normalizedTopic);
  const siblingSuffixPattern = /\b(?:software|learning center|language learning|inc|company|school|schools|app|brand)\b/i;
  if (exactTitlePresent && normalizedTitle !== normalizedTopic) {
    if (normalizedTitle.startsWith(`${normalizedTopic} (`) || normalizedTitle.startsWith(`${normalizedTopic} -`) || normalizedTitle.startsWith(`${normalizedTopic}:`)) return false;
    if (normalizedTitle.startsWith(`${normalizedTopic} `) && siblingSuffixPattern.test(normalizedTitle.slice(normalizedTopic.length))) return false;
  }
  const topicWords = new Set(normalizedWords(topic));
  const titleWords = new Set(normalizedWords(title));
  let overlap = 0;
  for (const word of topicWords) if (titleWords.has(word)) overlap += 1;
  if (topicWords.size >= 2 && overlap === 0) return false;
  return true;
}

function filterTopicMatchedSources(brief, sources = []) {
  const filtered = (sources || []).filter((source) => sourceLikelyMatchesTopic(brief, source, sources));
  return filtered.length ? filtered : sources;
}

function sceneIllustrationPrompt(packet, scene, index) {
  const studioId = packet?.brief?.studio_id || packet?.episode?.studio?.id || 'generic';
  const claimMap = new Map((packet?.claims || []).map((claim) => [claim.claim_id, claim]));
  const primaryClaim = (scene.claim_ids || []).map((id) => claimMap.get(id)).find(Boolean) || null;
  const focal = scene.focal_subject
    || primaryClaim?.display_subject
    || primaryClaim?.prompt_subject
    || primaryClaim?.subject
    || primaryClaim?.source_title
    || scene.title
    || packet?.brief?.topic
    || packet?.episode?.topic
    || 'the subject';
  const topic = packet?.brief?.topic || packet?.episode?.topic || focal;
  const themedDirection =
    studioId === 'history_under_glass'
      ? `Create a museum-grade historical scene centered on ${focal}. Use artifact lighting, archival textures, period-authentic details, and historically grounded composition. If the topic is ancient Egypt or the Rosetta Stone, emphasize carved stone, hieroglyphic inscriptions, parchment, desert-mineral palette, and exhibit-quality object framing.`
      : studioId === 'failure_atlas'
        ? `Create a precise evidence-led technical scene centered on ${focal}. Use analytical diagrams, causal overlays, and grounded mechanical detail rather than generic spectacle.`
        : studioId === 'practical_open_source'
          ? `Create a clean, productively useful explainer scene centered on ${focal}. Use software workflow visuals, diagrams, terminals, and concrete interface evidence.`
          : `Create a vivid themed scene centered on ${focal} with specific topic-appropriate props and environments for ${topic}.`;
  return [
    themedDirection,
    `Scene purpose: ${scene.body || scene.objective || scene.title}`,
    `Required visual treatment: ${((scene.visual_requirements || []).join('; ') || 'Keep the focal subject unmistakable and topic-specific.')}`,
    `Avoid: generic templates, unrelated brands, off-topic sibling entities, stock-looking filler, and flat backgrounds.`
  ].join(' ');
}

const integrationCatalog = [
  {
    key: "rules",
    name: "Rules Engine",
    env: [],
    detail: "Claim-bound deterministic drafting, full archetype scripts, timing plans, and evidence citations"
  },
  {
    key: "gamma",
    name: "Gamma",
    env: ["GAMMA_API_KEY"],
    detail: "Storyboard card generation"
  },
  {
    key: "elevenlabs",
    name: "ElevenLabs",
    env: ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"],
    detail: "Scene-level narration, mastering, procedural reference sound design, caching, and audio QA"
  },
  {
    key: "youtube",
    name: "YouTube Publishing",
    env: ["YOUTUBE_CLIENT_ID", "YOUTUBE_REFRESH_TOKEN"],
    detail: "Resumable private upload, processing verification, captions, thumbnail, and guarded scheduling"
  },
  {
    key: "mediawiki",
    name: "MediaWiki Research",
    env: [],
    detail: "Live revisioned source retrieval with local snapshots"
  },
  {
    key: "ollama",
    name: "Ollama Structured Generator",
    env: ["OLLAMA_MODEL"],
    detail: "Optional JSON-schema question drafting with deterministic fallback"
  },
  {
    key: "jamendo",
    name: "Jamendo Music Discovery",
    env: ["JAMENDO_CLIENT_ID"],
    detail: "Live thematic music discovery for studio-safe background track candidates"
  }
];

let state = database.getCurrentEpisode();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeText(filePath, payload) {
  fs.writeFileSync(filePath, payload.endsWith("\n") ? payload : `${payload}\n`);
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isLiveIntegration(item) {
  if (item.key === "rules") return true;
  if (item.key === "youtube") return Boolean(process.env.YOUTUBE_ACCESS_TOKEN || (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN));
  return item.env.every((key) => Boolean(process.env[key]));
}

function getIntegrations() {
  return integrationCatalog.map((item) => ({
    name: item.name,
    key: item.key,
    mode: isLiveIntegration(item) ? "live" : "mock",
    detail: item.detail
  }));
}

function makeSourcePacket(brief) {
  return brief.source_queries.map((query, index) => ({
    title: query,
    source_url: `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`,
    extract:
      index === 0
        ? "Dinosaurs were a diverse group of reptiles that first appeared during the Triassic period."
        : index === 1
          ? "Fossils are preserved remains, impressions, or traces of ancient organisms."
          : `${query} is included in the source packet to support source-grounded question writing.`
  }));
}

function sanitizeFact(text) {
  return String(text || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferTopicPack(brief, sourcePacket) {
  const haystack = `${brief.topic} ${brief.source_queries.join(" ")} ${sourcePacket
    .map((source) => source.title)
    .join(" ")}`.toLowerCase();

  if (/(dinosaur|fossil|animal|biology|science|space|planet|nature)/.test(haystack)) {
    return "science_nature";
  }
  if (/(country|capital|map|river|mountain|continent|ocean|geography)/.test(haystack)) {
    return "geography";
  }
  if (/(history|empire|ancient|war|president|civilization|museum)/.test(haystack)) {
    return "history";
  }
  return "general";
}

function splitIntoSentences(text) {
  return sanitizeFact(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 35);
}

function titleCase(value) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item).toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function removeLeadingArticle(text) {
  return String(text).replace(/^(a|an|the)\s+/i, "").trim();
}

function extractTriassicFact(sentence) {
  const match = sentence.match(/first appeared during the ([^.]+?) period/i);
  if (!match) {
    return null;
  }
  const answer = titleCase(match[1]);
  return {
    kind: "period",
    question: "During which period did dinosaurs first appear?",
    answer,
    distractors: ["Jurassic", "Cretaceous", "Ice Age"],
    explanation: sanitizeFact(sentence)
  };
}

function extractDefinitionFact(sentence, source) {
  const match = sentence.match(/^([A-Z][a-z]+(?:\s+[a-z]+)*)\s+are\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const subject = titleCase(match[1]);
  const predicate = sanitizeFact(match[2]).replace(/\.$/, "");
  const answer = removeLeadingArticle(predicate);
  return {
    kind: "definition",
    question: `Which description best matches ${subject}?`,
    answer,
    distractors: [
      `modern devices used in ${source.title.toLowerCase()} labs`,
      `weather patterns seen only in storms`,
      `signals sent by satellites`
    ],
    explanation: sanitizeFact(sentence)
  };
}

function extractFirstAppearedFact(sentence, source) {
  const match = sentence.match(/^([A-Z][a-z]+(?:\s+[a-z]+)*)\s+were\s+a\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const subject = titleCase(match[1]);
  const description = removeLeadingArticle(sanitizeFact(match[2]).replace(/\.$/, ""));
  return {
    kind: "classification",
    question: `Which description best fits ${subject}?`,
    answer: description,
    distractors: [
      `a modern machine used in ${source.title.toLowerCase()} labs`,
      "a weather pattern seen over oceans",
      "a type of handheld electronic device"
    ],
    explanation: sanitizeFact(sentence)
  };
}

function extractIncludedFact(sentence, source) {
  if (!/included in the source packet/i.test(sentence)) {
    return null;
  }
  const subject = titleCase(source.title);
  return {
    kind: "inclusion",
    question: `What is the purpose of including ${subject} in the source packet?`,
    answer: "To support source-grounded question writing",
    distractors: [
      "To remove human approval",
      "To skip the render step",
      "To publish videos automatically"
    ],
    explanation: sanitizeFact(sentence)
  };
}

function extractTraceFact(sentence) {
  const match = sentence.match(/traces of (.+)$/i);
  if (!match) {
    return null;
  }
  const answer = removeLeadingArticle(sanitizeFact(match[1]).replace(/\.$/, ""));
  return {
    kind: "trace",
    question: "Fossils can include traces of what?",
    answer,
    distractors: [
      "today's weather reports",
      "modern city traffic",
      "digital phone signals"
    ],
    explanation: sanitizeFact(sentence)
  };
}

function extractSupportFact(sentence, source) {
  const subject = titleCase(source.title);
  return {
    kind: "support",
    question: `Why is ${subject} included in this episode's source packet?`,
    answer: "To support source-grounded question writing",
    distractors: [
      "To replace the approval checklist",
      "To publish the video automatically",
      "To remove the need for captions"
    ],
    explanation: sanitizeFact(sentence)
  };
}

function deriveQuestionFact(sentence, source) {
  return (
    extractTriassicFact(sentence) ||
    extractDefinitionFact(sentence, source) ||
    extractFirstAppearedFact(sentence, source) ||
    extractIncludedFact(sentence, source) ||
    extractTraceFact(sentence) ||
    extractSupportFact(sentence, source)
  );
}

function buildDistractors(correct, fallbackPool) {
  const distractors = [];
  fallbackPool.forEach((item) => {
    const candidate = String(item).trim();
    if (
      candidate &&
      candidate.toLowerCase() !== String(correct).toLowerCase() &&
      !distractors.some((existing) => existing.toLowerCase() === candidate.toLowerCase())
    ) {
      distractors.push(candidate);
    }
  });

  const reserve = ["Weather radar", "Traffic signs", "Ocean tides", "Volcano smoke"];
  reserve.forEach((candidate) => {
    if (
      distractors.length < 3 &&
      candidate.toLowerCase() !== String(correct).toLowerCase() &&
      !distractors.some((existing) => existing.toLowerCase() === candidate.toLowerCase())
    ) {
      distractors.push(candidate);
    }
  });

  return uniqueItems(distractors).slice(0, 3);
}

function sourcePacketPlaceholderUrl(brief) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(brief.source_queries[0] || brief.topic)}`;
}

function makeTopicQuestion(sourcePacket, brief, index, pack) {
  const primary = sourcePacket[0]?.title || brief.topic;
  const reserveByPack = {
    science_nature: ["Space travel", "Ancient pottery", "Ocean storms"],
    geography: ["Rocket engines", "Poetry writing", "Dinosaur bones"],
    history: ["Volcano pressure", "Deep-sea coral", "Smartphone apps"],
    general: ["Space travel", "Ancient pottery", "Ocean storms"]
  };
  const distractors = uniqueItems([
    ...sourcePacket.map((source) => source.title).filter((title) => title !== primary),
    ...reserveByPack[pack]
  ]).slice(0, 3);
  return {
    question_id: `Q${index + 1}`,
    question: `Which topic is the best fit for this episode brief about ${brief.topic}?`,
    options: [primary, ...distractors],
    correct_option_index: 0,
    answer: primary,
    explanation: `The brief is grounded in the supplied source packet, beginning with ${primary}.`,
    source_urls: [sourcePacket[0]?.source_url || sourcePacketPlaceholderUrl(brief)],
    difficulty: "easy"
  };
}

function makeSentenceQuestion(sentence, source, index, fallbackPool) {
  const fact = deriveQuestionFact(sentence, source);
  const cleaned = sanitizeFact(sentence);
  const answer = fact ? fact.answer : titleCase(cleaned.split(" ").slice(0, 2).join(" "));
  const distractors = uniqueItems([
    ...(fact ? fact.distractors : []),
    ...buildDistractors(answer, fallbackPool)
  ]).slice(0, 3);
  return {
    question_id: `Q${index + 1}`,
    question: fact ? fact.question : `Which statement is supported by the source about ${source.title}?`,
    options: [answer, ...distractors],
    correct_option_index: 0,
    answer,
    explanation: fact ? fact.explanation : cleaned,
    source_urls: [source.source_url],
    difficulty: index < 2 ? "easy" : index < 4 ? "medium" : "hard"
  };
}

function makeWorkflowQuestion(brief, index) {
  const templates = [
    {
      question: "What should happen before narration and rendering begin?",
      answer: "A human approval review",
      distractors: ["Automatic public upload", "Thumbnail deletion", "Comment moderation"],
      explanation: "The workflow intentionally pauses for human approval before narration or rendering continues."
    },
    {
      question: "How should the finished YouTube upload be handled first?",
      answer: "Uploaded privately",
      distractors: ["Published publicly", "Discarded immediately", "Turned into a livestream"],
      explanation: "The system prepares a private upload first so a human can review the episode before publication."
    },
    {
      question: "Why are question cards and answer cards separated?",
      answer: "To avoid revealing answers too early",
      distractors: ["To shorten the video", "To remove captions", "To lower file size"],
      explanation: "Separating question and answer cards prevents viewers from seeing the answer before the countdown ends."
    }
  ];

  const template = templates[index % templates.length];
  return {
    question_id: `Q${index + 1}`,
    question: template.question,
    options: [template.answer, ...template.distractors],
    correct_option_index: 0,
    answer: template.answer,
    explanation: template.explanation,
    source_urls: [sourcePacketPlaceholderUrl(brief)],
    difficulty: "medium"
  };
}

function makePackQuestion(pack, brief, sourcePacket, index) {
  const firstSource = sourcePacket[0]?.source_url || sourcePacketPlaceholderUrl(brief);
  const packs = {
    science_nature: [
      {
        question: "What kind of evidence can fossils provide?",
        answer: "Clues about ancient life",
        distractors: ["Tomorrow's weather forecast", "Modern traffic patterns", "Phone battery levels"],
        explanation: "Fossils help explain what living things and environments were like long ago."
      },
      {
        question: "Why is one correct answer especially important in a science-themed quiz?",
        answer: "So each fact stays clear and testable",
        distractors: ["So every option can be partly true", "So viewers guess faster", "So the source packet is ignored"],
        explanation: "Science questions work best when the supported fact is specific and unambiguous."
      }
    ],
    geography: [
      {
        question: "What makes a geography question easier to follow on screen?",
        answer: "A single clear place-based fact",
        distractors: ["A long paragraph with many locations", "Three correct options at once", "No source citation at all"],
        explanation: "Geography questions are easier to answer when each one centers on one clear place-based fact."
      },
      {
        question: "Why should a map-based quiz avoid misleading distractors?",
        answer: "So the challenge stays fair and readable",
        distractors: ["So every answer can be right", "So captions can be skipped", "So timing becomes random"],
        explanation: "Fair distractors make a geography quiz challenging without becoming confusing."
      }
    ],
    history: [
      {
        question: "Why should history questions stay closely tied to cited sources?",
        answer: "To avoid disputed or fuzzy claims",
        distractors: ["To make every answer longer", "To remove the approval gate", "To prevent subtitles from being added"],
        explanation: "History topics often need careful sourcing so each answer remains clearly supported."
      },
      {
        question: "What makes a history question safer for a family audience?",
        answer: "Clear facts without graphic detail",
        distractors: ["Ambiguous dates and events", "Multiple correct answers", "Shock value over clarity"],
        explanation: "Family-safe history content should stay informative without leaning on graphic or confusing material."
      }
    ],
    general: [
      {
        question: "Why does the workflow require source-grounded questions?",
        answer: "To keep each answer supportable",
        distractors: ["To remove editing entirely", "To publish automatically", "To skip captions and thumbnails"],
        explanation: "Grounding each question in a source packet makes the episode easier to review and trust."
      },
      {
        question: "What helps a quiz episode feel varied instead of repetitive?",
        answer: "A distinct story premise and question mix",
        distractors: ["Using the same slide forever", "Removing explanations", "Skipping human review"],
        explanation: "Story framing and varied question types help the episode feel like an adventure rather than a repeated template."
      }
    ]
  };

  const template = packs[pack][index % packs[pack].length];
  return {
    question_id: `Q${index + 1}`,
    question: template.question,
    options: [template.answer, ...template.distractors],
    correct_option_index: 0,
    answer: template.answer,
    explanation: template.explanation,
    source_urls: [firstSource],
    difficulty: index < 2 ? "easy" : "medium"
  };
}

function generateRuleBasedEpisode(brief, sourcePacket) {
  const count = Number(brief.question_count) || 6;
  const pack = inferTopicPack(brief, sourcePacket);
  const episode = {
    episode_id: `${slugify(brief.working_title)}-${new Date().toISOString().slice(0, 10)}`,
    title: brief.working_title,
    story_premise: brief.story_premise,
    age_band: brief.age_band,
    audience_mode: brief.audience_mode,
    contains_synthetic_media: brief.contains_synthetic_media,
    intro_narration: `Welcome to ${brief.working_title}. ${brief.story_premise}`,
    questions: [],
    outro_narration: "Mission complete. Count your score, review what you learned, and try again for a perfect run.",
    visual_direction: brief.visual_direction
  };

  const fallbackPool = sourcePacket.map((source) => source.title);
  episode.questions.push(makeTopicQuestion(sourcePacket, brief, episode.questions.length, pack));

  sourcePacket.forEach((source) => {
    splitIntoSentences(source.extract).forEach((sentence) => {
      if (episode.questions.length < count) {
        episode.questions.push(
          makeSentenceQuestion(sentence, source, episode.questions.length, fallbackPool)
        );
      }
    });
  });

  while (episode.questions.length < Math.min(count, 4)) {
    episode.questions.push(makePackQuestion(pack, brief, sourcePacket, episode.questions.length));
  }

  while (episode.questions.length < count - 1) {
    episode.questions.push(makeWorkflowQuestion(brief, episode.questions.length));
  }

  while (episode.questions.length < count) {
    episode.questions.push(makePackQuestion(pack, brief, sourcePacket, episode.questions.length));
  }

  episode.questions = episode.questions.slice(0, count);
  return { episode, pack };
}

function validateEpisode(episode, brief) {
  const issues = [];

  if (!Array.isArray(episode.questions) || episode.questions.length !== Number(brief.question_count)) {
    issues.push(`Expected ${brief.question_count} questions.`);
  }

  episode.questions.forEach((question, index) => {
    if (!Array.isArray(question.options) || question.options.length !== 4) {
      issues.push(`Question ${index + 1} must have exactly four options.`);
    }
    if (new Set(question.options || []).size !== 4) {
      issues.push(`Question ${index + 1} options must be unique.`);
    }
    if (typeof question.correct_option_index !== "number" || question.correct_option_index < 0 || question.correct_option_index > 3) {
      issues.push(`Question ${index + 1} has an invalid correct option index.`);
    }
    if (!question.source_urls || question.source_urls.length === 0) {
      issues.push(`Question ${index + 1} must cite at least one source URL.`);
    }
    if ((question.options || [])[question.correct_option_index] !== question.answer) {
      issues.push(`Question ${index + 1} answer must match the correct option.`);
    }
  });

  return {
    passed: issues.length === 0,
    issues,
    checks: [
      "Exactly four options per question",
      "Unique answer options",
      "Correct answer matches selected option",
      "Source URL recorded for every question",
      "Question count matches the brief"
    ]
  };
}

function makeGammaInput(episode, scriptPackage = null) {
  if (scriptPackage?.scenes?.length && episode.production_mode === "full_archetype_script") {
    const blocks = [`# ${episode.title}`, "", episode.story_premise, "", `Narrative mode: ${episode.story_engine?.narrative_mode || "specialist programme"}`, ""];
    scriptPackage.scenes.forEach((scene, index) => {
      blocks.push(`## Scene ${index + 1}: ${scene.title}`);
      blocks.push(`Purpose: ${scene.objective}`);
      blocks.push(`Narration: ${scene.narration}`);
      blocks.push(`Visual requirements: ${(scene.visual_requirements || []).join("; ")}`);
      blocks.push(`Evidence claims: ${(scene.claim_ids || []).join(", ") || "narrative bridge only"}`);
      blocks.push(`Illustration prompt: ${sceneIllustrationPrompt({ episode, brief: { topic: episode.topic, studio_id: episode.studio?.id || null } }, scene, index)}`);
      blocks.push("");
    });
    return blocks.join("\n");
  }
  const blocks = [`# ${episode.title}`, "", episode.story_premise, ""];
  episode.questions.forEach((question, index) => {
    blocks.push(`## Question ${index + 1}`);
    blocks.push(question.question);
    question.options.forEach((option, optionIndex) => {
      blocks.push(`${String.fromCharCode(65 + optionIndex)}. ${option}`);
    });
    blocks.push("");
    blocks.push(`## Answer ${index + 1}`);
    blocks.push(`${question.answer} — ${question.explanation}`);
    blocks.push("");
  });
  blocks.push("## Final score");
  blocks.push("Great mission run. Count your score and try again.");
  return blocks.join("\n");
}

function makeVisualManifest(packet) {
  if (packet.visual_plan?.scene_plans?.length && packet.visual_identity) {
    return {
      schema: "nichefoundry.visual_manifest.phase7.v1",
      episode_id: packet.episode.episode_id,
      studio_id: packet.brief.studio_id,
      archetype_id: packet.brief.archetype_id,
      visual_identity_hash: packet.visual_identity.identity_hash,
      design_tokens: packet.visual_identity,
      thumbnail_plan: packet.thumbnail_plan,
      cards: packet.visual_plan.scene_plans.map((scene, index) => ({
        card_id: scene.scene_id,
        type: scene.kind,
        headline: scene.title,
        body: scene.objective,
        layout: scene.composition,
        preview_path: scene.preview_path,
        claim_ids: scene.claim_ids,
        source_ids: scene.source_ids,
        visual_requirements: scene.visual_requirements,
        motion: scene.motion_cue,
        safe_area: scene.safe_area,
        evidence_overlay: scene.evidence_overlay,
        focal_subject: scene.focal_subject,
        illustration_prompt: sceneIllustrationPrompt(packet, scene, index),
        phase7_asset_id: scene.preview_asset_id,
        scene_index: index
      })),
      phase_scope: "Phase 7 generated and provenance-tracked storyboard previews; final cinematic composition remains Phase 9."
    };
  }
  if (packet.script_package?.scenes?.length && packet.episode?.production_mode === "full_archetype_script") {
    const visual = packet.studio_blueprint?.visual_direction || {};
    const palette = visual.palette?.length ? visual.palette : ["charcoal", "ivory", "signal accent"];
    const cards = packet.script_package.scenes.map((scene, index) => ({
      card_id: scene.scene_id,
      type: index === 0 ? "narrative_hook" : index === packet.script_package.scenes.length - 1 ? "narrative_conclusion" : "narrative_scene",
      headline: scene.title,
      body: scene.objective,
      supporting_text: scene.narration,
      layout: `archetype_${packet.brief.archetype_id}`,
      palette,
      visual_language: visual.language || [],
      forbidden_visuals: visual.forbidden || [],
      source_ids: scene.source_ids || [],
      claim_ids: scene.claim_ids || [],
      illustration_prompt: [
        sceneIllustrationPrompt(packet, { ...scene, body: scene.objective }, index),
        `Overall direction: ${packet.brief.visual_direction}`,
        `Do not use: ${(visual.forbidden || []).join("; ")}`
      ].join(" "),
      motion: (visual.motion_rules || ["restrained evidence-led motion"])[index % Math.max(1, (visual.motion_rules || []).length || 1)] || "restrained evidence-led motion"
    }));
    return {
      episode_id: packet.episode.episode_id,
      studio_id: packet.brief.studio_id,
      archetype_id: packet.brief.archetype_id,
      narrative_mode: packet.narrative_blueprint?.narrative_mode || null,
      palette,
      cards,
      phase_scope: "Phase 6 scene storyboard contract; final visual composition belongs to Phase 7 and Phase 9."
    };
  }
  const packThemes = {
    science_nature: {
      palette: ["fern", "amber", "sky"],
      backdrop: "lush field journal world with discovery lighting",
      icon_tags: ["magnifier", "leaf", "fossil", "compass"],
      motion_style: "slow push-in with floating dust particles"
    },
    geography: {
      palette: ["sea", "sand", "sunset"],
      backdrop: "atlas-inspired expedition wall with map textures",
      icon_tags: ["map", "globe", "flag", "compass"],
      motion_style: "gentle pan across layered map cutouts"
    },
    history: {
      palette: ["parchment", "bronze", "navy"],
      backdrop: "museum archive with artifact silhouettes",
      icon_tags: ["scroll", "torch", "laurel", "timeline"],
      motion_style: "slow parallax over archival paper layers"
    },
    general: {
      palette: ["coral", "teal", "gold"],
      backdrop: "storybook challenge board with playful texture",
      icon_tags: ["star", "spark", "badge", "path"],
      motion_style: "light bobbing cards with subtle glow"
    }
  };

  const theme = packThemes[packet.generation.pack] || packThemes.general;
  const cards = [];

  cards.push({
    card_id: "cover",
    type: "cover",
    headline: packet.episode.title,
    body: packet.episode.story_premise,
    layout: "hero_title",
    palette: theme.palette,
    backdrop: theme.backdrop,
    icon_tags: theme.icon_tags,
    illustration_prompt: `Create a bold ${packet.generation.pack} quiz cover for kids ages ${packet.episode.age_band}. Use a ${theme.backdrop} backdrop, cinematic lighting, and a sense of adventure around "${packet.episode.title}".`,
    motion: theme.motion_style
  });

  cards.push({
    card_id: "mission_brief",
    type: "mission_brief",
    headline: "Mission Brief",
    body: packet.episode.intro_narration,
    layout: "briefing_panel",
    palette: theme.palette,
    backdrop: theme.backdrop,
    icon_tags: theme.icon_tags,
    illustration_prompt: `Build a mission briefing card for "${packet.episode.title}" with friendly adventure energy, readable text zones, and visual cues for ${packet.brief.topic}.`,
    motion: "panel reveal with layered sticker elements"
  });

  packet.episode.questions.forEach((question, index) => {
    const optionLetters = ["A", "B", "C", "D"];
    cards.push({
      card_id: `${question.question_id}_question`,
      type: "question_card",
      question_id: question.question_id,
      headline: `Question ${index + 1}`,
      body: question.question,
      answer_options: question.options.map((option, optionIndex) => ({
        label: optionLetters[optionIndex],
        text: option
      })),
      layout: "question_grid",
      palette: theme.palette,
      backdrop: theme.backdrop,
      icon_tags: theme.icon_tags,
      illustration_prompt: `Design a clean quiz question card about ${packet.brief.topic}. Leave room for four options, keep the answer hidden, and reinforce ${question.difficulty} difficulty with energetic but readable visuals.`,
      motion: "question zoom with staggered option entrance"
    });

    cards.push({
      card_id: `${question.question_id}_countdown`,
      type: "countdown_card",
      question_id: question.question_id,
      headline: "Lock In Your Answer",
      body: `Countdown: ${packet.brief.countdown_seconds} seconds`,
      layout: "countdown_focus",
      palette: theme.palette,
      backdrop: theme.backdrop,
      icon_tags: ["timer", ...theme.icon_tags.slice(0, 2)],
      illustration_prompt: `Create a countdown card for a family quiz show with a large timer, suspense, and no answer reveal. Keep it visually connected to ${packet.episode.title}.`,
      motion: "pulse timer ring with suspense hold"
    });

    cards.push({
      card_id: `${question.question_id}_answer`,
      type: "answer_card",
      question_id: question.question_id,
      headline: `Answer ${index + 1}`,
      body: question.answer,
      supporting_text: question.explanation,
      citation: question.source_urls[0],
      layout: "answer_reveal",
      palette: theme.palette,
      backdrop: theme.backdrop,
      icon_tags: ["checkmark", ...theme.icon_tags.slice(0, 2)],
      illustration_prompt: `Design an answer reveal card for a kids knowledge show. Highlight "${question.answer}" as the single correct answer, include a small fact explainer area, and keep the scene upbeat.`,
      motion: "answer flip with confetti accent"
    });
  });

  cards.push({
    card_id: "final_score",
    type: "final_score",
    headline: "Mission Complete",
    body: packet.episode.outro_narration,
    layout: "score_wrap",
    palette: theme.palette,
    backdrop: theme.backdrop,
    icon_tags: ["trophy", "star", "badge"],
    illustration_prompt: `Create a final score card for "${packet.episode.title}" with celebration, room for score text, and a replay invitation for kids.`,
    motion: "score burst and badge settle"
  });

  return {
    episode_id: packet.episode.episode_id,
    pack: packet.generation.pack,
    theme,
    cards
  };
}

function makeApprovalChecklist(packet) {
  const studioName = packet.studio_blueprint?.studio?.name || packet.episode?.studio?.name || "Selected studio";
  const archetypeName = packet.studio_blueprint?.archetype?.name || packet.episode?.content_archetype?.name || "content archetype";
  const studioChecks = packet.studio_blueprint?.compliance?.required_checks || [];
  return [
    "# Phase 8 Audience, Evidence, Story, Visual, Host, and Audio Planning Approval Checklist",
    "",
    `Episode: ${packet.episode.title}`,
    `Episode ID: ${packet.episode.episode_id}`,
    `Studio: ${studioName}`,
    `Archetype: ${archetypeName}`,
    "",
    "- [ ] The topic genuinely fits the selected Studio Pack and channel promise.",
    `- [ ] The named persona (${packet.audience_fit_report?.audience_fit?.persona?.name || "unresolved"}) is the intended viewer.`,
    `- [ ] The primary viewer job (${packet.audience_fit_report?.audience_fit?.viewer_job?.label || "unresolved"}) is explicit and genuinely served.`,
    `- [ ] The content pillar (${packet.audience_fit_report?.audience_fit?.content_pillar?.name || "unresolved"}) is appropriate for this episode.`,
    "- [ ] The projected portfolio and fatigue reports do not indicate harmful repetition.",
    "- [ ] The output format and likely next action fit the selected audience.",
    "- [ ] The selected hook is supported, proportionate, and suitable for the named viewer.",
    "- [ ] The required story beats are present and bound to relevant claims.",
    "- [ ] Every scene has an objective, retention device, evidence boundary, and useful transition.",
    "- [ ] The evidence, structure, audience, spoken-language, timing, originality, and sensationalism passes were reviewed.",
    "- [ ] The Studio Pack visual identity, typography, colour contrast, grid, safe areas, diagram grammar, and motion rules are appropriate.",
    "- [ ] Every scene has a distinct composition, focal subject, evidence overlay, and storyboard preview.",
    "- [ ] Asset provenance, creator, licence, rights status, synthetic-media state, source IDs, and claim IDs were reviewed.",
    "- [ ] The thumbnail concept accurately promises the episode, remains legible, and uses no more than seven visible headline words.",
    "- [ ] The visual similarity report shows substantive variation from recent episodes and within the current scene sequence.",
    `- [ ] The evidence-bounded duration (${packet.script_package?.estimated_duration_minutes || "unresolved"} minutes) is appropriate for the available claims.`,
    "- [ ] Source titles, canonical URLs, revision IDs, retrieval times, and hashes were reviewed.",
    "- [ ] Every approved answer is bound to one atomic claim and exact supporting passage.",
    "- [ ] Every question has only one defensible correct answer.",
    "- [ ] Distractors are distinct and do not accidentally become correct.",
    "- [ ] No question asks about prompts, sources, approval, rendering, uploads, or the production workflow.",
    "- [ ] Topic relevance and age-band readability are acceptable.",
    "- [ ] The duplicate audit contains no blocking match.",
    ...studioChecks.map((item) => `- [ ] Studio compliance: ${item}.`),
    "- [ ] Audience classification and synthetic-media disclosure are correct.",
    "- [ ] The approval bundle hash is current and unchanged."
  ].join("\n");
}

function makeNarrationManifest(packet) {
  if (packet.script_package?.scenes?.length && packet.episode?.production_mode === "full_archetype_script") {
    return {
      voice_id: process.env.ELEVENLABS_VOICE_ID || "mock-voice",
      model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
      studio_voice: packet.studio_blueprint?.voice || null,
      estimated_total_seconds: packet.script_package.estimated_duration_seconds,
      scenes: packet.script_package.scenes.map((scene, index) => ({
        filename: `${String(index).padStart(3, "0")}_${scene.scene_id}.mp3`,
        scene_id: scene.scene_id,
        beat_name: scene.beat_name,
        role: "main_host",
        text: scene.narration,
        word_count: scene.word_count,
        estimated_duration_seconds: scene.estimated_duration_seconds,
        pronunciation_domains: packet.studio_blueprint?.voice?.pronunciation_domains || []
      }))
    };
  }
  let sceneNumber = 0;
  const nextFilename = (label) => {
    const filename = `${String(sceneNumber).padStart(3, "0")}_${label}.mp3`;
    sceneNumber += 1;
    return filename;
  };

  const scenes = [
    {
      filename: nextFilename("cover"),
      role: "main_host",
      text: packet.episode.title
    },
    {
      filename: nextFilename("intro"),
      role: "main_host",
      text: packet.episode.intro_narration
    }
  ];

  packet.episode.questions.forEach((question) => {
    scenes.push({
      filename: nextFilename("question"),
      role: "main_host",
      text: question.question
    });
    scenes.push({
      filename: nextFilename("answer"),
      role: "answer_reveal",
      text: `${question.answer}. ${question.explanation}`
    });
  });

  scenes.push({
    filename: nextFilename("outro"),
    role: "main_host",
    text: packet.episode.outro_narration
  });

  return {
    voice_id: process.env.ELEVENLABS_VOICE_ID || "mock-voice",
    model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
    scenes
  };
}

function makeScriptManifest(packet) {
  if (packet.script_package?.scenes?.length && packet.episode?.production_mode === "full_archetype_script") {
    return {
      episode_id: packet.episode.episode_id,
      studio: packet.episode.studio || null,
      archetype: packet.episode.content_archetype || null,
      narrative_blueprint: packet.narrative_blueprint || null,
      tone: packet.studio_blueprint?.voice?.tone || "evidence-led specialist narration",
      cast: { main_host: "Primary specialist narrator voice" },
      total_words: packet.script_package.word_count,
      estimated_duration_seconds: packet.script_package.estimated_duration_seconds,
      scenes: packet.script_package.scenes.map((scene) => ({
        scene_id: scene.scene_id,
        card_id: scene.scene_id,
        beat_id: scene.beat_id,
        beat_name: scene.beat_name,
        role: "main_host",
        objective: scene.objective,
        on_screen_text: scene.title,
        voiceover: scene.narration,
        claim_ids: scene.claim_ids,
        source_ids: scene.source_ids,
        visual_note: (scene.visual_requirements || []).join(" "),
        retention_device: scene.retention_device,
        duration_seconds: scene.estimated_duration_seconds
      }))
    };
  }
  const scenes = [
    {
      scene_id: "cover_intro",
      card_id: "cover",
      role: "main_host",
      objective: "Open with a strong title beat and establish the adventure premise.",
      on_screen_text: packet.episode.title,
      voiceover: packet.episode.title,
      visual_note: "Hold on the main cover art long enough for the title to land.",
      duration_seconds: 4
    },
    {
      scene_id: "mission_brief",
      card_id: "mission_brief",
      role: "main_host",
      objective: "Explain the story premise and invite the viewer into the challenge.",
      on_screen_text: "Mission Brief",
      voiceover: packet.episode.intro_narration,
      visual_note: "Reveal the mission panel with topic-specific props and character energy.",
      duration_seconds: 8
    }
  ];

  packet.episode.questions.forEach((question, index) => {
    scenes.push({
      scene_id: `${question.question_id}_read`,
      card_id: `${question.question_id}_question`,
      role: "main_host",
      objective: "Read the question clearly and pace the four choices for comprehension.",
      on_screen_text: question.question,
      voiceover: `${question.question} Option A. ${question.options[0]}. Option B. ${question.options[1]}. Option C. ${question.options[2]}. Option D. ${question.options[3]}.`,
      visual_note: "Keep option text visible while the host reads through all four choices.",
      duration_seconds: 10
    });
    scenes.push({
      scene_id: `${question.question_id}_countdown`,
      card_id: `${question.question_id}_countdown`,
      role: "countdown_host",
      objective: "Create a short suspense beat while the viewer thinks.",
      on_screen_text: "Choose now",
      voiceover: `You have ${packet.brief.countdown_seconds} seconds. Make your choice now.`,
      visual_note: "Animate the timer prominently and avoid revealing the correct answer.",
      duration_seconds: Number(packet.brief.countdown_seconds) || 5
    });
    scenes.push({
      scene_id: `${question.question_id}_reveal`,
      card_id: `${question.question_id}_answer`,
      role: "answer_reveal",
      objective: "Reveal the correct answer and teach one grounded takeaway.",
      on_screen_text: question.answer,
      voiceover: `The correct answer is ${question.answer}. ${question.explanation}`,
      visual_note: "Bring in the correct answer with a confident visual payoff and leave space for the citation.",
      duration_seconds: 7
    });
  });

  scenes.push({
    scene_id: "outro",
    card_id: "final_score",
    role: "main_host",
    objective: "Wrap up the episode, celebrate the score, and encourage replay.",
    on_screen_text: "Mission Complete",
    voiceover: packet.episode.outro_narration,
    visual_note: "Use celebratory motion and leave space for a score badge or replay CTA.",
    duration_seconds: 6
  });

  return {
    episode_id: packet.episode.episode_id,
    studio: packet.episode.studio || null,
    archetype: packet.episode.content_archetype || null,
    story_map: packet.episode.story_map || [],
    tone: packet.studio_blueprint?.voice?.tone || "warm, adventurous, family-safe, source-grounded",
    cast: {
      main_host: "Primary narrator voice",
      countdown_host: "Short suspense beat voice",
      answer_reveal: "Confident answer reveal voice"
    },
    scenes
  };
}

function makeRenderManifest(packet) {
  if (packet.audio_package) {
    packet.host_profile = packet.audio_package.host_profile;
    packet.pronunciation_lexicon = packet.audio_package.pronunciation_lexicon;
    packet.audio_performance_plan = packet.audio_package.audio_performance_plan;
    packet.sound_design_plan = packet.audio_package.sound_design_plan;
    packet.audio_preflight_report = packet.audio_package.audio_preflight_report;
    if (packet.verification?.audio_performance) packet.verification.audio_performance.passed = packet.audio_preflight_report.passed;
  }
  const visualManifest = makeVisualManifest(packet);
  const scriptManifest = makeScriptManifest(packet);

  return {
    output: {
      video: "final.mp4",
      captions: "captions.srt",
      thumbnail: "thumbnail.png"
    },
    video: {
      width: 1920,
      height: 1080,
      fps: 30,
      video_codec: "h264",
      audio_codec: "aac"
    },
    countdown_seconds: packet.brief.countdown_seconds,
    slides: visualManifest.cards.map((card, index) => ({
      card_id: card.card_id,
      type: card.type,
      asset_path: `cards/${String(index).padStart(2, "0")}_${card.card_id}.png`
    })),
    narration_order: scriptManifest.scenes.map((scene) => ({
      scene_id: scene.scene_id,
      card_id: scene.card_id,
      duration_seconds: scene.duration_seconds
    }))
  };
}

function makeUploadManifest(packet) {
  return {
    title: packet.episode.title,
    description: packet.episode.story_premise,
    privacyStatus: "private",
    notifySubscribers: false,
    selfDeclaredMadeForKids: packet.brief.audience_mode === "made_for_kids",
    containsSyntheticMedia: packet.brief.contains_synthetic_media
  };
}

const artifactDescriptions = {
  "opportunity_snapshot.json": "Immutable opportunity record or explicit manual-brief declaration used to justify production.",
  "opportunity_report.json": "Transparent opportunity score, signal provenance, cannibalisation check, cluster, and portfolio role.",
  "audience_profile_snapshot.json": "Immutable personas, motivations, frustrations, viewing contexts, viewer jobs, and desired rewards used for this episode.",
  "channel_strategy.json": "Channel promise, content pillars, portfolio distribution, fatigue analysis, and format-rotation recommendation.",
  "audience_fit_report.json": "Episode-level audience, viewer-job, channel-promise, content-pillar, and output-format assessment.",
  "fatigue_report.json": "Projected repetition and audience-fatigue checks across recent episodes and opportunities.",
  "format_rotation.json": "Recommended next pillar, archetype, output format, and viewer job based on portfolio gaps and recent streaks.",
  "brief.json": "Editorial intake packet from webhook or manual entry.",
  "studio_pack_snapshot.json": "Immutable studio constitution used for this episode, including its version and content hash.",
  "studio_fit_report.json": "Evidence-backed assessment that the topic belongs to the selected specialist studio.",
  "studio_blueprint.json": "Archetype, story beats, research policy, visual grammar, voice, compliance, and business rules for this production.",
  "connector_plan.json": "Connector execution plan, redacted inputs, run status, and provenance for every research source.",
  "research_governance.json": "Combined source hierarchy, freshness, independence, conflict, and claim-status gate.",
  "source_hierarchy.json": "Source tiers, primary-source coverage, publisher independence, and policy findings.",
  "freshness_report.json": "Time-sensitive source ages and Studio Pack freshness-policy enforcement.",
  "claim_conflict_graph.json": "Cross-source support and conflict edges with disputed-claim status.",
  "narrative_blueprint.json": "Hook alternatives, opening question, narrative tension, retention plan, and evidence-bounded duration.",
  "script_package.json": "Full scene-by-scene claim-bound programme with narration, citations, visual requirements, and critic results.",
  "timing_plan.json": "Spoken word counts and scene-level duration estimates using the Studio Pack voice rate.",
  "story_report.json": "Story-engine approval gate across evidence, structure, audience, spoken language, timing, originality, and sensationalism.",
  "visual_identity.json": "Studio-specific colour, typography, grid, safe-area, diagram, map, motion, and accessibility constitution.",
  "visual_plan.json": "Scene-by-scene composition, evidence overlay, motion cue, text budget, and storyboard contract.",
  "asset_manifest.json": "All planned and generated visual assets with scene roles, file paths, rights state, and content hashes.",
  "asset_provenance.json": "Creator, licence, source, claim, synthetic-media, and generation-input provenance for every asset.",
  "visual_asset_hashes.json": "Independent file-hash manifest for generated storyboard and thumbnail preview assets.",
  "thumbnail_plan.json": "Multiple studio-native thumbnail concepts with text budgets, focal subjects, contrast, and selection rationale.",
  "visual_similarity_report.json": "Intra-episode composition diversity and library-wide anti-template similarity audit.",
  "visual_report.json": "Phase 7 gate for visual identity, scene coverage, rights, provenance, accessibility, thumbnail legibility, and originality.",
  "script.md": "Human-readable specialist programme script bound into the approval hash.",
  "connector_runs.json": "Redacted connector run ledger for this episode.",
  "sources.json": "Retrieved source snapshots with revision metadata and content hashes.",
  "claims.json": "Atomic claim ledger binding factual statements to supporting passages.",
  "research_report.json": "Source coverage, retrieval errors, and claim sufficiency report.",
  "duplicate_report.json": "Within-episode and library-wide question similarity audit.",
  "approval_bundle.json": "Deterministic hash manifest covering research, claims, episode, and verification evidence.",
  "episode.json": "Structured episode object with narration, questions, and answers.",
  "verification.json": "Structural validation, independent editorial critic, and duplicate/safety gates.",
  "gamma_input.md": "Presentation-ready card copy for Gamma.",
  "approval_checklist.md": "Human review checklist before downstream production.",
  "visual_manifest.json": "Card-by-card visual blueprint.",
  "narration_manifest.json": "Scene-by-scene narration jobs.",
  "script_manifest.json": "Editable scene script with pacing and visual notes.",
  "render_manifest.json": "Render dimensions, assets, and timing inputs.",
  "youtube_upload.json": "Private upload metadata prepared for a verified handoff.",
  "integration_runs.json": "Recorded downstream job responses and their verified status.",
  "host_profile.json": "Studio-specific host identity, voice direction, and provider preferences.",
  "pronunciation_lexicon.json": "Reviewed pronunciation substitutions and unresolved terminology.",
  "audio_performance_plan.json": "Scene-level host, pace, energy, duration, and deterministic cache contract.",
  "sound_design_plan.json": "Music, SFX, ducking, rights, and transition plan.",
  "audio_preflight_report.json": "Pre-synthesis host and performance validation.",
  "audio_manifest.json": "Generated scene-level narration and mix manifest.",
  "audio_asset_hashes.json": "Independent hashes for every generated audio asset.",
  "loudness_report.json": "Measured programme and scene loudness evidence.",
  "audio_performance_report.json": "Post-synthesis performance and technical QA.",
  "audio_approval_bundle.json": "Hash-bound audio review packet.",
  "render_plan.json": "Profile, scene order, camera choreography, transitions, asset paths, and caption policy.",
  "caption_track.json": "Cue-level caption timing mapped to the final scene sequence.",
  "render_manifest_v2.json": "Finished compositor manifest with per-scene segment hashes and cache status.",
  "render_asset_hashes.json": "Independent hashes for final video, captions, thumbnail, and scene segments.",
  "render_qa_report.json": "Measured video, audio, subtitle, duration, black-frame, and thumbnail QA.",
  "render_approval_bundle.json": "Hash-bound finished-programme review packet.",
  "editorial_review_manifest.json": "Role-based review tasks, comments, decisions, coverage, and current artifact hashes.",
  "review_dependency_map.json": "Approval and review dependency graph across editorial, audio, render, and release stages.",
  "review_snapshot.json": "Hash manifest captured for version comparison at an editorial checkpoint.",
  "final_signoff_bundle.json": "Final accountable sign-off bound to all review tasks, approvals, and delivery artifact hashes.",
  "publishing_package.json": "Immutable local publishing preflight contract covering metadata, compliance, and delivery hashes.",
  "metadata_package.json": "YouTube title, description, tags, category, audience, synthetic-media, paid-placement, and privacy declarations.",
  "compliance_report.json": "Local release gate covering metadata limits, declarations, render QA, captions, thumbnail size, and private-default policy.",
  "youtube_upload_receipt.json": "Redacted resumable-upload receipt with returned video ID and transferred byte counts.",
  "youtube_processing_report.json": "Polled YouTube upload and processing status with failure or rejection evidence.",
  "youtube_asset_uploads.json": "Caption-track and custom-thumbnail upload receipts bound to local file hashes.",
  "publishing_verification.json": "Remote YouTube resource verification across processing, privacy, metadata, declarations, captions, and thumbnail state.",
  "release_approval_bundle.json": "Final local-and-remote release evidence bundle for the verified private or scheduled programme.",
  "editorial_audit_export.md": "Human-readable review history, open findings, dependency state, and final sign-off status.",
  "proxy.mp4": "Low-resolution editorial proxy with embedded subtitle track.",
  "final.mp4": "Final delivery video. Completion requires an ffprobe-verified video and audio stream.",
  "captions.srt": "Caption delivery artifact. Completion requires valid SRT timing syntax.",
  "thumbnail.png": "Thumbnail delivery artifact. Completion requires a recognised image signature."
};

const approvalBundleFiles = [
  "opportunity_snapshot.json",
  "opportunity_report.json",
  "audience_profile_snapshot.json",
  "channel_strategy.json",
  "audience_fit_report.json",
  "fatigue_report.json",
  "format_rotation.json",
  "brief.json",
  "studio_pack_snapshot.json",
  "studio_fit_report.json",
  "studio_blueprint.json",
  "connector_plan.json",
  "research_governance.json",
  "source_hierarchy.json",
  "freshness_report.json",
  "claim_conflict_graph.json",
  "narrative_blueprint.json",
  "script_package.json",
  "timing_plan.json",
  "story_report.json",
  "visual_identity.json",
  "visual_plan.json",
  "asset_manifest.json",
  "asset_provenance.json",
  "visual_asset_hashes.json",
  "thumbnail_plan.json",
  "visual_similarity_report.json",
  "visual_report.json",
  "host_profile.json",
  "pronunciation_lexicon.json",
  "audio_performance_plan.json",
  "sound_design_plan.json",
  "audio_preflight_report.json",
  "script.md",
  "connector_runs.json",
  "sources.json",
  "claims.json",
  "research_report.json",
  "duplicate_report.json",
  "episode.json",
  "verification.json"
];

function updateApprovalBundle(episodeDir) {
  const files = approvalBundleFiles.map((name) => {
    const filePath = path.join(episodeDir, name);
    return {
      name,
      exists: fs.existsSync(filePath),
      sha256: fs.existsSync(filePath) ? sha256File(filePath) : null
    };
  });
  const bundle = {
    schema: "nichefoundry.editorial_approval_bundle.v1",
    complete: files.every((item) => item.exists && item.sha256),
    files
  };
  const bundlePath = path.join(episodeDir, "approval_bundle.json");
  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  if (!fs.existsSync(bundlePath) || fs.readFileSync(bundlePath, "utf8") !== serialized) {
    fs.writeFileSync(bundlePath, serialized);
  }
  return bundle;
}

function updateAudioApprovalBundle(episodeDir) {
  const names = [
    "host_profile.json",
    "pronunciation_lexicon.json",
    "audio_performance_plan.json",
    "sound_design_plan.json",
    "audio_preflight_report.json",
    "audio_manifest.json",
    "audio_asset_hashes.json",
    "loudness_report.json",
    "audio_performance_report.json"
  ];
  const files = names.map((name) => {
    const filePath = path.join(episodeDir, name);
    return { name, exists: fs.existsSync(filePath), sha256: fs.existsSync(filePath) ? sha256File(filePath) : null };
  });
  const bundle = { schema: "nichefoundry.audio_approval_bundle.v1", complete: files.every((item) => item.exists && item.sha256), files };
  const bundlePath = path.join(episodeDir, "audio_approval_bundle.json");
  const serialized = `${JSON.stringify(bundle, null, 2)}
`;
  if (!fs.existsSync(bundlePath) || fs.readFileSync(bundlePath, "utf8") !== serialized) fs.writeFileSync(bundlePath, serialized);
  return bundle;
}

function updateRenderApprovalBundle(episodeDir) {
  return renderApprovalBundle(episodeDir);
}

function latestJobFor(packet, jobType) {
  return (packet.jobs || []).find((job) => job.job_type === jobType) || null;
}

function deriveStageStatuses(packet) {
  const evidence = Object.fromEntries((packet.artifact_evidence || []).map((item) => [item.name, item]));
  const opportunityPassed = Boolean(packet.verification?.opportunity_intelligence?.passed !== false && evidence["opportunity_snapshot.json"]?.verified && evidence["opportunity_report.json"]?.verified);
  const audiencePassed = Boolean(packet.verification?.audience_strategy?.passed && packet.audience_fit_report?.passed && evidence["audience_profile_snapshot.json"]?.verified && evidence["channel_strategy.json"]?.verified && evidence["audience_fit_report.json"]?.verified && evidence["fatigue_report.json"]?.verified && evidence["format_rotation.json"]?.verified);
  const studioPassed = Boolean(packet.studio_fit_report?.passed && evidence["studio_pack_snapshot.json"]?.verified && evidence["studio_blueprint.json"]?.verified);
  const researchGovernancePassed = Boolean(packet.verification?.research_governance?.passed);
  const storyPassed = Boolean(packet.verification?.story_engine?.passed && packet.story_report?.passed && evidence["narrative_blueprint.json"]?.verified && evidence["script_package.json"]?.verified && evidence["timing_plan.json"]?.verified && evidence["story_report.json"]?.verified && evidence["script.md"]?.verified);
  const visualPassed = Boolean(packet.verification?.visual_system?.passed && packet.visual_report?.passed && evidence["visual_identity.json"]?.verified && evidence["visual_plan.json"]?.verified && evidence["asset_manifest.json"]?.verified && evidence["asset_provenance.json"]?.verified && evidence["visual_asset_hashes.json"]?.verified && evidence["thumbnail_plan.json"]?.verified && evidence["visual_similarity_report.json"]?.verified && evidence["visual_report.json"]?.verified);
  const audioPlanPassed = Boolean(packet.verification?.audio_performance?.passed && packet.audio_preflight_report?.passed && evidence["host_profile.json"]?.verified && evidence["pronunciation_lexicon.json"]?.verified && evidence["audio_performance_plan.json"]?.verified && evidence["sound_design_plan.json"]?.verified && evidence["audio_preflight_report.json"]?.verified);
  const validationPassed = Boolean(packet.verification?.deterministic_validation?.passed);
  const editorialPassed = Boolean(packet.verification?.editorial_audit?.passed);
  const duplicatePassed = Boolean(packet.verification?.duplicate_and_safety?.passed);
  const approvalReady = opportunityPassed && audiencePassed && studioPassed && researchGovernancePassed && storyPassed && visualPassed && audioPlanPassed && validationPassed && editorialPassed && duplicatePassed && packet.editorial_evidence_current !== false;
  const approvalSupplied = Boolean(packet.approved && packet.approval?.artifact_hash);
  const audioProduced = Boolean(packet.audio_production?.performance_report?.passed && evidence["audio_asset_hashes.json"]?.verified && evidence["audio/episode_audio_preview.mp3"]?.verified);
  const audioApproved = Boolean(packet.audio_approved && packet.audio_approval?.valid);
  const renderProduced = Boolean(packet.render_production?.render_qa_report?.passed && evidence["render_asset_hashes.json"]?.verified && evidence["final.mp4"]?.verified);
  const renderApproved = Boolean(packet.render_approved && packet.render_approval?.valid);
  const gammaJob = latestJobFor(packet, "gamma");
  const audioJob = latestJobFor(packet, "audio_production") || latestJobFor(packet, "elevenlabs");
  const renderJob = latestJobFor(packet, "render_production");
  const uploadJob = latestJobFor(packet, "youtube_upload") || latestJobFor(packet, "youtube");
  const processingJob = latestJobFor(packet, "youtube_processing");
  const assetsJob = latestJobFor(packet, "youtube_assets");
  const verifyJob = latestJobFor(packet, "youtube_verify");
  const scheduleJob = latestJobFor(packet, "youtube_schedule");
  const publishing = packet.publishing_package || null;
  const publishingPreflight = Boolean(publishing?.preflight_passed && evidence["publishing_package.json"]?.verified && evidence["metadata_package.json"]?.verified && evidence["compliance_report.json"]?.verified);
  const uploadComplete = Boolean(publishing?.remote?.video_id && publishing?.remote?.upload?.status === "uploaded");
  const processingComplete = Boolean(publishing?.remote?.processing?.status === "processed");
  const remoteAssetsComplete = Boolean(publishing?.remote?.assets?.captions === "attached" && publishing?.remote?.assets?.thumbnail === "attached");
  const remoteVerified = Boolean(publishing?.remote?.verification?.passed);
  const releaseComplete = Boolean(publishing?.release_ready && ["scheduled", "verified_private"].includes(publishing.status));

  return stageDefinitions.map((name, index) => {
    let status = "pending";
    let evidenceRef = null;
    let detail = null;
    if (index === 0) {
      status = opportunityPassed ? "complete" : "blocked"; evidenceRef = "opportunity_report.json";
      detail = packet.opportunity_report?.mode === "manual_brief" ? "Manual brief accepted; no persisted opportunity was selected." : `Opportunity score ${packet.opportunity_report?.opportunity_score ?? "unavailable"}; ${packet.opportunity_report?.decision || "unclassified"}.`;
    } else if (index === 1) {
      status = audiencePassed ? "complete" : "blocked"; evidenceRef = "audience_fit_report.json";
      detail = audiencePassed ? `${packet.audience_fit_report?.audience_fit?.persona?.name || "Audience"}; ${packet.audience_fit_report?.audience_fit?.viewer_job?.label || "viewer job"}; fit ${packet.audience_fit_report?.audience_fit?.score ?? "unavailable"}.` : (packet.audience_fit_report?.issues || []).join(" ") || "Audience strategy is blocked.";
    } else if (index === 2) {
      status = studioPassed ? "complete" : "failed"; evidenceRef = "studio_fit_report.json"; detail = packet.studio_fit_report?.explanation || null;
    } else if (index === 3) {
      status = evidence["brief.json"]?.verified ? "complete" : "failed"; evidenceRef = "brief.json";
    } else if (index === 4) {
      status = researchGovernancePassed && evidence["sources.json"]?.verified && evidence["connector_plan.json"]?.verified && evidence["source_hierarchy.json"]?.verified && evidence["freshness_report.json"]?.verified ? "complete" : "failed"; evidenceRef = "research_governance.json";
    } else if (index === 5) {
      status = researchGovernancePassed && evidence["claims.json"]?.verified && evidence["claim_conflict_graph.json"]?.verified && evidence["episode.json"]?.verified ? "complete" : "blocked"; evidenceRef = "claim_conflict_graph.json";
    } else if (index === 6) {
      status = storyPassed ? "complete" : "blocked"; evidenceRef = "story_report.json"; detail = storyPassed ? `${packet.script_package?.scenes?.length || 0} scenes; ${packet.story_report?.grounded_claim_count || 0} grounded claims.` : (packet.story_report?.issues || []).join(" ");
    } else if (index === 7) {
      status = visualPassed ? "complete" : "blocked"; evidenceRef = "visual_report.json"; detail = visualPassed ? `${packet.visual_report?.planned_scene_count || 0} scenes; ${packet.visual_report?.unique_compositions || 0} compositions.` : (packet.visual_report?.issues || []).join(" ");
    } else if (index === 8) {
      status = audioPlanPassed ? "complete" : "blocked"; evidenceRef = "audio_preflight_report.json"; detail = audioPlanPassed ? `${packet.audio_preflight_report?.scene_count || 0} scene performances; ${packet.audio_preflight_report?.unique_host_count || 0} hosts; ${packet.audio_preflight_report?.pronunciation_entry_count || 0} pronunciation entries.` : (packet.audio_preflight_report?.issues || []).join(" ");
    } else if (index === 9) {
      status = validationPassed ? "complete" : "failed"; evidenceRef = "verification.json";
    } else if (index === 10) {
      status = editorialPassed ? "complete" : "blocked"; evidenceRef = "verification.json";
    } else if (index === 11) {
      status = duplicatePassed ? "complete" : "blocked"; evidenceRef = "duplicate_report.json";
    } else if (index === 12) {
      status = gammaJob?.status === "completed" ? "complete" : gammaJob?.status || "pending"; detail = gammaJob?.error || null;
    } else if (index === 13) {
      status = approvalSupplied ? "complete" : approvalReady ? "active" : "blocked"; evidenceRef = packet.approval?.artifact_name || "approval_bundle.json";
    } else if (index === 14) {
      status = audioProduced ? "complete" : audioJob?.status || (approvalSupplied ? "active" : "pending"); evidenceRef = "audio_performance_report.json"; detail = audioJob?.error || null;
    } else if (index === 15) {
      status = audioApproved ? "complete" : audioProduced ? "active" : "blocked"; evidenceRef = packet.audio_approval?.artifact_name || "audio_approval_bundle.json"; detail = audioProduced && !audioApproved ? "A human must review and approve the generated performance before rendering." : null;
    } else if (index === 16) {
      status = renderProduced ? "complete" : renderJob?.status || (audioApproved ? "active" : "blocked"); evidenceRef = "final.mp4"; detail = renderJob?.error || null;
    } else if (index === 17) {
      status = renderProduced && evidence["captions.srt"]?.verified && evidence["thumbnail.png"]?.verified ? "complete" : renderProduced ? "failed" : "pending"; evidenceRef = "render_qa_report.json";
    } else if (index === 18) {
      status = renderApproved ? "complete" : renderProduced ? "active" : "blocked"; evidenceRef = packet.render_approval?.artifact_name || "render_approval_bundle.json"; detail = renderProduced && !renderApproved ? "A human must watch and approve the finished programme before upload." : null;
    } else if (index === 19) {
      status = publishingPreflight ? "complete" : renderApproved ? "active" : "blocked"; evidenceRef = "compliance_report.json"; detail = publishingPreflight ? "Metadata, declarations, delivery files, and platform limits passed local preflight." : "Generate the publishing package before the publisher completes release review.";
    } else if (index === 20) {
      status = packet.final_signed_off ? "complete" : publishingPreflight ? "active" : "blocked"; evidenceRef = packet.editorial_cockpit?.final_signoff?.artifact_name || "final_signoff_bundle.json"; detail = publishingPreflight && !packet.final_signed_off ? "Complete every required review task, including release metadata, then record final sign-off." : null;
    } else if (index === 21) {
      status = uploadComplete ? "complete" : uploadJob?.status || (packet.final_signed_off && publishingPreflight ? "active" : "blocked"); evidenceRef = "youtube_upload_receipt.json"; detail = uploadJob?.error || (!packet.final_signed_off ? "A current final sign-off is required before media transfer." : null);
    } else if (index === 22) {
      status = processingComplete && remoteAssetsComplete ? "complete" : processingJob?.status === "failed" || assetsJob?.status === "failed" ? "failed" : uploadComplete ? "active" : "blocked"; evidenceRef = processingComplete ? "youtube_asset_uploads.json" : "youtube_processing_report.json"; detail = processingJob?.error || assetsJob?.error || null;
    } else if (index === 23) {
      status = remoteVerified ? "complete" : verifyJob?.status || (processingComplete && remoteAssetsComplete ? "active" : "blocked"); evidenceRef = "publishing_verification.json"; detail = verifyJob?.error || null;
    } else if (index === 24) {
      status = releaseComplete ? "complete" : scheduleJob?.status || (remoteVerified ? "active" : "blocked"); evidenceRef = "release_approval_bundle.json"; detail = scheduleJob?.error || (remoteVerified ? "Keep the programme private for final platform review or explicitly schedule a future release." : null);
    }
    return { index, name, status, evidence: evidenceRef, detail };
  });
}

function currentStageFromStatuses(statuses) {
  const firstOpen = statuses.find((stage) => stage.status !== "complete");
  return firstOpen ? firstOpen.index : statuses.length;
}

function refreshPacketEvidence(packet, { save = true } = {}) {
  if (!packet?.episode?.episode_id) return packet;
  const episodeDir = path.join(EPISODES_DIR, packet.episode.episode_id);
  packet.episode_dir = path.relative(ROOT, episodeDir);
  // Establish the parent episode row before any Phase 5-10 package tables write foreign-keyed records.
  database.upsertEpisode(packet);
  if (!packet.opportunity_snapshot) {
    packet.opportunity_snapshot = {
      schema: "nichefoundry.opportunity.legacy_manual_brief.v1",
      opportunity_id: packet.brief?.opportunity_id || null,
      studio_id: packet.brief?.studio_id || packet.episode?.studio?.id || "puzzle_planet",
      title: packet.episode?.title || packet.brief?.working_title || "Legacy episode",
      topic: packet.episode?.topic || packet.brief?.topic || "Legacy topic",
      angle: packet.episode?.story_premise || packet.brief?.story_premise || "Imported before Phase 3 opportunity intelligence.",
      discovery_source: "legacy_manual_brief",
      lifecycle: "legacy_import",
      snapshotted_at: new Date().toISOString()
    };
  }
  if (!packet.opportunity_report) {
    packet.opportunity_report = {
      passed: true,
      mode: "legacy_manual_brief",
      note: "This episode predates Phase 3. It has no market score and must be regenerated to receive a scored opportunity decision.",
      checked_at: new Date().toISOString()
    };
  }
  packet.verification = packet.verification || {};
  packet.verification.opportunity_intelligence = packet.verification.opportunity_intelligence || {
    ...packet.opportunity_report,
    passed: packet.opportunity_report.passed !== false,
    opportunity_id: packet.opportunity_snapshot.opportunity_id || null
  };
  if (!fs.existsSync(path.join(episodeDir, "opportunity_snapshot.json"))) writeJson(path.join(episodeDir, "opportunity_snapshot.json"), packet.opportunity_snapshot);
  if (!fs.existsSync(path.join(episodeDir, "opportunity_report.json"))) writeJson(path.join(episodeDir, "opportunity_report.json"), packet.opportunity_report);

  const legacyStudioId = packet.brief?.studio_id || packet.episode?.studio?.id || "puzzle_planet";
  const legacyPack = studioRegistry.get(legacyStudioId);
  if (legacyPack && (!packet.audience_profile_snapshot || !packet.channel_strategy || !packet.audience_fit_report)) {
    const history = audienceHistoryForStudio(legacyStudioId, { excludeEpisodeId: packet.episode.episode_id });
    const channelStrategy = buildChannelStrategy(legacyPack, history);
    const audienceAssessment = assessEpisodeStrategy(legacyPack, {
      working_title: packet.brief?.working_title || packet.episode?.title,
      topic: packet.brief?.topic || packet.episode?.topic,
      story_premise: packet.brief?.story_premise || packet.episode?.story_premise,
      age_band: packet.brief?.age_band || packet.episode?.age_band,
      audience_mode: packet.brief?.audience_mode || packet.episode?.audience_mode,
      archetype_id: packet.brief?.archetype_id || packet.episode?.content_archetype?.id || legacyPack.content.default_archetype,
      output_format: packet.brief?.output_format || "long_form",
      source_queries: packet.brief?.source_queries || [packet.episode?.topic].filter(Boolean)
    }, { ...history, channel_strategy: channelStrategy });
    packet.audience_profile_snapshot = channelStrategy.audience_profile;
    packet.channel_strategy = channelStrategy;
    packet.audience_fit_report = audienceAssessment;
    packet.fatigue_report = audienceAssessment.projected_fatigue;
    packet.format_rotation = audienceAssessment.recommended_rotation;
    packet.verification.audience_strategy = packet.verification.audience_strategy || {
      passed: audienceAssessment.passed,
      audience_fit_score: audienceAssessment.audience_fit.score,
      threshold: audienceAssessment.audience_fit.threshold,
      persona_id: audienceAssessment.audience_fit.persona?.id || null,
      viewer_job_id: audienceAssessment.audience_fit.viewer_job?.id || null,
      content_pillar_id: audienceAssessment.audience_fit.content_pillar?.id || null,
      output_format: audienceAssessment.audience_fit.output_format,
      issues: audienceAssessment.issues,
      warnings: audienceAssessment.warnings,
      checked_at: audienceAssessment.assessed_at,
      mode: "legacy_phase5_migration"
    };
  }
  const audienceFiles = {
    "audience_profile_snapshot.json": packet.audience_profile_snapshot,
    "channel_strategy.json": packet.channel_strategy,
    "audience_fit_report.json": packet.audience_fit_report,
    "fatigue_report.json": packet.fatigue_report,
    "format_rotation.json": packet.format_rotation
  };
  Object.entries(audienceFiles).forEach(([name, payload]) => {
    if (payload && !fs.existsSync(path.join(episodeDir, name))) writeJson(path.join(episodeDir, name), payload);
  });

  if (legacyPack && (!packet.narrative_blueprint || !packet.script_package || !packet.story_report)) {
    const archetype = legacyPack.content.archetypes.find((item) => item.id === (packet.brief?.archetype_id || legacyPack.content.default_archetype)) || legacyPack.content.archetypes[0];
    const blueprint = packet.studio_blueprint || buildStudioBlueprint(legacyPack, packet.brief || {}, packet.claims || []);
    const narrativeBlueprint = buildNarrativeBlueprint(
      legacyPack,
      archetype,
      packet.brief || {},
      packet.claims || [],
      blueprint,
      packet.audience_fit_report || null
    );
    const scriptPackage = buildScriptPackage(
      legacyPack,
      archetype,
      packet.brief || {},
      packet.claims || [],
      packet.sourcePacket || [],
      blueprint,
      narrativeBlueprint,
      [],
      packet.questions || []
    );
    const storyPackage = {
      narrative_blueprint: narrativeBlueprint,
      script_package: scriptPackage,
      timing_plan: {
        schema: "nichefoundry.timing_plan.v1.0",
        requested_duration_minutes: narrativeBlueprint.duration_plan.requested,
        evidence_supported_max_minutes: narrativeBlueprint.duration_plan.evidence_supported_max,
        estimated_duration_minutes: scriptPackage.estimated_duration_minutes,
        spoken_words_per_minute: narrativeBlueprint.spoken_words_per_minute,
        total_words: scriptPackage.word_count,
        scenes: scriptPackage.scenes.map((scene) => ({
          scene_id: scene.scene_id,
          beat_name: scene.beat_name,
          word_count: scene.word_count,
          estimated_duration_seconds: scene.estimated_duration_seconds
        })),
        warnings: scriptPackage.script_passes?.passes?.timing?.passed ? [] : ["Estimated narration is outside the accepted timing range."],
        checked_at: new Date().toISOString()
      },
      story_report: {
        schema: "nichefoundry.story_report.v1.0",
        passed: scriptPackage.passed,
        studio_id: legacyPack.studio.id,
        archetype_id: archetype.id,
        selected_hook_id: narrativeBlueprint.selected_hook.hook_id,
        scene_count: scriptPackage.scenes.length,
        grounded_claim_count: scriptPackage.claim_ids.length,
        grounded_source_count: scriptPackage.source_ids.length,
        estimated_duration_minutes: scriptPackage.estimated_duration_minutes,
        issues: [
          ...scriptPackage.critic.issues,
          ...Object.entries(scriptPackage.script_passes.passes)
            .filter(([, value]) => !value.passed)
            .map(([key]) => `script_pass_failed:${key}`)
        ],
        warnings: scriptPackage.critic.warnings,
        checked_at: new Date().toISOString()
      }
    };
    packet.narrative_blueprint = storyPackage.narrative_blueprint;
    packet.script_package = storyPackage.script_package;
    packet.timing_plan = storyPackage.timing_plan;
    packet.story_report = storyPackage.story_report;
    packet.script_markdown = scriptPackageToMarkdown(storyPackage.script_package);
    packet.verification.story_engine = {
      passed: storyPackage.story_report.passed,
      scene_count: storyPackage.story_report.scene_count,
      grounded_claim_count: storyPackage.story_report.grounded_claim_count,
      estimated_duration_minutes: storyPackage.story_report.estimated_duration_minutes,
      issues: storyPackage.story_report.issues,
      warnings: storyPackage.story_report.warnings,
      checked_at: storyPackage.story_report.checked_at,
      mode: "legacy_phase6_migration"
    };
    const storyFiles = {
      "narrative_blueprint.json": packet.narrative_blueprint,
      "script_package.json": packet.script_package,
      "timing_plan.json": packet.timing_plan,
      "story_report.json": packet.story_report
    };
    Object.entries(storyFiles).forEach(([name, payload]) => writeJson(path.join(episodeDir, name), payload));
    writeText(path.join(episodeDir, "script.md"), packet.script_markdown);
    database.saveStoryPackage(`episode:${packet.episode.episode_id}`, packet.episode.episode_id, legacyStudioId, archetype.id, packet.script_package);
  }
  if (legacyPack && (!packet.visual_identity || !packet.visual_plan || !packet.visual_report)) {
    const visualPackage = buildVisualPackage({
      pack: legacyPack,
      brief: packet.brief || { working_title: packet.episode.title, topic: packet.episode.topic, archetype_id: packet.episode.content_archetype?.id || legacyPack.content.default_archetype, output_format: "long_form" },
      scriptPackage: packet.script_package || database.getStoryPackageForEpisode(packet.episode.episode_id) || { scenes: packet.episode.scenes || [] },
      episodeId: packet.episode.episode_id,
      priorPackets: [],
      claims: packet.claims || []
    });
    packet.visual_package = visualPackage;
    packet.visual_asset_hashes = renderVisualPreviewAssets(episodeDir, visualPackage, packet.episode.title, packet.episode.topic);
    packet.visual_identity = visualPackage.visual_identity;
    packet.visual_plan = visualPackage.visual_plan;
    packet.asset_manifest = visualPackage.asset_manifest;
    packet.asset_provenance = visualPackage.asset_provenance;
    packet.thumbnail_plan = visualPackage.thumbnail_plan;
    packet.visual_similarity_report = visualPackage.visual_similarity_report;
    packet.visual_report = visualPackage.visual_report;
    packet.verification.visual_system = {
      passed: visualPackage.visual_report.passed && packet.visual_asset_hashes.complete,
      identity_hash: visualPackage.visual_identity.identity_hash,
      scene_count: visualPackage.visual_report.scene_count,
      asset_count: visualPackage.visual_report.asset_count,
      unique_compositions: visualPackage.visual_report.unique_compositions,
      maximum_library_similarity: visualPackage.visual_report.maximum_library_similarity,
      issues: visualPackage.visual_report.issues,
      warnings: visualPackage.visual_report.warnings,
      checked_at: visualPackage.visual_report.checked_at,
      mode: "legacy_phase7_migration"
    };
    const visualFiles = {
      "visual_identity.json": packet.visual_identity, "visual_plan.json": packet.visual_plan,
      "asset_manifest.json": packet.asset_manifest, "asset_provenance.json": packet.asset_provenance,
      "visual_asset_hashes.json": packet.visual_asset_hashes, "thumbnail_plan.json": packet.thumbnail_plan,
      "visual_similarity_report.json": packet.visual_similarity_report, "visual_report.json": packet.visual_report
    };
    Object.entries(visualFiles).forEach(([name, payload]) => writeJson(path.join(episodeDir, name), payload));
    database.saveVisualPackage(`episode:${packet.episode.episode_id}`, packet.episode.episode_id, legacyStudioId, visualPackage);
  }

  if (legacyPack && (!packet.host_profile || !packet.audio_performance_plan || !packet.audio_preflight_report)) {
    const audioPackage = buildAudioPerformancePackage({
      pack: legacyPack,
      brief: packet.brief || { working_title: packet.episode.title, topic: packet.episode.topic },
      scriptPackage: packet.script_package || database.getStoryPackageForEpisode(packet.episode.episode_id) || { scenes: packet.episode.scenes || [] },
      timingPlan: packet.timing_plan || {},
      episodeId: packet.episode.episode_id
    });
    packet.audio_package = audioPackage;
    packet.host_profile = audioPackage.host_profile;
    packet.pronunciation_lexicon = audioPackage.pronunciation_lexicon;
    packet.audio_performance_plan = audioPackage.audio_performance_plan;
    packet.sound_design_plan = audioPackage.sound_design_plan;
    packet.audio_preflight_report = audioPackage.audio_preflight_report;
    packet.verification.audio_performance = {
      passed: audioPackage.audio_preflight_report.passed,
      scene_count: audioPackage.audio_preflight_report.scene_count,
      unique_host_count: audioPackage.audio_preflight_report.unique_host_count,
      pronunciation_entry_count: audioPackage.audio_preflight_report.pronunciation_entry_count,
      unresolved_pronunciation_count: audioPackage.audio_preflight_report.unresolved_pronunciation_count,
      plan_hash: audioPackage.audio_performance_plan.plan_hash,
      issues: audioPackage.audio_preflight_report.issues,
      warnings: audioPackage.audio_preflight_report.warnings,
      checked_at: audioPackage.audio_preflight_report.checked_at,
      mode: "legacy_phase8_migration"
    };
    const audioFiles = {
      "host_profile.json": packet.host_profile,
      "pronunciation_lexicon.json": packet.pronunciation_lexicon,
      "audio_performance_plan.json": packet.audio_performance_plan,
      "sound_design_plan.json": packet.sound_design_plan,
      "audio_preflight_report.json": packet.audio_preflight_report
    };
    Object.entries(audioFiles).forEach(([name, payload]) => writeJson(path.join(episodeDir, name), payload));
    database.saveAudioPackage(`episode:${packet.episode.episode_id}`, packet.episode.episode_id, legacyStudioId, audioPackage);
  }
  if (!packet.audio_production && fs.existsSync(path.join(episodeDir, "audio_performance_report.json"))) {
    try {
      packet.audio_production = {
        audio_manifest: JSON.parse(fs.readFileSync(path.join(episodeDir, "audio_manifest.json"), "utf8")),
        audio_asset_hashes: JSON.parse(fs.readFileSync(path.join(episodeDir, "audio_asset_hashes.json"), "utf8")),
        loudness_report: JSON.parse(fs.readFileSync(path.join(episodeDir, "loudness_report.json"), "utf8")),
        performance_report: JSON.parse(fs.readFileSync(path.join(episodeDir, "audio_performance_report.json"), "utf8")),
        audio_assets: database.listAudioAssets(packet.episode.episode_id)
      };
    } catch (_error) {
      // Artifact verification reports malformed runtime audio evidence.
    }
  }

  if (!packet.render_production && fs.existsSync(path.join(episodeDir, "render_qa_report.json"))) {
    try {
      packet.render_production = {
        render_plan: JSON.parse(fs.readFileSync(path.join(episodeDir, "render_plan.json"), "utf8")),
        caption_track: JSON.parse(fs.readFileSync(path.join(episodeDir, "caption_track.json"), "utf8")),
        render_manifest: JSON.parse(fs.readFileSync(path.join(episodeDir, "render_manifest_v2.json"), "utf8")),
        render_asset_hashes: JSON.parse(fs.readFileSync(path.join(episodeDir, "render_asset_hashes.json"), "utf8")),
        render_qa_report: JSON.parse(fs.readFileSync(path.join(episodeDir, "render_qa_report.json"), "utf8")),
        render_assets: database.listRenderAssets(packet.episode.episode_id)
      };
      packet.verification.render_system = {
        passed: Boolean(packet.render_production.render_qa_report.passed),
        profile_id: packet.render_production.render_qa_report.profile_id,
        scene_count: packet.render_production.render_qa_report.scene_count,
        duration_seconds: packet.render_production.render_qa_report.probe?.duration_seconds || 0,
        issues: packet.render_production.render_qa_report.issues || [],
        warnings: packet.render_production.render_qa_report.warnings || [],
        checked_at: packet.render_production.render_qa_report.checked_at
      };
    } catch (_error) {
      // Artifact verification reports malformed runtime render evidence.
    }
  }

  const renderManifestPath = fs.existsSync(path.join(episodeDir, "render_manifest_v2.json"))
    ? path.join(episodeDir, "render_manifest_v2.json")
    : path.join(episodeDir, "render_manifest.json");
  let renderOutput = packet.render_manifest_output || { video: "final.mp4", captions: "captions.srt", thumbnail: "thumbnail.png" };
  if (fs.existsSync(renderManifestPath)) {
    try {
      const parsedManifest = JSON.parse(fs.readFileSync(renderManifestPath, "utf8"));
      if (typeof parsedManifest.output === "string") {
        if (parsedManifest.output === "final.mp4") renderOutput = { video: "final.mp4", captions: parsedManifest.captions || "captions.srt", thumbnail: parsedManifest.thumbnail || "thumbnail.png" };
      } else if (parsedManifest.output?.video) renderOutput = parsedManifest.output;
    } catch (_error) {
      // The artifact verifier will report malformed JSON; retain safe defaults here.
    }
  }
  packet.render_manifest_output = renderOutput;
  packet.episode_dir = path.relative(ROOT, episodeDir);
  packet.jobs = database.listJobs(packet.episode.episode_id, 50);
  packet.approval_bundle = updateApprovalBundle(episodeDir);
  packet.current_approval_bundle_hash = sha256File(path.join(episodeDir, "approval_bundle.json"));
  packet.editorial_evidence_current = Boolean(
    packet.expected_approval_bundle_hash &&
    packet.current_approval_bundle_hash === packet.expected_approval_bundle_hash
  );
  packet.approvals = database.listApprovals(packet.episode.episode_id);
  const bindApproval = (approval) => {
    if (!approval) return null;
    const boundPath = safeResolve(episodeDir, approval.artifact_name);
    const currentHash = fs.existsSync(boundPath) ? sha256File(boundPath) : null;
    return { ...approval, valid: Boolean(currentHash && currentHash === approval.artifact_hash), current_artifact_hash: currentHash };
  };
  packet.approval = bindApproval(packet.approvals.find((approval) => approval.decision === "approved" && approval.approval_type === "editorial_packet"));
  packet.approved = Boolean(packet.approval?.valid);
  packet.audio_approval = bindApproval(packet.approvals.find((approval) => approval.decision === "approved" && approval.approval_type === "audio_performance"));
  packet.audio_approved = Boolean(packet.audio_approval?.valid);
  packet.render_approval = bindApproval(packet.approvals.find((approval) => approval.decision === "approved" && approval.approval_type === "render_programme"));
  packet.render_approved = Boolean(packet.render_approval?.valid);
  if (database.listReviewTasks(packet.episode.episode_id).length || database.listFinalSignoffs(packet.episode.episode_id).length) {
    syncEditorialCockpit(packet, { writeFiles: true });
  }
  if (database.getPublishingPackageForEpisode(packet.episode.episode_id)) {
    publishingPackageFor(packet);
    packet.publishing_events = database.listPublishingEvents(packet.episode.episode_id, 100);
  } else {
    packet.publishing_package = null;
    packet.publishing_events = [];
  }

  const artifacts = inspectEpisodeArtifacts(episodeDir, renderOutput);
  packet.artifact_evidence = artifacts.map(({ absolute_path, ...artifact }) => artifact);
  packet.qa = deriveQa(packet, packet.artifact_evidence);
  packet.artifacts = packet.artifact_evidence.map((artifact) => ({
    name: artifact.name,
    description: artifactDescriptions[artifact.name] || `Evidence-tracked ${artifact.kind} artifact.`,
    exists: artifact.exists,
    verified: artifact.verified,
    size_bytes: artifact.size_bytes,
    sha256: artifact.sha256,
    verification: artifact.verification
  }));
  packet.stage_statuses = deriveStageStatuses(packet);
  packet.currentStage = currentStageFromStatuses(packet.stage_statuses);

  // The episode row must exist before foreign-keyed artifact rows are inserted.
  database.upsertEpisode(packet);
  artifacts.forEach((artifact) => database.upsertArtifact(packet.episode.episode_id, artifact));
  if (save) {
    writeJson(path.join(episodeDir, "qa_report.json"), packet.qa);
    writeJson(path.join(episodeDir, "artifact_status.json"), packet.artifact_evidence);
    database.upsertEpisode(packet);
  }
  return packet;
}

function visualPreviewAssetsAreCurrent(episodeDir, packet) {
  const manifest = packet?.visual_asset_hashes;
  if (!manifest?.complete || !Array.isArray(manifest.assets) || manifest.assets.length === 0) return false;
  return manifest.assets.every((entry) => {
    if (!entry?.relative_path || !entry.sha256) return false;
    const absolute = safeResolve(episodeDir, entry.relative_path);
    if (!absolute || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return false;
    return sha256File(absolute) === entry.sha256;
  });
}

function persistEpisode(packet) {
  ensureDir(EPISODES_DIR);
  const episodeDir = path.join(EPISODES_DIR, packet.episode.episode_id);
  ensureDir(episodeDir);

  if (packet.visual_package) {
    if (!visualPreviewAssetsAreCurrent(episodeDir, packet)) {
      packet.visual_asset_hashes = renderVisualPreviewAssets(episodeDir, packet.visual_package, packet.episode.title, packet.episode.topic);
    }
    packet.visual_identity = packet.visual_package.visual_identity;
    packet.visual_plan = packet.visual_package.visual_plan;
    packet.asset_manifest = packet.visual_package.asset_manifest;
    packet.asset_provenance = packet.visual_package.asset_provenance;
    packet.thumbnail_plan = packet.visual_package.thumbnail_plan;
    packet.visual_similarity_report = packet.visual_package.visual_similarity_report;
    packet.visual_report = packet.visual_package.visual_report;
    if (packet.verification?.visual_system) packet.verification.visual_system.passed = packet.visual_report.passed && packet.visual_asset_hashes.complete;
  }
  const visualManifest = makeVisualManifest(packet);
  const narrationManifest = makeNarrationManifest(packet);
  const scriptManifest = makeScriptManifest(packet);
  const renderManifest = makeRenderManifest(packet);
  packet.render_manifest_output = renderManifest.output;
  packet.episode_dir = path.relative(ROOT, episodeDir);

  const files = {
    "opportunity_snapshot.json": packet.opportunity_snapshot,
    "opportunity_report.json": packet.opportunity_report,
    "audience_profile_snapshot.json": packet.audience_profile_snapshot,
    "channel_strategy.json": packet.channel_strategy,
    "audience_fit_report.json": packet.audience_fit_report,
    "fatigue_report.json": packet.fatigue_report,
    "format_rotation.json": packet.format_rotation,
    "brief.json": packet.brief,
    "studio_pack_snapshot.json": packet.studio_pack_snapshot,
    "studio_fit_report.json": packet.studio_fit_report,
    "studio_blueprint.json": packet.studio_blueprint,
    "connector_plan.json": packet.connector_plan || {},
    "research_governance.json": packet.research_governance || {},
    "source_hierarchy.json": packet.source_hierarchy || {},
    "freshness_report.json": packet.freshness_report || {},
    "claim_conflict_graph.json": packet.claim_conflict_graph || {},
    "narrative_blueprint.json": packet.narrative_blueprint || {},
    "script_package.json": packet.script_package || {},
    "timing_plan.json": packet.timing_plan || {},
    "story_report.json": packet.story_report || {},
    "visual_identity.json": packet.visual_identity || {},
    "visual_plan.json": packet.visual_plan || {},
    "asset_manifest.json": packet.asset_manifest || {},
    "asset_provenance.json": packet.asset_provenance || {},
    "visual_asset_hashes.json": packet.visual_asset_hashes || {},
    "thumbnail_plan.json": packet.thumbnail_plan || {},
    "visual_similarity_report.json": packet.visual_similarity_report || {},
    "visual_report.json": packet.visual_report || {},
    "host_profile.json": packet.host_profile || {},
    "pronunciation_lexicon.json": packet.pronunciation_lexicon || {},
    "audio_performance_plan.json": packet.audio_performance_plan || {},
    "sound_design_plan.json": packet.sound_design_plan || {},
    "audio_preflight_report.json": packet.audio_preflight_report || {},
    "connector_runs.json": packet.connector_plan?.runs || [],
    "sources.json": packet.sourcePacket,
    "claims.json": packet.claims || [],
    "research_report.json": packet.research_report || {},
    "duplicate_report.json": packet.verification?.duplicate_and_safety || {},
    "episode.json": packet.episode,
    "verification.json": packet.verification,
    "integration_runs.json": packet.integrationRuns || {},
    "visual_manifest.json": visualManifest,
    "narration_manifest.json": narrationManifest,
    "script_manifest.json": scriptManifest,
    "render_manifest.json": renderManifest,
    "youtube_upload.json": makeUploadManifest(packet)
  };

  Object.entries(files).forEach(([filename, payload]) => writeJson(path.join(episodeDir, filename), payload));
  const snapshotsDir = path.join(episodeDir, "source_snapshots");
  ensureDir(snapshotsDir);
  for (const source of packet.sourcePacket || []) {
    writeJson(path.join(snapshotsDir, `${source.source_id}.json`), source);
  }
  writeText(path.join(episodeDir, "script.md"), packet.script_markdown || scriptPackageToMarkdown(packet.script_package || { title: packet.episode.title, studio_id: packet.brief.studio_id, archetype_id: packet.brief.archetype_id, estimated_duration_minutes: 0, claim_ids: [], scenes: [], hook: { text: packet.episode.intro_narration || "" } }));
  writeText(path.join(episodeDir, "gamma_input.md"), packet.gamma_input);
  writeText(path.join(episodeDir, "approval_checklist.md"), makeApprovalChecklist(packet));
  packet.approval_bundle = updateApprovalBundle(episodeDir);
  packet.expected_approval_bundle_hash = sha256File(path.join(episodeDir, "approval_bundle.json"));
  packet.current_approval_bundle_hash = packet.expected_approval_bundle_hash;
  packet.editorial_evidence_current = true;

  database.upsertEpisode(packet);
  database.replaceResearch(packet.episode.episode_id, packet.sourcePacket || [], packet.claims || []);
  database.saveChannelStrategy(`${packet.brief.studio_id}:current`, packet.brief.studio_id, packet.channel_strategy);
  database.saveAudienceAssessment(`episode:${packet.episode.episode_id}`, packet.brief.studio_id, packet.audience_fit_report, packet.episode.episode_id);
  if (packet.script_package) database.saveStoryPackage(`episode:${packet.episode.episode_id}`, packet.episode.episode_id, packet.brief.studio_id, packet.brief.archetype_id, packet.script_package);
  if (packet.visual_package) database.saveVisualPackage(`episode:${packet.episode.episode_id}`, packet.episode.episode_id, packet.brief.studio_id, packet.visual_package);
  if (packet.audio_package) database.saveAudioPackage(`episode:${packet.episode.episode_id}`, packet.episode.episode_id, packet.brief.studio_id, packet.audio_package);
  if (packet.render_package) database.saveRenderPackage(`episode:${packet.episode.episode_id}`, packet.episode.episode_id, packet.brief.studio_id, packet.render_package);
  for (const run of packet.connector_plan?.runs || []) {
    database.saveConnectorRun(run, {
      episodeId: packet.episode.episode_id,
      studioId: packet.brief?.studio_id || null,
      capability: "research_sources"
    });
  }
  database.audit({
    episodeId: packet.episode.episode_id,
    eventType: "episode_persisted",
    actor: "system",
    details: { episode_dir: packet.episode_dir }
  });
  return refreshPacketEvidence(packet, { save: true });
}


function episodeRecordsForOpportunityAudit(studioId) {
  return database.listEpisodes(300)
    .map((item) => database.getEpisode(item.episode_id))
    .filter((packet) => packet?.brief?.studio_id === studioId)
    .map((packet) => ({
      episode_id: packet.episode.episode_id,
      title: packet.episode.title,
      topic: packet.episode.topic,
      angle: packet.episode.story_premise,
      lifecycle: packet.qa?.status || 'produced'
    }));
}

function assignOpportunityClusters(studioId) {
  const opportunities = database.listOpportunities({ studioId, limit: 2000 });
  const clusters = clusterOpportunities(opportunities);
  const membership = new Map();
  clusters.forEach((cluster) => cluster.opportunity_ids.forEach((id) => membership.set(id, cluster.cluster_id)));
  const updated = opportunities.map((item) => ({ ...item, cluster_id: membership.get(item.opportunity_id) || null }));
  database.replaceOpportunityClusters(studioId, updated);
  return { opportunities: updated, clusters };
}

function persistOpportunityCandidates(pack, candidates, actor = 'local-editor') {
  const preexisting = database.listOpportunities({ studioId: pack.studio.id, limit: 2000 });
  const episodes = episodeRecordsForOpportunityAudit(pack.studio.id);
  const scored = candidates.map((candidate) => scoreOpportunity(pack, candidate));
  const batch = scored.map((candidate) => {
    const peers = [...preexisting, ...scored.filter((item) => item.opportunity_id !== candidate.opportunity_id), ...episodes];
    const cannibalization = buildCannibalizationReport(candidate, peers);
    let lifecycle = candidate.lifecycle || 'discovered';
    if (!candidate.fit.passed || candidate.decision.startsWith('reject')) lifecycle = 'rejected';
    else if (lifecycle === 'discovered') lifecycle = 'screened';
    const enriched = { ...candidate, lifecycle, cannibalization, updated_at: new Date().toISOString() };
    database.upsertOpportunity(enriched);
    database.audit({
      eventType: 'opportunity_scored',
      actor,
      details: {
        opportunity_id: enriched.opportunity_id,
        studio_id: enriched.studio_id,
        score: enriched.opportunity_score,
        decision: enriched.decision,
        lifecycle: enriched.lifecycle,
        cannibalization_passed: enriched.cannibalization.passed
      }
    });
    return enriched;
  });
  const clustered = assignOpportunityClusters(pack.studio.id);
  const byId = new Map(clustered.opportunities.map((item) => [item.opportunity_id, item]));
  return {
    opportunities: batch.map((item) => byId.get(item.opportunity_id) || item),
    clusters: clustered.clusters,
    portfolio: buildPortfolioReport(clustered.opportunities)
  };
}

function opportunityEvidenceForBrief(pack, brief) {
  if (!brief.opportunity_id) {
    return {
      snapshot: {
        schema: 'nichefoundry.opportunity.manual_brief.v1',
        opportunity_id: null,
        studio_id: pack.studio.id,
        title: brief.working_title,
        topic: brief.topic,
        angle: brief.story_premise,
        discovery_source: 'manual_brief',
        lifecycle: 'manual_entry',
        snapshotted_at: new Date().toISOString()
      },
      report: {
        passed: true,
        mode: 'manual_brief',
        note: 'No persisted opportunity was selected. Studio fit, evidence, editorial, and duplicate gates still apply.',
        checked_at: new Date().toISOString()
      }
    };
  }
  const opportunity = database.getOpportunity(brief.opportunity_id);
  if (!opportunity) {
    const error = new Error(`Unknown opportunity '${brief.opportunity_id}'.`);
    error.statusCode = 400;
    throw error;
  }
  if (opportunity.studio_id !== pack.studio.id) {
    const error = new Error('The selected opportunity belongs to a different Studio Pack.');
    error.statusCode = 409;
    throw error;
  }
  const report = {
    passed: Boolean(opportunity.fit?.passed && opportunity.cannibalization?.passed && !['rejected', 'retired'].includes(opportunity.lifecycle)),
    opportunity_score: opportunity.opportunity_score,
    decision: opportunity.decision,
    score_confidence: opportunity.score_confidence,
    normalized_signals: opportunity.normalized_signals,
    signal_provenance: opportunity.signal_provenance,
    scoring_weights: opportunity.scoring_weights,
    fit: opportunity.fit,
    cannibalization: opportunity.cannibalization,
    content_role: opportunity.content_role,
    cluster_id: opportunity.cluster_id,
    lifecycle: opportunity.lifecycle,
    checked_at: new Date().toISOString()
  };
  if (!report.passed) {
    const error = new Error('The selected opportunity is rejected, retired, off-niche, or blocked by cannibalisation.');
    error.statusCode = 422;
    error.opportunity = report;
    throw error;
  }
  return {
    snapshot: { ...opportunity, snapshotted_at: new Date().toISOString() },
    report
  };
}

function audienceHistoryForStudio(studioId, { excludeEpisodeId = null } = {}) {
  const episodes = database.listEpisodes(300)
    .map((item) => database.getEpisode(item.episode_id))
    .filter((packet) => packet?.brief?.studio_id === studioId && packet?.episode?.episode_id !== excludeEpisodeId);
  const opportunities = database.listOpportunities({ studioId, limit: 2000 });
  return { episodes, opportunities };
}

function buildAndPersistChannelStrategy(pack, actor = "system") {
  const history = audienceHistoryForStudio(pack.studio.id);
  const strategy = buildChannelStrategy(pack, history);
  const strategyId = `${pack.studio.id}:current`;
  database.saveChannelStrategy(strategyId, pack.studio.id, strategy);
  database.audit({
    eventType: "channel_strategy_refreshed",
    actor,
    details: {
      strategy_id: strategyId,
      studio_id: pack.studio.id,
      record_count: strategy.portfolio.record_count,
      fatigue_passed: strategy.fatigue.passed
    }
  });
  return { ...strategy, strategy_id: strategyId };
}

function selectArchetypeForBrief(studioPack, brief) {
  const fallback = studioPack?.content?.default_archetype;
  if (studioPack?.studio?.id !== "history_under_glass") return fallback;
  if (brief?.archetype_id && brief.archetype_id !== fallback) return brief.archetype_id;
  const corpus = normalizedWords([
    brief?.topic,
    brief?.working_title,
    brief?.story_premise,
    ...(brief?.source_queries || [])
  ].join(" ")).join(" ");
  if (/(inscription|royal|decree|edict|archive|tablet|cuneiform|papyrus|manuscript|translation|decipher|text|script)/.test(corpus)) {
    return "historical_case_file";
  }
  if (/(route|trade|journey|voyage|migration|provenance|exchange|map)/.test(corpus)) {
    return "map_journey";
  }
  if (/(myth|legend|debunk|popular claim|did [a-z ]+ really|true or false)/.test(corpus)) {
    return "myth_audit";
  }
  return fallback;
}

function resolveStudioForBrief(brief) {
  const studioId = String(brief.studio_id || "puzzle_planet").trim();
  const studioPack = studioRegistry.get(studioId);
  if (!studioPack) {
    const error = new Error(`Unknown studio '${studioId}'. Install or select a valid Studio Pack.`);
    error.statusCode = 400;
    throw error;
  }
  const archetypeId = String(selectArchetypeForBrief(studioPack, brief)).trim();
  const archetype = studioPack.content.archetypes.find((item) => item.id === archetypeId);
  if (!archetype) {
    const error = new Error(`Unknown archetype '${archetypeId}' for ${studioPack.studio.name}.`);
    error.statusCode = 400;
    throw error;
  }
  const normalized = { ...brief, studio_id: studioId, archetype_id: archetypeId };
  const fit = scoreEpisodeFit(studioPack, normalized);
  if (!fit.passed && !brief.allow_low_fit) {
    const error = new Error(`${fit.explanation} Fit score ${fit.score} is below ${fit.threshold}.`);
    error.statusCode = 422;
    error.fit = fit;
    throw error;
  }
  return { studioPack, archetype, fit, brief: normalized };
}

async function buildPacket(brief) {
  const selected = resolveStudioForBrief(brief);
  const normalizedBrief = {
    ...selected.brief,
    question_count: Math.max(1, Math.min(Number(brief.question_count) || 6, 20)),
    countdown_seconds: Math.max(3, Math.min(Number(brief.countdown_seconds) || 8, 30)),
    source_queries: [...new Set((brief.source_queries || [brief.topic]).map((item) => String(item || "").trim()).filter(Boolean))]
  };
  const opportunityEvidence = opportunityEvidenceForBrief(selected.studioPack, normalizedBrief);
  const audienceHistory = audienceHistoryForStudio(selected.studioPack.studio.id);
  const channelStrategy = buildChannelStrategy(selected.studioPack, audienceHistory);
  const audienceAssessment = assessEpisodeStrategy(selected.studioPack, normalizedBrief, {
    ...audienceHistory,
    channel_strategy: channelStrategy,
    studio_fit: selected.fit
  });
  const connectorPlan = await runResearchConnectorPlan(connectorRegistry, normalizedBrief);
  const sourcePacket = filterTopicMatchedSources(normalizedBrief, connectorPlan.sources);
  const extractedClaims = atomizeClaims(sourcePacket, normalizedBrief);
  const researchGovernance = buildResearchGovernance(selected.studioPack, sourcePacket, extractedClaims);
  const claims = researchGovernance.claims;
  const generationClaims = claims.filter((claim) => ["supported", "weakly_supported"].includes(claim.status));
  const researchCoverage = coverageReport(sourcePacket, generationClaims, normalizedBrief.question_count);
  const researchPolicy = assessResearchPolicy(selected.studioPack, sourcePacket);
  const generated = await generateQuestions(normalizedBrief, generationClaims);
  const pack = inferTopicPack(normalizedBrief, sourcePacket);
  const studioBlueprint = buildStudioBlueprint(selected.studioPack, normalizedBrief, claims);
  const priorEpisodes = database.listEpisodes(200)
    .map((item) => database.getEpisode(item.episode_id))
    .filter(Boolean);
  const storyPackage = await buildNarrativePackage({
    pack: selected.studioPack,
    archetype: selected.archetype,
    brief: normalizedBrief,
    claims,
    questions: generated.questions,
    sources: sourcePacket,
    studioBlueprint,
    audienceAssessment,
    priorPackets: priorEpisodes
  });
  const date = new Date().toISOString().slice(0, 10);
  const uniqueness = crypto.createHash("sha256")
    .update(`${normalizedBrief.working_title}|${Date.now()}|${crypto.randomBytes(8).toString("hex")}`)
    .digest("hex")
    .slice(0, 8);
  const episode = {
    episode_id: `${slugify(normalizedBrief.working_title)}-${date}-${uniqueness}`,
    title: normalizedBrief.working_title,
    topic: normalizedBrief.topic,
    story_premise: normalizedBrief.story_premise,
    age_band: normalizedBrief.age_band,
    audience_mode: normalizedBrief.audience_mode,
    contains_synthetic_media: normalizedBrief.contains_synthetic_media,
    studio: studioBlueprint.studio,
    content_archetype: studioBlueprint.archetype,
    story_map: studioBlueprint.story_map,
    channel_promise: studioBlueprint.channel_promise,
    audience_strategy: {
      persona_id: audienceAssessment.audience_fit.persona?.id || null,
      persona_name: audienceAssessment.audience_fit.persona?.name || null,
      viewer_job_id: audienceAssessment.audience_fit.viewer_job?.id || null,
      viewer_job: audienceAssessment.audience_fit.viewer_job?.label || null,
      content_pillar_id: audienceAssessment.audience_fit.content_pillar?.id || null,
      content_pillar: audienceAssessment.audience_fit.content_pillar?.name || null,
      output_format: audienceAssessment.audience_fit.output_format,
      value_proposition: audienceAssessment.audience_fit.value_proposition,
      desired_reward: audienceAssessment.audience_fit.desired_reward,
      likely_next_action: audienceAssessment.audience_fit.likely_next_action
    },
    production_mode: selected.studioPack.studio.id === "puzzle_planet" ? "interactive_story_and_quiz" : "full_archetype_script",
    narrative_blueprint: storyPackage.narrative_blueprint,
    story_engine: {
      passed: storyPackage.story_report.passed,
      narrative_mode: storyPackage.narrative_blueprint.narrative_mode,
      script_hash: storyPackage.script_package.script_hash_basis,
      estimated_duration_minutes: storyPackage.script_package.estimated_duration_minutes,
      scene_count: storyPackage.script_package.scenes.length
    },
    intro_narration: storyPackage.script_package.scenes[0]?.narration || `${selected.studioPack.studio.name} presents ${normalizedBrief.working_title}.`,
    scenes: storyPackage.script_package.scenes,
    questions: generated.questions,
    evidence_units: selected.studioPack.studio.id === "puzzle_planet" ? generated.questions : storyPackage.script_package.scenes,
    outro_narration: storyPackage.script_package.scenes.at(-1)?.narration || storyPackage.narrative_blueprint.closing_bridge,
    visual_direction: normalizedBrief.visual_direction,
    research: {
      source_ids: sourcePacket.map((source) => source.source_id),
      claim_ids: claims.map((claim) => claim.claim_id),
      retrieved_at: new Date().toISOString(),
      studio_policy: researchPolicy
    }
  };

  const visualPackage = buildVisualPackage({
    pack: selected.studioPack,
    brief: normalizedBrief,
    scriptPackage: storyPackage.script_package,
    episodeId: episode.episode_id,
    priorPackets: priorEpisodes,
    claims
  });
  episode.visual_system = {
    passed: visualPackage.visual_report.passed,
    identity_hash: visualPackage.visual_identity.identity_hash,
    planned_scene_count: visualPackage.visual_report.planned_scene_count,
    asset_count: visualPackage.visual_report.asset_count,
    unique_compositions: visualPackage.visual_report.unique_compositions,
    maximum_library_similarity: visualPackage.visual_report.maximum_library_similarity
  };

  const audioPackage = buildAudioPerformancePackage({
    pack: selected.studioPack,
    brief: normalizedBrief,
    scriptPackage: storyPackage.script_package,
    timingPlan: storyPackage.timing_plan,
    episodeId: episode.episode_id
  });
  episode.audio_performance = {
    passed: audioPackage.audio_preflight_report.passed,
    host_profile_hash: audioPackage.host_profile.profile_hash,
    plan_hash: audioPackage.audio_performance_plan.plan_hash,
    scene_count: audioPackage.audio_preflight_report.scene_count,
    pronunciation_entry_count: audioPackage.audio_preflight_report.pronunciation_entry_count,
    unresolved_pronunciation_count: audioPackage.audio_preflight_report.unresolved_pronunciation_count
  };

  const claimMap = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const sourceMap = new Map(sourcePacket.map((source) => [source.source_id, source]));
  const structural = validateStructure(episode, normalizedBrief, claimMap, sourceMap);
  const editorial = runEditorialAudit(episode, normalizedBrief, claims, sourcePacket, priorEpisodes);
  const duplicateAndSafety = {
    passed: editorial.duplicate_report.passed && editorial.question_results.every((result) => !result.issues.includes("meta_or_workflow_content")),
    duplicate_report: editorial.duplicate_report,
    meta_content_findings: editorial.question_results
      .filter((result) => result.issues.includes("meta_or_workflow_content"))
      .map((result) => result.question_id),
    checked_at: new Date().toISOString()
  };
  const studioPolicy = {
    passed: selected.fit.passed && researchPolicy.passed && researchGovernance.source_hierarchy.passed && researchGovernance.freshness.passed && researchGovernance.conflict_graph.passed,
    fit: selected.fit,
    research_policy: researchPolicy,
    source_hierarchy: researchGovernance.source_hierarchy,
    freshness: researchGovernance.freshness,
    conflict_graph_passed: researchGovernance.conflict_graph.passed,
    studio_id: selected.studioPack.studio.id,
    studio_version: selected.studioPack.studio.version,
    archetype_id: selected.archetype.id,
    checked_at: new Date().toISOString()
  };
  const opportunityPolicy = {
    ...opportunityEvidence.report,
    passed: opportunityEvidence.report.passed !== false,
    opportunity_id: opportunityEvidence.snapshot.opportunity_id || null
  };
  const storyPolicy = {
    passed: storyPackage.story_report.passed,
    scene_count: storyPackage.story_report.scene_count,
    grounded_claim_count: storyPackage.story_report.grounded_claim_count,
    estimated_duration_minutes: storyPackage.story_report.estimated_duration_minutes,
    issues: storyPackage.story_report.issues,
    warnings: storyPackage.story_report.warnings,
    checked_at: storyPackage.story_report.checked_at
  };
  const audiencePolicy = {
    passed: audienceAssessment.passed,
    audience_fit_score: audienceAssessment.audience_fit.score,
    threshold: audienceAssessment.audience_fit.threshold,
    persona_id: audienceAssessment.audience_fit.persona?.id || null,
    viewer_job_id: audienceAssessment.audience_fit.viewer_job?.id || null,
    content_pillar_id: audienceAssessment.audience_fit.content_pillar?.id || null,
    output_format: audienceAssessment.audience_fit.output_format,
    issues: audienceAssessment.issues,
    warnings: audienceAssessment.warnings,
    checked_at: audienceAssessment.assessed_at
  };
  const visualPolicy = {
    passed: visualPackage.visual_report.passed,
    identity_hash: visualPackage.visual_identity.identity_hash,
    scene_count: visualPackage.visual_report.scene_count,
    asset_count: visualPackage.visual_report.asset_count,
    unique_compositions: visualPackage.visual_report.unique_compositions,
    maximum_library_similarity: visualPackage.visual_report.maximum_library_similarity,
    issues: visualPackage.visual_report.issues,
    warnings: visualPackage.visual_report.warnings,
    checked_at: visualPackage.visual_report.checked_at
  };
  const audioPolicy = {
    passed: audioPackage.audio_preflight_report.passed,
    scene_count: audioPackage.audio_preflight_report.scene_count,
    unique_host_count: audioPackage.audio_preflight_report.unique_host_count,
    pronunciation_entry_count: audioPackage.audio_preflight_report.pronunciation_entry_count,
    unresolved_pronunciation_count: audioPackage.audio_preflight_report.unresolved_pronunciation_count,
    plan_hash: audioPackage.audio_performance_plan.plan_hash,
    issues: audioPackage.audio_preflight_report.issues,
    warnings: audioPackage.audio_preflight_report.warnings,
    checked_at: audioPackage.audio_preflight_report.checked_at
  };
  const allPassed = opportunityPolicy.passed && audiencePolicy.passed && studioPolicy.passed && storyPolicy.passed && visualPolicy.passed && audioPolicy.passed && structural.passed && editorial.passed && duplicateAndSafety.passed && researchCoverage.passed && researchGovernance.passed;
  const retrievalErrors = sourcePacket.retrieval_errors || [];
  const researchReport = {
    provider: "connector_plan",
    connector_ids: connectorPlan.connector_ids,
    retrieved_at: new Date().toISOString(),
    coverage: researchCoverage,
    studio_policy: researchPolicy,
    source_hierarchy: researchGovernance.source_hierarchy,
    freshness: researchGovernance.freshness,
    conflict_summary: {
      passed: researchGovernance.conflict_graph.passed,
      support_edge_count: researchGovernance.conflict_graph.support_edges.length,
      conflict_edge_count: researchGovernance.conflict_graph.conflict_edges.length,
      requires_human_resolution: researchGovernance.conflict_graph.requires_human_resolution
    },
    connector_failures: connectorPlan.failures,
    retrieval_errors: retrievalErrors,
    source_revisions: sourcePacket.map((source) => ({
      source_id: source.source_id,
      title: source.title,
      connector_id: source.connector_id || source.provider,
      source_tier: source.source_tier,
      source_type: source.source_type,
      primary_source: Boolean(source.primary_source),
      published_at: source.published_at || null,
      revision_id: source.revision_id,
      revision_timestamp: source.revision_timestamp,
      content_hash: source.content_hash,
      retrieval_status: source.retrieval_status
    })),
    passed: researchCoverage.passed && researchPolicy.passed && researchGovernance.passed
  };

  const studioSnapshot = {
    ...selected.studioPack,
    installed_content_hash: hashObject(selected.studioPack),
    snapshotted_at: new Date().toISOString()
  };

  return {
    opportunity_snapshot: opportunityEvidence.snapshot,
    opportunity_report: opportunityPolicy,
    audience_profile_snapshot: channelStrategy.audience_profile,
    channel_strategy: channelStrategy,
    audience_fit_report: audienceAssessment,
    fatigue_report: audienceAssessment.projected_fatigue,
    format_rotation: audienceAssessment.recommended_rotation,
    brief: normalizedBrief,
    connector_plan: connectorPlan,
    research_governance: researchGovernance,
    source_hierarchy: researchGovernance.source_hierarchy,
    freshness_report: researchGovernance.freshness,
    claim_conflict_graph: researchGovernance.conflict_graph,
    narrative_blueprint: storyPackage.narrative_blueprint,
    script_package: storyPackage.script_package,
    timing_plan: storyPackage.timing_plan,
    story_report: storyPackage.story_report,
    visual_package: visualPackage,
    visual_identity: visualPackage.visual_identity,
    visual_plan: visualPackage.visual_plan,
    asset_manifest: visualPackage.asset_manifest,
    asset_provenance: visualPackage.asset_provenance,
    thumbnail_plan: visualPackage.thumbnail_plan,
    visual_similarity_report: visualPackage.visual_similarity_report,
    visual_report: visualPackage.visual_report,
    audio_package: audioPackage,
    host_profile: audioPackage.host_profile,
    pronunciation_lexicon: audioPackage.pronunciation_lexicon,
    audio_performance_plan: audioPackage.audio_performance_plan,
    sound_design_plan: audioPackage.sound_design_plan,
    audio_preflight_report: audioPackage.audio_preflight_report,
    script_markdown: scriptPackageToMarkdown(storyPackage.script_package),
    studio_pack_snapshot: studioSnapshot,
    studio_fit_report: selected.fit,
    studio_blueprint: studioBlueprint,
    sourcePacket,
    claims,
    research_report: researchReport,
    episode,
    verification: {
      opportunity_intelligence: opportunityPolicy,
      audience_strategy: audiencePolicy,
      studio_policy: studioPolicy,
      research_governance: {
        passed: researchGovernance.passed,
        source_hierarchy: researchGovernance.source_hierarchy,
        freshness: researchGovernance.freshness,
        conflict_graph: researchGovernance.conflict_graph,
        claim_status_counts: researchGovernance.claim_status_counts,
        issues: researchGovernance.issues,
        warnings: researchGovernance.warnings
      },
      story_engine: storyPolicy,
      visual_system: visualPolicy,
      audio_performance: audioPolicy,
      deterministic_validation: {
        ...structural,
        passed: structural.passed && audiencePolicy.passed && storyPolicy.passed && visualPolicy.passed && audioPolicy.passed && researchCoverage.passed && studioPolicy.passed && researchGovernance.passed,
        issues: [
          ...structural.issues,
          ...audiencePolicy.issues.map((entry) => `audience strategy: ${entry}`),
          ...storyPolicy.issues.map((entry) => `story engine: ${entry}`),
          ...visualPolicy.issues.map((entry) => `visual system: ${entry}`),
          ...audioPolicy.issues.map((entry) => `audio performance: ${entry}`),
          ...researchCoverage.issues,
          ...researchPolicy.issues.map((entry) => `studio research policy: ${entry}`),
          ...researchGovernance.issues.map((entry) => `research governance: ${entry}`)
        ],
        warnings: [...(structural.warnings || []), ...storyPolicy.warnings, ...visualPolicy.warnings, ...audioPolicy.warnings, ...researchPolicy.warnings, ...researchGovernance.warnings]
      },
      editorial_audit: editorial,
      duplicate_and_safety: duplicateAndSafety
    },
    gamma_input: makeGammaInput(episode, storyPackage.script_package),
    qa: {
      status: allPassed ? "blocked_pending_human_approval" : "blocked_validation_failed",
      final_video_exists: false,
      captions_exist: false,
      thumbnail_exists: false,
      verification_passed: allPassed,
      approval_supplied: false,
      next_action: allPassed
        ? `Review the ${selected.studioPack.studio.name} audience strategy, selected hook, full ${selected.archetype.name} script, host performance, pronunciation plan, timing plan, and claim bindings before production.`
        : "Resolve audience fit, studio fit, research, story-engine, visual-system, claim, editorial, or duplicate-audit findings before approval."
    },
    artifacts: [],
    integrationRuns: {},
    generation: {
      mode: generated.mode,
      pack,
      studio_id: selected.studioPack.studio.id,
      studio_version: selected.studioPack.studio.version,
      archetype_id: selected.archetype.id,
      fallback_error: generated.fallback_error || null,
      summary: `Generated a ${storyPackage.script_package.scenes.length}-scene ${selected.archetype.name} programme estimated at ${storyPackage.script_package.estimated_duration_minutes} minutes, grounded in ${storyPackage.story_report.grounded_claim_count} claims and ${storyPackage.story_report.grounded_source_count} sources for ${audienceAssessment.audience_fit.persona?.name || 'the selected audience'}, with ${visualPackage.visual_report.unique_compositions} visual compositions, ${visualPackage.visual_report.asset_count} provenance-tracked visual assets, and ${audioPackage.audio_preflight_report.scene_count} planned audio performances across ${audioPackage.audio_preflight_report.unique_host_count} hosts, plus ${episode.questions.length} internal claim-check units${opportunityEvidence.snapshot.opportunity_id ? ` for opportunity ${opportunityEvidence.snapshot.opportunity_id}` : ''}.`
    },
    approved: false,
    currentStage: 10
  };
}

async function runRulesEngine() {
  return {
    mode: "live",
    summary: "Episode was drafted from atomic source claims with citation bindings."
  };
}

async function runGamma(packet) {
  if (!isLiveIntegration(integrationCatalog[1])) {
    return { mode: "mock", summary: "Prepared Gamma input markdown and mock export metadata." };
  }
  const apiKey = process.env.GAMMA_API_KEY;
  if (!apiKey) throw new Error("GAMMA_API_KEY is not configured.");
  const episodeDir = path.join(EPISODES_DIR, packet.episode.episode_id);
  const requestBody = buildGammaStoryboardRequest(packet);
  const gammaDir = path.join(episodeDir, "imports", "gamma");
  ensureDir(gammaDir);
  const scenePlans = packet.visual_plan?.scene_plans || [];
  const requests = gammaSinglePageRequests(packet);
  const importedAssets = [];
  const generationIds = [];
  let thumbnailRelativePath = null;
  for (let index = 0; index < requests.length; index += 1) {
    const entry = requests[index];
    const create = await gammaFetch("https://public-api.gamma.app/v1.0/generations", {
      apiKey,
      method: "POST",
      body: entry.body
    });
    const generationId = create?.generationId;
    if (!generationId) throw new Error(`Gamma did not return a generationId for ${entry.title}.`);
    generationIds.push(generationId);
    const status = await pollGammaGeneration({ apiKey, generationId });
    if (!status?.exportUrl) throw new Error(`Gamma completed without an exportUrl for ${entry.title}.`);
    const download = await downloadGammaExportFile(status.exportUrl, path.join(gammaDir, generationId, "gamma_export"));
    const primaryFile = download.files?.[0];
    if (!primaryFile) throw new Error(`Gamma export for ${entry.title} did not contain a PNG file.`);
    if (entry.type === "thumbnail") {
      thumbnailRelativePath = promoteGammaThumbnailAsset(packet, episodeDir, primaryFile);
    } else {
      importedAssets.push(promoteGammaSceneAsset(packet, episodeDir, scenePlans[index], primaryFile, index));
    }
  }
  packet.visual_package = packet.visual_package || {};
  packet.visual_package.asset_manifest = packet.asset_manifest;
  packet.visual_package.asset_provenance = packet.asset_provenance;
  packet.visual_package.asset_hashes = packet.visual_asset_hashes;
  packet.visual_package.visual_report = packet.visual_report;
  packet.verification = packet.verification || {};
  packet.verification.visual_system = {
    ...(packet.verification.visual_system || {}),
    passed: Boolean(packet.visual_report?.passed && packet.visual_asset_hashes?.complete),
    asset_count: packet.visual_report?.asset_count || 0,
    issues: packet.visual_report?.issues || [],
    checked_at: new Date().toISOString()
  };
  return {
    mode: "live",
    verified: importedAssets.length === scenePlans.length && Boolean(thumbnailRelativePath),
    summary: `Gamma generated and promoted ${importedAssets.length} scene images plus a thumbnail replacement.`,
    generation_ids: generationIds,
    imported_assets: importedAssets,
    thumbnail_relative_path: thumbnailRelativePath,
    request_pages: requestBody.pages?.length || 0
  };
}

async function produceEpisodeAudio(packet, { provider = "auto", force = false, actor = "system" } = {}) {
  const episodeId = packet.episode.episode_id;
  const episodeDir = path.join(EPISODES_DIR, episodeId);
  const audioPackage = packet.audio_package || database.getAudioPackageForEpisode(episodeId);
  if (!audioPackage?.audio_preflight_report?.passed) throw new Error("Audio performance preflight must pass before synthesis.");
  const production = await produceAudioAssets({ root: ROOT, episodeDir, audioPackage, provider, force });
  packet.audio_production = production;
  packet.audio_package = { ...audioPackage, production, passed: Boolean(audioPackage.audio_preflight_report.passed && production.passed) };
  packet.audio_manifest = production.audio_manifest;
  packet.audio_asset_hashes = production.audio_asset_hashes;
  packet.loudness_report = production.loudness_report;
  packet.audio_performance_report = production.performance_report;
  writeJson(path.join(episodeDir, "audio_manifest.json"), production.audio_manifest);
  writeJson(path.join(episodeDir, "audio_asset_hashes.json"), production.audio_asset_hashes);
  writeJson(path.join(episodeDir, "loudness_report.json"), production.loudness_report);
  writeJson(path.join(episodeDir, "audio_performance_report.json"), production.performance_report);
  packet.audio_approval_bundle = updateAudioApprovalBundle(episodeDir);
  database.saveAudioPackage(`episode:${episodeId}`, episodeId, packet.brief.studio_id, packet.audio_package);
  database.audit({ episodeId, eventType: "audio_production_completed", actor, details: { provider: production.provider, scene_count: production.performance_report.scene_count, passed: production.performance_report.passed, cache_hits: production.performance_report.cache_hits } });
  return production;
}

function renderAssetsFromProduction(production) {
  return (production.render_asset_hashes?.assets || []).map((asset, index) => {
    const segmentMatch = String(asset.name || '').match(/^segment:(.+)$/);
    return {
      asset_id: `render_${crypto.createHash("sha256").update(`${asset.relative_path}|${asset.sha256}`).digest("hex").slice(0, 20)}`,
      scene_id: segmentMatch ? segmentMatch[1] : null,
      asset_type: asset.kind || (segmentMatch ? "render_segment" : "render_output"),
      relative_path: asset.relative_path,
      status: "ready",
      sha256: asset.sha256,
      size_bytes: asset.size_bytes,
      created_at: new Date().toISOString(),
      order: index
    };
  });
}

function buildEpisodeRenderPlan(packet, profileId = "proxy") {
  const visualPackage = packet.visual_package || database.getVisualPackageForEpisode(packet.episode.episode_id);
  const audioPackage = packet.audio_package || database.getAudioPackageForEpisode(packet.episode.episode_id);
  const audioProduction = packet.audio_production || audioPackage?.production;
  if (!visualPackage?.visual_report?.passed) throw new Error("A passing visual package is required before rendering.");
  if (!audioProduction?.performance_report?.passed) throw new Error("Passing audio production evidence is required before rendering.");
  return buildRenderPlan({
    episodeId: packet.episode.episode_id,
    studioId: packet.brief?.studio_id || packet.episode?.studio?.id,
    title: packet.episode.title,
    scriptPackage: packet.script_package || database.getStoryPackageForEpisode(packet.episode.episode_id),
    visualPackage,
    audioProduction,
    profileId,
    outputFormat: packet.brief?.output_format || "long_form"
  });
}

async function produceEpisodeRender(packet, { profileId = "final", force = false, sceneIds = null, actor = "system" } = {}) {
  const episodeId = packet.episode.episode_id;
  const episodeDir = path.join(EPISODES_DIR, episodeId);
  if (!packet.approved) throw new Error("A valid editorial approval is required before rendering.");
  if (!packet.audio_approved) throw new Error("A valid audio-performance approval is required before rendering.");
  const renderPlan = buildEpisodeRenderPlan(packet, profileId);
  const production = renderEpisode({ episodeDir, renderPlan, force, sceneIds });
  const renderAssets = renderAssetsFromProduction(production);
  packet.render_production = { ...production, render_assets: renderAssets };
  packet.render_package = { ...production, render_assets: renderAssets, passed: production.passed };
  packet.render_plan = production.render_plan;
  packet.caption_track = production.caption_track;
  packet.render_manifest_v2 = production.render_manifest;
  packet.render_asset_hashes = production.render_asset_hashes;
  packet.render_qa_report = production.render_qa_report;
  packet.verification.render_system = {
    passed: production.render_qa_report.passed,
    profile_id: production.render_qa_report.profile_id,
    scene_count: production.render_qa_report.scene_count,
    duration_seconds: production.render_qa_report.probe?.duration_seconds || 0,
    embedded_subtitles: production.render_qa_report.embedded_subtitles,
    issues: production.render_qa_report.issues,
    warnings: production.render_qa_report.warnings,
    checked_at: production.render_qa_report.checked_at
  };
  if (profileId === "final") packet.render_approval_bundle = updateRenderApprovalBundle(episodeDir);
  database.saveRenderPackage(`episode:${episodeId}`, episodeId, packet.brief.studio_id, packet.render_package);
  database.audit({ episodeId, eventType: "render_production_completed", actor, details: { profile_id: profileId, scene_count: production.render_qa_report.scene_count, passed: production.passed, segment_cache_hits: production.render_qa_report.segment_cache_hits, partial_scene_ids: sceneIds || [] } });
  return production;
}

async function runElevenLabs(packet) {
  const live = isLiveIntegration(integrationCatalog[2]);
  const provider = live ? "elevenlabs" : "auto";
  const production = await produceEpisodeAudio(packet, { provider, actor: live ? "elevenlabs-adapter" : "local-audio-engine" });
  return {
    mode: live ? "live" : "local_fallback",
    provider: production.provider,
    summary: `Generated and mastered ${production.performance_report.scene_count} scene audio performances with ${production.performance_report.cache_hits} cache hits.`,
    verified: production.performance_report.passed,
    evidence: "audio_performance_report.json"
  };
}

function youtubeCredentialStatus() {
  const hasStaticAccess = Boolean(process.env.YOUTUBE_ACCESS_TOKEN);
  const hasRefresh = Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN);
  return {
    configured: hasStaticAccess || hasRefresh,
    mode: hasStaticAccess ? 'static_access_token' : hasRefresh ? 'oauth_refresh_token' : 'missing',
    required_environment: hasStaticAccess ? ['YOUTUBE_ACCESS_TOKEN'] : ['YOUTUBE_CLIENT_ID', 'YOUTUBE_REFRESH_TOKEN'],
    optional_environment: ['YOUTUBE_CLIENT_SECRET'],
    missing: hasStaticAccess || hasRefresh ? [] : ['YOUTUBE_CLIENT_ID', 'YOUTUBE_REFRESH_TOKEN'],
    values_redacted: true
  };
}

async function acquireYouTubeAccessToken() {
  if (process.env.YOUTUBE_ACCESS_TOKEN) return { access_token: process.env.YOUTUBE_ACCESS_TOKEN, source: 'static_access_token', acquired_at: nowIso() };
  const refreshed = await refreshAccessToken({
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN
  });
  return { ...refreshed, source: 'oauth_refresh_token' };
}

function metadataOverridesFromPackage(metadata = {}) {
  return {
    title: metadata.snippet?.title,
    description: metadata.snippet?.description,
    tags: metadata.snippet?.tags,
    categoryId: metadata.snippet?.categoryId,
    defaultLanguage: metadata.snippet?.defaultLanguage,
    privacyStatus: metadata.status?.privacyStatus || 'private',
    selfDeclaredMadeForKids: metadata.status?.selfDeclaredMadeForKids,
    containsSyntheticMedia: metadata.status?.containsSyntheticMedia,
    embeddable: metadata.status?.embeddable,
    publicStatsViewable: metadata.status?.publicStatsViewable,
    license: metadata.status?.license,
    publishAt: metadata.status?.publishAt || null,
    hasPaidProductPlacement: metadata.paidProductPlacementDetails?.hasPaidProductPlacement,
    captionLanguage: metadata.upload?.captionLanguage,
    captionName: metadata.upload?.captionName,
    captionIsDraft: metadata.upload?.captionIsDraft,
    affiliateDisclosure: metadata.disclosures?.affiliate,
    sponsorshipDisclosure: metadata.disclosures?.sponsorship,
    sensitiveTopicReviewed: metadata.disclosures?.sensitive_topic_reviewed
  };
}

function savePublishingState(packet, publishingPackage, { uploadReceipt = null, processingReport = null, assetUploads = null, actor = 'system', event = null } = {}) {
  const episodeId = packet.episode.episode_id;
  const episodeDir = path.join(EPISODES_DIR, episodeId);
  const written = writePublishingArtifacts(episodeDir, publishingPackage, { uploadReceipt, processingReport, assetUploads });
  publishingPackage.verification = written.verification;
  publishingPackage.release_approval_bundle = written.release_bundle;
  packet.publishing_package = publishingPackage;
  packet.publishing_verification = written.verification;
  packet.release_approval_bundle = written.release_bundle;
  database.savePublishingPackage(`episode:${episodeId}`, episodeId, packet.brief?.studio_id || packet.episode?.studio?.id || null, publishingPackage);
  if (event) database.recordPublishingEvent({ eventId: makeId('publish_event'), episodeId, action: event.action, status: event.status, provider: 'youtube', details: redactPublishingPackage(event.details || {}) });
  database.audit({ episodeId, eventType: event?.action || 'publishing_state_saved', actor, details: { status: publishingPackage.status, video_id: publishingPackage.remote?.video_id || null, package_hash: publishingPackage.package_hash } });
  database.upsertEpisode(packet);
  return { publishingPackage, ...written };
}

function createPublishingPreflight(packet, overrides = {}, actor = 'local-publisher') {
  const episodeId = packet.episode.episode_id;
  const episodeDir = path.join(EPISODES_DIR, episodeId);
  const cockpit = syncEditorialCockpit(packet, { writeFiles: true });
  const existing = database.getPublishingPackageForEpisode(episodeId);
  const publishingPackage = buildPublishingPackage({
    packet,
    episodeDir,
    finalSignoff: cockpit.final_signoff,
    overrides,
    remote: existing?.remote || null
  });
  savePublishingState(packet, publishingPackage, {
    actor,
    event: { action: 'publishing_preflight', status: publishingPackage.preflight_passed ? 'passed' : 'blocked', details: { compliance_hash: publishingPackage.compliance.report_hash, metadata_hash: publishingPackage.metadata.metadata_hash, issues: publishingPackage.compliance.issues } }
  });
  syncEditorialCockpit(packet, { writeFiles: true });
  return publishingPackage;
}

function publishingPackageFor(packet) {
  const existing = database.getPublishingPackageForEpisode(packet.episode.episode_id);
  if (!existing) return null;
  const episodeDir = path.join(EPISODES_DIR, packet.episode.episode_id);
  const cockpit = syncEditorialCockpit(packet, { writeFiles: true });
  const currentCompliance = buildComplianceReport({ packet, episodeDir, finalSignoff: cockpit.final_signoff, metadata: existing.metadata });
  let updated = {
    ...existing,
    compliance: currentCompliance,
    preflight_passed: currentCompliance.preflight_passed,
    private_upload_ready: Boolean(currentCompliance.passed && cockpit.final_signoff?.valid),
    final_signoff_observed: Boolean(cockpit.final_signoff?.valid)
  };
  if (currentCompliance.report_hash !== existing.compliance?.report_hash) {
    updated = buildPublishingPackage({ packet, episodeDir, finalSignoff: cockpit.final_signoff, overrides: metadataOverridesFromPackage(existing.metadata), remote: existing.remote });
    updated.status = 'blocked_local_drift';
    updated.release_ready = false;
    savePublishingState(packet, updated, { actor: 'system', event: { action: 'publishing_drift_detected', status: 'blocked', details: { previous_compliance_hash: existing.compliance?.report_hash || null, current_compliance_hash: currentCompliance.report_hash } } });
  } else {
    packet.publishing_package = updated;
    packet.publishing_verification = buildPublishingVerification(updated);
    database.savePublishingPackage(`episode:${packet.episode.episode_id}`, packet.episode.episode_id, updated.studio_id, updated);
  }
  return updated;
}

async function runYouTube(packet) {
  const publishingPackage = createPublishingPreflight(packet, {}, 'integration-preflight');
  return {
    mode: youtubeCredentialStatus().configured ? 'live_ready' : 'preflight_only',
    operation: 'publishing_preflight',
    summary: publishingPackage.preflight_passed
      ? 'Generated the immutable YouTube metadata and compliance package. Use the Publishing Console for explicit resumable upload.'
      : 'Publishing preflight is blocked by local compliance findings.',
    verified: publishingPackage.preflight_passed,
    evidence: 'compliance_report.json',
    credentials: youtubeCredentialStatus()
  };
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function bindFinalSignoff(episodeDir, signoff, tasks, comments, approvals) {
  if (!signoff) return null;
  let currentHash = null;
  let bundle = null;
  try {
    const artifactPath = safeResolve(episodeDir, signoff.artifact_name);
    if (fs.existsSync(artifactPath)) {
      currentHash = sha256File(artifactPath);
      bundle = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    }
  } catch (_error) { currentHash = null; bundle = null; }
  const expected = buildFinalSignoffBundle({
    episodeId: signoff.episode_id, episodeDir, reviewer: signoff.reviewer,
    notes: signoff.notes || "", tasks, comments, approvals
  });
  return {
    ...signoff,
    current_artifact_hash: currentHash,
    current_bundle_hash: expected.bundle_hash,
    valid: Boolean(currentHash && currentHash === signoff.artifact_hash && bundle?.bundle_hash === expected.bundle_hash && expected.complete)
  };
}

function syncEditorialCockpit(packet, { writeFiles = true } = {}) {
  if (!packet?.episode?.episode_id) throw new Error("An episode is required for the editorial cockpit.");
  const episodeId = packet.episode.episode_id;
  const episodeDir = path.join(EPISODES_DIR, episodeId);
  ensureDir(episodeDir);
  const existing = database.listReviewTasks(episodeId);
  buildReviewTasks({ episodeId, episodeDir, packet, existingTasks: existing }).forEach((task) => database.upsertReviewTask(task));
  const tasks = database.listReviewTasks(episodeId);
  const comments = database.listReviewComments(episodeId);
  const decisions = database.listReviewDecisions(episodeId);
  const approvals = database.listApprovals(episodeId);
  const signoffs = database.listFinalSignoffs(episodeId);
  const finalSignoff = bindFinalSignoff(episodeDir, signoffs[0] || null, tasks, comments, approvals);
  const coverage = reviewCoverage(tasks, comments);
  const dependencyMap = buildDependencyMap({ packet, tasks, comments, finalSignoff });
  const manifest = buildReviewManifest({ episodeId, tasks, comments, decisions, coverage, dependencyMap });
  const cockpit = {
    schema: "nichefoundry.editorial_cockpit.v1",
    episode_id: episodeId,
    roles: REVIEW_ROLES,
    tasks,
    queues: buildQueues(tasks),
    comments,
    decisions,
    snapshots: database.listReviewSnapshots(episodeId),
    coverage,
    dependency_map: dependencyMap,
    final_signoff: finalSignoff,
    manifest
  };
  if (writeFiles) {
    writeJson(path.join(episodeDir, "editorial_review_manifest.json"), manifest);
    writeJson(path.join(episodeDir, "review_dependency_map.json"), dependencyMap);
    fs.writeFileSync(path.join(episodeDir, "editorial_audit_export.md"), reviewExportMarkdown({ packet, cockpit }));
  }
  packet.editorial_cockpit = {
    coverage, dependency_map: dependencyMap, final_signoff: finalSignoff,
    task_count: tasks.length, open_comment_count: comments.filter((item) => item.status === "open").length
  };
  packet.final_signed_off = Boolean(finalSignoff?.valid);
  return cockpit;
}

function assertNoBlockingComments(episodeId, stage) {
  const taskIds = new Set(database.listReviewTasks(episodeId).filter((task) => task.stage === stage).map((task) => task.task_id));
  const blockers = database.listReviewComments(episodeId, { status: "open" }).filter((comment) => comment.severity === "blocker" && taskIds.has(comment.task_id));
  if (blockers.length) throw new Error(`${stage} approval is blocked by ${blockers.length} unresolved review comment(s).`);
}

function approveReviewStage(packet, stage, reviewer, notes = "") {
  const cockpit = syncEditorialCockpit(packet);
  assertNoBlockingComments(packet.episode.episode_id, stage);
  for (const task of cockpit.tasks.filter((item) => item.stage === stage)) {
    if (!task.ready) throw new Error(`${task.label} is not ready for review approval.`);
    if (task.status === "approved") continue;
    database.recordReviewDecision({
      decisionId: makeId("review_decision"), taskId: task.task_id, episodeId: packet.episode.episode_id,
      artifactHash: task.artifact_hash, reviewer, decision: "approved", notes
    });
  }
  return syncEditorialCockpit(packet);
}

async function executeIntegrationJob(packet, jobType, runner, { enabled = true, blockedReason = null } = {}) {
  const jobId = makeId(jobType);
  database.createJob({
    jobId,
    episodeId: packet.episode.episode_id,
    jobType,
    status: enabled ? "queued" : "blocked_for_review",
    input: { episode_id: packet.episode.episode_id }
  });

  if (!enabled) {
    const blocked = database.updateJob(jobId, {
      status: "blocked_for_review",
      error: blockedReason || "Job prerequisites are not satisfied.",
      finished_at: nowIso()
    });
    return { job: blocked, result: { mode: "blocked", summary: blocked.error } };
  }

  database.updateJob(jobId, { status: "running", attempts: 1, started_at: nowIso() });
  try {
    const result = await runner(packet);
    const verified = result?.verified === true;
    const status = verified ? "completed" : "blocked_for_review";
    const error = verified
      ? null
      : result?.mode === "mock"
        ? "Provider is not configured; only preparation artifacts were produced."
        : "The provider call returned no independently verified output artifact.";
    const job = database.updateJob(jobId, {
      status,
      output: result,
      error,
      finished_at: nowIso()
    });
    database.audit({
      episodeId: packet.episode.episode_id,
      eventType: "job_finished",
      actor: "system",
      details: { job_id: jobId, job_type: jobType, status, verified }
    });
    return { job, result };
  } catch (error) {
    const job = database.updateJob(jobId, {
      status: "failed",
      error: error.message || String(error),
      finished_at: nowIso()
    });
    database.audit({
      episodeId: packet.episode.episode_id,
      eventType: "job_failed",
      actor: "system",
      details: { job_id: jobId, job_type: jobType, error: job.error }
    });
    return { job, result: { mode: "failed", summary: job.error } };
  }
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  setSecurityHeaders(response);
  Object.entries(extraHeaders).forEach(([key, value]) => response.setHeader(key, value));
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function parseCookies(request) {
  const cookieHeader = request.headers.cookie || "";
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isAuthorized(request) {
  const cookies = parseCookies(request);
  if (timingSafeEqualText(cookies.foundry_session, LOCAL_SESSION_TOKEN)) return true;

  const supplied = request.headers["x-foundry-token"] ||
    String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return Boolean(AUTH_TOKEN && timingSafeEqualText(supplied, AUTH_TOKEN));
}

function sessionCookie() {
  return `foundry_session=${encodeURIComponent(LOCAL_SESSION_TOKEN)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`;
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > BODY_LIMIT_BYTES) {
        tooLarge = true;
        return;
      }
      data += chunk;
    });
    request.on("end", () => {
      if (tooLarge) {
        const error = new Error(`Request body exceeds ${BODY_LIMIT_BYTES} bytes.`);
        error.statusCode = 413;
        reject(error);
        return;
      }
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function serveFile(request, response, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (_error) {
    sendJson(response, 400, { error: "Malformed path." });
    return;
  }

  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === ".." || segment.startsWith("."))) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  let filePath;
  try {
    filePath = safeResolve(PUBLIC_DIR, relativePath);
  } catch (_error) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  fs.readFile(filePath, (error, buffer) => {
    if (error || !fs.statSync(filePath).isFile()) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp"
    };

    setSecurityHeaders(response);
    if (decoded === "/" && isLoopbackRequest(request)) {
      response.setHeader("Set-Cookie", sessionCookie());
    }
    response.setHeader("Cache-Control", extension === ".html" ? "no-store" : "public, max-age=300");
    response.writeHead(200, { "Content-Type": contentTypes[extension] || "application/octet-stream" });
    response.end(buffer);
  });
}

function readJsonIfPresent(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function importEpisodesFromDisk() {
  ensureDir(EPISODES_DIR);
  const previousCurrentId = database.getSetting("current_episode_id");
  const directories = fs.readdirSync(EPISODES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const directoryName of directories) {
    const episodeDir = path.join(EPISODES_DIR, directoryName);
    const episode = readJsonIfPresent(path.join(episodeDir, "episode.json"));
    const brief = readJsonIfPresent(path.join(episodeDir, "brief.json"));
    if (!episode?.episode_id || !brief || database.getEpisode(episode.episode_id)) continue;

    const sourcePacket = readJsonIfPresent(path.join(episodeDir, "sources.json"), []);
    const claims = readJsonIfPresent(path.join(episodeDir, "claims.json"), []);
    const studioId = brief.studio_id && studioRegistry.get(brief.studio_id) ? brief.studio_id : "puzzle_planet";
    const studioPack = studioRegistry.get(studioId);
    brief.studio_id = studioId;
    brief.archetype_id = brief.archetype_id || studioPack.content.default_archetype;
    const studioFit = scoreEpisodeFit(studioPack, brief);
    const studioBlueprint = buildStudioBlueprint(studioPack, brief, claims);
    const studioSnapshot = { ...studioPack, installed_content_hash: hashObject(studioPack), snapshotted_at: nowIso() };
    writeJson(path.join(episodeDir, "brief.json"), brief);
    writeJson(path.join(episodeDir, "studio_pack_snapshot.json"), studioSnapshot);
    writeJson(path.join(episodeDir, "studio_fit_report.json"), studioFit);
    writeJson(path.join(episodeDir, "studio_blueprint.json"), studioBlueprint);
    const verification = readJsonIfPresent(path.join(episodeDir, "verification.json"), {
      deterministic_validation: validateEpisode(episode, brief),
      editorial_audit: { passed: false, issues: ["Legacy episode requires fresh editorial review."] }
    });
    verification.studio_policy = verification.studio_policy || {
      passed: studioFit.passed,
      fit: studioFit,
      research_policy: assessResearchPolicy(studioPack, sourcePacket),
      studio_id: studioId,
      studio_version: studioPack.studio.version,
      archetype_id: brief.archetype_id,
      checked_at: nowIso()
    };
    writeJson(path.join(episodeDir, "verification.json"), verification);
    const gammaInputPath = path.join(episodeDir, "gamma_input.md");
    const packet = {
      brief,
      studio_pack_snapshot: studioSnapshot,
      studio_fit_report: studioFit,
      studio_blueprint: studioBlueprint,
      sourcePacket,
      claims,
      episode,
      verification,
      gamma_input: fs.existsSync(gammaInputPath) ? fs.readFileSync(gammaInputPath, "utf8") : makeGammaInput(episode),
      integrationRuns: readJsonIfPresent(path.join(episodeDir, "integration_runs.json"), {}),
      generation: {
        mode: "legacy_import",
        pack: inferTopicPack(brief, sourcePacket),
        studio_id: studioId,
        studio_version: studioPack.studio.version,
        archetype_id: brief.archetype_id,
        summary: "Imported from the pre-Phase-2 episode directory. Old completion flags were discarded and the Puzzle Planet compatibility constitution was attached."
      },
      approved: false,
      approval: null,
      currentStage: 0,
      artifacts: []
    };
    refreshPacketEvidence(packet, { save: true });
    database.audit({
      episodeId: episode.episode_id,
      eventType: "legacy_episode_imported",
      actor: "system",
      details: { directory: directoryName, old_qa_trusted: false }
    });
  }

  if (previousCurrentId && database.getEpisode(previousCurrentId)) {
    database.setSetting("current_episode_id", previousCurrentId);
  }
}

function recoverState() {
  importEpisodesFromDisk();
  const recovered = database.getCurrentEpisode();
  if (!recovered) return null;
  try {
    return refreshPacketEvidence(recovered, { save: true });
  } catch (error) {
    database.audit({
      episodeId: recovered.episode?.episode_id || null,
      eventType: "recovery_failed",
      actor: "system",
      details: { error: error.message }
    });
    return recovered;
  }
}

state = recoverState();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/") && url.pathname !== "/api/health" && !isAuthorized(request)) {
      sendJson(response, 401, { error: "Unauthorized. Load the local console first or provide a valid Foundry token." });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "nichefoundry-phase6",
        host: HOST,
        persistence: path.relative(ROOT, DATABASE_PATH),
        current_episode_id: state?.episode?.episode_id || null,
        research_provider: "connector_registry",
        generator_mode: process.env.FOUNDRY_GENERATOR_MODE || "rules",
        story_engine_mode: "deterministic_claim_bound_story_engine_v1",
        installed_studios: studioRegistry.list().length,
        installed_connectors: connectorRegistry.list().length
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/studios") {
      sendJson(response, 200, { studios: studioRegistry.list() });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/studios/") && !url.pathname.endsWith("/validate") && !url.pathname.endsWith("/install") && !url.pathname.endsWith("/fit")) {
      const studioId = decodeURIComponent(url.pathname.slice("/api/studios/".length));
      const record = studioRegistry.getRecord(studioId);
      if (!record) {
        sendJson(response, 404, { error: "Studio Pack not found." });
        return;
      }
      sendJson(response, 200, { studio: record.pack, validation: record.validation, source: record.source });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/studios/validate") {
      const body = await parseBody(request);
      const validation = studioRegistry.validate(body.pack);
      sendJson(response, validation.passed ? 200 : 422, { validation });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/studios/fit") {
      const body = await parseBody(request);
      const studioPack = studioRegistry.get(body.studio_id);
      if (!studioPack) {
        sendJson(response, 404, { error: "Studio Pack not found." });
        return;
      }
      sendJson(response, 200, { fit: scoreEpisodeFit(studioPack, body.brief || {}) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/studios/install") {
      const body = await parseBody(request);
      const installed = studioRegistry.install(body.pack);
      database.audit({
        eventType: "studio_pack_installed",
        actor: String(body.actor || "local-editor").slice(0, 120),
        details: {
          studio_id: installed.studio.studio.id,
          version: installed.studio.studio.version,
          content_hash: installed.validation.content_hash
        }
      });
      sendJson(response, 200, {
        studio: installed.studio,
        validation: installed.validation,
        studios: studioRegistry.list()
      });
      return;
    }


    if (request.method === "GET" && url.pathname === "/api/connectors") {
      sendJson(response, 200, { connectors: connectorRegistry.list() });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/connectors/") && !url.pathname.endsWith("/validate") && !url.pathname.endsWith("/install") && !url.pathname.endsWith("/run")) {
      const connectorId = decodeURIComponent(url.pathname.slice("/api/connectors/".length));
      const connector = connectorRegistry.get(connectorId);
      if (!connector) {
        sendJson(response, 404, { error: "Connector not found." });
        return;
      }
      const summary = connectorRegistry.list().find((item) => item.connector_id === connectorId);
      sendJson(response, 200, { connector, summary });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/connectors/validate") {
      const body = await parseBody(request);
      const validation = validateConnectorDefinition(body.connector || body.definition);
      sendJson(response, validation.passed ? 200 : 422, { validation });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/connectors/install") {
      const body = await parseBody(request);
      const definition = body.connector || body.definition;
      const validation = connectorRegistry.install(definition);
      if (!validation.passed) {
        sendJson(response, 422, { validation });
        return;
      }
      database.audit({
        eventType: "connector_installed",
        actor: String(body.actor || "local-editor").slice(0, 120),
        details: { connector_id: definition.connector.id, version: definition.connector.version, content_hash: validation.content_hash }
      });
      sendJson(response, 200, { connector: connectorRegistry.get(definition.connector.id), validation, connectors: connectorRegistry.list() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/connector-runs") {
      sendJson(response, 200, {
        runs: database.listConnectorRuns({
          connectorId: url.searchParams.get("connector_id") || null,
          episodeId: url.searchParams.get("episode_id") || null,
          studioId: url.searchParams.get("studio_id") || null,
          limit: Number(url.searchParams.get("limit") || 100)
        })
      });
      return;
    }

    if (request.method === "POST" && (url.pathname === "/api/connectors/run" || url.pathname === "/api/connectors/test")) {
      const body = await parseBody(request);
      const connector = connectorRegistry.get(body.connector_id);
      if (!connector) {
        sendJson(response, 404, { error: "Connector not found." });
        return;
      }
      const run = await executeConnector(connector, body.input || {});
      database.saveConnectorRun(run, {
        episodeId: body.episode_id || null,
        studioId: body.studio_id || null,
        capability: body.capability || connector.connector.capabilities[0] || null
      });
      database.audit({
        episodeId: body.episode_id || null,
        eventType: "connector_run_finished",
        actor: String(body.actor || "local-editor").slice(0, 120),
        details: { connector_id: run.connector_id, run_id: run.run_id, status: run.status, source_count: run.sources.length, candidate_count: run.candidates.length }
      });
      let opportunityResult = null;
      if (run.status === "completed" && body.persist_candidates && run.candidates.length) {
        const studioPack = studioRegistry.get(body.studio_id);
        if (!studioPack) {
          sendJson(response, 400, { error: "persist_candidates requires a valid studio_id.", run });
          return;
        }
        opportunityResult = persistOpportunityCandidates(studioPack, run.candidates, String(body.actor || "local-editor").slice(0, 120));
      }
      sendJson(response, run.status === "completed" ? 200 : 422, { run, opportunity_result: opportunityResult });
      return;
    }


    if (request.method === "GET" && url.pathname === "/api/opportunities") {
      sendJson(response, 200, {
        opportunities: database.listOpportunities({
          studioId: url.searchParams.get("studio_id") || null,
          lifecycle: url.searchParams.get("lifecycle") || null,
          limit: Number(url.searchParams.get("limit") || 500)
        })
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/opportunities/score") {
      const body = await parseBody(request);
      const studioPack = studioRegistry.get(body.studio_id);
      if (!studioPack) {
        sendJson(response, 404, { error: "Studio Pack not found." });
        return;
      }
      const scored = scoreOpportunity(studioPack, body.candidate || {});
      const existing = [
        ...database.listOpportunities({ studioId: studioPack.studio.id, limit: 2000 }),
        ...episodeRecordsForOpportunityAudit(studioPack.studio.id)
      ];
      scored.cannibalization = buildCannibalizationReport(scored, existing);
      sendJson(response, 200, { opportunity: scored });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/opportunities/discover") {
      const body = await parseBody(request);
      const studioPack = studioRegistry.get(body.studio_id);
      if (!studioPack) {
        sendJson(response, 404, { error: "Studio Pack not found." });
        return;
      }
      const provider = body.provider || "studio_seeds";
      let candidates;
      if (provider === "studio_seeds") {
        candidates = discoverStudioSeeds(studioPack);
      } else if (provider === "manual") {
        if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
          sendJson(response, 400, { error: "Manual discovery requires a non-empty candidates array." });
          return;
        }
        candidates = body.candidates.map((candidate) => ({ ...candidate, discovery_source: candidate.discovery_source || "manual" }));
      } else if (provider === "mediawiki_search") {
        if (!String(body.query || "").trim()) {
          sendJson(response, 400, { error: "MediaWiki discovery requires a query." });
          return;
        }
        candidates = await discoverMediaWiki(studioPack, String(body.query).trim(), { limit: body.limit || 10 });
      } else if (provider === "connector") {
        const connector = connectorRegistry.get(body.connector_id);
        if (!connector) {
          sendJson(response, 404, { error: "Discovery connector not found." });
          return;
        }
        const run = await executeConnector(connector, body.input || { query: body.query });
        database.saveConnectorRun(run, { studioId: studioPack.studio.id, capability: "topic_discovery" });
        if (run.status !== "completed") {
          sendJson(response, 422, { error: run.error, run });
          return;
        }
        candidates = run.candidates;
        if (!candidates.length) {
          sendJson(response, 422, { error: "Connector completed but produced no opportunity candidates.", run });
          return;
        }
      } else {
        sendJson(response, 400, { error: `Unsupported discovery provider '${provider}'.` });
        return;
      }
      const result = persistOpportunityCandidates(studioPack, candidates, String(body.actor || "local-editor").slice(0, 120));
      sendJson(response, 200, {
        provider,
        proxy_notice: "Unless operator or connected-provider signals are supplied, market variables are documented proxy heuristics rather than live demand measurements.",
        ...result
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/opportunities/lifecycle") {
      const body = await parseBody(request);
      const opportunity = database.getOpportunity(body.opportunity_id);
      if (!opportunity) {
        sendJson(response, 404, { error: "Opportunity not found." });
        return;
      }
      transitionLifecycle(opportunity.lifecycle, body.lifecycle);
      const updated = {
        ...opportunity,
        lifecycle: body.lifecycle,
        lifecycle_note: String(body.note || "").slice(0, 1000),
        updated_at: new Date().toISOString()
      };
      database.updateOpportunityLifecycle(opportunity.opportunity_id, body.lifecycle, updated);
      database.audit({
        eventType: "opportunity_lifecycle_changed",
        actor: String(body.actor || "local-editor").slice(0, 120),
        details: { opportunity_id: opportunity.opportunity_id, from: opportunity.lifecycle, to: body.lifecycle }
      });
      sendJson(response, 200, { opportunity: database.getOpportunity(opportunity.opportunity_id) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/opportunities/brief") {
      const body = await parseBody(request);
      const opportunity = database.getOpportunity(body.opportunity_id);
      if (!opportunity) {
        sendJson(response, 404, { error: "Opportunity not found." });
        return;
      }
      if (['rejected', 'retired'].includes(opportunity.lifecycle) || opportunity.fit?.passed === false || opportunity.cannibalization?.passed === false) {
        sendJson(response, 422, { error: "This opportunity cannot enter production until its fit or cannibalisation block is resolved." });
        return;
      }
      const studioPack = studioRegistry.get(opportunity.studio_id);
      sendJson(response, 200, { brief: opportunityToBrief(studioPack, opportunity), opportunity });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/opportunities/analysis") {
      const studioId = url.searchParams.get("studio_id");
      if (!studioId) {
        sendJson(response, 400, { error: "studio_id is required." });
        return;
      }
      const opportunities = database.listOpportunities({ studioId, limit: 2000 });
      sendJson(response, 200, {
        studio_id: studioId,
        clusters: clusterOpportunities(opportunities),
        portfolio: buildPortfolioReport(opportunities),
        competitor_map: buildCompetitorMap(opportunities),
        signal_coverage: buildSignalCoverage(opportunities),
        lifecycle_counts: opportunities.reduce((counts, item) => ({ ...counts, [item.lifecycle]: (counts[item.lifecycle] || 0) + 1 }), {}),
        top_opportunities: opportunities.slice(0, 20)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/opportunities/series-plan") {
      const body = await parseBody(request);
      const studioPack = studioRegistry.get(body.studio_id);
      if (!studioPack) {
        sendJson(response, 404, { error: "Studio Pack not found." });
        return;
      }
      const opportunities = database.listOpportunities({ studioId: body.studio_id, limit: 2000 });
      const plan = buildSeriesPlan(studioPack, opportunities, { name: body.name });
      const seriesPlanId = makeId("series_plan");
      database.saveSeriesPlan(seriesPlanId, body.studio_id, plan);
      database.audit({ eventType: "series_plan_created", actor: body.actor || "local-editor", details: { series_plan_id: seriesPlanId, studio_id: body.studio_id, series_count: plan.series.length } });
      sendJson(response, 200, { ...plan, series_plan_id: seriesPlanId });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/series-plans") {
      sendJson(response, 200, { series_plans: database.listSeriesPlans(url.searchParams.get("studio_id") || null) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/opportunities/calendar") {
      const body = await parseBody(request);
      const studioPack = studioRegistry.get(body.studio_id);
      if (!studioPack) {
        sendJson(response, 404, { error: "Studio Pack not found." });
        return;
      }
      const opportunities = database.listOpportunities({ studioId: body.studio_id, limit: 2000 });
      const calendar = buildEditorialCalendar(studioPack, opportunities, body);
      const calendarId = makeId("calendar");
      database.saveEditorialCalendar(calendarId, body.studio_id, calendar);
      database.audit({ eventType: "editorial_calendar_created", actor: body.actor || "local-editor", details: { calendar_id: calendarId, studio_id: body.studio_id, entry_count: calendar.entries.length } });
      sendJson(response, 200, { ...calendar, calendar_id: calendarId });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/editorial-calendars") {
      sendJson(response, 200, { calendars: database.listEditorialCalendars(url.searchParams.get("studio_id") || null) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/audience-strategy") {
      const studioId = url.searchParams.get("studio_id") || state?.brief?.studio_id || "puzzle_planet";
      const pack = studioRegistry.get(studioId);
      if (!pack) {
        sendJson(response, 404, { error: "Studio Pack not found." });
        return;
      }
      const strategy = buildAndPersistChannelStrategy(pack, "local-editor");
      sendJson(response, 200, { strategy });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/audience-strategy/assess") {
      const body = await parseBody(request);
      const studioId = body.studio_id || body.brief?.studio_id;
      const pack = studioRegistry.get(studioId);
      if (!pack) {
        sendJson(response, 404, { error: "Studio Pack not found." });
        return;
      }
      const brief = { ...(body.brief || {}), studio_id: studioId, archetype_id: body.brief?.archetype_id || pack.content.default_archetype };
      if (!brief.working_title || !brief.topic || !brief.story_premise) {
        sendJson(response, 400, { error: "Working title, topic, and story premise are required for audience assessment." });
        return;
      }
      const history = audienceHistoryForStudio(studioId);
      const channelStrategy = buildChannelStrategy(pack, history);
      const assessment = assessEpisodeStrategy(pack, brief, { ...history, channel_strategy: channelStrategy });
      const assessmentId = makeId("audience_assessment");
      database.saveChannelStrategy(`${studioId}:current`, studioId, channelStrategy);
      database.saveAudienceAssessment(assessmentId, studioId, assessment, null);
      database.audit({
        eventType: "audience_strategy_assessed",
        actor: body.actor || "local-editor",
        details: {
          assessment_id: assessmentId,
          studio_id: studioId,
          passed: assessment.passed,
          score: assessment.audience_fit.score,
          persona_id: assessment.audience_fit.persona?.id || null,
          viewer_job_id: assessment.audience_fit.viewer_job?.id || null,
          content_pillar_id: assessment.audience_fit.content_pillar?.id || null
        }
      });
      sendJson(response, 200, { assessment_id: assessmentId, assessment, strategy: channelStrategy });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/audience-assessments") {
      sendJson(response, 200, {
        assessments: database.listAudienceAssessments({
          studioId: url.searchParams.get("studio_id") || null,
          episodeId: url.searchParams.get("episode_id") || null,
          limit: Number(url.searchParams.get("limit") || 50)
        })
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/story-engine/preview") {
      const body = await parseBody(request);
      const brief = body.brief || {};
      const selected = resolveStudioForBrief(brief);
      const history = audienceHistoryForStudio(selected.studioPack.studio.id);
      const channelStrategy = buildChannelStrategy(selected.studioPack, history);
      const audienceAssessment = assessEpisodeStrategy(selected.studioPack, selected.brief, {
        ...history,
        channel_strategy: channelStrategy,
        studio_fit: selected.fit
      });
      const studioBlueprint = buildStudioBlueprint(selected.studioPack, selected.brief, []);
      const narrativeBlueprint = buildNarrativeBlueprint(
        selected.studioPack, selected.archetype, selected.brief, [], studioBlueprint, audienceAssessment
      );
      sendJson(response, 200, { narrative_blueprint: narrativeBlueprint, audience_fit: audienceAssessment.audience_fit });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/story-engine") {
      const episodeId = url.searchParams.get("episode_id") || state?.episode?.episode_id;
      if (!episodeId) {
        sendJson(response, 400, { error: "No episode selected." });
        return;
      }
      const packet = database.getEpisode(episodeId);
      if (!packet) {
        sendJson(response, 404, { error: "Episode not found." });
        return;
      }
      sendJson(response, 200, {
        episode_id: episodeId,
        narrative_blueprint: packet.narrative_blueprint || null,
        script_package: packet.script_package || database.getStoryPackageForEpisode(episodeId),
        timing_plan: packet.timing_plan || null,
        story_report: packet.story_report || null
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/story-packages") {
      sendJson(response, 200, { story_packages: database.listStoryPackages({ studioId: url.searchParams.get("studio_id") || null, limit: Number(url.searchParams.get("limit") || 50) }) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/visual-system/preview") {
      const body = await parseBody(request);
      const brief = body.brief || {};
      const selected = resolveStudioForBrief(brief);
      const beats = selected.archetype.required_story_beats || [];
      const scenes = [
        { scene_id: "preview_hook", beat_name: "opening_hook", title: brief.working_title, objective: brief.story_premise, claim_ids: [], source_ids: [], visual_requirements: ["Establish one unmistakable focal subject"] },
        ...beats.map((beat, index) => ({ scene_id: `preview_${index + 1}`, beat_name: beat, title: beat.replaceAll("_", " "), objective: `Visually advance the ${beat.replaceAll("_", " ")} beat using the studio's native evidence grammar.`, claim_ids: [], source_ids: [], visual_requirements: [] })),
        { scene_id: "preview_close", beat_name: "closing_payoff", title: "Payoff", objective: "Resolve the visual argument with a useful final image rather than a generic end card.", claim_ids: [], source_ids: [], visual_requirements: [] }
      ];
      const preview = buildVisualPackage({
        pack: selected.studioPack, brief: selected.brief,
        scriptPackage: { scenes }, episodeId: `preview_${selected.studioPack.studio.id}`, priorPackets: []
      });
      sendJson(response, 200, { visual_identity: preview.visual_identity, visual_plan: preview.visual_plan, thumbnail_plan: preview.thumbnail_plan, visual_report: preview.visual_report });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/visual-assets/file") {
      const episodeId = url.searchParams.get("episode_id") || state?.episode?.episode_id;
      const relativePath = String(url.searchParams.get("path") || "").replaceAll("\\", "/");
      const packet = episodeId ? database.getEpisode(episodeId) : null;
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      if (!(relativePath.startsWith("visuals/") || relativePath.startsWith("imports/visuals/"))) {
        sendJson(response, 400, { error: "Visual preview paths must remain inside the episode visual directories." }); return;
      }
      const registered = (packet.asset_manifest?.assets || []).some((item) => item.relative_path === relativePath);
      if (!registered) { sendJson(response, 404, { error: "Visual asset is not registered in the episode ledger." }); return; }
      let absolutePath;
      try { absolutePath = safeResolve(path.join(EPISODES_DIR, episodeId), relativePath); }
      catch (_error) { sendJson(response, 404, { error: "Visual asset not found." }); return; }
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) { sendJson(response, 404, { error: "Visual asset not found." }); return; }
      const extension = path.extname(absolutePath).toLowerCase();
      const contentTypes = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
      if (!contentTypes[extension]) { sendJson(response, 415, { error: "Unsupported visual asset format." }); return; }
      setSecurityHeaders(response);
      response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      response.setHeader("Cache-Control", "private, max-age=60");
      response.writeHead(200, { "Content-Type": contentTypes[extension] });
      response.end(fs.readFileSync(absolutePath));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/visual-system") {
      const episodeId = url.searchParams.get("episode_id") || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "No episode selected." }); return; }
      const packet = database.getEpisode(episodeId);
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      sendJson(response, 200, {
        episode_id: episodeId,
        visual_identity: packet.visual_identity || null,
        visual_plan: packet.visual_plan || null,
        asset_manifest: packet.asset_manifest || { assets: database.listVisualAssets(episodeId) },
        asset_provenance: packet.asset_provenance || null,
        visual_asset_hashes: packet.visual_asset_hashes || null,
        thumbnail_plan: packet.thumbnail_plan || null,
        visual_similarity_report: packet.visual_similarity_report || null,
        visual_report: packet.visual_report || null
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/visual-packages") {
      sendJson(response, 200, { visual_packages: database.listVisualPackages({ studioId: url.searchParams.get("studio_id") || null, limit: Number(url.searchParams.get("limit") || 50) }) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/visual-assets/validate") {
      const body = await parseBody(request);
      sendJson(response, 200, { validation: validateExternalAssetRecord(body.asset || body) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/visual-assets/register") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      const packet = episodeId ? database.getEpisode(episodeId) : null;
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      const relativePath = String(body.relative_path || "").replaceAll("\\", "/");
      if (!relativePath.startsWith("imports/visuals/")) { sendJson(response, 400, { error: "Imported visual assets must be placed under imports/visuals/ inside the episode directory." }); return; }
      if (!/\.(svg|png|jpe?g|webp)$/i.test(relativePath)) { sendJson(response, 400, { error: "Supported imported visual formats are SVG, PNG, JPEG, and WebP." }); return; }
      const assetRecord = {
        asset_id: body.asset_id || makeId("visual_asset"), episode_id: episodeId, scene_id: body.scene_id || null,
        asset_type: body.asset_type || "imported_scene_asset", media_type: body.media_type || null, relative_path: relativePath,
        role: body.role || "scene_replacement", status: "registered", generated_by: body.generated_by || "human_import",
        creator: body.creator || null, publisher: body.publisher || null, source_url: body.source_url || null,
        licence: body.licence || null, rights_status: body.rights_status || null, synthetic: Boolean(body.synthetic),
        disclosure_required: Boolean(body.disclosure_required), source_ids: body.source_ids || [], claim_ids: body.claim_ids || [],
        replaces_asset_id: body.replaces_asset_id || null, created_at: new Date().toISOString()
      };
      const validation = validateExternalAssetRecord(assetRecord);
      if (!validation.passed) { sendJson(response, 422, { error: "Asset provenance validation failed.", validation }); return; }
      const episodeDir = path.join(EPISODES_DIR, episodeId);
      const absolutePath = safeResolve(episodeDir, relativePath);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) { sendJson(response, 400, { error: `Imported asset does not exist: ${relativePath}` }); return; }
      assetRecord.size_bytes = fs.statSync(absolutePath).size;
      assetRecord.sha256 = sha256File(absolutePath);
      packet.asset_manifest = packet.asset_manifest || { schema: "nichefoundry.asset_manifest.v1.0", episode_id: episodeId, assets: [] };
      if (assetRecord.replaces_asset_id) {
        const replaced = packet.asset_manifest.assets.find((item) => item.asset_id === assetRecord.replaces_asset_id);
        if (replaced) replaced.status = "superseded";
      }
      packet.asset_manifest.assets = packet.asset_manifest.assets.filter((item) => item.asset_id !== assetRecord.asset_id);
      packet.asset_manifest.assets.push(assetRecord);
      packet.asset_provenance = packet.asset_provenance || { schema: "nichefoundry.asset_provenance.v1.0", episode_id: episodeId, records: [] };
      packet.asset_provenance.records = packet.asset_provenance.records.filter((item) => item.asset_id !== assetRecord.asset_id);
      packet.asset_provenance.records.push({ ...assetRecord, file_sha256: assetRecord.sha256 });
      packet.visual_asset_hashes = packet.visual_asset_hashes || { schema: "nichefoundry.visual_asset_hashes.v1.0", episode_id: episodeId, assets: [] };
      packet.visual_asset_hashes.assets = packet.visual_asset_hashes.assets.filter((item) => item.asset_id !== assetRecord.asset_id);
      packet.visual_asset_hashes.assets.push({ asset_id: assetRecord.asset_id, relative_path: relativePath, exists: true, size_bytes: assetRecord.size_bytes, sha256: assetRecord.sha256 });
      packet.visual_asset_hashes.complete = packet.visual_asset_hashes.assets.every((item) => item.exists && item.sha256);
      const unresolved = packet.asset_manifest.assets.filter((item) => item.rights_status !== "cleared");
      packet.visual_report.asset_count = packet.asset_manifest.assets.length;
      packet.visual_report.cleared_rights_count = packet.asset_manifest.assets.length - unresolved.length;
      packet.visual_report.unresolved_rights_count = unresolved.length;
      packet.visual_report.gates.rights_and_provenance = unresolved.length === 0;
      packet.visual_report.issues = (packet.visual_report.issues || []).filter((item) => !item.includes("unresolved rights"));
      if (unresolved.length) packet.visual_report.issues.push(`${unresolved.length} asset(s) have unresolved rights.`);
      packet.visual_report.passed = Object.values(packet.visual_report.gates || {}).every(Boolean) && packet.visual_report.issues.length === 0;
      packet.visual_package = packet.visual_package || database.getVisualPackageForEpisode(episodeId) || {};
      Object.assign(packet.visual_package, { passed: packet.visual_report.passed, asset_manifest: packet.asset_manifest, asset_provenance: packet.asset_provenance, asset_hashes: packet.visual_asset_hashes, visual_report: packet.visual_report });
      packet.verification.visual_system = { ...(packet.verification.visual_system || {}), passed: packet.visual_report.passed && packet.visual_asset_hashes.complete, asset_count: packet.visual_report.asset_count, issues: packet.visual_report.issues, checked_at: new Date().toISOString() };
      writeJson(path.join(episodeDir, "asset_manifest.json"), packet.asset_manifest);
      writeJson(path.join(episodeDir, "asset_provenance.json"), packet.asset_provenance);
      writeJson(path.join(episodeDir, "visual_asset_hashes.json"), packet.visual_asset_hashes);
      writeJson(path.join(episodeDir, "visual_report.json"), packet.visual_report);
      packet.approval_bundle = updateApprovalBundle(episodeDir);
      database.saveVisualPackage(`episode:${episodeId}`, episodeId, packet.brief.studio_id, packet.visual_package);
      database.upsertEpisode(packet);
      database.audit({ episodeId, eventType: "visual_asset_registered", actor: body.actor || "local-editor", details: { asset_id: assetRecord.asset_id, relative_path: relativePath, rights_status: assetRecord.rights_status, replaces_asset_id: assetRecord.replaces_asset_id } });
      state = refreshPacketEvidence(packet, { save: true });
      sendJson(response, 200, { asset: assetRecord, visual_report: state.visual_report, state });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/audio-system") {
      const episodeId = url.searchParams.get("episode_id") || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "No episode selected." }); return; }
      const packet = database.getEpisode(episodeId);
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      const refreshed = refreshPacketEvidence(packet, { save: true });
      sendJson(response, 200, {
        episode_id: episodeId,
        host_profile: refreshed.host_profile || null,
        pronunciation_lexicon: refreshed.pronunciation_lexicon || null,
        audio_performance_plan: refreshed.audio_performance_plan || null,
        sound_design_plan: refreshed.sound_design_plan || null,
        audio_preflight_report: refreshed.audio_preflight_report || null,
        production: refreshed.audio_production || null,
        audio_approval: refreshed.audio_approval || null,
        audio_assets: database.listAudioAssets(episodeId)
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/music-discovery") {
      const studioId = url.searchParams.get("studio_id") || state?.brief?.studio_id || state?.episode?.studio?.id || "puzzle_planet";
      const pack = studioRegistry.get(studioId);
      if (!pack) { sendJson(response, 404, { error: `Unknown studio '${studioId}'.` }); return; }
      const topic = url.searchParams.get("topic") || state?.brief?.topic || state?.episode?.topic || "";
      const limit = Math.max(1, Math.min(10, Number(url.searchParams.get("limit") || 5) || 5));
      const discovery = await discoverThemeMusic({ pack, topic, limit });
      sendJson(response, 200, {
        studio_id: studioId,
        topic,
        episode_id: state?.episode?.episode_id || null,
        discovery
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/audio-packages") {
      sendJson(response, 200, { audio_packages: database.listAudioPackages({ studioId: url.searchParams.get("studio_id") || null, limit: Number(url.searchParams.get("limit") || 50) }) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/audio-assets/file") {
      const episodeId = url.searchParams.get("episode_id") || state?.episode?.episode_id;
      const relativePath = String(url.searchParams.get("path") || "").replaceAll("\\", "/");
      const packet = episodeId ? database.getEpisode(episodeId) : null;
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      if (!(relativePath.startsWith("audio/") || relativePath.startsWith("imports/audio/"))) { sendJson(response, 400, { error: "Audio paths must remain inside the episode audio directories." }); return; }
      const registered = database.listAudioAssets(episodeId).some((item) => item.relative_path === relativePath) || relativePath === "audio/episode_audio_preview.mp3";
      if (!registered) { sendJson(response, 404, { error: "Audio asset is not registered in the episode ledger." }); return; }
      let absolutePath;
      try { absolutePath = safeResolve(path.join(EPISODES_DIR, episodeId), relativePath); }
      catch (_error) { sendJson(response, 404, { error: "Audio asset not found." }); return; }
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) { sendJson(response, 404, { error: "Audio asset not found." }); return; }
      const extension = path.extname(absolutePath).toLowerCase();
      const contentTypes = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg" };
      if (!contentTypes[extension]) { sendJson(response, 415, { error: "Unsupported audio asset format." }); return; }
      setSecurityHeaders(response);
      response.setHeader("Cache-Control", "private, max-age=60");
      const stat = fs.statSync(absolutePath);
      const range = request.headers.range;
      if (extension === ".mp4" && range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(String(range));
        if (!match) { response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }); response.end(); return; }
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= stat.size) {
          response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }); response.end(); return;
        }
        response.writeHead(206, {
          "Content-Type": contentTypes[extension], "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1)
        });
        fs.createReadStream(absolutePath, { start, end }).pipe(response);
        return;
      }
      response.writeHead(200, { "Content-Type": contentTypes[extension], "Accept-Ranges": extension === ".mp4" ? "bytes" : "none", "Content-Length": String(stat.size) });
      fs.createReadStream(absolutePath).pipe(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/audio-system/build") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      let packet = episodeId ? database.getEpisode(episodeId) : null;
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      packet = refreshPacketEvidence(packet, { save: true });
      if (!packet.approved) { sendJson(response, 409, { error: "A valid editorial approval is required before audio synthesis." }); return; }
      const jobId = makeId("audio_production");
      database.createJob({ jobId, episodeId, jobType: "audio_production", status: "running", input: { provider: body.provider || "auto", force: Boolean(body.force) } });
      database.updateJob(jobId, { status: "running", attempts: 1, started_at: nowIso() });
      try {
        const production = await produceEpisodeAudio(packet, { provider: body.provider || "auto", force: Boolean(body.force), actor: body.actor || "local-editor" });
        packet = persistEpisode(packet);
        database.updateJob(jobId, { status: "completed", output: { provider: production.provider, scene_count: production.performance_report.scene_count, passed: production.performance_report.passed, evidence: "audio_performance_report.json" }, attempts: 1, finished_at: nowIso() });
        state = refreshPacketEvidence(packet, { save: true });
        sendJson(response, 200, { state, production: state.audio_production, job_id: jobId });
      } catch (error) {
        database.updateJob(jobId, { status: "failed", error: error.message, attempts: 1, finished_at: nowIso() });
        throw error;
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/audio-system/import") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      const packet = episodeId ? database.getEpisode(episodeId) : null;
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      const record = {
        scene_id: body.scene_id,
        relative_path: String(body.relative_path || "").replaceAll("\\", "/"),
        creator: String(body.creator || "").slice(0, 200),
        licence: String(body.licence || "").slice(0, 200),
        rights_status: body.rights_status || "unknown",
        notes: String(body.notes || "").slice(0, 1000)
      };
      const validation = validateExternalAudioRecord(record);
      if (!validation.passed) { sendJson(response, 422, { error: "Imported audio record is invalid.", issues: validation.issues }); return; }
      if (!(packet.audio_performance_plan?.scenes || []).some((scene) => scene.scene_id === record.scene_id)) { sendJson(response, 422, { error: "Scene is not present in the audio performance plan." }); return; }
      let absolutePath;
      try { absolutePath = safeResolve(path.join(EPISODES_DIR, episodeId), record.relative_path); }
      catch (_error) { sendJson(response, 400, { error: "Unsafe imported audio path." }); return; }
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) { sendJson(response, 404, { error: "Imported audio file does not exist." }); return; }
      const registryPath = path.join(EPISODES_DIR, episodeId, "audio_imports.json");
      const registry = fs.existsSync(registryPath) ? JSON.parse(fs.readFileSync(registryPath, "utf8")) : { schema: "nichefoundry.audio_imports.v1", assets: [] };
      registry.assets = (registry.assets || []).filter((item) => item.scene_id !== record.scene_id);
      registry.assets.push({ ...record, registered_at: new Date().toISOString(), sha256: sha256File(absolutePath) });
      writeJson(registryPath, registry);
      database.audit({ episodeId, eventType: "audio_import_registered", actor: body.actor || "local-editor", details: { scene_id: record.scene_id, relative_path: record.relative_path, rights_status: record.rights_status } });
      sendJson(response, 200, { import: registry.assets.at(-1), note: "Rebuild audio to consume the imported scene performance." });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/audio-system/approve") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      let packet = episodeId ? database.getEpisode(episodeId) : null;
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      packet = refreshPacketEvidence(packet, { save: true });
      if (!packet.approved) { sendJson(response, 409, { error: "Editorial approval is not valid." }); return; }
      if (!packet.audio_production?.performance_report?.passed) { sendJson(response, 409, { error: "Audio production QA has not passed." }); return; }
      const episodeDir = path.join(EPISODES_DIR, episodeId);
      const bundle = updateAudioApprovalBundle(episodeDir);
      if (!bundle.complete) { sendJson(response, 409, { error: "Audio approval bundle is incomplete.", bundle }); return; }
      const bundlePath = path.join(episodeDir, "audio_approval_bundle.json");
      const approval = database.recordApproval({
        approvalId: makeId("audio_approval"), episodeId, approvalType: "audio_performance",
        artifactName: "audio_approval_bundle.json", artifactHash: sha256File(bundlePath),
        reviewer: String(body.reviewer || "local-editor").slice(0, 120), decision: "approved",
        notes: String(body.notes || "").slice(0, 2000)
      });
      database.audit({ episodeId, eventType: "audio_approval_recorded", actor: approval.reviewer, details: { approval_id: approval.approval_id, artifact_hash: approval.artifact_hash } });
      approveReviewStage(packet, "audio", approval.reviewer, approval.notes || "Audio performance approved.");
      state = refreshPacketEvidence(packet, { save: true });
      sendJson(response, 200, { state, approval: state.audio_approval });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/render-system") {
      const episodeId = url.searchParams.get("episode_id") || state?.episode?.episode_id;
      const packet = episodeId ? database.getEpisode(episodeId) : null;
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      const refreshed = refreshPacketEvidence(packet, { save: true });
      let previewPlan = null;
      try { previewPlan = buildEpisodeRenderPlan(refreshed, url.searchParams.get("profile") || "proxy"); }
      catch (_error) { /* Audio may not be built yet. */ }
      sendJson(response, 200, {
        episode_id: episodeId,
        render_plan: refreshed.render_plan || previewPlan,
        production: refreshed.render_production || null,
        render_approval: refreshed.render_approval || null,
        render_assets: database.listRenderAssets(episodeId),
        profiles: ["proxy", "final", "vertical_proxy", "vertical_final"]
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/render-packages") {
      sendJson(response, 200, { render_packages: database.listRenderPackages({ studioId: url.searchParams.get("studio_id") || null, limit: Number(url.searchParams.get("limit") || 50) }) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/render-system/plan") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      const packet = episodeId ? database.getEpisode(episodeId) : null;
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      const refreshed = refreshPacketEvidence(packet, { save: true });
      const plan = buildEpisodeRenderPlan(refreshed, body.profile || "proxy");
      sendJson(response, 200, { render_plan: plan });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/render-assets/file") {
      const episodeId = url.searchParams.get("episode_id") || state?.episode?.episode_id;
      const relativePath = String(url.searchParams.get("path") || "").replaceAll("\\", "/");
      const packet = episodeId ? database.getEpisode(episodeId) : null;
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      const registered = database.listRenderAssets(episodeId).some((item) => item.relative_path === relativePath);
      if (!registered) { sendJson(response, 404, { error: "Render asset is not registered in the episode ledger." }); return; }
      let absolutePath;
      try { absolutePath = safeResolve(path.join(EPISODES_DIR, episodeId), relativePath); }
      catch (_error) { sendJson(response, 400, { error: "Unsafe render asset path." }); return; }
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) { sendJson(response, 404, { error: "Render asset not found." }); return; }
      const extension = path.extname(absolutePath).toLowerCase();
      const contentTypes = { ".mp4": "video/mp4", ".srt": "text/plain; charset=utf-8", ".png": "image/png" };
      if (!contentTypes[extension]) { sendJson(response, 415, { error: "Unsupported render asset format." }); return; }
      setSecurityHeaders(response);
      response.setHeader("Cache-Control", "private, max-age=60");
      const stat = fs.statSync(absolutePath);
      const range = request.headers.range;
      if (extension === ".mp4" && range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(String(range));
        if (!match) { response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }); response.end(); return; }
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= stat.size) {
          response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }); response.end(); return;
        }
        response.writeHead(206, {
          "Content-Type": contentTypes[extension], "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1)
        });
        fs.createReadStream(absolutePath, { start, end }).pipe(response);
        return;
      }
      response.writeHead(200, { "Content-Type": contentTypes[extension], "Accept-Ranges": extension === ".mp4" ? "bytes" : "none", "Content-Length": String(stat.size) });
      fs.createReadStream(absolutePath).pipe(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/render-system/build") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      let packet = episodeId ? database.getEpisode(episodeId) : null;
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      packet = refreshPacketEvidence(packet, { save: true });
      if (!packet.approved) { sendJson(response, 409, { error: "A valid editorial approval is required before rendering." }); return; }
      if (!packet.audio_approved) { sendJson(response, 409, { error: "A valid audio-performance approval is required before rendering." }); return; }
      const profileId = body.profile || "final";
      if (!["proxy", "final", "vertical_proxy", "vertical_final"].includes(profileId)) { sendJson(response, 422, { error: "Unsupported render profile." }); return; }
      const sceneIds = Array.isArray(body.scene_ids) ? body.scene_ids.map(String).slice(0, 100) : null;
      const jobId = makeId("render_production");
      database.createJob({ jobId, episodeId, jobType: "render_production", status: "running", input: { profile: profileId, force: Boolean(body.force), scene_ids: sceneIds || [] } });
      database.updateJob(jobId, { status: "running", attempts: 1, started_at: nowIso() });
      try {
        const production = await produceEpisodeRender(packet, { profileId, force: Boolean(body.force), sceneIds, actor: body.actor || "local-editor" });
        packet = persistEpisode(packet);
        database.updateJob(jobId, { status: "completed", output: { profile_id: profileId, output: production.render_manifest.output, scene_count: production.render_qa_report.scene_count, passed: production.passed, evidence: "render_qa_report.json" }, attempts: 1, finished_at: nowIso() });
        state = refreshPacketEvidence(packet, { save: true });
        sendJson(response, 200, { state, production: state.render_production, job_id: jobId });
      } catch (error) {
        database.updateJob(jobId, { status: "failed", error: error.message, attempts: 1, finished_at: nowIso() });
        throw error;
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/render-system/approve") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      let packet = episodeId ? database.getEpisode(episodeId) : null;
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      packet = refreshPacketEvidence(packet, { save: true });
      if (!packet.audio_approved) { sendJson(response, 409, { error: "Audio approval is not valid." }); return; }
      if (!packet.render_production?.render_qa_report?.passed || packet.render_production?.render_qa_report?.output !== "final.mp4") { sendJson(response, 409, { error: "A passing final render is required before render approval." }); return; }
      const episodeDir = path.join(EPISODES_DIR, episodeId);
      const bundle = updateRenderApprovalBundle(episodeDir);
      if (!bundle.complete) { sendJson(response, 409, { error: "Render approval bundle is incomplete.", bundle }); return; }
      const bundlePath = path.join(episodeDir, "render_approval_bundle.json");
      const approval = database.recordApproval({
        approvalId: makeId("render_approval"), episodeId, approvalType: "render_programme",
        artifactName: "render_approval_bundle.json", artifactHash: sha256File(bundlePath),
        reviewer: String(body.reviewer || "local-editor").slice(0, 120), decision: "approved",
        notes: String(body.notes || "").slice(0, 2000)
      });
      database.audit({ episodeId, eventType: "render_approval_recorded", actor: approval.reviewer, details: { approval_id: approval.approval_id, artifact_hash: approval.artifact_hash } });
      approveReviewStage(packet, "render", approval.reviewer, approval.notes || "Finished programme approved.");
      state = refreshPacketEvidence(packet, { save: true });
      sendJson(response, 200, { state, approval: state.render_approval });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/editorial-cockpit") {
      const episodeId = url.searchParams.get("episode_id") || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "Select an episode first." }); return; }
      let packet = database.getEpisode(episodeId);
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      packet = refreshPacketEvidence(packet, { save: true });
      const cockpit = syncEditorialCockpit(packet);
      database.upsertEpisode(packet);
      if (state?.episode?.episode_id === episodeId) state = packet;
      sendJson(response, 200, { cockpit, state: packet });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/editorial-cockpit/bootstrap") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "Select an episode first." }); return; }
      let packet = database.getEpisode(episodeId);
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      packet = refreshPacketEvidence(packet, { save: true });
      const cockpit = syncEditorialCockpit(packet);
      database.audit({ episodeId, eventType: "editorial_cockpit_bootstrapped", actor: String(body.actor || "local-editor").slice(0, 120), details: { task_count: cockpit.tasks.length } });
      database.upsertEpisode(packet);
      if (state?.episode?.episode_id === episodeId) state = packet;
      sendJson(response, 200, { cockpit, state: packet });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/editorial-cockpit/assign") {
      const body = await parseBody(request);
      const task = database.getReviewTask(String(body.task_id || ""));
      if (!task) { sendJson(response, 404, { error: "Review task not found." }); return; }
      const updated = database.assignReviewTask(task.task_id, String(body.assignee || "").slice(0, 120), body.due_at || null);
      database.audit({ episodeId: task.episode_id, eventType: "review_task_assigned", actor: String(body.actor || "local-editor").slice(0, 120), details: { task_id: task.task_id, assignee: updated.assignee, due_at: updated.due_at } });
      let packet = refreshPacketEvidence(database.getEpisode(task.episode_id), { save: true });
      const cockpit = syncEditorialCockpit(packet);
      if (state?.episode?.episode_id === task.episode_id) state = packet;
      sendJson(response, 200, { task: updated, cockpit });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/editorial-cockpit/comment") {
      const body = await parseBody(request);
      const task = database.getReviewTask(String(body.task_id || ""));
      if (!task) { sendJson(response, 404, { error: "Review task not found." }); return; }
      const severity = String(body.severity || "note");
      if (!new Set(["note", "suggestion", "blocker"]).has(severity)) { sendJson(response, 422, { error: "Unsupported comment severity." }); return; }
      const text = String(body.body || "").trim();
      if (!text) { sendJson(response, 422, { error: "Comment text is required." }); return; }
      let timelineSeconds = body.timeline_seconds == null || body.timeline_seconds === "" ? null : Number(body.timeline_seconds);
      if (timelineSeconds != null && (!Number.isFinite(timelineSeconds) || timelineSeconds < 0)) { sendJson(response, 422, { error: "Timeline seconds must be a non-negative number." }); return; }
      const comment = database.addReviewComment({
        comment_id: makeId("review_comment"), task_id: task.task_id, episode_id: task.episode_id,
        scene_id: String(body.scene_id || "").trim().slice(0, 160) || null,
        timeline_seconds: timelineSeconds,
        artifact_name: String(body.artifact_name || "").trim().slice(0, 260) || null,
        artifact_hash: task.artifact_hash,
        author: String(body.author || "local-editor").slice(0, 120), body: text.slice(0, 5000), severity
      });
      if (severity === "blocker" && task.status === "approved") database.upsertReviewTask({ ...task, status: "changes_requested", completed_at: null });
      database.audit({ episodeId: task.episode_id, eventType: "review_comment_added", actor: comment.author, details: { comment_id: comment.comment_id, task_id: task.task_id, severity, scene_id: comment.scene_id, timeline_seconds: comment.timeline_seconds } });
      let packet = refreshPacketEvidence(database.getEpisode(task.episode_id), { save: true });
      const cockpit = syncEditorialCockpit(packet);
      if (state?.episode?.episode_id === task.episode_id) state = packet;
      sendJson(response, 200, { comment, cockpit });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/editorial-cockpit/comment/resolve") {
      const body = await parseBody(request);
      const comment = database.getReviewComment(String(body.comment_id || ""));
      if (!comment) { sendJson(response, 404, { error: "Review comment not found." }); return; }
      const resolved = database.resolveReviewComment(comment.comment_id, String(body.resolved_by || "local-editor").slice(0, 120));
      database.audit({ episodeId: comment.episode_id, eventType: "review_comment_resolved", actor: resolved.resolved_by, details: { comment_id: comment.comment_id, task_id: comment.task_id } });
      let packet = refreshPacketEvidence(database.getEpisode(comment.episode_id), { save: true });
      const cockpit = syncEditorialCockpit(packet);
      if (state?.episode?.episode_id === comment.episode_id) state = packet;
      sendJson(response, 200, { comment: resolved, cockpit });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/editorial-cockpit/decision") {
      const body = await parseBody(request);
      const task = database.getReviewTask(String(body.task_id || ""));
      if (!task) { sendJson(response, 404, { error: "Review task not found." }); return; }
      const decision = String(body.decision || "approved");
      if (!new Set(["approved", "changes_requested", "rejected"]).has(decision)) { sendJson(response, 422, { error: "Unsupported review decision." }); return; }
      const blockers = database.listReviewComments(task.episode_id, { status: "open", taskId: task.task_id }).filter((item) => item.severity === "blocker");
      if (decision === "approved" && blockers.length) { sendJson(response, 409, { error: "Resolve blocking comments before approval.", blockers }); return; }
      if (decision === "approved" && !task.ready) { sendJson(response, 409, { error: "The current artifact bundle is not ready for approval." }); return; }
      const recorded = database.recordReviewDecision({
        decisionId: makeId("review_decision"), taskId: task.task_id, episodeId: task.episode_id,
        artifactHash: task.artifact_hash, reviewer: String(body.reviewer || "local-editor").slice(0, 120), decision,
        notes: String(body.notes || "").slice(0, 3000)
      });
      database.audit({ episodeId: task.episode_id, eventType: "review_decision_recorded", actor: recorded.reviewer, details: { decision_id: recorded.decision_id, task_id: task.task_id, decision } });
      let packet = refreshPacketEvidence(database.getEpisode(task.episode_id), { save: true });
      const cockpit = syncEditorialCockpit(packet);
      if (state?.episode?.episode_id === task.episode_id) state = packet;
      sendJson(response, 200, { decision: recorded, cockpit });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/editorial-cockpit/snapshot") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "Select an episode first." }); return; }
      const packet = database.getEpisode(episodeId);
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      const episodeDir = path.join(EPISODES_DIR, episodeId);
      const actor = String(body.created_by || "local-editor").slice(0, 120);
      const snapshot = captureSnapshot({ episodeId, episodeDir, snapshotType: String(body.snapshot_type || "manual").slice(0, 80), createdBy: actor });
      const snapshotId = makeId("review_snapshot");
      const stored = database.saveReviewSnapshot(snapshotId, episodeId, snapshot.snapshot_type, snapshot, actor);
      writeJson(path.join(episodeDir, "review_snapshot.json"), stored);
      database.audit({ episodeId, eventType: "review_snapshot_captured", actor, details: { snapshot_id: snapshotId, bundle_hash: snapshot.bundle_hash } });
      const refreshed = refreshPacketEvidence(packet, { save: true });
      const cockpit = syncEditorialCockpit(refreshed);
      if (state?.episode?.episode_id === episodeId) state = refreshed;
      sendJson(response, 200, { snapshot: stored, cockpit });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/editorial-cockpit/compare") {
      const left = database.getReviewSnapshot(url.searchParams.get("left") || "");
      const right = database.getReviewSnapshot(url.searchParams.get("right") || "");
      if (!left || !right) { sendJson(response, 404, { error: "Both review snapshots are required." }); return; }
      sendJson(response, 200, { comparison: compareSnapshots(left, right) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/editorial-cockpit/final-signoff") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "Select an episode first." }); return; }
      let packet = database.getEpisode(episodeId);
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      packet = refreshPacketEvidence(packet, { save: true });
      let cockpit = syncEditorialCockpit(packet);
      const prereqTasks = cockpit.tasks.filter((task) => task.required && task.stage !== "release");
      const blockers = cockpit.comments.filter((comment) => comment.status === "open" && comment.severity === "blocker");
      const deliveryEvidence = Object.fromEntries((packet.artifact_evidence || []).map((item) => [item.name, item]));
      const deliveryVerified = Boolean(deliveryEvidence["final.mp4"]?.verified && deliveryEvidence["captions.srt"]?.verified && deliveryEvidence["thumbnail.png"]?.verified);
      if (!packet.approved || !packet.audio_approved || !packet.render_approved || !deliveryVerified) { sendJson(response, 409, { error: "Current editorial, audio, and render approvals plus verified delivery artifacts are required." }); return; }
      if (prereqTasks.some((task) => task.status !== "approved")) { sendJson(response, 409, { error: "All required editorial, audio, and render review tasks must be approved first.", tasks: prereqTasks }); return; }
      if (blockers.length) { sendJson(response, 409, { error: "Resolve blocking comments before final sign-off.", blockers }); return; }
      const reviewer = String(body.reviewer || "channel-owner").slice(0, 120);
      approveReviewStage(packet, "release", reviewer, String(body.notes || "Release compliance reviewed.").slice(0, 3000));
      cockpit = syncEditorialCockpit(packet);
      const bundle = buildFinalSignoffBundle({ episodeId, episodeDir: path.join(EPISODES_DIR, episodeId), reviewer, notes: String(body.notes || "").slice(0, 3000), tasks: cockpit.tasks, comments: cockpit.comments, approvals: database.listApprovals(episodeId) });
      if (!bundle.complete) { sendJson(response, 409, { error: "Final sign-off bundle is incomplete.", bundle }); return; }
      const artifactName = "final_signoff_bundle.json";
      const artifactPath = path.join(EPISODES_DIR, episodeId, artifactName);
      writeJson(artifactPath, bundle);
      const signoff = database.recordFinalSignoff({ signoffId: makeId("final_signoff"), episodeId, artifactName, artifactHash: sha256File(artifactPath), reviewer, decision: "approved", notes: String(body.notes || "").slice(0, 3000) });
      database.audit({ episodeId, eventType: "final_signoff_recorded", actor: reviewer, details: { signoff_id: signoff.signoff_id, artifact_hash: signoff.artifact_hash, bundle_hash: bundle.bundle_hash } });
      packet = refreshPacketEvidence(packet, { save: true });
      cockpit = syncEditorialCockpit(packet);
      database.upsertEpisode(packet);
      if (state?.episode?.episode_id === episodeId) state = packet;
      sendJson(response, 200, { signoff: cockpit.final_signoff, cockpit, state: packet });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/editorial-cockpit/export") {
      const episodeId = url.searchParams.get("episode_id") || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "Select an episode first." }); return; }
      const packet = refreshPacketEvidence(database.getEpisode(episodeId), { save: true });
      const cockpit = syncEditorialCockpit(packet);
      sendJson(response, 200, { markdown: reviewExportMarkdown({ packet, cockpit }), manifest: cockpit.manifest });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/publishing-system") {
      const episodeId = url.searchParams.get("episode_id") || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "No episode selected." }); return; }
      const packet = database.getEpisode(episodeId);
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      const refreshed = refreshPacketEvidence(packet, { save: true });
      if (state?.episode?.episode_id === episodeId) state = refreshed;
      sendJson(response, 200, {
        episode_id: episodeId,
        credentials: youtubeCredentialStatus(),
        publishing_package: redactPublishingPackage(refreshed.publishing_package),
        verification: refreshed.publishing_verification || null,
        events: database.listPublishingEvents(episodeId, 100),
        final_signoff: refreshed.editorial_cockpit?.final_signoff || null,
        qa: refreshed.qa
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/publishing-packages") {
      sendJson(response, 200, { packages: database.listPublishingPackages(Number(url.searchParams.get("limit") || 100)).map(redactPublishingPackage) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/publishing-system/preflight") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "No episode selected." }); return; }
      let packet = database.getEpisode(episodeId);
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      packet = refreshPacketEvidence(packet, { save: true });
      if (!packet.render_approved || !packet.render_production?.render_qa_report?.passed) {
        sendJson(response, 409, { error: "A current human render approval and passing render QA are required before publishing preflight." });
        return;
      }
      const allowed = ["title","description","tags","categoryId","defaultLanguage","selfDeclaredMadeForKids","containsSyntheticMedia","embeddable","publicStatsViewable","license","publishAt","hasPaidProductPlacement","captionLanguage","captionName","captionIsDraft","affiliateDisclosure","sponsorshipDisclosure","sensitiveTopicReviewed"];
      const overrides = Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(body, key)).map((key) => [key, body[key]]));
      const publishingPackage = createPublishingPreflight(packet, overrides, String(body.actor || "local-publisher").slice(0, 120));
      packet = refreshPacketEvidence(packet, { save: true });
      if (state?.episode?.episode_id === episodeId) state = packet;
      sendJson(response, publishingPackage.preflight_passed ? 200 : 422, {
        publishing_package: redactPublishingPackage(packet.publishing_package),
        cockpit: syncEditorialCockpit(packet, { writeFiles: true }),
        state: packet
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/publishing-system/upload") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "No episode selected." }); return; }
      let packet = database.getEpisode(episodeId);
      if (!packet) { sendJson(response, 404, { error: "Episode not found." }); return; }
      packet = refreshPacketEvidence(packet, { save: true });
      const publishingPackage = publishingPackageFor(packet);
      if (!publishingPackage?.preflight_passed) { sendJson(response, 409, { error: "Run a passing publishing preflight first." }); return; }
      if (!packet.final_signed_off || !packet.editorial_cockpit?.final_signoff?.valid) { sendJson(response, 409, { error: "A current accountable final sign-off is required before upload." }); return; }
      if (!youtubeCredentialStatus().configured) { sendJson(response, 409, { error: "YouTube OAuth credentials are not configured.", credentials: youtubeCredentialStatus() }); return; }
      const jobRun = await executeIntegrationJob(packet, "youtube_upload", async () => {
        const token = await acquireYouTubeAccessToken();
        const episodeDir = path.join(EPISODES_DIR, episodeId);
        const videoPath = safeResolve(episodeDir, "final.mp4");
        let session = database.getYouTubeUploadSession(episodeId);
        if (!session || session.status === "failed") {
          const initiated = await initiateResumableUpload({ accessToken: token.access_token, metadata: publishingPackage.metadata, videoPath });
          session = database.saveYouTubeUploadSession({ sessionId: makeId("youtube_session"), episodeId, sessionUrl: initiated.session_url, sessionUrlHash: initiated.session_url_hash, totalBytes: initiated.total_bytes, uploadedBytes: 0, status: "initiated" });
          database.recordPublishingEvent({ eventId: makeId("publish_event"), episodeId, action: "youtube_upload_initiated", status: "initiated", provider: "youtube", details: { session_url_hash: initiated.session_url_hash, total_bytes: initiated.total_bytes } });
        }
        if (session.status === "uploaded" && session.video_id) {
          return { verified: true, mode: "live", operation: "resumable_upload", video_id: session.video_id, uploaded_bytes: session.total_bytes, total_bytes: session.total_bytes, resumed: true, evidence: "youtube_upload_receipt.json" };
        }
        let offset = Number(session.uploaded_bytes || 0);
        if (offset > 0 || session.status === "uploading") {
          try { offset = await queryResumableOffset({ sessionUrl: session.session_url, totalBytes: session.total_bytes }); }
          catch (_error) { offset = Number(session.uploaded_bytes || 0); }
        }
        database.updateYouTubeUploadSession(episodeId, { uploaded_bytes: offset, status: "uploading" });
        const uploaded = await uploadVideoChunks({
          sessionUrl: session.session_url,
          videoPath,
          startOffset: offset,
          chunkSize: Math.max(256 * 1024, Math.min(Number(body.chunk_size || process.env.YOUTUBE_UPLOAD_CHUNK_SIZE || 8 * 1024 * 1024), 32 * 1024 * 1024)),
          onProgress: async (progress) => database.updateYouTubeUploadSession(episodeId, { uploaded_bytes: progress.uploaded_bytes, status: progress.status, video_id: progress.video_id || null })
        });
        database.updateYouTubeUploadSession(episodeId, { uploaded_bytes: uploaded.uploaded_bytes, status: "uploaded", video_id: uploaded.video_id });
        const receipt = { schema: "nichefoundry.youtube_upload_receipt.v1", episode_id: episodeId, video_id: uploaded.video_id, session_url_hash: session.session_url_hash, uploaded_bytes: uploaded.uploaded_bytes, total_bytes: uploaded.total_bytes, status: uploaded.status, completed_at: uploaded.completed_at };
        const updatedPackage = { ...publishingPackage, remote: { ...publishingPackage.remote, video_id: uploaded.video_id, upload: { status: "uploaded", bytes_uploaded: uploaded.uploaded_bytes, total_bytes: uploaded.total_bytes, completed_at: uploaded.completed_at }, processing: { status: "pending" } }, status: "uploaded", private_upload_ready: true };
        updatedPackage.remote_state_hash = sha256PublishingValue(updatedPackage.remote);
        savePublishingState(packet, updatedPackage, { uploadReceipt: receipt, actor: String(body.actor || "local-publisher").slice(0, 120), event: { action: "youtube_upload_completed", status: "uploaded", details: receipt } });
        return { verified: true, mode: "live", operation: "resumable_upload", video_id: uploaded.video_id, uploaded_bytes: uploaded.uploaded_bytes, total_bytes: uploaded.total_bytes, evidence: "youtube_upload_receipt.json" };
      });
      packet = refreshPacketEvidence(database.getEpisode(episodeId), { save: true });
      if (state?.episode?.episode_id === episodeId) state = packet;
      sendJson(response, jobRun.job.status === "completed" ? 200 : 502, { job: jobRun.job, result: redactPublishingPackage(jobRun.result), state: packet });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/publishing-system/poll") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "No episode selected." }); return; }
      let packet = refreshPacketEvidence(database.getEpisode(episodeId), { save: true });
      const publishingPackage = publishingPackageFor(packet);
      const videoId = publishingPackage?.remote?.video_id;
      if (!videoId) { sendJson(response, 409, { error: "Upload a video before polling processing status." }); return; }
      const jobRun = await executeIntegrationJob(packet, "youtube_processing", async () => {
        const token = await acquireYouTubeAccessToken();
        const report = await pollVideoProcessing({ accessToken: token.access_token, videoId, maxAttempts: Math.max(1, Math.min(Number(body.max_attempts || 10), 30)), intervalMs: Math.max(0, Math.min(Number(body.interval_ms ?? 3000), 30000)) });
        const updatedPackage = { ...publishingPackage, remote: { ...publishingPackage.remote, processing: report }, status: report.status === "processed" ? "processed" : "processing" };
        updatedPackage.remote_state_hash = sha256PublishingValue(updatedPackage.remote);
        savePublishingState(packet, updatedPackage, { processingReport: { schema: "nichefoundry.youtube_processing_report.v1", episode_id: episodeId, video_id: videoId, ...report }, actor: String(body.actor || "local-publisher").slice(0, 120), event: { action: "youtube_processing_polled", status: report.status, details: { video_id: videoId, attempts: report.attempts, history: report.history } } });
        return { verified: report.status === "processed", mode: "live", operation: "processing_poll", video_id: videoId, status: report.status, evidence: "youtube_processing_report.json" };
      });
      packet = refreshPacketEvidence(database.getEpisode(episodeId), { save: true });
      if (state?.episode?.episode_id === episodeId) state = packet;
      sendJson(response, 200, { job: jobRun.job, result: redactPublishingPackage(jobRun.result), state: packet });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/publishing-system/assets") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "No episode selected." }); return; }
      let packet = refreshPacketEvidence(database.getEpisode(episodeId), { save: true });
      const publishingPackage = publishingPackageFor(packet);
      const videoId = publishingPackage?.remote?.video_id;
      if (!videoId || publishingPackage.remote?.processing?.status !== "processed") { sendJson(response, 409, { error: "The uploaded video must finish processing before captions and thumbnail are attached." }); return; }
      const jobRun = await executeIntegrationJob(packet, "youtube_assets", async () => {
        const token = await acquireYouTubeAccessToken();
        const episodeDir = path.join(EPISODES_DIR, episodeId);
        const thumbnail = await uploadThumbnail({ accessToken: token.access_token, videoId, thumbnailPath: safeResolve(episodeDir, "thumbnail.png") });
        const captions = await uploadCaptions({ accessToken: token.access_token, videoId, captionsPath: safeResolve(episodeDir, "captions.srt"), language: publishingPackage.metadata.upload.captionLanguage, name: publishingPackage.metadata.upload.captionName, isDraft: publishingPackage.metadata.upload.captionIsDraft });
        const assetUploads = { schema: "nichefoundry.youtube_asset_uploads.v1", episode_id: episodeId, video_id: videoId, thumbnail: { status: thumbnail.status, sha256: thumbnail.sha256, attached_at: thumbnail.attached_at }, captions: { status: captions.status, caption_id: captions.caption_id, sha256: captions.sha256, attached_at: captions.attached_at } };
        const updatedPackage = { ...publishingPackage, remote: { ...publishingPackage.remote, assets: { thumbnail: "attached", captions: "attached", receipts: assetUploads } }, status: "assets_attached" };
        updatedPackage.remote_state_hash = sha256PublishingValue(updatedPackage.remote);
        savePublishingState(packet, updatedPackage, { assetUploads, actor: String(body.actor || "local-publisher").slice(0, 120), event: { action: "youtube_assets_attached", status: "attached", details: assetUploads } });
        return { verified: true, mode: "live", operation: "asset_uploads", video_id: videoId, evidence: "youtube_asset_uploads.json" };
      });
      packet = refreshPacketEvidence(database.getEpisode(episodeId), { save: true });
      if (state?.episode?.episode_id === episodeId) state = packet;
      sendJson(response, jobRun.job.status === "completed" ? 200 : 502, { job: jobRun.job, result: redactPublishingPackage(jobRun.result), state: packet });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/publishing-system/verify") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "No episode selected." }); return; }
      let packet = refreshPacketEvidence(database.getEpisode(episodeId), { save: true });
      const publishingPackage = publishingPackageFor(packet);
      const videoId = publishingPackage?.remote?.video_id;
      if (!videoId || publishingPackage.remote?.assets?.thumbnail !== "attached" || publishingPackage.remote?.assets?.captions !== "attached") { sendJson(response, 409, { error: "Upload and attach the delivery assets before remote verification." }); return; }
      const jobRun = await executeIntegrationJob(packet, "youtube_verify", async () => {
        const token = await acquireYouTubeAccessToken();
        const verification = await verifyRemotePublication({ accessToken: token.access_token, videoId, metadata: publishingPackage.metadata });
        const updatedPackage = { ...publishingPackage, remote: { ...publishingPackage.remote, verification }, release_ready: verification.passed, status: verification.passed ? "verified_private" : "verification_failed" };
        updatedPackage.remote_state_hash = sha256PublishingValue(updatedPackage.remote);
        savePublishingState(packet, updatedPackage, { actor: String(body.actor || "local-publisher").slice(0, 120), event: { action: "youtube_remote_verified", status: verification.passed ? "passed" : "failed", details: { video_id: videoId, verification } } });
        return { verified: verification.passed, mode: "live", operation: "remote_verification", video_id: videoId, evidence: "publishing_verification.json", issues: verification.issues };
      });
      packet = refreshPacketEvidence(database.getEpisode(episodeId), { save: true });
      if (state?.episode?.episode_id === episodeId) state = packet;
      sendJson(response, 200, { job: jobRun.job, result: redactPublishingPackage(jobRun.result), state: packet });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/publishing-system/schedule") {
      const body = await parseBody(request);
      const episodeId = body.episode_id || state?.episode?.episode_id;
      if (!episodeId) { sendJson(response, 400, { error: "No episode selected." }); return; }
      let packet = refreshPacketEvidence(database.getEpisode(episodeId), { save: true });
      const publishingPackage = publishingPackageFor(packet);
      if (!publishingPackage?.release_ready || !publishingPackage.remote?.verification?.passed) { sendJson(response, 409, { error: "The private YouTube resource must be fully verified before scheduling." }); return; }
      const publishAt = publishingPackage.metadata?.status?.publishAt;
      if (!publishAt) { sendJson(response, 409, { error: "No reviewed publishAt value exists in metadata_package.json. Rerun preflight with a future time, repeat publisher review, and renew final sign-off." }); return; }
      if (body.publish_at && String(body.publish_at) !== String(publishAt)) { sendJson(response, 409, { error: "The requested schedule differs from the reviewed metadata package." }); return; }
      if (body.confirmation !== "SCHEDULE VERIFIED VIDEO") { sendJson(response, 400, { error: "Type SCHEDULE VERIFIED VIDEO exactly to authorise the platform schedule." }); return; }
      const jobRun = await executeIntegrationJob(packet, "youtube_schedule", async () => {
        const token = await acquireYouTubeAccessToken();
        const scheduled = await updateVideoRelease({ accessToken: token.access_token, videoId: publishingPackage.remote.video_id, metadata: publishingPackage.metadata, publishAt, privacyStatus: "private" });
        const verification = await verifyRemotePublication({ accessToken: token.access_token, videoId: publishingPackage.remote.video_id, metadata: publishingPackage.metadata });
        const updatedPackage = { ...publishingPackage, remote: { ...publishingPackage.remote, schedule: scheduled, verification }, status: "scheduled", release_ready: verification.passed };
        updatedPackage.remote_state_hash = sha256PublishingValue(updatedPackage.remote);
        savePublishingState(packet, updatedPackage, { actor: String(body.actor || "local-publisher").slice(0, 120), event: { action: "youtube_release_scheduled", status: "scheduled", details: { video_id: publishingPackage.remote.video_id, publish_at: publishAt, reviewer: body.actor || "local-publisher" } } });
        return { verified: verification.passed, mode: "live", operation: "schedule", video_id: publishingPackage.remote.video_id, publish_at: publishAt, evidence: "release_approval_bundle.json" };
      });
      packet = refreshPacketEvidence(database.getEpisode(episodeId), { save: true });
      if (state?.episode?.episode_id === episodeId) state = packet;
      sendJson(response, jobRun.job.status === "completed" ? 200 : 502, { job: jobRun.job, result: redactPublishingPackage(jobRun.result), state: packet });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      state = state ? refreshPacketEvidence(state, { save: true }) : null;
      sendJson(response, 200, { state });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/integrations") {
      sendJson(response, 200, { integrations: getIntegrations() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/episodes") {
      sendJson(response, 200, { episodes: database.listEpisodes(Number(url.searchParams.get("limit") || 50)) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/jobs") {
      sendJson(response, 200, {
        jobs: database.listJobs(url.searchParams.get("episode_id") || state?.episode?.episode_id || null)
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/audit") {
      sendJson(response, 200, {
        events: database.listAuditEvents(url.searchParams.get("episode_id") || state?.episode?.episode_id || null)
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/research") {
      const episodeId = url.searchParams.get("episode_id") || state?.episode?.episode_id;
      if (!episodeId) {
        sendJson(response, 400, { error: "No episode selected." });
        return;
      }
      const packet = database.getEpisode(episodeId);
      if (!packet) {
        sendJson(response, 404, { error: "Episode not found." });
        return;
      }
      sendJson(response, 200, {
        episode_id: episodeId,
        research_report: packet.research_report || null,
        sources: database.listSources(episodeId),
        claims: database.listClaims(episodeId),
        verification: packet.verification || null
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/select") {
      const body = await parseBody(request);
      const selected = database.getEpisode(body.episode_id);
      if (!selected) {
        sendJson(response, 404, { error: "Episode not found." });
        return;
      }
      database.setSetting("current_episode_id", body.episode_id);
      state = refreshPacketEvidence(selected, { save: true });
      sendJson(response, 200, { state });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/generate") {
      const body = await parseBody(request);
      if (!body.brief || !body.brief.working_title || !body.brief.topic) {
        sendJson(response, 400, { error: "Working title and topic are required." });
        return;
      }
      if (!Array.isArray(body.brief.source_queries) || body.brief.source_queries.length === 0) {
        body.brief.source_queries = [body.brief.topic];
      }
      const jobId = makeId("episode_build");
      database.createJob({ jobId, episodeId: null, jobType: "episode_build", status: "running", input: body.brief });
      database.updateJob(jobId, { status: "running", attempts: 1, started_at: nowIso() });
      try {
        const packet = await buildPacket(body.brief);
        state = persistEpisode(packet);
        if (body.brief.opportunity_id) {
          const opportunity = database.getOpportunity(body.brief.opportunity_id);
          if (opportunity && opportunity.lifecycle === "screened") {
            const updatedOpportunity = { ...opportunity, lifecycle: "researched", updated_at: new Date().toISOString() };
            database.updateOpportunityLifecycle(opportunity.opportunity_id, "researched", updatedOpportunity);
            database.audit({
              eventType: "opportunity_researched",
              actor: body.actor || "local-editor",
              details: { opportunity_id: opportunity.opportunity_id, episode_id: state.episode.episode_id }
            });
          }
        }
        database.updateJob(jobId, {
          episode_id: state.episode.episode_id,
          status: "completed",
          output: {
            episode_id: state.episode.episode_id,
            evidence: "approval_bundle.json",
            source_count: state.sourcePacket?.length || 0,
            claim_count: state.claims?.length || 0,
            verification_passed: state.qa?.verification_passed || false
          },
          attempts: 1,
          finished_at: nowIso()
        });
        database.audit({
          episodeId: state.episode.episode_id,
          eventType: "episode_generated",
          actor: body.actor || "local-editor",
          details: { job_id: jobId, title: state.episode.title }
        });
        sendJson(response, 200, { state });
      } catch (error) {
        database.updateJob(jobId, { status: "failed", error: error.message, attempts: 1, finished_at: nowIso() });
        throw error;
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reset") {
      database.clearCurrentEpisode();
      database.audit({
        episodeId: state?.episode?.episode_id || null,
        eventType: "workspace_reset",
        actor: "local-editor",
        details: { files_deleted: false }
      });
      state = null;
      sendJson(response, 200, { ok: true, note: "The current selection was cleared; episode evidence remains on disk and in SQLite." });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/approve") {
      const body = await parseBody(request);
      if (!state) {
        sendJson(response, 400, { error: "Generate or select an episode packet first." });
        return;
      }
      state = refreshPacketEvidence(state, { save: true });
      const approvalReady = Boolean(
        state.verification?.opportunity_intelligence?.passed !== false &&
        state.verification?.audience_strategy?.passed &&
        state.audience_fit_report?.passed &&
        state.verification?.studio_policy?.passed &&
        state.studio_fit_report?.passed &&
        state.verification?.deterministic_validation?.passed &&
        state.verification?.editorial_audit?.passed &&
        state.verification?.duplicate_and_safety?.passed &&
        state.editorial_evidence_current
      );
      if (!approvalReady) {
        sendJson(response, 400, { error: "Fix audience strategy, research, editorial, duplicate, safety, or evidence-drift issues before approval. Regenerate after external file edits." });
        return;
      }
      const artifactName = "approval_bundle.json";
      const artifactPath = path.join(EPISODES_DIR, state.episode.episode_id, artifactName);
      if (!fs.existsSync(artifactPath)) {
        sendJson(response, 409, { error: "approval_bundle.json is missing and cannot be approved." });
        return;
      }
      const approval = database.recordApproval({
        approvalId: makeId("approval"),
        episodeId: state.episode.episode_id,
        approvalType: "editorial_packet",
        artifactName,
        artifactHash: sha256File(artifactPath),
        reviewer: String(body.reviewer || "local-editor").slice(0, 120),
        decision: "approved",
        notes: String(body.notes || "").slice(0, 2000)
      });
      database.audit({
        episodeId: state.episode.episode_id,
        eventType: "approval_recorded",
        actor: approval.reviewer,
        details: { approval_id: approval.approval_id, artifact_name: artifactName, artifact_hash: approval.artifact_hash }
      });
      approveReviewStage(state, "editorial", approval.reviewer, approval.notes || "Editorial packet approved.");
      state = refreshPacketEvidence(state, { save: true });
      sendJson(response, 200, { state, approval: state.approval });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/run-integrations") {
      if (!state) {
        sendJson(response, 400, { error: "Generate or select an episode packet first." });
        return;
      }
      state = refreshPacketEvidence(state, { save: true });
      if (!state.approved) {
        sendJson(response, 400, { error: "Complete a valid hash-bound human approval first." });
        return;
      }

      const rulesRun = await executeIntegrationJob(state, "rules", async () => ({
        ...(await runRulesEngine(state)),
        verified: Boolean(state.artifact_evidence?.find((item) => item.name === "episode.json")?.verified),
        evidence: "episode.json"
      }));
      const gammaRun = await executeIntegrationJob(state, "gamma", runGamma);
      const elevenRun = await executeIntegrationJob(state, "elevenlabs", runElevenLabs);
      state = refreshPacketEvidence(state, { save: true });
      const youtubeRun = await executeIntegrationJob(state, "youtube_preflight", runYouTube, {
        enabled: Boolean(state.render_approved && state.render_production?.render_qa_report?.passed),
        blockedReason: "Publishing preflight is blocked until the finished programme has current render approval and verified final.mp4, captions.srt, and thumbnail.png artifacts."
      });
      // Preserve the Phase 0-10 public job contract while the new Phase 11
      // workflow records its more precise youtube_preflight/upload/process jobs.
      // This alias carries no secrets and never performs a second provider call.
      const legacyYoutubeJobId = makeId("youtube");
      database.createJob({
        jobId: legacyYoutubeJobId,
        episodeId: state.episode.episode_id,
        jobType: "youtube",
        status: youtubeRun.job.status,
        input: { episode_id: state.episode.episode_id, compatibility_alias_for: youtubeRun.job.job_id }
      });
      database.updateJob(legacyYoutubeJobId, {
        status: youtubeRun.job.status,
        output: { ...youtubeRun.result, compatibility_alias_for: "youtube_preflight" },
        error: youtubeRun.job.error || null,
        attempts: youtubeRun.job.attempts || 0,
        started_at: youtubeRun.job.started_at || null,
        finished_at: youtubeRun.job.finished_at || nowIso()
      });

      state.integrationRuns = {
        rules: rulesRun.result,
        gamma: gammaRun.result,
        elevenlabs: elevenRun.result,
        youtube: youtubeRun.result
      };
      state = persistEpisode(state);
      sendJson(response, 200, {
        state,
        truth_notice: "Integration jobs were recorded, but YouTube media transfer requires an explicit action in the Publishing Console after release metadata review and final sign-off."
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/gamma-storyboard") {
      if (!state) {
        sendJson(response, 400, { error: "Generate or select an episode packet first." });
        return;
      }
      state = refreshPacketEvidence(state, { save: true });
      const gammaRun = await executeIntegrationJob(state, "gamma", runGamma);
      state.integrationRuns = {
        ...(state.integrationRuns || {}),
        gamma: gammaRun.result
      };
      state = persistEpisode(state);
      sendJson(response, 200, { state, gamma: gammaRun.result, job: gammaRun.job });
      return;
    }

    if (request.method === "GET") {
      serveFile(request, response, url.pathname);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    if (process.env.FOUNDRY_DEBUG_ERRORS === "1") console.error(error.stack || error.message || error);
    if (!response.headersSent) {
      sendJson(response, error.statusCode || 500, {
        error: error.message || "Internal server error",
        ...(error.validation ? { validation: error.validation } : {}),
        ...(error.fit ? { fit: error.fit } : {}),
        ...(error.opportunity ? { opportunity: error.opportunity } : {})
      });
    }
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const address = server.address();
    const displayHost = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
    console.log(`NicheFoundry Phase 11 console running at http://${displayHost}:${address.port}`);
    console.log(`Persistence: ${DATABASE_PATH}`);
    console.log(`Static root: ${PUBLIC_DIR}`);
  });
}

module.exports = { server, database, studioRegistry, refreshPacketEvidence, buildPacket, persistEpisode, resolveStudioForBrief, runGamma };
