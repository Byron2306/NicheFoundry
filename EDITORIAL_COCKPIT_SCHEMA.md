# NicheFoundry Editorial Cockpit Schema 1.0


## Task and role coverage

The cockpit creates eight task types across seven populated role queues:

- `source_research`, Researcher, advisory
- `research_fact`, Fact Checker, mandatory
- `script_editorial`, Writer / Script Editor, mandatory
- `visual_editorial`, Visual Editor, mandatory
- `audio_preflight`, Audio Editor, mandatory
- `audio_performance`, Audio Editor, mandatory
- `render_programme`, Channel Owner, mandatory
- `release_compliance`, Publisher, mandatory

Separating source intake from fact approval prevents the person who gathered evidence from becoming the only authority who validates it.

## Review task

```json
{
  "task_id": "episode_id:script_editorial",
  "episode_id": "episode_id",
  "review_type": "script_editorial",
  "stage": "editorial",
  "role": "writer",
  "label": "Narrative and script edit",
  "priority": 85,
  "required": true,
  "status": "ready",
  "assignee": "Byron",
  "due_at": null,
  "artifact_hash": "sha256...",
  "artifacts": [
    {
      "relative_path": "script.md",
      "exists": true,
      "sha256": "sha256...",
      "size_bytes": 1234
    }
  ]
}
```

Allowed task states:

```text
pending
blocked
ready
approved
changes_requested
rejected
```

## Review comment

```json
{
  "comment_id": "review_comment_...",
  "task_id": "episode_id:render_programme",
  "episode_id": "episode_id",
  "scene_id": "scene_04",
  "timeline_seconds": 42.5,
  "artifact_name": "final.mp4",
  "artifact_hash": "sha256...",
  "author": "Byron",
  "body": "Caption enters before the spoken phrase.",
  "severity": "blocker",
  "status": "open"
}
```

Allowed severities:

```text
note
suggestion
blocker
```

## Review snapshot

```json
{
  "schema": "nichefoundry.review_snapshot.v1",
  "snapshot_id": "review_snapshot_...",
  "episode_id": "episode_id",
  "snapshot_type": "manual_editorial_checkpoint",
  "created_by": "Byron",
  "bundle_hash": "sha256...",
  "artifacts": []
}
```

## Final sign-off bundle

```json
{
  "schema": "nichefoundry.final_signoff_bundle.v1",
  "episode_id": "episode_id",
  "reviewer": "Byron",
  "review_coverage": {
    "required_count": 7,
    "approved_count": 7,
    "open_blocker_count": 0,
    "passed": true
  },
  "review_tasks": [],
  "open_blockers": [],
  "approvals": [],
  "delivery_artifacts": [],
  "complete": true,
  "bundle_hash": "sha256..."
}
```
