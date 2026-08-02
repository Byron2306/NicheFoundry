const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn, spawnSync } = require("child_process");
const test = require("node:test");
const { verifyVideo, verifyCaptions, verifyImage } = require("../lib/evidence");

const ROOT = path.resolve(__dirname, "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (_error) {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error("Timed out waiting for server health endpoint.");
}

async function startServer(tempRoot, port) {
  const dataDir = path.join(tempRoot, "data");
  const episodesDir = path.join(tempRoot, "episodes");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(episodesDir, { recursive: true });
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      FOUNDRY_DATA_DIR: dataDir,
      FOUNDRY_EPISODES_DIR: episodesDir,
      BODY_LIMIT_BYTES: "8192",
      FOUNDRY_ALLOW_OFFLINE_SOURCE_FIXTURES: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);
  return { child, baseUrl, dataDir, episodesDir };
}

async function stopServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2500))
  ]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

function cookieFrom(response) {
  return String(response.headers.get("set-cookie") || "").split(";")[0];
}

async function api(baseUrl, cookie, pathname, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(options.headers || {})
  };
  return fetch(`${baseUrl}${pathname}`, { ...options, headers });
}

const sampleBrief = {
  working_title: "Phase Zero Truth Test",
  topic: "dinosaurs and fossils",
  story_premise: "Verify that status follows evidence.",
  age_band: "8-13",
  difficulty: "mixed",
  question_count: 6,
  countdown_seconds: 8,
  audience_mode: "general_family",
  contains_synthetic_media: false,
  source_mode: "wikipedia",
  source_queries: ["Dinosaur", "Fossil"],
  visual_direction: "Readable family-safe cards."
};

test("Phase 0 blocks false completion, protects files, persists state, and invalidates stale approval", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nichefoundry-phase0-"));
  const port = await freePort();
  let running = await startServer(tempRoot, port);
  t.after(async () => {
    await stopServer(running?.child);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const rootResponse = await fetch(`${running.baseUrl}/`);
  assert.equal(rootResponse.status, 200);
  const cookie = cookieFrom(rootResponse);
  assert.match(cookie, /^foundry_session=/);

  const unauthorized = await fetch(`${running.baseUrl}/api/state`);
  assert.equal(unauthorized.status, 401);

  const secret = await fetch(`${running.baseUrl}/.env`);
  assert.equal(secret.status, 404);
  const traversal = await fetch(`${running.baseUrl}/%2e%2e/server.js`);
  assert.equal(traversal.status, 404);

  const generatedResponse = await api(running.baseUrl, cookie, "/api/generate", {
    method: "POST",
    body: JSON.stringify({ brief: sampleBrief })
  });
  assert.equal(generatedResponse.status, 200);
  let state = (await generatedResponse.json()).state;
  assert.equal(state.qa.status, "blocked_pending_human_approval");
  assert.equal(state.qa.final_video_exists, false);
  assert.equal(state.approved, false);
  assert.ok(state.sourcePacket.length >= 2);
  assert.ok(state.claims.length >= sampleBrief.question_count);
  assert.equal(state.verification.editorial_audit.passed, true);
  assert.equal(state.verification.duplicate_and_safety.passed, true);
  assert.ok(state.episode.questions.every((question) => question.claim_ids.length === 1));
  for (const required of ["sources.json", "claims.json", "research_report.json", "duplicate_report.json"]) {
    assert.equal(fs.existsSync(path.join(running.episodesDir, state.episode.episode_id, required)), true, `${required} missing`);
  }

  const approvalResponse = await api(running.baseUrl, cookie, "/api/approve", {
    method: "POST",
    body: JSON.stringify({ reviewer: "Byron", notes: "Test approval" })
  });
  assert.equal(approvalResponse.status, 200);
  state = (await approvalResponse.json()).state;
  assert.equal(state.approved, true);
  assert.equal(state.approval.valid, true);
  assert.equal(state.qa.status, "blocked_missing_verified_delivery_artifacts");

  const integrationResponse = await api(running.baseUrl, cookie, "/api/run-integrations", {
    method: "POST",
    body: "{}"
  });
  assert.equal(integrationResponse.status, 200);
  state = (await integrationResponse.json()).state;
  assert.equal(state.qa.final_video_exists, false);
  assert.equal(state.qa.captions_exist, false);
  assert.equal(state.qa.thumbnail_exists, false);
  assert.notEqual(state.qa.status, "ready_for_private_upload");
  assert.equal(state.jobs.find((job) => job.job_type === "youtube").status, "blocked_for_review");
  assert.equal(state.jobs.find((job) => job.job_type === "rules").status, "completed");

  const episodeId = state.episode.episode_id;
  await stopServer(running.child);
  running = await startServer(tempRoot, port);
  const restartedRoot = await fetch(`${running.baseUrl}/`);
  const restartedCookie = cookieFrom(restartedRoot);
  const recoveredResponse = await api(running.baseUrl, restartedCookie, "/api/state");
  const recovered = (await recoveredResponse.json()).state;
  assert.equal(recovered.episode.episode_id, episodeId);
  assert.equal(recovered.approved, true);

  const episodePath = path.join(running.episodesDir, episodeId, "episode.json");
  const episode = JSON.parse(fs.readFileSync(episodePath, "utf8"));
  episode.title = "Changed after approval";
  fs.writeFileSync(episodePath, `${JSON.stringify(episode, null, 2)}\n`);
  const invalidatedResponse = await api(running.baseUrl, restartedCookie, "/api/state");
  const invalidated = (await invalidatedResponse.json()).state;
  assert.equal(invalidated.approved, false);
  assert.equal(invalidated.approval.valid, false);
  assert.equal(invalidated.qa.status, "blocked_validation_failed");
  assert.equal(invalidated.editorial_evidence_current, false);
  const staleReapproval = await api(running.baseUrl, restartedCookie, "/api/approve", {
    method: "POST",
    body: JSON.stringify({ reviewer: "Byron", notes: "Should be rejected after drift" })
  });
  assert.equal(staleReapproval.status, 400);

  const oversized = await api(running.baseUrl, restartedCookie, "/api/generate", {
    method: "POST",
    body: JSON.stringify({ payload: "x".repeat(9000) })
  });
  assert.equal(oversized.status, 413);
});

test("artifact verification requires decodable media, valid captions, and a real image signature", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nichefoundry-evidence-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  fs.writeFileSync(path.join(tempRoot, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nEvidence wins.\n");
  assert.equal(verifyCaptions(tempRoot, "captions.srt", "captions.srt").verified, true);

  fs.writeFileSync(path.join(tempRoot, "thumbnail.png"), Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64)
  ]));
  assert.equal(verifyImage(tempRoot, "thumbnail.png", "thumbnail.png").verified, true);

  fs.writeFileSync(path.join(tempRoot, "final.mp4"), Buffer.alloc(4096));
  assert.equal(verifyVideo(tempRoot, "final.mp4", "final.mp4").verified, false);

  const ffmpegCheck = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (ffmpegCheck.error || ffmpegCheck.status !== 0) {
    t.diagnostic("ffmpeg unavailable; decodable-video positive case skipped");
    return;
  }
  const videoPath = path.join(tempRoot, "verified.mp4");
  const built = spawnSync("ffmpeg", [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=size=320x180:rate=25:duration=1",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-shortest", "-c:v", "libx264", "-c:a", "aac", videoPath
  ], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(verifyVideo(tempRoot, "verified.mp4", "verified.mp4").verified, true);
});
