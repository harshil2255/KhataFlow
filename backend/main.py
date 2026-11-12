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
from backend.services.edge_tts_service import EdgeTTSClient
from backend.database.models import ActionItem, LineItem, IntentResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("KhataFlowBackend")

ledger_manager = LedgerManager()
intent_engine = IntentEngine()
edge_tts_client = EdgeTTSClient(voice="hi-IN-SwaraNeural")

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("SQLite ledger initialized successfully.")
    yield

app = FastAPI(title="KhataFlow Spatial POS API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

connected_clients: List[WebSocket] = []

async def broadcast_ledger_state():
    """Broadcasts current ledger customers and recent transactions to all connected browser clients."""
    customers = await ledger_manager.get_all_customers()
    transactions = await ledger_manager.get_recent_transactions(limit=16)
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
            if client in connected_clients:
                connected_clients.remove(client)

@app.get("/api/health")
async def health_check():
    groq_configured = bool(os.environ.get("GROQ_API_KEY") and not os.environ.get("GROQ_API_KEY", "").startswith("your_"))
    gnani_configured = bool(os.environ.get("GNANI_API_KEY") and not os.environ.get("GNANI_API_KEY", "").startswith("your_"))
    return {
        "status": "healthy",
        "service": "KhataFlow Spatial AI Ledger",
        "groq_configured": groq_configured,
        "gnani_configured": gnani_configured,
        "tts_engine": "edge-tts (hi-IN-SwaraNeural)",
    }

@app.get("/api/ledger")
async def get_ledger():
    customers = await ledger_manager.get_all_customers()
    transactions = await ledger_manager.get_recent_transactions(limit=20)
    return {"customers": customers, "transactions": transactions}

@app.get("/api/customers/{customer_id}/transactions")
async def get_customer_txs(customer_id: int):
    txs = await ledger_manager.get_customer_transactions(customer_id)
    return {"transactions": txs}

class CreateCustomerRequest(BaseModel):
    name: str
    phone: Optional[str] = None
    opening_balance: Optional[float] = 0.0

@app.post("/api/customers")
async def create_customer(req: CreateCustomerRequest):
    cust, is_new = await ledger_manager.get_or_create_customer(req.name, req.phone)
    if is_new and req.opening_balance and req.opening_balance > 0:
        await ledger_manager.record_transaction(
            customer_id=cust["id"],
            amount=req.opening_balance,
            tx_type="CREDIT",
            notes="Opening Balance (Shuruwati Udhaar)"
        )
    await broadcast_ledger_state()
    return {"customer": cust, "is_new": is_new}

class ExecuteActionRequest(BaseModel):
    action: str
    customer: Optional[str] = None
    amount: Optional[float] = None
    notes: Optional[str] = None
    target: Optional[str] = "total"

@app.post("/api/action")
async def execute_manual_action(req: ExecuteActionRequest):
    action_item = ActionItem(
        action=req.action,
        customer=req.customer,
        amount=req.amount,
        notes=req.notes or "",
        target=req.target or "total"
    )
    result_text, status, is_new = await process_action_item(action_item)
    await broadcast_ledger_state()
    return {"status": status, "spoken_text": result_text, "is_new_customer": is_new}

async def process_action_item(action: ActionItem) -> tuple[str, str, bool]:
    """
    Executes a single parsed action against the ledger state machine.
    Returns (spoken_indic_response, status_code, is_new_customer).
    """
    act = action.action.upper()

    # 1. Spoken correction
    if act == "CORRECTION":
        if action.amount is not None:
            updated_info, msg = await ledger_manager.handle_spoken_correction(action.amount)
            if updated_info:
                return msg, "CORRECTED", False
            return msg or "Koi purana record nahi mila.", "ERROR", False
        return "Naya amount samajh nahi aaya.", "ERROR", False

    # 2. Query balance
    if act == "QUERY_BALANCE":
        bal, spoken = await ledger_manager.query_balance(
            customer_name=action.customer,
            target=action.target or "total"
        )
        return spoken, "QUERIED", False

    # 3. Add Credit or Record Payment
    if act in ["ADD_CREDIT", "RECORD_PAYMENT"]:
        cust_name = action.customer
        if not cust_name or cust_name.lower() in ["unknown", "kisi", "none"]:
            return "Kripya grahak ka naam batayein.", "NEED_CUSTOMER", False

        # Look up matching customers
        candidates = await ledger_manager.find_customers_by_name(cust_name)
        is_new_cust = False

        if len(candidates) >= 1:
            customer = candidates[0]
        else:
            # Auto-create customer if name is not found!
            customer, is_new_cust = await ledger_manager.get_or_create_customer(cust_name, action.phone)
            logger.info(f"Auto-created new customer profile via voice: {customer['name']}")

        amt = action.amount or 0.0
        tx_type = "CREDIT" if act == "ADD_CREDIT" else "PAYMENT"
        note = action.notes or ("Udhaar samaan" if tx_type == "CREDIT" else "Udhaar chukta")

        _, new_balance = await ledger_manager.record_transaction(
            customer_id=customer["id"],
            amount=amt,
            tx_type=tx_type,
            notes=note
        )

        new_tag = " (naya grahak banaya)" if is_new_cust else ""
        if tx_type == "CREDIT":
            spoken = f"{customer['name']}{new_tag} ka {int(amt)} rupaye udhaar darj ho gaya. Ab total {int(new_balance)} rupaye baaki hai."
        else:
            spoken = f"{customer['name']} se {int(amt)} rupaye jama ho gaye. Ab total {int(new_balance)} rupaye baaki hai."

        return spoken, "RECORDED", is_new_cust

    return "Aapka aadesh samajh nahi aaya. Kripya dobara bole.", "UNKNOWN", False

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Main real-time bidirectional WebSocket connecting Next.js browser client to KhataFlow.
    Features:
    - Indic audio streaming & VAD back-and-forth
    - Conversational state memory & clarification loops
    - Itemized Smart Bill synthesis
    - edge-tts warm full-duplex vocal responses
    """
    await websocket.accept()
    connected_clients.append(websocket)
    logger.info("Browser client connected to KhataFlow Spatial POS WebSocket.")

    # Send initial ledger state
    try:
        customers = await ledger_manager.get_all_customers()
        transactions = await ledger_manager.get_recent_transactions(limit=16)
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

    # Session conversation memory
    conversation_history: List[Dict[str, str]] = []
    pending_context: Optional[Dict[str, Any]] = None
    active_stt_client: Optional[GnaniSTTClient] = None
    session_had_client_transcript = False

    async def stream_audio_response(spoken_text: str, start_time: float):
        """Synthesize warm voice using edge-tts and stream to client."""
        first_chunk_sent = False
        try:
            async for audio_chunk in edge_tts_client.synthesize_stream(spoken_text):
                if not first_chunk_sent:
                    ttfa_ms = int((time.time() - start_time) * 1000)
                    first_chunk_sent = True
                    await websocket.send_text(json.dumps({
                        "type": "LATENCY_METRIC",
                        "ttfa_ms": ttfa_ms
                    }))

                await websocket.send_text(json.dumps({
                    "type": "AUDIO_RESPONSE_CHUNK",
                    "audio_base64": base64.b64encode(audio_chunk).decode("utf-8")
                }))

            await websocket.send_text(json.dumps({
                "type": "AUDIO_RESPONSE_COMPLETE",
                "text": spoken_text
            }))
        except Exception as e:
            logger.error(f"Error streaming edge_tts audio: {e}")

    try:
        while True:
            raw_msg = await websocket.receive_text()
            msg = json.loads(raw_msg)
            msg_type = msg.get("type")

            if msg_type == "START_RECORDING":
                session_had_client_transcript = False
                logger.info("Audio recording session started by client.")

                active_stt_client = GnaniSTTClient()

                async def on_gnani_transcript(text: str, is_final: bool):
                    nonlocal session_had_client_transcript
                    if text:
                        session_had_client_transcript = True
                        await websocket.send_text(json.dumps({
                            "type": "TRANSCRIPT_STREAM",
                            "text": text,
                            "is_final": is_final,
                            "source": "gnani"
                        }))
                        if is_final:
                            await process_incoming_transcript(text, source="gnani")

                await active_stt_client.connect(on_gnani_transcript)

            elif msg_type == "AUDIO_CHUNK":
                chunk_b64 = msg.get("chunk", "")
                if chunk_b64 and active_stt_client:
                    pcm_bytes = base64.b64decode(chunk_b64)
                    await active_stt_client.send_pcm_chunk(pcm_bytes)

            elif msg_type == "STOP_RECORDING":
                logger.info("Audio recording session stopped by client.")
                if active_stt_client:
                    # Run backend STT transcription (Groq Whisper / Vosk) if not already transcribed
                    if not session_had_client_transcript:
                        transcribed = await active_stt_client.finish_and_transcribe()
                        if transcribed:
                            await process_incoming_transcript(transcribed, source=active_stt_client.last_stt_source)
                    await active_stt_client.disconnect()
                    active_stt_client = None

            elif msg_type == "PROCESS_TRANSCRIPT":
                text = msg.get("text", "")
                source = msg.get("source", "client_asr")
                if text:
                    await process_incoming_transcript(text, source=source)

            elif msg_type == "CONFIRM_ACTION":
                # User tapped "Confirm & Save" on the Smart Receipt
                act_data = msg.get("action", {})
                action_item = ActionItem(
                    action=act_data.get("action", "ADD_CREDIT"),
                    customer=act_data.get("customer"),
                    amount=act_data.get("amount"),
                    notes=act_data.get("notes", ""),
                )
                spoken_reply, status, is_new = await process_action_item(action_item)
                await broadcast_ledger_state()
                # Synthesize confirmation audio
                asyncio.create_task(stream_audio_response(spoken_reply, time.time()))

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected gracefully.")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if active_stt_client:
            await active_stt_client.disconnect()
        if websocket in connected_clients:
            connected_clients.remove(websocket)

    async def process_incoming_transcript(text: str, source: str = "gnani"):
        """Process utterance through Groq Intent Engine + Conversational Loop."""
        nonlocal pending_context
        start_time = time.time()

        # Update conversation history
        conversation_history.append({"role": "user", "content": text})

        intent_res: IntentResponse = await intent_engine.parse_intent(
            transcript=text,
            conversation_history=conversation_history,
            pending_context=pending_context
        )

        logger.info(f"Intent response status: {intent_res.status}, spoken_reply: {intent_res.spoken_reply}")

        # Send full structured intent payload to UI (Live itemized receipt)
        await websocket.send_text(json.dumps({
            "type": "INTENT_EXTRACTED",
            "payload": intent_res.model_dump()
        }))

        # If conversational clarification is required
        if intent_res.status == "NEEDS_CLARIFICATION":
            pending_context = {
                "missing_fields": intent_res.missing_fields,
                "actions": [a.model_dump() for a in intent_res.actions],
                "last_text": text
            }
            spoken_text = intent_res.spoken_reply or "Kripya puri jankari batayein."
            conversation_history.append({"role": "assistant", "content": spoken_text})
            asyncio.create_task(stream_audio_response(spoken_text, start_time))
            return

        # Status is OK: execute actions on database
        pending_context = None
        responses_text = []

        for action in intent_res.actions:
            spoken_part, status, is_new = await process_action_item(action)
            responses_text.append(spoken_part)

        await broadcast_ledger_state()

        final_spoken = intent_res.spoken_reply or " ".join(responses_text)
        conversation_history.append({"role": "assistant", "content": final_spoken})

        # Stream natural speech synthesis
        asyncio.create_task(stream_audio_response(final_spoken, start_time))
