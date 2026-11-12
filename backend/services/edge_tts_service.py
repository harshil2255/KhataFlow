import asyncio
import logging
from typing import Optional
import edge_tts

logger = logging.getLogger(__name__)

class EdgeTTSClient:
    """
    Microsoft Edge TTS client supporting warm, natural Indic voices
    such as 'hi-IN-SwaraNeural' or 'hi-IN-MadhurNeural'.
    Synthesizes complete MP3 audio buffer to prevent stuttering/jitter in browsers.
    """
    def __init__(self, voice: str = "hi-IN-SwaraNeural"):
        self.voice = voice

    async def synthesize(self, text: str, voice: Optional[str] = None) -> bytes:
        chosen_voice = voice or self.voice
        if not text or not text.strip():
            return b""

        try:
            communicate = edge_tts.Communicate(text.strip(), chosen_voice)
            audio_buffer = bytearray()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio" and chunk.get("data"):
                    audio_buffer.extend(chunk["data"])
            return bytes(audio_buffer)
        except Exception as e:
            logger.error(f"Error synthesizing edge_tts ({chosen_voice}): {e}")
            return b""
