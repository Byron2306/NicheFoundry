const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) || path.resolve(parent) === path.resolve(candidate);
}

function safeResolve(parent, relativePath) {
  const candidate = path.resolve(parent, relativePath);
  if (!isWithin(parent, candidate)) {
    throw new Error(`Unsafe artifact path: ${relativePath}`);
  }
  return candidate;
}

function baseEvidence(episodeDir, name, relativePath, kind) {
  const absolutePath = safeResolve(episodeDir, relativePath);
  const exists = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
  const sizeBytes = exists ? fs.statSync(absolutePath).size : 0;
  return {
    name,
    relative_path: relativePath,
    kind,
    absolute_path: absolutePath,
    exists,
    size_bytes: sizeBytes,
    sha256: exists && sizeBytes > 0 ? sha256File(absolutePath) : null,
    verified: false,
    verification: {
      checked_at: new Date().toISOString(),
      reasons: exists ? [] : ["file_missing"]
    }
  };
}

function verifyJsonArtifact(episodeDir, name, relativePath) {
  const artifact = baseEvidence(episodeDir, name, relativePath, "json");
  if (!artifact.exists || artifact.size_bytes === 0) {
    if (artifact.exists) artifact.verification.reasons.push("file_empty");
    return artifact;
  }
  try {
    JSON.parse(fs.readFileSync(artifact.absolute_path, "utf8"));
    artifact.verified = true;
    artifact.verification.json_parse = "passed";
  } catch (error) {
    artifact.verification.reasons.push("invalid_json");
    artifact.verification.error = error.message;
  }
  return artifact;
}

function verifyTextArtifact(episodeDir, name, relativePath, kind = "text") {
  const artifact = baseEvidence(episodeDir, name, relativePath, kind);
  if (!artifact.exists || artifact.size_bytes === 0) {
    if (artifact.exists) artifact.verification.reasons.push("file_empty");
    return artifact;
  }
  const content = fs.readFileSync(artifact.absolute_path, "utf8").trim();
  if (!content) {
    artifact.verification.reasons.push("content_empty");
    return artifact;
  }
  artifact.verified = true;
  artifact.verification.non_empty_text = "passed";
  return artifact;
}

function verifyCaptions(episodeDir, name, relativePath) {
  const artifact = verifyTextArtifact(episodeDir, name, relativePath, "captions");
  if (!artifact.verified) return artifact;
  const content = fs.readFileSync(artifact.absolute_path, "utf8");
  const hasSequence = /^\s*1\s*$/m.test(content);
  const hasTimestamp = /\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(content);
  artifact.verified = hasSequence && hasTimestamp;
  artifact.verification.sequence_marker = hasSequence ? "passed" : "failed";
  artifact.verification.timestamp_format = hasTimestamp ? "passed" : "failed";
  if (!artifact.verified) artifact.verification.reasons.push("invalid_caption_format");
  return artifact;
}

function verifyImage(episodeDir, name, relativePath) {
  const artifact = baseEvidence(episodeDir, name, relativePath, "image");
  if (!artifact.exists || artifact.size_bytes < 32) {
    if (artifact.exists) artifact.verification.reasons.push("image_too_small");
    return artifact;
  }
  const header = fs.readFileSync(artifact.absolute_path).subarray(0, 12);
  const png = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const webp = header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WEBP";
  artifact.verified = png || jpg || webp;
  artifact.verification.signature = png ? "png" : jpg ? "jpeg" : webp ? "webp" : "unknown";
  if (!artifact.verified) artifact.verification.reasons.push("unrecognised_image_signature");
  return artifact;
}

function verifyVideo(episodeDir, name, relativePath) {
  const artifact = baseEvidence(episodeDir, name, relativePath, "video");
  if (!artifact.exists || artifact.size_bytes < 1024) {
    if (artifact.exists) artifact.verification.reasons.push("video_too_small");
    return artifact;
  }
  const probe = spawnSync(
    process.env.FFPROBE_BIN || "ffprobe",
    ["-v", "error", "-show_entries", "format=duration,format_name:stream=index,codec_type,codec_name,width,height", "-of", "json", artifact.absolute_path],
    { encoding: "utf8", timeout: 15000 }
  );
  if (probe.error || probe.status !== 0) {
    artifact.verification.reasons.push("ffprobe_failed");
    artifact.verification.error = probe.error?.message || probe.stderr?.trim() || `exit_${probe.status}`;
    return artifact;
  }
  try {
    const parsed = JSON.parse(probe.stdout);
    const streams = parsed.streams || [];
    const hasVideo = streams.some((stream) => stream.codec_type === "video");
    const hasAudio = streams.some((stream) => stream.codec_type === "audio");
    const duration = Number(parsed.format?.duration || 0);
    artifact.verified = hasVideo && hasAudio && duration > 0;
    artifact.verification.ffprobe = {
      status: "passed",
      duration_seconds: duration,
      format_name: parsed.format?.format_name || null,
      has_video: hasVideo,
      has_audio: hasAudio,
      streams
    };
    if (!hasVideo) artifact.verification.reasons.push("video_stream_missing");
    if (!hasAudio) artifact.verification.reasons.push("audio_stream_missing");
    if (!(duration > 0)) artifact.verification.reasons.push("duration_invalid");
  } catch (error) {
    artifact.verification.reasons.push("ffprobe_json_invalid");
    artifact.verification.error = error.message;
  }
  return artifact;
}


function verifySourcesArtifact(episodeDir, name = "sources.json", relativePath = "sources.json") {
  const artifact = verifyJsonArtifact(episodeDir, name, relativePath);
  if (!artifact.verified) return artifact;
  const sources = JSON.parse(fs.readFileSync(artifact.absolute_path, "utf8"));
  const valid = Array.isArray(sources) && sources.length > 0 && sources.every((source) =>
    source && source.source_id && source.title && source.source_url && source.content_hash &&
    source.retrieved_at && typeof source.extract === "string" && source.extract.trim().length >= 40
  );
  artifact.verified = valid;
  artifact.verification.source_count = Array.isArray(sources) ? sources.length : 0;
  artifact.verification.required_fields = valid ? "passed" : "failed";
  if (!valid) artifact.verification.reasons.push("invalid_source_packet");
  return artifact;
}

function verifyClaimsArtifact(episodeDir, name = "claims.json", relativePath = "claims.json") {
  const artifact = verifyJsonArtifact(episodeDir, name, relativePath);
  if (!artifact.verified) return artifact;
  const claims = JSON.parse(fs.readFileSync(artifact.absolute_path, "utf8"));
  const allowedStatuses = new Set(["supported", "weakly_supported", "disputed", "outdated", "inferred", "speculative", "rejected", "expert_review"]);
  const valid = Array.isArray(claims) && claims.length > 0 && claims.every((claim) =>
    claim && claim.claim_id && claim.source_id && claim.claim && claim.supporting_passage &&
    allowedStatuses.has(claim.status || "supported") && Number(claim.confidence) > 0
  );
  artifact.verified = valid;
  artifact.verification.claim_count = Array.isArray(claims) ? claims.length : 0;
  artifact.verification.required_fields = valid ? "passed" : "failed";
  if (!valid) artifact.verification.reasons.push("invalid_claim_ledger");
  return artifact;
}


function verifyAudio(episodeDir, name, relativePath) {
  const artifact = baseEvidence(episodeDir, name, relativePath, "audio");
  if (!artifact.exists || artifact.size_bytes < 128) {
    if (artifact.exists) artifact.verification.reasons.push("audio_too_small");
    return artifact;
  }
  const probe = spawnSync(process.env.FFPROBE_BIN || "ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,sample_rate,channels", "-of", "json", artifact.absolute_path], { encoding: "utf8", timeout: 15000 });
  if (probe.error || probe.status !== 0) {
    artifact.verification.reasons.push("ffprobe_failed");
    artifact.verification.error = probe.error?.message || probe.stderr?.trim() || `exit_${probe.status}`;
    return artifact;
  }
  try {
    const parsed = JSON.parse(probe.stdout);
    const audio = (parsed.streams || []).find((stream) => stream.codec_type === "audio");
    const duration = Number(parsed.format?.duration || 0);
    artifact.verified = Boolean(audio && duration > 0);
    artifact.verification.ffprobe = { status: "passed", duration_seconds: duration, stream: audio || null };
    if (!audio) artifact.verification.reasons.push("audio_stream_missing");
    if (!(duration > 0)) artifact.verification.reasons.push("duration_invalid");
  } catch (error) {
    artifact.verification.reasons.push("ffprobe_json_invalid");
    artifact.verification.error = error.message;
  }
  return artifact;
}

function verifyAudioAssetHashes(episodeDir, name = "audio_asset_hashes.json", relativePath = "audio_asset_hashes.json") {
  const artifact = verifyJsonArtifact(episodeDir, name, relativePath);
  if (!artifact.verified) return artifact;
  const payload = JSON.parse(fs.readFileSync(artifact.absolute_path, "utf8"));
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const checks = assets.map((entry) => {
    let absolutePath;
    try { absolutePath = safeResolve(episodeDir, entry.relative_path); }
    catch (_error) { return { ...entry, verified: false, reason: "unsafe_path" }; }
    const exists = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
    const sha256 = exists ? sha256File(absolutePath) : null;
    return { ...entry, verified: Boolean(exists && entry.sha256 && sha256 === entry.sha256), actual_sha256: sha256, reason: exists ? (sha256 === entry.sha256 ? null : "hash_mismatch") : "file_missing" };
  });
  artifact.verified = Boolean(payload.complete && assets.length > 0 && checks.every((entry) => entry.verified));
  artifact.verification.asset_count = assets.length;
  artifact.verification.verified_asset_count = checks.filter((entry) => entry.verified).length;
  artifact.verification.assets = checks;
  if (!artifact.verified) artifact.verification.reasons.push("audio_asset_hash_verification_failed");
  return artifact;
}

function verifyVisualAssetHashes(episodeDir, name = "visual_asset_hashes.json", relativePath = "visual_asset_hashes.json") {
  const artifact = verifyJsonArtifact(episodeDir, name, relativePath);
  if (!artifact.verified) return artifact;
  const payload = JSON.parse(fs.readFileSync(artifact.absolute_path, "utf8"));
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const checks = assets.map((entry) => {
    let absolutePath;
    try { absolutePath = safeResolve(episodeDir, entry.relative_path); }
    catch (error) { return { ...entry, verified: false, reason: "unsafe_path" }; }
    const exists = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
    const sha256 = exists ? sha256File(absolutePath) : null;
    return { ...entry, verified: Boolean(exists && entry.sha256 && sha256 === entry.sha256), actual_sha256: sha256, reason: exists ? (sha256 === entry.sha256 ? null : "hash_mismatch") : "file_missing" };
  });
  artifact.verified = Boolean(payload.complete && assets.length > 0 && checks.every((entry) => entry.verified));
  artifact.verification.asset_count = assets.length;
  artifact.verification.verified_asset_count = checks.filter((entry) => entry.verified).length;
  artifact.verification.assets = checks;
  if (!artifact.verified) artifact.verification.reasons.push("visual_asset_hash_verification_failed");
  return artifact;
}


function verifyRenderAssetHashes(episodeDir, name = "render_asset_hashes.json", relativePath = "render_asset_hashes.json") {
  const artifact = verifyJsonArtifact(episodeDir, name, relativePath);
  if (!artifact.verified) return artifact;
  const payload = JSON.parse(fs.readFileSync(artifact.absolute_path, "utf8"));
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const checks = assets.map((entry) => {
    let absolutePath;
    try { absolutePath = safeResolve(episodeDir, entry.relative_path); }
    catch (_error) { return { ...entry, verified: false, reason: "unsafe_path" }; }
    const exists = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
    const sha256 = exists ? sha256File(absolutePath) : null;
    return { ...entry, exists, current_sha256: sha256, verified: Boolean(exists && entry.sha256 && sha256 === entry.sha256), reason: !exists ? "file_missing" : (sha256 === entry.sha256 ? null : "hash_mismatch") };
  });
  artifact.verified = Boolean(payload.complete && assets.length >= 3 && checks.every((entry) => entry.verified));
  artifact.verification.asset_count = assets.length;
  artifact.verification.verified_asset_count = checks.filter((entry) => entry.verified).length;
  artifact.verification.assets = checks;
  if (!artifact.verified) artifact.verification.reasons.push("render_asset_hash_verification_failed");
  return artifact;
}

function inspectEpisodeArtifacts(episodeDir, manifestOutput = {}) {
  const expectedJson = [
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
    "thumbnail_plan.json",
    "visual_similarity_report.json",
    "visual_report.json",
    "host_profile.json",
    "pronunciation_lexicon.json",
    "audio_performance_plan.json",
    "sound_design_plan.json",
    "audio_preflight_report.json",
    "audio_manifest.json",
    "audio_asset_hashes.json",
    "loudness_report.json",
    "audio_performance_report.json",
    "audio_approval_bundle.json",
    "render_plan.json",
    "caption_track.json",
    "render_manifest_v2.json",
    "render_asset_hashes.json",
    "render_qa_report.json",
    "render_approval_bundle.json",
    "editorial_review_manifest.json",
    "review_dependency_map.json",
    "review_snapshot.json",
    "final_signoff_bundle.json",
    "publishing_package.json",
    "metadata_package.json",
    "compliance_report.json",
    "youtube_upload_receipt.json",
    "youtube_processing_report.json",
    "youtube_asset_uploads.json",
    "publishing_verification.json",
    "release_approval_bundle.json",
    "connector_runs.json",
    "episode.json",
    "verification.json",
    "research_report.json",
    "duplicate_report.json",
    "approval_bundle.json",
    "visual_manifest.json",
    "narration_manifest.json",
    "script_manifest.json",
    "render_manifest.json",
    "youtube_upload.json",
    "integration_runs.json"
  ];
  const artifacts = expectedJson.map((name) => verifyJsonArtifact(episodeDir, name, name));
  artifacts.push(verifyVisualAssetHashes(episodeDir));
  artifacts.push(verifyAudioAssetHashes(episodeDir));
  artifacts.push(verifyRenderAssetHashes(episodeDir));
  artifacts.push(verifyAudio(episodeDir, "audio/episode_audio_preview.mp3", "audio/episode_audio_preview.mp3"));
  artifacts.push(verifySourcesArtifact(episodeDir));
  artifacts.push(verifyClaimsArtifact(episodeDir));
  artifacts.push(verifyTextArtifact(episodeDir, "script.md", "script.md", "markdown"));
  artifacts.push(verifyTextArtifact(episodeDir, "gamma_input.md", "gamma_input.md", "markdown"));
  artifacts.push(verifyTextArtifact(episodeDir, "approval_checklist.md", "approval_checklist.md", "markdown"));
  artifacts.push(verifyTextArtifact(episodeDir, "editorial_audit_export.md", "editorial_audit_export.md", "markdown"));

  const videoName = manifestOutput.video || "final.mp4";
  const captionsName = manifestOutput.captions || "captions.srt";
  const thumbnailName = manifestOutput.thumbnail || "thumbnail.png";
  artifacts.push(verifyVideo(episodeDir, videoName, videoName));
  artifacts.push(verifyCaptions(episodeDir, captionsName, captionsName));
  artifacts.push(verifyImage(episodeDir, thumbnailName, thumbnailName));
  return artifacts;
}

function deriveQa(packet, artifacts) {
  const byName = Object.fromEntries(artifacts.map((artifact) => [artifact.name, artifact]));
  const manifestOutput = packet.render_manifest_output || {
    video: "final.mp4",
    captions: "captions.srt",
    thumbnail: "thumbnail.png"
  };
  const video = byName[manifestOutput.video];
  const captions = byName[manifestOutput.captions];
  const thumbnail = byName[manifestOutput.thumbnail];
  const opportunityPassed = packet.verification?.opportunity_intelligence?.passed !== false;
  const audienceStrategyPassed = Boolean(packet.verification?.audience_strategy?.passed && packet.audience_fit_report?.passed);
  const studioPolicyPassed = Boolean(packet.verification?.studio_policy?.passed && packet.studio_fit_report?.passed);
  const researchGovernancePassed = packet.verification?.research_governance?.passed !== false;
  const storyEnginePassed = Boolean(packet.verification?.story_engine?.passed && packet.story_report?.passed);
  const visualSystemPassed = Boolean(packet.verification?.visual_system?.passed && packet.visual_report?.passed);
  const audioPreflightPassed = Boolean(packet.verification?.audio_performance?.passed && packet.audio_preflight_report?.passed);
  const deterministicPassed = Boolean(packet.verification?.deterministic_validation?.passed);
  const editorialPassed = Boolean(packet.verification?.editorial_audit?.passed);
  const duplicatePassed = Boolean(packet.verification?.duplicate_and_safety?.passed);
  const editorialEvidenceCurrent = packet.editorial_evidence_current !== false;
  const verificationPassed = opportunityPassed && audienceStrategyPassed && studioPolicyPassed && researchGovernancePassed && storyEnginePassed && visualSystemPassed && audioPreflightPassed && deterministicPassed && editorialPassed && duplicatePassed && editorialEvidenceCurrent;
  const approvalSupplied = Boolean(packet.approved && packet.approval?.artifact_hash);
  const renderQaPassed = Boolean(packet.verification?.render_system?.passed && packet.render_production?.render_qa_report?.passed);
  const renderApprovalSupplied = Boolean(packet.render_approved && packet.render_approval?.valid);
  const deliveryArtifactsVerified = Boolean(video?.verified && captions?.verified && thumbnail?.verified);
  const finalSignoffSupplied = Boolean(packet.final_signed_off && packet.editorial_cockpit?.final_signoff?.valid);
  const deliveryReady = Boolean(deliveryArtifactsVerified && renderQaPassed && renderApprovalSupplied && finalSignoffSupplied);
  const publishingPreflightPassed = Boolean(packet.publishing_package?.preflight_passed);
  const privateUploadVerified = Boolean(packet.publishing_package?.remote?.verification?.passed);
  const publishingReleaseReady = Boolean(packet.publishing_package?.release_ready);

  let status = "blocked_validation_failed";
  let nextAction = !opportunityPassed
    ? "Resolve the opportunity fit, lifecycle, signal, or cannibalisation block before production."
    : !audienceStrategyPassed
      ? "Resolve the target persona, viewer job, channel promise, content pillar, output format, or repetition block before production."
    : !studioPolicyPassed
      ? "Resolve Studio Pack fit or source-hierarchy failures and regenerate the packet."
      : !researchGovernancePassed
        ? "Resolve stale, non-independent, or conflicting evidence before approval."
      : !storyEnginePassed
        ? "Resolve the hook, story-beat, evidence-binding, timing, originality, or spoken-script findings before approval."
      : !visualSystemPassed
        ? "Resolve visual identity, asset provenance, thumbnail legibility, scene coverage, or anti-template similarity findings before approval."
      : !audioPreflightPassed
        ? "Resolve host, pronunciation, pacing, sound-design, or audio preflight findings before approval."
      : !deterministicPassed
        ? "Resolve deterministic validation failures and regenerate the episode packet."
        : !editorialPassed
          ? "Resolve the independent editorial critic findings before approval."
          : !duplicatePassed
            ? "Resolve duplicate, meta-content, or safety findings before approval."
            : !editorialEvidenceCurrent
              ? "Editorial evidence changed after generation; regenerate before approval."
              : "Resolve validation failures before approval.";
  if (verificationPassed && !approvalSupplied) {
    status = "blocked_pending_human_approval";
    nextAction = "Record a hash-bound human approval before downstream production begins.";
  } else if (verificationPassed && approvalSupplied && !packet.audio_approved) {
    status = "blocked_missing_verified_delivery_artifacts";
    nextAction = packet.audio_production?.performance_report?.passed
      ? "Review and hash-approve the generated audio performance before rendering."
      : "Generate scene-level narration, mastering, and audio QA.";
  } else if (verificationPassed && approvalSupplied && packet.audio_approved && !deliveryArtifactsVerified) {
    status = "blocked_missing_verified_delivery_artifacts";
    nextAction = "Render and independently verify final.mp4, captions.srt, and thumbnail.png.";
  } else if (verificationPassed && approvalSupplied && packet.audio_approved && deliveryArtifactsVerified && !renderQaPassed) {
    status = "blocked_render_qa_failed";
    nextAction = "Resolve compositor, duration, stream, caption, black-frame, or thumbnail QA findings.";
  } else if (verificationPassed && approvalSupplied && packet.audio_approved && renderQaPassed && !renderApprovalSupplied) {
    status = "blocked_pending_render_approval";
    nextAction = "Review the finished programme and hash-approve the render bundle before upload.";
  } else if (verificationPassed && approvalSupplied && packet.audio_approved && deliveryArtifactsVerified && renderQaPassed && renderApprovalSupplied && !finalSignoffSupplied) {
    status = "blocked_pending_final_signoff";
    nextAction = "Complete the role-based review queue, resolve blocking comments, and record final accountable sign-off.";
  } else if (verificationPassed && approvalSupplied && packet.audio_approved && deliveryReady && !publishingPreflightPassed) {
    status = "blocked_pending_publishing_preflight";
    nextAction = "Generate and review the YouTube metadata and compliance package before upload.";
  } else if (verificationPassed && approvalSupplied && packet.audio_approved && deliveryReady && publishingPreflightPassed && !privateUploadVerified) {
    status = "ready_for_private_upload";
    nextAction = "Run the resumable private upload, wait for processing, attach captions and thumbnail, then verify the remote resource.";
  } else if (verificationPassed && approvalSupplied && packet.audio_approved && deliveryReady && publishingReleaseReady) {
    status = packet.publishing_package?.remote?.schedule?.status === "scheduled" ? "scheduled_for_publication" : "verified_private_on_youtube";
    nextAction = packet.publishing_package?.remote?.schedule?.status === "scheduled"
      ? "Retain the release audit and monitor the scheduled publication."
      : "Keep the video private for final platform review or explicitly schedule it through the guarded release control.";
  }

  return {
    status,
    final_video_exists: Boolean(video?.exists),
    final_video_verified: Boolean(video?.verified),
    captions_exist: Boolean(captions?.exists),
    captions_verified: Boolean(captions?.verified),
    thumbnail_exists: Boolean(thumbnail?.exists),
    thumbnail_verified: Boolean(thumbnail?.verified),
    verification_passed: verificationPassed,
    opportunity_intelligence_passed: opportunityPassed,
    audience_strategy_passed: audienceStrategyPassed,
    studio_policy_passed: studioPolicyPassed,
    research_governance_passed: researchGovernancePassed,
    story_engine_passed: storyEnginePassed,
    visual_system_passed: visualSystemPassed,
    audio_preflight_passed: audioPreflightPassed,
    audio_performance_passed: Boolean(packet.audio_production?.performance_report?.passed),
    audio_approval_supplied: Boolean(packet.audio_approved),
    render_qa_passed: renderQaPassed,
    render_approval_supplied: renderApprovalSupplied,
    final_signoff_supplied: finalSignoffSupplied,
    deterministic_validation_passed: deterministicPassed,
    editorial_audit_passed: editorialPassed,
    duplicate_and_safety_passed: duplicatePassed,
    editorial_evidence_current: editorialEvidenceCurrent,
    approval_supplied: approvalSupplied,
    delivery_ready: deliveryReady,
    publishing_preflight_passed: publishingPreflightPassed,
    private_upload_verified: privateUploadVerified,
    publishing_release_ready: publishingReleaseReady,
    next_action: nextAction,
    checked_at: new Date().toISOString(),
    evidence: {
      video: video ? { name: video.name, exists: video.exists, verified: video.verified, sha256: video.sha256, verification: video.verification } : null,
      captions: captions ? { name: captions.name, exists: captions.exists, verified: captions.verified, sha256: captions.sha256, verification: captions.verification } : null,
      thumbnail: thumbnail ? { name: thumbnail.name, exists: thumbnail.exists, verified: thumbnail.verified, sha256: thumbnail.sha256, verification: thumbnail.verification } : null
    }
  };
}

module.exports = {
  sha256File,
  safeResolve,
  inspectEpisodeArtifacts,
  deriveQa,
  verifyVideo,
  verifyCaptions,
  verifyImage,
  verifyJsonArtifact,
  verifySourcesArtifact,
  verifyClaimsArtifact,
  verifyVisualAssetHashes,
  verifyAudioAssetHashes,
  verifyRenderAssetHashes,
  verifyAudio
};
