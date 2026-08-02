# NicheFoundry Audio System Schema 1.0

## Purpose

The Audio System Schema defines the host constitution, pronunciation ledger, scene-performance contract, sound-design plan, produced asset ledger, measured QA, and approval evidence used by NicheFoundry Phase 8.

## Studio Pack extension

A Studio Pack may include:

```json
{
  "audio_system": {
    "language": "en",
    "provider_order": ["imported", "piper", "elevenlabs", "espeak"],
    "host": {
      "id": "systems_investigator",
      "name": "The Systems Investigator",
      "style": "measured forensic narrator",
      "rate_wpm": 148,
      "pitch": 44,
      "amplitude": 158,
      "espeak_voice": "en-gb",
      "energy": 0.46
    },
    "secondary_host": {
      "id": "evidence_console",
      "name": "Evidence Console",
      "style": "brief neutral evidence readout"
    },
    "music": {
      "family": "low mechanical pulse",
      "base_hz": 82,
      "secondary_hz": 123,
      "bed_db": -34,
      "target_lufs": -16,
      "true_peak_db": -1.5
    },
    "sfx": {
      "default": "mechanical_marker",
      "frequency_hz": 220
    },
    "pronunciation_lexicon": []
  }
}
```

## `host_profile.json`

Required top-level fields:

```text
schema
studio_id
primary_host
secondary_host
voice_direction
profile_hash
```

A host records:

```text
id
name
style
tone
rate_wpm
pitch
amplitude
energy
language
provider_preferences
forbidden_traits
```

The secondary host also declares `permitted_uses`.

## `pronunciation_lexicon.json`

Required fields:

```text
schema
studio_id
language
pronunciation_domains
entries
unresolved_entries
lexicon_hash
```

Each entry records:

```text
term
spoken_form
source
review_required
notes
```

Supported entry origins include:

```text
builtin
detected_acronym
detected_flag
detected_path
studio_or_brief_override
```

## `audio_performance_plan.json`

Required top-level fields:

```text
schema
episode_id
studio_id
provider_policy
mastering
scenes
plan_hash
```

### Provider policy

```text
order
imported_assets_first
scene_level_cache
remote_provider_requires_secret
local_fallback
```

### Mastering contract

```text
sample_rate_hz
channels
narration_target_lufs
programme_target_lufs
true_peak_db
loudness_range_target
highpass_hz
lowpass_hz
```

### Scene performance

Each scene records:

```text
scene_id
story_beat
host_id
host_name
narration_text
spoken_text
target_duration_seconds
performance
cache_key
output
```

`performance` records:

```text
intention
pace_wpm
energy
pitch
amplitude
pause_before_ms
pause_after_ms
emphasis_words
forbidden_traits
```

`output` records deterministic relative paths for:

```text
narration_wav
scene_mix_wav
scene_mix_mp3
```

## `sound_design_plan.json`

Required fields:

```text
schema
studio_id
music_identity
sfx_identity
scenes
rights
sound_design_hash
```

Each scene records:

```text
scene_id
music_cue
music_family
sfx_cues
ducking
transition
disclosure
```

## `audio_preflight_report.json`

Required fields:

```text
passed
issues
warnings
scene_count
unique_host_count
pronunciation_entry_count
unresolved_pronunciation_count
checked_at
```

Preflight must pass before editorial approval can become production-authorizing evidence.

## `audio_imports.json`

Each registered import records:

```text
scene_id
relative_path
creator
licence
rights_status
notes
registered_at
sha256
```

The path must remain under `imports/audio/`. Rights must be `cleared` or `operator_declared`.

## `audio_manifest.json`

Required fields:

```text
schema
generated_at
provider
note
episode_preview
scenes
```

Each produced scene records:

```text
scene_id
host_id
provider
cache_hit
cache_key
target_duration_seconds
resolved_duration_seconds
duration_drift_ratio
narration_wav
target_audio
scene_mix_wav
probe
loudness
status
```

`target_audio` is the renderer-facing MP3 path.

## Audio asset record

Every asset records:

```text
asset_id
scene_id
asset_type
relative_path
provider
creator
rights_status
licence
source_relative_path
source_sha256
sha256
size_bytes
status
```

`source_relative_path` and `source_sha256` are populated for imported source performances.

## `audio_asset_hashes.json`

```text
schema
complete
assets[]
```

Each hash record contains:

```text
asset_id
relative_path
sha256
size_bytes
```

The evidence engine resolves each path inside the episode directory and independently recalculates its hash.

## `loudness_report.json`

Required fields:

```text
schema
target_lufs
true_peak_limit_dbfs
episode
scenes
```

Episode and scene measurements include:

```text
integrated_lufs
loudness_range_lu
true_peak_dbfs
duration_drift_ratio
```

## `audio_performance_report.json`

Required fields:

```text
schema
passed
issues
warnings
provider
scene_count
cache_hits
cache_hit_ratio
host_count
episode_duration_seconds
checked_at
```

## `audio_approval_bundle.json`

The bundle contains deterministic hashes for all current planning and production evidence. A human audio approval stores the SHA-256 of this bundle.

If any constituent artifact changes, the prior approval no longer matches and audio approval becomes invalid.

## Security invariants

- No audio path may escape the selected episode directory.
- The preview API serves only registered assets.
- Remote provider secrets remain environment variables and never enter manifests.
- Imported files require explicit provenance and rights.
- Provider success alone never marks audio QA passed.
- Final rendering requires current editorial and audio-performance approvals.
