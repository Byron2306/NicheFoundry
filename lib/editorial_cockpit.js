const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { safeResolve, sha256File } = require('./evidence');

const REVIEW_ROLES = Object.freeze([
  { id: 'researcher', label: 'Researcher' },
  { id: 'fact_checker', label: 'Fact Checker' },
  { id: 'writer', label: 'Writer / Script Editor' },
  { id: 'visual_editor', label: 'Visual Editor' },
  { id: 'audio_editor', label: 'Audio Editor' },
  { id: 'channel_owner', label: 'Channel Owner' },
  { id: 'publisher', label: 'Publisher' }
]);

const REVIEW_WORKFLOWS = Object.freeze([
  {
    review_type: 'source_research', stage: 'editorial', role: 'researcher', priority: 95,
    label: 'Source intake and research packet', required: false,
    artifacts: ['connector_plan.json', 'connector_runs.json', 'sources.json', 'research_report.json', 'source_hierarchy.json', 'freshness_report.json']
  },
  {
    review_type: 'research_fact', stage: 'editorial', role: 'fact_checker', priority: 90,
    label: 'Research and factual integrity', required: true,
    artifacts: ['sources.json', 'claims.json', 'research_report.json', 'source_hierarchy.json', 'freshness_report.json', 'claim_conflict_graph.json']
  },
  {
    review_type: 'script_editorial', stage: 'editorial', role: 'writer', priority: 85,
    label: 'Narrative and script edit', required: true,
    artifacts: ['narrative_blueprint.json', 'script_package.json', 'timing_plan.json', 'story_report.json', 'script.md']
  },
  {
    review_type: 'visual_editorial', stage: 'editorial', role: 'visual_editor', priority: 80,
    label: 'Visual identity, rights, and storyboard', required: true,
    artifacts: ['visual_plan.json', 'asset_provenance.json', 'visual_asset_hashes.json', 'thumbnail_plan.json', 'visual_similarity_report.json', 'visual_report.json']
  },
  {
    review_type: 'audio_preflight', stage: 'editorial', role: 'audio_editor', priority: 75,
    label: 'Host, pronunciation, and performance plan', required: true,
    artifacts: ['host_profile.json', 'pronunciation_lexicon.json', 'audio_performance_plan.json', 'sound_design_plan.json', 'audio_preflight_report.json']
  },
  {
    review_type: 'audio_performance', stage: 'audio', role: 'audio_editor', priority: 70,
    label: 'Mastered audio performance', required: true,
    dependencies: ['editorial'],
    artifacts: ['audio_manifest.json', 'audio_asset_hashes.json', 'loudness_report.json', 'audio_performance_report.json', 'audio/episode_audio_preview.mp3']
  },
  {
    review_type: 'render_programme', stage: 'render', role: 'channel_owner', priority: 65,
    label: 'Finished programme watch-through', required: true,
    dependencies: ['editorial', 'audio'],
    artifacts: ['render_plan.json', 'render_manifest_v2.json', 'render_asset_hashes.json', 'render_qa_report.json', 'final.mp4', 'captions.srt', 'thumbnail.png']
  },
  {
    review_type: 'release_compliance', stage: 'release', role: 'publisher', priority: 60,
    label: 'Release metadata and compliance sign-off', required: true,
    dependencies: ['editorial', 'audio', 'render'],
    artifacts: ['approval_bundle.json', 'audio_approval_bundle.json', 'render_approval_bundle.json', 'publishing_package.json', 'metadata_package.json', 'compliance_report.json', 'final.mp4', 'captions.srt', 'thumbnail.png']
  }
]);

const SNAPSHOT_ARTIFACTS = Object.freeze(Array.from(new Set(REVIEW_WORKFLOWS.flatMap((workflow) => workflow.artifacts))));

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Value(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function artifactState(episodeDir, relativePath) {
  let absolutePath;
  try { absolutePath = safeResolve(episodeDir, relativePath); }
  catch (_error) { return { relative_path: relativePath, exists: false, sha256: null, size_bytes: 0, error: 'unsafe_path' }; }
  const exists = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
  return {
    relative_path: relativePath,
    exists,
    sha256: exists ? sha256File(absolutePath) : null,
    size_bytes: exists ? fs.statSync(absolutePath).size : 0
  };
}

function taskArtifactBundle(episodeDir, workflow) {
  const artifacts = workflow.artifacts.map((name) => artifactState(episodeDir, name));
  return {
    artifacts,
    complete: artifacts.every((item) => item.exists && item.sha256),
    artifact_hash: sha256Value(artifacts.map(({ relative_path, exists, sha256 }) => ({ relative_path, exists, sha256 })))
  };
}

function workflowReady(workflow, packet, bundle) {
  if (!bundle.complete) return false;
  if (workflow.stage === 'editorial') return Boolean(packet.verification?.editorial_audit?.passed && packet.editorial_evidence_current !== false);
  if (workflow.stage === 'audio') return Boolean(packet.approved && packet.audio_production?.performance_report?.passed);
  if (workflow.stage === 'render') return Boolean(packet.audio_approved && packet.render_production?.render_qa_report?.passed && packet.render_production?.render_qa_report?.output === 'final.mp4');
  if (workflow.stage === 'release') return Boolean(packet.approved && packet.audio_approved && packet.render_approved && packet.render_production?.render_qa_report?.passed);
  return false;
}

function buildReviewTasks({ episodeId, episodeDir, packet, existingTasks = [] }) {
  const existingByType = new Map(existingTasks.map((task) => [task.review_type, task]));
  return REVIEW_WORKFLOWS.map((workflow) => {
    const bundle = taskArtifactBundle(episodeDir, workflow);
    const previous = existingByType.get(workflow.review_type);
    const changed = Boolean(previous?.artifact_hash && previous.artifact_hash !== bundle.artifact_hash);
    const ready = workflowReady(workflow, packet, bundle);
    let status = previous?.status || 'pending';
    if (changed) status = ready ? 'ready' : 'blocked';
    else if (status === 'pending' || status === 'blocked' || status === 'ready') status = ready ? 'ready' : 'blocked';
    return {
      task_id: `${episodeId}:${workflow.review_type}`,
      episode_id: episodeId,
      review_type: workflow.review_type,
      stage: workflow.stage,
      role: workflow.role,
      label: workflow.label,
      priority: workflow.priority,
      required: workflow.required,
      dependencies: workflow.dependencies || [],
      artifact_hash: bundle.artifact_hash,
      artifacts: bundle.artifacts,
      artifacts_complete: bundle.complete,
      ready,
      status,
      assignee: previous?.assignee || null,
      due_at: previous?.due_at || null,
      version_changed: changed,
      completed_at: status === 'approved' && !changed ? previous?.completed_at || null : null
    };
  });
}

function buildQueues(tasks) {
  return REVIEW_ROLES.map((role) => ({
    ...role,
    tasks: tasks.filter((task) => task.role === role.id).sort((a, b) => b.priority - a.priority)
  })).filter((queue) => queue.tasks.length);
}

function reviewCoverage(tasks, comments = []) {
  const required = tasks.filter((task) => task.required);
  const approved = required.filter((task) => task.status === 'approved');
  const openBlockers = comments.filter((comment) => comment.status === 'open' && comment.severity === 'blocker');
  return {
    required_count: required.length,
    approved_count: approved.length,
    ready_count: required.filter((task) => task.ready).length,
    blocked_count: required.filter((task) => task.status === 'blocked').length,
    open_blocker_count: openBlockers.length,
    passed: required.length > 0 && approved.length === required.length && openBlockers.length === 0
  };
}

function buildDependencyMap({ packet, tasks, comments = [], finalSignoff = null }) {
  const byStage = (stage) => tasks.filter((task) => task.stage === stage);
  const stageNode = (id, label, approvalValid, dependencies = []) => {
    const stageTasks = byStage(id);
    const blockers = comments.filter((comment) => comment.status === 'open' && comment.severity === 'blocker' && stageTasks.some((task) => task.task_id === comment.task_id));
    return {
      id, label, dependencies,
      approval_valid: Boolean(approvalValid),
      tasks_total: stageTasks.length,
      tasks_approved: stageTasks.filter((task) => task.status === 'approved').length,
      open_blockers: blockers.length,
      passed: Boolean(approvalValid) && stageTasks.every((task) => !task.required || task.status === 'approved') && blockers.length === 0
    };
  };
  const nodes = [
    stageNode('editorial', 'Editorial packet', packet.approved, []),
    stageNode('audio', 'Audio performance', packet.audio_approved, ['editorial']),
    stageNode('render', 'Finished programme', packet.render_approved, ['editorial', 'audio']),
    stageNode('release', 'Release compliance', finalSignoff?.valid, ['editorial', 'audio', 'render'])
  ];
  return { schema: 'nichefoundry.review_dependency_map.v1', nodes, passed: nodes.every((node) => node.passed) };
}

function captureSnapshot({ episodeId, episodeDir, snapshotType = 'manual', createdBy = 'local-editor', artifactNames = SNAPSHOT_ARTIFACTS }) {
  const artifacts = artifactNames.map((name) => artifactState(episodeDir, name));
  const manifest = {
    schema: 'nichefoundry.review_snapshot.v1',
    episode_id: episodeId,
    snapshot_type: snapshotType,
    created_by: createdBy,
    artifacts
  };
  return { ...manifest, bundle_hash: sha256Value(artifacts.map(({ relative_path, exists, sha256 }) => ({ relative_path, exists, sha256 }))) };
}

function compareSnapshots(left, right) {
  const leftMap = new Map((left?.artifacts || []).map((item) => [item.relative_path, item]));
  const rightMap = new Map((right?.artifacts || []).map((item) => [item.relative_path, item]));
  const names = Array.from(new Set([...leftMap.keys(), ...rightMap.keys()])).sort();
  const changes = names.map((name) => {
    const before = leftMap.get(name) || null;
    const after = rightMap.get(name) || null;
    let change = 'unchanged';
    if (!before && after) change = 'added';
    else if (before && !after) change = 'removed';
    else if (before?.sha256 !== after?.sha256 || before?.exists !== after?.exists) change = 'changed';
    return { relative_path: name, change, before_sha256: before?.sha256 || null, after_sha256: after?.sha256 || null };
  });
  return {
    schema: 'nichefoundry.review_snapshot_comparison.v1',
    left_snapshot_id: left?.snapshot_id || null,
    right_snapshot_id: right?.snapshot_id || null,
    changes,
    changed_count: changes.filter((item) => item.change !== 'unchanged').length
  };
}

function buildReviewManifest({ episodeId, tasks, comments, decisions, coverage, dependencyMap }) {
  return {
    schema: 'nichefoundry.editorial_review_manifest.v1',
    episode_id: episodeId,
    roles: REVIEW_ROLES,
    tasks,
    comments,
    decisions,
    coverage,
    dependency_map: dependencyMap,
    manifest_hash: sha256Value({ tasks, comments, decisions, coverage, dependencyMap })
  };
}

function buildFinalSignoffBundle({ episodeId, episodeDir, reviewer, notes = '', tasks, comments, approvals }) {
  const coverage = reviewCoverage(tasks, comments);
  const approvalMap = Object.fromEntries((approvals || []).filter((item) => item.decision === 'approved').map((item) => [item.approval_type, item]));
  const requiredApprovalTypes = ['editorial_packet', 'audio_performance', 'render_programme'];
  const approvalEvidence = requiredApprovalTypes.map((approvalType) => {
    const approval = approvalMap[approvalType];
    if (!approval) return { approval_type: approvalType, exists: false, valid: false };
    let currentHash = null;
    try {
      const artifactPath = safeResolve(episodeDir, approval.artifact_name);
      currentHash = fs.existsSync(artifactPath) ? sha256File(artifactPath) : null;
    } catch (_error) { currentHash = null; }
    return { approval_type: approvalType, approval_id: approval.approval_id, artifact_name: approval.artifact_name, artifact_hash: approval.artifact_hash, current_hash: currentHash, exists: Boolean(currentHash), valid: Boolean(currentHash && currentHash === approval.artifact_hash) };
  });
  const delivery = ['final.mp4', 'captions.srt', 'thumbnail.png'].map((name) => artifactState(episodeDir, name));
  const complete = coverage.passed && approvalEvidence.every((item) => item.valid) && delivery.every((item) => item.exists && item.sha256);
  const taskEvidence = (tasks || []).filter((task) => task.required).map((task) => ({
    task_id: task.task_id, review_type: task.review_type, stage: task.stage, role: task.role,
    status: task.status, artifact_hash: task.artifact_hash
  }));
  const openBlockers = (comments || []).filter((comment) => comment.status === 'open' && comment.severity === 'blocker')
    .map((comment) => ({ comment_id: comment.comment_id, task_id: comment.task_id, scene_id: comment.scene_id || null, timeline_seconds: comment.timeline_seconds ?? null }));
  const bundle = {
    schema: 'nichefoundry.final_signoff_bundle.v1', episode_id: episodeId, reviewer, notes,
    review_coverage: coverage,
    review_tasks: taskEvidence,
    open_blockers: openBlockers,
    approvals: approvalEvidence,
    delivery_artifacts: delivery,
    complete
  };
  return { ...bundle, bundle_hash: sha256Value(bundle) };
}

function reviewExportMarkdown({ packet, cockpit }) {
  const lines = [
    `# Editorial Review Export: ${packet.episode?.title || packet.episode?.episode_id || 'Episode'}`,
    '', `- Episode: \`${packet.episode?.episode_id || ''}\``,
    `- Studio: ${packet.episode?.studio?.name || packet.brief?.studio_id || 'Unknown'}`,
    `- Review coverage: ${cockpit.coverage.approved_count}/${cockpit.coverage.required_count}`,
    `- Open blockers: ${cockpit.coverage.open_blocker_count}`,
    `- Final sign-off: ${cockpit.final_signoff?.valid ? 'CURRENT' : 'NOT CURRENT'}`, '',
    '## Review Tasks', ''
  ];
  for (const task of cockpit.tasks) lines.push(`- **${task.label}** (${task.role}): ${task.status}  \n  Artifact hash: \`${task.artifact_hash}\``);
  lines.push('', '## Open Comments', '');
  const open = cockpit.comments.filter((item) => item.status === 'open');
  if (!open.length) lines.push('- None');
  for (const comment of open) lines.push(`- **${comment.severity.toUpperCase()}** ${comment.scene_id ? `[${comment.scene_id}] ` : ''}${comment.body}`);
  lines.push('', '## Dependency Map', '');
  for (const node of cockpit.dependency_map.nodes) lines.push(`- ${node.label}: ${node.passed ? 'PASS' : 'BLOCKED'} (${node.tasks_approved}/${node.tasks_total} reviews, ${node.open_blockers} blockers)`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  REVIEW_ROLES, REVIEW_WORKFLOWS, SNAPSHOT_ARTIFACTS,
  sha256Value, artifactState, taskArtifactBundle, buildReviewTasks, buildQueues,
  reviewCoverage, buildDependencyMap, captureSnapshot, compareSnapshots,
  buildReviewManifest, buildFinalSignoffBundle, reviewExportMarkdown
};
