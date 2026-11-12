import os
import json
import logging
import re
from typing import Dict, Any, List, Optional
from groq import AsyncGroq
from backend.database.models import ActionItem, IntentResponse

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are KhataFlow's Indic Intent Engine for Indian Kirana Store Ledgers.
You parse speech transcripts in Hindi (Devanagari or Romanized), Hinglish, English, or Code-mixed Indic languages.
Extract user intentions, customer names, amounts, actions, and dates into strict JSON format.

Supported actions:
1. "ADD_CREDIT": Customer took goods on credit/udhaar. Examples: "Ramesh ka 340 udhaar", "रमेश का 350 उधार"
2. "RECORD_PAYMENT": Customer paid money / jama kiya. Examples: "kal 200 diya tha", "कल 200 दिया था", "सुरेश ने 500 जमा किये"
3. "QUERY_BALANCE": User asking about balance. Examples: "Ramesh ka total kitna baaki hai?", "रमेश का कितना बाकी है?"
4. "CORRECTION": User correcting a previous number or entry. Examples: "Nahi 340 nahi, 430 tha", "नहीं 350 नहीं 450 था"
5. "DISAMBIGUATION_RESPONSE": User specifying which customer.
6. "UNKNOWN": Greetings, random speech.

Multi-Action extraction:
"Ramesh ka 350 udhaar, kal 200 diya tha" OR "रमेश का 350 उधार, कल 200 दिया था":
[
  {"action": "ADD_CREDIT", "customer": "Ramesh", "amount": 350, "date": "today"},
  {"action": "RECORD_PAYMENT", "customer": "Ramesh", "amount": 200, "date": "yesterday"}
]

JSON Output Format (Strictly return only this JSON object):
{
  "actions": [
    {
      "action": "ADD_CREDIT" | "RECORD_PAYMENT" | "QUERY_BALANCE" | "CORRECTION" | "DISAMBIGUATION_RESPONSE" | "UNKNOWN",
      "customer": "Customer Name or null",
      "phone": "Phone number or null",
      "amount": 123.45 or null,
      "date": "today" | "yesterday" | "specific date",
      "notes": "optional context like item names",
      "target": "total" | "today"
    }
  ],
  "confidence": 0.95,
  "spoken_summary": "Short natural Hinglish feedback or null"
}
"""

# Common Indic Devanagari mappings
DEVANAGARI_DIGITS = {
    '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
    '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
}

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
    "अमित": "Amit"
}

# Common ASR spellings / phonetic variants -> canonical customer first name.
ROMAN_NAME_ALIASES = {
    "puja": "Pooja",
    "pooja": "Pooja",
    "poojaa": "Pooja",
    "ramesh": "Ramesh",
    "ramash": "Ramesh",
    "suresh": "Suresh",
    "sureshh": "Suresh",
    "mukesh": "Mukesh",
    "mukeshbhai": "Mukesh",
    "mukes": "Mukesh",
    "anita": "Anita",
    "vijay": "Vijay",
    "rahul": "Rahul",
    "amit": "Amit",
}

KNOWN_SURNAMES = {
    "gupta": "Gupta",
    "verma": "Verma",
    "sharma": "Sharma",
    "patel": "Patel",
    "patil": "Patel",
    "bhai": "Bhai",
}

NUMBER_UNITS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19,
    # Romanized Hindi numerals
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "panch": 5,
    "paanch": 5, "chhe": 6, "chhah": 6, "che": 6, "saat": 7, "aath": 8,
    "nau": 9, "das": 10, "gyarah": 11, "barah": 12, "terah": 13,
    "chaudah": 14, "pandrah": 15, "solah": 16, "satrah": 17,
    "atharah": 18, "unnis": 19, "bees": 20,
}

NUMBER_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "pachees": 25, "pachhees": 25, "tees": 30, "chalees": 40,
    "chalis": 40, "pachas": 50, "pachaas": 50, "saath": 60,
    "sattar": 70, "assi": 80, "nabbe": 90,
}

NUMBER_SCALES = {
    "hundred": 100, "sau": 100,
    "thousand": 1000, "hazaar": 1000, "hazar": 1000, "hajar": 1000,
    "lakh": 100000, "lac": 100000,
}

CREDIT_KEYWORDS = [
    "udhaar", "udhar", "udaar", "udar", "udhaari", "udhari", "udari",
    "credit", "baaki", "baki", "likh", "likho", "le gaya", "le liya",
    "liya", "उधार", "क्रेडिट", "बाकी", "लिख", "ले गया", "लिया",
]

PAYMENT_KEYWORDS = [
    "diya", "diya tha", "dia", "diy", "jama", "jamaa", "paid", "bhara",
    "chukaya", "pay", "payment", "दिया", "जमा", "पेमेंट",
    "भरा", "चुकाया",
]

class IntentEngine:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("GROQ_API_KEY", "")
        self.client = AsyncGroq(api_key=self.api_key) if (self.api_key and not self.api_key.startswith("your_")) else None

    async def extract_intent(self, transcript: str, context: Optional[Dict[str, Any]] = None) -> IntentResponse:
        cleaned = transcript.strip()
        if not cleaned:
            return IntentResponse(actions=[ActionItem(action="UNKNOWN")], confidence=1.0)

        # 1. If Groq client is configured, call Groq JSON Mode
        if self.client:
            try:
                context_str = f"\nCurrent State/Context: {json.dumps(context)}" if context else ""
                completion = await self.client.chat.completions.create(
                    model="llama-3.1-70b-versatile",
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": f"{context_str}\nTranscript: \"{cleaned}\""}
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.0,
                    max_tokens=600
                )
                raw_json = completion.choices[0].message.content
                data = json.loads(raw_json)
                actions = [ActionItem(**item) for item in data.get("actions", [])]
                return IntentResponse(
                    actions=actions,
                    confidence=data.get("confidence", 0.95),
                    spoken_summary=data.get("spoken_summary")
                )
            except Exception as e:
                logger.warning(f"Groq API call error: {e}, using Indic heuristic parser")

        # 2. High-precision Indic Bi-Script (Devanagari + Roman) Parser
        return self._rule_based_indic_parser(cleaned)

    def _normalize_indic_text(self, text: str) -> str:
        # Convert Devanagari numerals to Arabic digits
        res = []
        for ch in text:
            res.append(DEVANAGARI_DIGITS.get(ch, ch))
        normalized = "".join(res)
        # Convert spoken English/Hindi number words ("one hundred fifty", "ek sau pachaas")
        # that ASR engines often emit instead of digits.
        return self._word_numbers_to_digits(normalized)

    def _word_numbers_to_digits(self, text: str) -> str:
        """Convert runs of English/Hinglish number words into Arabic digits."""
        # Indian English commonly says "one fifty" for 150 / "two twenty" for 220.
        unit_words = "one|two|three|four|five|six|seven|eight|nine"
        tens_words = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety"
        def _indian_style(match: re.Match) -> str:
            return str(NUMBER_UNITS[match.group(1).lower()] * 100 + NUMBER_TENS[match.group(2).lower()])
        text = re.sub(
            rf"\b({unit_words})\s+({tens_words})\b",
            _indian_style,
            text,
            flags=re.IGNORECASE,
        )

        tokens = text.split()
        out: List[str] = []
        current = 0
        current_has_value = False
        total = 0

        def flush():
            nonlocal current, total, current_has_value
            if current_has_value:
                out.append(str(int(total + current)))
            current = 0
            total = 0
            current_has_value = False

        for token in tokens:
            cleaned = re.sub(r"[^a-zA-Z]", "", token).lower()
            if cleaned in NUMBER_UNITS:
                current += NUMBER_UNITS[cleaned]
                current_has_value = True
            elif cleaned in NUMBER_TENS:
                current += NUMBER_TENS[cleaned]
                current_has_value = True
            elif cleaned in NUMBER_SCALES:
                scale = NUMBER_SCALES[cleaned]
                if current == 0:
                    current = 1
                if scale >= 1000:
                    total += current * scale
                    current = 0
                else:
                    current *= scale
                current_has_value = True
            elif cleaned in ("and", "aur"):
                if current_has_value:
                    continue
                out.append(token)
            else:
                flush()
                out.append(token)

        flush()
        return " ".join(out)

    def _detect_customer_name(self, text: str) -> Optional[str]:
        """Best-effort customer name extraction from noisy ASR text."""
        for hindi_name, eng_name in NAME_MAP_INDIC.items():
            if hindi_name in text:
                return eng_name

        lower = text.lower()
        first = None
        first_end = -1
        for alias, canonical in ROMAN_NAME_ALIASES.items():
            match = re.search(rf"\b{re.escape(alias)}\b", lower)
            if match and (first is None or match.start() < first_end):
                first = canonical
                first_end = match.end()

        if first:
            # Attach a following surname when present ("Pooja Patel").
            rest = lower[first_end:].strip().split()
            if rest and rest[0] in KNOWN_SURNAMES:
                return f"{first} {KNOWN_SURNAMES[rest[0]]}"
            return first

        # Generic capitalized Indian name (last resort)
        stop = {
            "kal", "kaal", "aaj", "parso", "udhaar", "udhar", "diya", "jama",
            "credit", "payment", "total", "kitna", "baaki", "baki", "hisaab",
            "hisab", "tha", "hai", "ne", "ko", "ka", "ki", "ke", "aur",
        }
        match = re.search(r"\b([A-Z][a-z]{2,})\b", text)
        if match and match.group(1).lower() not in stop:
            return match.group(1)
        return None

    def _nearest_keyword_distance(self, left: str, right: str, keywords: List[str]) -> Optional[int]:
        best: Optional[int] = None
        for kw in keywords:
            i = left.rfind(kw)
            if i != -1:
                d = len(left) - i
                best = d if best is None else min(best, d)
            j = right.find(kw)
            if j != -1:
                d = j + 2
                best = d if best is None else min(best, d)
        return best

    def _detect_date(self, text: str) -> str:
        lower = text.lower()
        if "parso" in lower or "परसों" in lower:
            return "day_before_yesterday"
        if "kal" in lower or "kaal" in lower or "कल" in lower:
            return "yesterday"
        return "today"

    def _extract_keyword_amount_actions(self, text: str) -> List[ActionItem]:
        """
        Associate each numeric amount with its nearest credit/payment keyword.
        Handles ASR output that has no commas, e.g.
        "pooja patel udhar one hundred fifty kal one hundred diya tha".
        """
        amounts = list(re.finditer(r"\d+(?:\.\d+)?", text))
        if not amounts:
            return []

        actions: List[ActionItem] = []
        global_customer = self._detect_customer_name(text)

        for match in amounts:
            amount = float(match.group())
            left = text[max(0, match.start() - 45) : match.start()].lower()
            right = text[match.end() : match.end() + 35].lower()

            pay_dist = self._nearest_keyword_distance(left, right, PAYMENT_KEYWORDS)
            credit_dist = self._nearest_keyword_distance(left, right, CREDIT_KEYWORDS)

            if pay_dist is None and credit_dist is None:
                # No keyword nearby: only treat as credit if a customer is known.
                if not global_customer:
                    continue
                tx_action = "ADD_CREDIT"
            elif pay_dist is not None and (credit_dist is None or pay_dist < credit_dist):
                tx_action = "RECORD_PAYMENT"
            else:
                tx_action = "ADD_CREDIT"

            # Prefer the customer mentioned closest to this amount.
            customer = self._detect_customer_name(left) or global_customer
            if not customer:
                continue

            actions.append(
                ActionItem(
                    action=tx_action,
                    customer=customer,
                    amount=amount,
                    date=self._detect_date(left),
                    notes=text[max(0, match.start() - 30) : match.end() + 20].strip(),
                )
            )

        # Missing-verb heuristic. ASR often drops "udhaar" and yields e.g.
        # "pooja patel 150 kal 100 diya tha". When several amounts are spoken
        # and only payments were detected, the earliest amount is the credit
        # that was given; later ones are the payments made against it.
        if len(actions) >= 2 and all(a.action != "ADD_CREDIT" for a in actions):
            actions[0].action = "ADD_CREDIT"

        return actions

    def _rule_based_indic_parser(self, text: str) -> IntentResponse:
        normalized = self._normalize_indic_text(text)
        lower = normalized.lower()
        actions: List[ActionItem] = []

        # 1. Check for spoken correction: "nahi 340 nahi, 430 tha" or "नहीं 350 नहीं, 450 था"
        corr_keywords = ["nahi", "galat", "sudhar", "change", "correction", "नहीं", "गलत", "सुधार"]
        if any(k in lower for k in corr_keywords):
            nums = [float(n) for n in re.findall(r'\b\d+(?:\.\d+)?\b', lower)]
            if nums:
                new_amt = nums[-1]  # The latest/corrected amount
                actions.append(ActionItem(
                    action="CORRECTION",
                    amount=new_amt,
                    notes=f"Spoken correction to {new_amt}"
                ))
                return IntentResponse(actions=actions, confidence=0.95)

        # 2. Check for queries: "kitna baaki", "kitna udhaar", "balance", "कितना बाकी", "कितना उधार", "हिसाब"
        query_keywords = [
            "kitna baaki", "kitna udhaar", "total kitna", "balance", "hisaab", "hisab",
            "कितना बाकी", "कितना उधार", "टोटल कितना", "बैलेंस", "हिसाब", "बाकी है"
        ]
        if any(q in lower for q in query_keywords):
            target = "today" if ("aaj" in lower or "आज" in lower) else "total"
            customer = None
            # Check names in Hindi and English
            for hindi_name, eng_name in NAME_MAP_INDIC.items():
                if hindi_name in lower or eng_name.lower() in lower:
                    customer = eng_name
                    break
            actions.append(ActionItem(
                action="QUERY_BALANCE",
                customer=customer,
                target=target
            ))
            return IntentResponse(actions=actions, confidence=0.95)

        # 3. Keyword <-> amount association. ASR output usually has no commas,
        #    e.g. "pooja patel udhar one hundred fifty kal one hundred diya tha".
        keyword_actions = self._extract_keyword_amount_actions(normalized)
        if keyword_actions:
            return IntentResponse(actions=keyword_actions, confidence=0.93)

        # 4. Multi-clause parsing (split by comma, 'aur', 'और', 'lekin')
        segments = re.split(r'[,،|।]|\baur\b|\blekin\b|\bऔर\b|\bलेकिन\b', normalized, flags=re.IGNORECASE)
        default_customer = None

        for seg in segments:
            seg_str = seg.strip()
            if not seg_str:
                continue
            seg_lower = seg_str.lower()

            # Extract numbers
            num_match = re.search(r'(\d+(?:\.\d+)?)', seg_lower)
            amt = float(num_match.group(1)) if num_match else None

            # Detect customer
            cust = self._detect_customer_name(seg_str)
            if cust:
                default_customer = cust
            elif default_customer:
                cust = default_customer

            # Detect date
            date_val = self._detect_date(seg_lower)

            # Payment keywords
            is_payment = any(w in seg_lower for w in PAYMENT_KEYWORDS)

            # Credit keywords
            is_credit = any(w in seg_lower for w in CREDIT_KEYWORDS)

            if is_payment:
                actions.append(ActionItem(
                    action="RECORD_PAYMENT",
                    customer=cust or "Ramesh",
                    amount=amt or 0.0,
                    date=date_val,
                    notes=seg_str
                ))
            elif is_credit or (amt is not None and cust is not None):
                actions.append(ActionItem(
                    action="ADD_CREDIT",
                    customer=cust or "Ramesh",
                    amount=amt or 0.0,
                    date=date_val,
                    notes=seg_str
                ))

        if actions:
            return IntentResponse(actions=actions, confidence=0.92)

        return IntentResponse(actions=[ActionItem(action="UNKNOWN", notes=text)], confidence=0.5)
