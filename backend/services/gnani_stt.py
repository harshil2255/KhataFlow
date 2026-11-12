import os
import json
import io
import re
import wave
import asyncio
import logging
from typing import Callable, Optional, Awaitable, Any, Tuple, List
import websockets
import httpx

try:  # Python 3.13 removed audioop; audioop-lts provides a shim.
    import audioop
except ImportError:  # pragma: no cover
    audioop = None

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None

try:
    import speech_recognition as sr
except ImportError:  # pragma: no cover
    sr = None

logger = logging.getLogger(__name__)

# Google's public STT endpoint is frequently blocked on corporate/ISP networks
# and SpeechRecognition's recognizer has no built-in timeout. Once it fails we
# disable it for the process lifetime so every utterance does not stall.
_GOOGLE_STT_DISABLED = False

# Canonical phrase used only when no real STT engine is reachable. It keeps the
# end-to-end demo functional offline while being clearly labelled as simulated.
_SIMULATED_TRANSCRIPT = "Ramesh ka 350 udhaar, kal 200 diya tha"

# A kirana ledger utterance is a tiny closed vocabulary, so constraining the
# small offline acoustic models to domain phrases is dramatically more accurate
# than open dictation ("put your patel at her one hundred fifty" -> "pooja
# patel one hundred fifty"). Customer names are added at runtime as hints.
_DOMAIN_TOKENS = [
    # Names / surnames seen in the ledger (runtime hints add more).
    "pooja", "puja", "patel", "patil", "ramesh", "suresh", "mukesh", "anita",
    "vijay", "rahul", "amit", "gupta", "verma", "sharma", "bhai",
    # Ledger verbs
    "udhaar", "udhar", "udaar", "udar", "credit", "debit", "baaki", "baki",
    "diya", "dia", "jama", "jamaa", "paid", "payment", "bhara", "chukaya",
    "likh", "likho", "le", "gaya", "liya", "kitna", "total", "hisaab", "hisab",
    # Dates / fillers
    "kal", "kaal", "aaj", "parso", "tha", "hai", "ka", "ki", "ke", "ne", "ko",
    "aur", "rupees", "rupaye", "rs",
    # Spoken numbers (English + Hinglish) so amounts survive as words.
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "fifteen", "twenty", "thirty", "forty",
    "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand",
    "ek", "do", "teen", "char", "chaar", "panch", "paanch", "chhe", "saat",
    "aath", "nau", "das", "bees", "pachas", "pachaas", "sau", "hazaar", "hazar",
]

_DOMAIN_KEYWORDS = {
    "udhaar", "udhar", "udaar", "udar", "credit", "baaki", "baki",
    "diya", "dia", "jama", "jamaa", "paid", "payment", "bhara", "chukaya",
}
_DOMAIN_NAMES = {
    "pooja", "puja", "patel", "patil", "ramesh", "suresh", "mukesh", "anita",
    "vijay", "rahul", "amit", "gupta", "verma", "sharma", "bhai",
}


def _build_vosk_grammar(name_hints: List[str]) -> List[str]:
    """Phrases that constrain the decode. Multi-word names are kept together."""
    phrases: List[str] = []
    for hint in name_hints:
        words = [w for w in re.findall(r"[a-z]+", hint.lower()) if w]
        if words:
            phrases.append(" ".join(words))
            phrases.extend(words)
    for token in _DOMAIN_TOKENS:
        phrases.append(token)
    return list(dict.fromkeys(phrases))


def _score_transcript(text: str) -> int:
    """Reward ledger-like output so the best of several decodes wins."""
    lower = text.lower()
    if not lower.strip():
        return -100
    points = 0
    for token in _DOMAIN_NAMES:
        if token in lower:
            points += 4
    for token in _DOMAIN_KEYWORDS:
        if token in lower:
            points += 3
    points += 2 * min(4, sum(ch.isdigit() for ch in text))
    if lower.count("[unk]") == 0:
        points += 2
    else:
        points -= 3 * lower.count("[unk]")
    return points

# ---- Local Vosk recognizer (fully offline, no API key) ----------------------
# Model directories are looked up under backend/models/ by default. A shared
# singleton avoids loading acoustic models on every utterance. Multiple models
# (e.g. Hindi + Indian English) can be loaded and the best transcript is chosen.
_VOSK_MODELS: dict[str, Any] = {}
_VOSK_LOAD_FAILED = False
_VOSK_LOCK: Any = None


def _discover_vosk_model_paths() -> List[str]:
    override = os.environ.get("VOSK_MODEL_PATH")
    if override:
        return [override] if os.path.isdir(override) else []

    models_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
    if not os.path.isdir(models_dir):
        return []

    def rank(name: str) -> tuple:
        low = name.lower()
        if "en-in" in low:
            return (0, name)
        if "-hi-" in low or "hindi" in low:
            return (1, name)
        if "en-us" in low or "en-gb" in low:
            return (2, name)
        return (3, name)

    names = sorted(os.listdir(models_dir), key=rank)
    paths = []
    for name in names:
        path = os.path.join(models_dir, name)
        if name.startswith("vosk-model") and os.path.isdir(path):
            paths.append(path)
    return paths


def vosk_available() -> bool:
    if _VOSK_MODELS:
        return True
    if _VOSK_LOAD_FAILED:
        return False
    try:
        import vosk  # noqa: F401
    except ImportError:
        return False
    return bool(_discover_vosk_model_paths())


def get_vosk_models() -> dict[str, Any]:
    global _VOSK_LOAD_FAILED, _VOSK_LOCK
    if _VOSK_MODELS or _VOSK_LOAD_FAILED:
        return _VOSK_MODELS

    import threading

    if _VOSK_LOCK is None:
        _VOSK_LOCK = threading.Lock()

    with _VOSK_LOCK:
        if _VOSK_MODELS or _VOSK_LOAD_FAILED:
            return _VOSK_MODELS

        paths = _discover_vosk_model_paths()
        if not paths:
            _VOSK_LOAD_FAILED = True
            return _VOSK_MODELS

        try:
            import vosk

            vosk.SetLogLevel(-1)
        except Exception as e:
            logger.warning(f"Vosk import failed: {e}")
            _VOSK_LOAD_FAILED = True
            return _VOSK_MODELS

        for path in paths:
            name = os.path.basename(path)
            try:
                logger.info(f"Loading local Vosk model {name} ...")
                _VOSK_MODELS[name] = vosk.Model(path)
            except Exception as e:
                logger.warning(f"Could not load Vosk model {name}: {e}")

        if not _VOSK_MODELS:
            _VOSK_LOAD_FAILED = True
        else:
            logger.info(f"Offline Vosk STT ready: {list(_VOSK_MODELS)}")
        return _VOSK_MODELS


class GnaniSTTClient:
    """
    Gnani Prisma v3.0 Speech-to-Text WebSocket Client.

    Recognizer priority when a recording finishes:
      1. Gnani streaming STT (if GNANI_API_KEY is configured)
      2. Groq Whisper (if GROQ_API_KEY is configured) - real offline-safe HTTP STT
      3. Google Web Speech (bounded by a short timeout; skipped once it fails)
      4. Energy-gated simulated transcript (explicitly labelled "simulated")

    Raw 16 kHz/16-bit mono PCM from the AudioWorklet is always buffered so any
    of these paths can run when the user releases the mic.
    """

    MAX_BUFFER_BYTES = 16000 * 2 * 30  # 30 seconds of audio

    def __init__(
        self,
        api_key: Optional[str] = None,
        language_code: str = "hi-IN",
        sample_rate: int = 16000,
        ws_url: str = "wss://api.vachana.ai/stt/v3/stream",
    ):
        self.api_key = api_key or os.environ.get("GNANI_API_KEY", "")
        self.language_code = os.environ.get("GNANI_LANGUAGE_CODE", language_code)
        self.sample_rate = sample_rate
        self.ws_url = os.environ.get("GNANI_STT_WS_URL", ws_url)
        self.ws: Optional[Any] = None
        self.is_connected = False
        self.receive_task: Optional[asyncio.Task] = None
        self.on_transcript_callback: Optional[Callable[[str, bool], Awaitable[None]]] = None
        self._pcm_buffer = bytearray()
        self._recognizer = sr.Recognizer() if sr else None
        self.received_final = False
        self.last_stt_source: str = "none"
        self.last_rms: int = 0
        # Customer names from the ledger, used to constrain offline decoding.
        self.vocab_hints: List[str] = []

    def set_vocab_hints(self, names: List[str]) -> None:
        self.vocab_hints = [n for n in (names or []) if n]

    @property
    def mode(self) -> str:
        if self.is_connected:
            return "gnani"
        if os.environ.get("GROQ_API_KEY") and not os.environ.get("GROQ_API_KEY", "").startswith("your_"):
            return "groq_whisper"
        if vosk_available():
            return "vosk"
        return "local_fallback"

    async def connect(self, on_transcript: Callable[[str, bool], Awaitable[None]]) -> bool:
        """Open a persistent WebSocket to Gnani Prisma STT v3.0."""
        self.on_transcript_callback = on_transcript
        self._pcm_buffer.clear()
        self.received_final = False

        if not self.api_key or self.api_key.startswith("your_"):
            logger.info(
                "Gnani API key not configured. Server-side fallback STT initialized (%s).",
                self.mode,
            )
            self.is_connected = False
            return False

        headers = {
            "x-api-key-id": self.api_key,
            "model": "prisma-v3.0",
            "language_code": self.language_code,
            "x-sample-rate": str(self.sample_rate),
        }

        try:
            self.ws = await websockets.connect(
                self.ws_url,
                additional_headers=headers,
                ping_interval=20,
                ping_timeout=10,
                open_timeout=5,
            )
            self.is_connected = True
            logger.info("Connected to Gnani Prisma v3.0 STT WebSocket.")
            self.receive_task = asyncio.create_task(self._listen_loop())
            return True
        except Exception as e:
            logger.warning(f"Could not connect to Gnani STT live WebSocket: {e}. Fallback active.")
            self.is_connected = False
            return False

    async def send_pcm_chunk(self, chunk: bytes):
        """Stream a 16 kHz 16-bit mono PCM frame and keep a local copy for fallback."""
        if not chunk:
            return

        # Always buffer (bounded) so we can recover if streaming STT is silent.
        self._pcm_buffer.extend(chunk)
        if len(self._pcm_buffer) > self.MAX_BUFFER_BYTES:
            del self._pcm_buffer[: len(self._pcm_buffer) - self.MAX_BUFFER_BYTES]

        if self.is_connected and self.ws:
            try:
                await self.ws.send(chunk)
            except Exception as e:
                logger.error(f"Error streaming audio frame to Gnani STT: {e}")
                self.is_connected = False

    async def finish_and_transcribe(self) -> Optional[str]:
        """
        Called when the mic recording session ends. Runs the best available
        recognizer against the buffered PCM and invokes the transcript callback.
        """
        # If Gnani already delivered a final transcript, do not transcribe twice.
        if self.is_connected and self.received_final:
            self._pcm_buffer.clear()
            self.last_stt_source = "gnani"
            return None

        if len(self._pcm_buffer) < 3200:  # < ~0.1 s of audio
            self._pcm_buffer.clear()
            self.last_stt_source = "silence"
            return None

        pcm_data = bytes(self._pcm_buffer)
        self._pcm_buffer.clear()

        # Trim leading/trailing silence to improve accuracy and skip noise.
        trimmed = self._trim_silence(pcm_data)
        if not trimmed:
            self.last_stt_source = "silence"
            logger.info("STT skipped: buffer contains no speech above the noise floor.")
            return None

        self.last_rms = self._rms(trimmed)
        wav_bytes = self._wrap_wav(trimmed)

        text, source = await self._recognize(wav_bytes, trimmed)
        self.last_stt_source = source

        if text:
            logger.info("STT (%s) recognized: '%s'", source, text)
            if self.on_transcript_callback:
                await self.on_transcript_callback(text, True)
            return text

        logger.info("STT produced no transcript (source=%s, rms=%s).", source, self.last_rms)
        return None

    async def _recognize(self, wav_bytes: bytes, pcm_data: bytes) -> Tuple[Optional[str], str]:
        """Run the recognizer chain, returning (text, source)."""
        # 1. Groq Whisper: reliable real transcription without Google.
        groq_text = await self._groq_whisper(wav_bytes)
        if groq_text:
            return groq_text, "groq_whisper"

        allow_simulated = os.environ.get("ALLOW_SIMULATED_STT", "true").lower() != "false"

        # 2. Local Vosk model: fully offline, no API key or network required.
        if vosk_available():
            vosk_text = await self._vosk_recognize(pcm_data)
            if vosk_text:
                return vosk_text, "vosk"

        has_cloud_key = bool(
            (os.environ.get("GROQ_API_KEY") and not os.environ.get("GROQ_API_KEY", "").startswith("your_"))
            or (os.environ.get("GNANI_API_KEY") and not os.environ.get("GNANI_API_KEY", "").startswith("your_"))
        )

        # 3. Google Web Speech with a hard wall-clock timeout. In pure offline
        #    demo mode (no keys, simulation allowed) skip it: the browser's own
        #    SpeechRecognition already failed on the same blocked endpoint, so
        #    probing it would only add latency to every first utterance.
        if not allow_simulated or has_cloud_key:
            google_text = await self._google_speech(wav_bytes)
            if google_text:
                return google_text, "google"

        # 4. Explicit offline simulation: only when the audio really contains
        #    speech energy, and clearly flagged as simulated.
        if allow_simulated and self.last_rms >= 250:
            logger.warning(
                "No real STT engine available; returning SIMULATED transcript for demo audio (rms=%s).",
                self.last_rms,
            )
            return _SIMULATED_TRANSCRIPT, "simulated"

        return None, "unavailable"

    async def _vosk_recognize(self, pcm_data: bytes) -> Optional[str]:
        """Transcribe 16 kHz mono s16le PCM with the local Vosk model."""
        loop = asyncio.get_running_loop()
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._vosk_recognize_sync, pcm_data),
                timeout=20.0,
            )
        except asyncio.TimeoutError:
            logger.warning("Local Vosk recognition timed out.")
            return None
        except Exception as e:
            logger.warning(f"Local Vosk recognition failed: {e}")
            return None

    def _vosk_recognize_sync(self, pcm_data: bytes) -> Optional[str]:
        """Decode with every local model, free-form *and* grammar-constrained.

        Small offline models are weak at open dictation but very good when the
        vocabulary is restricted to ledger phrases, so both decodes are run and
        the candidate that looks most like a ledger command wins.
        """
        import vosk

        grammar = _build_vosk_grammar(self.vocab_hints)
        candidates: List[tuple[int, int, str, str]] = []  # (score, is_grammar, model, text)

        def build_grammar_for(model: Any) -> Optional[str]:
            """Keep only phrases whose words exist in this model's vocabulary."""
            def known(word: str) -> bool:
                try:
                    return model.vosk_model_find_word(word) >= 0
                except Exception:
                    return True

            phrases: List[str] = []
            for phrase in grammar:
                if all(known(w) for w in phrase.split()):
                    phrases.append(phrase)
            if not phrases:
                return None
            return json.dumps(phrases + ["[unk]"])

        def decode(model: Any, grammar_json: Optional[str]) -> str:
            rec = (
                vosk.KaldiRecognizer(model, self.sample_rate, grammar_json)
                if grammar_json
                else vosk.KaldiRecognizer(model, self.sample_rate)
            )
            rec.SetWords(False)
            # Feed in 4 KB frames to keep memory flat for long utterances.
            for i in range(0, len(pcm_data), 4096):
                rec.AcceptWaveform(pcm_data[i : i + 4096])
            return (json.loads(rec.FinalResult() or "{}").get("text") or "").strip()

        tasks: List[tuple[str, Any, Optional[str], bool]] = []
        for name, model in get_vosk_models().items():
            is_hindi = "-hi-" in name.lower() or "hindi" in name.lower()
            # The Hindi model's vocabulary is Devanagari; a Latin grammar would
            # leave it with nothing to decode.
            model_grammar = None if is_hindi else build_grammar_for(model)
            tasks.append((name, model, None, False))
            if model_grammar:
                tasks.append((name, model, model_grammar, True))

        def run_task(task: tuple[str, Any, Optional[str], bool]):
            name, model, grammar_json, constrained = task
            try:
                return decode(model, grammar_json), name, constrained
            except Exception as e:
                logger.warning(f"Vosk[{name}] decode failed (grammar={constrained}): {e}")
                return "", name, constrained

        # Models are independent, so decode them concurrently; this keeps the
        # recording-stop latency around one model instead of all of them.
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=max(1, len(tasks))) as pool:
            decoded = list(pool.map(run_task, tasks))

        for text, name, constrained in decoded:
            if not text:
                continue
            logger.info(f"Vosk[{name}{' +grammar' if constrained else ''}] heard: {text!r}")
            candidates.append((_score_transcript(text), 1 if constrained else 0, name, text))

        if not candidates:
            return None

        candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
        best = candidates[0]
        logger.info(
            "Vosk picked '%s' from %s (score=%s, grammar=%s)",
            best[3], best[2], best[0], bool(best[1]),
        )
        return best[3]

    async def _groq_whisper(self, wav_bytes: bytes) -> Optional[str]:
        key = os.environ.get("GROQ_API_KEY", "")
        if not key or key.startswith("your_"):
            return None

        url = "https://api.groq.com/openai/v1/audio/transcriptions"
        headers = {"Authorization": f"Bearer {key}"}
        # Newest turbo model first, then the stable model as a compatibility fallback.
        for model in ("whisper-large-v3-turbo", "whisper-large-v3"):
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=4.0)) as client:
                    resp = await client.post(
                        url,
                        headers=headers,
                        files={"file": ("audio.wav", wav_bytes, "audio/wav")},
                        data={"model": model, "response_format": "json", "temperature": "0"},
                    )
                    if resp.status_code == 404 or resp.status_code == 400:
                        logger.debug("Groq model %s rejected (%s); trying next.", model, resp.status_code)
                        continue
                    resp.raise_for_status()
                    text = (resp.json().get("text") or "").strip()
                    if text:
                        return text
                    return None
            except Exception as e:
                logger.warning(f"Groq Whisper STT failed (model={model}): {e}")
        return None

    async def _google_speech(self, wav_bytes: bytes) -> Optional[str]:
        global _GOOGLE_STT_DISABLED
        if _GOOGLE_STT_DISABLED or not self._recognizer:
            return None

        def _run_sync() -> Optional[str]:
            try:
                with sr.AudioFile(io.BytesIO(wav_bytes)) as source:
                    audio = self._recognizer.record(source)
                for lang in ("hi-IN", "en-IN", "en-US"):
                    try:
                        result = self._recognizer.recognize_google(audio, language=lang)
                        if result:
                            return result
                    except sr.UnknownValueError:
                        continue
                    except sr.RequestError as e:
                        logger.warning(f"Google STT request error ({lang}): {e}")
                        break
            except Exception as e:
                logger.warning(f"Google STT decode error: {e}")
            return None

        loop = asyncio.get_running_loop()
        try:
            return await asyncio.wait_for(loop.run_in_executor(None, _run_sync), timeout=4.0)
        except asyncio.TimeoutError:
            _GOOGLE_STT_DISABLED = True
            logger.warning(
                "Google STT timed out (network blocked). Disabling it for this process; "
                "configure GROQ_API_KEY for real transcription."
            )
            return None
        except Exception as e:
            logger.warning(f"Google STT failed: {e}")
            return None

    def _wrap_wav(self, pcm_data: bytes) -> bytes:
        wav_io = io.BytesIO()
        with wave.open(wav_io, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(self.sample_rate)
            wav_file.writeframes(pcm_data)
        return wav_io.getvalue()

    def _rms(self, pcm_data: bytes) -> int:
        if audioop is not None:
            try:
                return int(audioop.rms(pcm_data, 2))
            except Exception:
                pass
        if np is not None:
            try:
                samples = np.frombuffer(pcm_data, dtype="<i2").astype(np.float32)
                if samples.size:
                    return int(np.sqrt(np.mean(samples * samples)))
            except Exception:
                pass
        return 0

    def _trim_silence(self, pcm_data: bytes, threshold: int = 250, frame_ms: int = 20) -> bytes:
        """Remove leading/trailing silence using frame-level RMS VAD."""
        if np is None:
            return pcm_data
        try:
            samples = np.frombuffer(pcm_data, dtype="<i2")
            frame = max(1, int(self.sample_rate * frame_ms / 1000))
            frame_count = len(samples) // frame
            if frame_count < 2:
                return pcm_data

            frames = samples[: frame_count * frame].reshape(frame_count, frame).astype(np.float32)
            rms = np.sqrt(np.mean(frames * frames, axis=1))
            voiced = np.where(rms > threshold)[0]
            if len(voiced) == 0:
                return b""
            start = max(0, int(voiced[0]) - 2)
            end = min(frame_count, int(voiced[-1]) + 3)
            return frames[start:end].astype("<i2").tobytes()
        except Exception as e:
            logger.debug(f"Silence trimming skipped: {e}")
            return pcm_data

    async def _listen_loop(self):
        """Receive streaming partial & final transcripts from Gnani Prisma STT."""
        try:
            while self.is_connected and self.ws:
                msg = await self.ws.recv()
                if isinstance(msg, str):
                    try:
                        data = json.loads(msg)
                        transcript = data.get("transcript") or data.get("text") or ""
                        is_final = bool(data.get("is_final", False))
                        if is_final and transcript:
                            self.received_final = True
                        if transcript and self.on_transcript_callback:
                            await self.on_transcript_callback(transcript, is_final)
                    except json.JSONDecodeError:
                        if self.on_transcript_callback:
                            await self.on_transcript_callback(msg, False)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Gnani STT listen loop exception: {e}")
        finally:
            self.is_connected = False

    async def close(self):
        self.is_connected = False
        if self.receive_task:
            self.receive_task.cancel()
            self.receive_task = None
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
            self.ws = None
        self._pcm_buffer.clear()

    async def disconnect(self):
        await self.close()
