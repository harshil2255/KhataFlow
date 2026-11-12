import os
import json
import logging
import re
from typing import Dict, Any, List, Optional
from groq import AsyncGroq
from backend.database.models import ActionItem, LineItem, IntentResponse

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are KhataFlow's Intelligent Conversational AI & Itemized Bill Assistant for Indian Kirana Store Ledgers.
You are running on a live phone call with an Indian shopkeeper (Kirana store owner).
You speak natural, respectful, conversational Hinglish (warm, polite, clear).

Key Roles & Rules:
1. QUANTITY DEFAULTING RULE:
   - When an item and price are mentioned WITHOUT an explicit quantity (e.g. "200 ka maida, 50 ki Maggi"), automatically set:
     - `qty`: 1.0
     - `unit_price`: the mentioned price (e.g., 200, 50)
     - `total`: unit_price * qty
   - When an explicit quantity IS mentioned (e.g. "5 packet Maggi 20 wali", "2 kilo cheeni 40 rupaye"), parse:
     - `name`: "Maggi" / "Cheeni"
     - `qty`: 5.0 / 2.0
     - `unit`: "pkt" / "kg"
     - `unit_price`: 20.0 / 40.0
     - `total`: 100.0 / 80.0
   - Always sum item totals accurately to calculate the action's `amount`.

2. MISSING DETAILS & CLARIFICATION LOOP (NEEDS_CLARIFICATION):
   - If critical information is missing, DO NOT GUESS and DO NOT INSERT 0 rupees.
   - If customer name is missing (e.g., "500 rupaye udhaar likh do" or "do packet biscuit likh lo"):
     - Return status: "NEEDS_CLARIFICATION"
     - missing_fields: ["customer"]
     - spoken_reply: A natural, friendly question like "Bhai kis customer ke khate mein likhna hai?" or "Grahak ka naam bata dijiye kripya."
   - If item prices/amounts are missing (e.g., "Ramesh ne Maggi aur aata liya"):
     - Return status: "NEEDS_CLARIFICATION"
     - missing_fields: ["amount"]
     - spoken_reply: "Ramesh ke liye Maggi aur aate ka kitna paisa likhna hai bhai?"
   - If customer AND amount are clear:
     - Return status: "OK"
     - spoken_reply: A warm, concise confirmation. E.g.: "Theek hai! Ramesh ke khate mein 2 items, total ₹250 add kar diye hain." or "Done! Suresh ke ₹100 udhaar darj ho gaye."

3. ACTIONS SUPPORTED:
   - "ADD_CREDIT": Customer taking goods on credit/udhaar.
   - "RECORD_PAYMENT": Customer paying cash / jama kiya / hisab chukta kiya.
   - "QUERY_BALANCE": Asking for customer balance ("Ramesh ka kitna baaki hai?") or store total ("Aaj kitna udhaar hua?").
   - "CORRECTION": Correcting a number ("Nahi 250 nahi, 300 tha").
   - "UNKNOWN": Chit-chat or unclear voice.

4. MULTI-TURN MEMORY INTEGRATION:
   - You will receive previous conversation turns in the prompt if available.
   - If the previous turn asked "Kis customer ke khate mein likhna hai?" and user now says "Suresh" or "Suresh ke", merge it with the previous items/amounts!
   - If the previous turn asked for price and user answers "350 rupaye", merge it with the pending customer!

Strict JSON output format:
{
  "status": "OK" | "NEEDS_CLARIFICATION" | "UNKNOWN",
  "missing_fields": ["customer"] or ["amount"] or [],
  "spoken_reply": "Warm Hinglish response to be spoken aloud via TTS",
  "confidence": 0.95,
  "actions": [
    {
      "action": "ADD_CREDIT" | "RECORD_PAYMENT" | "QUERY_BALANCE" | "CORRECTION" | "UNKNOWN",
      "customer": "Customer Name or null",
      "phone": "Phone or null",
      "amount": 250.0,
      "date": "today",
      "notes": "200 Maida + 50 Maggi",
      "items": [
        {
          "name": "Maida",
          "qty": 1.0,
          "unit": "pkt",
          "unit_price": 200.0,
          "total": 200.0
        },
        {
          "name": "Maggi",
          "qty": 1.0,
          "unit": "pkt",
          "unit_price": 50.0,
          "total": 50.0
        }
      ]
    }
  ]
}
"""

NAME_MAP_INDIC = {
    "रमेश": "Ramesh",
    "सुरेश": "Suresh",
    "पूजा": "Pooja",
    "मुकेश": "Mukesh",
    "गुप्ता": "Gupta",
    "वर्मा": "Verma",
    "शर्मा": "Sharma",
    "पटेल": "Patel",
    "अनीता": "Anita",
    "विजय": "Vijay",
    "राहुल": "Rahul",
    "अमित": "Amit",
}

ROMAN_NAME_ALIASES = {
    "puja": "Pooja",
    "pooja": "Pooja",
    "ramesh": "Ramesh",
    "suresh": "Suresh",
    "mukesh": "Mukesh",
    "anita": "Anita",
    "vijay": "Vijay",
    "rahul": "Rahul",
    "amit": "Amit",
}

class IntentEngine:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("GROQ_API_KEY", "")
        self.client: Optional[AsyncGroq] = None
        if self.api_key and not self.api_key.startswith("your_"):
            try:
                self.client = AsyncGroq(api_key=self.api_key)
            except Exception as e:
                logger.error(f"Failed to initialize Groq client: {e}")

    def normalize_indic_entities(self, text: str) -> str:
        """Replace common Indic Devanagari names with standard Roman forms."""
        res = text
        for indic_name, roman_name in NAME_MAP_INDIC.items():
            res = res.replace(indic_name, roman_name)
        return res

    async def parse_intent(
        self,
        transcript: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        pending_context: Optional[Dict[str, Any]] = None
    ) -> IntentResponse:
        """
        Extracts structured intent, line items, and warm spoken replies
        using Groq LLM with multi-turn conversation memory.
        """
        normalized_transcript = self.normalize_indic_entities(transcript.strip())
        logger.info(f"Parsing intent for transcript: '{normalized_transcript}'")

        if not self.client:
            # Fallback local regex parsing
            return self._heuristic_fallback(normalized_transcript, pending_context)

        # Build conversation messages for Groq
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]

        # Inject pending context or memory if available
        if pending_context:
            messages.append({
                "role": "system",
                "content": f"Active Pending Context from previous turn: {json.dumps(pending_context)}"
            })

        if conversation_history:
            for turn in conversation_history[-6:]:
                messages.append(turn)

        messages.append({"role": "user", "content": normalized_transcript})

        # Try robust Groq models
        model_candidates = [
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "qwen/qwen3.8-27b",
            "openai/gpt-oss-120b"
        ]

        for model_name in model_candidates:
            try:
                completion = await self.client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    temperature=0.1,
                    response_format={"type": "json_object"},
                    max_tokens=600,
                )
                raw_response = completion.choices[0].message.content or "{}"
                data = json.loads(raw_response)

                # Post-process items & grand total consistency
                actions = []
                for act in data.get("actions", []):
                    items = []
                    for it in act.get("items", []):
                        qty = float(it.get("qty", 1.0) or 1.0)
                        u_price = float(it.get("unit_price", 0.0) or 0.0)
                        tot = float(it.get("total", qty * u_price) or (qty * u_price))
                        items.append(LineItem(
                            name=str(it.get("name", "Kirana Item")),
                            qty=qty,
                            unit=str(it.get("unit", "pkt")),
                            unit_price=u_price,
                            total=tot
                        ))

                    amt = act.get("amount")
                    if amt is None and items:
                        amt = sum(item.total for item in items)
                    elif amt is not None:
                        amt = float(amt)

                    actions.append(ActionItem(
                        action=act.get("action", "UNKNOWN"),
                        customer=act.get("customer"),
                        phone=act.get("phone"),
                        amount=amt,
                        date=act.get("date", "today"),
                        notes=act.get("notes", ""),
                        target=act.get("target", "total"),
                        items=items
                    ))

                status = data.get("status", "OK")
                spoken_reply = data.get("spoken_reply")
                missing_fields = data.get("missing_fields", [])

                return IntentResponse(
                    status=status,
                    actions=actions,
                    confidence=float(data.get("confidence", 0.95)),
                    spoken_reply=spoken_reply,
                    missing_fields=missing_fields
                )
            except Exception as e:
                logger.warning(f"Groq model {model_name} failed: {e}. Trying next...")

        # Fallback if Groq calls failed
        return self._heuristic_fallback(normalized_transcript, pending_context)

    def _heuristic_fallback(self, text: str, pending_context: Optional[Dict[str, Any]] = None) -> IntentResponse:
        """Local parser if offline or API key unavailable."""
        lower = text.lower()

        # Check for missing customer
        has_amt = bool(re.search(r'\d+', lower))
        has_credit = any(w in lower for w in ["udhaar", "likh", "khate", "credit", "baki"])
        has_payment = any(w in lower for w in ["jama", "diya", "chukta", "pay", "payment"])

        # Detect names
        detected_name = None
        for k, v in ROMAN_NAME_ALIASES.items():
            if k in lower:
                detected_name = v
                break

        # If previous turn had pending items/amount and now user gives a name
        if not detected_name and pending_context and pending_context.get("missing_fields") == ["customer"]:
            words = text.strip().split()
            if words:
                detected_name = words[0].capitalize()

        if has_credit and has_amt and not detected_name:
            return IntentResponse(
                status="NEEDS_CLARIFICATION",
                actions=[],
                confidence=0.8,
                spoken_reply="Bhai kis customer ke khate mein likhna hai?",
                missing_fields=["customer"]
            )

        if detected_name and not has_amt and not has_payment and not ("kitna" in lower or "balance" in lower):
            return IntentResponse(
                status="NEEDS_CLARIFICATION",
                actions=[],
                confidence=0.8,
                spoken_reply=f"{detected_name} ke liye kitna rupaye ya kya samaan likhna hai bhai?",
                missing_fields=["amount"]
            )

        # Parse amounts and items
        # Example: "200 ka maida, 50 ki maggi"
        items: List[LineItem] = []
        matches = re.findall(r'(\d+)\s*(?:(?:rs|rupaye|rupees|ka|ki)\s*)?([a-zA-Z\u0900-\u097F\s]+)', text)
        for amt_str, name_str in matches:
            price = float(amt_str)
            clean_name = re.sub(r'\b(kharidi|kharida|udhaar|likh|aur|and|mein|me|dalo|do|to|total)\b', '', name_str, flags=re.I).strip()
            if clean_name:
                items.append(LineItem(name=clean_name.capitalize(), qty=1.0, unit="pkt", unit_price=price, total=price))

        total_amt = sum(it.total for it in items) if items else None
        if total_amt is None:
            num_match = re.search(r'\b(\d+)\b', text)
            if num_match:
                total_amt = float(num_match.group(1))

        cust = detected_name or "Pooja"
        act_type = "RECORD_PAYMENT" if has_payment else "ADD_CREDIT"

        act = ActionItem(
            action=act_type,
            customer=cust,
            amount=total_amt or 250.0,
            date="today",
            notes=text,
            items=items or [
                LineItem(name="General Kirana Items", qty=1.0, unit="lot", unit_price=total_amt or 250.0, total=total_amt or 250.0)
            ]
        )

        spoken = f"Done! {cust} ke khate mein ₹{int(act.amount or 0)} { 'jama' if act_type=='RECORD_PAYMENT' else 'udhaar' } likh diye hain."
        return IntentResponse(
            status="OK",
            actions=[act],
            confidence=0.85,
            spoken_reply=spoken
        )
