import os
import re
import aiosqlite
from typing import List, Optional, Tuple, Dict, Any
from datetime import datetime
from backend.database.models import CustomerModel, TransactionModel

DB_PATH = os.environ.get("DB_PATH", "khataflow.db")

async def init_db(db_path: str = DB_PATH):
    """Initialize SQLite database schema and seed initial sample data if empty."""
    async with aiosqlite.connect(db_path) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT,
                total_balance REAL DEFAULT 0.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('CREDIT', 'PAYMENT', 'CORRECTION')),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
            )
        """)
        await db.commit()

        # Seed initial sample kirana accounts if empty
        async with db.execute("SELECT COUNT(*) FROM customers") as cursor:
            row = await cursor.fetchone()
            if row and row[0] == 0:
                initial_customers = [
                    ("Ramesh Gupta", "9876543210", 350.0),
                    ("Ramesh Verma", "9812345678", 0.0),
                    ("Suresh Sharma", "9988776655", 850.0),
                    ("Pooja Patel", "9123456780", 120.0),
                    ("Mukesh Bhai", "9345678901", -50.0),  # In advance
                ]
                for name, phone, bal in initial_customers:
                    cursor_c = await db.execute(
                        "INSERT INTO customers (name, phone, total_balance) VALUES (?, ?, ?)",
                        (name, phone, bal)
                    )
                    c_id = cursor_c.lastrowid
                    if bal > 0:
                        await db.execute(
                            "INSERT INTO transactions (customer_id, amount, type, notes) VALUES (?, ?, 'CREDIT', 'Purana baaki rashan')",
                            (c_id, bal)
                        )
                await db.commit()

class LedgerManager:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._last_transaction_id: Optional[int] = None
        self._pending_disambiguation: Optional[Dict[str, Any]] = None

    async def get_all_customers(self) -> List[Dict[str, Any]]:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM customers ORDER BY total_balance DESC, name ASC") as cursor:
                rows = await cursor.fetchall()
                return [dict(r) for r in rows]

    async def get_recent_transactions(self, limit: int = 15) -> List[Dict[str, Any]]:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT t.id, t.customer_id, t.amount, t.type, t.notes, t.created_at, c.name as customer_name
                FROM transactions t
                JOIN customers c ON t.customer_id = c.id
                ORDER BY t.id DESC LIMIT ?
            """, (limit,)) as cursor:
                rows = await cursor.fetchall()
                return [dict(r) for r in rows]

    async def find_customers_by_name(self, name: str) -> List[Dict[str, Any]]:
        cleaned_name = name.strip()
        if not cleaned_name:
            return []
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            # 1. Exact match (case-insensitive)
            async with db.execute("SELECT * FROM customers WHERE LOWER(name) = LOWER(?)", (cleaned_name,)) as cur:
                exact = await cur.fetchall()
                if exact:
                    return [dict(r) for r in exact]
            
            # 2. Word-boundary / exact prefix match (e.g. "Krishna" matching "Krishna", NOT prioritizing "Krishna Nema" over exact)
            # Find all potential matches
            async with db.execute("SELECT * FROM customers WHERE LOWER(name) LIKE LOWER(?)", (f"%{cleaned_name}%",)) as cur:
                matches = [dict(r) for r in await cur.fetchall()]
            
            if not matches:
                return []

            # If an entry's name strictly equals the cleaned_name, prioritize it
            for m in matches:
                if m["name"].lower() == cleaned_name.lower():
                    return [m]

            # If input is multiple words (e.g. "Krishna Nema"), sort by closest length match so full name wins
            matches.sort(key=lambda x: abs(len(x["name"]) - len(cleaned_name)))
            return matches

    async def get_or_create_customer(self, name: str, phone: Optional[str] = None) -> Tuple[Dict[str, Any], bool]:
        """
        Retrieves existing customer or creates a new one.
        Returns (customer_dict, is_new: bool).
        """
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM customers WHERE LOWER(name) = LOWER(?)", (name.strip(),)) as cur:
                row = await cur.fetchone()
                if row:
                    return dict(row), False
            
            cursor = await db.execute(
                "INSERT INTO customers (name, phone, total_balance) VALUES (?, ?, 0.0)",
                (name.strip(), phone or "")
            )
            await db.commit()
            new_id = cursor.lastrowid
            async with db.execute("SELECT * FROM customers WHERE id = ?", (new_id,)) as cur:
                created = await cur.fetchone()
                return dict(created), True

    async def update_customer_name(self, old_name: str, new_name: str) -> Tuple[Optional[Dict[str, Any]], str]:
        """Update or rename an existing customer."""
        cleaned_old = old_name.strip()
        cleaned_new = new_name.strip()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM customers WHERE LOWER(name) LIKE LOWER(?)", (f"%{cleaned_old}%",)) as cur:
                rows = await cur.fetchall()
                if not rows:
                    return None, f"'{cleaned_old}' naam ka grahak nahi mila."
                if len(rows) > 1:
                    return None, f"Ek se zyada grahak mile. Kripya poora naam batayein."
                
                cust = dict(rows[0])
                await db.execute("UPDATE customers SET name = ? WHERE id = ?", (cleaned_new, cust["id"]))
                await db.commit()
                cust["name"] = cleaned_new
                return cust, f"Grahak ka naam badal kar '{cleaned_new}' kar diya gaya hai."

    async def delete_customer(self, customer_id: int) -> bool:
        """Deletes a customer and cascades all transactions."""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM transactions WHERE customer_id = ?", (customer_id,))
            cursor = await db.execute("DELETE FROM customers WHERE id = ?", (customer_id,))
            await db.commit()
            return cursor.rowcount > 0

    async def get_customer_transactions(self, customer_id: int, limit: int = 25) -> List[Dict[str, Any]]:
        """Returns recent transactions for a specific customer."""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT t.id, t.customer_id, t.amount, t.type, t.notes, t.created_at, c.name as customer_name
                FROM transactions t
                JOIN customers c ON t.customer_id = c.id
                WHERE t.customer_id = ?
                ORDER BY t.id DESC LIMIT ?
            """, (customer_id, limit)) as cursor:
                rows = await cursor.fetchall()
                return [dict(r) for r in rows]

    async def record_transaction(self, customer_id: int, amount: float, tx_type: str, notes: str = "") -> Tuple[Dict[str, Any], float]:
        """
        Record a credit or payment transaction and atomically update customer's balance.
        CREDIT increases balance (customer owes more).
        PAYMENT decreases balance (customer pays off debt).
        """
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            # Fetch current balance
            async with db.execute("SELECT total_balance, name FROM customers WHERE id = ?", (customer_id,)) as cur:
                cust = await cur.fetchone()
                if not cust:
                    raise ValueError(f"Customer with id {customer_id} not found")
                current_bal = cust["total_balance"]

            # Calculate new balance rounded to 2 decimal places to prevent IEEE 754 precision issues
            if tx_type == "CREDIT":
                new_bal = round(current_bal + amount, 2)
            elif tx_type == "PAYMENT":
                new_bal = round(current_bal - amount, 2)
            else:
                new_bal = round(current_bal, 2)

            # Insert transaction
            cursor = await db.execute(
                "INSERT INTO transactions (customer_id, amount, type, notes) VALUES (?, ?, ?, ?)",
                (customer_id, amount, tx_type, notes)
            )
            tx_id = cursor.lastrowid
            self._last_transaction_id = tx_id

            # Update customer balance
            await db.execute(
                "UPDATE customers SET total_balance = ? WHERE id = ?",
                (new_bal, customer_id)
            )
            await db.commit()

            async with db.execute("""
                SELECT t.id, t.customer_id, t.amount, t.type, t.notes, t.created_at, c.name as customer_name
                FROM transactions t
                JOIN customers c ON t.customer_id = c.id
                WHERE t.id = ?
            """, (tx_id,)) as cur:
                tx_row = await cur.fetchone()
                return dict(tx_row), new_bal

    async def handle_spoken_correction(
        self,
        new_amount: float,
        target_customer: Optional[str] = None,
        target_item: Optional[str] = None,
        updated_note: Optional[str] = None,
        items: Optional[List[Any]] = None
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Handles spoken correction like "Nahi 340 nahi, 430 tha", "eggs were worth 8 each",
        or "Krishna Nema ne 10 ande kharide the, na ki 1 ande".
        Finds the exact matching transaction and updates item quantities or rates atomically,
        preserving all other existing items on the customer's bill.
        """
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            target_tx = None

            # 1. If target_customer & target_item are provided, search for that specific customer's transaction containing the item
            if target_customer:
                cand_custs = await self.find_customers_by_name(target_customer)
                if cand_custs:
                    c_id = cand_custs[0]["id"]
                    if target_item:
                        async with db.execute("""
                            SELECT t.*, c.name as customer_name, c.total_balance
                            FROM transactions t
                            JOIN customers c ON t.customer_id = c.id
                            WHERE t.customer_id = ? AND LOWER(t.notes) LIKE LOWER(?)
                            ORDER BY t.id DESC LIMIT 1
                        """, (c_id, f"%{target_item}%")) as cur:
                            target_tx = await cur.fetchone()
                    
                    if not target_tx:
                        async with db.execute("""
                            SELECT t.*, c.name as customer_name, c.total_balance
                            FROM transactions t
                            JOIN customers c ON t.customer_id = c.id
                            WHERE t.customer_id = ?
                            ORDER BY t.id DESC LIMIT 1
                        """, (c_id,)) as cur:
                            target_tx = await cur.fetchone()

            # 2. Fallback to self._last_transaction_id or latest transaction
            if not target_tx and self._last_transaction_id:
                async with db.execute("""
                    SELECT t.*, c.name as customer_name, c.total_balance
                    FROM transactions t
                    JOIN customers c ON t.customer_id = c.id
                    WHERE t.id = ?
                """, (self._last_transaction_id,)) as cur:
                    target_tx = await cur.fetchone()

            if not target_tx:
                async with db.execute("""
                    SELECT t.*, c.name as customer_name, c.total_balance
                    FROM transactions t
                    JOIN customers c ON t.customer_id = c.id
                    ORDER BY t.id DESC LIMIT 1
                """) as cur:
                    target_tx = await cur.fetchone()

            if not target_tx:
                return None, "Koi purani transaction nahi mili jise sudhara ja sake."

            tx_id = target_tx["id"]
            cust_id = target_tx["customer_id"]
            cust_name = target_tx["customer_name"]
            old_amount = target_tx["amount"]
            tx_type = target_tx["type"]
            current_bal = target_tx["total_balance"]

            old_notes = target_tx["notes"] or ""
            clean_old_notes = re.sub(r'\[.*?\]', '', old_notes).strip()

            from backend.services.item_parser import extract_line_items_from_history
            existing_items = extract_line_items_from_history([{"type": "CREDIT", "amount": old_amount, "notes": clean_old_notes}], old_amount)

            # Determine incoming items from items parameter or by parsing updated_note
            incoming_items = []
            if items:
                for it in items:
                    if hasattr(it, "model_dump"):
                        incoming_items.append(it.model_dump())
                    elif isinstance(it, dict):
                        incoming_items.append(it)
            elif updated_note:
                parsed_up = extract_line_items_from_history([{"type": "CREDIT", "amount": new_amount, "notes": updated_note}], new_amount)
                if parsed_up:
                    incoming_items = parsed_up

            calculated_amount = new_amount
            final_note = updated_note or target_tx["notes"] or "Item purchase"

            # If the transaction had multiple existing items (e.g. Ande & Maggi),
            # and the user is correcting only one of them (e.g. 10 ande instead of 1 ande):
            if existing_items and incoming_items:
                item_map = {}
                for e_it in existing_items:
                    k = e_it["name"].lower().strip()
                    item_map[k] = dict(e_it)

                for inc_it in incoming_items:
                    inc_k = inc_it["name"].lower().strip()
                    # Match exact name or substring (e.g. "ande" in "10 ande" or "egg")
                    matched_key = None
                    for exist_k in item_map:
                        if inc_k == exist_k or inc_k in exist_k or exist_k in inc_k:
                            matched_key = exist_k
                            break

                    if matched_key:
                        curr = item_map[matched_key]
                        # Preserve unit price if incoming is missing/zero, update qty & total
                        u_price = inc_it["unit_price"] if inc_it.get("unit_price") and inc_it["unit_price"] > 0 else curr["unit_price"]
                        qty = inc_it["qty"] if inc_it.get("qty") and inc_it["qty"] > 0 else curr["qty"]
                        tot = round(qty * u_price, 2)
                        item_map[matched_key] = {
                            "name": curr["name"],
                            "qty": qty,
                            "unit": curr.get("unit", "pkt"),
                            "unit_price": u_price,
                            "total": tot
                        }
                    else:
                        item_map[inc_k] = dict(inc_it)

                merged_items = list(item_map.values())
                note_parts = [f"{it['qty']:g} {it['name']} ({it['unit_price']:g}rs each)" for it in merged_items]
                final_note = ", ".join(note_parts)
                calculated_amount = round(sum(it["total"] for it in merged_items), 2)
            elif target_item and clean_old_notes:
                # Regex fallback for single item rate change
                p_qty = re.compile(
                    rf'(\d+(?:\.\d+)?)\s*(?:packet|pkt|kg|pieces?|pcs?|piece|litres|l|gm)?\s*(?:of\s*)?{re.escape(target_item)}',
                    re.I
                )
                m_qty = p_qty.search(clean_old_notes)
                existing_qty = float(m_qty.group(1)) if m_qty else None

                p_sub = re.compile(
                    rf'(\d+(?:\.\d+)?\s*(?:packet|pkt|kg|pieces?|pcs?|piece|litres|l|gm)?\s*(?:of\s*)?{re.escape(target_item)}\s*)\(\s*\d+(?:\.\d+)?\s*(?:rs|rupaye|rupees)?\s*each\s*\)',
                    re.I
                )
                if p_sub.search(clean_old_notes):
                    unit_rate = new_amount
                    if existing_qty and existing_qty > 1 and new_amount <= 50 and old_amount >= 50:
                        unit_rate = new_amount
                        calculated_amount = round(existing_qty * unit_rate, 2)
                    final_note = p_sub.sub(rf'\g<1>({unit_rate:g}rs each)', clean_old_notes)
                    re_items = extract_line_items_from_history([{"type": "CREDIT", "amount": 999999, "notes": final_note}], 999999)
                    if re_items:
                        calculated_amount = round(sum(it["total"] for it in re_items), 2)

            new_amount = calculated_amount

            # Compute balance difference rounded to 2 decimal places
            diff = round(new_amount - old_amount, 2)
            if tx_type == "CREDIT":
                updated_balance = round(current_bal + diff, 2)
            elif tx_type == "PAYMENT":
                updated_balance = round(current_bal - diff, 2)
            else:
                updated_balance = round(current_bal, 2)

            # Update transaction amount & notes
            if "[Sudhara" not in final_note:
                notes = f"{final_note} [Sudhara gaya: {old_amount} se {new_amount}]"
            else:
                notes = final_note

            await db.execute(
                "UPDATE transactions SET amount = ?, notes = ? WHERE id = ?",
                (new_amount, notes, tx_id)
            )
            await db.execute(
                "UPDATE customers SET total_balance = ? WHERE id = ?",
                (updated_balance, cust_id)
            )
            await db.commit()

            msg = f"{cust_name} ka transaction sudhar kar {new_amount:g} rupaye kar diya hai. Ab total {updated_balance:g} rupaye baaki hai."
            return {
                "transaction_id": tx_id,
                "customer_id": cust_id,
                "customer_name": cust_name,
                "old_amount": old_amount,
                "new_amount": new_amount,
                "new_balance": updated_balance
            }, msg

    async def query_balance(self, customer_name: Optional[str] = None, target: str = "total") -> Tuple[Optional[float], str]:
        """
        Calculates balance for a customer or overall ledger totals (aaj kitna udhaar gaya).
        """
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            if customer_name:
                candidates = await self.find_customers_by_name(customer_name)
                if not candidates:
                    return None, f"{customer_name} naam ka koi grahak ledger me nahi mila."
                if len(candidates) > 1:
                    names_str = " aur ".join([f"{c['name']} ({c['phone'] or 'no phone'})" for c in candidates])
                    return None, f"{customer_name} naam ke ek se zyada grahak hain: {names_str}. Kripya poora naam ya phone batayein."
                
                cust = candidates[0]
                bal = cust["total_balance"]
                if bal > 0:
                    return bal, f"{cust['name']} ka total {int(bal)} rupaye udhaar baaki hai."
                elif bal < 0:
                    return bal, f"{cust['name']} ka {int(abs(bal))} rupaye advance jama hai."
                else:
                    return 0.0, f"{cust['name']} ka sara hisab barabar hai, koi baaki nahi."

            # Overall ledger queries (e.g. "Aaj kitna udhaar gaya?")
            if target == "today" or "aaj" in target.lower():
                async with db.execute("""
                    SELECT COALESCE(SUM(amount), 0) as total_today 
                    FROM transactions 
                    WHERE type = 'CREDIT' AND DATE(created_at) = DATE('now', 'localtime')
                """) as cur:
                    row = await cur.fetchone()
                    today_credit = row["total_today"] if row else 0
                    return today_credit, f"Aaj dukaan se total {int(today_credit)} rupaye ka udhaar gaya hai."

            # Total outstanding across all customers
            async with db.execute("SELECT COALESCE(SUM(total_balance), 0) as grand_total FROM customers WHERE total_balance > 0") as cur:
                row = await cur.fetchone()
                grand_total = row["grand_total"] if row else 0
                return grand_total, f"Puri dukaan ka market me kul {int(grand_total)} rupaye udhaar baaki hai."

    def set_pending_disambiguation(self, data: Optional[Dict[str, Any]]):
        self._pending_disambiguation = data

    def get_pending_disambiguation(self) -> Optional[Dict[str, Any]]:
        return self._pending_disambiguation
