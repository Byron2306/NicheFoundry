#!/usr/bin/env python3
import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Synthesize narration with Kokoro.")
    parser.add_argument("--text-file", required=True, help="Path to UTF-8 text file.")
    parser.add_argument("--output", required=True, help="Output WAV path.")
    parser.add_argument("--voice", default="af_heart", help="Kokoro voice id.")
    parser.add_argument("--lang-code", default="a", help="Kokoro language code, e.g. a for American English.")
    parser.add_argument("--speed", type=float, default=1.0, help="Speech speed multiplier.")
    args = parser.parse_args()

    text_file = Path(args.text_file).resolve()
    output = Path(args.output).resolve()
    if not text_file.exists():
        raise SystemExit(f"Text file is missing: {text_file}")

    text = text_file.read_text(encoding="utf-8").strip()
    if not text:
        raise SystemExit("Text file is empty.")

    try:
        import numpy as np
        import soundfile as sf
        from kokoro import KPipeline
    except Exception as exc:
        raise SystemExit(f"Kokoro import failed. Install the Kokoro runtime first. Detail: {exc}")

    pipeline = KPipeline(lang_code=args.lang_code)
    chunks = []
    sample_rate = 24000
    for _graphemes, _phonemes, audio in pipeline(text, voice=args.voice, speed=args.speed):
        if audio is None:
            continue
        chunks.append(np.asarray(audio, dtype=np.float32))
    if not chunks:
        raise SystemExit("Kokoro returned no audio chunks.")

    rendered = np.concatenate(chunks).astype(np.float32)
    output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output), rendered, sample_rate, subtype="PCM_16")


if __name__ == "__main__":
    main()
