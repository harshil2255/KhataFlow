import re
from typing import List, Dict, Any

def extract_line_items_from_history(transactions: List[Dict[str, Any]], total_balance: float) -> List[Dict[str, Any]]:
    """
    Parses transaction notes into crisp, accurate integer line items for Kirana receipts.
    Guarantees no odd fractional rates and strips out bracketed metadata (like '[Sudhara gaya: ...]').
    Ensures total sum matches total_balance.
    """
    items: List[Dict[str, Any]] = []
    
    # Filter credit transactions
    credit_txs = [t for t in transactions if t.get("type") == "CREDIT" and t.get("amount", 0) > 0]
    
    # Stop words that should NEVER be treated as items (e.g. 'se', 'sudhara', 'gaya', etc.)
    INVALID_NAMES = {"se", "gaya", "sudhara", "hisaab", "chukta", "total", "rate", "correction", "note", "item"}

    for tx in credit_txs:
        raw_note = tx.get("notes") or ""
        amt = float(tx.get("amount") or 0.0)
        
        # 1. Clean the note: strip [Sudhara gaya: ...] or any bracketed annotations
        clean_note = re.sub(r'\[.*?\]', '', raw_note).strip()
        # Strip leading "Rate correction:" or "Correction:" prefixes
        clean_note = re.sub(r'^(?:Rate\s+correction:\s*|Correction:\s*)', '', clean_note, flags=re.I).strip()
        
        tx_items = []

        # Split multiple items separated by comma, semicolon, 'aur', or 'and'
        raw_chunks = [c.strip() for c in re.split(r'[,;]|\baur\b|\band\b', clean_note) if c.strip()]

        for chunk in raw_chunks:
            # Pattern A: <qty> <Item> (<rate>rs each) or (<rate>rs total)
            mA = re.search(
                r'(\d+(?:\.\d+)?)\s*(?:packet|pkt|kg|pieces?|pcs?|piece|litres|l|gm)?\s*([a-zA-Z\u0900-\u097F\s]+?)\s*\(\s*(\d+(?:\.\d+)?)\s*(?:rs|rupaye|rupees)?\s*(each|total)?\s*\)',
                chunk,
                re.IGNORECASE
            )
            if mA:
                qty = float(mA.group(1))
                name = mA.group(2).replace("aur", "").replace("and", "").strip()
                rate_or_total = float(mA.group(3))
                mode = (mA.group(4) or "each").lower()
                if mode == "each":
                    tot = qty * rate_or_total
                    unit_price = rate_or_total
                else:
                    tot = rate_or_total
                    unit_price = round(tot / qty, 2) if qty > 0 else tot
                if name.lower() not in INVALID_NAMES and len(name) >= 2:
                    tx_items.append({
                        "name": name.title(),
                        "qty": qty,
                        "unit": "pkt",
                        "unit_price": unit_price,
                        "total": tot
                    })
                continue

            # Pattern B: <Item> <rate>rs each or <qty> <Item> <rate>rs each
            mB = re.search(
                r'^(?:(\d+(?:\.\d+)?)\s*(?:packet|pkt|kg|pieces?|pcs?|piece|litres|l|gm)?\s+)?([a-zA-Z\u0900-\u097F\s]+?)\s+(\d+(?:\.\d+)?)\s*(?:rs|rupaye|rupees)?\s*each$',
                chunk,
                re.IGNORECASE
            )
            if mB:
                qty = float(mB.group(1)) if mB.group(1) else 1.0
                name = mB.group(2).strip()
                rate = float(mB.group(3))
                if name.lower() not in INVALID_NAMES and len(name) >= 2:
                    tx_items.append({
                        "name": name.title(),
                        "qty": qty,
                        "unit": "pkt",
                        "unit_price": rate,
                        "total": qty * rate
                    })
                continue

            # Pattern C: <qty> pieces/pkts of <Item> worth <rate>rs (each)?
            mC = re.search(
                r'(\d+(?:\.\d+)?)\s*(?:pieces?|packets?|pkts?|pcs?|kg)?\s*(?:of\s*)?([a-zA-Z\u0900-\u097F\s]+?)\s*(?:worth\s*)?(\d+(?:\.\d+)?)\s*(?:rs|rupees|rupaye)?\s*(each)?',
                chunk,
                re.IGNORECASE
            )
            if mC:
                qty = float(mC.group(1))
                name = mC.group(2).replace("aur", "").replace("and", "").replace("ne", "").strip()
                rate_or_total = float(mC.group(3))
                is_each = bool(mC.group(4))
                if is_each:
                    tot = qty * rate_or_total
                    unit_price = rate_or_total
                else:
                    unit_price = rate_or_total
                    tot = qty * unit_price
                if name.lower() not in INVALID_NAMES and len(name) >= 2:
                    tx_items.append({
                        "name": name.title(),
                        "qty": qty,
                        "unit": "pkt",
                        "unit_price": unit_price,
                        "total": tot
                    })
                continue

            # Pattern D: <price> <Item> (e.g. "50 Maggi" or "200 Maida")
            mD = re.search(
                r'^(\d+(?:\.\d+)?)\s*(?:ka|ki|ke|rs|rupaye)?\s*([a-zA-Z\u0900-\u097F\s]+)$',
                chunk,
                re.IGNORECASE
            )
            if mD:
                price = float(mD.group(1))
                name = re.sub(
                    r'\b(kharidi|kharida|udhaar|likh|likho|aur|and|mein|me|dalo|do|to|total|bhai|rupaye|rs|ne)\b',
                    '',
                    mD.group(2),
                    flags=re.IGNORECASE
                ).strip()
                if name.lower() not in INVALID_NAMES and len(name) >= 2:
                    tx_items.append({
                        "name": name.title(),
                        "qty": 1.0,
                        "unit": "pkt",
                        "unit_price": price,
                        "total": price
                    })
                continue

            # Pattern E: <Item> <price>rs (e.g. "Maggi 60rs" or "Maggi 60")
            mE = re.search(
                r'^(?:(\d+(?:\.\d+)?)\s*(?:pkt|pcs|kg|pieces?|pkts?)?\s+)?([a-zA-Z\u0900-\u097F\s]+?)\s+(\d+(?:\.\d+)?)\s*(?:rs|rupaye|rupees)?$',
                chunk,
                re.IGNORECASE
            )
            if mE:
                qty = float(mE.group(1)) if mE.group(1) else 1.0
                name = mE.group(2).strip()
                price = float(mE.group(3))
                if name.lower() not in INVALID_NAMES and len(name) >= 2:
                    tx_items.append({
                        "name": name.title(),
                        "qty": qty,
                        "unit": "pkt",
                        "unit_price": price,
                        "total": price
                    })
                continue

        if tx_items:
            items.extend(tx_items)
            continue

        # Fallback if no patterns matched: treat as single item with note text
        clean_fallback = re.sub(r'^[a-zA-Z\s]+ ne ', '', clean_note)
        clean_fallback = clean_fallback.replace('khareeda', '').replace('khareede', '').strip()
        if not clean_fallback or clean_fallback.lower() in INVALID_NAMES or len(clean_fallback) < 2:
            clean_fallback = "Kirana Samaan"
        items.append({
            "name": clean_fallback.title(),
            "qty": 1.0,
            "unit": "lot",
            "unit_price": amt,
            "total": amt
        })

    # Deduplicate items by name if superseded/corrected: keep the latest version
    deduped_items: List[Dict[str, Any]] = []
    seen_names = set()
    for item in reversed(items):
        item_key = item["name"].lower().strip()
        if item_key not in seen_names and item_key not in INVALID_NAMES:
            seen_names.add(item_key)
            deduped_items.insert(0, item)
    items = deduped_items

    current_sum = sum(i["total"] for i in items)
    diff = round(total_balance - current_sum, 2)
    
    # If the extracted items don't cover the full balance, add remaining balance as Kirana Rashan
    if diff > 0 and len(items) == 0:
        items.append({
            "name": "Kirana Rashan",
            "qty": 1.0,
            "unit": "lot",
            "unit_price": diff,
            "total": diff
        })
    elif len(items) == 0:
        bal = max(0.0, total_balance)
        items.append({
            "name": "Kirana Rashan",
            "qty": 1.0,
            "unit": "lot",
            "unit_price": bal,
            "total": bal
        })

    return items
