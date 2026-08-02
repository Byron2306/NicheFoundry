const fs = require('fs');
const os = require('os');
const path = require('path');
const { REVIEW_ROLES, REVIEW_WORKFLOWS, buildReviewTasks, buildQueues } = require('../lib/editorial_cockpit');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-editorial-check-'));
try {
  for (const workflow of REVIEW_WORKFLOWS) for (const name of workflow.artifacts) {
    const target = path.join(temp, name); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, name.endsWith('.srt') ? '1\n00:00:00,000 --> 00:00:01,000\nReview\n' : Buffer.from(`phase10:${name}`));
  }
  const packet = { verification: { editorial_audit: { passed: true } }, editorial_evidence_current: true, approved: true, audio_approved: true, render_approved: true, audio_production: { performance_report: { passed: true } }, render_production: { render_qa_report: { passed: true, output: 'final.mp4' } } };
  const tasks = buildReviewTasks({ episodeId: 'check', episodeDir: temp, packet, existingTasks: [] });
  const result = { passed: tasks.length === REVIEW_WORKFLOWS.length && tasks.every((item) => item.ready), roles: REVIEW_ROLES.length, tasks: tasks.length, queues: buildQueues(tasks).length };
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
