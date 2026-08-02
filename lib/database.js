const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function nowIso() {
  return new Date().toISOString();
}

class FoundryDatabase {
  constructor(databasePath) {
    this.databasePath = databasePath;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS episodes (
        episode_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        episode_dir TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        episode_id TEXT,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        input_json TEXT,
        output_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        name TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        exists_on_disk INTEGER NOT NULL DEFAULT 0,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT,
        verified INTEGER NOT NULL DEFAULT 0,
        verification_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (episode_id, name),
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS approvals (
        approval_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        approval_type TEXT NOT NULL,
        artifact_name TEXT NOT NULL,
        artifact_hash TEXT NOT NULL,
        reviewer TEXT NOT NULL,
        decision TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sources (
        source_row_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source_url TEXT NOT NULL,
        provider TEXT NOT NULL,
        revision_id TEXT,
        content_hash TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        source_json TEXT NOT NULL,
        UNIQUE (episode_id, source_id),
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS claims (
        claim_row_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        claim_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        claim_text TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL NOT NULL,
        claim_json TEXT NOT NULL,
        UNIQUE (episode_id, claim_id),
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS studio_packs (
        studio_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        source TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        pack_json TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS opportunities (
        opportunity_id TEXT PRIMARY KEY,
        studio_id TEXT NOT NULL,
        title TEXT NOT NULL,
        topic TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        content_role TEXT NOT NULL,
        opportunity_score REAL NOT NULL,
        cluster_id TEXT,
        source TEXT NOT NULL,
        opportunity_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS series_plans (
        series_plan_id TEXT PRIMARY KEY,
        studio_id TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS editorial_calendars (
        calendar_id TEXT PRIMARY KEY,
        studio_id TEXT NOT NULL,
        calendar_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_strategies (
        strategy_id TEXT PRIMARY KEY,
        studio_id TEXT NOT NULL,
        strategy_hash TEXT NOT NULL,
        strategy_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audience_assessments (
        assessment_id TEXT PRIMARY KEY,
        episode_id TEXT,
        studio_id TEXT NOT NULL,
        passed INTEGER NOT NULL,
        score REAL NOT NULL,
        assessment_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS story_packages (
        story_package_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL UNIQUE,
        studio_id TEXT NOT NULL,
        archetype_id TEXT NOT NULL,
        passed INTEGER NOT NULL,
        script_hash TEXT NOT NULL,
        story_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS visual_packages (
        visual_package_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL UNIQUE,
        studio_id TEXT NOT NULL,
        passed INTEGER NOT NULL,
        identity_hash TEXT NOT NULL,
        fingerprint_json TEXT NOT NULL,
        visual_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS visual_assets (
        asset_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        scene_id TEXT,
        asset_type TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        status TEXT NOT NULL,
        rights_status TEXT NOT NULL,
        licence TEXT NOT NULL,
        sha256 TEXT,
        asset_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audio_packages (
        audio_package_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL UNIQUE,
        studio_id TEXT NOT NULL,
        passed INTEGER NOT NULL,
        plan_hash TEXT NOT NULL,
        provider TEXT,
        audio_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audio_assets (
        asset_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        scene_id TEXT,
        asset_type TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        status TEXT NOT NULL,
        rights_status TEXT NOT NULL,
        licence TEXT NOT NULL,
        provider TEXT,
        sha256 TEXT,
        asset_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS render_packages (
        render_package_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL UNIQUE,
        studio_id TEXT NOT NULL,
        passed INTEGER NOT NULL,
        profile_id TEXT NOT NULL,
        plan_hash TEXT NOT NULL,
        render_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS render_assets (
        asset_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        scene_id TEXT,
        asset_type TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        status TEXT NOT NULL,
        sha256 TEXT,
        asset_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS connector_definitions (
        connector_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        adapter TEXT NOT NULL,
        source TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS connector_runs (
        run_id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        episode_id TEXT,
        studio_id TEXT,
        status TEXT NOT NULL,
        capability TEXT,
        input_json TEXT NOT NULL,
        output_json TEXT NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS review_tasks (
        task_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        review_type TEXT NOT NULL,
        stage TEXT NOT NULL,
        role TEXT NOT NULL,
        label TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        required INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        assignee TEXT,
        due_at TEXT,
        artifact_hash TEXT NOT NULL,
        task_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE (episode_id, review_type),
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS review_comments (
        comment_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        scene_id TEXT,
        timeline_seconds REAL,
        artifact_name TEXT,
        artifact_hash TEXT,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT,
        FOREIGN KEY (task_id) REFERENCES review_tasks(task_id) ON DELETE CASCADE,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS review_decisions (
        decision_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        artifact_hash TEXT NOT NULL,
        reviewer TEXT NOT NULL,
        decision TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES review_tasks(task_id) ON DELETE CASCADE,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS review_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        snapshot_type TEXT NOT NULL,
        bundle_hash TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS final_signoffs (
        signoff_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        artifact_name TEXT NOT NULL,
        artifact_hash TEXT NOT NULL,
        reviewer TEXT NOT NULL,
        decision TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS publishing_packages (
        publishing_package_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL UNIQUE,
        studio_id TEXT,
        status TEXT NOT NULL,
        passed INTEGER NOT NULL,
        package_hash TEXT NOT NULL,
        video_id TEXT,
        publishing_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS publishing_events (
        event_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS youtube_upload_sessions (
        session_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL UNIQUE,
        session_url TEXT NOT NULL,
        session_url_hash TEXT NOT NULL,
        total_bytes INTEGER NOT NULL,
        uploaded_bytes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        video_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_id TEXT,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_episode ON jobs(episode_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_review_tasks_episode ON review_tasks(episode_id, stage, status);
      CREATE INDEX IF NOT EXISTS idx_review_comments_episode ON review_comments(episode_id, status, severity);
      CREATE INDEX IF NOT EXISTS idx_review_decisions_task ON review_decisions(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_review_snapshots_episode ON review_snapshots(episode_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_publishing_packages_episode ON publishing_packages(episode_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_publishing_events_episode ON publishing_events(episode_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_youtube_sessions_episode ON youtube_upload_sessions(episode_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_artifacts_episode ON artifacts(episode_id, name);
      CREATE INDEX IF NOT EXISTS idx_approvals_episode ON approvals(episode_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sources_episode ON sources(episode_id, source_id);
      CREATE INDEX IF NOT EXISTS idx_claims_episode ON claims(episode_id, source_id);
      CREATE INDEX IF NOT EXISTS idx_studio_packs_name ON studio_packs(name, version);
      CREATE INDEX IF NOT EXISTS idx_opportunities_studio ON opportunities(studio_id, opportunity_score DESC);
      CREATE INDEX IF NOT EXISTS idx_opportunities_lifecycle ON opportunities(studio_id, lifecycle, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_opportunities_cluster ON opportunities(studio_id, cluster_id);
      CREATE INDEX IF NOT EXISTS idx_series_plans_studio ON series_plans(studio_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_calendars_studio ON editorial_calendars(studio_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_channel_strategies_studio ON channel_strategies(studio_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audience_assessments_studio ON audience_assessments(studio_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audience_assessments_episode ON audience_assessments(episode_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_story_packages_studio ON story_packages(studio_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_story_packages_episode ON story_packages(episode_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_visual_packages_studio ON visual_packages(studio_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_visual_packages_episode ON visual_packages(episode_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_visual_assets_episode ON visual_assets(episode_id, scene_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_visual_assets_rights ON visual_assets(rights_status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audio_packages_studio ON audio_packages(studio_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audio_packages_episode ON audio_packages(episode_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audio_assets_episode ON audio_assets(episode_id, scene_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audio_assets_rights ON audio_assets(rights_status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_render_packages_studio ON render_packages(studio_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_render_packages_episode ON render_packages(episode_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_render_assets_episode ON render_assets(episode_id, scene_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_connector_runs_connector ON connector_runs(connector_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_connector_runs_episode ON connector_runs(episode_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_connector_runs_studio ON connector_runs(studio_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_episode ON audit_events(episode_id, created_at DESC);
    `);
  }

  close() {
    this.db.close();
  }

  setSetting(key, value) {
    const stamp = nowIso();
    this.db.prepare(`
      INSERT INTO settings(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value == null ? null : String(value), stamp);
  }

  getSetting(key) {
    return this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
  }

  upsertEpisode(packet) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT created_at FROM episodes WHERE episode_id = ?").get(packet.episode.episode_id);
    const createdAt = existing?.created_at || stamp;
    this.db.prepare(`
      INSERT INTO episodes(episode_id, title, status, episode_dir, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(episode_id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        episode_dir = excluded.episode_dir,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).run(
      packet.episode.episode_id,
      packet.episode.title,
      packet.qa?.status || "unknown",
      packet.episode_dir,
      JSON.stringify(packet),
      createdAt,
      stamp
    );
    this.setSetting("current_episode_id", packet.episode.episode_id);
  }

  getEpisode(episodeId) {
    const row = this.db.prepare("SELECT state_json FROM episodes WHERE episode_id = ?").get(episodeId);
    if (!row) return null;
    return JSON.parse(row.state_json);
  }

  getCurrentEpisode() {
    const episodeId = this.getSetting("current_episode_id");
    return episodeId ? this.getEpisode(episodeId) : null;
  }

  clearCurrentEpisode() {
    this.setSetting("current_episode_id", null);
  }

  listEpisodes(limit = 50) {
    return this.db.prepare(`
      SELECT episode_id, title, status, episode_dir, created_at, updated_at
      FROM episodes
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(Number(limit) || 50, 200)));
  }

  createJob({ jobId, episodeId, jobType, status = "queued", input = null }) {
    const stamp = nowIso();
    this.db.prepare(`
      INSERT INTO jobs(job_id, episode_id, job_type, status, attempts, input_json, created_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(jobId, episodeId || null, jobType, status, input == null ? null : JSON.stringify(input), stamp);
    return this.getJob(jobId);
  }

  updateJob(jobId, patch) {
    const current = this.getJob(jobId);
    if (!current) throw new Error(`Unknown job: ${jobId}`);
    const next = {
      ...current,
      ...patch,
      episode_id: patch.episode_id ?? current.episode_id,
      attempts: patch.attempts ?? current.attempts,
      input_json: patch.input !== undefined ? JSON.stringify(patch.input) : current.input_json,
      output_json: patch.output !== undefined ? JSON.stringify(patch.output) : current.output_json
    };
    this.db.prepare(`
      UPDATE jobs SET
        episode_id = ?, status = ?, attempts = ?, input_json = ?, output_json = ?, error = ?,
        started_at = ?, finished_at = ?
      WHERE job_id = ?
    `).run(
      next.episode_id || null,
      next.status,
      next.attempts,
      next.input_json,
      next.output_json,
      next.error || null,
      next.started_at || null,
      next.finished_at || null,
      jobId
    );
    return this.getJob(jobId);
  }

  getJob(jobId) {
    return this.db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId) || null;
  }

  listJobs(episodeId, limit = 100) {
    if (episodeId) {
      return this.db.prepare(`
        SELECT * FROM jobs WHERE episode_id = ? ORDER BY created_at DESC LIMIT ?
      `).all(episodeId, Math.max(1, Math.min(Number(limit) || 100, 500)));
    }
    return this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
      .all(Math.max(1, Math.min(Number(limit) || 100, 500)));
  }

  upsertArtifact(episodeId, artifact) {
    const stamp = nowIso();
    const artifactId = `${episodeId}:${artifact.name}`;
    this.db.prepare(`
      INSERT INTO artifacts(
        artifact_id, episode_id, name, relative_path, kind, exists_on_disk,
        size_bytes, sha256, verified, verification_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(episode_id, name) DO UPDATE SET
        relative_path = excluded.relative_path,
        kind = excluded.kind,
        exists_on_disk = excluded.exists_on_disk,
        size_bytes = excluded.size_bytes,
        sha256 = excluded.sha256,
        verified = excluded.verified,
        verification_json = excluded.verification_json,
        updated_at = excluded.updated_at
    `).run(
      artifactId,
      episodeId,
      artifact.name,
      artifact.relative_path,
      artifact.kind,
      artifact.exists ? 1 : 0,
      artifact.size_bytes || 0,
      artifact.sha256 || null,
      artifact.verified ? 1 : 0,
      JSON.stringify(artifact.verification || {}),
      stamp,
      stamp
    );
  }

  listArtifacts(episodeId) {
    return this.db.prepare(`
      SELECT * FROM artifacts WHERE episode_id = ? ORDER BY name
    `).all(episodeId);
  }

  recordApproval({ approvalId, episodeId, approvalType, artifactName, artifactHash, reviewer, decision, notes }) {
    const stamp = nowIso();
    this.db.prepare(`
      INSERT INTO approvals(
        approval_id, episode_id, approval_type, artifact_name, artifact_hash,
        reviewer, decision, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      approvalId,
      episodeId,
      approvalType,
      artifactName,
      artifactHash,
      reviewer,
      decision,
      notes || null,
      stamp
    );
    return this.db.prepare("SELECT * FROM approvals WHERE approval_id = ?").get(approvalId);
  }

  listApprovals(episodeId) {
    return this.db.prepare(`
      SELECT * FROM approvals WHERE episode_id = ? ORDER BY created_at DESC
    `).all(episodeId);
  }

  replaceResearch(episodeId, sources = [], claims = []) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db.prepare("DELETE FROM claims WHERE episode_id = ?").run(episodeId);
      this.db.prepare("DELETE FROM sources WHERE episode_id = ?").run(episodeId);
      const sourceStatement = this.db.prepare(`
        INSERT INTO sources(
          source_row_id, episode_id, source_id, title, source_url, provider,
          revision_id, content_hash, retrieved_at, source_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const source of sources) {
        sourceStatement.run(
          `${episodeId}:${source.source_id}`, episodeId, source.source_id, source.title,
          source.source_url || source.canonical_url, source.provider || "unknown",
          source.revision_id == null ? null : String(source.revision_id), source.content_hash,
          source.retrieved_at || nowIso(), JSON.stringify(source)
        );
      }
      const claimStatement = this.db.prepare(`
        INSERT INTO claims(
          claim_row_id, episode_id, claim_id, source_id, claim_text, status,
          confidence, claim_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const claim of claims) {
        claimStatement.run(
          `${episodeId}:${claim.claim_id}`, episodeId, claim.claim_id, claim.source_id,
          claim.claim, claim.status || "supported", Number(claim.confidence || 0), JSON.stringify(claim)
        );
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  listSources(episodeId) {
    return this.db.prepare(`
      SELECT source_json FROM sources WHERE episode_id = ? ORDER BY retrieved_at, source_id
    `).all(episodeId).map((row) => JSON.parse(row.source_json));
  }

  listClaims(episodeId) {
    return this.db.prepare(`
      SELECT claim_json FROM claims WHERE episode_id = ? ORDER BY confidence DESC, claim_id
    `).all(episodeId).map((row) => JSON.parse(row.claim_json));
  }


  upsertStudioPack({ studioId, name, version, source, contentHash, pack }) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT installed_at FROM studio_packs WHERE studio_id = ?").get(studioId);
    this.db.prepare(`
      INSERT INTO studio_packs(studio_id, name, version, source, content_hash, pack_json, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(studio_id) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        source = excluded.source,
        content_hash = excluded.content_hash,
        pack_json = excluded.pack_json,
        updated_at = excluded.updated_at
    `).run(studioId, name, version, source, contentHash, JSON.stringify(pack), existing?.installed_at || stamp, stamp);
  }

  getStudioPack(studioId) {
    const row = this.db.prepare("SELECT * FROM studio_packs WHERE studio_id = ?").get(studioId);
    if (!row) return null;
    return { ...row, pack: JSON.parse(row.pack_json) };
  }

  listStudioPacks() {
    return this.db.prepare(`
      SELECT studio_id, name, version, source, content_hash, installed_at, updated_at
      FROM studio_packs ORDER BY name, version
    `).all();
  }


  upsertConnectorDefinition({ connectorId, name, version, adapter, source, contentHash, definition }) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT installed_at FROM connector_definitions WHERE connector_id = ?").get(connectorId);
    this.db.prepare(`
      INSERT INTO connector_definitions(
        connector_id, name, version, adapter, source, content_hash, definition_json, installed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        adapter = excluded.adapter,
        source = excluded.source,
        content_hash = excluded.content_hash,
        definition_json = excluded.definition_json,
        updated_at = excluded.updated_at
    `).run(connectorId, name, version, adapter, source, contentHash, JSON.stringify(definition), existing?.installed_at || stamp, stamp);
  }

  listConnectorDefinitions() {
    return this.db.prepare(`
      SELECT connector_id, name, version, adapter, source, content_hash, installed_at, updated_at
      FROM connector_definitions ORDER BY name
    `).all();
  }

  saveConnectorRun(run, { episodeId = null, studioId = null, capability = null } = {}) {
    this.db.prepare(`
      INSERT INTO connector_runs(
        run_id, connector_id, episode_id, studio_id, status, capability,
        input_json, output_json, error, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        status = excluded.status,
        output_json = excluded.output_json,
        error = excluded.error,
        finished_at = excluded.finished_at
    `).run(
      run.run_id, run.connector_id, episodeId, studioId, run.status, capability,
      JSON.stringify(run.input || {}), JSON.stringify(run), run.error || null,
      run.started_at || nowIso(), run.finished_at || null
    );
    return this.getConnectorRun(run.run_id);
  }

  getConnectorRun(runId) {
    const row = this.db.prepare("SELECT output_json FROM connector_runs WHERE run_id = ?").get(runId);
    return row ? JSON.parse(row.output_json) : null;
  }

  listConnectorRuns({ connectorId = null, episodeId = null, studioId = null, limit = 100 } = {}) {
    const bounded = Math.max(1, Math.min(Number(limit) || 100, 1000));
    let rows;
    if (connectorId) rows = this.db.prepare("SELECT output_json FROM connector_runs WHERE connector_id = ? ORDER BY started_at DESC LIMIT ?").all(connectorId, bounded);
    else if (episodeId) rows = this.db.prepare("SELECT output_json FROM connector_runs WHERE episode_id = ? ORDER BY started_at DESC LIMIT ?").all(episodeId, bounded);
    else if (studioId) rows = this.db.prepare("SELECT output_json FROM connector_runs WHERE studio_id = ? ORDER BY started_at DESC LIMIT ?").all(studioId, bounded);
    else rows = this.db.prepare("SELECT output_json FROM connector_runs ORDER BY started_at DESC LIMIT ?").all(bounded);
    return rows.map((row) => JSON.parse(row.output_json));
  }


  upsertOpportunity(opportunity) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT created_at FROM opportunities WHERE opportunity_id = ?").get(opportunity.opportunity_id);
    this.db.prepare(`
      INSERT INTO opportunities(
        opportunity_id, studio_id, title, topic, lifecycle, content_role,
        opportunity_score, cluster_id, source, opportunity_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(opportunity_id) DO UPDATE SET
        studio_id = excluded.studio_id,
        title = excluded.title,
        topic = excluded.topic,
        lifecycle = excluded.lifecycle,
        content_role = excluded.content_role,
        opportunity_score = excluded.opportunity_score,
        cluster_id = excluded.cluster_id,
        source = excluded.source,
        opportunity_json = excluded.opportunity_json,
        updated_at = excluded.updated_at
    `).run(
      opportunity.opportunity_id, opportunity.studio_id, opportunity.title, opportunity.topic,
      opportunity.lifecycle || "discovered", opportunity.content_role || "core_pillar",
      Number(opportunity.opportunity_score || 0), opportunity.cluster_id || null,
      opportunity.discovery_source || opportunity.source || "manual", JSON.stringify(opportunity),
      existing?.created_at || stamp, stamp
    );
    return this.getOpportunity(opportunity.opportunity_id);
  }

  getOpportunity(opportunityId) {
    const row = this.db.prepare("SELECT opportunity_json FROM opportunities WHERE opportunity_id = ?").get(opportunityId);
    return row ? JSON.parse(row.opportunity_json) : null;
  }

  listOpportunities({ studioId = null, lifecycle = null, limit = 500 } = {}) {
    const bounded = Math.max(1, Math.min(Number(limit) || 500, 2000));
    let rows;
    if (studioId && lifecycle) {
      rows = this.db.prepare(`SELECT opportunity_json FROM opportunities WHERE studio_id = ? AND lifecycle = ? ORDER BY opportunity_score DESC, updated_at DESC LIMIT ?`).all(studioId, lifecycle, bounded);
    } else if (studioId) {
      rows = this.db.prepare(`SELECT opportunity_json FROM opportunities WHERE studio_id = ? ORDER BY opportunity_score DESC, updated_at DESC LIMIT ?`).all(studioId, bounded);
    } else if (lifecycle) {
      rows = this.db.prepare(`SELECT opportunity_json FROM opportunities WHERE lifecycle = ? ORDER BY opportunity_score DESC, updated_at DESC LIMIT ?`).all(lifecycle, bounded);
    } else {
      rows = this.db.prepare(`SELECT opportunity_json FROM opportunities ORDER BY opportunity_score DESC, updated_at DESC LIMIT ?`).all(bounded);
    }
    return rows.map((row) => JSON.parse(row.opportunity_json));
  }

  replaceOpportunityClusters(studioId, opportunities) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const statement = this.db.prepare(`
        UPDATE opportunities SET cluster_id = ?, opportunity_json = ?, updated_at = ?
        WHERE opportunity_id = ? AND studio_id = ?
      `);
      for (const opportunity of opportunities) {
        statement.run(opportunity.cluster_id || null, JSON.stringify(opportunity), nowIso(), opportunity.opportunity_id, studioId);
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  updateOpportunityLifecycle(opportunityId, lifecycle, opportunity) {
    this.db.prepare(`
      UPDATE opportunities SET lifecycle = ?, opportunity_json = ?, updated_at = ? WHERE opportunity_id = ?
    `).run(lifecycle, JSON.stringify(opportunity), nowIso(), opportunityId);
    return this.getOpportunity(opportunityId);
  }

  saveSeriesPlan(seriesPlanId, studioId, plan) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT created_at FROM series_plans WHERE series_plan_id = ?").get(seriesPlanId);
    this.db.prepare(`
      INSERT INTO series_plans(series_plan_id, studio_id, plan_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(series_plan_id) DO UPDATE SET plan_json = excluded.plan_json, updated_at = excluded.updated_at
    `).run(seriesPlanId, studioId, JSON.stringify(plan), existing?.created_at || stamp, stamp);
    return plan;
  }

  listSeriesPlans(studioId, limit = 20) {
    const rows = studioId
      ? this.db.prepare(`SELECT series_plan_id, plan_json, created_at, updated_at FROM series_plans WHERE studio_id = ? ORDER BY updated_at DESC LIMIT ?`).all(studioId, Math.max(1, Math.min(Number(limit) || 20, 100)))
      : this.db.prepare(`SELECT series_plan_id, plan_json, created_at, updated_at FROM series_plans ORDER BY updated_at DESC LIMIT ?`).all(Math.max(1, Math.min(Number(limit) || 20, 100)));
    return rows.map((row) => ({ ...JSON.parse(row.plan_json), series_plan_id: row.series_plan_id, created_at: row.created_at, updated_at: row.updated_at }));
  }

  saveEditorialCalendar(calendarId, studioId, calendar) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT created_at FROM editorial_calendars WHERE calendar_id = ?").get(calendarId);
    this.db.prepare(`
      INSERT INTO editorial_calendars(calendar_id, studio_id, calendar_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(calendar_id) DO UPDATE SET calendar_json = excluded.calendar_json, updated_at = excluded.updated_at
    `).run(calendarId, studioId, JSON.stringify(calendar), existing?.created_at || stamp, stamp);
    return calendar;
  }

  listEditorialCalendars(studioId, limit = 20) {
    const rows = studioId
      ? this.db.prepare(`SELECT calendar_id, calendar_json, created_at, updated_at FROM editorial_calendars WHERE studio_id = ? ORDER BY updated_at DESC LIMIT ?`).all(studioId, Math.max(1, Math.min(Number(limit) || 20, 100)))
      : this.db.prepare(`SELECT calendar_id, calendar_json, created_at, updated_at FROM editorial_calendars ORDER BY updated_at DESC LIMIT ?`).all(Math.max(1, Math.min(Number(limit) || 20, 100)));
    return rows.map((row) => ({ ...JSON.parse(row.calendar_json), calendar_id: row.calendar_id, created_at: row.created_at, updated_at: row.updated_at }));
  }

  saveChannelStrategy(strategyId, studioId, strategy) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT created_at FROM channel_strategies WHERE strategy_id = ?").get(strategyId);
    this.db.prepare(`
      INSERT INTO channel_strategies(strategy_id, studio_id, strategy_hash, strategy_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(strategy_id) DO UPDATE SET
        strategy_hash = excluded.strategy_hash,
        strategy_json = excluded.strategy_json,
        updated_at = excluded.updated_at
    `).run(strategyId, studioId, strategy.strategy_hash || "", JSON.stringify(strategy), existing?.created_at || stamp, stamp);
    return this.getChannelStrategy(strategyId);
  }

  getChannelStrategy(strategyId) {
    const row = this.db.prepare("SELECT strategy_json, created_at, updated_at FROM channel_strategies WHERE strategy_id = ?").get(strategyId);
    return row ? { ...JSON.parse(row.strategy_json), strategy_id: strategyId, created_at: row.created_at, updated_at: row.updated_at } : null;
  }

  getLatestChannelStrategy(studioId) {
    const row = this.db.prepare("SELECT strategy_id, strategy_json, created_at, updated_at FROM channel_strategies WHERE studio_id = ? ORDER BY updated_at DESC LIMIT 1").get(studioId);
    return row ? { ...JSON.parse(row.strategy_json), strategy_id: row.strategy_id, created_at: row.created_at, updated_at: row.updated_at } : null;
  }

  listChannelStrategies(studioId = null, limit = 20) {
    const bounded = Math.max(1, Math.min(Number(limit) || 20, 100));
    const rows = studioId
      ? this.db.prepare("SELECT strategy_id, strategy_json, created_at, updated_at FROM channel_strategies WHERE studio_id = ? ORDER BY updated_at DESC LIMIT ?").all(studioId, bounded)
      : this.db.prepare("SELECT strategy_id, strategy_json, created_at, updated_at FROM channel_strategies ORDER BY updated_at DESC LIMIT ?").all(bounded);
    return rows.map((row) => ({ ...JSON.parse(row.strategy_json), strategy_id: row.strategy_id, created_at: row.created_at, updated_at: row.updated_at }));
  }

  saveAudienceAssessment(assessmentId, studioId, assessment, episodeId = null) {
    this.db.prepare(`
      INSERT INTO audience_assessments(assessment_id, episode_id, studio_id, passed, score, assessment_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(assessment_id) DO UPDATE SET
        episode_id = excluded.episode_id,
        passed = excluded.passed,
        score = excluded.score,
        assessment_json = excluded.assessment_json
    `).run(assessmentId, episodeId, studioId, assessment.passed ? 1 : 0, Number(assessment.audience_fit?.score ?? assessment.score ?? 0), JSON.stringify(assessment), nowIso());
    return this.getAudienceAssessment(assessmentId);
  }

  getAudienceAssessment(assessmentId) {
    const row = this.db.prepare("SELECT assessment_json, episode_id, created_at FROM audience_assessments WHERE assessment_id = ?").get(assessmentId);
    return row ? { ...JSON.parse(row.assessment_json), assessment_id: assessmentId, episode_id: row.episode_id, created_at: row.created_at } : null;
  }

  listAudienceAssessments({ studioId = null, episodeId = null, limit = 50 } = {}) {
    const bounded = Math.max(1, Math.min(Number(limit) || 50, 200));
    let rows;
    if (episodeId) rows = this.db.prepare("SELECT assessment_id, assessment_json, episode_id, created_at FROM audience_assessments WHERE episode_id = ? ORDER BY created_at DESC LIMIT ?").all(episodeId, bounded);
    else if (studioId) rows = this.db.prepare("SELECT assessment_id, assessment_json, episode_id, created_at FROM audience_assessments WHERE studio_id = ? ORDER BY created_at DESC LIMIT ?").all(studioId, bounded);
    else rows = this.db.prepare("SELECT assessment_id, assessment_json, episode_id, created_at FROM audience_assessments ORDER BY created_at DESC LIMIT ?").all(bounded);
    return rows.map((row) => ({ ...JSON.parse(row.assessment_json), assessment_id: row.assessment_id, episode_id: row.episode_id, created_at: row.created_at }));
  }

  saveStoryPackage(storyPackageId, episodeId, studioId, archetypeId, storyPackage) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT created_at FROM story_packages WHERE story_package_id = ?").get(storyPackageId);
    this.db.prepare(`
      INSERT INTO story_packages(story_package_id, episode_id, studio_id, archetype_id, passed, script_hash, story_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(story_package_id) DO UPDATE SET
        episode_id = excluded.episode_id,
        studio_id = excluded.studio_id,
        archetype_id = excluded.archetype_id,
        passed = excluded.passed,
        script_hash = excluded.script_hash,
        story_json = excluded.story_json,
        updated_at = excluded.updated_at
    `).run(
      storyPackageId,
      episodeId,
      studioId,
      archetypeId,
      storyPackage.passed ? 1 : 0,
      storyPackage.script_hash_basis || storyPackage.script_hash || "",
      JSON.stringify(storyPackage),
      existing?.created_at || stamp,
      stamp
    );
    return this.getStoryPackage(storyPackageId);
  }

  getStoryPackage(storyPackageId) {
    const row = this.db.prepare("SELECT story_json, episode_id, studio_id, archetype_id, passed, script_hash, created_at, updated_at FROM story_packages WHERE story_package_id = ?").get(storyPackageId);
    return row ? {
      ...JSON.parse(row.story_json),
      story_package_id: storyPackageId,
      episode_id: row.episode_id,
      studio_id: row.studio_id,
      archetype_id: row.archetype_id,
      passed: Boolean(row.passed),
      script_hash: row.script_hash,
      created_at: row.created_at,
      updated_at: row.updated_at
    } : null;
  }

  getStoryPackageForEpisode(episodeId) {
    const row = this.db.prepare("SELECT story_package_id FROM story_packages WHERE episode_id = ? ORDER BY updated_at DESC LIMIT 1").get(episodeId);
    return row ? this.getStoryPackage(row.story_package_id) : null;
  }

  listStoryPackages({ studioId = null, limit = 50 } = {}) {
    const bounded = Math.max(1, Math.min(Number(limit) || 50, 200));
    const rows = studioId
      ? this.db.prepare("SELECT story_package_id FROM story_packages WHERE studio_id = ? ORDER BY updated_at DESC LIMIT ?").all(studioId, bounded)
      : this.db.prepare("SELECT story_package_id FROM story_packages ORDER BY updated_at DESC LIMIT ?").all(bounded);
    return rows.map((row) => this.getStoryPackage(row.story_package_id));
  }


  saveVisualPackage(visualPackageId, episodeId, studioId, visualPackage) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT created_at FROM visual_packages WHERE visual_package_id = ?").get(visualPackageId);
    this.db.prepare(`
      INSERT INTO visual_packages(visual_package_id, episode_id, studio_id, passed, identity_hash, fingerprint_json, visual_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(visual_package_id) DO UPDATE SET
        episode_id = excluded.episode_id, studio_id = excluded.studio_id, passed = excluded.passed,
        identity_hash = excluded.identity_hash, fingerprint_json = excluded.fingerprint_json,
        visual_json = excluded.visual_json, updated_at = excluded.updated_at
    `).run(
      visualPackageId, episodeId, studioId, visualPackage.passed ? 1 : 0,
      visualPackage.visual_identity?.identity_hash || '',
      JSON.stringify(visualPackage.fingerprint_tokens || visualPackage.visual_plan?.fingerprint_tokens || []),
      JSON.stringify(visualPackage), existing?.created_at || stamp, stamp
    );
    this.replaceVisualAssets(episodeId, visualPackage.asset_manifest?.assets || []);
    return this.getVisualPackage(visualPackageId);
  }

  getVisualPackage(visualPackageId) {
    const row = this.db.prepare("SELECT visual_json, episode_id, studio_id, passed, identity_hash, fingerprint_json, created_at, updated_at FROM visual_packages WHERE visual_package_id = ?").get(visualPackageId);
    return row ? {
      ...JSON.parse(row.visual_json), visual_package_id: visualPackageId, episode_id: row.episode_id,
      studio_id: row.studio_id, passed: Boolean(row.passed), identity_hash: row.identity_hash,
      fingerprint_tokens: JSON.parse(row.fingerprint_json || '[]'), created_at: row.created_at, updated_at: row.updated_at
    } : null;
  }

  getVisualPackageForEpisode(episodeId) {
    const row = this.db.prepare("SELECT visual_package_id FROM visual_packages WHERE episode_id = ? ORDER BY updated_at DESC LIMIT 1").get(episodeId);
    return row ? this.getVisualPackage(row.visual_package_id) : null;
  }

  listVisualPackages({ studioId = null, limit = 50 } = {}) {
    const bounded = Math.max(1, Math.min(Number(limit) || 50, 200));
    const rows = studioId
      ? this.db.prepare("SELECT visual_package_id FROM visual_packages WHERE studio_id = ? ORDER BY updated_at DESC LIMIT ?").all(studioId, bounded)
      : this.db.prepare("SELECT visual_package_id FROM visual_packages ORDER BY updated_at DESC LIMIT ?").all(bounded);
    return rows.map((row) => this.getVisualPackage(row.visual_package_id));
  }

  replaceVisualAssets(episodeId, assets) {
    const stamp = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM visual_assets WHERE episode_id = ?").run(episodeId);
      const insert = this.db.prepare(`
        INSERT INTO visual_assets(asset_id, episode_id, scene_id, asset_type, relative_path, status, rights_status, licence, sha256, asset_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const asset of assets || []) insert.run(
        asset.asset_id, episodeId, asset.scene_id || null, asset.asset_type, asset.relative_path,
        asset.status || 'planned', asset.rights_status || 'unknown', asset.licence || 'unknown',
        asset.sha256 || null, JSON.stringify(asset), asset.created_at || stamp, stamp
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listVisualAssets(episodeId) {
    return this.db.prepare("SELECT asset_json, created_at, updated_at FROM visual_assets WHERE episode_id = ? ORDER BY scene_id, asset_id").all(episodeId)
      .map((row) => ({ ...JSON.parse(row.asset_json), created_at: row.created_at, updated_at: row.updated_at }));
  }


  saveAudioPackage(audioPackageId, episodeId, studioId, audioPackage) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT created_at FROM audio_packages WHERE audio_package_id = ?").get(audioPackageId);
    this.db.prepare(`
      INSERT INTO audio_packages(audio_package_id, episode_id, studio_id, passed, plan_hash, provider, audio_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(audio_package_id) DO UPDATE SET
        episode_id = excluded.episode_id, studio_id = excluded.studio_id, passed = excluded.passed,
        plan_hash = excluded.plan_hash, provider = excluded.provider, audio_json = excluded.audio_json,
        updated_at = excluded.updated_at
    `).run(
      audioPackageId, episodeId, studioId, audioPackage.passed ? 1 : 0,
      audioPackage.audio_performance_plan?.plan_hash || audioPackage.plan_hash || '',
      audioPackage.production?.provider || audioPackage.provider || null,
      JSON.stringify(audioPackage), existing?.created_at || stamp, stamp
    );
    if (audioPackage.production?.audio_assets) this.replaceAudioAssets(episodeId, audioPackage.production.audio_assets);
    else if (audioPackage.audio_assets) this.replaceAudioAssets(episodeId, audioPackage.audio_assets);
    return this.getAudioPackage(audioPackageId);
  }

  getAudioPackage(audioPackageId) {
    const row = this.db.prepare("SELECT audio_json, episode_id, studio_id, passed, plan_hash, provider, created_at, updated_at FROM audio_packages WHERE audio_package_id = ?").get(audioPackageId);
    return row ? {
      ...JSON.parse(row.audio_json), audio_package_id: audioPackageId, episode_id: row.episode_id,
      studio_id: row.studio_id, passed: Boolean(row.passed), plan_hash: row.plan_hash,
      provider: row.provider, created_at: row.created_at, updated_at: row.updated_at
    } : null;
  }

  getAudioPackageForEpisode(episodeId) {
    const row = this.db.prepare("SELECT audio_package_id FROM audio_packages WHERE episode_id = ? ORDER BY updated_at DESC LIMIT 1").get(episodeId);
    return row ? this.getAudioPackage(row.audio_package_id) : null;
  }

  listAudioPackages({ studioId = null, limit = 50 } = {}) {
    const bounded = Math.max(1, Math.min(Number(limit) || 50, 200));
    const rows = studioId
      ? this.db.prepare("SELECT audio_package_id FROM audio_packages WHERE studio_id = ? ORDER BY updated_at DESC LIMIT ?").all(studioId, bounded)
      : this.db.prepare("SELECT audio_package_id FROM audio_packages ORDER BY updated_at DESC LIMIT ?").all(bounded);
    return rows.map((row) => this.getAudioPackage(row.audio_package_id));
  }

  replaceAudioAssets(episodeId, assets) {
    const stamp = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM audio_assets WHERE episode_id = ?").run(episodeId);
      const insert = this.db.prepare(`
        INSERT INTO audio_assets(asset_id, episode_id, scene_id, asset_type, relative_path, status, rights_status, licence, provider, sha256, asset_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const asset of assets || []) insert.run(
        asset.asset_id, episodeId, asset.scene_id || null, asset.asset_type, asset.relative_path,
        asset.status || 'planned', asset.rights_status || 'unknown', asset.licence || 'unknown',
        asset.provider || null, asset.sha256 || null, JSON.stringify(asset), asset.created_at || stamp, stamp
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listAudioAssets(episodeId) {
    return this.db.prepare("SELECT asset_json, created_at, updated_at FROM audio_assets WHERE episode_id = ? ORDER BY scene_id, asset_id").all(episodeId)
      .map((row) => ({ ...JSON.parse(row.asset_json), created_at: row.created_at, updated_at: row.updated_at }));
  }


  saveRenderPackage(renderPackageId, episodeId, studioId, renderPackage) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT created_at FROM render_packages WHERE render_package_id = ?").get(renderPackageId);
    this.db.prepare(`
      INSERT INTO render_packages(render_package_id, episode_id, studio_id, passed, profile_id, plan_hash, render_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(render_package_id) DO UPDATE SET
        episode_id = excluded.episode_id, studio_id = excluded.studio_id, passed = excluded.passed,
        profile_id = excluded.profile_id, plan_hash = excluded.plan_hash, render_json = excluded.render_json,
        updated_at = excluded.updated_at
    `).run(
      renderPackageId, episodeId, studioId, renderPackage.passed ? 1 : 0,
      renderPackage.render_plan?.profile?.id || renderPackage.profile_id || 'proxy',
      renderPackage.render_plan?.plan_hash || renderPackage.plan_hash || '',
      JSON.stringify(renderPackage), existing?.created_at || stamp, stamp
    );
    if (renderPackage.render_assets) this.replaceRenderAssets(episodeId, renderPackage.render_assets);
    return this.getRenderPackage(renderPackageId);
  }

  getRenderPackage(renderPackageId) {
    const row = this.db.prepare("SELECT render_json, episode_id, studio_id, passed, profile_id, plan_hash, created_at, updated_at FROM render_packages WHERE render_package_id = ?").get(renderPackageId);
    return row ? {
      ...JSON.parse(row.render_json), render_package_id: renderPackageId, episode_id: row.episode_id,
      studio_id: row.studio_id, passed: Boolean(row.passed), profile_id: row.profile_id,
      plan_hash: row.plan_hash, created_at: row.created_at, updated_at: row.updated_at
    } : null;
  }

  getRenderPackageForEpisode(episodeId) {
    const row = this.db.prepare("SELECT render_package_id FROM render_packages WHERE episode_id = ? ORDER BY updated_at DESC LIMIT 1").get(episodeId);
    return row ? this.getRenderPackage(row.render_package_id) : null;
  }

  listRenderPackages({ studioId = null, limit = 50 } = {}) {
    const bounded = Math.max(1, Math.min(Number(limit) || 50, 200));
    const rows = studioId
      ? this.db.prepare("SELECT render_package_id FROM render_packages WHERE studio_id = ? ORDER BY updated_at DESC LIMIT ?").all(studioId, bounded)
      : this.db.prepare("SELECT render_package_id FROM render_packages ORDER BY updated_at DESC LIMIT ?").all(bounded);
    return rows.map((row) => this.getRenderPackage(row.render_package_id));
  }

  replaceRenderAssets(episodeId, assets) {
    const stamp = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM render_assets WHERE episode_id = ?").run(episodeId);
      const insert = this.db.prepare(`
        INSERT INTO render_assets(asset_id, episode_id, scene_id, asset_type, relative_path, status, sha256, asset_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const asset of assets || []) insert.run(
        asset.asset_id, episodeId, asset.scene_id || null, asset.asset_type, asset.relative_path,
        asset.status || 'ready', asset.sha256 || null, JSON.stringify(asset), asset.created_at || stamp, stamp
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listRenderAssets(episodeId) {
    return this.db.prepare("SELECT asset_json, created_at, updated_at FROM render_assets WHERE episode_id = ? ORDER BY scene_id, asset_id").all(episodeId)
      .map((row) => ({ ...JSON.parse(row.asset_json), created_at: row.created_at, updated_at: row.updated_at }));
  }

  upsertReviewTask(task) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT created_at, artifact_hash, status, completed_at FROM review_tasks WHERE task_id = ?").get(task.task_id);
    const artifactChanged = Boolean(existing?.artifact_hash && existing.artifact_hash !== task.artifact_hash);
    const status = artifactChanged && existing?.status === "approved" ? (task.ready ? "ready" : "blocked") : task.status;
    const completedAt = status === "approved" && !artifactChanged ? (task.completed_at || existing?.completed_at || stamp) : null;
    const stored = { ...task, status, completed_at: completedAt, version_changed: artifactChanged || task.version_changed };
    this.db.prepare(`
      INSERT INTO review_tasks(task_id, episode_id, review_type, stage, role, label, priority, required, status, assignee, due_at, artifact_hash, task_json, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        stage = excluded.stage, role = excluded.role, label = excluded.label, priority = excluded.priority,
        required = excluded.required, status = excluded.status, assignee = excluded.assignee,
        due_at = excluded.due_at, artifact_hash = excluded.artifact_hash, task_json = excluded.task_json,
        updated_at = excluded.updated_at, completed_at = excluded.completed_at
    `).run(stored.task_id, stored.episode_id, stored.review_type, stored.stage, stored.role, stored.label,
      Number(stored.priority || 0), stored.required ? 1 : 0, stored.status, stored.assignee || null,
      stored.due_at || null, stored.artifact_hash, JSON.stringify(stored), existing?.created_at || stamp, stamp, completedAt);
    return this.getReviewTask(task.task_id);
  }

  getReviewTask(taskId) {
    const row = this.db.prepare("SELECT task_json, status, assignee, due_at, artifact_hash, created_at, updated_at, completed_at FROM review_tasks WHERE task_id = ?").get(taskId);
    return row ? { ...JSON.parse(row.task_json), task_id: taskId, status: row.status, assignee: row.assignee, due_at: row.due_at, artifact_hash: row.artifact_hash, created_at: row.created_at, updated_at: row.updated_at, completed_at: row.completed_at } : null;
  }

  listReviewTasks(episodeId, { role = null, status = null } = {}) {
    let rows;
    if (role && status) rows = this.db.prepare("SELECT task_id FROM review_tasks WHERE episode_id = ? AND role = ? AND status = ? ORDER BY priority DESC, updated_at DESC").all(episodeId, role, status);
    else if (role) rows = this.db.prepare("SELECT task_id FROM review_tasks WHERE episode_id = ? AND role = ? ORDER BY priority DESC, updated_at DESC").all(episodeId, role);
    else if (status) rows = this.db.prepare("SELECT task_id FROM review_tasks WHERE episode_id = ? AND status = ? ORDER BY priority DESC, updated_at DESC").all(episodeId, status);
    else rows = this.db.prepare("SELECT task_id FROM review_tasks WHERE episode_id = ? ORDER BY priority DESC, updated_at DESC").all(episodeId);
    return rows.map((row) => this.getReviewTask(row.task_id));
  }

  assignReviewTask(taskId, assignee, dueAt = null) {
    const task = this.getReviewTask(taskId);
    if (!task) throw new Error(`Unknown review task: ${taskId}`);
    return this.upsertReviewTask({ ...task, assignee: assignee || null, due_at: dueAt || null });
  }

  recordReviewDecision({ decisionId, taskId, episodeId, artifactHash, reviewer, decision, notes = "" }) {
    const task = this.getReviewTask(taskId);
    if (!task) throw new Error(`Unknown review task: ${taskId}`);
    if (task.artifact_hash !== artifactHash) throw new Error("Review task artifact hash changed before the decision was recorded.");
    const stamp = nowIso();
    this.db.prepare(`INSERT INTO review_decisions(decision_id, task_id, episode_id, artifact_hash, reviewer, decision, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(decisionId, taskId, episodeId, artifactHash, reviewer, decision, notes || null, stamp);
    const status = decision === "approved" ? "approved" : decision === "changes_requested" ? "changes_requested" : "rejected";
    this.upsertReviewTask({ ...task, status, completed_at: decision === "approved" ? stamp : null });
    return this.db.prepare("SELECT * FROM review_decisions WHERE decision_id = ?").get(decisionId);
  }

  listReviewDecisions(episodeId, taskId = null) {
    return taskId
      ? this.db.prepare("SELECT * FROM review_decisions WHERE episode_id = ? AND task_id = ? ORDER BY created_at DESC").all(episodeId, taskId)
      : this.db.prepare("SELECT * FROM review_decisions WHERE episode_id = ? ORDER BY created_at DESC").all(episodeId);
  }

  addReviewComment(comment) {
    const stamp = nowIso();
    this.db.prepare(`INSERT INTO review_comments(comment_id, task_id, episode_id, scene_id, timeline_seconds, artifact_name, artifact_hash, author, body, severity, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(comment.comment_id, comment.task_id, comment.episode_id, comment.scene_id || null,
        comment.timeline_seconds == null ? null : Number(comment.timeline_seconds), comment.artifact_name || null,
        comment.artifact_hash || null, comment.author, comment.body, comment.severity || "note", "open", stamp);
    return this.getReviewComment(comment.comment_id);
  }

  getReviewComment(commentId) {
    return this.db.prepare("SELECT * FROM review_comments WHERE comment_id = ?").get(commentId) || null;
  }

  listReviewComments(episodeId, { status = null, taskId = null } = {}) {
    if (taskId && status) return this.db.prepare("SELECT * FROM review_comments WHERE episode_id = ? AND task_id = ? AND status = ? ORDER BY created_at DESC").all(episodeId, taskId, status);
    if (taskId) return this.db.prepare("SELECT * FROM review_comments WHERE episode_id = ? AND task_id = ? ORDER BY created_at DESC").all(episodeId, taskId);
    if (status) return this.db.prepare("SELECT * FROM review_comments WHERE episode_id = ? AND status = ? ORDER BY created_at DESC").all(episodeId, status);
    return this.db.prepare("SELECT * FROM review_comments WHERE episode_id = ? ORDER BY created_at DESC").all(episodeId);
  }

  resolveReviewComment(commentId, resolvedBy) {
    const stamp = nowIso();
    this.db.prepare("UPDATE review_comments SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE comment_id = ?").run(stamp, resolvedBy, commentId);
    return this.getReviewComment(commentId);
  }

  saveReviewSnapshot(snapshotId, episodeId, snapshotType, snapshot, createdBy) {
    const stamp = nowIso();
    this.db.prepare(`INSERT INTO review_snapshots(snapshot_id, episode_id, snapshot_type, bundle_hash, snapshot_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(snapshotId, episodeId, snapshotType, snapshot.bundle_hash, JSON.stringify({ ...snapshot, snapshot_id: snapshotId, created_at: stamp }), createdBy, stamp);
    return this.getReviewSnapshot(snapshotId);
  }

  getReviewSnapshot(snapshotId) {
    const row = this.db.prepare("SELECT snapshot_json FROM review_snapshots WHERE snapshot_id = ?").get(snapshotId);
    return row ? JSON.parse(row.snapshot_json) : null;
  }

  listReviewSnapshots(episodeId, limit = 50) {
    return this.db.prepare("SELECT snapshot_json FROM review_snapshots WHERE episode_id = ? ORDER BY created_at DESC LIMIT ?").all(episodeId, Math.max(1, Math.min(Number(limit) || 50, 200))).map((row) => JSON.parse(row.snapshot_json));
  }

  recordFinalSignoff({ signoffId, episodeId, artifactName, artifactHash, reviewer, decision, notes = "" }) {
    const stamp = nowIso();
    this.db.prepare(`INSERT INTO final_signoffs(signoff_id, episode_id, artifact_name, artifact_hash, reviewer, decision, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(signoffId, episodeId, artifactName, artifactHash, reviewer, decision, notes || null, stamp);
    return this.db.prepare("SELECT * FROM final_signoffs WHERE signoff_id = ?").get(signoffId);
  }

  listFinalSignoffs(episodeId) {
    return this.db.prepare("SELECT * FROM final_signoffs WHERE episode_id = ? ORDER BY created_at DESC").all(episodeId);
  }

  savePublishingPackage(packageId, episodeId, studioId, publishingPackage) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT created_at FROM publishing_packages WHERE episode_id = ?").get(episodeId);
    this.db.prepare(`
      INSERT INTO publishing_packages(publishing_package_id, episode_id, studio_id, status, passed, package_hash, video_id, publishing_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(episode_id) DO UPDATE SET
        publishing_package_id = excluded.publishing_package_id,
        studio_id = excluded.studio_id,
        status = excluded.status,
        passed = excluded.passed,
        package_hash = excluded.package_hash,
        video_id = excluded.video_id,
        publishing_json = excluded.publishing_json,
        updated_at = excluded.updated_at
    `).run(packageId, episodeId, studioId || null, publishingPackage.status || "draft", publishingPackage.release_ready ? 1 : 0,
      publishingPackage.package_hash, publishingPackage.remote?.video_id || null, JSON.stringify(publishingPackage), existing?.created_at || stamp, stamp);
    return this.getPublishingPackageForEpisode(episodeId);
  }

  getPublishingPackageForEpisode(episodeId) {
    const row = this.db.prepare("SELECT publishing_json, created_at, updated_at FROM publishing_packages WHERE episode_id = ?").get(episodeId);
    return row ? { ...JSON.parse(row.publishing_json), created_at: row.created_at, updated_at: row.updated_at } : null;
  }

  listPublishingPackages(limit = 100) {
    return this.db.prepare("SELECT publishing_json, created_at, updated_at FROM publishing_packages ORDER BY updated_at DESC LIMIT ?")
      .all(Math.max(1, Math.min(Number(limit) || 100, 500)))
      .map((row) => ({ ...JSON.parse(row.publishing_json), created_at: row.created_at, updated_at: row.updated_at }));
  }

  recordPublishingEvent({ eventId, episodeId, action, status, provider = "youtube", details = {} }) {
    const stamp = nowIso();
    this.db.prepare(`INSERT INTO publishing_events(event_id, episode_id, action, status, provider, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(eventId, episodeId, action, status, provider, JSON.stringify(details), stamp);
    return { event_id: eventId, episode_id: episodeId, action, status, provider, details, created_at: stamp };
  }

  listPublishingEvents(episodeId, limit = 200) {
    return this.db.prepare("SELECT * FROM publishing_events WHERE episode_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(episodeId, Math.max(1, Math.min(Number(limit) || 200, 1000)))
      .map((row) => ({ ...row, details: JSON.parse(row.details_json || "{}") }));
  }

  saveYouTubeUploadSession({ sessionId, episodeId, sessionUrl, sessionUrlHash, totalBytes, uploadedBytes = 0, status = "initiated", videoId = null }) {
    const stamp = nowIso();
    const existing = this.db.prepare("SELECT created_at FROM youtube_upload_sessions WHERE episode_id = ?").get(episodeId);
    this.db.prepare(`
      INSERT INTO youtube_upload_sessions(session_id, episode_id, session_url, session_url_hash, total_bytes, uploaded_bytes, status, video_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(episode_id) DO UPDATE SET
        session_id = excluded.session_id,
        session_url = excluded.session_url,
        session_url_hash = excluded.session_url_hash,
        total_bytes = excluded.total_bytes,
        uploaded_bytes = excluded.uploaded_bytes,
        status = excluded.status,
        video_id = excluded.video_id,
        updated_at = excluded.updated_at
    `).run(sessionId, episodeId, sessionUrl, sessionUrlHash, Number(totalBytes || 0), Number(uploadedBytes || 0), status, videoId || null, existing?.created_at || stamp, stamp);
    return this.getYouTubeUploadSession(episodeId);
  }

  updateYouTubeUploadSession(episodeId, changes = {}) {
    const current = this.getYouTubeUploadSession(episodeId);
    if (!current) throw new Error(`No YouTube upload session exists for episode ${episodeId}.`);
    return this.saveYouTubeUploadSession({
      sessionId: current.session_id,
      episodeId,
      sessionUrl: changes.session_url || current.session_url,
      sessionUrlHash: changes.session_url_hash || current.session_url_hash,
      totalBytes: changes.total_bytes ?? current.total_bytes,
      uploadedBytes: changes.uploaded_bytes ?? current.uploaded_bytes,
      status: changes.status || current.status,
      videoId: changes.video_id ?? current.video_id
    });
  }

  getYouTubeUploadSession(episodeId) {
    return this.db.prepare("SELECT * FROM youtube_upload_sessions WHERE episode_id = ?").get(episodeId) || null;
  }

  audit({ episodeId = null, eventType, actor = "system", details = {} }) {
    this.db.prepare(`
      INSERT INTO audit_events(episode_id, event_type, actor, details_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(episodeId, eventType, actor, JSON.stringify(details), nowIso());
  }

  listAuditEvents(episodeId, limit = 200) {
    if (episodeId) {
      return this.db.prepare(`
        SELECT * FROM audit_events WHERE episode_id = ? ORDER BY event_id DESC LIMIT ?
      `).all(episodeId, Math.max(1, Math.min(Number(limit) || 200, 1000)));
    }
    return this.db.prepare("SELECT * FROM audit_events ORDER BY event_id DESC LIMIT ?")
      .all(Math.max(1, Math.min(Number(limit) || 200, 1000)));
  }
}

module.exports = { FoundryDatabase, nowIso };
