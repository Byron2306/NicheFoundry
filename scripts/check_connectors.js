const path = require('path');
const { ConnectorRegistry } = require('../lib/connectors');

const root = path.resolve(__dirname, '..');
const registry = new ConnectorRegistry({
  builtinDir: path.join(root, 'connectors', 'builtin'),
  customDir: path.resolve(process.env.FOUNDRY_CUSTOM_CONNECTORS_DIR || path.join(root, 'connectors', 'custom'))
});

const connectors = registry.list();
const report = {
  checked_at: new Date().toISOString(),
  schema: 'nichefoundry.connector_check.v1',
  connector_count: connectors.length,
  passed: connectors.length > 0,
  connectors: connectors.map((item) => ({
    connector_id: item.connector_id,
    name: item.name,
    version: item.version,
    adapter: item.adapter,
    capabilities: item.capabilities,
    configured: item.auth.configured,
    missing_env: item.auth.missing_env,
    source_tier: item.source_tier,
    primary_source_capable: item.trust.can_satisfy_primary_source,
    content_hash: item.content_hash
  })),
  notes: [
    'A connector can be installed while unconfigured; authenticated execution remains blocked until its required environment variables exist.',
    'No secret values are printed by this check.'
  ]
};

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
