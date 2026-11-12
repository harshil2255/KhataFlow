import os
import math
import sqlite3
import hashlib
import logging
import aiosqlite
from contextlib import asynccontextmanager
from typing import List, Optional, Tuple, Dict, Any
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

logger = logging.getLogger("KhataFlowLedger")

DB_PATH = os.environ.get("DB_PATH", "khataflow.db")


# ==========================================
# Custom Exceptions
# ==========================================
class IdempotencyConflictError(ValueError):
    """
    Raised when an existing idempotency key is reused with a different request payload
    (e.g., different customer, different amount, or different transaction type).
    Equivalent to HTTP 409 Conflict.
    """
    pass


# ==========================================
# Financial Precision Helpers & Documentation
# ==========================================
# NOTE ON SQLITE REAL LIMITATION:
# SQLite's `REAL` column type stores 8-byte IEEE 754 floating-point numbers.
# Binary floats CANNOT represent certain base-10 decimals (like 0.10 or 0.07) with
# absolute mathematical precision at the bit level. SQLite `REAL` does NOT provide
# exact decimal storage.
#
# ARCHITECTURAL SAFEGUARD:
# All ledger calculations are strictly performed in Python using `decimal.Decimal`
# with 2-decimal paisa quantization (`ROUND_HALF_UP`).
#
# SQLite `REAL` remains an approximate binary floating-point storage format.
# Quantizing values when reading from and writing to SQLite normalizes numbers
# to two decimal places for business logic and JSON transport, but this does NOT
# make SQLite REAL exact decimal storage.
#
# Under NO circumstances should arithmetic be performed inside SQL (`total_balance + ?`).
# ==========================================

def to_decimal(value: Any) -> Decimal:
    """
    Convert any numeric value or string to a Decimal quantized to 2 decimal places
    using ROUND_HALF_UP (standard commercial rounding). Normalizes binary float inputs
    to a consistent two-decimal representation in Python.
    """
    if value is None:
        return Decimal("0.00")
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def to_currency_float(value: Any) -> float:
    """
    Convert a Decimal, float, or int to a clean, 2-decimal rounded Python float.
    Used ONLY at the SQLite/JSON boundary. All arithmetic must occur in Decimal.
    """
    return float(to_decimal(value))


def validate_stored_amount(raw_amt: Any, tx_id: int, action_context: str = "process transaction") -> Decimal:
    """
    Validate a stored transaction amount before applying financial operations.
    Rejects:
    - None / NULL
    - Boolean values
    - Non-numeric / non-convertible types
    - Float / String / Decimal NaN or +/- Infinity
    - Zero or negative amounts
    Raises a descriptive ValueError identifying the transaction ID.
    Returns the validated Decimal quantized to 2 decimal places.
    """
    msg_prefix = f"Cannot {action_context}: transaction {tx_id} has"

    if raw_amt is None:
        raise ValueError(f"{msg_prefix} invalid NULL amount.")

    if isinstance(raw_amt, bool) or not isinstance(raw_amt, (int, float, Decimal, str)):
        raise ValueError(f"{msg_prefix} non-numeric amount: {raw_amt!r}.")

    if isinstance(raw_amt, float) and (math.isnan(raw_amt) or math.isinf(raw_amt)):
        raise ValueError(f"{msg_prefix} non-finite amount: {raw_amt}.")

    if isinstance(raw_amt, str) and raw_amt.strip().lower() in ("nan", "inf", "+inf", "-inf", "infinity", "+infinity", "-infinity"):
        raise ValueError(f"{msg_prefix} non-finite amount: {raw_amt}.")

    try:
        amt_dec = to_decimal(raw_amt)
    except Exception as e:
        raise ValueError(f"{msg_prefix} non-convertible amount {raw_amt!r}: {e}") from e

    if amt_dec.is_nan() or amt_dec.is_infinite():
        raise ValueError(f"{msg_prefix} non-finite amount: {raw_amt}.")

    if amt_dec <= Decimal("0.00"):
        raise ValueError(f"{msg_prefix} non-positive amount: {raw_amt}.")

    return amt_dec


def compute_request_hash(customer_id: int, amount: Any, tx_type: str, notes: str = "") -> str:
    """
    Generate a deterministic SHA-256 fingerprint for a transaction request payload.
    Combines:
    - customer_id (int)
    - amount (strictly formatted to 2 decimal places, e.g. '150.50')
    - tx_type (normalized to uppercase trimmed string, e.g. 'CREDIT' or 'PAYMENT')
    - notes (normalized to trimmed string, e.g. '1kg dal')
    """
    amt_str = f"{to_decimal(amount):.2f}"
    norm_type = (tx_type or "").strip().upper()
    norm_notes = (notes or "").strip()
    payload = f"{customer_id}:{amt_str}:{norm_type}:{norm_notes}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ==========================================
# Database Backup Helper (Native SQLite Backup)
# ==========================================
def create_database_backup(db_path: str) -> str:
    """
    Create a timestamped backup of the database using SQLite's native Online Backup API.
    Guarantees:
    - Flushes and includes uncheckpointed WAL pages safely.
    - Verifies backup using PRAGMA integrity_check.
    - Verifies customer and transaction row counts match live database.
    - Verifies every individual customer ID and normalized balance matches.
    - Verifies every individual transaction ID, customer ID, normalized amount, and type matches.
    - If any verification fails, removes the corrupt backup and raises RuntimeError.
    """
    if not os.path.exists(db_path) or os.path.getsize(db_path) == 0:
        return ""

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = f"{db_path}.bak_{timestamp}"

    try:
        # Use SQLite's native backup API (locks pages, captures committed WAL data)
        with sqlite3.connect(db_path) as src_conn, sqlite3.connect(backup_path) as dst_conn:
            src_conn.backup(dst_conn)

        # Verification 1: PRAGMA integrity_check on the backup
        with sqlite3.connect(backup_path) as verify_conn:
            cur = verify_conn.cursor()
            cur.execute("PRAGMA integrity_check;")
            row = cur.fetchone()
            if not row or row[0].lower() != "ok":
                raise RuntimeError(f"Backup failed PRAGMA integrity_check: {row}")

            # Verification 2: Row counts
            cur.execute("SELECT COUNT(*) FROM customers;")
            backup_cust_count = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM transactions;")
            backup_tx_count = cur.fetchone()[0]

            # Verification 3: Customer IDs and normalized balances
            cur.execute("SELECT id, total_balance FROM customers ORDER BY id;")
            backup_customers = [(r[0], f"{to_decimal(r[1]):.2f}") for r in cur.fetchall()]

            # Verification 4: Transaction IDs and relevant stored fields
            cur.execute("SELECT id, customer_id, amount, type FROM transactions ORDER BY id;")
            backup_transactions = [(r[0], r[1], f"{to_decimal(r[2]):.2f}", r[3]) for r in cur.fetchall()]

        with sqlite3.connect(db_path) as live_conn:
            live_cur = live_conn.cursor()
            live_cur.execute("SELECT COUNT(*) FROM customers;")
            live_cust_count = live_cur.fetchone()[0]

            live_cur.execute("SELECT COUNT(*) FROM transactions;")
            live_tx_count = live_cur.fetchone()[0]

            live_cur.execute("SELECT id, total_balance FROM customers ORDER BY id;")
            live_customers = [(r[0], f"{to_decimal(r[1]):.2f}") for r in live_cur.fetchall()]

            live_cur.execute("SELECT id, customer_id, amount, type FROM transactions ORDER BY id;")
            live_transactions = [(r[0], r[1], f"{to_decimal(r[2]):.2f}", r[3]) for r in live_cur.fetchall()]

        # Compare row counts
        if backup_cust_count != live_cust_count or backup_tx_count != live_tx_count:
            raise RuntimeError(
                f"Backup row count mismatch! "
                f"Customers (live: {live_cust_count}, backup: {backup_cust_count}); "
                f"Transactions (live: {live_tx_count}, backup: {backup_tx_count})."
            )

        # Compare exact customer balances
        if backup_customers != live_customers:
            raise RuntimeError("Backup customer balance mismatch! Stored balance values do not match live data.")

        # Compare exact transaction records
        if backup_transactions != live_transactions:
            raise RuntimeError("Backup transaction record mismatch! Stored transaction details do not match live data.")

        logger.info(f"Native SQLite backup verified successfully at: {backup_path}")
        return backup_path

    except Exception as e:
        if os.path.exists(backup_path):
            try:
                os.remove(backup_path)
            except Exception:
                pass
        raise RuntimeError(
            f"Database backup failed or corrupted before migration: {e}. "
            f"Aborting migration to protect data integrity."
        ) from e


# ==========================================
# Database Initialization & Safe Migration
# ==========================================
async def init_db(db_path: str = DB_PATH):
    """
    Initialize SQLite database schema, perform safe non-destructive migrations
    with native verified backup, and seed initial sample data if empty.
    """
    db_file_existed = os.path.exists(db_path) and os.path.getsize(db_path) > 0

    async with aiosqlite.connect(db_path) as db:
        # PRAGMA configurations for concurrency & data integrity
        await db.execute("PRAGMA foreign_keys = ON;")
        await db.execute("PRAGMA journal_mode = WAL;")
        await db.execute("PRAGMA busy_timeout = 5000;")

        # Base tables
        await db.execute("""
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT,
                total_balance REAL DEFAULT 0.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
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
            );
        """)
        await db.commit()

        # Schema inspection: Check existing columns in 'transactions' table
        cursor = await db.execute("PRAGMA table_info(transactions);")
        tx_columns = [row[1] for row in await cursor.fetchall()]

        missing_tx_columns = []
        if "is_deleted" not in tx_columns:
            missing_tx_columns.append("is_deleted")
        if "deleted_at" not in tx_columns:
            missing_tx_columns.append("deleted_at")
        if "idempotency_key" not in tx_columns:
            missing_tx_columns.append("idempotency_key")

        # Check idempotency_requests table status
        cursor = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_requests';")
        idemp_table_exists = (await cursor.fetchone()) is not None

        idemp_needs_rebuild = False
        idemp_missing_hash = False

        if idemp_table_exists:
            # Check foreign key delete action
            cursor = await db.execute("PRAGMA foreign_key_list(idempotency_requests);")
            fk_rows = await cursor.fetchall()
            for r in fk_rows:
                # r[6] is on_delete
                if r[6].upper() == "CASCADE":
                    idemp_needs_rebuild = True
                    break

            # Check if request_hash column is present
            cursor = await db.execute("PRAGMA table_info(idempotency_requests);")
            idemp_cols = [r[1] for r in await cursor.fetchall()]
            if "request_hash" not in idemp_cols:
                idemp_missing_hash = True

        migration_required = bool(missing_tx_columns or idemp_needs_rebuild or idemp_missing_hash)

        # Create verified native backup ONLY if migration is required on an existing database file
        if db_file_existed and migration_required:
            logger.info("Schema migration required. Initiating verified native backup...")
            create_database_backup(db_path)

        # Migration block wrapped in explicit transaction rollback
        try:
            await db.execute("BEGIN IMMEDIATE;")

            # 1. Apply non-destructive column additions to transactions table
            if "is_deleted" in missing_tx_columns:
                await db.execute("ALTER TABLE transactions ADD COLUMN is_deleted INTEGER DEFAULT 0;")
            if "deleted_at" in missing_tx_columns:
                await db.execute("ALTER TABLE transactions ADD COLUMN deleted_at TIMESTAMP DEFAULT NULL;")
            if "idempotency_key" in missing_tx_columns:
                await db.execute("ALTER TABLE transactions ADD COLUMN idempotency_key TEXT DEFAULT NULL;")

            # 2. Setup or migrate idempotency_requests with ON DELETE RESTRICT and request_hash
            if not idemp_table_exists:
                await db.execute("""
                    CREATE TABLE IF NOT EXISTS idempotency_requests (
                        idempotency_key TEXT PRIMARY KEY,
                        transaction_id INTEGER NOT NULL,
                        request_hash TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE RESTRICT
                    );
                """)
            elif idemp_needs_rebuild:
                # Safe table rebuild preserving all records with ON DELETE RESTRICT
                logger.info("Migrating idempotency_requests table to ON DELETE RESTRICT...")
                await db.execute("""
                    CREATE TABLE idempotency_requests_new (
                        idempotency_key TEXT PRIMARY KEY,
                        transaction_id INTEGER NOT NULL,
                        request_hash TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE RESTRICT
                    );
                """)
                if idemp_missing_hash:
                    await db.execute("""
                        INSERT INTO idempotency_requests_new (idempotency_key, transaction_id, created_at)
                        SELECT idempotency_key, transaction_id, created_at FROM idempotency_requests;
                    """)
                else:
                    await db.execute("""
                        INSERT INTO idempotency_requests_new (idempotency_key, transaction_id, request_hash, created_at)
                        SELECT idempotency_key, transaction_id, request_hash, created_at FROM idempotency_requests;
                    """)
                await db.execute("DROP TABLE idempotency_requests;")
                await db.execute("ALTER TABLE idempotency_requests_new RENAME TO idempotency_requests;")
            elif idemp_missing_hash:
                await db.execute("ALTER TABLE idempotency_requests ADD COLUMN request_hash TEXT DEFAULT NULL;")

            # 3. Backfill missing request_hash for existing records if transactions still exist
            cursor = await db.execute("""
                SELECT ir.idempotency_key, t.customer_id, t.amount, t.type, t.notes
                FROM idempotency_requests ir
                JOIN transactions t ON ir.transaction_id = t.id
                WHERE ir.request_hash IS NULL;
            """)
            unhashed_records = await cursor.fetchall()
            for key, cust_id, amt, t_type, t_notes in unhashed_records:
                h = compute_request_hash(cust_id, amt, t_type, t_notes)
                await db.execute(
                    "UPDATE idempotency_requests SET request_hash = ? WHERE idempotency_key = ?",
                    (h, key)
                )

            # 4. Required Composite Indexes:
            # Customer-specific active transactions (customer_id, is_deleted, created_at DESC)
            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_transactions_customer_active
                ON transactions (customer_id, is_deleted, created_at DESC);
            """)

            # Global recent active transactions (is_deleted, id DESC)
            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_transactions_recent_active
                ON transactions (is_deleted, id DESC);
            """)

            # Idempotency requests foreign key index
            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_idempotency_requests_tx_id
                ON idempotency_requests (transaction_id);
            """)

            # 5. Verify foreign key integrity after schema modifications
            cursor = await db.execute("PRAGMA foreign_key_check;")
            fk_violations = await cursor.fetchall()
            if fk_violations:
                raise RuntimeError(f"Foreign key violations detected during migration: {fk_violations}")

            await db.commit()
        except Exception as e:
            await db.rollback()
            logger.error(f"Migration failed and was rolled back: {e}")
            raise

        # Seed initial sample kirana accounts if empty
        async with db.execute("SELECT COUNT(*) FROM customers") as cur:
            row = await cur.fetchone()
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


# ==========================================
# Ledger Manager Class
# ==========================================
class LedgerManager:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._last_transaction_id: Optional[int] = None
        self._pending_disambiguation: Optional[Dict[str, Any]] = None

    @asynccontextmanager
    async def get_connection(self):
        """
        Read-oriented connection manager.
        Ensures foreign_keys=ON, busy_timeout=5000, row_factory=Row,
        and guaranteed closure upon exit.
        """
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA foreign_keys = ON;")
            await db.execute("PRAGMA busy_timeout = 5000;")
            db.row_factory = aiosqlite.Row
            yield db

    @asynccontextmanager
    async def transaction(self):
        """
        Reusable atomic transaction context manager for multi-table writes.
        - Executes BEGIN IMMEDIATE to acquire a write lock immediately.
        - Commits when all operations succeed.
        - Rolls back when any exception occurs.
        - Closes connection safely.
        """
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA foreign_keys = ON;")
            await db.execute("PRAGMA busy_timeout = 5000;")
            db.row_factory = aiosqlite.Row
            await db.execute("BEGIN IMMEDIATE;")
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise

    async def get_all_customers(self) -> List[Dict[str, Any]]:
        async with self.get_connection() as db:
            async with db.execute("SELECT * FROM customers ORDER BY total_balance DESC, name ASC") as cursor:
                rows = await cursor.fetchall()
                return [dict(r) for r in rows]

    async def get_recent_transactions(self, limit: int = 15) -> List[Dict[str, Any]]:
        """Fetch active (non-deleted) recent transactions across all customers."""
        async with self.get_connection() as db:
            async with db.execute("""
                SELECT t.id, t.customer_id, t.amount, t.type, t.notes, t.created_at, c.name as customer_name
                FROM transactions t
                JOIN customers c ON t.customer_id = c.id
                WHERE t.is_deleted = 0
                ORDER BY t.id DESC LIMIT ?
            """, (limit,)) as cursor:
                rows = await cursor.fetchall()
                return [dict(r) for r in rows]

    async def get_customer_transactions(
        self,
        customer_id: int,
        limit: int = 20,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """
        Fetch active (non-deleted) transactions belonging strictly to the requested customer_id.
        - Excludes soft-deleted transactions (queries WHERE is_deleted = 0).
        - Ordered newest first (created_at DESC), with transaction id DESC as secondary tie-breaker.
        - Supports limit (1 to 100) and offset (>= 0) pagination.
        - Returns empty list if customer exists with no transactions.
        - Raises ValueError if customer_id does not exist or parameters are invalid.
        """
        # Input validation
        if not isinstance(customer_id, int) or isinstance(customer_id, bool) or customer_id <= 0:
            raise ValueError(f"customer_id must be a positive integer, got: {customer_id}")

        if not isinstance(limit, int) or isinstance(limit, bool) or limit <= 0 or limit > 100:
            raise ValueError(f"limit must be an integer between 1 and 100, got: {limit}")

        if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
            raise ValueError(f"offset must be an integer greater than or equal to 0, got: {offset}")

        async with self.get_connection() as db:
            # Verify customer exists in database
            async with db.execute("SELECT id FROM customers WHERE id = ?", (customer_id,)) as cur:
                if not await cur.fetchone():
                    raise ValueError(f"Customer with id {customer_id} not found")

            # Parameterized query fetching customer's active transaction passbook
            async with db.execute("""
                SELECT t.id, t.customer_id, t.amount, t.type, t.notes, t.created_at, c.name as customer_name
                FROM transactions t
                JOIN customers c ON t.customer_id = c.id
                WHERE t.customer_id = ? AND t.is_deleted = 0
                ORDER BY t.created_at DESC, t.id DESC
                LIMIT ? OFFSET ?
            """, (customer_id, limit, offset)) as cursor:
                rows = await cursor.fetchall()
                result = []
                for r in rows:
                    d = dict(r)
                    d["amount"] = to_currency_float(d["amount"])
                    result.append(d)
                return result

    async def find_customers_by_name(self, name: str) -> List[Dict[str, Any]]:
        cleaned_name = name.strip()
        async with self.get_connection() as db:
            # Try exact match first
            async with db.execute("SELECT * FROM customers WHERE LOWER(name) = LOWER(?)", (cleaned_name,)) as cur:
                exact = await cur.fetchall()
                if exact:
                    return [dict(r) for r in exact]

            # Substring / first name match
            async with db.execute("SELECT * FROM customers WHERE LOWER(name) LIKE LOWER(?)", (f"%{cleaned_name}%",)) as cur:
                matches = await cur.fetchall()
                return [dict(r) for r in matches]

    async def get_or_create_customer(self, name: str, phone: Optional[str] = None) -> Dict[str, Any]:
        async with self.transaction() as db:
            async with db.execute("SELECT * FROM customers WHERE LOWER(name) = LOWER(?)", (name.strip(),)) as cur:
                row = await cur.fetchone()
                if row:
                    return dict(row)

            cursor = await db.execute(
                "INSERT INTO customers (name, phone, total_balance) VALUES (?, ?, 0.0)",
                (name.strip(), phone or "")
            )
            new_id = cursor.lastrowid
            async with db.execute("SELECT * FROM customers WHERE id = ?", (new_id,)) as cur:
                created = await cur.fetchone()
                return dict(created)

    async def record_transaction(
        self,
        customer_id: int,
        amount: float,
        tx_type: str,
        notes: str = "",
        idempotency_key: Optional[str] = None
    ) -> Tuple[Dict[str, Any], float]:
        """
        Record a credit or payment transaction and atomically update customer's balance.
        If idempotency_key is provided:
        - Computes SHA-256 fingerprint from (customer_id, amount, tx_type, notes).
        - If key already exists:
            - If fingerprint matches (or legacy fields match): returns original transaction without modifying balance.
            - If fingerprint differs: raises IdempotencyConflictError (HTTP 409 Conflict).
        - Inside an atomic transaction (BEGIN IMMEDIATE), records transaction, updates balance,
          and registers the key and hash into idempotency_requests.
        """
        # Validate customer_id
        if not isinstance(customer_id, int) or isinstance(customer_id, bool) or customer_id <= 0:
            raise ValueError(f"customer_id must be a positive integer, got: {customer_id}")

        # Validate tx_type
        if not isinstance(tx_type, str):
            raise ValueError(f"tx_type must be a string ('CREDIT' or 'PAYMENT'), got: {type(tx_type).__name__}")
        norm_type = tx_type.strip().upper()
        if norm_type not in ("CREDIT", "PAYMENT"):
            raise ValueError(f"tx_type must be 'CREDIT' or 'PAYMENT', got: '{tx_type}'")

        # Validate amount
        if isinstance(amount, bool) or not isinstance(amount, (int, float, Decimal)):
            raise ValueError(f"amount must be a numeric value, got: {amount}")
        if isinstance(amount, float) and (math.isnan(amount) or math.isinf(amount)):
            raise ValueError(f"amount must be a finite number, got: {amount}")
        amt_dec = to_decimal(amount)
        if amt_dec <= Decimal("0.00"):
            raise ValueError(f"Transaction amount must be strictly positive, got: {amount}")

        incoming_hash = compute_request_hash(customer_id, amt_dec, norm_type, notes) if idempotency_key else None

        # Fast-path idempotency check before write lock
        if idempotency_key and incoming_hash:
            async with self.get_connection() as db:
                async with db.execute("""
                    SELECT t.id, t.customer_id, t.amount, t.type, t.notes, t.created_at,
                           c.name as customer_name, c.total_balance, ir.request_hash
                    FROM idempotency_requests ir
                    JOIN transactions t ON ir.transaction_id = t.id
                    JOIN customers c ON t.customer_id = c.id
                    WHERE ir.idempotency_key = ?
                """, (idempotency_key,)) as cur:
                    existing = await cur.fetchone()
                    if existing:
                        tx_dict = dict(existing)
                        stored_hash = tx_dict.pop("request_hash")
                        current_bal = tx_dict.pop("total_balance")

                        # Validate fingerprint
                        if stored_hash:
                            if stored_hash != incoming_hash:
                                raise IdempotencyConflictError(
                                    f"Idempotency key '{idempotency_key}' reused with different request payload."
                                )
                        else:
                            # Legacy fallback: compare transaction fields directly
                            if (
                                tx_dict["customer_id"] != customer_id
                                or to_decimal(tx_dict["amount"]) != amt_dec
                                or tx_dict["type"].strip().upper() != norm_type
                                or (tx_dict.get("notes") or "").strip() != (notes or "").strip()
                            ):
                                raise IdempotencyConflictError(
                                    f"Idempotency key '{idempotency_key}' reused with different request payload (legacy record)."
                                )
                        return tx_dict, current_bal

        async with self.transaction() as db:
            # Re-check idempotency key inside atomic transaction lock
            if idempotency_key and incoming_hash:
                async with db.execute("""
                    SELECT t.id, t.customer_id, t.amount, t.type, t.notes, t.created_at,
                           c.name as customer_name, c.total_balance, ir.request_hash
                    FROM idempotency_requests ir
                    JOIN transactions t ON ir.transaction_id = t.id
                    JOIN customers c ON t.customer_id = c.id
                    WHERE ir.idempotency_key = ?
                """, (idempotency_key,)) as cur:
                    existing = await cur.fetchone()
                    if existing:
                        tx_dict = dict(existing)
                        stored_hash = tx_dict.pop("request_hash")
                        current_bal = tx_dict.pop("total_balance")

                        # Validate fingerprint
                        if stored_hash:
                            if stored_hash != incoming_hash:
                                raise IdempotencyConflictError(
                                    f"Idempotency key '{idempotency_key}' reused with different request payload."
                                )
                        else:
                            # Legacy fallback: compare transaction fields directly
                            if (
                                tx_dict["customer_id"] != customer_id
                                or to_decimal(tx_dict["amount"]) != amt_dec
                                or tx_dict["type"].strip().upper() != norm_type
                                or (tx_dict.get("notes") or "").strip() != (notes or "").strip()
                            ):
                                raise IdempotencyConflictError(
                                    f"Idempotency key '{idempotency_key}' reused with different request payload (legacy record)."
                                )
                        return tx_dict, current_bal

            # Fetch customer
            async with db.execute("SELECT total_balance, name FROM customers WHERE id = ?", (customer_id,)) as cur:
                cust = await cur.fetchone()
                if not cust:
                    raise ValueError(f"Customer with id {customer_id} not found")
                current_bal = cust["total_balance"]

            # Pure Decimal arithmetic
            curr_dec = to_decimal(current_bal)
            if norm_type == "CREDIT":
                new_bal_dec = curr_dec + amt_dec
            elif norm_type == "PAYMENT":
                new_bal_dec = curr_dec - amt_dec
            else:
                new_bal_dec = curr_dec

            new_bal = to_currency_float(new_bal_dec)
            saved_amount = to_currency_float(amt_dec)

            # Insert transaction
            cursor = await db.execute(
                "INSERT INTO transactions (customer_id, amount, type, notes, idempotency_key) VALUES (?, ?, ?, ?, ?)",
                (customer_id, saved_amount, norm_type, notes, idempotency_key)
            )
            tx_id = cursor.lastrowid
            self._last_transaction_id = tx_id

            # Update customer balance
            await db.execute(
                "UPDATE customers SET total_balance = ? WHERE id = ?",
                (new_bal, customer_id)
            )

            # Record idempotency mapping and fingerprint hash
            if idempotency_key and incoming_hash:
                await db.execute(
                    "INSERT INTO idempotency_requests (idempotency_key, transaction_id, request_hash) VALUES (?, ?, ?)",
                    (idempotency_key, tx_id, incoming_hash)
                )

            async with db.execute("""
                SELECT t.id, t.customer_id, t.amount, t.type, t.notes, t.created_at, c.name as customer_name
                FROM transactions t
                JOIN customers c ON t.customer_id = c.id
                WHERE t.id = ?
            """, (tx_id,)) as cur:
                tx_row = await cur.fetchone()
                return dict(tx_row), new_bal

    async def update_transaction(
        self,
        transaction_id: int,
        amount: Optional[float] = None,
        tx_type: Optional[str] = None,
        notes: Optional[str] = None
    ) -> Tuple[Dict[str, Any], float]:
        """
        Atomically update an existing active transaction's amount, type, and/or notes,
        and apply the net financial contribution difference to the customer's total_balance.

        - customer_id is immutable.
        - Rejects soft-deleted transactions (is_deleted = 1).
        - Rejects invalid transaction ID (<= 0, non-int).
        - Rejects invalid amount (<= 0, NaN, Inf, non-numeric).
        - Rejects invalid type (must be 'CREDIT' or 'PAYMENT').
        - Validates notes (must be string if provided).
        - Requires at least one field to update.
        - Calculates financial contribution delta:
            old_contribution = +old_amt if old_type == 'CREDIT' else -old_amt
            new_contribution = +new_amt if new_type == 'CREDIT' else -new_amt
            delta = new_contribution - old_contribution
            new_customer_balance = current_customer_balance + delta
        - Executes all operations atomically inside self.transaction() (BEGIN IMMEDIATE).
        - Preserves existing idempotency_requests mappings without deletion or alteration.

        Returns: (updated_transaction_dict, updated_customer_total_balance)
        """
        # 1. Input validation
        if not isinstance(transaction_id, int) or isinstance(transaction_id, bool) or transaction_id <= 0:
            raise ValueError(f"transaction_id must be a positive integer, got: {transaction_id}")

        if amount is None and tx_type is None and notes is None:
            raise ValueError("At least one field (amount, tx_type, or notes) must be provided to update.")

        target_amount_dec: Optional[Decimal] = None
        if amount is not None:
            if isinstance(amount, bool) or not isinstance(amount, (int, float, Decimal)):
                raise ValueError(f"amount must be a numeric value, got: {amount}")
            if isinstance(amount, float) and (math.isnan(amount) or math.isinf(amount)):
                raise ValueError(f"amount must be a finite number, got: {amount}")
            target_amount_dec = to_decimal(amount)
            if target_amount_dec <= Decimal("0.00"):
                raise ValueError(f"amount must be strictly positive, got: {amount}")

        target_type: Optional[str] = None
        if tx_type is not None:
            if not isinstance(tx_type, str):
                raise ValueError(f"tx_type must be a string ('CREDIT' or 'PAYMENT'), got: {type(tx_type).__name__}")
            norm_type = tx_type.strip().upper()
            if norm_type not in ("CREDIT", "PAYMENT"):
                raise ValueError(f"tx_type must be 'CREDIT' or 'PAYMENT', got: '{tx_type}'")
            target_type = norm_type

        target_notes: Optional[str] = None
        if notes is not None:
            if not isinstance(notes, str):
                raise ValueError(f"notes must be a string, got: {type(notes).__name__}")
            target_notes = notes.strip()

        # 2. Atomic database execution
        async with self.transaction() as db:
            # Fetch existing transaction and current customer balance
            async with db.execute("""
                SELECT t.id, t.customer_id, t.amount, t.type, t.notes, t.created_at, t.is_deleted,
                       c.name as customer_name, c.total_balance as customer_balance
                FROM transactions t
                JOIN customers c ON t.customer_id = c.id
                WHERE t.id = ?
            """, (transaction_id,)) as cur:
                tx_row = await cur.fetchone()
                if not tx_row:
                    raise ValueError(f"Transaction with id {transaction_id} not found")

            # Check soft-deleted status
            if tx_row["is_deleted"] == 1:
                raise ValueError(f"Cannot update soft-deleted transaction with id {transaction_id}")

            cust_id = tx_row["customer_id"]
            old_amount_dec = validate_stored_amount(
                tx_row["amount"],
                transaction_id,
                f"update transaction with id {transaction_id}"
            )
            old_type = tx_row["type"].strip().upper()
            old_notes = tx_row["notes"] or ""
            current_cust_bal_dec = to_decimal(tx_row["customer_balance"])

            # Resolve updated field values
            final_amount_dec = target_amount_dec if target_amount_dec is not None else old_amount_dec
            final_type = target_type if target_type is not None else old_type
            final_notes = target_notes if target_notes is not None else old_notes

            # 3. Calculate financial contributions using pure Decimal arithmetic
            # CREDIT: customer owes money (+), PAYMENT: customer settled debt (-)
            if old_type == "CREDIT":
                old_contribution = old_amount_dec
            elif old_type == "PAYMENT":
                old_contribution = -old_amount_dec
            elif old_type == "CORRECTION":
                raise ValueError(
                    f"Cannot update transaction with id {transaction_id}: 'CORRECTION' transaction type has no established financial contribution direction."
                )
            else:
                raise ValueError(
                    f"Cannot update transaction with id {transaction_id}: unsupported existing transaction type '{old_type}'."
                )

            new_contribution = final_amount_dec if final_type == "CREDIT" else -final_amount_dec

            delta = new_contribution - old_contribution
            new_cust_bal_dec = current_cust_bal_dec + delta

            saved_amount = to_currency_float(final_amount_dec)
            saved_balance = to_currency_float(new_cust_bal_dec)

            # 4. Update transaction row
            await db.execute("""
                UPDATE transactions
                SET amount = ?, type = ?, notes = ?
                WHERE id = ?
            """, (saved_amount, final_type, final_notes, transaction_id))

            # 5. Update customer total_balance if financial delta occurred
            if delta != Decimal("0.00"):
                await db.execute("""
                    UPDATE customers
                    SET total_balance = ?
                    WHERE id = ?
                """, (saved_balance, cust_id))

            # 6. Fetch and return updated transaction record
            async with db.execute("""
                SELECT t.id, t.customer_id, t.amount, t.type, t.notes, t.created_at, c.name as customer_name
                FROM transactions t
                JOIN customers c ON t.customer_id = c.id
                WHERE t.id = ?
            """, (transaction_id,)) as cur:
                updated_row = await cur.fetchone()
                res_dict = dict(updated_row)
                res_dict["amount"] = to_currency_float(res_dict["amount"])
                return res_dict, saved_balance

    async def delete_transaction(self, transaction_id: int) -> Tuple[Dict[str, Any], float]:
        """
        Safely soft-delete an active transaction without physically dropping financial records.
        - Reverses the transaction's financial contribution from the customer's total_balance:
            CREDIT reversal: customer owes less (balance -= amount)
            PAYMENT reversal: customer debt restored (balance += amount)
        - Sets is_deleted = 1 and deleted_at = CURRENT_TIMESTAMP.
        - Rejects already soft-deleted transactions to prevent duplicate balance reversal.
        - Preserves transaction row, ID, and idempotency mappings for audit integrity.
        - Executes atomically inside self.transaction() (BEGIN IMMEDIATE).
        - Allows negative customer balances (advance payments).

        Returns: (soft_deleted_transaction_dict, updated_customer_total_balance)
        """
        # 1. Input validation
        if not isinstance(transaction_id, int) or isinstance(transaction_id, bool) or transaction_id <= 0:
            raise ValueError(f"transaction_id must be a positive integer, got: {transaction_id}")

        async with self.transaction() as db:
            # 2. Fetch transaction and customer balance
            async with db.execute("""
                SELECT t.id, t.customer_id, t.amount, t.type, t.notes, t.created_at, t.is_deleted,
                       c.name as customer_name, c.total_balance as customer_balance
                FROM transactions t
                JOIN customers c ON t.customer_id = c.id
                WHERE t.id = ?
            """, (transaction_id,)) as cur:
                tx_row = await cur.fetchone()
                if not tx_row:
                    raise ValueError(f"Transaction with id {transaction_id} not found")

            # 3. Reject already soft-deleted transactions
            if tx_row["is_deleted"] == 1:
                raise ValueError(f"Transaction with id {transaction_id} is already deleted")

            cust_id = tx_row["customer_id"]
            amt_dec = validate_stored_amount(
                tx_row["amount"],
                transaction_id,
                f"delete transaction with id {transaction_id}"
            )
            tx_type = tx_row["type"].strip().upper()
            curr_cust_bal_dec = to_decimal(tx_row["customer_balance"])

            # 4. Calculate balance reversal using pure Decimal arithmetic
            # CREDIT originally added to balance; reversal subtracts amount.
            # PAYMENT originally subtracted from balance; reversal adds amount back.
            # Rejects CORRECTION or any unexpected type so they are NEVER silently treated as PAYMENT.
            if tx_type == "CREDIT":
                orig_contribution = amt_dec
            elif tx_type == "PAYMENT":
                orig_contribution = -amt_dec
            elif tx_type == "CORRECTION":
                raise ValueError(
                    f"Cannot delete transaction with id {transaction_id}: 'CORRECTION' transaction type has no established financial reversal direction."
                )
            else:
                raise ValueError(
                    f"Cannot delete transaction with id {transaction_id}: unsupported transaction type '{tx_type}'."
                )

            delta = -orig_contribution
            new_cust_bal_dec = curr_cust_bal_dec + delta
            saved_balance = to_currency_float(new_cust_bal_dec)

            # 5. Soft-delete the transaction row
            await db.execute("""
                UPDATE transactions
                SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (transaction_id,))

            # 6. Update customer balance
            await db.execute("""
                UPDATE customers
                SET total_balance = ?
                WHERE id = ?
            """, (saved_balance, cust_id))

            # 7. Fetch updated transaction row for return
            async with db.execute("""
                SELECT t.id, t.customer_id, t.amount, t.type, t.notes, t.created_at,
                       t.is_deleted, t.deleted_at, c.name as customer_name
                FROM transactions t
                JOIN customers c ON t.customer_id = c.id
                WHERE t.id = ?
            """, (transaction_id,)) as cur:
                updated_row = await cur.fetchone()
                res_dict = dict(updated_row)
                res_dict["amount"] = to_currency_float(res_dict["amount"])
                return res_dict, saved_balance

    async def recalculate_customer_balance(self, customer_id: int) -> Dict[str, Any]:
        """
        Recalculate a customer's total balance from scratch using their active transaction records.
        Does not trust the existing `customers.total_balance` value.

        Financial Rules:
        - Active CREDIT contributes +amount.
        - Active PAYMENT contributes -amount.
        - Soft-deleted transactions (is_deleted = 1) are strictly excluded.
        - Active transactions with 'CORRECTION' type cause a clear ValueError because their financial direction is not established.
        - Any unsupported transaction type causes a clear ValueError.
        - Never silently interprets an unknown type as PAYMENT.
        - Arithmetic uses pure Python Decimal quantized to 2 decimal places (ROUND_HALF_UP).
        - Executes atomically inside self.transaction() (BEGIN IMMEDIATE).
        - Updates customers.total_balance only after all active transactions have been validated and calculation succeeds.
        - Preserves transaction records, IDs, and idempotency mappings without mutation.

        Returns:
            Dict[str, Any] with keys:
                - customer_id: int
                - customer_name: str
                - previous_balance: float
                - recalculated_balance: float
                - difference: float (recalculated_balance - previous_balance)
                - has_discrepancy: bool
        """
        # 1. Input validation
        if not isinstance(customer_id, int) or isinstance(customer_id, bool) or customer_id <= 0:
            raise ValueError(f"customer_id must be a positive integer, got: {customer_id}")

        async with self.transaction() as db:
            # 2. Check customer exists and fetch previous balance
            async with db.execute(
                "SELECT id, name, total_balance FROM customers WHERE id = ?",
                (customer_id,)
            ) as cur:
                cust = await cur.fetchone()
                if not cust:
                    raise ValueError(f"Customer with id {customer_id} not found")

            cust_name = cust["name"]
            prev_bal_dec = to_decimal(cust["total_balance"])

            # 3. Read all active transactions for that customer
            async with db.execute("""
                SELECT id, amount, type
                FROM transactions
                WHERE customer_id = ? AND is_deleted = 0
                ORDER BY id ASC
            """, (customer_id,)) as cur:
                active_txs = await cur.fetchall()

            # 4. Calculate balance using Python Decimal arithmetic & validate all amounts and types
            calc_dec = Decimal("0.00")
            for tx in active_txs:
                tx_id = tx["id"]
                amt_dec = validate_stored_amount(
                    tx["amount"],
                    tx_id,
                    f"recalculate balance for customer {customer_id}"
                )

                # Validate transaction type
                raw_type = tx["type"]
                tx_type = raw_type.strip().upper() if isinstance(raw_type, str) else ""

                if tx_type == "CREDIT":
                    calc_dec += amt_dec
                elif tx_type == "PAYMENT":
                    calc_dec -= amt_dec
                elif tx_type == "CORRECTION":
                    raise ValueError(
                        f"Cannot recalculate balance for customer {customer_id}: "
                        f"transaction {tx_id} has 'CORRECTION' type which has no established financial direction."
                    )
                else:
                    raise ValueError(
                        f"Cannot recalculate balance for customer {customer_id}: "
                        f"transaction {tx_id} has unsupported type '{raw_type}'."
                    )

            calc_dec = calc_dec.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            recalculated_balance = to_currency_float(calc_dec)
            previous_balance = to_currency_float(prev_bal_dec)
            diff_dec = (calc_dec - prev_bal_dec).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            difference = to_currency_float(diff_dec)

            # 5. Update customers.total_balance after all validation succeeds
            await db.execute(
                "UPDATE customers SET total_balance = ? WHERE id = ?",
                (recalculated_balance, customer_id)
            )

            # 6. Return structured result
            return {
                "customer_id": customer_id,
                "customer_name": cust_name,
                "previous_balance": previous_balance,
                "recalculated_balance": recalculated_balance,
                "difference": difference,
                "has_discrepancy": diff_dec != Decimal("0.00"),
            }

    async def handle_spoken_correction(self, new_amount: float) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Handles spoken correction like "Nahi 340 nahi, 430 tha"
        Rolls back the difference from the latest active transaction atomically.
        All arithmetic performed in Decimal.
        """
        if not self._last_transaction_id:
            return None, "Koi purani transaction nahi mili jise sudhara ja sake."

        new_dec = to_decimal(new_amount)
        if new_dec <= Decimal("0.00"):
            return None, "Amount shunya ya negative nahi ho sakta."

        async with self.transaction() as db:
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

            # Compute balance difference with safe financial Decimal rounding
            old_dec = to_decimal(old_amount)
            curr_dec = to_decimal(current_bal)
            diff_dec = new_dec - old_dec

            if tx_type == "CREDIT":
                updated_balance_dec = curr_dec + diff_dec
            elif tx_type == "PAYMENT":
                updated_balance_dec = curr_dec - diff_dec
            else:
                updated_balance_dec = curr_dec

            updated_balance = to_currency_float(updated_balance_dec)
            saved_new_amount = to_currency_float(new_dec)

            # Update transaction amount & note
            notes = (tx["notes"] or "") + f" [Sudhara gaya: {old_amount} se {saved_new_amount}]"
            await db.execute(
                "UPDATE transactions SET amount = ?, notes = ? WHERE id = ?",
                (saved_new_amount, notes, self._last_transaction_id)
            )
            await db.execute(
                "UPDATE customers SET total_balance = ? WHERE id = ?",
                (updated_balance, cust_id)
            )

            msg = f"{cust_name} ka transaction sudhar kar {int(saved_new_amount)} rupaye kar diya hai. Ab total {int(updated_balance)} rupaye baaki hai."
            return {
                "transaction_id": self._last_transaction_id,
                "customer_id": cust_id,
                "customer_name": cust_name,
                "old_amount": old_amount,
                "new_amount": saved_new_amount,
                "new_balance": updated_balance
            }, msg

    async def query_balance(self, customer_name: Optional[str] = None, target: str = "total") -> Tuple[Optional[float], str]:
        """
        Calculates balance for a customer or overall ledger totals (aaj kitna udhaar gaya).
        """
        async with self.get_connection() as db:
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

            # Overall ledger queries (e.g. "Aaj kitna udhaar gaya?") - excludes soft-deleted
            if target == "today" or "aaj" in target.lower():
                async with db.execute("""
                    SELECT COALESCE(SUM(amount), 0) as total_today
                    FROM transactions
                    WHERE type = 'CREDIT' AND is_deleted = 0 AND DATE(created_at) = DATE('now', 'localtime')
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
