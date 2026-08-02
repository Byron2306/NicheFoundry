const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { FoundryDatabase } = require('../lib/database');
const { sha256File } = require('../lib/evidence');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try { const response = await fetch(url); if (response.ok) return response; } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready at ${url}`);
}

function cookieFrom(response) {
  const header = response.headers.get('set-cookie') || '';
  return header.split(';')[0];
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase11-http-'));
  const dataDir = path.join(root, 'data');
  const episodesDir = path.join(root, 'episodes');
  const episodeId = 'phase11-http-smoke';
  const episodeDir = path.join(episodesDir, episodeId);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(episodeDir, { recursive: true });
  fs.writeFileSync(path.join(episodeDir, 'final.mp4'), Buffer.alloc(16_384, 1));
  fs.writeFileSync(path.join(episodeDir, 'captions.srt'), '1\n00:00:00,000 --> 00:00:01,000\nVerified release smoke test\n');
  fs.writeFileSync(path.join(episodeDir, 'thumbnail.png'), Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(1024, 1)]));
  fs.writeFileSync(path.join(episodeDir, 'render_approval_bundle.json'), JSON.stringify({ schema: 'smoke', approved: true }, null, 2));

  const packet = {
    episode: { episode_id: episodeId, title: 'Phase 11 Private Release Smoke Test', topic: 'publishing compliance', story_premise: 'A deterministic local HTTP test of the publishing preflight.', studio: { id: 'failure_atlas', name: 'Failure Atlas' } },
    brief: { studio_id: 'failure_atlas', audience_mode: 'general_family', contains_synthetic_media: true, archetype_id: 'failure_chain' },
    sourcePacket: [{ title: 'Official release evidence', source_url: 'https://example.org/release-evidence' }],
    render_production: { render_qa_report: { passed: true, output: 'final.mp4' } },
    render_qa_report: { passed: true, output: 'final.mp4' },
    episode_dir: episodeId,
    qa: { status: 'render_approved' }
  };
  const db = new FoundryDatabase(path.join(dataDir, 'foundry.sqlite3'));
  db.upsertEpisode(packet);
  db.recordApproval({
    approvalId: 'approval-render-smoke', episodeId, approvalType: 'render_programme', artifactName: 'render_approval_bundle.json',
    artifactHash: sha256File(path.join(episodeDir, 'render_approval_bundle.json')), reviewer: 'smoke-reviewer', decision: 'approved', notes: 'HTTP publishing smoke fixture'
  });
  db.close();

  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', FOUNDRY_DATA_DIR: dataDir, FOUNDRY_EPISODES_DIR: episodesDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const rootResponse = await waitFor(`http://127.0.0.1:${port}/`);
    const cookie = cookieFrom(rootResponse);
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    const preflightResponse = await fetch(`http://127.0.0.1:${port}/api/publishing-system/preflight`, {
      method: 'POST', headers,
      body: JSON.stringify({ episode_id: episodeId, actor: 'http-smoke', title: 'Phase 11 Private Release Smoke Test', categoryId: '28', selfDeclaredMadeForKids: false, containsSyntheticMedia: true, hasPaidProductPlacement: false })
    });
    const preflight = await preflightResponse.json();
    if (!preflightResponse.ok || !preflight.publishing_package?.preflight_passed) throw new Error(`Preflight failed: ${JSON.stringify(preflight)}`);
    const statusResponse = await fetch(`http://127.0.0.1:${port}/api/publishing-system?episode_id=${episodeId}`, { headers: { Cookie: cookie } });
    const status = await statusResponse.json();
    if (!statusResponse.ok || status.publishing_package?.status !== 'preflight_passed') throw new Error(`Status failed: ${JSON.stringify(status)}`);
    if (JSON.stringify(status).match(/\"(?:refresh_token|client_secret|session_url)\"\s*:\s*\"(?!\[REDACTED\])/i)) throw new Error('Publishing status exposed a secret-bearing value.');
    const uploadResponse = await fetch(`http://127.0.0.1:${port}/api/publishing-system/upload`, { method: 'POST', headers, body: JSON.stringify({ episode_id: episodeId, actor: 'http-smoke' }) });
    const upload = await uploadResponse.json();
    if (uploadResponse.status !== 409 || !/final sign-off/i.test(upload.error || '')) throw new Error(`Upload gate did not block before final sign-off: ${JSON.stringify(upload)}`);
    console.log(JSON.stringify({ schema: 'nichefoundry.phase11_http_smoke.v1', preflight_status: preflight.publishing_package.status, preflight_passed: true, credentials_configured: status.credentials.configured, publishing_events: status.events.length, upload_blocked_without_final_signoff: true, secrets_redacted: true }, null, 2));
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
  if (stderr && !/ExperimentalWarning/.test(stderr)) process.stderr.write(stderr);
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
