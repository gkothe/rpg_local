"""Duration and real local Whisper smoke tests; no request-time downloads."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from transcribe import validate_audio, transcribe


class AudioTests(unittest.TestCase):
    def test_decoded_duration_limit_before_model_inference(self):
        with tempfile.TemporaryDirectory(prefix="rpg-audio-test-") as work:
            filename = str(Path(work) / "too-long.wav")
            with wave.open(filename, "wb") as recording:
                recording.setnchannels(1)
                recording.setsampwidth(2)
                recording.setframerate(16000)
                recording.writeframes(b"\x00\x00" * (16000 * 121))
            with self.assertRaisesRegex(ValueError, "120 seconds"):
                validate_audio(filename)

    def test_language_and_missing_model_fail_without_download(self):
        with self.assertRaisesRegex(ValueError, "language"):
            transcribe("unused.wav", "invalid")
        with tempfile.TemporaryDirectory(prefix="rpg-model-test-") as empty:
            with self.assertRaisesRegex(ValueError, "local model"):
                transcribe("unused.wav", "en", empty)

    @unittest.skipUnless(os.environ.get("RPG_AUDIO_TEST_FILE") and os.environ.get("RPG_WHISPER_MODEL_PATH"), "Set an explicit synthetic speech file and local model for real inference")
    def test_actual_local_whisper_transcription(self):
        result = transcribe(os.environ["RPG_AUDIO_TEST_FILE"], "en")
        text = result["text"].lower()
        self.assertIn("old tower", text)
        self.assertIn("healing potion", text)
        self.assertIn("health points", text)


if __name__ == "__main__":
    unittest.main()
