import asyncio
import logging
from typing import AsyncGenerator, Optional
import edge_tts

logger = logging.getLogger(__name__)

class EdgeTTSClient:
    """
    Microsoft Edge TTS client supporting warm, natural Indic voices
    such as 'hi-IN-SwaraNeural' or 'hi-IN-MadhurNeural'.
    Streams raw MP3 audio chunks seamlessly to the client.
    """
    def __init__(self, voice: str = "hi-IN-SwaraNeural"):
        self.voice = voice

    async def synthesize_stream(self, text: str, voice: Optional[str] = None) -> AsyncGenerator[bytes, None]:
        chosen_voice = voice or self.voice
        if not text or not text.strip():
            return

        try:
            communicate = edge_tts.Communicate(text.strip(), chosen_voice)
            async for chunk in communicate.stream():
                if chunk["type"] == "audio" and chunk.get("data"):
                    yield chunk["data"]
        except Exception as e:
            logger.error(f"Error streaming from edge_tts ({chosen_voice}): {e}")
