import os
import sys
import glob
import asyncio
import aiosqlite
from decimal import Decimal

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from backend.database.ledger import (
    init_db,
    LedgerManager,
    IdempotencyConflictError,
    to_currency_float,
    to_decimal,
)

DB_PREFIX = "test_step6_"


def cleanup_all():
    for f in glob.glob(f"{DB_PREFIX}*"):
        try:
            os.remove(f)
        except Exception:
            pass


async def run_step6_verification():
    cleanup_all()
    db_name = f"{DB_PREFIX}consistency.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    print("\n========================================================")
    print("PHASE B: CROSS-FUNCTION CONSISTENCY TESTS")
    print("========================================================")

    print("\n--- Sequence 1: Create transaction -> Update transaction -> Verify balance ---")
    # Customer 2 (Ramesh Verma) starts with 0.0 balance
    tx1, bal1 = await manager.record_transaction(2, 100.0, "CREDIT", "Seq1 initial credit")
    assert bal1 == 100.0
    tx1_up, bal1_up = await manager.update_transaction(tx1["id"], amount=250.0)
    assert bal1_up == 250.0
    assert tx1_up["amount"] == 250.0
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 2") as cur:
            assert (await cur.fetchone())["total_balance"] == 250.0
    print("PASS (Seq 1): Create -> Update correctly adjusted balance from 100.0 to 250.0.")

    print("\n--- Sequence 2: Create transaction -> Delete transaction -> Verify balance ---")
    tx2, bal2 = await manager.record_transaction(2, 150.0, "CREDIT", "Seq2 credit")
    assert bal2 == 400.0  # 250 + 150 = 400
    del2, bal2_del = await manager.delete_transaction(tx2["id"])
    assert bal2_del == 250.0  # 400 - 150 = 250
    assert del2["is_deleted"] == 1
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 2") as cur:
            assert (await cur.fetchone())["total_balance"] == 250.0
    print("PASS (Seq 2): Create -> Delete reversed contribution cleanly back to 250.0.")

    print("\n--- Sequence 3: Create transaction -> Update -> Delete -> Verify balance ---")
    tx3, bal3 = await manager.record_transaction(2, 50.0, "CREDIT", "Seq3 credit")
    assert bal3 == 300.0  # 250 + 50 = 300
    tx3_up, bal3_up = await manager.update_transaction(tx3["id"], amount=180.0)
    assert bal3_up == 430.0  # 250 + 180 = 430
    del3, bal3_del = await manager.delete_transaction(tx3["id"])
    assert bal3_del == 250.0  # Reverses updated 180.0 contribution back to 250.0
    assert del3["is_deleted"] == 1
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 2") as cur:
            assert (await cur.fetchone())["total_balance"] == 250.0
    print("PASS (Seq 3): Create -> Update -> Delete reversed updated amount cleanly back to 250.0.")

    print("\n--- Sequence 4: Delete transaction -> Attempt update -> Verify rejection ---")
    try:
        await manager.update_transaction(tx3["id"], amount=999.0)
        assert False, "Should have rejected updating a soft-deleted transaction"
    except ValueError as e:
        assert "soft-deleted" in str(e).lower()
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 2") as cur:
            assert (await cur.fetchone())["total_balance"] == 250.0
    print("PASS (Seq 4): Updating soft-deleted transaction rejected; balance untouched.")

    print("\n--- Sequence 5: Delete transaction -> Recalculate balance -> Verify excluded ---")
    recalc5 = await manager.recalculate_customer_balance(2)
    # Active transactions: only tx1 (amount 250.0). tx2 and tx3 are soft-deleted.
    assert recalc5["recalculated_balance"] == 250.0
    assert recalc5["difference"] == 0.0
    assert recalc5["has_discrepancy"] is False
    print("PASS (Seq 5): Recalculation strictly excluded soft-deleted transactions.")

    print("\n--- Sequence 6: Create multiple transactions -> Recalculate -> Verify consistency ---")
    # Customer 4 (Pooja Patel) starts with seed 120.0
    await manager.record_transaction(4, 80.50, "CREDIT", "Kirana items")
    await manager.record_transaction(4, 100.0, "PAYMENT", "GPay settlement")
    await manager.record_transaction(4, 45.25, "CREDIT", "Masala packets")
    await manager.record_transaction(4, 20.0, "PAYMENT", "Cash")
    # Expected: 120.0 + 80.50 - 100.0 + 45.25 - 20.0 = 125.75
    recalc6 = await manager.recalculate_customer_balance(4)
    assert recalc6["recalculated_balance"] == 125.75
    assert recalc6["previous_balance"] == 125.75
    assert recalc6["difference"] == 0.0
    assert recalc6["has_discrepancy"] is False
    print("PASS (Seq 6): Multiple transactions matched recalculated balance with zero discrepancy.")

    print("\n--- Sequence 7: Replay an idempotency key -> Verify no duplicate transaction ---")
    key7 = "step6_idemp_key_007"
    tx7_first, bal7_first = await manager.record_transaction(
        2, 75.0, "CREDIT", "Idemp first call", idempotency_key=key7
    )
    # Stored balance is 250 + 75 = 325.0
    assert bal7_first == 325.0

    async with manager.get_connection() as db:
        async with db.execute("SELECT COUNT(*) FROM transactions WHERE customer_id = 2") as cur:
            tx_count_before = (await cur.fetchone())[0]

    tx7_replay, bal7_replay = await manager.record_transaction(
        2, 75.0, "CREDIT", "Idemp first call", idempotency_key=key7
    )
    assert tx7_replay["id"] == tx7_first["id"]
    assert bal7_replay == bal7_first == 325.0

    async with manager.get_connection() as db:
        async with db.execute("SELECT COUNT(*) FROM transactions WHERE customer_id = 2") as cur:
            tx_count_after = (await cur.fetchone())[0]
            assert tx_count_after == tx_count_before, "Duplicate transaction was created!"
    print("PASS (Seq 7): Idempotency replay returned original transaction without duplicate.")

    print("\n--- Sequence 8: Replay same key with different payload -> Verify conflict ---")
    try:
        await manager.record_transaction(
            2, 999.0, "CREDIT", "Different payload", idempotency_key=key7
        )
        assert False, "Should have raised IdempotencyConflictError for payload mismatch"
    except IdempotencyConflictError as e:
        assert "different request payload" in str(e)

    # Verify balance was NOT mutated
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 2") as cur:
            assert (await cur.fetchone())["total_balance"] == 325.0
    print("PASS (Seq 8): Reusing idempotency key with conflicting payload rejected; balance unchanged.")

    print("\n--- Sequence 9: Multiple customers -> Verify complete customer isolation ---")
    # Take snapshots of Customers 1 and 3
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 1") as cur:
            bal_c1_snap = (await cur.fetchone())["total_balance"]
        async with db.execute("SELECT total_balance FROM customers WHERE id = 3") as cur:
            bal_c3_snap = (await cur.fetchone())["total_balance"]

    # Perform extensive operations on Customer 2: create, update, delete, recalculate
    tx_iso, _ = await manager.record_transaction(2, 50.0, "CREDIT", "Iso test credit")
    await manager.update_transaction(tx_iso["id"], amount=120.0)
    await manager.delete_transaction(tx_iso["id"])
    await manager.recalculate_customer_balance(2)

    # Verify Customers 1 and 3 are 100% untouched
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 1") as cur:
            assert (await cur.fetchone())["total_balance"] == bal_c1_snap
        async with db.execute("SELECT total_balance FROM customers WHERE id = 3") as cur:
            assert (await cur.fetchone())["total_balance"] == bal_c3_snap
    print("PASS (Seq 9): Multi-customer operations preserved 100% balance and history isolation.")

    print("\n--- Sequence 10: Invalid transaction data -> Verify no partial database changes ---")
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 2") as cur:
            bal2_before_invalids = (await cur.fetchone())["total_balance"]
        async with db.execute("SELECT COUNT(*) FROM transactions") as cur:
            txs_before_invalids = (await cur.fetchone())[0]

    invalid_attempts = [
        lambda: manager.record_transaction(2, -100.0, "CREDIT", "Negative"),
        lambda: manager.record_transaction(2, 0.0, "CREDIT", "Zero"),
        lambda: manager.record_transaction(2, float("nan"), "CREDIT", "NaN"),
        lambda: manager.record_transaction(2, 100.0, "CORRECTION", "Correction"),
        lambda: manager.record_transaction(2, 100.0, "REFUND", "Unsupported type"),
        lambda: manager.record_transaction(99999, 100.0, "CREDIT", "Missing customer"),
        lambda: manager.update_transaction(tx1["id"], amount=-50.0),
        lambda: manager.update_transaction(tx1["id"], tx_type="CORRECTION"),
        lambda: manager.delete_transaction(999999),
        lambda: manager.recalculate_customer_balance(99999),
    ]

    for attempt in invalid_attempts:
        try:
            await attempt()
            assert False, "Attempt should have raised ValueError"
        except ValueError:
            pass

    # Verify no partial database changes
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 2") as cur:
            assert (await cur.fetchone())["total_balance"] == bal2_before_invalids
        async with db.execute("SELECT COUNT(*) FROM transactions") as cur:
            assert (await cur.fetchone())[0] == txs_before_invalids
    print("PASS (Seq 10): All invalid transaction attempts safely rejected with zero database mutation.")

    print("\n========================================================")
    print("PHASE C: DATABASE CONSISTENCY & INTEGRITY AUDIT")
    print("========================================================")

    print("\n--- C1: Foreign Key Enforcement & ON DELETE RESTRICT ---")
    async with manager.get_connection() as db:
        cur = await db.execute("PRAGMA foreign_keys;")
        fk_status = (await cur.fetchone())[0]
        assert fk_status == 1, "Foreign keys must be enabled!"

        cur = await db.execute("PRAGMA foreign_key_check;")
        violations = await cur.fetchall()
        assert len(violations) == 0, f"Foreign key check returned violations: {violations}"

        # Verify ON DELETE RESTRICT on idempotency_requests
        cur = await db.execute("PRAGMA foreign_key_list(idempotency_requests);")
        fk_rules = await cur.fetchall()
        found_restrict = any(r[6].upper() == "RESTRICT" for r in fk_rules)
        assert found_restrict, "idempotency_requests must enforce ON DELETE RESTRICT!"
    print("PASS (C1): Foreign keys active (PRAGMA foreign_keys = 1) with ON DELETE RESTRICT verified.")

    print("\n--- C2: Soft-Deleted Records Physical Preservation ---")
    async with manager.get_connection() as db:
        async with db.execute("SELECT id, is_deleted, deleted_at FROM transactions WHERE is_deleted = 1") as cur:
            deleted_rows = await cur.fetchall()
            assert len(deleted_rows) >= 2, "Soft-deleted rows must physically exist in SQLite!"
            for r in deleted_rows:
                assert r["is_deleted"] == 1
                assert r["deleted_at"] is not None
    print("PASS (C2): Soft-deleted records are physically preserved with is_deleted=1 and timestamps.")

    print("\n--- C3: Deleted Records Exclusion from Passbook & History ---")
    cust2_txs = await manager.get_customer_transactions(2)
    cust2_tx_ids = [t["id"] for t in cust2_txs]
    assert tx2["id"] not in cust2_tx_ids, "Soft-deleted tx2 appeared in get_customer_transactions!"
    assert tx3["id"] not in cust2_tx_ids, "Soft-deleted tx3 appeared in get_customer_transactions!"

    recent_txs = await manager.get_recent_transactions(50)
    recent_ids = [t["id"] for t in recent_txs]
    assert tx2["id"] not in recent_ids, "Soft-deleted tx2 appeared in get_recent_transactions!"
    assert tx3["id"] not in recent_ids, "Soft-deleted tx3 appeared in get_recent_transactions!"
    print("PASS (C3): Soft-deleted records strictly excluded from customer passbook and recent history.")

    print("\n--- C4: Idempotency Mapping Preservation ---")
    async with manager.get_connection() as db:
        async with db.execute("SELECT idempotency_key, transaction_id, request_hash FROM idempotency_requests WHERE idempotency_key = ?", (key7,)) as cur:
            row = await cur.fetchone()
            assert row is not None
            assert row["transaction_id"] == tx7_first["id"]
            assert row["request_hash"] is not None
    print("PASS (C4): Idempotency requests mappings preserved intact across all lifecycle operations.")

    print("\n--- C5: Rejection of Unsupported Types Across All Operations ---")
    # record_transaction rejects CORRECTION and unknown
    for bad_t in ["CORRECTION", "REFUND", "TRANSFER", ""]:
        try:
            await manager.record_transaction(1, 10.0, bad_t)
            assert False, f"record_transaction should reject '{bad_t}'"
        except ValueError:
            pass

    # update_transaction rejects CORRECTION and unknown
    for bad_t in ["CORRECTION", "REFUND", "TRANSFER", ""]:
        try:
            await manager.update_transaction(tx1["id"], tx_type=bad_t)
            assert False, f"update_transaction should reject '{bad_t}'"
        except ValueError:
            pass
    print("PASS (C5): Unsupported types and 'CORRECTION' strictly rejected across all ledger operations.")

    print("\n--- C6: Atomic Rollback on Abort Trigger ---")
    # Install trigger that aborts customer balance update
    cust_rb = await manager.get_or_create_customer("Rollback Test Customer", "9900000000")
    rb_id = cust_rb["id"]
    await manager.record_transaction(rb_id, 200.0, "CREDIT", "Rollback seed")

    async with manager.get_connection() as db:
        await db.execute(f"""
            CREATE TRIGGER abort_cust_rb_{rb_id}
            BEFORE UPDATE OF total_balance ON customers
            WHEN NEW.id = {rb_id} AND NEW.total_balance != 200.0
            BEGIN
                SELECT RAISE(ABORT, 'Trigger simulated abort');
            END;
        """)
        await db.commit()

    # Attempting to record a transaction that changes balance from 200.0 to 300.0
    try:
        await manager.record_transaction(rb_id, 100.0, "CREDIT", "Should abort")
        assert False, "Should have triggered abort"
    except Exception as e:
        assert "Trigger simulated abort" in str(e) or "ABORT" in str(e)

    # Verify customer balance and transaction table rolled back completely
    async with manager.get_connection() as db:
        async with db.execute(f"SELECT total_balance FROM customers WHERE id = {rb_id}") as cur:
            assert (await cur.fetchone())["total_balance"] == 200.0
        async with db.execute("SELECT COUNT(*) FROM transactions WHERE customer_id = ? AND notes = 'Should abort'", (rb_id,)) as cur:
            assert (await cur.fetchone())[0] == 0, "Aborted transaction was not rolled back!"
        await db.execute(f"DROP TRIGGER abort_cust_rb_{rb_id}")
        await db.commit()
    print("PASS (C6): Atomic rollback cleanly reversed both balance and transaction table on abort.")

    print("\n--- C7: Defensive Stored Amount Validation in update_transaction & delete_transaction ---")
    # Set up dedicated customer with known baseline balance and active transaction with idempotency key
    cust_c7 = await manager.get_or_create_customer("Corrupt Amount Audit Customer", "9811122233")
    c7_id = cust_c7["id"]
    c7_key = "step6_c7_idemp_key_001"
    tx_c7, bal_c7 = await manager.record_transaction(
        c7_id, 100.0, "CREDIT", "C7 baseline credit", idempotency_key=c7_key
    )
    c7_tx_id = tx_c7["id"]
    assert bal_c7 == 100.0

    # Snapshot idempotency requests before tests
    async with manager.get_connection() as db:
        async with db.execute("SELECT * FROM idempotency_requests WHERE idempotency_key = ?", (c7_key,)) as cur:
            idemp_c7_snap = dict(await cur.fetchone())

    corrupt_values = [
        (-50.0, "negative"),
        (0.0, "zero"),
        ("corrupt_string_val", "non-numeric string"),
        ("NaN", "string NaN"),
        ("Infinity", "string Infinity"),
        (float("inf"), "float infinity"),
    ]

    for c_val, desc in corrupt_values:
        # 1. Tamper stored amount directly in SQLite
        async with manager.get_connection() as db:
            await db.execute("UPDATE transactions SET amount = ? WHERE id = ?", (c_val, c7_tx_id))
            await db.commit()

        # 2. Test update_transaction() defensive rejection
        try:
            await manager.update_transaction(c7_tx_id, notes="Tampered update attempt")
            assert False, f"update_transaction should have rejected corrupt amount: {desc}"
        except ValueError as e:
            assert str(c7_tx_id) in str(e), f"Expected transaction ID {c7_tx_id} in error message: {e}"

        # Verify customer balance, transaction row, and idempotency mapping are unchanged
        async with manager.get_connection() as db:
            async with db.execute(f"SELECT total_balance FROM customers WHERE id = {c7_id}") as cur:
                assert (await cur.fetchone())["total_balance"] == 100.0
            async with db.execute(f"SELECT notes, is_deleted FROM transactions WHERE id = {c7_tx_id}") as cur:
                tx_r = await cur.fetchone()
                assert tx_r["notes"] == "C7 baseline credit", "Transaction notes were mutated on failed update!"
                assert tx_r["is_deleted"] == 0
            async with db.execute("SELECT * FROM idempotency_requests WHERE idempotency_key = ?", (c7_key,)) as cur:
                assert dict(await cur.fetchone()) == idemp_c7_snap

        # 3. Test delete_transaction() defensive rejection
        try:
            await manager.delete_transaction(c7_tx_id)
            assert False, f"delete_transaction should have rejected corrupt amount: {desc}"
        except ValueError as e:
            assert str(c7_tx_id) in str(e), f"Expected transaction ID {c7_tx_id} in error message: {e}"

        # Verify customer balance, transaction row, and idempotency mapping are unchanged
        async with manager.get_connection() as db:
            async with db.execute(f"SELECT total_balance FROM customers WHERE id = {c7_id}") as cur:
                assert (await cur.fetchone())["total_balance"] == 100.0
            async with db.execute(f"SELECT is_deleted, deleted_at FROM transactions WHERE id = {c7_tx_id}") as cur:
                tx_r = await cur.fetchone()
                assert tx_r["is_deleted"] == 0, "Transaction was soft-deleted despite corrupt amount rejection!"
                assert tx_r["deleted_at"] is None
            async with db.execute("SELECT * FROM idempotency_requests WHERE idempotency_key = ?", (c7_key,)) as cur:
                assert dict(await cur.fetchone()) == idemp_c7_snap

    # Restore valid amount to c7_tx_id
    async with manager.get_connection() as db:
        await db.execute("UPDATE transactions SET amount = 100.0 WHERE id = ?", (c7_tx_id,))
        await db.commit()

    # 4. Test NULL stored amount in isolated database without NOT NULL constraint
    null_c7_db = f"{DB_PREFIX}null_update_delete_test.db"
    await init_db(null_c7_db)
    null_mgr = LedgerManager(null_c7_db)

    async with null_mgr.get_connection() as db:
        await db.execute("PRAGMA foreign_keys = OFF;")
        await db.execute("""
            CREATE TABLE transactions_nullable (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                amount REAL,
                type TEXT NOT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_deleted INTEGER DEFAULT 0,
                deleted_at TIMESTAMP,
                idempotency_key TEXT
            );
        """)
        await db.execute("INSERT INTO transactions_nullable SELECT * FROM transactions;")
        await db.execute("DROP TABLE transactions;")
        await db.execute("ALTER TABLE transactions_nullable RENAME TO transactions;")
        await db.execute("PRAGMA foreign_keys = ON;")
        # Set amount to NULL for Customer 1's seeded transaction (id 1)
        await db.execute("UPDATE transactions SET amount = NULL WHERE id = 1;")
        await db.commit()

    # Snapshot balance before NULL tests
    async with null_mgr.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 1") as cur:
            c1_bal_null_snap = (await cur.fetchone())["total_balance"]

    # Test update_transaction() with NULL stored amount
    try:
        await null_mgr.update_transaction(1, notes="Update on null stored amount")
        assert False, "update_transaction should reject NULL stored amount"
    except ValueError as e:
        assert "1" in str(e)
        assert "NULL" in str(e) or "null" in str(e)

    # Test delete_transaction() with NULL stored amount
    try:
        await null_mgr.delete_transaction(1)
        assert False, "delete_transaction should reject NULL stored amount"
    except ValueError as e:
        assert "1" in str(e)
        assert "NULL" in str(e) or "null" in str(e)

    # Verify balance and row state in null_mgr are unchanged
    async with null_mgr.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 1") as cur:
            assert (await cur.fetchone())["total_balance"] == c1_bal_null_snap
        async with db.execute("SELECT is_deleted, deleted_at FROM transactions WHERE id = 1") as cur:
            tx_row = await cur.fetchone()
            assert tx_row["is_deleted"] == 0
            assert tx_row["deleted_at"] is None
    print("PASS (C7): Defensive validation in update_transaction & delete_transaction verified on all corrupt amounts.")

    print("\n========================================================")
    print("ALL STEP 6 SCENARIOS PASSED (17/17) - BACKEND FULLY VERIFIED")
    print("========================================================\n")

    cleanup_all()

if __name__ == "__main__":
    asyncio.run(run_step6_verification())
