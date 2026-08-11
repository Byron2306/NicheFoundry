const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildTransformPlan,
  executeTransform,
  resolveInside,
  overlayExpression
} = require('../lib/media_transform');

test('image conversion plan is deterministic apart from generated timestamp', () => {
  const request = {
    kind: 'image',
    input: 'assets/source.png',
    output: 'exports/source.webp',
    operations: { width: 1280, height: 720, fit: 'contain', quality: 84, rotate: 0 }
  };
  const first = buildTransformPlan(request);
  const second = buildTransformPlan(request);
  assert.equal(first.plan_hash, second.plan_hash);
  assert.equal(first.kind, 'image');
  assert.deepEqual(first.filters, ['scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2']);
  assert.equal(first.metadata_policy, 'strip');
  assert.equal(first.preserve_source, true);
});

test('video plan covers trim resize audio and overlay without executing ffmpeg', () => {
  const plan = buildTransformPlan({
    kind: 'video',
    input: 'video/source.mp4',
    output: 'exports/edit.mp4',
    operations: {
      start_seconds: 4.5,
      duration_seconds: 12,
      width: 1080,
      height: 1920,
      fit: 'cover',
      fps: 30,
      volume: 0.85,
      overlay_image: 'graphics/logo.png',
      overlay_position: 'top_right'
    }
  });
  assert.equal(plan.kind, 'video');
  assert.equal(plan.operations.start_seconds, 4.5);
  assert.equal(plan.operations.duration_seconds, 12);
  assert.deepEqual(plan.video_filters, ['scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920']);
});

test('video concatenate request supports multiple inputs', () => {
  const plan = buildTransformPlan({
    kind: 'video',
    inputs: ['clips/01.mp4', 'clips/02.mp4', 'clips/03.mp4'],
    output: 'exports/combined.mp4',
    operations: { width: 1920, height: 1080, fit: 'contain' }
  });
  assert.equal(plan.inputs.length, 3);
  assert.equal(plan.preserve_source, true);
});

test('workspace path traversal is rejected', () => {
  assert.throws(() => resolveInside('/tmp/workspace', '../escape.mp4'), /Unsafe relative path/);
  assert.throws(() => buildTransformPlan({ kind: 'image', input: '../x.png', output: 'x.webp' }), /Unsafe relative path/);
});

test('unsupported formats and unsafe operation values are refused', () => {
  assert.throws(() => buildTransformPlan({ kind: 'image', input: 'a.exe', output: 'a.png' }), /Unsupported image input/);
  assert.throws(() => buildTransformPlan({ kind: 'video', input: 'a.mp4', output: 'a.gif' }), /Unsupported video output/);
  assert.throws(() => buildTransformPlan({ kind: 'image', input: 'a.png', output: 'a.jpg', operations: { rotate: 13 } }), /rotate must be/);
});

test('overlay positions are bounded to named policies', () => {
  assert.equal(overlayExpression('bottom_right', 24), 'W-w-24:H-h-24');
  assert.throws(() => overlayExpression('arbitrary_expression', 24), /Unsupported overlay position/);
});

test('dry run fingerprints existing source without requiring ffmpeg', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-transform-'));
  fs.mkdirSync(path.join(workspace, 'assets'));
  fs.writeFileSync(path.join(workspace, 'assets', 'source.png'), Buffer.from('not-an-image-but-safe-for-dry-run'));
  const result = executeTransform({
    workspaceDir: workspace,
    request: { kind: 'image', input: 'assets/source.png', output: 'exports/source.webp', operations: {} },
    dryRun: true
  });
  assert.equal(result.dry_run, true);
  assert.equal(result.inputs[0].exists, true);
  assert.match(result.inputs[0].sha256, /^[a-f0-9]{64}$/);
});
