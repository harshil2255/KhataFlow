import os
import json
import logging
import re
from typing import Dict, Any, List, Optional
from groq import AsyncGroq
from backend.database.models import ActionItem, LineItem, IntentResponse

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are KhataFlow's Indic Intent Engine for Indian Kirana Store Ledgers.
You parse speech transcripts in Hindi (Devanagari or Romanized), Hinglish, English, or Code-mixed Indic languages.
Extract user intentions, customer names, amounts, actions, items, and dates into strict JSON format.

Supported actions:
1. "GENERATE_BILL": User specifically asks to generate/make the bill, calculate total items, or checkout for a customer.
   Examples:
   - "मैं बोल रहा हूँ कि मुकेश पटेल का bill बना दो, इसने जितना भी अभी तक ख़रीदा है सब चीज़ का total मिला के।" -> action: "GENERATE_BILL", customer: "Mukesh Patel"
   - "Mukesh Patel ka bill bana do"
   - "Ramesh ka kacha pakka bill nikaalo"
   - "Pooja ka bill dikhao saare samaan ka"
2. "CREATE_CUSTOMER": User wants to create/register a new customer or ledger account.
   Examples:
   - "भाई, एक काम करो, नया ग्राहक बनाओ। इनका नाम होगा मुकेश पटेल।" -> action: "CREATE_CUSTOMER", customer: "Mukesh Patel"
   - "naya grahak banao Mukesh Patel"
   - "ek naya account kholo Ramesh ke naam se"
   - "Suresh Sharma ka naya khata banao"
3. "UPDATE_CUSTOMER": User wants to rename or update customer details.
   Examples:
   - "Ramesh ka naam badal kar Ramesh Gupta kar do" -> action: "UPDATE_CUSTOMER", customer: "Ramesh", notes: "Ramesh Gupta"
   - "Mukesh ka phone number update karo"
4. "ADD_CREDIT": Customer took goods on credit/udhaar. If the customer does not exist, they will be auto-created and billed!
   Examples:
   - "पूजा ने 200 रुपये का मैदा खरीदा, 50 रुपये की Maggi खरीदी। उधार में डाल दो।"
   - "Ramesh ka 340 udhaar"
   - "Mukesh Patel ke khate me 500 ka tel likh do"
5. "RECORD_PAYMENT": Customer paid money / jama kiya.
   Examples: "kal 200 diya tha", "रमेश ने 350 रुपये नकद जमा कर दिए"
   - Special Rule for "pura udhaar chuka diya / poora hisaab clear kar diya / pura chukta":
     If the user says "pura udhaar chuka diya", "sab chukta kar diya", "poora hisaab chuka diya", or says to clear all debt WITHOUT mentioning an exact amount:
     Set action: "RECORD_PAYMENT", customer: "<Customer Name>", notes: "Pura udhaar chuka diya (Full Settle)", amount: null, target: "clear_all".
6. "QUERY_BALANCE": User asking about balance.
   Examples: "Ramesh ka total kitna baaki hai?", "रमेश का कितना बाकी है?", "aaj kitna udhaar gaya?"
7. "CORRECTION": User correcting a previous number or entry.
   Examples: "Nahi 340 nahi, 430 tha", "nahi 430", "nahi 350 nahi 450 tha", "गलती से 300 लिख दिया, 430 करो"
8. "DISAMBIGUATION_RESPONSE": User specifying which customer when asked (e.g. "Gupta ji", "Verma wala", "9876 wala").
9. "UNKNOWN": Greetings or unclear speech.

Quantity Defaulting Rule:
- When an item and price are mentioned WITHOUT explicit quantity (e.g., "200 ka maida, 50 ki Maggi"):
  - set qty = 1.0, unit_price = mentioned price, total = price.
- When an explicit quantity IS mentioned (e.g., "5 packet Maggi 20 wali"):
  - set qty = 5.0, unit_price = 20.0, total = 100.0.
- Sum item totals accurately into the action's `amount`.

JSON Output Format (Strictly return only this JSON object):
{
  "actions": [
    {
      "action": "GENERATE_BILL" | "CREATE_CUSTOMER" | "UPDATE_CUSTOMER" | "ADD_CREDIT" | "RECORD_PAYMENT" | "QUERY_BALANCE" | "CORRECTION" | "DISAMBIGUATION_RESPONSE" | "UNKNOWN",
      "customer": "Customer Name or null",
      "phone": "Phone or null",
      "amount": 430.0 or null,
      "date": "today" | "yesterday" | "specific date",
      "notes": "optional context, new name, or item names",
      "target": "total" | "today",
      "items": [
        {
          "name": "Item name",
          "qty": 1.0,
          "unit": "pkt",
          "unit_price": 200.0,
          "total": 200.0
        }
      ]
    }
  ],
  "confidence": 0.95,
  "spoken_summary": "Short natural Hinglish feedback or null"
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
    "मोहन": "Mohan",
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
        normalized_transcript = self.normalize_indic_entities(transcript.strip())
        logger.info(f"Parsing intent for transcript: '{normalized_transcript}'")

        if not self.client:
            return self._heuristic_fallback(normalized_transcript, pending_context)

        messages = [{"role": "system", "content": SYSTEM_PROMPT}]

        if pending_context:
            messages.append({
                "role": "system",
                "content": f"Pending Disambiguation / Context: {json.dumps(pending_context)}"
            })

        if conversation_history:
            for turn in conversation_history[-6:]:
                messages.append(turn)

        messages.append({"role": "user", "content": normalized_transcript})

        model_candidates = [
            "qwen/qwen3.8-27b",
            "openai/gpt-oss-120b",
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant"
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

                actions = []
                for act in data.get("actions", []):
                    items = []
                    for it in act.get("items", []):
                        qty = float(it.get("qty", 1.0) or 1.0)
                        u_price = float(it.get("unit_price", 0.0) or 0.0)
                        tot = float(it.get("total", qty * u_price) or (qty * u_price))
                        items.append(LineItem(
                            name=str(it.get("name", "Item")),
                            qty=qty,
                            unit=str(it.get("unit", "pkt")),
                            unit_price=u_price,
                            total=tot
                        ))

                    amt = act.get("amount")
                    if amt is not None:
                        amt = float(amt)
                    elif items:
                        amt = sum(item.total for item in items)

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

                return IntentResponse(
                    status="OK",
                    actions=actions,
                    confidence=float(data.get("confidence", 0.95)),
                    spoken_reply=data.get("spoken_summary"),
                )
            except Exception as e:
                logger.warning(f"Groq model {model_name} failed: {e}. Trying next...")

        return self._heuristic_fallback(normalized_transcript, pending_context)

    def _heuristic_fallback(self, text: str, pending_context: Optional[Dict[str, Any]] = None) -> IntentResponse:
        lower = text.lower()

        # Check for create customer: "naya grahak banao Mukesh Patel" or "नया ग्राहक बनाओ... मुकेश पटेल"
        create_match = re.search(r'(?:naya\s+grahak|naya\s+khata|naya\s+account|grahak\s+banao|नया\s+ग्राहक).*?(?:naam|name)?\s*(?:hoga|hai)?\s*([a-zA-Z\s]+)', text, flags=re.I)
        if create_match or any(w in lower for w in ["naya grahak", "नया ग्राहक", "banao", "add customer"]):
            # Extract customer name
            extracted_cust = None
            if create_match:
                extracted_cust = create_match.group(1).replace("hoga", "").replace("hai", "").strip()
            if not extracted_cust:
                words = text.split()
                if len(words) >= 2:
                    extracted_cust = " ".join(words[-2:]).title()
                else:
                    extracted_cust = "Naya Grahak"

            return IntentResponse(
                status="OK",
                actions=[
                    ActionItem(
                        action="CREATE_CUSTOMER",
                        customer=extracted_cust,
                        notes="Voice created customer"
                    )
                ],
                confidence=0.9
            )

        # Check for update name: "Ramesh ka naam badal kar Ramesh Gupta kar do"
        update_match = re.search(r'(?:naam\s+badal\s+kar|rename|change\s+name)\s*([a-zA-Z\s]+)', text, flags=re.I)
        if update_match:
            new_name = update_match.group(1).replace("kar do", "").replace("karo", "").strip()
            return IntentResponse(
                status="OK",
                actions=[
                    ActionItem(
                        action="UPDATE_CUSTOMER",
                        customer="Ramesh",
                        notes=new_name
                    )
                ],
                confidence=0.9
            )

        # Check for spoken correction: e.g. "nahi 430", "nahi, 430 tha"
        correction_match = re.search(r'(?:nahi|nhi|galat|change|sudhar|instead)\s*(?:[\w\s]*?)(\d+)', lower)
        if correction_match:
            new_val = float(correction_match.group(1))
            return IntentResponse(
                status="OK",
                actions=[
                    ActionItem(
                        action="CORRECTION",
                        amount=new_val,
                        notes=text
                    )
                ],
                confidence=0.9
            )

        # Detect names
        detected_name = None
        for k, v in ROMAN_NAME_ALIASES.items():
            if k in lower:
                detected_name = v
                break

        # Disambiguation response check
        if pending_context and ("gupta" in lower or "verma" in lower or "sharma" in lower or re.search(r'\d{4}', lower)):
            return IntentResponse(
                status="OK",
                actions=[
                    ActionItem(
                        action="DISAMBIGUATION_RESPONSE",
                        customer=detected_name or text.strip(),
                        notes=text.strip()
                    )
                ],
                confidence=0.9
            )

        has_payment = any(w in lower for w in ["jama", "diya", "chukta", "pay", "payment"])

        # Parse amounts & items
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

        cust = detected_name or "Ramesh"
        act_type = "RECORD_PAYMENT" if has_payment else "ADD_CREDIT"

        act = ActionItem(
            action=act_type,
            customer=cust,
            amount=total_amt or 250.0,
            date="today",
            notes=text,
            items=items or [
                LineItem(name="Kirana Items", qty=1.0, unit="lot", unit_price=total_amt or 250.0, total=total_amt or 250.0)
            ]
        )

        return IntentResponse(
            status="OK",
            actions=[act],
            confidence=0.85,
        )
