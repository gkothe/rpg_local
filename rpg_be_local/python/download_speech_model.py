"""Explicit one-time public model download; never called during transcription."""
import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--model", default="base", choices=("tiny", "base", "small"))
    args = parser.parse_args()
    from faster_whisper.utils import download_model
    download_model(args.model, output_dir=str(args.destination.resolve()), use_auth_token=False)
    print(f"Downloaded {args.model} to {args.destination.resolve()}")


if __name__ == "__main__":
    main()
