const path = require('path');
const { StudioRegistry } = require('../lib/studios');

const root = path.resolve(__dirname, '..');
const registry = new StudioRegistry({
  builtinDir: path.join(root, 'studios', 'builtin'),
  customDir: path.resolve(process.env.FOUNDRY_CUSTOM_STUDIOS_DIR || path.join(root, 'studios', 'custom'))
});

const report = {
  checked_at: new Date().toISOString(),
  installed: registry.list(),
  passed: registry.list().every((studio) => studio.depth_score >= 70)
};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
