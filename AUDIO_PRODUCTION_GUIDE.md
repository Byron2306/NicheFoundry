# NicheFoundry Audio Production Guide

## 1. Choose the provider deliberately

### Imported human or commissioned narration

Use imported narration when performance quality, language, character, or pronunciation requires a human recording or an external production workflow.

Place files under:

```text
episodes/<episode-id>/imports/audio/
```

Register every file through the Performance Forge with:

- scene ID
- creator or provider
- licence or ownership declaration
- rights status
- optional notes

The audio engine will not trust anonymous files merely because their filenames resemble scene IDs.

### Piper

Piper is the preferred offline production path when a suitable local model is installed.

Configure:

```text
PIPER_BIN=/path/to/piper
PIPER_MODEL_DIR=/path/to/model-directory
PIPER_MODEL_NAME=en_US-lessac-high
PIPER_MODEL_FILE=en_US-lessac-high.onnx
PIPER_CONFIG_FILE=en_US-lessac-high.onnx.json
```

Verify:

```bash
npm run check:environment
```

### Kokoro

Kokoro is the preferred local narration path when you want better natural speech
than eSpeak or a thin Piper setup without relying on cloud credits.

Install the runtime:

```bash
scripts/install_kokoro.sh
```

Configure when needed:

```text
KOKORO_COMMAND=/path/to/.venv-kokoro/bin/python
KOKORO_VOICE=af_heart
KOKORO_LANG_CODE=a
KOKORO_SPEED=1.0
```

Use it:

```bash
node scripts/build_audio_performance.js episodes/<episode-id> --provider kokoro --force
```

### Voicebox

Voicebox is the preferred packaged local cloning path when you want cloned
profiles through a maintained local app/backend instead of hand-wiring model
internals.

NicheFoundry talks to the local Voicebox API:

```text
VOICEBOX_API_URL=http://127.0.0.1:17493
VOICEBOX_PROFILE=<profile name or id>
VOICEBOX_ENGINE=qwen
VOICEBOX_MODEL_SIZE=0.6B
VOICEBOX_LANGUAGE=en
VOICEBOX_CLIENT_ID=nichefoundry
```

Build a reference sample from approved ElevenLabs narration first:

```bash
npm run build:voice-reference
```

Then sync that sample pack into a Voicebox profile after the Voicebox backend
is running:

```bash
npm run voicebox:sync-profile -- "NicheFoundry Narrator"
```

Use it:

```bash
node scripts/build_audio_performance.js episodes/<episode-id> --provider voicebox --force
```

### OpenVoice

OpenVoice is a secondary local clone/reference path. It uses local TTS
for the words, then converts the tone toward an approved reference sample.

Build the reference sample from already-approved ElevenLabs clips:

```bash
npm run build:voice-reference
```

Install the OpenVoice runtime:

```bash
scripts/install_openvoice.sh
```

Then place the OpenVoice `checkpoints_v2` folder under:

```text
vendor/OpenVoice/checkpoints_v2
```

Configure when needed:

```text
OPENVOICE_COMMAND=/path/to/.venv-openvoice/bin/python
OPENVOICE_REPO=/path/to/OpenVoice
OPENVOICE_CHECKPOINT=/path/to/OpenVoice/checkpoints_v2
OPENVOICE_REFERENCE_AUDIO=/path/to/assets/voices/elevenlabs_curator/reference.wav
OPENVOICE_LANGUAGE=EN_NEWEST
```

Use it only when you explicitly want tone-color transfer:

```bash
node scripts/build_audio_performance.js episodes/<episode-id> --provider openvoice --force
```

Only use reference samples from voices you own, created, licensed, or have
explicit permission to clone.

### ElevenLabs

Configure a private `.env`:

```text
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

Never place credentials in Studio Packs, episode JSON, Git, screenshots, or connector definitions.

Confirm that the selected voice and account permissions permit the intended commercial use.

### eSpeak reference

The local eSpeak adapter is designed for:

- deterministic development
- pronunciation checks
- timing checks
- audio-pipeline validation
- offline testing

It is not presented as a premium final voice.

Configure a non-default binary when needed:

```text
ESPEAK_BIN=/usr/local/bin/espeak
```

## 2. Review before synthesis

Before editorial approval, inspect:

- primary and secondary host identity
- tone and forbidden traits
- host assignment per scene
- narration text and spoken text
- pronunciation entries requiring review
- pacing and pause instructions
- target scene durations
- music and effects cues
- rights policy

Correct the script or lexicon before synthesis. Editing either after approval invalidates the approval.

## 3. Build audio

From the dashboard, choose a provider and select **Build Audio**.

From the command line:

```bash
node scripts/build_audio_performance.js episodes/<episode-id> --provider auto
```

`auto` currently prefers:

```text
imported -> voicebox -> kokoro -> piper -> elevenlabs -> openvoice -> espeak
```

Explicit provider examples:

```bash
node scripts/build_audio_performance.js episodes/<episode-id> --provider voicebox
node scripts/build_audio_performance.js episodes/<episode-id> --provider kokoro
node scripts/build_audio_performance.js episodes/<episode-id> --provider openvoice
node scripts/build_audio_performance.js episodes/<episode-id> --provider piper
node scripts/build_audio_performance.js episodes/<episode-id> --provider elevenlabs
node scripts/build_audio_performance.js episodes/<episode-id> --provider espeak
```

Force regeneration:

```bash
node scripts/build_audio_performance.js episodes/<episode-id> --provider piper --force
```

## 4. Understand the output tree

```text
audio/
├── cache/
│   └── <scene-cache-key>.wav
├── narration/
│   └── <number>_<scene-id>.wav
├── scenes/
│   ├── <number>_<scene-id>.wav
│   └── <number>_<scene-id>.mp3
├── episode_audio_preview.wav
└── episode_audio_preview.mp3
```

The cache stores mastered narration only. Music and effects are remixed so changes to sound design do not require unnecessary voice synthesis.

## 6. Prepare a cloud training pack

When you want a durable cloned voice instead of instant local narration, prepare
an Applio training pack from already-approved ElevenLabs material:

```bash
npm run prepare:applio-dataset
```

This writes:

```text
exports/applio_dataset/
├── wavs/
├── metadata.list
├── dataset_manifest.json
└── README.txt
```

Use only rights-cleared voices. Upload that folder into the Applio Google Colab
training workflow when you are ready to build a reusable model.

## 5. Review measured QA

### Stream contract

Every scene mix should be:

```text
48,000 Hz
2 channels
valid decodable audio
```

### Loudness

Review:

- integrated loudness
- loudness range
- true peak
- consistency between scenes

The engine records reference targets, but final acceptance remains an editorial decision informed by the programme, destination, and listening context.

### Timing drift

The report compares planned and resolved duration.

- small drift is expected because spoken performance has real duration
- drift above 20% becomes a warning
- drift above 50% becomes a blocking issue

Fix large drift by revising wording, pace, scene timing, or narration rather than blindly time-stretching speech.

### Pronunciation

Listen specifically for:

- names
- dates
- version numbers
- acronyms
- command flags
- file paths
- measurements
- specialist vocabulary

Update `pronunciation_overrides` or the Studio Pack lexicon and rebuild affected scenes.

### Music and effects

Procedural beds and cues are reference assets. Confirm that they:

- do not mask narration
- suit the Studio Pack identity
- do not trivialise serious content
- support transitions rather than announce every sentence
- remain replaceable by cleared final assets

## 6. Approve audio separately

After reviewing the full preview and reports, record the audio-performance approval in the Performance Forge.

Approval binds the current audio bundle hash. Rebuilding, replacing, or editing audio invalidates that approval.

The final compositor should accept only:

```text
editorial approval valid
audio production QA passed
audio approval valid
```

## 7. Troubleshooting

### No provider available

Run:

```bash
npm run check:environment
```

Install eSpeak or Piper, configure ElevenLabs, or register imported scene audio.

### Piper unavailable

Check:

- binary path
- model directory
- `.onnx` model filename
- `.onnx.json` configuration filename
- executable permissions

### ElevenLabs HTTP failure

Check:

- API key
- voice ID
- model ID
- account quota and permissions
- outbound HTTPS

The job ledger records the failure. A failed request does not create successful audio evidence.

### Audio import ignored

Confirm:

- it is inside `imports/audio/`
- it was registered
- its scene ID matches the performance plan
- the file exists
- rights and licence fields are present
- audio was rebuilt after registration

### Hash verification failure

Do not edit generated audio files in place. Either rebuild them or register a replacement through the governed workflow so hashes and approvals update together.
