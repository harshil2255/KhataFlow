import os
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
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            # Try exact match first
            async with db.execute("SELECT * FROM customers WHERE LOWER(name) = LOWER(?)", (cleaned_name,)) as cur:
                exact = await cur.fetchall()
                if exact:
                    return [dict(r) for r in exact]
            
            # Substring / first name match
            async with db.execute("SELECT * FROM customers WHERE LOWER(name) LIKE LOWER(?)", (f"%{cleaned_name}%",)) as cur:
                matches = await cur.fetchall()
                return [dict(r) for r in matches]

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

            # Calculate new balance
            if tx_type == "CREDIT":
                new_bal = current_bal + amount
            elif tx_type == "PAYMENT":
                new_bal = current_bal - amount
            else:
                new_bal = current_bal

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

    async def handle_spoken_correction(self, new_amount: float) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Handles spoken correction like "Nahi 340 nahi, 430 tha"
        Rolls back the difference from the latest active transaction atomically.
        """
        if not self._last_transaction_id:
            return None, "Koi purani transaction nahi mili jise sudhara ja sake."

        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT t.*, c.name as customer_name, c.total_balance
                FROM transactions t
                JOIN customers c ON t.customer_id = c.id
                WHERE t.id = ?
            """, (self._last_transaction_id,)) as cur:
                tx = await cur.fetchone()
                if not tx:
                    return None, "Transaction record nahi mila."

            cust_id = tx["customer_id"]
            cust_name = tx["customer_name"]
            old_amount = tx["amount"]
            tx_type = tx["type"]
            current_bal = tx["total_balance"]

            # Compute balance difference
            diff = new_amount - old_amount
            if tx_type == "CREDIT":
                updated_balance = current_bal + diff
            elif tx_type == "PAYMENT":
                updated_balance = current_bal - diff
            else:
                updated_balance = current_bal

            # Update transaction amount & note
            notes = (tx["notes"] or "") + f" [Sudhara gaya: {old_amount} se {new_amount}]"
            await db.execute(
                "UPDATE transactions SET amount = ?, notes = ? WHERE id = ?",
                (new_amount, notes, self._last_transaction_id)
            )
            await db.execute(
                "UPDATE customers SET total_balance = ? WHERE id = ?",
                (updated_balance, cust_id)
            )
            await db.commit()

            msg = f"{cust_name} ka transaction sudhar kar {int(new_amount)} rupaye kar diya hai. Ab total {int(updated_balance)} rupaye baaki hai."
            return {
                "transaction_id": self._last_transaction_id,
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
