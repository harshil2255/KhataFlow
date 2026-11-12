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

app = FastAPI(title="KhataFlow Voice Ledger API", version="2.0.0", lifespan=lifespan)

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
        "service": "KhataFlow Voice AI Ledger",
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
            notes="Opening Balance"
        )
    await broadcast_ledger_state()
    return {"customer": cust, "is_new": is_new}

async def process_action_item(action: ActionItem) -> tuple[str, str, bool]:
    """
    Executes a single parsed action against the ledger state machine.
    Handles:
    - Spoken corrections ("nahi, 430", "nahi 350 nahi 450 tha")
    - Asking a short spoken question when two customers share a name (Disambiguation)
    - Recording credit and payments
    """
    act = action.action.upper()

    # 0. Check if user is resolving a pending disambiguation question
    pending = ledger_manager.get_pending_disambiguation()
    if pending and (act == "DISAMBIGUATION_RESPONSE" or action.customer or action.notes):
        reply_text = (action.customer or action.notes or "").lower()
        candidates = pending.get("candidates", [])
        matched = None
        for c in candidates:
            if c["name"].lower() in reply_text or (c.get("phone") and c["phone"][-4:] in reply_text):
                matched = c
                break
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
            return f"{matched['name']} ka {int(amt)} rupaye darj ho gaya. Ab total {int(new_bal)} rupaye baaki hai.", "RECORDED", False

    # 1. Spoken correction ("nahi, 430")
    if act == "CORRECTION":
        if action.amount is not None:
            updated_info, msg = await ledger_manager.handle_spoken_correction(action.amount)
            if updated_info:
                return msg, "CORRECTED", False
            return msg or "Koi purana record nahi mila jise sudhara ja sake.", "ERROR", False
        return "Naya amount samajh nahi aaya.", "ERROR", False

    # 1b. Create Customer directly via voice command ("naya grahak banao Mukesh Patel")
    if act == "CREATE_CUSTOMER":
        cust_name = action.customer or "Naya Grahak"
        cust, is_new = await ledger_manager.get_or_create_customer(cust_name, action.phone)
        spoken = f"Naya grahak '{cust['name']}' ka khata safalta-purvak bana diya gaya hai."
        return spoken, "CUSTOMER_CREATED", True

    # 1c. Update Customer name via voice command ("Ramesh ka naam badal kar Ramesh Gupta kar do")
    if act == "UPDATE_CUSTOMER":
        old_name = action.customer or ""
        new_name = action.notes or ""
        cust, msg = await ledger_manager.update_customer_name(old_name, new_name)
        return msg, "CUSTOMER_UPDATED", False

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

        # If TWO or MORE customers share the same name (e.g., Ramesh Gupta and Ramesh Verma):
        # Ask a short spoken disambiguation question!
        if len(candidates) > 1 and not action.phone:
            names_list = " ya ".join([f"{c['name']} (phone ending {c['phone'][-4:] if c.get('phone') else 'nahi hai'})" for c in candidates])
            spoken_question = f"{cust_name} naam ke do grahak hain: {names_list}. Kripya batayein kiske khate me likhna hai?"
            ledger_manager.set_pending_disambiguation({
                "action": "CREDIT" if act == "ADD_CREDIT" else "PAYMENT",
                "customer_name": cust_name,
                "amount": action.amount or 0.0,
                "notes": action.notes or "Udhaar samaan",
                "candidates": candidates
            })
            return spoken_question, "DISAMBIGUATION_REQUIRED", False

        if len(candidates) == 1:
            customer = candidates[0]
        else:
            # Auto-create new customer
            customer, is_new_cust = await ledger_manager.get_or_create_customer(cust_name, action.phone)
            logger.info(f"Created customer profile: {customer['name']}")

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
    await websocket.accept()
    connected_clients.append(websocket)
    logger.info("Browser client connected to KhataFlow WebSocket.")

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

    async def process_incoming_transcript(text: str, source: str = "gnani"):
        start_time = time.time()
        logger.info(f"Processing transcript '{text}' from {source}")
        pending = ledger_manager.get_pending_disambiguation()

        intent_res: IntentResponse = await intent_engine.parse_intent(
            transcript=text,
            pending_context=pending
        )

        logger.info(f"Parsed intent response: {intent_res.model_dump()}")

        # Send extracted payload to UI
        await websocket.send_text(json.dumps({
            "type": "INTENT_EXTRACTED",
            "payload": intent_res.model_dump()
        }))

        responses_text = []
        for action in intent_res.actions:
            spoken_part, status, is_new = await process_action_item(action)
            responses_text.append(spoken_part)

        await broadcast_ledger_state()

        final_spoken = " ".join(responses_text) if responses_text else (intent_res.spoken_reply or "Aapka aadesh darj ho gaya.")
        asyncio.create_task(stream_audio_response(final_spoken, start_time))

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
                act_data = msg.get("action", {})
                action_item = ActionItem(
                    action=act_data.get("action", "ADD_CREDIT"),
                    customer=act_data.get("customer"),
                    amount=act_data.get("amount"),
                    notes=act_data.get("notes", ""),
                )
                spoken_reply, status, is_new = await process_action_item(action_item)
                await broadcast_ledger_state()
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
