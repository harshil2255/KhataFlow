"""End-to-end WebSocket test: stream a WAV's PCM as a voice session.

Usage:
  python backend/scripts/ws_e2e_test.py <wav> [ws_url]

Prints every server message type it sees plus the final ledger state. Restore
khataflow.db afterwards if this mutates real data.
"""
import asyncio
import json
import sys
import wave

import websockets


def read_pcm(path):
    with wave.open(path, "rb") as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1
        return w.readframes(w.getnframes())


async def main(wav, url):
    pcm = read_pcm(wav)
    async with websockets.connect(url, max_size=None) as ws:
        initial = json.loads(await ws.recv())
        print("initial:", initial.get("type"))

        await ws.send(json.dumps({"type": "START_VOICE_SESSION"}))
        started = json.loads(await ws.recv())
        print("started:", started)

        for i in range(0, len(pcm), 3200):
            await ws.send(pcm[i : i + 3200])
            await asyncio.sleep(0.02)

        await ws.send(json.dumps({"type": "STOP_VOICE_SESSION"}))

        done = False
        while not done:
            msg = await asyncio.wait_for(ws.recv(), timeout=30)
            if isinstance(msg, bytes):
                continue
            data = json.loads(msg)
            mtype = data.get("type")
            if mtype == "TRANSCRIPT_STREAM":
                print("transcript:", data.get("transcript"), "| source:", data.get("stt_source"))
            elif mtype == "INTENT_EXTRACTED":
                print("actions:", [
                    (a.get("action"), a.get("customer"), a.get("amount"))
                    for a in data.get("payload", {}).get("actions", [])
                ])
            elif mtype == "LEDGER_UPDATE":
                print("ledger_update:", json.dumps(data.get("data", {}))[:900])
                done = True
            elif mtype in ("STT_ERROR", "STT_NO_SPEECH"):
                print("stt failure:", data)
                done = True
            elif mtype in ("AUDIO_RESPONSE_COMPLETE", "LATENCY_METRIC"):
                continue
            else:
                print("msg:", mtype)


if __name__ == "__main__":
    wav = sys.argv[1]
    url = sys.argv[2] if len(sys.argv) > 2 else "ws://127.0.0.1:8000/ws"
    asyncio.run(main(wav, url))
