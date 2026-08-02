# Phase 8 Implementation Ledger

## Objective

Phase 8 implements the Audio, Host, and Performance Engine. It converts an approval-ready story package into a studio-native performance plan and, only after editorial approval, into measurable scene-level audio assets with deterministic caching, provenance, mastering, QA, and a separate human audio approval.

## Implemented components

### Audio system engine

`lib/audio_system.js` supplies:

- Studio-specific host defaults and Studio Pack overrides
- primary and secondary host profiles
- pronunciation detection and editorial overrides
- scene-level host assignment
- performance intention, pace, pitch, energy, amplitude, pauses, and emphasis
- deterministic scene cache keys
- studio-native music and sound-effect planning
- provider selection and execution
- scene-level audio mastering and mixing
- episode audio concatenation
- FFprobe stream verification
- EBU R128 loudness analysis
- timing-drift assessment
- asset hashes and provenance
- imported-audio record validation

### Specialist host identities

The built-in pilots use materially different performance grammar:

- Failure Atlas uses The Systems Investigator and Evidence Console. The performance reconstructs causality without spectacle and places deliberate pauses before findings and transferable design lessons.
- History Under Glass uses The Curator and Archive Voice. The performance preserves interpretive uncertainty and separates evidence labels from narrative interpretation.
- Practical Open Source uses The Maintainer and Terminal Voice. Commands, paths, validation results, failures, and recovery steps receive a distinct readout voice and deliberate action pauses.
- Puzzle Planet uses The Expedition Guide and Mission Computer. Mission prompts, progress markers, answer reveals, and educational payoffs receive controlled energy and clear reward timing.

### Pronunciation governance

The lexicon detects and records:

- known technical products and protocols
- acronyms
- command-line flags
- file and directory paths
- Studio Pack terminology
- operator-supplied overrides

Each entry records its source and whether human review remains required. The lexicon hash contributes to every scene cache key, so a pronunciation change invalidates only affected performances.

### Provider routing

Provider selection supports:

1. registered imported scene audio
2. Piper local speech
3. ElevenLabs remote speech
4. eSpeak deterministic reference speech

Imported audio is consumed only when it appears in `audio_imports.json` with a guarded path, creator, licence, rights state, and scene binding.

Piper is resolved from configured paths, the optional project tool directory, or the system path. ElevenLabs returns audio bytes that are written locally and converted into the common mastering format. eSpeak is retained as a deterministic offline reference and test fallback.

### Scene-level cache

Each cache key includes:

- spoken text after pronunciation substitution
- host identity
- pace
- pitch
- language
- pronunciation lexicon hash
- Studio Pack identity

Unchanged scenes reuse mastered narration while changed scenes are regenerated independently.

### Mastering and sound design

Narration is converted to 48 kHz mono masters with:

- high-pass filtering
- low-pass filtering
- compression
- loudness normalization

Each scene receives:

- a studio-specific procedural reference bed
- optional studio-specific effects
- narration-priority sidechain ducking
- a 48 kHz stereo WAV mix
- a 192 kbps MP3 mix

Scene mixes are concatenated into:

```text
audio/episode_audio_preview.wav
audio/episode_audio_preview.mp3
```

### Measured QA

The engine records:

- codec
- sample rate
- channel count
- duration
- integrated loudness
- loudness range
- true peak
- target versus resolved duration
- scene drift ratio
- provider
- cache hit
- host

Hard failures include invalid streams, extreme timing drift, and unsafe peak levels. Lesser timing or loudness deviations become visible warnings for human review.

### Two approval gates

Phase 8 deliberately separates approval into two stages.

#### Editorial approval

This binds the current:

```text
host_profile.json
pronunciation_lexicon.json
audio_performance_plan.json
sound_design_plan.json
audio_preflight_report.json
```

No audio synthesis API may run without a current editorial approval.

#### Audio-performance approval

After synthesis and QA, a separate approval binds:

```text
audio_manifest.json
audio_asset_hashes.json
loudness_report.json
audio_performance_report.json
audio_approval_bundle.json
```

The final compositor remains blocked until the audio-performance approval matches the current bundle hash.

### Persistence

The SQLite schema now contains:

```text
audio_packages
audio_assets
```

It stores host and performance plans, provider outcomes, pass state, file provenance, rights, hashes, and audio package history independently from the episode JSON.

### Secure preview and import handling

`GET /api/audio-assets/file` serves only registered WAV, MP3, M4A, or OGG files from an episode's guarded `audio/` or `imports/audio/` directories.

The API rejects:

- paths outside guarded directories
- traversal attempts
- unregistered audio
- unsupported media types
- unknown episodes

The import endpoint rejects missing files, unknown scenes, absent creator information, absent licences, and unresolved rights.

### Dashboard

The Performance Forge displays:

- host identity
- host direction
- pronunciation lexicon
- scene performance plan
- sound design plan
- audio preflight
- provider selector
- production controls
- scene audio assets
- full episode audio preview
- loudness and timing results
- import registration
- audio approval evidence

### Production compatibility

`audio_manifest.json` retains `target_audio` per scene so the downstream renderer can consume Phase 8 scene mixes without inventing paths or bypassing the asset ledger.

## Tests

Phase 8 adds eight tests covering:

- four distinct valid host and sound identities
- pronunciation detection and overrides
- host, timing, cache, and sound-plan coverage
- real eSpeak synthesis, FFmpeg mastering, full preview, hash verification, and cache reuse
- registered imported audio and rights rejection
- SQLite audio package and asset persistence
- Performance Forge DOM integrity
- HTTP planning, approval gating, audio-approval refusal, and path protection

The complete Phase 0 through Phase 8 suite contains 55 tests.

## Honest boundary

Phase 8 creates real audio files and measured audio evidence. eSpeak remains a deterministic reference voice. Piper quality depends on the chosen local model. ElevenLabs depends on operator credentials, account permissions, and voice rights. Procedural music and effects are reference production assets rather than a substitute for final commissioned sound design.

Final audiovisual compositing, frame-accurate caption alignment, animation, render mastering, delivery QA, and platform publication remain downstream phases.
