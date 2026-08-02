# Phase 9 Implementation Ledger

## Objective

Phase 9 implements the Scene Compositor and Render Engine. It converts the approved story, visual, and audio packages into real audiovisual programmes, captions, thumbnails, render evidence, and a separate human render approval.

The compositor follows one governing rule:

> A render is not complete because FFmpeg exited successfully. It is complete only when the expected programme decodes, contains the required streams, matches the approved plan, passes measured QA, and remains bound to the reviewed file hashes.

## Implemented components

### Render system engine

`lib/render_system.js` supplies:

- four render profiles
- studio-specific camera and transition grammar
- scene-level binding between story, visual, audio, evidence, captions, and motion
- SVG storyboard materialisation to raster frames
- scene-level H.264/AAC segment rendering
- deterministic segment fingerprints and cache reuse
- selective scene rerendering
- segment concatenation
- SRT caption generation
- embedded MP4 subtitle tracks
- 1280×720 PNG thumbnail delivery
- FFprobe stream and dimension validation
- duration-drift checks
- black-frame detection
- caption-track validation
- file-level SHA-256 evidence
- render approval bundle construction

### Render profiles

The engine ships with:

| Profile | Dimensions | Frame rate | Purpose |
|---|---:|---:|---|
| `proxy` | 960×540 | 24 fps | Fast editorial review |
| `final` | 1920×1080 | 30 fps | Long-form delivery master |
| `vertical_proxy` | 540×960 | 24 fps | Fast vertical review |
| `vertical_final` | 1080×1920 | 30 fps | Vertical delivery master |

Each profile records its CRF, encoder preset, audio bitrate, and expected output suffix. The plan hash changes when the profile changes.
Operator environment overrides may select a different valid FFmpeg preset or CRF for proxy and final work. The resolved values are written into the plan, so changing them invalidates the relevant segment fingerprints and approval evidence.

### Specialist camera grammar

The same compositor preserves different Studio Pack identities.

#### Failure Atlas

- `forensic_push`
- `load_path_drift`
- restrained fades and evidence-led movement

#### History Under Glass

- `museum_reveal`
- `archive_drift`
- slower object-centred movement

#### Practical Open Source

- `terminal_scan`
- `verification_lock`
- precise movement around commands and proof states

#### Puzzle Planet

- `expedition_surge`
- `map_glide`
- energetic but controlled adventure movement

The grammar is deterministic and scene-aware. A Studio Pack therefore remains visually recognisable after entering the shared rendering kernel.

### Render plan

`render_plan.json` binds every scene to:

- episode and Studio Pack
- render profile
- source script scene
- story beat
- visual asset and its provenance identity
- mastered audio asset
- caption text
- resolved scene duration
- camera grammar
- transition grammar
- evidence claim and source IDs
- segment fingerprint

The plan is validated before any asset path reaches FFmpeg. Relative paths are normalised, traversal is rejected, and all paths must resolve inside the episode directory.

### Captions

Phase 9 generates:

```text
captions.srt
caption_track.json
```

Narration is split into short readable cues. Cue timing is distributed inside the resolved scene duration, remains monotonic, and is checked against the final programme duration.

The SRT track remains available as a separate delivery artifact. The final MP4 also contains an embedded `mov_text` subtitle stream.

### Scene-level segments and partial rerendering

Each scene becomes an independent MP4 segment under:

```text
renders/segments/<profile>/
```

The segment fingerprint includes:

- visual file hash
- audio file hash
- profile
- scene duration
- camera grammar
- transition grammar
- caption text

An unchanged scene is reused. Passing selected scene IDs causes only those segments to be rebuilt before the programme is reconsolidated.

This allows a corrected illustration, narration line, caption, or camera direction to be replaced without rerendering unrelated scenes.

### Programme assembly

The compositor:

1. materialises the governed SVG storyboard at the selected target dimensions;
2. applies the Studio Pack camera grammar;
3. attaches the approved mastered scene audio;
4. renders an H.264/AAC scene segment;
5. reuses unchanged segments where their fingerprints remain current;
6. concatenates segments in the approved story order;
7. embeds the caption track;
8. writes the profile output;
9. creates or refreshes the delivery thumbnail;
10. performs independent render QA;
11. writes the asset hash ledger.

Profile outputs include:

```text
proxy.mp4
final.mp4
proxy_vertical.mp4
final_vertical.mp4
```

Only the selected profile is produced during a render job.

### Render QA

`render_qa_report.json` records:

- output path
- profile
- file size and bitrate
- video codec, dimensions, and frame rate
- audio codec, sample rate, and channels
- subtitle stream presence
- expected and actual duration
- duration-drift ratio
- scene and segment counts
- segment cache hits
- SRT cue count and final cue time
- black-frame intervals
- thumbnail dimensions, codec, and hash
- blocking issues
- editorial warnings

Blocking conditions include:

- output cannot be decoded
- missing video stream
- missing audio stream
- missing embedded subtitle stream
- wrong dimensions
- excessive duration drift
- broken or out-of-order captions
- detected black-frame failure
- missing or invalid thumbnail
- missing scene segment

### Artifact verification

`render_asset_hashes.json` contains independently verifiable hashes for:

- selected programme MP4
- captions SRT
- thumbnail PNG
- scene segments
- relevant render evidence files

The verifier recalculates hashes from disk. A post-render change causes verification and approval to fail.

### Separate render approval

Phase 9 adds a third human gate after editorial and audio approval.

A final render can be approved only when:

- the editorial approval is current;
- the audio-performance approval is current;
- the selected profile is `final`;
- `final.mp4` decodes;
- video, audio, and subtitle streams exist;
- captions and thumbnail verify;
- render QA passes;
- the render asset hash ledger verifies.

The approval binds `render_approval_bundle.json`. Changing the programme, captions, thumbnail, scene segment, plan, or QA evidence invalidates the approval.

### Truthful delivery gate

The episode reaches `ready_for_private_upload` only when all of the following are true:

```text
editorial approval current
+ audio approval current
+ final.mp4 verified
+ captions.srt verified
+ thumbnail.png verified
+ render QA passed
+ render approval current
```

A proxy render can be viewed, but it cannot satisfy the delivery gate.

### Persistence

The SQLite schema now contains:

```text
render_packages
render_assets
```

The database stores:

- episode and Studio Pack identity
- profile
- render plan hash
- pass state
- render package JSON
- segment assets
- delivery assets
- paths and hashes
- scene bindings
- creation and update timestamps

### Secure preview serving

`GET /api/render-assets/file` serves only registered render assets belonging to the selected episode.

The endpoint rejects:

- traversal attempts
- paths outside the episode
- unsupported media types
- unknown episodes
- unregistered files

### Programme Compositor dashboard

The Phase 9 cockpit displays:

- render profile selector
- complete render plan
- camera and transition grammar
- optional scene IDs for partial rerendering
- segment ledger and cache status
- caption-track evidence
- render QA
- programme video player
- final render approval evidence

### Command-line workflow

The compositor can also run without the dashboard:

```bash
node scripts/render_episode.js episodes/<episode-id> --profile proxy
node scripts/render_episode.js episodes/<episode-id> --profile final
node scripts/render_episode.js episodes/<episode-id> --profile final --scene scene_03 --scene scene_04
```

### Test isolation

Codec-heavy audio and render tests now run in isolated phase processes through `scripts/run_all_tests.sh`. This prevents inherited HTTP servers, codec subprocesses, or file handles from accumulating inside one long-lived Node test process.

## Tests

Phase 9 adds eight tests covering:

- all four render profiles
- four distinct Studio Pack camera grammars
- scene binding across story, visual, audio, motion, transitions, and captions
- unsafe path rejection
- real proxy rendering
- real 1920×1080 final rendering
- video, audio, and embedded subtitle streams
- SRT and PNG delivery artifacts
- partial scene rerendering and cache reuse
- render hash verification and mutation detection
- SQLite render package and segment persistence
- Programme Compositor DOM integrity
- guarded server planning, build, preview, persistence, and approval routes

The complete Phase 0 through Phase 9 release contains 63 tests.

## Honest boundary

Phase 9 produces real playable and independently verified programmes. Its default visual inputs remain governed Phase 7 storyboard assets, and its default local voice remains the Phase 8 reference performance unless a production provider or licensed import is used.

It does not yet provide:

- fully illustrated cinematic scenes
- archival footage licensing and restoration
- geographic data-driven map animation
- advanced character animation
- optical-flow or generative video
- professional colour grading
- broadcast waveform and gamut analysis
- multi-language caption and dub delivery
- complete private YouTube resumable upload and processing verification

Those are downstream production, editorial, publishing, and analytics concerns. Phase 9 establishes the trustworthy audiovisual assembly foundation they require.
