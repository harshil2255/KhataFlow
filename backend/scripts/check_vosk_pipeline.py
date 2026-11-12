"""End-to-end offline check: WAV -> GnaniSTTClient Vosk decode -> intent parse."""
import asyncio
import os
import sys
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from backend.services.gnani_stt import GnaniSTTClient  # noqa: E402
from backend.services.intent_engine import IntentEngine  # noqa: E402


def read_pcm(path):
    with wave.open(path, "rb") as w:
        return w.readframes(w.getnframes())


def main(wav):
    pcm = read_pcm(wav)
    client = GnaniSTTClient()
    client.set_vocab_hints(["Pooja Patel", "Ramesh Gupta", "Ramesh Verma", "Suresh Sharma", "Mukesh Bhai"])
    text = client._vosk_recognize_sync(pcm)
    print("transcript:", repr(text))
    if not text:
        return
    result = asyncio.run(IntentEngine().extract_intent(text))
    print("actions:", [(a.action, a.customer, a.amount, a.date) for a in result.actions])


if __name__ == "__main__":
    main(sys.argv[1])
