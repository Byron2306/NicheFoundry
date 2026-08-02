# Applio Cloud Training Guide

This project can prepare a training pack from approved ElevenLabs narration and
hand it off to Applio for cloud training.

## 1. Prepare the dataset

Run:

```bash
npm run prepare:applio-dataset
```

That creates:

```text
exports/applio_dataset/
├── wavs/
├── metadata.list
├── dataset_manifest.json
└── README.txt
```

The source clips are taken only from episodes whose
`audio_performance_report.json` says `provider = elevenlabs`.

## 2. Open the official Applio Colab

Use the official notebook linked from the Applio repository:

- GitHub: `IAHispano/Applio`
- Colab UI notebook: `assets/Applio.ipynb`

## 3. Upload the dataset folder

Upload the contents of `exports/applio_dataset/` into the notebook runtime or
mount Drive and copy the folder there.

Use the normalized WAV files under `wavs/` plus the text entries in
`metadata.list`.

## 4. Train the voice model

Inside Applio:

1. Create or select a project.
2. Point training to the uploaded WAV set.
3. Use the text metadata when the workflow asks for aligned text.
4. Start training on the cloud GPU.

## 5. Bring the model back locally

After training finishes:

1. Download the exported model files.
2. Store them in a dedicated local folder, for example:

```text
models/applio/<voice-name>/
```

3. Keep the model provenance note with the trained output.

## 6. Current NicheFoundry status

Today, on Sunday, August 2, 2026, NicheFoundry prepares the dataset pack but
does not yet run Applio inference directly. The recommended flow is:

1. Use `kokoro` for the immediate local narration path.
2. Train a stronger reusable voice in Applio cloud.
3. Then wire the trained model into the next inference adapter.

## Rights and consent

Only train on voice material you own, created, licensed, or have explicit
permission to clone.
