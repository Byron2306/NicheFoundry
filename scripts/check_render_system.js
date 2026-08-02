const fs = require('fs');
const path = require('path');
const { RENDER_PROFILES, validateRenderPlan } = require('../lib/render_system');

const root = path.resolve(__dirname, '..');
const required = ['ffmpeg', 'ffprobe'];
const { spawnSync } = require('child_process');
const toolStatus = Object.fromEntries(required.map((tool) => {
  const result = spawnSync(tool, ['-version'], { stdio: 'ignore' });
  return [tool, !result.error && result.status === 0];
}));
const schemas = ['RENDER_SYSTEM_SCHEMA.md', 'PHASE_9_IMPLEMENTATION.md'];
const result = {
  passed: Object.values(toolStatus).every(Boolean) && Object.keys(RENDER_PROFILES).length === 4 && schemas.every((name) => fs.existsSync(path.join(root, name))),
  tools: toolStatus,
  profiles: RENDER_PROFILES,
  documents: Object.fromEntries(schemas.map((name) => [name, fs.existsSync(path.join(root, name))])),
  validator_exported: typeof validateRenderPlan === 'function'
};
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exit(1);
