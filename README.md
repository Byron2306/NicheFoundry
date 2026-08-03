# NicheFoundry

<p align="center">
  <img src="ChatGPT Image Aug 3, 2026, 12_30_06 PM.png" width="620" style="max-width: 92%; height: auto;">
</p>

NicheFoundry is a local-first faceless YouTube production system.

It takes a topic from research to a governed production pipeline that can:

- discover and filter video opportunities
- run public research and source capture
- generate studio-aligned scripts and visual plans
- build themed slide and image assets
- synthesize narration with multiple voice providers
- render edited videos locally with captions and thumbnails
- prepare publishing metadata and compliance bundles
- upload privately to YouTube with resumable transfer

The project is designed to keep strong provenance around each stage. Research, script decisions, visuals, audio, renders, and publishing state are all tracked as separate evidence, not treated as one vague “done” flag.

## What Is In This Repo

- the local Node.js application and UI
- the studio-pack system for different channel formats
- the pipeline scripts for research, story, visuals, audio, render, and publishing
- documentation for schemas and operational guides
- local integration helpers for Gamma, YouTube, ElevenLabs, Voicebox, Kokoro, OpenVoice, Piper, Ollama, and Jamendo

This repo intentionally does not include bulky generated media, local databases, virtual environments, or secrets.

## Main Capabilities

- `History Under Glass`: documentary-style history video pipeline
- `Puzzle Planet`: quiz and puzzle video pipeline
- `Failure Atlas`: failure-case and systems breakdown pipeline
- `Practical Open Source`: educational software pipeline

Core production subsystems include:

- opportunity and audience analysis
- connector-based research
- structured story and script generation
- visual planning and asset provenance
- host profile and pronunciation planning
- local or hybrid narration generation
- local compositing and render QA
- publishing compliance and YouTube upload support

## Stack

- Node.js for the app, orchestration, and CLI workflow
- FFmpeg/FFprobe for audio and video processing
- local Python environments for voice systems
- Google / YouTube APIs for publishing and discovery
- optional local model routing through Ollama

## Quick Start

1. Install dependencies.
2. Copy `.env.example` to `.env`.
3. Fill in the integrations you want to use.
4. Run environment checks.
5. Start the local app.

```bash
npm install
cp .env.example .env
node scripts/check_environment.js
npm start
```

Open:

```text
http://127.0.0.1:4173
```

## Important Environment Variables

Research and publishing:

- `YOUTUBE_API_KEY`
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`
- `GITHUB_TOKEN`

Visual generation:

- `GAMMA_API_KEY`

Voice and narration:

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `VOICEBOX_API_URL`
- `VOICEBOX_PROFILE`
- `VOICEBOX_ENGINE`
- `VOICEBOX_MODEL_SIZE`
- `KOKORO_COMMAND`
- `OPENVOICE_COMMAND`

Local generation:

- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`

## Recommended Workflow

1. Start the app and confirm connectors and studios are detected.
2. Create or select a studio.
3. Run research and opportunity analysis.
4. Generate the brief, story, and visuals.
5. Build narration and audio performance.
6. Render locally and inspect the result.
7. Prepare the publishing package.
8. Upload privately to YouTube when approved.

## Voice Systems

NicheFoundry supports multiple narration paths.

- `Voicebox`: local cloned-voice path, now wired as the preferred local clone route
- `Kokoro`: local lightweight TTS fallback
- `OpenVoice`: local conversion-based clone route
- `Piper`: local deterministic narration fallback
- `ElevenLabs`: remote premium narration option

The current local-first preference order is:

```text
imported -> voicebox -> kokoro -> piper -> elevenlabs -> openvoice -> espeak
```

## Repo Notes

- Generated episode media is ignored.
- Runtime databases and caches are ignored.
- Secrets are ignored.
- External vendor code may be present locally for development, but this repository is intended to stay focused on the NicheFoundry system itself.

## Key Docs

- `AUDIO_PRODUCTION_GUIDE.md`
- `RENDER_PRODUCTION_GUIDE.md`
- `PUBLISHING_AND_COMPLIANCE_GUIDE.md`
- `CONNECTOR_BUILD_GUIDE.md`
- `ASSET_PROVENANCE_GUIDE.md`
- `PHASE_11_IMPLEMENTATION.md`

## Current Status

As of Sunday, August 2, 2026, this local workspace includes:

- the simplified research/build UI work
- improved theme-aware scripting and visuals
- local Voicebox integration for cloned narration
- music sourcing integration work
- YouTube publishing support through governed private upload

## Security

Do not commit:

- `.env`
- OAuth tokens
- API keys
- generated private media
- local voice reference assets you do not want distributed
