# NicheFoundry Render Production Guide

## Required toolchain

- Node.js 22+
- FFmpeg
- FFprobe
- an approved Phase 7 visual package
- approved Phase 8 scene audio

Verify the machine:

```bash
npm run check:environment
npm run check:render
```

## Dashboard workflow

1. Generate and review the evidence-bound episode.
2. Approve the editorial bundle.
3. Build and review scene audio.
4. Approve the audio-performance bundle.
5. Open **Programme Compositor**.
6. Select `proxy` and build the editorial programme.
7. Watch the complete proxy, inspect captions, transitions, motion, sound, and scene order.
8. Correct individual visual or audio assets where required.
9. Enter selected scene IDs to rerender only corrected scenes.
10. Build the `final` profile.
11. Inspect the final render QA report.
12. Watch the final programme from beginning to end.
13. Approve the exact final render bundle.
14. Continue to the private-upload stage only while all three approvals remain current.

## Command-line workflow

Build a proxy:

```bash
node scripts/render_episode.js episodes/<episode-id> --profile proxy
```

Build the final 1920×1080 programme:

```bash
node scripts/render_episode.js episodes/<episode-id> --profile final
```

Rerender selected scenes and reconsolidate:

```bash
node scripts/render_episode.js episodes/<episode-id> \
  --profile final \
  --scene scene_05 \
  --scene scene_11
```

Force every segment to rebuild:

```bash
node scripts/render_episode.js episodes/<episode-id> --profile final --force
```

## Encoder overrides

The built-in profile defaults are recommended for normal work. Constrained machines and smoke tests can override the FFmpeg preset and CRF through private environment configuration:

```text
FOUNDRY_PROXY_RENDER_PRESET=veryfast
FOUNDRY_FINAL_RENDER_PRESET=medium
FOUNDRY_PROXY_RENDER_CRF=28
FOUNDRY_FINAL_RENDER_CRF=20
```

Valid presets range from `ultrafast` to `veryslow`. CRF must be between 0 and 51. The resolved values are written into the render plan and therefore alter segment fingerprints and approval evidence.

## Output layout

```text
episodes/<episode-id>/
├── proxy.mp4
├── final.mp4
├── captions.srt
├── thumbnail.png
├── caption_track.json
├── render_plan.json
├── render_manifest_v2.json
├── render_asset_hashes.json
├── render_qa_report.json
├── render_approval_bundle.json
└── renders/
    ├── frames/
    └── segments/
        ├── proxy/
        └── final/
```

Only files created for profiles that have actually been rendered will exist.

## Partial rerendering

Use partial rerendering when:

- a scene illustration changes;
- one narration line is corrected;
- a caption is corrected;
- a scene transition changes;
- a camera direction changes.

Unchanged segment fingerprints produce cache hits. The final programme is still rebuilt from the ordered segment list so the output and approval hash remain deterministic.

## QA interpretation

### Blocking issues

Do not approve when the report contains:

- missing video or audio stream
- missing embedded subtitles
- wrong target resolution
- excessive duration drift
- black-frame intervals
- invalid captions
- invalid thumbnail
- missing segments
- hash mismatch

### Warnings

Warnings require editorial judgement. Examples include:

- small duration difference
- a caption close to the end boundary
- unexpectedly low bitrate
- high segment-cache miss rate after a small edit

A warning is not automatically harmless. It means the engine found something measurable that does not cross a hard technical threshold.

## Caption review

Review both:

```text
captions.srt
caption_track.json
```

Check:

- names and specialist terms
- punctuation
- line length
- reading speed
- cue boundaries
- correspondence with spoken audio
- whether on-screen text duplicates captions awkwardly

Embedded subtitles provide a player-selectable track. The separate SRT remains the publishing and accessibility artifact.

## Proxy versus final

Use `proxy` for repeated editorial cycles. It is smaller and faster but uses the same scene order, audio, captions, and camera logic.

Use `final` only after the proxy is editorially stable. Final approval is unavailable for proxy outputs.

## Vertical profiles

`vertical_proxy` and `vertical_final` produce 9:16 programmes. The current engine adapts the governed storyboard to the vertical canvas. A future visual phase may add fully independent vertical composition planning for complex scenes.

## Approval invalidation

The render approval becomes stale when any bound item changes, including:

- render plan
- profile
- scene segment
- final programme
- captions
- thumbnail
- render QA
- asset hash ledger

Rebuild, rewatch, and reapprove after a change.

## Performance notes

Rendering is CPU-intensive. For longer programmes:

- use proxy first;
- rely on segment caching;
- rerender selected scenes;
- use a faster FFmpeg preset for review;
- preserve the episode `renders/segments/` cache;
- avoid deleting mastered scene audio between visual revisions.

## Honest use of generated previews

The default Phase 7 SVG frames are production storyboards. They can create a valid and coherent programme, but final publication may require licensed archival imagery, original illustrations, real screen recordings, maps, or commissioned assets. Replace them through the governed asset workflow before final approval where the Studio Pack requires richer media.
