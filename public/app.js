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

const baseApprovalChecklist = [
  "The opportunity score, signal provenance, cluster, content role, and cannibalisation report were reviewed.",
  "The named persona, primary viewer job, desired reward, and likely next action were reviewed.",
  "The episode fits the channel promise and selected content pillar.",
  "The projected portfolio and fatigue reports do not indicate harmful repetition.",
  "The topic genuinely belongs to the selected studio.",
  "The chosen archetype and required story beats are appropriate.",
  "The selected hook opens a supported question rather than manufacturing drama.",
  "Every narrative scene has a clear objective, retention device, and evidence boundary.",
  "The spoken-language, timing, originality, and sensationalism passes were reviewed.",
  "The visual identity, storyboard grammar, thumbnail promise, safe areas, and motion rules were reviewed.",
  "Every visual asset has explicit provenance, rights status, file hash, and claim or source bindings where required.",
  "The anti-template similarity report and composition diversity gate were reviewed.",
  "The host identity, pacing, pronunciation lexicon, emotional ceiling, music, SFX, and mastering targets were reviewed.",
  "The scene order, camera grammar, transitions, captions, aspect ratio, proxy, and final render were reviewed.",
  "The final programme was watched end to end after measured render QA passed.",
  "Unresolved pronunciation entries and synthetic voice disclosures were reviewed.",
  "Every answer is bound to one atomic claim and supporting passage.",
  "Connector runs, source tiers, independence, freshness, conflicts, revisions, hashes, and claim bindings were reviewed.",
  "No workflow trivia, unsupported certainty, or library duplicate slipped through.",
  "Studio-specific compliance and visual prohibitions were reviewed.",
  "Audience classification and synthetic-media disclosure are correct.",
  "The approval bundle hash is current and unchanged."
];

let installedStudios = [];
let currentStudio = null;
let latestState = null;
let latestOpportunities = [];
let installedConnectors = [];
let latestConnectorRuns = [];
let latestChannelStrategy = null;
let latestAudienceAssessment = null;
let latestEditorialCockpit = null;
let latestPublishingPackage = null;
let simpleUiReady = false;
let simpleWorkspaceReady = false;

const viewerJobOptions = [
  ["learn", "Teach me"],
  ["decide", "Help me decide"],
  ["solve", "Help me solve something"],
  ["story", "Tell me a compelling story"],
  ["change", "Help me understand what changed"],
  ["challenge", "Let me test myself"],
  ["belong", "Help me belong to a specialist community"],
  ["relax", "Give me something restorative"]
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({ error: "Request failed" }));
  if (!response.ok) {
    const error = new Error(payload.error || "Request failed");
    error.payload = payload;
    throw error;
  }
  return payload;
}


function parseJsonValue(value, fallback = {}) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`Invalid JSON: ${error.message}`); }
}

function setFlash(message, isError = false) {
  const flash = document.getElementById("flash");
  flash.textContent = message;
  flash.dataset.error = isError ? "true" : "false";
}

function setupSimpleWorkspace() {
  if (simpleWorkspaceReady) return;
  const main = document.querySelector(".layout");
  if (!main) return;
  const sections = [...main.querySelectorAll(":scope > section.card.span-full")];
  if (!sections.length) return;
  const drawer = document.createElement("details");
  drawer.className = "advanced-workspace";
  drawer.innerHTML = `
    <summary>Advanced Workspace</summary>
    <p class="advanced-workspace-note">Research controls, manual overrides, render internals, editorial audit, connector tools, and publishing operations live here when you need them.</p>
  `;
  const content = document.createElement("div");
  content.className = "advanced-workspace-content";
  sections.forEach((section) => content.appendChild(section));
  drawer.appendChild(content);
  main.appendChild(drawer);
  simpleWorkspaceReady = true;
}

function setupSimpleUi() {
  if (simpleUiReady) return;
  document.querySelectorAll(".output-panel pre").forEach((pre) => {
    const panel = pre.closest(".output-panel");
    if (!panel || panel.dataset.simpleUi === "true") return;
    const summary = document.createElement("div");
    summary.className = "plain-summary";
    summary.textContent = "No summary yet.";
    const details = document.createElement("details");
    details.className = "raw-data";
    const summaryLabel = document.createElement("summary");
    summaryLabel.textContent = "Raw data";
    pre.parentNode.insertBefore(summary, pre);
    pre.parentNode.insertBefore(details, pre);
    details.appendChild(summaryLabel);
    details.appendChild(pre);
    panel.dataset.simpleUi = "true";
  });
  simpleUiReady = true;
}

function setPanelSummary(id, html) {
  const pre = document.getElementById(id);
  const panel = pre?.closest(".output-panel");
  const target = panel?.querySelector(".plain-summary");
  if (target) target.innerHTML = html;
}

function normalizeStageStatus(status) {
  return String(status || "pending").replaceAll("_", " ");
}

function stageTone(stage) {
  if (!stage) return "pending";
  if (stage.status === "complete") return "complete";
  if (stage.status === "active") return "active";
  if (String(stage.status || "").startsWith("blocked") || stage.status === "failed") return "blocked";
  return "pending";
}

function summarizeStageFocus(stages = []) {
  const actionable = stages.filter((stage) => stage.status !== "complete");
  const current = actionable[0] || stages[stages.length - 1] || null;
  const blockers = stages.filter((stage) => String(stage.status || "").startsWith("blocked") || stage.status === "failed");
  const next = actionable.slice(0, 4);
  return { current, blockers, next, remainingCount: actionable.length };
}

function renderStageFocus(stages = []) {
  const target = document.getElementById("stageFocus");
  if (!target) return;
  if (!stages.length) {
    target.innerHTML = '<div class="artifact-item"><span>No workflow state loaded yet.</span></div>';
    return;
  }
  const { current, blockers, next, remainingCount } = summarizeStageFocus(stages);
  const blockerMarkup = blockers.length
    ? `<div class="stage-focus-blockers">
        <strong>${blockers.length === 1 ? "Current blocker" : "Current blockers"}</strong>
        ${blockers.slice(0, 2).map((stage) => `
          <div class="stage-focus-note state-${escapeHtml(stageTone(stage))}">
            <span>${escapeHtml(stage.name)}</span>
            <small>${escapeHtml(stage.detail || "Needs attention before the pipeline can move forward.")}</small>
          </div>
        `).join("")}
      </div>`
    : "";
  target.innerHTML = `
    <div class="stage-focus-hero">
      <div>
        <p class="eyebrow">Use This First</p>
        <h3>${escapeHtml(current?.name || "Workflow complete")}</h3>
        <p>${escapeHtml(current?.detail || "Everything currently loaded is complete.")}</p>
      </div>
      <span class="stage-state state-${escapeHtml(stageTone(current))}">${escapeHtml(normalizeStageStatus(current?.status || "complete"))}</span>
    </div>
    <div class="stage-focus-grid">
      <article class="stage-focus-card">
        <strong>Do Now</strong>
        <p>${escapeHtml(current?.name || "Nothing blocked.")}</p>
        <small>${escapeHtml(current?.detail || "Move on to publishing or start a new episode.")}</small>
      </article>
      <article class="stage-focus-card">
        <strong>After That</strong>
        <ol class="stage-focus-steps">
          ${next.slice(1).map((stage) => `<li>${escapeHtml(stage.name)}</li>`).join("") || "<li>No downstream steps are waiting.</li>"}
        </ol>
      </article>
      <article class="stage-focus-card">
        <strong>Remaining</strong>
        <p>${escapeHtml(String(remainingCount))} workflow stage${remainingCount === 1 ? "" : "s"} not yet complete.</p>
        <small>Open the full pipeline only if you need the long-form audit trail.</small>
      </article>
    </div>
    ${blockerMarkup}
  `;
}

function provenanceText(state) {
  const assets = state?.asset_manifest?.assets || [];
  if (!assets.length) return "No visual assets are registered yet.";
  const imported = assets.filter((asset) => asset.provenance?.source_type === "imported" || asset.rights?.source_type === "imported").length;
  const missingRights = assets.filter((asset) => !asset.rights?.licence && !asset.licence).length;
  if (missingRights) return `${missingRights} asset${missingRights === 1 ? "" : "s"} still need an explicit rights record.`;
  return imported ? `${imported} imported asset${imported === 1 ? "" : "s"} with rights data recorded.` : "Generated assets are tracked with provenance and hashes.";
}

function renderSimpleSummaries(state) {
  const audience = state?.audience_fit_report || {};
  const story = state?.story_report || {};
  const visual = state?.visual_report || {};
  const similarity = state?.visual_similarity_report || {};
  const audio = state?.audio_preflight_report || {};
  const loudness = state?.audio_production?.loudness_report || {};
  const renderQa = state?.render_production?.render_qa_report || {};
  const publishing = state?.publishing_package || {};
  const compliance = publishing?.compliance || {};
  const metadata = publishing?.metadata || {};
  const qa = state?.qa || {};
  const opportunity = state?.opportunity_report || {};

  setPanelSummary("opportunityJson", `
    <strong>Chosen opportunity</strong>
    <p>${escapeHtml(state?.opportunity_snapshot?.title || "No opportunity loaded yet.")}</p>
    <small>${escapeHtml(opportunity?.explanation || "Discover and score opportunities, then load one into the brief.")}</small>
  `);
  setPanelSummary("episodeAudienceFitJson", `
    <strong>Audience fit</strong>
    <p>${escapeHtml(audience?.passed ? "This brief fits the channel strategy." : "This brief still needs audience work.")}</p>
    <small>${escapeHtml((audience?.issues || []).join(" ") || audience?.audience_fit?.viewer_job?.label || "Assess the current brief to see the target persona and viewer job.")}</small>
  `);
  setPanelSummary("storyReportJson", `
    <strong>Story status</strong>
    <p>${escapeHtml(story?.passed ? "The script package is ready for the next stage." : "The story package still has blockers.")}</p>
    <small>${escapeHtml(story?.passed ? `${story?.grounded_claim_count || 0} grounded claims across ${state?.script_package?.scenes?.length || 0} scenes.` : (story?.issues || []).join(" ") || "Load or generate the current story package.")}</small>
  `);
  setPanelSummary("visualReportJson", `
    <strong>Visual status</strong>
    <p>${escapeHtml(visual?.passed ? "Visual package passed." : "Visual package needs changes.")}</p>
    <small>${escapeHtml(visual?.passed ? `${visual?.planned_scene_count || 0} scenes with ${visual?.unique_compositions || 0} composition patterns.` : (visual?.issues || []).join(" ") || "Regenerate the visuals or register a replacement asset.")}</small>
  `);
  setPanelSummary("visualSimilarityJson", `
    <strong>Anti-template audit</strong>
    <p>${escapeHtml(similarity?.similarity_percent != null ? `${similarity.similarity_percent}% similarity to the closest prior package.` : "Similarity audit pending.")}</p>
    <small>${escapeHtml((similarity?.issues || []).join(" ") || "This stage checks that the package is not too close to prior outputs.")}</small>
  `);
  setPanelSummary("assetProvenanceJson", `
    <strong>Asset rights</strong>
    <p>${escapeHtml(`${state?.asset_manifest?.assets?.length || 0} assets tracked.`)}</p>
    <small>${escapeHtml(provenanceText(state))}</small>
  `);
  setPanelSummary("audioPreflightJson", `
    <strong>Audio status</strong>
    <p>${escapeHtml(audio?.passed ? "Audio plan is ready for synthesis." : "Audio plan still has blockers.")}</p>
    <small>${escapeHtml(audio?.passed ? `${audio?.scene_count || 0} scene performances, ${audio?.unique_host_count || 0} hosts.` : (audio?.issues || []).join(" ") || "Load the current audio plan.")}</small>
  `);
  setPanelSummary("loudnessReportJson", `
    <strong>Mastering</strong>
    <p>${escapeHtml(loudness?.integrated_lufs ? `Integrated loudness: ${loudness.integrated_lufs} LUFS` : "No mastered episode audio yet.")}</p>
    <small>${escapeHtml(loudness?.passed ? "Measured loudness passed." : "Build and master audio to see measured loudness.")}</small>
  `);
  setPanelSummary("renderQaJson", `
    <strong>Render QA</strong>
    <p>${escapeHtml(renderQa?.passed ? "The finished programme passed render QA." : "Render QA is not green yet.")}</p>
    <small>${escapeHtml(renderQa?.probe?.duration_seconds ? `${Number(renderQa.probe.duration_seconds).toFixed(1)}s runtime${renderQa.embedded_subtitles ? ", embedded captions present." : ", captions still need attention."}` : "Compose a proxy or final programme to populate QA.")}</small>
  `);
  setPanelSummary("publishingComplianceJson", `
    <strong>Publishing preflight</strong>
    <p>${escapeHtml(compliance?.passed ? "Local compliance checks passed." : "Publishing preflight is not ready yet.")}</p>
    <small>${escapeHtml((compliance?.issues || []).join(" ") || "Build the publishing package after final render approval.")}</small>
  `);
  setPanelSummary("publishingMetadataJson", `
    <strong>Release metadata</strong>
    <p>${escapeHtml(metadata?.snippet?.title || "No reviewed metadata package yet.")}</p>
    <small>${escapeHtml(metadata?.status?.privacyStatus ? `Initial privacy: ${metadata.status.privacyStatus}.` : "The reviewed title, description, and declarations will appear here after preflight.")}</small>
  `);
  setPanelSummary("qaJson", `
    <strong>Overall readiness</strong>
    <p>${escapeHtml(qa?.delivery_ready ? "This episode is delivery-ready." : "This episode is still in progress.")}</p>
    <small>${escapeHtml(qa?.next_action || "Work from the pipeline summary above and handle only the current blocker.")}</small>
  `);
}

function selectedStudioSummary() {
  return installedStudios.find((studio) => studio.studio_id === document.getElementById("studioSelect").value) || installedStudios[0] || null;
}

function titleCase(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function studioTopicBlueprint(studio, brief = {}) {
  const topic = String(brief.topic || "").trim();
  const topicTitle = titleCase(topic);
  const archetypeLabel = document.getElementById("archetypeSelect").selectedOptions[0]?.textContent || "episode";
  const studioId = studio?.studio?.id || brief.studio_id;
  const defaults = {
    working_title: brief.working_title || topicTitle,
    story_premise: brief.story_premise || `Create a ${archetypeLabel} about ${topicTitle || topic}.`,
    source_queries: brief.source_queries?.length ? brief.source_queries : [topic],
    visual_direction: brief.visual_direction || "Apply the studio visual grammar.",
    research_connector_ids: brief.research_connector_ids || [],
    connector_inputs: brief.connector_inputs || {}
  };
  if (!topic) return defaults;

  if (studioId === "puzzle_planet") {
    const spaceQueries = /\bspace\b/i.test(topic)
      ? ["solar system", "planets", "moons", "space exploration"]
      : null;
    return {
      ...defaults,
      working_title: brief.working_title || `${topicTitle} Rescue Mission`,
      story_premise: brief.story_premise || `A family-safe adventure quiz where viewers complete a mission about ${topic} by answering clear, evidence-based questions with real explanations.`,
      source_queries: brief.source_queries?.length ? brief.source_queries : (spaceQueries || [
        topic,
        `${topic} science`,
        `${topic} nature`,
        `${topic} geography`
      ]),
      visual_direction: brief.visual_direction || `Use the Puzzle Planet mission style: bold progress, friendly diagrams, clear answer cards, and adventurous ${topic} environments.`
    };
  }

  if (studioId === "failure_atlas") {
    return {
      ...defaults,
      working_title: brief.working_title || `Why ${topicTitle} Failed`,
      story_premise: brief.story_premise || `Reconstruct how ${topic} failed, separate the trigger from the deeper conditions, and end with the design lesson supported by evidence.`,
      source_queries: brief.source_queries?.length ? brief.source_queries : [
        `${topic} investigation`,
        `${topic} accident report`,
        `${topic} failure analysis`,
        `${topic} design flaw`
      ],
      visual_direction: brief.visual_direction || `Use Failure Atlas grammar: calm diagrams, stepwise system reconstruction, visible force paths, and no sensational imagery.`
    };
  }

  if (studioId === "history_under_glass") {
    return {
      ...defaults,
      working_title: brief.working_title || `${topicTitle} Under Glass`,
      story_premise: brief.story_premise || `Use verified records and artifacts to explain what ${topic} reveals about everyday life, power, and change over time.`,
      source_queries: brief.source_queries?.length ? brief.source_queries : [
        `${topic} primary sources`,
        `${topic} museum collection`,
        `${topic} history`,
        `${topic} archive`
      ],
      visual_direction: brief.visual_direction || `Use History Under Glass grammar: archival textures, object close-ups, restrained motion, and careful contextual labels.`
    };
  }

  if (studioId === "practical_open_source") {
    return {
      ...defaults,
      working_title: brief.working_title || `${topicTitle} Explained`,
      story_premise: brief.story_premise || `Teach ${topic} through a practical open-source workflow, showing what it does, how it works, and where it breaks in real use.`,
      source_queries: brief.source_queries?.length ? brief.source_queries : [
        `${topic} documentation`,
        `${topic} github`,
        `${topic} tutorial`,
        `${topic} release notes`
      ],
      visual_direction: brief.visual_direction || `Use Practical Open Source grammar: clean terminals, product diagrams, highlighted diffs, and purposeful callouts instead of hype.`
    };
  }

  return defaults;
}

function autoExpandBriefForStudio(brief = {}, studio = currentStudio) {
  const expanded = studioTopicBlueprint(studio, brief);
  return {
    ...brief,
    working_title: expanded.working_title,
    story_premise: expanded.story_premise,
    source_queries: expanded.source_queries,
    visual_direction: expanded.visual_direction,
    research_connector_ids: expanded.research_connector_ids,
    connector_inputs: expanded.connector_inputs
  };
}

async function loadStudioDetail(studioId, { preserveArchetype = false } = {}) {
  if (!studioId) return;
  const { studio } = await request(`/api/studios/${encodeURIComponent(studioId)}`);
  currentStudio = studio;
  const archetypeSelect = document.getElementById("archetypeSelect");
  const previous = preserveArchetype ? archetypeSelect.value : null;
  archetypeSelect.innerHTML = studio.content.archetypes.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  archetypeSelect.value = previous && studio.content.archetypes.some((item) => item.id === previous)
    ? previous
    : studio.content.default_archetype;
  populateAudienceControls(studio, { preserve: preserveArchetype });
  renderStudioProfile(studio);
}

function renderStudioProfile(studio) {
  const target = document.getElementById("studioProfile");
  if (!studio) {
    target.innerHTML = "<p>No Studio Pack selected.</p>";
    return;
  }
  const archetype = studio.content.archetypes.find((item) => item.id === document.getElementById("archetypeSelect").value) || studio.content.archetypes[0];
  target.innerHTML = `
    <div class="profile-title">
      <strong>${escapeHtml(studio.studio.name)}</strong>
      <span>v${escapeHtml(studio.studio.version)}</span>
    </div>
    <p>${escapeHtml(studio.studio.tagline)}</p>
    <dl>
      <dt>Promise</dt><dd>${escapeHtml(studio.promise.statement)}</dd>
      <dt>Audience</dt><dd>${escapeHtml(studio.audience.primary_age)} • ${escapeHtml(studio.audience.knowledge_level)} • ${(studio.audience.personas || []).length} persona${(studio.audience.personas || []).length === 1 ? "" : "s"}</dd>
      <dt>Content pillars</dt><dd>${(studio.channel_strategy?.content_pillars || []).length} governed pillar${(studio.channel_strategy?.content_pillars || []).length === 1 ? "" : "s"}</dd>
      <dt>Archetype</dt><dd>${escapeHtml(archetype.name)}: ${escapeHtml(archetype.description)}</dd>
      <dt>Research</dt><dd>${studio.research.minimum_independent_sources} sources minimum • ${studio.research.primary_source_required ? "primary source required" : "primary source recommended"}</dd>
      <dt>Risk</dt><dd>${escapeHtml(studio.compliance.risk_level)} • ${escapeHtml(studio.compliance.upload_default)} upload default</dd>
    </dl>
    <div class="rule-chips">${studio.visuals.language.slice(0, 5).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
  `;
  document.getElementById("currentStudioBadge").innerHTML = `<strong>${escapeHtml(studio.studio.name)}</strong><span>${escapeHtml(archetype.name)}</span>`;
}

function renderStudioRegistry(studios) {
  const list = document.getElementById("studioList");
  list.innerHTML = studios.map((studio) => `
    <button class="episode-select studio-select ${document.getElementById("studioSelect").value === studio.studio_id ? "is-current" : ""}" data-studio-id="${escapeHtml(studio.studio_id)}">
      <strong>${escapeHtml(studio.name)}</strong>
      <span>${escapeHtml(studio.tagline)} • depth ${studio.depth_score}/100 • ${escapeHtml(studio.source)}</span>
    </button>
  `).join("");
  list.querySelectorAll("[data-studio-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      document.getElementById("studioSelect").value = button.dataset.studioId;
      await loadStudioDetail(button.dataset.studioId);
      renderStudioRegistry(installedStudios);
    });
  });
}

function populateStudioSelect(studios, preferredId = null) {
  const select = document.getElementById("studioSelect");
  const current = preferredId || select.value;
  select.innerHTML = studios.map((studio) => `<option value="${escapeHtml(studio.studio_id)}">${escapeHtml(studio.name)}</option>`).join("");
  const fallback = studios.find((studio) => studio.studio_id === "failure_atlas")?.studio_id || studios[0]?.studio_id || "";
  select.value = studios.some((studio) => studio.studio_id === current) ? current : fallback;
}

function populateAudienceControls(studio, { preserve = true } = {}) {
  if (!studio) return;
  const personaSelect = document.getElementById("targetPersonaSelect");
  const viewerJobSelect = document.getElementById("viewerJobSelect");
  const pillarSelect = document.getElementById("contentPillarSelect");
  const outputSelect = document.getElementById("outputFormatSelect");
  const previous = {
    persona: preserve ? personaSelect.value : "",
    viewerJob: preserve ? viewerJobSelect.value : "",
    pillar: preserve ? pillarSelect.value : "",
    output: preserve ? outputSelect.value : ""
  };
  const personas = studio.audience?.personas || [];
  const pillars = studio.channel_strategy?.content_pillars || [];
  const archetype = studio.content.archetypes.find((item) => item.id === document.getElementById("archetypeSelect").value) || studio.content.archetypes[0];
  const outputs = archetype?.allowed_outputs || ["long_form"];
  personaSelect.innerHTML = personas.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  viewerJobSelect.innerHTML = viewerJobOptions.map(([id, label]) => `<option value="${escapeHtml(label)}" data-job-id="${escapeHtml(id)}">${escapeHtml(label)}</option>`).join("");
  pillarSelect.innerHTML = pillars.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  outputSelect.innerHTML = outputs.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item.replaceAll("_", " "))}</option>`).join("");
  if (personas.some((item) => item.id === previous.persona)) personaSelect.value = previous.persona;
  if ([...viewerJobSelect.options].some((item) => item.value === previous.viewerJob)) viewerJobSelect.value = previous.viewerJob;
  if (pillars.some((item) => item.id === previous.pillar)) pillarSelect.value = previous.pillar;
  if (outputs.includes(previous.output)) outputSelect.value = previous.output;
}

function readBriefFromForm(form) {
  const formData = new FormData(form);
  return {
    opportunity_id: formData.get("opportunity_id") || null,
    studio_id: formData.get("studio_id"),
    archetype_id: formData.get("archetype_id"),
    working_title: formData.get("working_title").trim(),
    topic: formData.get("topic").trim(),
    story_premise: formData.get("story_premise").trim(),
    age_band: formData.get("age_band"),
    difficulty: formData.get("difficulty"),
    question_count: Number(formData.get("question_count")),
    countdown_seconds: Number(formData.get("countdown_seconds")),
    audience_mode: formData.get("audience_mode"),
    target_persona_id: formData.get("target_persona_id") || null,
    viewer_job: formData.get("viewer_job") || null,
    content_pillar_id: formData.get("content_pillar_id") || null,
    output_format: formData.get("output_format") || "long_form",
    target_duration_minutes: Number(formData.get("target_duration_minutes") || 8),
    contains_synthetic_media: formData.get("contains_synthetic_media") === "on",
    source_mode: formData.get("source_mode"),
    source_queries: String(formData.get("source_queries") || "").split("\n").map((query) => query.trim()).filter(Boolean),
    research_connector_ids: String(formData.get("research_connector_ids") || "").split(",").map((item) => item.trim()).filter(Boolean),
    connector_inputs: parseJsonValue(formData.get("connector_inputs"), {}),
    visual_direction: formData.get("visual_direction").trim()
  };
}

async function fillForm(brief) {
  const form = document.getElementById("briefForm");
  form.opportunity_id.value = brief.opportunity_id || "";
  if (brief.studio_id) {
    form.studio_id.value = brief.studio_id;
    await loadStudioDetail(brief.studio_id);
  }
  if (brief.archetype_id) form.archetype_id.value = brief.archetype_id;
  form.working_title.value = brief.working_title || "";
  form.topic.value = brief.topic || "";
  form.story_premise.value = brief.story_premise || "";
  form.age_band.value = brief.age_band || "13+";
  form.difficulty.value = brief.difficulty || "mixed";
  form.question_count.value = brief.question_count || 6;
  form.countdown_seconds.value = brief.countdown_seconds || 8;
  form.audience_mode.value = brief.audience_mode || "general_family";
  populateAudienceControls(currentStudio, { preserve: false });
  if (brief.target_persona_id && [...form.target_persona_id.options].some((item) => item.value === brief.target_persona_id)) form.target_persona_id.value = brief.target_persona_id;
  if (brief.viewer_job && [...form.viewer_job.options].some((item) => item.value === brief.viewer_job)) form.viewer_job.value = brief.viewer_job;
  if (brief.content_pillar_id && [...form.content_pillar_id.options].some((item) => item.value === brief.content_pillar_id)) form.content_pillar_id.value = brief.content_pillar_id;
  if (brief.output_format && [...form.output_format.options].some((item) => item.value === brief.output_format)) form.output_format.value = brief.output_format;
  form.target_duration_minutes.value = brief.target_duration_minutes || currentStudio?.story_engine?.default_target_minutes || 8;
  form.contains_synthetic_media.checked = Boolean(brief.contains_synthetic_media);
  form.source_mode.value = brief.source_mode || "wikipedia";
  form.source_queries.value = (brief.source_queries || []).join("\n");
  form.research_connector_ids.value = (brief.research_connector_ids || []).join(", ");
  form.connector_inputs.value = Object.keys(brief.connector_inputs || {}).length ? JSON.stringify(brief.connector_inputs, null, 2) : "";
  form.visual_direction.value = brief.visual_direction || "";
  renderStudioProfile(currentStudio);
}

function resetForm() {
  document.getElementById("briefForm").reset();
  populateStudioSelect(installedStudios, "failure_atlas");
  return loadStudioDetail(document.getElementById("studioSelect").value);
}

function renderIntegrations() {}

function reviewStatusLabel(status) {
  return String(status || "pending").replaceAll("_", " ");
}

function renderEditorialCockpit(cockpit) {
  latestEditorialCockpit = cockpit || null;
  const badge = document.getElementById("reviewCoverageBadge");
  const queueTarget = document.getElementById("reviewQueueList");
  const commentsTarget = document.getElementById("reviewCommentsList");
  const dependencyTarget = document.getElementById("reviewDependencyJson");
  const finalTarget = document.getElementById("finalSignoffJson");
  const taskSelect = document.getElementById("reviewCommentTask");
  const roleFilter = document.getElementById("reviewRoleFilter");
  const signoffButton = document.getElementById("finalSignoffButton");
  if (!cockpit) {
    badge.textContent = "No review queue";
    queueTarget.innerHTML = '<div class="artifact-item"><span>Generate or select an episode, then build the review queue.</span></div>';
    commentsTarget.innerHTML = '<div class="artifact-item"><span>No review comments.</span></div>';
    dependencyTarget.textContent = "";
    finalTarget.textContent = "";
    taskSelect.innerHTML = "";
    signoffButton.disabled = true;
    return;
  }
  badge.textContent = `${cockpit.coverage.approved_count}/${cockpit.coverage.required_count} reviews • ${cockpit.coverage.open_blocker_count} blockers`;
  const previousRole = roleFilter.value || "all";
  roleFilter.innerHTML = '<option value="all">All roles</option>' + (cockpit.roles || []).map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.label)}</option>`).join("");
  if ([...roleFilter.options].some((item) => item.value === previousRole)) roleFilter.value = previousRole;
  const selectedRole = roleFilter.value || "all";
  const queues = (cockpit.queues || []).filter((queue) => selectedRole === "all" || queue.id === selectedRole);
  queueTarget.innerHTML = queues.map((queue) => `
    <section class="review-queue">
      <header><strong>${escapeHtml(queue.label)}</strong><small>${queue.tasks.length} task(s)</small></header>
      ${queue.tasks.map((task) => `
        <article class="review-task" data-task-id="${escapeHtml(task.task_id)}">
          <header><strong>${escapeHtml(task.label)}</strong><span class="review-status-${escapeHtml(task.status)}">${escapeHtml(reviewStatusLabel(task.status))}</span></header>
          <small>${task.artifacts_complete ? "Artifact bundle complete" : "Artifacts missing"} • ${escapeHtml(task.artifact_hash.slice(0, 14))}…${task.assignee ? ` • assigned to ${escapeHtml(task.assignee)}` : ""}</small>
          <div class="review-actions">
            <button class="button button-secondary" data-review-action="assign" data-task-id="${escapeHtml(task.task_id)}" type="button">Assign</button>
            <button class="button button-primary" data-review-action="approved" data-task-id="${escapeHtml(task.task_id)}" type="button" ${!task.ready || task.status === "approved" ? "disabled" : ""}>Approve</button>
            <button class="button button-secondary" data-review-action="changes_requested" data-task-id="${escapeHtml(task.task_id)}" type="button">Request Changes</button>
          </div>
        </article>`).join("")}
    </section>`).join("") || '<div class="artifact-item"><span>No tasks match this role.</span></div>';
  const previousTask = taskSelect.value;
  taskSelect.innerHTML = (cockpit.tasks || []).map((task) => `<option value="${escapeHtml(task.task_id)}">${escapeHtml(task.label)} • ${escapeHtml(task.role)}</option>`).join("");
  if ((cockpit.tasks || []).some((task) => task.task_id === previousTask)) taskSelect.value = previousTask;
  commentsTarget.innerHTML = (cockpit.comments || []).map((comment) => `
    <article class="review-comment" data-status="${escapeHtml(comment.status)}">
      <header><strong class="review-severity-${escapeHtml(comment.severity)}">${escapeHtml(comment.severity.toUpperCase())}</strong><small>${escapeHtml(comment.status)}</small></header>
      <p>${escapeHtml(comment.body)}</p>
      <small>${escapeHtml(comment.scene_id || "episode-wide")}${comment.timeline_seconds != null ? ` • ${Number(comment.timeline_seconds).toFixed(1)}s` : ""} • ${escapeHtml(comment.author)}</small>
      ${comment.status === "open" ? `<div class="review-actions"><button class="button button-secondary" data-resolve-comment="${escapeHtml(comment.comment_id)}" type="button">Resolve</button></div>` : ""}
    </article>`).join("") || '<div class="artifact-item"><span>No review comments.</span></div>';
  dependencyTarget.textContent = JSON.stringify(cockpit.dependency_map || {}, null, 2);
  finalTarget.textContent = JSON.stringify(cockpit.final_signoff || { approved: false, note: "Final sign-off becomes available after all review stages pass." }, null, 2);
  const snapshots = cockpit.snapshots || [];
  for (const id of ["leftSnapshot", "rightSnapshot"]) {
    const select = document.getElementById(id);
    const previous = select.value;
    select.innerHTML = snapshots.map((snapshot) => `<option value="${escapeHtml(snapshot.snapshot_id)}">${escapeHtml(snapshot.snapshot_type)} • ${escapeHtml(snapshot.created_at || "")}</option>`).join("");
    if (snapshots.some((snapshot) => snapshot.snapshot_id === previous)) select.value = previous;
  }
  if (snapshots.length > 1) {
    const left = document.getElementById("leftSnapshot"); const right = document.getElementById("rightSnapshot");
    if (!left.value) left.value = snapshots[1].snapshot_id;
    if (!right.value) right.value = snapshots[0].snapshot_id;
  }
  const prereqs = (cockpit.dependency_map?.nodes || []).filter((node) => ["editorial", "audio", "render", "release"].includes(node.id));
  signoffButton.disabled = !prereqs.length || prereqs.some((node) => !node.passed) || !cockpit.coverage?.passed || cockpit.coverage.open_blocker_count > 0 || cockpit.final_signoff?.valid;
}

async function loadEditorialCockpit() {
  if (!latestState?.episode?.episode_id) { renderEditorialCockpit(null); return; }
  const result = await request(`/api/editorial-cockpit?episode_id=${encodeURIComponent(latestState.episode.episode_id)}`);
  latestState = result.state || latestState;
  renderEditorialCockpit(result.cockpit);
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function publishingPayload() {
  const rawPublishAt = document.getElementById("publishingPublishAt").value;
  return {
    episode_id: latestState?.episode?.episode_id,
    actor: document.getElementById("reviewerName").value.trim() || "local-publisher",
    title: document.getElementById("publishingTitle").value.trim(),
    description: document.getElementById("publishingDescription").value.trim(),
    tags: document.getElementById("publishingTags").value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
    categoryId: document.getElementById("publishingCategory").value.trim() || "27",
    selfDeclaredMadeForKids: document.getElementById("publishingMadeForKids").checked,
    containsSyntheticMedia: document.getElementById("publishingSyntheticMedia").checked,
    hasPaidProductPlacement: document.getElementById("publishingPaidPlacement").checked,
    publishAt: rawPublishAt ? new Date(rawPublishAt).toISOString() : null
  };
}

function renderPublishing(state) {
  const publishing = state?.publishing_package || null;
  const metadata = publishing?.metadata || null;
  const remote = publishing?.remote || {};
  const changedPackage = publishing?.package_hash !== latestPublishingPackage?.package_hash;
  latestPublishingPackage = publishing;
  const badge = document.getElementById("publishingStatusBadge");
  if (!badge) return;

  badge.textContent = publishing
    ? String(publishing.status || "preflight_passed").replaceAll("_", " ")
    : "Preflight not built";

  if (changedPackage || !document.activeElement?.closest?.(".publishing-cockpit")) {
    document.getElementById("publishingTitle").value = metadata?.snippet?.title || state?.episode?.title || "";
    document.getElementById("publishingDescription").value = metadata?.snippet?.description || state?.episode?.story_premise || "";
    document.getElementById("publishingTags").value = (metadata?.snippet?.tags || []).join(", ");
    document.getElementById("publishingCategory").value = metadata?.snippet?.categoryId || "27";
    document.getElementById("publishingMadeForKids").checked = Boolean(metadata?.status?.selfDeclaredMadeForKids);
    document.getElementById("publishingSyntheticMedia").checked = Boolean(metadata?.status?.containsSyntheticMedia ?? state?.brief?.contains_synthetic_media);
    document.getElementById("publishingPaidPlacement").checked = Boolean(metadata?.paidProductPlacementDetails?.hasPaidProductPlacement);
    document.getElementById("publishingPublishAt").value = toDateTimeLocal(metadata?.status?.publishAt);
  }

  document.getElementById("publishingMetadataJson").textContent = JSON.stringify(metadata || { note: "Build a publishing preflight after final render approval." }, null, 2);
  document.getElementById("publishingComplianceJson").textContent = JSON.stringify(publishing?.compliance || {}, null, 2);
  document.getElementById("publishingRemoteJson").textContent = JSON.stringify({
    credentials_configured: Boolean(state?.youtube_credentials?.configured),
    remote,
    verification: state?.publishing_verification || null,
    qa: state?.qa ? {
      publishing_preflight_passed: state.qa.publishing_preflight_passed,
      private_upload_verified: state.qa.private_upload_verified,
      publishing_release_ready: state.qa.publishing_release_ready
    } : null
  }, null, 2);
  document.getElementById("publishingEventsJson").textContent = JSON.stringify(state?.publishing_events || [], null, 2);

  const renderApproved = Boolean(state?.render_approved && state?.render_production?.render_qa_report?.passed);
  const preflightPassed = Boolean(publishing?.preflight_passed);
  const finalSignedOff = Boolean(state?.final_signed_off && state?.editorial_cockpit?.final_signoff?.valid);
  const uploaded = Boolean(remote?.video_id && ["uploaded", "processed"].includes(remote?.upload?.status));
  const processed = remote?.processing?.status === "processed";
  const assetsAttached = remote?.assets?.thumbnail === "attached" && remote?.assets?.captions === "attached";
  const verified = Boolean(publishing?.release_ready && remote?.verification?.passed);
  document.getElementById("publishingPreflightButton").disabled = !renderApproved;
  document.getElementById("publishingUploadButton").disabled = !preflightPassed || !finalSignedOff || uploaded;
  document.getElementById("publishingPollButton").disabled = !uploaded || processed;
  document.getElementById("publishingAssetsButton").disabled = !processed || assetsAttached;
  document.getElementById("publishingVerifyButton").disabled = !assetsAttached;
  document.getElementById("publishingScheduleButton").disabled = !verified || !metadata?.status?.publishAt || remote?.schedule?.status === "scheduled";
}

async function refreshPublishingSystem() {
  if (!latestState?.episode?.episode_id) return;
  const result = await request(`/api/publishing-system?episode_id=${encodeURIComponent(latestState.episode.episode_id)}`);
  latestState = {
    ...latestState,
    publishing_package: result.publishing_package,
    publishing_verification: result.verification,
    publishing_events: result.events,
    youtube_credentials: result.credentials,
    qa: result.qa || latestState.qa,
    editorial_cockpit: latestState.editorial_cockpit || { final_signoff: result.final_signoff }
  };
  renderPublishing(latestState);
}

function renderState(state) {
  setupSimpleWorkspace();
  setupSimpleUi();
  latestState = state;
  const heroStatus = document.getElementById("heroStatus");
  const heroSummary = document.getElementById("heroSummary");
  const stageList = document.getElementById("stageList");
  const artifactList = document.getElementById("artifactList");
  const approveButton = document.getElementById("approveButton");
  const runIntegrationsButton = document.getElementById("runIntegrationsButton");
  const buildAudioButton = document.getElementById("buildAudioButton");
  const approveAudioButton = document.getElementById("approveAudioButton");
  const buildRenderButton = document.getElementById("buildRenderButton");
  const approveRenderButton = document.getElementById("approveRenderButton");

  if (!state) {
    heroStatus.textContent = "Awaiting studio brief";
    heroSummary.textContent = "Enter a topic and let the system draft the episode for review.";
    stageList.innerHTML = "";
    artifactList.innerHTML = "";
    ["opportunityJson", "opportunityReportJson", "episodeAudienceFitJson", "episodeChannelStrategyJson", "studioBlueprintJson", "studioFitJson", "episodeJson", "verificationJson", "researchJson", "sourceHierarchyJson", "freshnessJson", "conflictGraphJson", "claimsJson", "qaJson", "narrativeBlueprintJson", "storyReportJson", "timingPlanJson", "scriptCriticJson", "visualIdentityJson", "visualReportJson", "thumbnailPlanJson", "visualSimilarityJson", "assetProvenanceJson", "visualAssetValidationJson", "hostProfileJson", "pronunciationLexiconJson", "audioPerformancePlanJson", "soundDesignJson", "audioPreflightJson", "loudnessReportJson", "audioApprovalJson", "renderPlanJson", "renderQaJson", "captionTrackJson", "renderApprovalJson", "publishingMetadataJson", "publishingComplianceJson", "publishingRemoteJson", "publishingEventsJson"].forEach((id) => { document.getElementById(id).textContent = ""; });
    document.getElementById("visualStoryboard").innerHTML = '<div class="artifact-item"><span>No visual package selected.</span></div>';
    document.getElementById("visualIdentityStrip").innerHTML = "";
    document.getElementById("hostIdentityStrip").innerHTML = "";
    document.getElementById("audioSceneList").innerHTML = '<div class="artifact-item"><span>No audio package selected.</span></div>';
    document.getElementById("audioPreviewPlayer").innerHTML = "";
    document.getElementById("renderSegmentList").innerHTML = '<div class="artifact-item"><span>No render package selected.</span></div>';
    document.getElementById("renderPreviewPlayer").innerHTML = "";
    document.getElementById("approvalChecklist").innerHTML = baseApprovalChecklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    approveButton.disabled = true;
    runIntegrationsButton.disabled = true;
    buildAudioButton.disabled = true;
    approveAudioButton.disabled = true;
    buildRenderButton.disabled = true;
    approveRenderButton.disabled = true;
    renderEditorialCockpit(null);
    renderPublishing(null);
    return;
  }

  const editorialReady = Boolean(
    state.verification?.opportunity_intelligence?.passed !== false &&
    state.verification?.audience_strategy?.passed &&
    state.audience_fit_report?.passed &&
    state.verification?.studio_policy?.passed &&
    state.verification?.research_governance?.passed &&
    state.studio_fit_report?.passed &&
    state.verification?.story_engine?.passed &&
    state.story_report?.passed &&
    state.verification?.visual_system?.passed &&
    state.visual_report?.passed &&
    state.verification?.audio_performance?.passed &&
    state.audio_preflight_report?.passed &&
    state.verification?.deterministic_validation?.passed &&
    state.verification?.editorial_audit?.passed &&
    state.verification?.duplicate_and_safety?.passed
  );
  heroStatus.textContent = state.qa?.delivery_ready
    ? "Verified and final-signed-off for private upload"
    : state.render_production?.render_qa_report?.passed
      ? "Finished programme awaiting human watch-through"
      : state.audio_approved
        ? "Audio approved, compositor unlocked"
        : state.approved
          ? (state.audio_production?.performance_report?.passed ? "Audio ready for human performance review" : "Editorially approved, ready for audio production")
        : editorialReady
          ? `${state.episode?.studio?.name || "Studio"} packet awaiting human approval`
          : "Studio, research, or editorial gate blocked";
  heroSummary.textContent = state.qa?.next_action || "Use the topic-first flow, then review what the system prepared.";
  if (state.episode?.studio) {
    document.getElementById("currentStudioBadge").innerHTML = `<strong>${escapeHtml(state.episode.studio.name)}</strong><span>${escapeHtml(state.episode.content_archetype?.name || "")}</span>`;
  }

  const stages = state.stage_statuses || stageDefinitions.map((name, index) => ({ index, name, status: index < state.currentStage ? "complete" : index === state.currentStage ? "active" : "pending" }));
  renderStageFocus(stages);
  stageList.innerHTML = stages.map((stage) => `
    <li class="stage-item" title="${escapeHtml(stage.detail || "")}">
      <span class="stage-index">${stage.index + 1}</span>
      <div><strong>${escapeHtml(stage.name)}</strong>${stage.detail ? `<small>${escapeHtml(stage.detail)}</small>` : ""}</div>
      <span class="stage-state state-${escapeHtml(stageTone(stage))}">${escapeHtml(normalizeStageStatus(stage.status))}</span>
    </li>
  `).join("");

  artifactList.innerHTML = (state.artifacts || []).map((artifact) => `
    <div class="artifact-item">
      <strong>${escapeHtml(artifact.name)}</strong>
      <span>${escapeHtml(artifact.description)}</span>
      <small>${artifact.exists ? `${artifact.verified ? "Verified" : "Present, unverified"} • ${artifact.size_bytes || 0} bytes` : "Missing"}</small>
    </div>
  `).join("");

  document.getElementById("opportunityJson").textContent = JSON.stringify(state.opportunity_snapshot || {}, null, 2);
  document.getElementById("opportunityReportJson").textContent = JSON.stringify(state.opportunity_report || {}, null, 2);
  document.getElementById("episodeAudienceFitJson").textContent = JSON.stringify(state.audience_fit_report || {}, null, 2);
  document.getElementById("episodeChannelStrategyJson").textContent = JSON.stringify(state.channel_strategy || {}, null, 2);
  document.getElementById("studioBlueprintJson").textContent = JSON.stringify(state.studio_blueprint || {}, null, 2);
  document.getElementById("studioFitJson").textContent = JSON.stringify(state.studio_fit_report || {}, null, 2);
  document.getElementById("episodeJson").textContent = JSON.stringify(state.episode || {}, null, 2);
  document.getElementById("verificationJson").textContent = JSON.stringify({ verification: state.verification || {}, integration_runs: state.integrationRuns || {} }, null, 2);
  document.getElementById("researchJson").textContent = JSON.stringify({
    research_report: state.research_report || {},
    sources: (state.sourcePacket || []).map((source) => ({
      source_id: source.source_id,
      title: source.title,
      source_url: source.source_url,
      provider: source.provider,
      revision_id: source.revision_id,
      content_hash: source.content_hash
    }))
  }, null, 2);
  document.getElementById("sourceHierarchyJson").textContent = JSON.stringify(state.research_governance?.source_hierarchy || state.source_hierarchy || {}, null, 2);
  document.getElementById("freshnessJson").textContent = JSON.stringify(state.research_governance?.freshness || state.freshness_report || {}, null, 2);
  document.getElementById("conflictGraphJson").textContent = JSON.stringify(state.research_governance?.conflict_graph || state.claim_conflict_graph || {}, null, 2);
  document.getElementById("claimsJson").textContent = JSON.stringify((state.claims || []).map((claim) => ({
    claim_id: claim.claim_id,
    source_id: claim.source_id,
    subject: claim.subject,
    claim: claim.claim,
    confidence: claim.confidence,
    status: claim.status
  })), null, 2);
  document.getElementById("qaJson").textContent = JSON.stringify(state.qa || {}, null, 2);
  renderSimpleSummaries(state);
  renderStoryPackage(state);
  renderVisualPackage(state);
  renderAudioPackage(state);
  renderCompositorPackage(state);
  renderPublishing(state);
  const compliance = state.studio_blueprint?.compliance?.required_checks || [];
  document.getElementById("approvalChecklist").innerHTML = [...baseApprovalChecklist, ...compliance.map((item) => `Studio compliance: ${item}.`)]
    .map((item) => `<li>${state.approved ? "Approved:" : "Review:"} ${escapeHtml(item)}</li>`).join("");
  approveButton.disabled = state.approved || !editorialReady;
  runIntegrationsButton.disabled = !state.approved;
  buildAudioButton.disabled = !state.approved;
  approveAudioButton.disabled = !state.approved || !state.audio_production?.performance_report?.passed || state.audio_approved;
  buildRenderButton.disabled = !state.audio_approved;
  approveRenderButton.disabled = !state.render_production?.render_qa_report?.passed || state.render_production?.render_qa_report?.output !== "final.mp4" || state.render_approved;
  loadEditorialCockpit().then(() => refreshPublishingSystem()).catch((error) => { renderEditorialCockpit(null); setFlash(`Editorial cockpit: ${error.message}`, true); });
}

function renderStoryPackage(state) {
  const blueprint = state?.narrative_blueprint || {};
  const script = state?.script_package || {};
  document.getElementById("narrativeBlueprintJson").textContent = JSON.stringify(blueprint, null, 2);
  document.getElementById("storyReportJson").textContent = JSON.stringify(state?.story_report || {}, null, 2);
  document.getElementById("timingPlanJson").textContent = JSON.stringify(state?.timing_plan || {}, null, 2);
  document.getElementById("scriptCriticJson").textContent = JSON.stringify({
    critic: script.critic || {},
    script_passes: script.script_passes || {}
  }, null, 2);
  const target = document.getElementById("scriptPreview");
  if (!script.scenes?.length) {
    target.innerHTML = '<div class="artifact-item"><span>No generated story package is selected.</span></div>';
    return;
  }
  target.innerHTML = script.scenes.map((scene) => `
    <article class="script-scene">
      <header><strong>${escapeHtml(scene.title)}</strong><span>${escapeHtml(scene.beat_name)} • ${Number(scene.estimated_duration_seconds || 0).toFixed(1)}s</span></header>
      <p class="scene-objective">${escapeHtml(scene.objective)}</p>
      <p>${escapeHtml(scene.narration)}</p>
      <small>Claims: ${escapeHtml((scene.claim_ids || []).join(", ") || "narrative bridge only")} • Retention: ${escapeHtml(scene.retention_device || "none")}</small>
    </article>`).join("");
}

function renderVisualPackage(state) {
  const identity = state?.visual_identity || {};
  const plan = state?.visual_plan || {};
  const report = state?.visual_report || {};
  const thumbnail = state?.thumbnail_plan || {};
  const similarity = state?.visual_similarity_report || {};
  const provenance = state?.asset_provenance || {};
  document.getElementById("visualIdentityJson").textContent = JSON.stringify(identity, null, 2);
  document.getElementById("visualReportJson").textContent = JSON.stringify(report, null, 2);
  document.getElementById("thumbnailPlanJson").textContent = JSON.stringify(thumbnail, null, 2);
  document.getElementById("visualSimilarityJson").textContent = JSON.stringify(similarity, null, 2);
  document.getElementById("assetProvenanceJson").textContent = JSON.stringify(provenance, null, 2);

  const colors = identity.colors || {};
  const strip = document.getElementById("visualIdentityStrip");
  strip.innerHTML = Object.entries(colors).map(([name, value]) => `
    <div class="visual-swatch" title="${escapeHtml(name)}: ${escapeHtml(value)}">
      <span style="--swatch:${escapeHtml(value)}"></span><small>${escapeHtml(name)}</small>
    </div>`).join("");

  const target = document.getElementById("visualStoryboard");
  const episodeId = state?.episode?.episode_id;
  const scenes = plan.scene_plans || [];
  const assets = state?.asset_manifest?.assets || [];
  if (!scenes.length) {
    target.innerHTML = '<div class="artifact-item"><span>No generated visual package is selected.</span></div>';
    return;
  }
  const cards = scenes.map((scene) => {
    const asset = assets.find((item) => item.asset_id === scene.preview_asset_id) || {};
    const path = asset.relative_path || scene.preview_path;
    const image = episodeId && path
      ? `<img src="/api/visual-assets/file?episode_id=${encodeURIComponent(episodeId)}&path=${encodeURIComponent(path)}" alt="Storyboard preview for ${escapeHtml(scene.title)}" loading="lazy" />`
      : `<div class="visual-frame-placeholder"><strong>${escapeHtml(scene.composition)}</strong><span>${escapeHtml(scene.kind || scene.beat_name || "scene")}</span></div>`;
    return `<article class="visual-frame">
      ${image}
      <div><strong>${escapeHtml(scene.title)}</strong><span>${escapeHtml(scene.composition)} • ${escapeHtml(scene.motion?.primary || scene.motion_cue || "measured motion")}</span></div>
      <small>${escapeHtml(scene.evidence_overlay || "No evidence overlay")}</small>
    </article>`;
  });
  const thumbnailAsset = assets.find((item) => item.role === "thumbnail" || item.asset_type === "thumbnail_preview");
  if (episodeId && thumbnailAsset?.relative_path) {
    const src = `/api/visual-assets/file?episode_id=${encodeURIComponent(episodeId)}&path=${encodeURIComponent(thumbnailAsset.relative_path)}`;
    cards.unshift(`<article class="visual-frame visual-thumbnail-frame"><img src="${src}" alt="Generated thumbnail preview" loading="lazy" /><div><strong>Thumbnail preview</strong><span>${escapeHtml(thumbnail.selected_candidate || "selected candidate")}</span></div><small>Visual promise must be delivered by the episode.</small></article>`);
  }
  target.innerHTML = cards.join("");
}

function renderEpisodes(episodes = [], currentState = null) {
  const episodeList = document.getElementById("episodeList");
  if (!episodes.length) {
    episodeList.innerHTML = '<div class="artifact-item"><span>No persisted episodes yet.</span></div>';
    return;
  }
  episodeList.innerHTML = episodes.map((episode) => `
    <button class="episode-select ${currentState?.episode?.episode_id === episode.episode_id ? "is-current" : ""}" data-episode-id="${escapeHtml(episode.episode_id)}">
      <strong>${escapeHtml(episode.title)}</strong>
      <span>${escapeHtml(episode.status)} • ${new Date(episode.updated_at).toLocaleString()}</span>
    </button>
  `).join("");
  episodeList.querySelectorAll("[data-episode-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        setFlash("Loading persisted episode and rechecking its studio snapshot...");
        await request("/api/select", { method: "POST", body: JSON.stringify({ episode_id: button.dataset.episodeId }) });
        await refresh();
        setFlash("Episode loaded from SQLite and rechecked against its evidence and Studio Pack snapshot.");
      } catch (error) { setFlash(error.message, true); }
    });
  });
}

async function refresh() {
  const [{ state }, { episodes }, { studios }, { connectors }, { runs }] = await Promise.all([
    request("/api/state"),
    request("/api/episodes"),
    request("/api/studios"),
    request("/api/connectors"),
    request("/api/connector-runs?limit=25")
  ]);
  installedStudios = studios;
  installedConnectors = connectors;
  latestConnectorRuns = runs;
  const preferred = state?.brief?.studio_id || document.getElementById("studioSelect").value;
  populateStudioSelect(studios, preferred);
  populateConnectorSelects(connectors);
  await loadStudioDetail(document.getElementById("studioSelect").value, { preserveArchetype: true });
  renderStudioRegistry(studios);
  renderConnectorRegistry(connectors);
  renderConnectorStatus();
  renderConnectorRuns(runs);
  renderState(state);
  renderEpisodes(episodes, state);
  await refreshOpportunityWorkspace(document.getElementById("studioSelect").value);
  await refreshAudienceWorkspace(document.getElementById("studioSelect").value);
}

function renderAudienceProfile(strategy) {
  const target = document.getElementById("audienceProfileList");
  if (!strategy) {
    target.innerHTML = '<div class="artifact-item"><span>No channel strategy loaded.</span></div>';
    return;
  }
  const personas = strategy.audience_profile?.personas || [];
  const pillars = strategy.content_pillars || [];
  target.innerHTML = [
    ...personas.map((persona) => `
      <div class="opportunity-card">
        <div class="opportunity-title"><strong>${escapeHtml(persona.name)}</strong><span>persona</span></div>
        <p>${escapeHtml(persona.description)}</p>
        <small>${escapeHtml(persona.knowledge_level)} • reward: ${escapeHtml(persona.desired_reward)}</small>
      </div>`),
    ...pillars.map((pillar) => `
      <div class="opportunity-card">
        <div class="opportunity-title"><strong>${escapeHtml(pillar.name)}</strong><span>${Math.round(Number(pillar.target_share || 0) * 100)}% target</span></div>
        <p>${escapeHtml(pillar.purpose)}</p>
        <small>${escapeHtml((pillar.archetypes || []).join(", "))}</small>
      </div>`)
  ].join("");
}

function renderAudienceStrategy(strategy, assessment = latestAudienceAssessment) {
  latestChannelStrategy = strategy;
  if (assessment) latestAudienceAssessment = assessment;
  renderAudienceProfile(strategy);
  document.getElementById("channelStrategyJson").textContent = JSON.stringify(strategy ? {
    channel_promise: strategy.channel_promise,
    promise_tests: strategy.promise_tests,
    portfolio: strategy.portfolio,
    content_pillars: strategy.content_pillars
  } : {}, null, 2);
  document.getElementById("audienceFitJson").textContent = JSON.stringify(latestAudienceAssessment || {}, null, 2);
  document.getElementById("fatigueJson").textContent = JSON.stringify(latestAudienceAssessment?.projected_fatigue || strategy?.fatigue || {}, null, 2);
  document.getElementById("formatRotationJson").textContent = JSON.stringify(latestAudienceAssessment?.recommended_rotation || strategy?.format_rotation || {}, null, 2);
}

async function refreshAudienceWorkspace(studioId) {
  if (!studioId) return;
  const { strategy } = await request(`/api/audience-strategy?studio_id=${encodeURIComponent(studioId)}`);
  const episodeAssessment = latestState?.brief?.studio_id === studioId ? latestState.audience_fit_report || null : null;
  latestAudienceAssessment = episodeAssessment;
  renderAudienceStrategy(strategy, episodeAssessment);
}


function discoveryConnectors(connectors = installedConnectors) {
  return connectors.filter((item) => item.capabilities.includes("topic_discovery"));
}

function populateConnectorSelects(connectors) {
  const runSelect = document.getElementById("connectorSelect");
  const discoverySelect = document.getElementById("discoveryConnectorSelect");
  const currentRun = runSelect.value;
  const currentDiscovery = discoverySelect.value;
  runSelect.innerHTML = connectors.map((item) => `<option value="${escapeHtml(item.connector_id)}">${escapeHtml(item.name)}</option>`).join("");
  const discovery = discoveryConnectors(connectors);
  discoverySelect.innerHTML = discovery.map((item) => `<option value="${escapeHtml(item.connector_id)}">${escapeHtml(item.name)}</option>`).join("");
  if (connectors.some((item) => item.connector_id === currentRun)) runSelect.value = currentRun;
  if (discovery.some((item) => item.connector_id === currentDiscovery)) discoverySelect.value = currentDiscovery;
  if (!runSelect.value && connectors[0]) runSelect.value = connectors[0].connector_id;
  if (!discoverySelect.value && discovery[0]) discoverySelect.value = discovery[0].connector_id;
}

function renderConnectorRegistry(connectors) {
  const target = document.getElementById("connectorList");
  const selected = document.getElementById("connectorSelect").value;
  target.innerHTML = connectors.map((item) => `
    <button class="connector-card ${selected === item.connector_id ? "is-current" : ""}" data-connector-id="${escapeHtml(item.connector_id)}">
      <strong>${escapeHtml(item.name)}</strong>
      <span>${escapeHtml(item.adapter)} • tier ${escapeHtml(item.source_tier)} • ${escapeHtml(item.auth.configured ? "configured" : "needs environment")}</span>
      <small>${escapeHtml(item.capabilities.join(", "))}</small>
    </button>`).join("");
  target.querySelectorAll("[data-connector-id]").forEach((button) => button.addEventListener("click", () => {
    document.getElementById("connectorSelect").value = button.dataset.connectorId;
    renderConnectorRegistry(installedConnectors);
    loadConnectorDefaults(button.dataset.connectorId);
  }));
}

async function loadConnectorDefaults(connectorId) {
  if (!connectorId) return;
  const { connector, summary } = await request(`/api/connectors/${encodeURIComponent(connectorId)}`);
  const defaultConfig = connector.connector?.default_config || {};
  document.getElementById("connectorInputEditor").value = JSON.stringify(defaultConfig, null, 2);
  document.getElementById("connectorStatusJson").textContent = JSON.stringify({
    connector_id: summary.connector_id,
    adapter: summary.adapter,
    capabilities: summary.capabilities,
    authentication: summary.auth,
    trust: summary.trust,
    content_hash: summary.content_hash,
    default_config: defaultConfig
  }, null, 2);
}

function renderConnectorStatus() {
  const selected = installedConnectors.find((item) => item.connector_id === document.getElementById("connectorSelect").value) || installedConnectors[0];
  if (!selected) {
    document.getElementById("connectorStatusJson").textContent = "No connectors installed.";
    return;
  }
  document.getElementById("connectorStatusJson").textContent = JSON.stringify(selected, null, 2);
}

function renderConnectorRuns(runs = []) {
  document.getElementById("connectorRunsJson").textContent = JSON.stringify(runs.map((run) => ({
    run_id: run.run_id,
    connector_id: run.connector_id,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at,
    source_count: run.sources?.length || 0,
    candidate_count: run.candidates?.length || 0,
    analytics_rows: run.analytics?.length || 0,
    error: run.error || null
  })), null, 2);
}

function connectorTemplate() {
  return {
    schema: "nichefoundry.connector.v1",
    connector: {
      id: "my_specialist_feed",
      name: "My Specialist Feed",
      version: "1.0.0",
      adapter: "rss",
      description: "Reads one approved RSS or Atom feed for specialist opportunity discovery.",
      capabilities: ["topic_discovery", "research_leads"],
      auth: { type: "none", env: [] },
      default_source_tier: 3,
      default_source_type: "feed_synopsis",
      default_config: {
        feed_urls: ["https://example.org/feed.xml"],
        allowed_hosts: ["example.org"],
        max_items_per_feed: 20
      },
      limits: { max_items: 100, timeout_ms: 15000, attempts: 2, max_bytes: 2000000 },
      trust: {
        can_satisfy_primary_source: false,
        content_completeness: "synopsis",
        notes: "Feed descriptions are discovery leads and require full-source review before factual use."
      }
    }
  };
}

function manualCandidateTemplate() {
  return [{
    title: "A concrete specialist episode title",
    topic: "A narrowly bounded topic matching the selected studio",
    angle: "The distinct question, transformation, or evidence-led story this episode delivers.",
    viewer_job: "teach me",
    source_hints: ["primary source query", "independent source query"],
    competitor_count: 4,
    competitor_examples: ["Competitor title and channel or URL reference"],
    series_hint: "A repeatable specialist series",
    content_role: "core_pillar",
    signals: {
      audience_demand: 0.65,
      content_gap: 0.7,
      series_potential: 0.75,
      visual_potential: 0.7,
      monetization_alignment: 0.45,
      evidence_availability: 0.8,
      production_burden: 0.45,
      policy_risk: 0.3,
      freshness_risk: 0.15
    },
    operator_notes: "Explain where supplied signals came from. Remove any value that is only a guess."
  }];
}

function nextLifecycle(current) {
  const order = ["discovered", "screened", "researched", "approved", "scheduled", "produced", "published", "measured", "expanded"];
  const index = order.indexOf(current);
  return index >= 0 && index < order.length - 1 ? order[index + 1] : null;
}

function renderOpportunityList(opportunities = []) {
  latestOpportunities = opportunities;
  const target = document.getElementById("opportunityList");
  if (!opportunities.length) {
    target.innerHTML = '<div class="artifact-item"><span>No opportunities yet. Discover the selected Studio Pack seeds or import a candidate packet.</span></div>';
    return;
  }
  target.innerHTML = opportunities.map((item) => {
    const next = nextLifecycle(item.lifecycle);
    const blocked = item.fit?.passed === false || item.cannibalization?.passed === false || ["rejected", "retired"].includes(item.lifecycle);
    return `
      <article class="opportunity-card ${blocked ? "is-blocked" : ""}">
        <div class="opportunity-score"><strong>${escapeHtml(item.opportunity_score)}</strong><span>/100</span></div>
        <div class="opportunity-copy">
          <div class="profile-title"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.lifecycle)}</span></div>
          <p>${escapeHtml(item.angle)}</p>
          <div class="rule-chips">
            <span>${escapeHtml(item.content_role)}</span>
            <span>${escapeHtml(item.decision)}</span>
            <span>fit ${escapeHtml(item.fit?.score ?? "?")}</span>
            <span>overlap ${escapeHtml(item.cannibalization?.highest_similarity ?? 0)}</span>
            <span>${escapeHtml(item.cluster_id || "unclustered")}</span>
          </div>
          <small>${escapeHtml((item.score_explanation || []).join(" "))}</small>
        </div>
        <div class="opportunity-actions">
          <button class="button button-primary" data-load-opportunity="${escapeHtml(item.opportunity_id)}" ${blocked ? "disabled" : ""}>Load Brief</button>
          ${next ? `<button class="button button-secondary" data-advance-opportunity="${escapeHtml(item.opportunity_id)}" data-next-lifecycle="${escapeHtml(next)}">Advance to ${escapeHtml(next)}</button>` : ""}
        </div>
      </article>`;
  }).join("");
  target.querySelectorAll("[data-load-opportunity]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const { brief } = await request("/api/opportunities/brief", { method: "POST", body: JSON.stringify({ opportunity_id: button.dataset.loadOpportunity }) });
        await fillForm(brief);
        setFlash("Opportunity loaded into the production brief. Its decision record will be snapshotted into the approval bundle.");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (error) { setFlash(error.message, true); }
    });
  });
  target.querySelectorAll("[data-advance-opportunity]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await request("/api/opportunities/lifecycle", { method: "POST", body: JSON.stringify({
          opportunity_id: button.dataset.advanceOpportunity,
          lifecycle: button.dataset.nextLifecycle,
          actor: "local-editor"
        }) });
        await refreshOpportunityWorkspace(document.getElementById("studioSelect").value);
        setFlash(`Opportunity advanced to ${button.dataset.nextLifecycle}.`);
      } catch (error) { setFlash(error.message, true); }
    });
  });
}

async function refreshOpportunityWorkspace(studioId) {
  if (!studioId) return;
  const [{ opportunities }, analysis] = await Promise.all([
    request(`/api/opportunities?studio_id=${encodeURIComponent(studioId)}`),
    request(`/api/opportunities/analysis?studio_id=${encodeURIComponent(studioId)}`)
  ]);
  renderOpportunityList(opportunities);
  document.getElementById("opportunityAnalysisJson").textContent = JSON.stringify(analysis, null, 2);
}

function customPackTemplate() {
  return {
    schema_version: "1.0",
    studio: {
      id: "custom_vertical_lab",
      name: "Custom Vertical Lab",
      version: "1.0.0",
      tagline: "A sharply bounded specialist promise.",
      domain: "one narrow subject, one defined audience, and one repeatable evidence-led transformation",
      description: "Replace this description with what the studio investigates, explains, or helps viewers accomplish."
    },
    audience: {
      primary_age: "18-44",
      knowledge_level: "curious non-specialist",
      motivations: ["solve a concrete problem", "understand a bounded subject"],
      viewer_jobs: ["teach me", "help me decide"],
      vocabulary: "plain language with defined specialist terms",
      personas: [
        {
          id: "primary_viewer",
          name: "Primary Viewer",
          description: "Describe the specific person this studio serves and the knowledge they already possess.",
          age_range: "18-44",
          knowledge_level: "curious non-specialist",
          motivations: ["reach one concrete outcome", "understand one bounded subject"],
          frustrations: ["generic advice", "unsupported certainty"],
          viewing_context: ["focused desktop or television viewing"],
          desired_reward: "A clear, credible transformation by the end of the episode.",
          likely_next_action: "Continue into a related episode or apply the lesson."
        }
      ],
      frustrations: ["generic advice", "unsupported certainty"],
      viewing_context: ["focused desktop or television viewing"],
      desired_reward: "A clear, credible transformation by the end of the episode.",
      likely_next_action: "Continue into a related episode or apply the lesson."
    },
    promise: {
      statement: "State the reliable transformation every episode delivers.",
      required: ["show evidence", "deliver a concrete conclusion"],
      prohibited: ["unsupported certainty", "template filler"]
    },
    fit: {
      keywords: ["keyword one", "keyword two", "keyword three", "keyword four", "keyword five", "keyword six"],
      negative_keywords: ["clearly unrelated subject", "another excluded subject"],
      topic_examples: ["specific topic example one", "specific topic example two", "specific topic example three"],
      minimum_score: 0.22
    },
    research: {
      minimum_independent_sources: 2,
      primary_source_required: true,
      enforcement_stage: "pre_production",
      preferred_source_tiers: {
        tier_1: ["official records", "primary evidence"],
        tier_2: ["peer-reviewed or expert sources"],
        tier_3: ["reputable orientation sources"]
      },
      disallowed_sources: ["unsourced content farms"],
      conflict_policy: "Represent credible disagreement and preserve uncertainty.",
      freshness_days: null
    },
    content: {
      default_archetype: "case_file",
      archetypes: [
        {
          id: "case_file",
          name: "Case File",
          description: "Investigate one bounded question through evidence and conclusion.",
          required_story_beats: ["question", "context", "evidence_one", "evidence_two", "interpretation", "conclusion"],
          hook_types: ["unanswered question"],
          allowed_outputs: ["long_form", "short"]
        },
        {
          id: "mechanism_explainer",
          name: "Mechanism Explainer",
          description: "Explain components, process, consequence, and application.",
          required_story_beats: ["mystery", "components", "process", "demonstration", "implication", "application"],
          hook_types: ["surprising mechanism"],
          allowed_outputs: ["long_form", "short"]
        }
      ]
    },
    visuals: {
      language: ["evidence-led diagrams", "readable labels", "purposeful maps"],
      forbidden: ["unrelated stock footage", "unreadable text"],
      motion_rules: ["motion reveals relationships"],
      palette: ["graphite", "white", "one specialist accent"]
    },
    visual_system: {
      name: "Custom Vertical Visual System",
      motif: "evidence_window",
      texture: "restrained_grid",
      icon_style: "outlined_specialist",
      diagram_style: "claim_relationship",
      map_style: "context_schematic",
      compositions: ["focal_subject", "evidence_split", "process_flow", "comparison", "timeline", "final_synthesis"],
      thumbnail_compositions: ["single_focal", "before_after", "evidence_question"],
      identity: {
        colors: { background: "#071016", surface: "#10202a", panel: "#172b36", primary: "#e7f1f4", muted: "#9bb0b9", accent: "#55e0ad", secondary: "#67b7ff", danger: "#ef6767", grid: "#27404b" },
        typography: { display: "Rajdhani, sans-serif", body: "Inter, sans-serif", mono: "IBM Plex Mono, monospace" }
      },
      grid: { columns: 12, gutter_px: 28, margin_px: 96, baseline_px: 8 },
      safe_area: { title: 0.08, action: 0.05, captions_bottom: 0.16 },
      accessibility: { minimum_body_px_1080p: 34, minimum_caption_px_1080p: 42 }
    },
    voice: {
      tone: "clear, specialist, and humane",
      pacing: "measured around evidence",
      pronunciation_domains: ["domain terminology"],
      forbidden_traits: ["fake certainty"]
    },
    story_engine: {
      narrative_mode: "evidence_led_explainer",
      default_target_minutes: 8,
      spoken_words_per_minute: 145,
      opening_rules: ["Open a bounded question the evidence can answer", "Avoid manufactured urgency"],
      retention_devices: ["open question", "evidence reveal", "midpoint synthesis", "qualified payoff"],
      closing_rules: ["Return to the opening question", "State what remains uncertain"],
      forbidden_phrases: ["shocking truth", "changes everything"],
      required_passes: ["evidence", "structure", "audience", "spoken_language", "timing", "originality", "sensationalism"]
    },
    compliance: {
      risk_level: "medium",
      human_fact_review: true,
      synthetic_reconstruction_disclosure: "required when realistic synthetic media could be mistaken for authentic evidence",
      upload_default: "private",
      required_checks: ["source support", "rights and disclosure"]
    },
    monetization: {
      paths: ["sponsorship", "premium educational resources"],
      prohibited_relationships: ["paid conclusions"],
      trust_rules: ["commercial relationships never alter findings"]
    },
    metrics: {
      primary: ["average percentage viewed", "returning viewers"],
      guardrails: ["correction rate", "unsupported claim rate"]
    },
    channel_strategy: {
      minimum_audience_fit_score: 62,
      promise_tests: [
        "Does the episode clearly serve the named viewer?",
        "Does it fulfil the studio promise with evidence?",
        "Does it end with a concrete audience reward?"
      ],
      content_pillars: [
        {
          id: "core_explanations",
          name: "Core Explanations",
          purpose: "Deliver the studio's central repeatable viewer transformation.",
          keywords: ["explain", "understand", "evidence", "mechanism"],
          archetypes: ["case_file", "mechanism_explainer"],
          target_share: 0.6
        },
        {
          id: "decisions_and_application",
          name: "Decisions and Application",
          purpose: "Help viewers apply the evidence to a practical choice or next action.",
          keywords: ["decide", "apply", "compare", "lesson"],
          archetypes: ["case_file", "mechanism_explainer"],
          target_share: 0.4
        }
      ],
      portfolio_targets: {
        core_pillar: 0.5,
        search_evergreen: 0.2,
        experimental: 0.15,
        audience_request: 0.1,
        commercial_intent: 0.05
      },
      format_rotation: {
        maximum_same_archetype_streak: 2,
        maximum_same_pillar_streak: 2,
        maximum_same_viewer_job_streak: 3,
        maximum_same_output_streak: 3,
        lookback_items: 8
      }
    },
    samples: [{
      working_title: "Replace with a concrete episode title",
      topic: "replace with a topic containing the pack keywords",
      story_premise: "Explain the episode transformation.",
      age_band: "13+",
      difficulty: "mixed",
      question_count: 6,
      countdown_seconds: 8,
      target_duration_minutes: 8,
      audience_mode: "general_family",
      contains_synthetic_media: false,
      source_mode: "wikipedia",
      source_queries: ["replace query one", "replace query two"],
      visual_direction: "Apply the studio visual grammar.",
      studio_id: "custom_vertical_lab",
      archetype_id: "case_file",
      target_persona_id: "primary_viewer",
      viewer_job: "teach me",
      content_pillar_id: "core_explanations",
      output_format: "long_form"
    }]
  };
}

const form = document.getElementById("briefForm");
document.getElementById("studioSelect").addEventListener("change", async (event) => {
  try {
    await loadStudioDetail(event.target.value);
    renderStudioRegistry(installedStudios);
    await refreshOpportunityWorkspace(event.target.value);
    await refreshAudienceWorkspace(event.target.value);
  } catch (error) { setFlash(error.message, true); }
});
document.getElementById("archetypeSelect").addEventListener("change", () => {
  populateAudienceControls(currentStudio, { preserve: true });
  renderStudioProfile(currentStudio);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setFlash("Checking audience strategy, studio fit, research evidence, claims, and the archetype story map...");
    const brief = autoExpandBriefForStudio(readBriefFromForm(form));
    await fillForm(brief);
    if (!brief.source_queries.length) brief.source_queries = [brief.topic];
    await generateWithBestStudioFallback(brief);
    await refresh();
    setFlash("Audience-governed studio packet generated, snapshotted, and independently audited.");
  } catch (error) {
    const fit = error.payload?.fit;
    setFlash(fit ? `${error.message} Matched: ${(fit.matched_keywords || []).join(", ") || "none"}.` : error.message, true);
  }
});

document.getElementById("checkFitButton").addEventListener("click", async () => {
  try {
    const brief = readBriefFromForm(form);
    const { fit } = await request("/api/studios/fit", { method: "POST", body: JSON.stringify({ studio_id: brief.studio_id, brief }) });
    document.getElementById("studioFitJson").textContent = JSON.stringify(fit, null, 2);
    setFlash(fit.passed ? `Studio fit passed at ${fit.score}.` : `Studio fit failed at ${fit.score}; threshold ${fit.threshold}.`, !fit.passed);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("loadSampleButton")?.addEventListener("click", async () => {
  try {
    const { studio } = await request(`/api/studios/${encodeURIComponent(document.getElementById("studioSelect").value)}`);
    const sample = studio.samples?.[0];
    if (!sample) throw new Error("This Studio Pack has no sample brief.");
    await fillForm(sample);
    setFlash(`${studio.studio.name} sample loaded. Review it, then generate when ready.`);
  } catch (error) { setFlash(error.message, true); }
});

async function autoBriefFromYouTube({ generatePacket = false } = {}) {
  const brief = autoExpandBriefForStudio(readBriefFromForm(form));
  if (!brief.studio_id) throw new Error("Choose a studio first.");
  if (!brief.topic) throw new Error("Enter a topic first.");
  setFlash("Researching public YouTube coverage, scoring candidates, and loading the strongest brief...");
  const result = await request("/api/opportunities/discover", {
    method: "POST",
    body: JSON.stringify({
      studio_id: brief.studio_id,
      provider: "connector",
      connector_id: "youtube_public_discovery",
      input: { query: brief.topic, max_results: 10 },
      actor: "local-editor"
    })
  });
  const opportunities = result.opportunities || [];
  const eligible = opportunities.find((item) =>
    item.fit?.passed !== false &&
    item.cannibalization?.passed !== false &&
    !["rejected", "retired"].includes(item.lifecycle)
  );
  if (!eligible?.opportunity_id) {
    const fallbackBrief = autoExpandBriefForStudio(brief);
    await fillForm(fallbackBrief);
    await refreshOpportunityWorkspace(brief.studio_id);
    if (!generatePacket) {
      setFlash("YouTube research found overlap-heavy candidates, so the system drafted a clean brief directly from your topic instead.");
      return;
    }
    setFlash("YouTube research found only blocked candidates. Building a fresh studio packet directly from your topic...");
    await generateWithBestStudioFallback(fallbackBrief);
    const gamma = await tryGenerateGammaStoryboard();
    await refresh();
    setFlash(gamma?.mode === "live"
      ? "The system skipped blocked YouTube candidates, built a fresh studio packet from your topic, and sent the storyboard to Gamma."
      : "The system skipped blocked YouTube candidates and built a fresh studio packet directly from your topic.");
    return;
  }
  const loaded = await request("/api/opportunities/brief", { method: "POST", body: JSON.stringify({ opportunity_id: eligible.opportunity_id }) });
  await fillForm({
    ...autoExpandBriefForStudio({
      ...loaded.brief,
      studio_id: loaded.brief.studio_id || brief.studio_id
    }),
    topic: loaded.brief.topic || brief.topic,
    working_title: loaded.brief.working_title || brief.working_title || eligible.title,
    story_premise: loaded.brief.story_premise || brief.story_premise || eligible.angle
  });
  await refreshOpportunityWorkspace(brief.studio_id);
  if (!generatePacket) {
    setFlash(`YouTube research loaded the top candidate into the brief: ${eligible.title}`);
    return;
  }
  setFlash("Top YouTube candidate loaded. Building the governed packet now...");
  const populatedBrief = autoExpandBriefForStudio(readBriefFromForm(form));
  if (!populatedBrief.source_queries.length) populatedBrief.source_queries = [populatedBrief.topic];
  await generateWithBestStudioFallback(populatedBrief);
  const gamma = await tryGenerateGammaStoryboard();
  await refresh();
  setFlash(gamma?.mode === "live"
    ? "YouTube research completed, the best candidate was loaded, the studio packet was built, and the storyboard was sent to Gamma."
    : "YouTube research completed, the best candidate was loaded, and the studio packet was built.");
}

async function findBestStudioForBrief(brief) {
  const fits = await Promise.all(installedStudios.map(async (studio) => {
    try {
      const { fit } = await request("/api/studios/fit", {
        method: "POST",
        body: JSON.stringify({ studio_id: studio.studio_id, brief: { ...brief, studio_id: studio.studio_id } })
      });
      return { studio_id: studio.studio_id, studio_name: studio.name, fit };
    } catch (_error) {
      return null;
    }
  }));
  return fits
    .filter(Boolean)
    .sort((left, right) => Number(right.fit?.score || 0) - Number(left.fit?.score || 0))[0] || null;
}

async function generateWithBestStudioFallback(brief) {
  try {
    await request("/api/generate", { method: "POST", body: JSON.stringify({ brief }) });
    return { studio_switched: false, brief };
  } catch (error) {
    const fit = error.payload?.fit;
    if (!fit) throw error;
    const best = await findBestStudioForBrief(brief);
    if (!best?.studio_id || best.studio_id === brief.studio_id) {
      const forcedBrief = { ...brief, allow_low_fit: true };
      await request("/api/generate", { method: "POST", body: JSON.stringify({ brief: forcedBrief }) });
      setFlash(`No installed studio was a strong match, so autopilot continued with ${fit.studio_id || "the closest studio"} and flagged the weak fit for human review.`);
      return { studio_switched: false, forced_low_fit: true, brief: forcedBrief };
    }
    const switchedBrief = autoExpandBriefForStudio({ ...brief, studio_id: best.studio_id }, installedStudios.find((studio) => studio.studio_id === best.studio_id));
    await fillForm(switchedBrief);
    const refreshedBrief = readBriefFromForm(form);
    if (!refreshedBrief.source_queries.length) refreshedBrief.source_queries = [refreshedBrief.topic];
    await request("/api/generate", { method: "POST", body: JSON.stringify({ brief: refreshedBrief }) });
    setFlash(`The original studio fit was weak, so autopilot switched to ${best.studio_name} and continued.`);
    return { studio_switched: true, brief: refreshedBrief, best };
  }
}

async function tryGenerateGammaStoryboard() {
  try {
    const result = await request("/api/gamma-storyboard", { method: "POST", body: "{}" });
    latestState = result.state || latestState;
    return result.gamma || null;
  } catch (_error) {
    return null;
  }
}

document.getElementById("researchYouTubeButton").addEventListener("click", async () => {
  try {
    await autoBriefFromYouTube({ generatePacket: false });
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("autopilotButton").addEventListener("click", async () => {
  try {
    await autoBriefFromYouTube({ generatePacket: true });
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("resetButton").addEventListener("click", async () => {
  try {
    await request("/api/reset", { method: "POST", body: "{}" });
    await resetForm();
    await refresh();
    setFlash("Current selection cleared. Persisted evidence and installed studios remain intact.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("approveButton").addEventListener("click", async () => {
  try {
    setFlash("Recording hash-bound Studio Pack approval...");
    await request("/api/approve", { method: "POST", body: JSON.stringify({ reviewer: "local-editor", notes: "Opportunity decision, audience strategy, connector provenance, source hierarchy, conflicts, Studio Pack, selected hook, full scene script, visual package, host identity, pronunciation lexicon, audio performance plan, timing, and compliance reviewed in the Phase 10 Human Editorial Cockpit." }) });
    await refresh();
    setFlash("Approval recorded against the complete Studio Pack editorial bundle.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("runIntegrationsButton").addEventListener("click", async () => {
  try {
    setFlash("Running downstream jobs without granting them permission to invent completion...");
    await request("/api/run-integrations", { method: "POST", body: "{}" });
    await refresh();
    setFlash("Integration jobs recorded. Delivery readiness still depends on verified files.");
  } catch (error) { setFlash(error.message, true); }
});


document.getElementById("assessAudienceButton").addEventListener("click", async () => {
  try {
    const brief = readBriefFromForm(form);
    const result = await request("/api/audience-strategy/assess", {
      method: "POST",
      body: JSON.stringify({ studio_id: brief.studio_id, brief, actor: "local-editor" })
    });
    latestAudienceAssessment = result.assessment;
    renderAudienceStrategy(result.strategy, result.assessment);
    setFlash(result.assessment.passed
      ? `Audience fit passed at ${result.assessment.audience_fit.score}/100 for ${result.assessment.audience_fit.persona?.name || "the selected viewer"}.`
      : `Audience strategy blocked: ${result.assessment.issues.join(" ") || "fit threshold not reached"}.`, !result.assessment.passed);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("refreshAudienceButton").addEventListener("click", async () => {
  try {
    await refreshAudienceWorkspace(document.getElementById("studioSelect").value);
    setFlash("Channel promise, personas, portfolio balance, fatigue, and format rotation refreshed.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("loadManualTemplateButton").addEventListener("click", () => {
  document.getElementById("manualCandidateEditor").value = JSON.stringify(manualCandidateTemplate(), null, 2);
  document.getElementById("discoveryProvider").value = "manual";
  setFlash("Manual opportunity template loaded. Replace its example signals with evidence or remove them to use labelled proxies.");
});

document.getElementById("discoverButton").addEventListener("click", async () => {
  try {
    const studioId = document.getElementById("studioSelect").value;
    const provider = document.getElementById("discoveryProvider").value;
    const body = { studio_id: studioId, provider, actor: "local-editor" };
    if (provider === "mediawiki_search") body.query = document.getElementById("discoveryQuery").value.trim();
    if (provider === "manual") body.candidates = JSON.parse(document.getElementById("manualCandidateEditor").value || "[]");
    if (provider === "connector") {
      body.connector_id = document.getElementById("discoveryConnectorSelect").value;
      body.input = parseJsonValue(document.getElementById("discoveryConnectorInput").value, {});
      if (!body.input.query && document.getElementById("discoveryQuery").value.trim()) body.input.query = document.getElementById("discoveryQuery").value.trim();
    }
    setFlash("Discovering candidates, scoring transparent signals, auditing overlap, and rebuilding the topic clusters...");
    const result = await request("/api/opportunities/discover", { method: "POST", body: JSON.stringify(body) });
    renderOpportunityList(result.opportunities);
    document.getElementById("opportunityAnalysisJson").textContent = JSON.stringify({
      proxy_notice: result.proxy_notice,
      clusters: result.clusters,
      portfolio: result.portfolio
    }, null, 2);
    await refreshOpportunityWorkspace(studioId);
    setFlash(`${result.opportunities.length} opportunity candidate${result.opportunities.length === 1 ? "" : "s"} scored. Proxy-derived signals remain visibly labelled.`);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("refreshOpportunityButton").addEventListener("click", async () => {
  try {
    await refreshOpportunityWorkspace(document.getElementById("studioSelect").value);
    setFlash("Opportunity clusters, lifecycle counts, and portfolio balance refreshed.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("buildSeriesButton").addEventListener("click", async () => {
  try {
    const result = await request("/api/opportunities/series-plan", { method: "POST", body: JSON.stringify({
      studio_id: document.getElementById("studioSelect").value,
      actor: "local-editor"
    }) });
    document.getElementById("seriesPlanJson").textContent = JSON.stringify(result, null, 2);
    setFlash(`${result.series.length} evidence-linked series architecture${result.series.length === 1 ? "" : "s"} created.`);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("buildCalendarButton").addEventListener("click", async () => {
  try {
    const result = await request("/api/opportunities/calendar", { method: "POST", body: JSON.stringify({
      studio_id: document.getElementById("studioSelect").value,
      start_date: document.getElementById("calendarStart").value,
      weeks: Number(document.getElementById("calendarWeeks").value),
      slots_per_week: Number(document.getElementById("calendarSlots").value),
      actor: "local-editor"
    }) });
    document.getElementById("calendarJson").textContent = JSON.stringify(result, null, 2);
    setFlash(`${result.entries.length} proposed calendar slot${result.entries.length === 1 ? "" : "s"} sequenced with cluster repetition penalties.`);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("loadPackTemplateButton").addEventListener("click", () => {
  document.getElementById("packEditor").value = JSON.stringify(customPackTemplate(), null, 2);
  document.getElementById("packValidationJson").textContent = "Template loaded. Replace every placeholder before validation.";
});

document.getElementById("validatePackButton").addEventListener("click", async () => {
  try {
    const pack = JSON.parse(document.getElementById("packEditor").value);
    const { validation } = await request("/api/studios/validate", { method: "POST", body: JSON.stringify({ pack }) });
    document.getElementById("packValidationJson").textContent = JSON.stringify(validation, null, 2);
    setFlash(`Pack validation passed with niche depth ${validation.depth.score}/100.`);
  } catch (error) {
    document.getElementById("packValidationJson").textContent = JSON.stringify(error.payload?.validation || { error: error.message }, null, 2);
    setFlash(error.message, true);
  }
});

document.getElementById("installPackButton").addEventListener("click", async () => {
  try {
    const pack = JSON.parse(document.getElementById("packEditor").value);
    const result = await request("/api/studios/install", { method: "POST", body: JSON.stringify({ pack, actor: "local-editor" }) });
    installedStudios = result.studios;
    populateStudioSelect(installedStudios, result.studio.studio.id);
    await loadStudioDetail(result.studio.studio.id);
    renderStudioRegistry(installedStudios);
    document.getElementById("packValidationJson").textContent = JSON.stringify(result.validation, null, 2);
    setFlash(`${result.studio.studio.name} installed with immutable content hash ${result.validation.content_hash.slice(0, 12)}…`);
  } catch (error) {
    document.getElementById("packValidationJson").textContent = JSON.stringify(error.payload?.validation || { error: error.message }, null, 2);
    setFlash(error.message, true);
  }
});

document.getElementById("previewStoryButton").addEventListener("click", async () => {
  try {
    const brief = readBriefFromForm(document.getElementById("briefForm"));
    setFlash("Previewing the Studio Pack hook grammar, beat sequence, retention plan, and evidence-bounded duration...");
    const result = await request("/api/story-engine/preview", { method: "POST", body: JSON.stringify({ brief }) });
    document.getElementById("narrativeBlueprintJson").textContent = JSON.stringify(result.narrative_blueprint, null, 2);
    document.getElementById("storyReportJson").textContent = JSON.stringify({ mode: "pre-research preview", audience_fit: result.audience_fit, note: "Claims and full narration are generated only after research." }, null, 2);
    setFlash(`${result.narrative_blueprint.archetype.name} contract previewed with ${result.narrative_blueprint.required_story_beats.length} required beats.`);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("refreshStoryButton").addEventListener("click", async () => {
  try {
    const result = await request("/api/story-engine");
    renderStoryPackage(result);
    setFlash(`Loaded the current ${result.script_package?.scenes?.length || 0}-scene story package.`);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("previewVisualButton").addEventListener("click", async () => {
  try {
    const brief = readBriefFromForm(document.getElementById("briefForm"));
    setFlash("Previewing the selected studio's composition grammar, thumbnail rules, rights defaults, and anti-template gates...");
    const result = await request("/api/visual-system/preview", { method: "POST", body: JSON.stringify({ brief }) });
    renderVisualPackage(result);
    setFlash(`${result.visual_identity?.studio_name || "Studio"} visual constitution previewed with ${result.visual_plan?.scene_plans?.length || 0} planned compositions.`);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("refreshVisualButton").addEventListener("click", async () => {
  try {
    const result = await request("/api/visual-system");
    renderVisualPackage({ ...result, episode: { episode_id: result.episode_id } });
    setFlash(`Loaded ${result.visual_plan?.scene_plans?.length || 0} storyboard scenes and ${result.asset_manifest?.assets?.length || 0} provenance-tracked assets.`);
  } catch (error) { setFlash(error.message, true); }
});

function renderAudioPackage(state) {
  const host = state?.host_profile || {};
  const lexicon = state?.pronunciation_lexicon || {};
  const plan = state?.audio_performance_plan || {};
  const sound = state?.sound_design_plan || {};
  const preflight = state?.audio_preflight_report || {};
  const production = state?.audio_production || {};
  document.getElementById("hostProfileJson").textContent = JSON.stringify(host, null, 2);
  document.getElementById("pronunciationLexiconJson").textContent = JSON.stringify(lexicon, null, 2);
  document.getElementById("audioPerformancePlanJson").textContent = JSON.stringify(plan, null, 2);
  document.getElementById("soundDesignJson").textContent = JSON.stringify(sound, null, 2);
  document.getElementById("audioPreflightJson").textContent = JSON.stringify({ preflight, performance_report: production.performance_report || null }, null, 2);
  document.getElementById("loudnessReportJson").textContent = JSON.stringify(production.loudness_report || {}, null, 2);
  document.getElementById("audioApprovalJson").textContent = JSON.stringify(state?.audio_approval || { approved: false }, null, 2);
  const primary = host.primary_host || {};
  const secondary = host.secondary_host || {};
  document.getElementById("hostIdentityStrip").innerHTML = primary.id ? `
    <div class="studio-badge"><strong>${escapeHtml(primary.name || primary.id)}</strong><span>${escapeHtml(primary.tone || primary.style || "primary host")}</span></div>
    <div class="studio-badge"><strong>${escapeHtml(secondary.name || secondary.id || "Secondary host")}</strong><span>${escapeHtml(secondary.style || "supporting readouts")}</span></div>
    <div class="studio-badge"><strong>${escapeHtml(sound.music_identity?.family || "Sound identity")}</strong><span>${escapeHtml(`${plan.mastering?.programme_target_lufs ?? "?"} LUFS target`)}</span></div>` : "";
  const generated = new Map((production.audio_manifest?.scenes || []).map((scene) => [scene.scene_id, scene]));
  const scenes = plan.scenes || [];
  document.getElementById("audioSceneList").innerHTML = scenes.length ? scenes.map((scene) => {
    const result = generated.get(scene.scene_id);
    return `<article class="script-scene">
      <header><strong>${escapeHtml(scene.host_name || scene.host_id)}</strong><span>${escapeHtml(scene.story_beat)} • ${Number(scene.target_duration_seconds || 0).toFixed(1)}s</span></header>
      <p class="scene-objective">${escapeHtml(scene.performance?.intention || "")}</p>
      <p>${escapeHtml(scene.spoken_text || scene.narration_text || "")}</p>
      <small>${result ? `${escapeHtml(result.provider)} • ${result.cache_hit ? "cache hit" : "fresh synthesis"} • ${Number(result.resolved_duration_seconds || 0).toFixed(1)}s` : `Planned at ${scene.performance?.pace_wpm || "?"} WPM`}</small>
    </article>`;
  }).join("") : '<div class="artifact-item"><span>No audio performance plan is selected.</span></div>';
  const previewPath = production.audio_manifest?.episode_preview;
  const episodeId = state?.episode?.episode_id;
  document.getElementById("audioPreviewPlayer").innerHTML = previewPath && episodeId
    ? `<audio controls preload="metadata" src="/api/audio-assets/file?episode_id=${encodeURIComponent(episodeId)}&path=${encodeURIComponent(previewPath)}"></audio><p class="section-note">Measured preview generated from the registered scene performances and current sound-design plan.</p>`
    : '<div class="artifact-item"><span>Approve the editorial packet, then build audio to hear the measured episode preview.</span></div>';
}

function renderMusicDiscovery(result) {
  const discovery = result?.discovery || {};
  document.getElementById("musicDiscoveryJson").textContent = JSON.stringify({
    provider: discovery.provider,
    configured: discovery.configured,
    profile: discovery.profile,
    issues: discovery.issues,
    searched_at: discovery.searched_at
  }, null, 2);
  const candidates = discovery.candidates || [];
  document.getElementById("musicDiscoveryList").innerHTML = candidates.length
    ? candidates.map((track, index) => `
      <article class="script-scene">
        <header><strong>${index + 1}. ${escapeHtml(track.title || "Untitled")}</strong><span>${escapeHtml(track.artist || "Unknown artist")} • ${Number(track.duration_seconds || 0).toFixed(0)}s</span></header>
        <p class="scene-objective">${escapeHtml(track.theme_match_reason || "")}</p>
        <p>${escapeHtml((track.tags || []).slice(0, 8).join(", ") || "No tags returned.")}</p>
        <small>${escapeHtml(track.provider_label || track.provider || "provider")} • ${track.download_allowed ? "download allowed" : "preview only"}${track.licence_name ? ` • ${escapeHtml(track.licence_name)}` : ""}</small>
        <p>${track.preview_url ? `<audio controls preload="none" src="${escapeHtml(track.preview_url)}"></audio>` : ""}</p>
        <p>${track.page_url ? `<a href="${escapeHtml(track.page_url)}" target="_blank" rel="noreferrer">Open track page</a>` : ""}${track.licence_url ? ` • <a href="${escapeHtml(track.licence_url)}" target="_blank" rel="noreferrer">Licence</a>` : ""}</p>
      </article>`).join("")
    : '<div class="artifact-item"><span>No music candidates loaded yet.</span></div>';
}

function renderCompositorPackage(state) {
  const production = state?.render_production || {};
  const plan = production.render_plan || state?.render_plan || {};
  const qa = production.render_qa_report || state?.render_qa_report || {};
  const captions = production.caption_track || state?.caption_track || {};
  const approval = state?.render_approval || { approved: false };
  document.getElementById("renderPlanJson").textContent = JSON.stringify(plan, null, 2);
  document.getElementById("renderQaJson").textContent = JSON.stringify(qa, null, 2);
  document.getElementById("captionTrackJson").textContent = JSON.stringify({ language: captions.language, cue_count: captions.cue_count, duration_seconds: captions.duration_seconds, cues: (captions.cues || []).slice(0, 12) }, null, 2);
  document.getElementById("renderApprovalJson").textContent = JSON.stringify(approval, null, 2);
  const scenes = production.render_manifest?.scenes || plan.scenes || [];
  document.getElementById("renderSegmentList").innerHTML = scenes.length ? scenes.map((scene) => `
    <article class="script-scene">
      <header><strong>${escapeHtml(scene.title || scene.scene_id)}</strong><span>${escapeHtml(scene.camera?.id || "camera pending")} • ${Number(scene.duration_seconds || 0).toFixed(1)}s</span></header>
      <p>${escapeHtml(scene.story_beat || scene.composition || "scene")}</p>
      <small>${scene.segment_path ? `${scene.segment_cache_hit ? "Cache hit" : "Rendered"} • ${escapeHtml(scene.segment_path)}` : `Visual ${escapeHtml(scene.visual_path || "pending")} • Audio ${escapeHtml(scene.audio_path || "pending")}`}</small>
    </article>`).join("") : '<div class="artifact-item"><span>Approve audio, then build a proxy or final programme.</span></div>';
  const episodeId = state?.episode?.episode_id;
  const outputPath = production.render_manifest?.output;
  document.getElementById("renderPreviewPlayer").innerHTML = outputPath && episodeId
    ? `<video controls preload="metadata" poster="/api/render-assets/file?episode_id=${encodeURIComponent(episodeId)}&path=thumbnail.png" src="/api/render-assets/file?episode_id=${encodeURIComponent(episodeId)}&path=${encodeURIComponent(outputPath)}"></video><p class="section-note">${escapeHtml(outputPath)} • ${Number(qa.probe?.duration_seconds || 0).toFixed(2)}s • ${qa.embedded_subtitles ? "embedded captions" : "caption track missing"} • QA ${qa.passed ? "passed" : "blocked"}</p>`
    : '<div class="artifact-item"><span>No composed programme is available yet.</span></div>';
}

document.getElementById("refreshRenderButton").addEventListener("click", async () => {
  try {
    const profile = document.getElementById("renderProfileSelect").value;
    const result = await request(`/api/render-system?profile=${encodeURIComponent(profile)}`);
    renderCompositorPackage({ ...result, episode: { episode_id: result.episode_id }, render_production: result.production, render_approval: result.render_approval });
    setFlash(`Loaded ${result.render_plan?.scenes?.length || 0} compositor scenes for ${profile}.`);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("buildRenderButton").addEventListener("click", async () => {
  try {
    if (!latestState?.episode?.episode_id) throw new Error("Generate or select an episode first.");
    const profile = document.getElementById("renderProfileSelect").value;
    const sceneIds = document.getElementById("renderSceneIds").value.split(",").map((item) => item.trim()).filter(Boolean);
    setFlash(`Compositing ${profile}${sceneIds.length ? ` with ${sceneIds.length} forced scene rerender(s)` : ""}...`);
    const result = await request("/api/render-system/build", {
      method: "POST",
      body: JSON.stringify({ episode_id: latestState.episode.episode_id, profile, scene_ids: sceneIds, actor: "local-editor" })
    });
    renderState(result.state);
    setFlash(`Programme composed: ${result.production?.render_manifest?.output || profile}; ${result.production?.render_qa_report?.segment_cache_hits || 0} cached segments; QA ${result.production?.render_qa_report?.passed ? "passed" : "blocked"}.`, !result.production?.render_qa_report?.passed);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("approveRenderButton").addEventListener("click", async () => {
  try {
    if (!latestState?.episode?.episode_id) throw new Error("Generate or select an episode first.");
    const result = await request("/api/render-system/approve", {
      method: "POST",
      body: JSON.stringify({ episode_id: latestState.episode.episode_id, reviewer: "local-editor", notes: "Final programme watched end to end; scene order, camera motion, captions, audio sync, thumbnail, black-frame report, duration, and delivery streams reviewed." })
    });
    renderState(result.state);
    setFlash("Final programme approved against the measured render bundle. Private upload is now eligible if every delivery artifact remains current.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("refreshAudioButton").addEventListener("click", async () => {
  try {
    const result = await request("/api/audio-system");
    renderAudioPackage({ ...result, episode: { episode_id: result.episode_id }, audio_production: result.production, audio_approval: result.audio_approval });
    setFlash(`Loaded ${result.audio_performance_plan?.scenes?.length || 0} planned scene performances for ${result.host_profile?.primary_host?.name || "the selected host"}.`);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("buildAudioButton").addEventListener("click", async () => {
  try {
    if (!latestState?.episode?.episode_id) throw new Error("Generate or select an episode first.");
    const provider = document.getElementById("audioProviderSelect").value;
    setFlash(`Synthesising, mastering, measuring, and caching scene audio through ${provider}...`);
    const result = await request("/api/audio-system/build", {
      method: "POST",
      body: JSON.stringify({ episode_id: latestState.episode.episode_id, provider, actor: "local-editor" })
    });
    renderState(result.state);
    setFlash(`Audio ready: ${result.production?.performance_report?.scene_count || 0} scenes, ${result.production?.performance_report?.cache_hits || 0} cache hits, QA ${result.production?.performance_report?.passed ? "passed" : "blocked"}.`, !result.production?.performance_report?.passed);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("approveAudioButton").addEventListener("click", async () => {
  try {
    if (!latestState?.episode?.episode_id) throw new Error("Generate or select an episode first.");
    const result = await request("/api/audio-system/approve", {
      method: "POST",
      body: JSON.stringify({ episode_id: latestState.episode.episode_id, reviewer: "local-editor", notes: "Host performance, pronunciation, pacing, scene transitions, loudness, timing drift, and full episode audio preview reviewed." })
    });
    renderState(result.state);
    setFlash("Audio performance approved against the measured audio bundle. Rendering is now unlocked.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("discoverMusicButton").addEventListener("click", async () => {
  try {
    const topicOverride = document.getElementById("musicDiscoveryTopic").value.trim();
    const studioId = latestState?.brief?.studio_id || document.getElementById("studioSelect").value;
    const params = new URLSearchParams({ studio_id: studioId, limit: "5" });
    if (topicOverride) params.set("topic", topicOverride);
    setFlash(`Searching online for five ${studioId.replaceAll("_", " ")} music candidates...`);
    const result = await request(`/api/music-discovery?${params.toString()}`);
    renderMusicDiscovery(result);
    setFlash(result.discovery?.issues?.length
      ? result.discovery.issues.join(" ")
      : `Found ${result.discovery?.candidates?.length || 0} themed music candidates for ${studioId.replaceAll("_", " ")}.`);
  } catch (error) {
    document.getElementById("musicDiscoveryJson").textContent = JSON.stringify(error.payload || { error: error.message }, null, 2);
    document.getElementById("musicDiscoveryList").innerHTML = '<div class="artifact-item"><span>Music discovery failed.</span></div>';
    setFlash(error.message, true);
  }
});

document.getElementById("registerAudioAssetButton").addEventListener("click", async () => {
  try {
    if (!latestState?.episode?.episode_id) throw new Error("Generate or select an episode first.");
    const result = await request("/api/audio-system/import", {
      method: "POST",
      body: JSON.stringify({
        episode_id: latestState.episode.episode_id,
        relative_path: document.getElementById("audioAssetPath").value.trim(),
        scene_id: document.getElementById("audioAssetScene").value.trim(),
        creator: document.getElementById("audioAssetCreator").value.trim(),
        licence: document.getElementById("audioAssetLicence").value.trim(),
        rights_status: "cleared",
        actor: "local-editor"
      })
    });
    document.getElementById("audioApprovalJson").textContent = JSON.stringify(result.import, null, 2);
    setFlash("Licensed scene performance registered. Rebuild audio to consume it and renew the audio approval.");
  } catch (error) {
    document.getElementById("audioApprovalJson").textContent = JSON.stringify(error.payload || { error: error.message }, null, 2);
    setFlash(error.message, true);
  }
});

function readVisualAssetRecord() {
  return {
    asset_id: `visual_asset_${Date.now()}`,
    relative_path: document.getElementById("visualAssetPath").value.trim(),
    scene_id: document.getElementById("visualAssetScene").value.trim() || null,
    creator: document.getElementById("visualAssetCreator").value.trim() || null,
    licence: document.getElementById("visualAssetLicence").value.trim() || null,
    rights_status: "cleared",
    generated_by: "human_import",
    replaces_asset_id: document.getElementById("visualAssetReplaces").value.trim() || null,
    synthetic: false,
    disclosure_required: false
  };
}

document.getElementById("validateVisualAssetButton").addEventListener("click", async () => {
  try {
    const result = await request("/api/visual-assets/validate", { method: "POST", body: JSON.stringify({ asset: readVisualAssetRecord() }) });
    document.getElementById("visualAssetValidationJson").textContent = JSON.stringify(result.validation, null, 2);
    setFlash(result.validation.passed ? "Rights and provenance record passed." : "The asset record still has unresolved rights fields.", !result.validation.passed);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("registerVisualAssetButton").addEventListener("click", async () => {
  try {
    if (!latestState?.episode?.episode_id) throw new Error("Generate or select an episode before registering a visual replacement.");
    const asset = readVisualAssetRecord();
    const result = await request("/api/visual-assets/register", {
      method: "POST",
      body: JSON.stringify({ ...asset, episode_id: latestState.episode.episode_id, actor: "local-editor" })
    });
    document.getElementById("visualAssetValidationJson").textContent = JSON.stringify({ asset: result.asset, visual_report: result.visual_report }, null, 2);
    renderState(result.state);
    setFlash(`Registered ${result.asset.relative_path}. The previous editorial approval was invalidated and must be renewed.`);
  } catch (error) {
    document.getElementById("visualAssetValidationJson").textContent = JSON.stringify(error.payload?.validation || { error: error.message }, null, 2);
    setFlash(error.message, true);
  }
});

document.getElementById("connectorSelect").addEventListener("change", async (event) => {
  renderConnectorRegistry(installedConnectors);
  await loadConnectorDefaults(event.target.value);
});

document.getElementById("testConnectorButton").addEventListener("click", async () => {
  try {
    const connectorId = document.getElementById("connectorSelect").value;
    const input = parseJsonValue(document.getElementById("connectorInputEditor").value, {});
    setFlash(`Testing ${connectorId} through its guarded adapter...`);
    const result = await request("/api/connectors/test", { method: "POST", body: JSON.stringify({ connector_id: connectorId, input, actor: "local-editor" }) });
    document.getElementById("connectorRunJson").textContent = JSON.stringify(result.run, null, 2);
    await refresh();
    setFlash(`${connectorId} test completed with ${result.run.sources.length} source(s), ${result.run.candidates.length} candidate(s), and ${result.run.analytics.length} analytics row(s).`);
  } catch (error) {
    document.getElementById("connectorRunJson").textContent = JSON.stringify(error.payload?.run || { error: error.message }, null, 2);
    setFlash(error.message, true);
  }
});

document.getElementById("runConnectorButton").addEventListener("click", async () => {
  try {
    const connectorId = document.getElementById("connectorSelect").value;
    const input = parseJsonValue(document.getElementById("connectorInputEditor").value, {});
    const studioId = document.getElementById("studioSelect").value;
    const definition = installedConnectors.find((item) => item.connector_id === connectorId);
    const persistCandidates = Boolean(definition?.capabilities.includes("topic_discovery"));
    const result = await request("/api/connectors/run", { method: "POST", body: JSON.stringify({ connector_id: connectorId, input, studio_id: studioId, persist_candidates: persistCandidates, actor: "local-editor" }) });
    document.getElementById("connectorRunJson").textContent = JSON.stringify(result, null, 2);
    await refresh();
    setFlash(`${connectorId} run persisted. ${persistCandidates ? "Any valid candidates entered the selected studio backlog." : "Evidence is available for a research plan."}`);
  } catch (error) {
    document.getElementById("connectorRunJson").textContent = JSON.stringify(error.payload?.run || { error: error.message }, null, 2);
    setFlash(error.message, true);
  }
});

document.getElementById("loadConnectorTemplateButton").addEventListener("click", () => {
  document.getElementById("connectorDefinitionEditor").value = JSON.stringify(connectorTemplate(), null, 2);
  document.getElementById("connectorValidationJson").textContent = "RSS template loaded. Replace the ID, name, feed URL, and allowlisted host.";
});

document.getElementById("validateConnectorButton").addEventListener("click", async () => {
  try {
    const definition = parseJsonValue(document.getElementById("connectorDefinitionEditor").value);
    const result = await request("/api/connectors/validate", { method: "POST", body: JSON.stringify({ connector: definition }) });
    document.getElementById("connectorValidationJson").textContent = JSON.stringify(result.validation, null, 2);
    setFlash(`Connector definition passed with content hash ${result.validation.content_hash.slice(0, 12)}…`);
  } catch (error) {
    document.getElementById("connectorValidationJson").textContent = JSON.stringify(error.payload?.validation || { error: error.message }, null, 2);
    setFlash(error.message, true);
  }
});

document.getElementById("installConnectorButton").addEventListener("click", async () => {
  try {
    const definition = parseJsonValue(document.getElementById("connectorDefinitionEditor").value);
    const result = await request("/api/connectors/install", { method: "POST", body: JSON.stringify({ connector: definition, actor: "local-editor" }) });
    installedConnectors = result.connectors;
    populateConnectorSelects(installedConnectors);
    document.getElementById("connectorSelect").value = definition.connector.id;
    renderConnectorRegistry(installedConnectors);
    document.getElementById("connectorValidationJson").textContent = JSON.stringify(result.validation, null, 2);
    await loadConnectorDefaults(definition.connector.id);
    setFlash(`${definition.connector.name} installed as a declarative connector. No arbitrary code was accepted.`);
  } catch (error) {
    document.getElementById("connectorValidationJson").textContent = JSON.stringify(error.payload?.validation || { error: error.message }, null, 2);
    setFlash(error.message, true);
  }
});

document.getElementById("bootstrapReviewButton").addEventListener("click", async () => {
  try {
    if (!latestState?.episode?.episode_id) throw new Error("Generate or select an episode first.");
    const result = await request("/api/editorial-cockpit/bootstrap", { method: "POST", body: JSON.stringify({ episode_id: latestState.episode.episode_id, actor: document.getElementById("reviewerName").value || "local-editor" }) });
    latestState = result.state || latestState; renderEditorialCockpit(result.cockpit);
    setFlash("Role-based review queue built from the current artifact hashes.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("reviewRoleFilter").addEventListener("change", () => renderEditorialCockpit(latestEditorialCockpit));

document.getElementById("reviewQueueList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-review-action]");
  if (!button) return;
  try {
    const reviewer = document.getElementById("reviewerName").value.trim() || "local-editor";
    const taskId = button.dataset.taskId;
    if (button.dataset.reviewAction === "assign") {
      const result = await request("/api/editorial-cockpit/assign", { method: "POST", body: JSON.stringify({ task_id: taskId, assignee: reviewer, actor: reviewer }) });
      renderEditorialCockpit(result.cockpit); setFlash(`Review task assigned to ${reviewer}.`); return;
    }
    const result = await request("/api/editorial-cockpit/decision", { method: "POST", body: JSON.stringify({ task_id: taskId, reviewer, decision: button.dataset.reviewAction, notes: button.dataset.reviewAction === "approved" ? "Artifact bundle reviewed in the Phase 10 cockpit." : "Corrections requested through the review queue." }) });
    renderEditorialCockpit(result.cockpit);
    setFlash(button.dataset.reviewAction === "approved" ? "Review decision bound to the current artifact hash." : "Changes requested. The task remains open.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("addReviewCommentButton").addEventListener("click", async () => {
  try {
    const reviewer = document.getElementById("reviewerName").value.trim() || "local-editor";
    const result = await request("/api/editorial-cockpit/comment", { method: "POST", body: JSON.stringify({ task_id: document.getElementById("reviewCommentTask").value, scene_id: document.getElementById("reviewCommentScene").value, timeline_seconds: document.getElementById("reviewCommentTime").value, severity: document.getElementById("reviewCommentSeverity").value, body: document.getElementById("reviewCommentBody").value, author: reviewer }) });
    document.getElementById("reviewCommentBody").value = "";
    renderEditorialCockpit(result.cockpit); setFlash("Review comment bound to the current task and artifact hash.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("reviewCommentsList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-resolve-comment]");
  if (!button) return;
  try {
    const result = await request("/api/editorial-cockpit/comment/resolve", { method: "POST", body: JSON.stringify({ comment_id: button.dataset.resolveComment, resolved_by: document.getElementById("reviewerName").value || "local-editor" }) });
    renderEditorialCockpit(result.cockpit); setFlash("Review comment resolved and retained in the audit history.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("captureSnapshotButton").addEventListener("click", async () => {
  try {
    if (!latestState?.episode?.episode_id) throw new Error("Generate or select an episode first.");
    const result = await request("/api/editorial-cockpit/snapshot", { method: "POST", body: JSON.stringify({ episode_id: latestState.episode.episode_id, snapshot_type: "manual_editorial_checkpoint", created_by: document.getElementById("reviewerName").value || "local-editor" }) });
    renderEditorialCockpit(result.cockpit); setFlash(`Version snapshot captured: ${result.snapshot.bundle_hash.slice(0, 14)}…`);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("compareSnapshotsButton").addEventListener("click", async () => {
  try {
    const left = document.getElementById("leftSnapshot").value; const right = document.getElementById("rightSnapshot").value;
    if (!left || !right) throw new Error("Capture at least two snapshots to compare versions.");
    const result = await request(`/api/editorial-cockpit/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
    document.getElementById("snapshotComparisonJson").textContent = JSON.stringify(result.comparison, null, 2);
    setFlash(`${result.comparison.changed_count} artifact change(s) found between snapshots.`);
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("finalSignoffButton").addEventListener("click", async () => {
  try {
    if (!latestState?.episode?.episode_id) throw new Error("Generate or select an episode first.");
    const reviewer = document.getElementById("reviewerName").value.trim() || "channel-owner";
    const result = await request("/api/editorial-cockpit/final-signoff", { method: "POST", body: JSON.stringify({ episode_id: latestState.episode.episode_id, reviewer, notes: "All specialist review queues, blocking comments, current approvals, final programme, captions, and thumbnail reviewed." }) });
    latestState = result.state || latestState; renderEditorialCockpit(result.cockpit);
    setFlash("Final accountable sign-off recorded. Any later artifact drift will invalidate it.");
  } catch (error) { setFlash(error.message, true); }
});


async function runPublishingAction(path, body, successMessage) {
  if (!latestState?.episode?.episode_id) throw new Error("Generate or select an episode first.");
  const result = await request(path, { method: "POST", body: JSON.stringify({ episode_id: latestState.episode.episode_id, actor: document.getElementById("reviewerName").value.trim() || "local-publisher", ...(body || {}) }) });
  latestState = result.state || latestState;
  if (result.cockpit) renderEditorialCockpit(result.cockpit);
  renderState(latestState);
  await refreshPublishingSystem();
  setFlash(successMessage);
  return result;
}

document.getElementById("publishingPreflightButton").addEventListener("click", async () => {
  try {
    await runPublishingAction("/api/publishing-system/preflight", publishingPayload(), "Publishing metadata and local compliance evidence were rebuilt. Publisher review and final sign-off must now cover this exact package.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("publishingUploadButton").addEventListener("click", async () => {
  try {
    await runPublishingAction("/api/publishing-system/upload", {}, "Private resumable upload completed and the returned video ID was recorded.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("publishingPollButton").addEventListener("click", async () => {
  try {
    await runPublishingAction("/api/publishing-system/poll", { max_attempts: 1, interval_ms: 0 }, "YouTube processing status was polled and persisted.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("publishingAssetsButton").addEventListener("click", async () => {
  try {
    await runPublishingAction("/api/publishing-system/assets", {}, "Approved captions and thumbnail were attached to the processed private video.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("publishingVerifyButton").addEventListener("click", async () => {
  try {
    await runPublishingAction("/api/publishing-system/verify", {}, "Remote privacy, metadata, declarations, processing, captions, and thumbnail were verified.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("publishingScheduleButton").addEventListener("click", async () => {
  try {
    const confirmation = document.getElementById("publishingScheduleConfirmation").value.trim();
    const payload = publishingPayload();
    await runPublishingAction("/api/publishing-system/schedule", { confirmation, publish_at: payload.publishAt }, "The verified private video was scheduled using the exact reviewed publication time.");
  } catch (error) { setFlash(error.message, true); }
});

document.getElementById("calendarStart").value = new Date().toISOString().slice(0, 10);
refresh().catch((error) => setFlash(error.message, true));
