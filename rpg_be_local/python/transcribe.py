"""Local-only FasterWhisper transcription. Models must already be downloaded."""
import json
import os
import sys

MAX_SECONDS = 120


def validate_audio(filename):
    import av
    with av.open(filename) as recording:
        seconds = 0.0
        for frame in recording.decode(audio=0):
            if not frame.sample_rate:
                raise ValueError("Audio has no valid sample rate")
            seconds += frame.samples / frame.sample_rate
            if seconds > MAX_SECONDS:
                raise ValueError("Recording exceeds 120 seconds")
        if seconds == 0:
            raise ValueError("Recording contains no audio")
    return seconds


def transcribe(filename, language, model_path=None):
    if language not in ("en", "pt", "auto"):
        raise ValueError("Unsupported transcription language")
    model_path = model_path or os.environ.get("RPG_WHISPER_MODEL_PATH", "")
    if not os.path.isdir(model_path) or not os.path.isfile(os.path.join(model_path, "model.bin")):
        raise ValueError("Pre-downloaded local model directory required")
    validate_audio(filename)
    from faster_whisper import WhisperModel
    model = WhisperModel(
        model_path, device=os.environ.get("RPG_WHISPER_DEVICE", "cpu"),
        compute_type="int8", local_files_only=True,
    )
    segments, _ = model.transcribe(
        filename, language=None if language == "auto" else language, beam_size=5,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    if not text:
        raise ValueError("No recognizable speech; record again or type your action")
    return {"text": text}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        print(json.dumps(transcribe(sys.argv[1], sys.argv[2]), ensure_ascii=False))
    except Exception:
        print("Local transcription failed; check the pre-downloaded model, audio format, speech and 120-second recording limit", file=sys.stderr)
        sys.exit(1)
