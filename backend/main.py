import os
import json
import time
import base64
import asyncio
import logging
from typing import Dict, Any, List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from backend.database.ledger import LedgerManager, init_db
from backend.services.intent_engine import IntentEngine
from backend.services.gnani_stt import GnaniSTTClient, vosk_available
from backend.services.gnani_tts import GnaniTTSClient
from backend.database.models import ActionItem, IntentResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("KhataFlowBackend")

ledger_manager = LedgerManager()
intent_engine = IntentEngine()
tts_client = GnaniTTSClient()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database
    await init_db()
    logger.info("SQLite ledger initialized successfully.")
    yield

app = FastAPI(title="KhataFlow API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory connected UI clients for broadcasting live ledger updates
connected_clients: List[WebSocket] = []

async def broadcast_ledger_state():
    """Broadcasts current ledger customers and recent transactions to all connected browser clients."""
    customers = await ledger_manager.get_all_customers()
    transactions = await ledger_manager.get_recent_transactions(limit=12)
    payload = json.dumps({
        "type": "LEDGER_UPDATE",
        "data": {
            "customers": customers,
            "transactions": transactions
        }
    })
    for client in list(connected_clients):
        try:
            await client.send_text(payload)
        except Exception:
            connected_clients.remove(client)

@app.get("/api/health")
async def health_check():
    gnani_configured = bool(os.environ.get("GNANI_API_KEY") and not os.environ.get("GNANI_API_KEY", "").startswith("your_"))
    groq_configured = bool(os.environ.get("GROQ_API_KEY") and not os.environ.get("GROQ_API_KEY", "").startswith("your_"))
    return {
        "status": "healthy",
        "service": "KhataFlow Backend",
        "groq_configured": groq_configured,
        "gnani_configured": gnani_configured,
        "stt_mode": "gnani" if gnani_configured else ("groq_whisper" if groq_configured else ("vosk" if vosk_available() else "local_fallback")),
        "simulated_stt_allowed": os.environ.get("ALLOW_SIMULATED_STT", "true").lower() != "false",
    }

@app.get("/api/ledger")
async def get_ledger():
    customers = await ledger_manager.get_all_customers()
    transactions = await ledger_manager.get_recent_transactions(limit=15)
    return {"customers": customers, "transactions": transactions}

class ExecuteActionRequest(BaseModel):
    action: str
    customer: Optional[str] = None
    amount: Optional[float] = None
    notes: Optional[str] = None
    target: Optional[str] = "total"

@app.post("/api/action")
async def execute_manual_action(req: ExecuteActionRequest):
    """Execute action directly (useful for tests or quick manual action)"""
    action_item = ActionItem(
        action=req.action,
        customer=req.customer,
        amount=req.amount,
        notes=req.notes or "",
        target=req.target or "total"
    )
    result_text, status = await process_action_item(action_item)
    await broadcast_ledger_state()
    return {"status": status, "spoken_text": result_text}

async def process_action_item(action: ActionItem) -> tuple[str, str]:
    """
    Executes a single parsed action against the ledger state machine.
    Returns (spoken_indic_response, status_code).
    """
    act = action.action.upper()

    # 0. Check if user is resolving a pending disambiguation
    pending = ledger_manager.get_pending_disambiguation()
    if pending and (act == "DISAMBIGUATION_RESPONSE" or action.customer or action.notes):
        reply_text = (action.customer or action.notes or "").lower()
        candidates = pending.get("candidates", [])
        matched = None
        for c in candidates:
            if c["name"].lower() in reply_text or (c["phone"] and c["phone"][-4:] in reply_text):
                matched = c
                break
            # check last name, e.g., "gupta" or "verma"
            for part in c["name"].lower().split():
                if part in reply_text:
                    matched = c
                    break
            if matched:
                break
        
        if matched:
            ledger_manager.set_pending_disambiguation(None)
            tx_type = pending.get("action", "CREDIT")
            amt = pending.get("amount", 0.0)
            note = pending.get("notes", "Udhaar samaan")
            _, new_bal = await ledger_manager.record_transaction(
                customer_id=matched["id"],
                amount=amt,
                tx_type=tx_type,
                notes=note
            )
            return f"{matched['name']} ka {int(amt)} rupaye darj ho gaya. Ab total {int(new_bal)} rupaye baaki hai.", "RECORDED"

    # 1. Spoken correction
    if act == "CORRECTION":
        if action.amount is not None:
            updated_info, msg = await ledger_manager.handle_spoken_correction(action.amount)
            if updated_info:
                return msg, "CORRECTED"
            return msg or "Koi record nahi mila.", "ERROR"
        return "Naya amount samajh nahi aaya.", "ERROR"

    # 2. Query balance
    if act == "QUERY_BALANCE":
        bal, spoken = await ledger_manager.query_balance(
            customer_name=action.customer,
            target=action.target or "total"
        )
        return spoken, "QUERIED"

    # 3. Add Credit or Record Payment
    if act in ["ADD_CREDIT", "RECORD_PAYMENT"]:
        cust_name = action.customer
        if not cust_name or cust_name.lower() in ["unknown", "kisi", "none"]:
            return "Kripya grahak ka naam batayein.", "NEED_CUSTOMER"

        # Look up matching customers
        candidates = await ledger_manager.find_customers_by_name(cust_name)

        # Disambiguation check: If there are multiple candidates, pick the first active one by default
        # while informing the user, so the voice action never silently stops!
        if len(candidates) > 1 and not action.phone:
            # Pick the primary matching customer (e.g. Ramesh Gupta who already has active balance)
            customer = candidates[0]
            logger.info(f"Multiple customers for '{cust_name}': {[c['name'] for c in candidates]}. Defaulting to {customer['name']}")
        elif len(candidates) == 1:
            customer = candidates[0]
        else:
            customer = await ledger_manager.get_or_create_customer(cust_name, action.phone)

        amt = action.amount or 0.0
        tx_type = "CREDIT" if act == "ADD_CREDIT" else "PAYMENT"
        note = action.notes or ("Udhaar samaan" if tx_type == "CREDIT" else "Udhaar chukta")

        _, new_balance = await ledger_manager.record_transaction(
            customer_id=customer["id"],
            amount=amt,
            tx_type=tx_type,
            notes=note
        )

        if tx_type == "CREDIT":
            spoken = f"{customer['name']} ka {int(amt)} rupaye udhaar darj ho gaya. Ab total {int(new_balance)} rupaye baaki hai."
        else:
            spoken = f"{customer['name']} se {int(amt)} rupaye jama ho gaye. Ab total {int(new_balance)} rupaye baaki hai."

        return spoken, "RECORDED"

    return "Aapka aadesh samajh nahi aaya. Kripya dobara bole.", "UNKNOWN"

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Main real-time bidirectional WebSocket connecting Next.js browser client to KhataFlow.
    Handles:
    - Audio PCM chunks from AudioWorklet
    - Gnani STT streaming transcripts
    - Groq Intent Extraction
    - Smart Ledger updates
    - Gnani TTS synthesis streaming back
    - Latency benchmarking
    """
    await websocket.accept()
    connected_clients.append(websocket)
    logger.info("Browser client connected to KhataFlow WebSocket.")

    # Send initial ledger state
    try:
        customers = await ledger_manager.get_all_customers()
        transactions = await ledger_manager.get_recent_transactions(limit=15)
        await websocket.send_text(json.dumps({
            "type": "INITIAL_STATE",
            "data": {
                "customers": customers,
                "transactions": transactions
            }
        }))
    except Exception as e:
        logger.warning(f"Could not send initial state to client: {e}")
        if websocket in connected_clients:
            connected_clients.remove(websocket)
        return

    has_spoken_first_disclosure = False
    active_stt_client: Optional[GnaniSTTClient] = None
    session_had_client_transcript = False
    last_processed_transcript: Optional[str] = None
    last_processed_at = 0.0

    async def send_tts_response(spoken_text: str, start_time: float):
        """Synthesize spoken text and stream audio chunks to client, calculating latency."""
        # Calculate time-to-first-audio (TTFA)
        first_chunk_sent = False
        try:
            async for audio_chunk in tts_client.synthesize_stream(spoken_text):
                if not first_chunk_sent:
                    ttfa_ms = int((time.time() - start_time) * 1000)
                    first_chunk_sent = True
                    await websocket.send_text(json.dumps({
                        "type": "LATENCY_METRIC",
                        "ttfa_ms": ttfa_ms,
                        "target_latency": "< 1500 ms",
                        "status": "PASS" if ttfa_ms < 1500 else "WARN"
                    }))

                # Send audio chunk as base64 raw PCM (16k mono s16le)
                await websocket.send_text(json.dumps({
                    "type": "AUDIO_RESPONSE_CHUNK",
                    "audio_base64": base64.b64encode(audio_chunk).decode("utf-8"),
                    "sample_rate": 16000,
                    "spoken_text": spoken_text
                }))
        except Exception as e:
            logger.error(f"TTS streaming error: {e}")
        finally:
            # Always close the playback stream so the client can reset its queue.
            try:
                await websocket.send_text(json.dumps({
                    "type": "AUDIO_RESPONSE_COMPLETE",
                    "spoken_text": spoken_text
                }))
            except Exception:
                pass

    async def handle_transcript(transcript: str, is_final: bool, source: Optional[str] = None):
        nonlocal has_spoken_first_disclosure, last_processed_transcript, last_processed_at
        start_time = time.time()

        if source is None and active_stt_client is not None:
            source = active_stt_client.last_stt_source

        # Stream live transcript feed to visualizer
        await websocket.send_text(json.dumps({
            "type": "TRANSCRIPT_STREAM",
            "transcript": transcript,
            "is_final": is_final,
            "stt_source": source or "unknown"
        }))

        if not is_final:
            return

        cleaned = (transcript or "").strip()
        if not cleaned:
            return

        # Guard against duplicate finals (browser SR restarts / overlapping paths).
        now = time.time()
        if cleaned == last_processed_transcript and (now - last_processed_at) < 2.5:
            logger.info(f"Ignoring duplicate transcript within debounce window: '{cleaned}'")
            return
        last_processed_transcript = cleaned
        last_processed_at = now

        # Check compliance first-turn AI disclosure
        spoken_prefix = ""
        if not has_spoken_first_disclosure:
            spoken_prefix = "Namaste, main aapka Kirana Voice Ledger Assistant hoon. "
            has_spoken_first_disclosure = True

        # Extract Intent via Groq LLaMA-3.1-70B
        t0_intent = time.time()
        intent_resp = await intent_engine.extract_intent(transcript)
        t_intent_ms = int((time.time() - t0_intent) * 1000)

        # Broadcast Extracted JSON to visualizer
        await websocket.send_text(json.dumps({
            "type": "INTENT_EXTRACTED",
            "payload": intent_resp.model_dump(),
            "transcript": transcript,
            "intent_time_ms": t_intent_ms
        }))

        # Process actions
        spoken_responses = []
        for action in intent_resp.actions:
            spoken_msg, _ = await process_action_item(action)
            spoken_responses.append(spoken_msg)

        combined_speech = spoken_prefix + " ".join(spoken_responses)

        # Broadcast updated ledger to all clients
        await broadcast_ledger_state()

        # Stream synthesized TTS audio back to client
        await send_tts_response(combined_speech, start_time)

    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                # Raw PCM audio chunk (16kHz 16-bit mono) from AudioWorklet
                pcm_data = message["bytes"]
                if active_stt_client:
                    await active_stt_client.send_pcm_chunk(pcm_data)
            
            elif "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    logger.warning("Ignoring malformed WebSocket text frame.")
                    continue
                msg_type = data.get("type")

                if msg_type == "START_VOICE_SESSION":
                    # Fresh session: reset per-utterance state.
                    session_had_client_transcript = False
                    if not active_stt_client:
                        active_stt_client = GnaniSTTClient()
                        await active_stt_client.connect(handle_transcript)
                    else:
                        active_stt_client._pcm_buffer.clear()
                        active_stt_client.received_final = False

                    # Give the offline recognizer the current ledger names so its
                    # constrained decode can actually hear "Pooja Patel" instead
                    # of guessing at phonetically similar English words.
                    try:
                        customers = await ledger_manager.get_all_customers()
                        active_stt_client.set_vocab_hints(
                            [c.get("name", "") for c in customers]
                        )
                    except Exception as e:
                        logger.warning(f"Could not load customer names for STT hints: {e}")

                    logger.info(f"Voice session started (STT mode: {active_stt_client.mode}).")

                    # NOTE: The AI disclosure is prepended to the first spoken
                    # reply instead of being played before listening. Playing a
                    # tone into the mic used to trigger false VAD and swallow
                    # the user's first words.
                    await websocket.send_text(json.dumps({
                        "type": "VOICE_SESSION_STARTED",
                        "stt_mode": active_stt_client.mode,
                        "sample_rate": 16000
                    }))

                elif msg_type == "PROCESS_TRANSCRIPT":
                    # Client-side or simulated speech transcript
                    transcript_text = data.get("text", "")
                    session_had_client_transcript = True
                    logger.info(f"Received final transcript to process: '{transcript_text}'")
                    await handle_transcript(transcript_text, is_final=True, source=data.get("source") or "browser")

                elif msg_type == "INTERIM_TRANSCRIPT":
                    interim_text = data.get("text", "")
                    await websocket.send_text(json.dumps({
                        "type": "TRANSCRIPT_STREAM",
                        "transcript": interim_text,
                        "is_final": False,
                        "stt_source": "browser"
                    }))

                elif msg_type == "STOP_VOICE_SESSION":
                    if active_stt_client:
                        skip_stt = bool(data.get("skip_stt")) or session_had_client_transcript
                        if skip_stt:
                            logger.info("Stopping voice session; client already supplied a transcript.")
                        else:
                            # Transcribe the buffered AudioWorklet PCM. Bound the
                            # wait so a blocked cloud endpoint cannot freeze the UI.
                            try:
                                text = await asyncio.wait_for(
                                    active_stt_client.finish_and_transcribe(),
                                    timeout=15.0,
                                )
                                if not text and not active_stt_client.received_final:
                                    await websocket.send_text(json.dumps({
                                        "type": "STT_NO_SPEECH",
                                        "message": "Koi awaaz nahi mili. Kripya dobara bolein.",
                                    }))
                            except asyncio.TimeoutError:
                                logger.warning("Server-side STT timed out.")
                                await websocket.send_text(json.dumps({
                                    "type": "STT_ERROR",
                                    "message": "Speech recognition timed out. Kripya dobara bolein.",
                                }))
                            except Exception as e:
                                logger.error(f"Server-side STT failed: {e}")
                                await websocket.send_text(json.dumps({
                                    "type": "STT_ERROR",
                                    "message": "Speech recognition failed.",
                                }))
                        await active_stt_client.close()
                        active_stt_client = None
                    session_had_client_transcript = False

    except WebSocketDisconnect:
        logger.info("Client WebSocket disconnected.")
    except Exception as e:
        logger.error(f"WebSocket session error: {e}")
    finally:
        if websocket in connected_clients:
            connected_clients.remove(websocket)
        if active_stt_client:
            await active_stt_client.close()
