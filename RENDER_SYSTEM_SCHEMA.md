# NicheFoundry Render System Schema 1.0

## Purpose

The Render System Schema defines how approved story, visual, and audio evidence becomes a reproducible audiovisual programme.

## Render plan

```json
{
  "schema": "nichefoundry.render_plan.v1.0",
  "episode_id": "episode_...",
  "studio_id": "failure_atlas",
  "title": "The Bridge That Twisted Itself Apart",
  "output_format": "long_form",
  "profile": {
    "id": "final",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "crf": 20,
    "preset": "medium",
    "audio_bitrate": "192k"
  },
  "scenes": [],
  "plan_hash": "sha256..."
}
```

## Scene record

```json
{
  "scene_id": "scene_03",
  "sequence": 3,
  "story_beat": "cascading_failure",
  "title": "When Motion Fed Itself",
  "visual_asset_id": "visual_scene_03",
  "visual_path": "visuals/scenes/scene_03.svg",
  "visual_sha256": "sha256...",
  "audio_asset_id": "audio_scene_03",
  "audio_path": "audio/scenes/03_scene_03.wav",
  "audio_sha256": "sha256...",
  "duration_seconds": 12.41,
  "caption_text": "The airflow changed and each movement fed the next.",
  "claim_ids": ["claim_12"],
  "source_ids": ["source_4"],
  "camera": {
    "id": "forensic_push",
    "zoom_rate": 0.0007,
    "max_zoom": 1.09,
    "pan_x": "center",
    "pan_y": "center"
  },
  "transition": {
    "id": "forensic_fade",
    "fade_in_seconds": 0.22,
    "fade_out_seconds": 0.28
  }
}
```

## Render profiles

Valid profile IDs:

```text
proxy
final
vertical_proxy
vertical_final
```

Profile dimensions and frame rates are fixed by the executable registry. Unknown profiles are rejected.

## Caption track

`caption_track.json` contains:

```json
{
  "schema": "nichefoundry.caption_track.v1.0",
  "cue_count": 18,
  "cues": [
    {
      "index": 1,
      "scene_id": "scene_01",
      "start_seconds": 0.25,
      "end_seconds": 3.8,
      "text": "At first, the bridge behaved like a flexible machine."
    }
  ]
}
```

Rules:

- cue start and end values are monotonic;
- end must be greater than start;
- cue text may not be empty;
- cue timing may not exceed the programme duration beyond a small tolerance;
- the SRT file and JSON cue ledger describe the same programme.

## Render manifest

`render_manifest_v2.json` records:

- schema version
- profile
- programme output
- render-plan hash
- FFmpeg configuration
- ordered scene segment records
- segment fingerprints
- cache hit state
- caption and thumbnail paths
- creation timestamp

## Segment record

```json
{
  "scene_id": "scene_03",
  "segment_path": "renders/segments/final/003_scene_03.mp4",
  "segment_sha256": "sha256...",
  "segment_fingerprint": "sha256...",
  "segment_cache_hit": true,
  "duration_seconds": 12.41,
  "profile_id": "final"
}
```

## Render QA report

`render_qa_report.json` contains:

```json
{
  "schema": "nichefoundry.render_qa_report.v1.0",
  "passed": true,
  "profile_id": "final",
  "output": "final.mp4",
  "probe": {
    "duration_seconds": 482.14,
    "size_bytes": 91392841,
    "bit_rate": 1516423,
    "streams": []
  },
  "expected_duration_seconds": 481.93,
  "duration_drift_ratio": 0.00044,
  "scene_count": 32,
  "segment_count": 32,
  "segment_cache_hits": 29,
  "embedded_subtitles": true,
  "captions": {},
  "black_intervals": [],
  "thumbnail": {},
  "issues": [],
  "warnings": [],
  "checked_at": "ISO-8601"
}
```

## Render asset hashes

`render_asset_hashes.json` contains one record per governed output:

```json
{
  "asset_id": "render_final_programme",
  "asset_type": "programme_video",
  "scene_id": null,
  "relative_path": "final.mp4",
  "sha256": "sha256...",
  "size_bytes": 91392841,
  "media_type": "video/mp4",
  "status": "ready"
}
```

The ledger may include programme video, captions, thumbnail, scene segments, and evidence files.

## Approval bundle

`render_approval_bundle.json` binds the current final delivery package. Its file list contains at least:

```text
render_plan.json
caption_track.json
render_manifest_v2.json
render_asset_hashes.json
render_qa_report.json
final.mp4
captions.srt
thumbnail.png
```

The bundle is complete only when every file exists and its current hash can be calculated.

## State requirements

A final programme is upload-ready only when:

```text
editorial approval valid
AND audio approval valid
AND final programme verified
AND captions verified
AND thumbnail verified
AND render QA passed
AND render approval valid
```

## Security rules

- all input and output paths must be relative to the episode directory;
- `..` traversal is rejected;
- only registered render assets may be previewed;
- FFmpeg never receives an unvalidated episode-relative path;
- a proxy profile cannot satisfy final delivery approval;
- changing a governed file invalidates its bundle hash.
