const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FoundryDatabase } = require('../lib/database');
const {
  REVIEW_ROLES, REVIEW_WORKFLOWS, buildReviewTasks, buildQueues, reviewCoverage,
  buildDependencyMap, captureSnapshot, compareSnapshots, buildReviewManifest,
  buildFinalSignoffBundle
} = require('../lib/editorial_cockpit');
const { sha256File } = require('../lib/evidence');

function write(root, name, content = '{}\n') {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase10-'));
  for (const workflow of REVIEW_WORKFLOWS) {
    for (const name of workflow.artifacts) {
      if (fs.existsSync(path.join(root, name))) continue;
      if (name.endsWith('.mp4')) write(root, name, Buffer.alloc(2048, 1));
      else if (name.endsWith('.mp3')) write(root, name, Buffer.alloc(256, 2));
      else if (name.endsWith('.png')) write(root, name, Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(64)]));
      else if (name.endsWith('.srt')) write(root, name, '1\n00:00:00,000 --> 00:00:01,000\nHello\n');
      else if (name.endsWith('.md')) write(root, name, '# Reviewable\n');
      else write(root, name, JSON.stringify({ name }, null, 2));
    }
  }
  const packet = {
    episode: { episode_id: 'episode_review', title: 'Review Fixture' },
    verification: { editorial_audit: { passed: true } }, editorial_evidence_current: true,
    approved: true, audio_approved: true, render_approved: true,
    audio_production: { performance_report: { passed: true } },
    render_production: { render_qa_report: { passed: true, output: 'final.mp4' } },
    qa: { delivery_ready: false }
  };
  return { root, packet };
}

test('Phase 10 defines specialist review roles and a complete four-stage review workflow', () => {
  assert.equal(REVIEW_ROLES.length, 7);
  assert.equal(REVIEW_WORKFLOWS.length, 8);
  assert.deepEqual(new Set(REVIEW_WORKFLOWS.map((item) => item.stage)), new Set(['editorial', 'audio', 'render', 'release']));
  assert.equal(REVIEW_WORKFLOWS.filter((item) => item.required).length, 7);
  assert.ok(REVIEW_WORKFLOWS.every((item) => item.artifacts.length >= 3));
  assert.equal(REVIEW_WORKFLOWS.find((item) => item.review_type === 'source_research').required, false);
});

test('Phase 10 creates role queues and invalidates an approved task when its artifact bundle changes', () => {
  const fixture = makeFixture();
  try {
    let tasks = buildReviewTasks({ episodeId: 'episode_review', episodeDir: fixture.root, packet: fixture.packet, existingTasks: [] });
    assert.ok(tasks.every((task) => task.ready));
    assert.equal(buildQueues(tasks).length, 7);
    const scriptTask = tasks.find((task) => task.review_type === 'script_editorial');
    const approved = tasks.map((task) => task.task_id === scriptTask.task_id ? { ...task, status: 'approved', completed_at: new Date().toISOString() } : task);
    write(fixture.root, 'script.md', '# Changed after review\n');
    tasks = buildReviewTasks({ episodeId: 'episode_review', episodeDir: fixture.root, packet: fixture.packet, existingTasks: approved });
    const changed = tasks.find((task) => task.review_type === 'script_editorial');
    assert.equal(changed.version_changed, true);
    assert.equal(changed.status, 'ready');
    assert.notEqual(changed.artifact_hash, scriptTask.artifact_hash);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('Phase 10 persists tasks, assignments, comments, decisions, snapshots, and final sign-offs in SQLite', () => {
  const fixture = makeFixture();
  const dbPath = path.join(fixture.root, 'foundry.sqlite');
  const db = new FoundryDatabase(dbPath);
  try {
    db.upsertEpisode({ episode: fixture.packet.episode, episode_dir: fixture.root, qa: { status: 'review' } });
    const tasks = buildReviewTasks({ episodeId: 'episode_review', episodeDir: fixture.root, packet: fixture.packet, existingTasks: [] }).map((task) => db.upsertReviewTask(task));
    const task = tasks[0];
    db.assignReviewTask(task.task_id, 'Byron', '2026-08-10T10:00:00.000Z');
    const comment = db.addReviewComment({ comment_id: 'comment_1', task_id: task.task_id, episode_id: 'episode_review', scene_id: 'scene_1', timeline_seconds: 2.5, author: 'Byron', body: 'Verify the causal wording.', severity: 'blocker', artifact_hash: task.artifact_hash });
    assert.equal(reviewCoverage(db.listReviewTasks('episode_review'), db.listReviewComments('episode_review')).passed, false);
    db.resolveReviewComment(comment.comment_id, 'Byron');
    db.recordReviewDecision({ decisionId: 'decision_1', taskId: task.task_id, episodeId: 'episode_review', artifactHash: task.artifact_hash, reviewer: 'Byron', decision: 'approved', notes: 'Checked.' });
    assert.equal(db.getReviewTask(task.task_id).status, 'approved');
    const snap = captureSnapshot({ episodeId: 'episode_review', episodeDir: fixture.root, createdBy: 'Byron' });
    db.saveReviewSnapshot('snapshot_1', 'episode_review', 'manual', snap, 'Byron');
    assert.equal(db.listReviewSnapshots('episode_review').length, 1);
    db.recordFinalSignoff({ signoffId: 'signoff_1', episodeId: 'episode_review', artifactName: 'final_signoff_bundle.json', artifactHash: 'abc', reviewer: 'Byron', decision: 'approved' });
    assert.equal(db.listFinalSignoffs('episode_review').length, 1);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('Phase 10 snapshot comparison identifies exact changed artifacts', () => {
  const fixture = makeFixture();
  try {
    const left = { ...captureSnapshot({ episodeId: 'episode_review', episodeDir: fixture.root, createdBy: 'Byron' }), snapshot_id: 'left' };
    write(fixture.root, 'script.md', '# Revised script\n');
    write(fixture.root, 'new_note.md', '# Added\n');
    const right = { ...captureSnapshot({ episodeId: 'episode_review', episodeDir: fixture.root, createdBy: 'Byron', artifactNames: [...left.artifacts.map((item) => item.relative_path), 'new_note.md'] }), snapshot_id: 'right' };
    const comparison = compareSnapshots(left, right);
    assert.ok(comparison.changed_count >= 2);
    assert.equal(comparison.changes.find((item) => item.relative_path === 'script.md').change, 'changed');
    assert.equal(comparison.changes.find((item) => item.relative_path === 'new_note.md').change, 'added');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('Phase 10 dependency and final sign-off bundles are bound to tasks, approvals, blockers, and delivery hashes', () => {
  const fixture = makeFixture();
  try {
    const tasks = buildReviewTasks({ episodeId: 'episode_review', episodeDir: fixture.root, packet: fixture.packet, existingTasks: [] }).map((task) => ({ ...task, status: 'approved' }));
    const approvalFiles = [
      ['editorial_packet', 'approval_bundle.json'], ['audio_performance', 'audio_approval_bundle.json'], ['render_programme', 'render_approval_bundle.json']
    ];
    const approvals = approvalFiles.map(([approval_type, artifact_name], index) => ({ approval_id: `approval_${index}`, episode_id: 'episode_review', approval_type, artifact_name, artifact_hash: sha256File(path.join(fixture.root, artifact_name)), reviewer: 'Byron', decision: 'approved' }));
    const dep = buildDependencyMap({ packet: fixture.packet, tasks, comments: [], finalSignoff: { valid: true } });
    assert.equal(dep.passed, true);
    const bundle = buildFinalSignoffBundle({ episodeId: 'episode_review', episodeDir: fixture.root, reviewer: 'Byron', tasks, comments: [], approvals });
    assert.equal(bundle.complete, true);
    assert.equal(bundle.review_tasks.length, 7);
    const blocked = buildFinalSignoffBundle({ episodeId: 'episode_review', episodeDir: fixture.root, reviewer: 'Byron', tasks, comments: [{ status: 'open', severity: 'blocker', comment_id: 'b', task_id: tasks[0].task_id }], approvals });
    assert.equal(blocked.complete, false);
    assert.notEqual(blocked.bundle_hash, bundle.bundle_hash);
    const manifest = buildReviewManifest({ episodeId: 'episode_review', tasks, comments: [], decisions: [], coverage: reviewCoverage(tasks, []), dependencyMap: dep });
    assert.ok(manifest.manifest_hash);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('Phase 10 console contains every Human Editorial Cockpit DOM target', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const ids = ['reviewCoverageBadge','reviewerName','reviewRoleFilter','bootstrapReviewButton','captureSnapshotButton','finalSignoffButton','reviewQueueList','reviewDependencyJson','reviewCommentTask','reviewCommentScene','reviewCommentTime','reviewCommentSeverity','reviewCommentBody','addReviewCommentButton','reviewCommentsList','leftSnapshot','rightSnapshot','compareSnapshotsButton','snapshotComparisonJson','finalSignoffJson'];
  for (const id of ids) assert.match(html, new RegExp(`id=["']${id}["']`), `missing ${id}`);
});

test('Phase 10 server exposes review queues, bound comments, decisions, snapshots, comparisons, exports, and final sign-off routes', () => {
  const server = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'server.js'), 'utf8');
  const routes = ['/api/editorial-cockpit','/api/editorial-cockpit/bootstrap','/api/editorial-cockpit/assign','/api/editorial-cockpit/comment','/api/editorial-cockpit/comment/resolve','/api/editorial-cockpit/decision','/api/editorial-cockpit/snapshot','/api/editorial-cockpit/compare','/api/editorial-cockpit/final-signoff','/api/editorial-cockpit/export'];
  for (const route of routes) assert.match(server, new RegExp(route.replaceAll('/', '\\/')));
});
