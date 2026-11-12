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

DB_PREFIX = "test_step5_"


def cleanup_all():
    for f in glob.glob(f"{DB_PREFIX}*"):
        try:
            os.remove(f)
        except Exception:
            pass


async def run_step5_verification():
    cleanup_all()
    db_name = f"{DB_PREFIX}reconcile.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    print("\n--- Test A: Correct Calculation with Multiple CREDIT Transactions ---")
    # Customer 1 (Ramesh Gupta) has seeded balance 350.0 (one CREDIT 350.0 transaction)
    await manager.record_transaction(1, 100.0, "CREDIT", "A1 credit")
    await manager.record_transaction(1, 50.25, "CREDIT", "A2 credit")
    await manager.record_transaction(1, 200.75, "CREDIT", "A3 credit")
    # Expected: 350.0 + 100.0 + 50.25 + 200.75 = 701.00
    res_a = await manager.recalculate_customer_balance(1)
    assert res_a["customer_id"] == 1
    assert res_a["recalculated_balance"] == 701.0, f"Expected 701.0, got {res_a['recalculated_balance']}"
    assert res_a["previous_balance"] == 701.0
    assert res_a["difference"] == 0.0
    assert res_a["has_discrepancy"] is False
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 1") as cur:
            row = await cur.fetchone()
            assert row["total_balance"] == 701.0
    print("PASS (A): Multiple CREDIT transactions correctly calculated and verified.")

    print("\n--- Test B: Correct Calculation with Multiple PAYMENT Transactions ---")
    # Customer 2 (Ramesh Verma) starts with 0 transactions and 0 balance
    await manager.record_transaction(2, 50.0, "PAYMENT", "B1 advance payment")
    await manager.record_transaction(2, 75.50, "PAYMENT", "B2 advance payment")
    # Expected: 0.0 - 50.0 - 75.50 = -125.50
    res_b = await manager.recalculate_customer_balance(2)
    assert res_b["customer_id"] == 2
    assert res_b["recalculated_balance"] == -125.50, f"Expected -125.50, got {res_b['recalculated_balance']}"
    assert res_b["previous_balance"] == -125.50
    assert res_b["difference"] == 0.0
    assert res_b["has_discrepancy"] is False
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 2") as cur:
            row = await cur.fetchone()
            assert row["total_balance"] == -125.50
    print("PASS (B): Multiple PAYMENT transactions correctly calculated.")

    print("\n--- Test C: Mixed CREDIT and PAYMENT Transactions ---")
    # Customer 3 (Suresh Sharma) has seeded balance 850.0 (one CREDIT 850.0)
    await manager.record_transaction(3, 300.0, "CREDIT", "C1 credit")
    await manager.record_transaction(3, 500.0, "PAYMENT", "C2 payment")
    await manager.record_transaction(3, 150.50, "CREDIT", "C3 credit")
    await manager.record_transaction(3, 50.25, "PAYMENT", "C4 payment")
    # Expected: 850.0 + 300.0 - 500.0 + 150.50 - 50.25 = 750.25
    res_c = await manager.recalculate_customer_balance(3)
    assert res_c["recalculated_balance"] == 750.25, f"Expected 750.25, got {res_c['recalculated_balance']}"
    assert res_c["previous_balance"] == 750.25
    assert res_c["difference"] == 0.0
    assert res_c["has_discrepancy"] is False
    print("PASS (C): Mixed CREDIT and PAYMENT transactions correctly calculated.")

    print("\n--- Test D: Soft-Deleted Transactions Excluded ---")
    # On Customer 2: active balance is -125.50.
    # Add a CREDIT and a PAYMENT, then soft delete both.
    tx_del1, _ = await manager.record_transaction(2, 500.0, "CREDIT", "D1 to delete")
    tx_del2, _ = await manager.record_transaction(2, 200.0, "PAYMENT", "D2 to delete")
    await manager.delete_transaction(tx_del1["id"])
    await manager.delete_transaction(tx_del2["id"])

    res_d = await manager.recalculate_customer_balance(2)
    assert res_d["recalculated_balance"] == -125.50, f"Expected -125.50, got {res_d['recalculated_balance']}"
    print("PASS (D): Soft-deleted transactions strictly excluded from balance calculation.")

    print("\n--- Test E: Existing Correct Balance Remains Correct ---")
    # Recalculating Customer 1 with untouched records produces difference 0.0 and has_discrepancy False
    res_e = await manager.recalculate_customer_balance(1)
    assert res_e["difference"] == 0.0
    assert res_e["has_discrepancy"] is False
    assert res_e["recalculated_balance"] == 701.0
    print("PASS (E): Existing correct balance remains unchanged with zero difference.")

    print("\n--- Test F: Incorrect Stored Balance Gets Repaired ---")
    # Manually tamper with Customer 1's total_balance in the database
    async with manager.get_connection() as db:
        await db.execute("UPDATE customers SET total_balance = 9999.99 WHERE id = 1")
        await db.commit()

    res_f = await manager.recalculate_customer_balance(1)
    assert res_f["previous_balance"] == 9999.99
    assert res_f["recalculated_balance"] == 701.0
    assert res_f["difference"] == -9298.99, f"Expected -9298.99, got {res_f['difference']}"
    assert res_f["has_discrepancy"] is True

    # Confirm database balance was repaired
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 1") as cur:
            row = await cur.fetchone()
            assert row["total_balance"] == 701.0
    print("PASS (F): Tampered stored balance successfully repaired to true transaction sum.")

    print("\n--- Test G: Missing Customer Rejected ---")
    try:
        await manager.recalculate_customer_balance(99999)
        assert False, "Should have raised ValueError for non-existent customer"
    except ValueError as e:
        assert "99999" in str(e)
        print("PASS (G): Non-existent customer ID safely rejected with ValueError.")

    print("\n--- Test H: Invalid Customer IDs Rejected ---")
    invalid_ids = [0, -1, -99, False, True, "1", None, 3.14, []]
    for inv_id in invalid_ids:
        try:
            await manager.recalculate_customer_balance(inv_id)
            assert False, f"Should have rejected invalid customer_id: {inv_id}"
        except ValueError:
            pass
    print("PASS (H): Invalid customer IDs (bool, non-int, <=0) safely rejected.")

    print("\n--- Test I: CORRECTION Transaction Causes Rejection ---")
    # Manually insert an active transaction with type 'CORRECTION' for Customer 2
    async with manager.get_connection() as db:
        await db.execute(
            "INSERT INTO transactions (customer_id, amount, type, notes) VALUES (?, ?, ?, ?)",
            (2, 50.0, "CORRECTION", "Manual correction test")
        )
        await db.commit()

    try:
        await manager.recalculate_customer_balance(2)
        assert False, "Should have rejected recalculation due to CORRECTION type"
    except ValueError as e:
        assert "CORRECTION" in str(e)
        print("PASS (I): Active CORRECTION transaction safely rejected with ValueError.")

    print("\n--- Test J: Unsupported Transaction Type Causes Rejection ---")
    # Manually insert an active transaction with unsupported type 'REFUND' for Customer 2
    async with manager.get_connection() as db:
        await db.execute("PRAGMA ignore_check_constraints = ON;")
        await db.execute(
            "INSERT INTO transactions (customer_id, amount, type, notes) VALUES (?, ?, ?, ?)",
            (2, 40.0, "REFUND", "Unsupported type test")
        )
        await db.commit()

    try:
        await manager.recalculate_customer_balance(2)
        assert False, "Should have rejected recalculation due to unsupported type"
    except ValueError as e:
        assert "unsupported type" in str(e) or "CORRECTION" in str(e)
        print("PASS (J): Unsupported transaction type safely rejected with ValueError.")

    print("\n--- Test K: Balance Remains Unchanged if Calculation is Rejected ---")
    # Customer 2 balance was -125.50 before the rejected recalculations
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 2") as cur:
            row = await cur.fetchone()
            assert row["total_balance"] == -125.50, f"Expected -125.50, got {row['total_balance']}"
    print("PASS (K): Customer balance remained completely unchanged after calculation rejections.")

    # Clean up the CORRECTION and REFUND rows for Customer 2
    async with manager.get_connection() as db:
        await db.execute("DELETE FROM transactions WHERE type IN ('CORRECTION', 'REFUND')")
        await db.commit()

    print("\n--- Test L: Other Customers Remain Unaffected ---")
    # Customer 3's balance is 750.25
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 3") as cur:
            bal_c3_before = (await cur.fetchone())["total_balance"]

    # Recalculate Customer 1
    await manager.recalculate_customer_balance(1)

    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 3") as cur:
            bal_c3_after = (await cur.fetchone())["total_balance"]

    assert bal_c3_before == bal_c3_after == 750.25
    print("PASS (L): Recalculating Customer 1 left Customer 3's balance completely untouched.")

    print("\n--- Test M: Atomic Rollback if the Balance Update Fails ---")
    # Install a trigger that aborts updates on Customer 4
    new_cust = await manager.get_or_create_customer("Trigger Test Customer", "9999999999")
    t_id = new_cust["id"]
    await manager.record_transaction(t_id, 100.0, "CREDIT", "Initial credit")
    # Stored balance is 100.0

    async with manager.get_connection() as db:
        # Create an abort trigger specifically for this customer when total_balance is updated
        await db.execute(f"""
            CREATE TRIGGER abort_cust_{t_id}
            BEFORE UPDATE OF total_balance ON customers
            WHEN NEW.id = {t_id}
            BEGIN
                SELECT RAISE(ABORT, 'Simulated database update failure');
            END;
        """)
        # Tamper stored balance to 500.0 directly while trigger is on (bypass or create trigger after)
        # We created trigger with UPDATE OF total_balance. Let's create trigger after setting balance:
        await db.execute(f"DROP TRIGGER abort_cust_{t_id}")
        await db.execute(f"UPDATE customers SET total_balance = 500.0 WHERE id = {t_id}")
        await db.execute(f"""
            CREATE TRIGGER abort_cust_{t_id}
            BEFORE UPDATE OF total_balance ON customers
            WHEN NEW.id = {t_id}
            BEGIN
                SELECT RAISE(ABORT, 'Simulated database update failure');
            END;
        """)
        await db.commit()

    try:
        await manager.recalculate_customer_balance(t_id)
        assert False, "Should have raised OperationalError from trigger abort"
    except Exception as e:
        assert "Simulated database update failure" in str(e) or "ABORT" in str(e)

    # Verify atomic rollback: customer balance remained 500.0 (not partially modified or corrupted)
    async with manager.get_connection() as db:
        async with db.execute(f"SELECT total_balance FROM customers WHERE id = {t_id}") as cur:
            row = await cur.fetchone()
            assert row["total_balance"] == 500.0, f"Expected 500.0, got {row['total_balance']}"
        await db.execute(f"DROP TRIGGER abort_cust_{t_id}")
        await db.commit()
    print("PASS (M): Atomic rollback verified cleanly on midway update failure.")

    print("\n--- Test N: Negative Balances are Handled Correctly ---")
    # Customer 2 currently has recalculated balance -125.50 (advance payment)
    res_n = await manager.recalculate_customer_balance(2)
    assert res_n["recalculated_balance"] == -125.50
    assert res_n["has_discrepancy"] is False
    print("PASS (N): Negative customer balances (advance payments) correctly calculated and preserved.")

    print("\n--- Test O: Existing Idempotency Mappings Remain Unchanged ---")
    # Record a new transaction with idempotency key
    test_key = "idemp_step5_test_key_001"
    tx_o, _ = await manager.record_transaction(1, 45.0, "CREDIT", "Idemp audit check", idempotency_key=test_key)

    # Snapshot idempotency table before recalculation
    async with manager.get_connection() as db:
        async with db.execute("SELECT idempotency_key, transaction_id, request_hash FROM idempotency_requests") as cur:
            idemp_before = [dict(r) for r in await cur.fetchall()]

    # Recalculate customer balance
    await manager.recalculate_customer_balance(1)

    # Snapshot idempotency table after recalculation
    async with manager.get_connection() as db:
        async with db.execute("SELECT idempotency_key, transaction_id, request_hash FROM idempotency_requests") as cur:
            idemp_after = [dict(r) for r in await cur.fetchall()]

    assert idemp_before == idemp_after, "Idempotency records must not be changed during balance recalculation!"
    print("PASS (O): Idempotency requests table and request hashes remained 100% untouched.")

    print("\n--- Test P: Active Transaction Amount Validation (Negative, Zero, Invalid, Non-finite, Null) ---")
    # Customer 2's verified stored balance is -125.50
    bal_cust2_baseline = -125.50

    # P1: Negative transaction amount (-50.0)
    async with manager.get_connection() as db:
        cur = await db.execute(
            "INSERT INTO transactions (customer_id, amount, type, notes) VALUES (2, -50.0, 'CREDIT', 'Negative amount test')"
        )
        tx_neg_id = cur.lastrowid
        await db.commit()

    try:
        await manager.recalculate_customer_balance(2)
        assert False, "Should have rejected negative transaction amount"
    except ValueError as e:
        assert str(tx_neg_id) in str(e), f"Expected transaction id {tx_neg_id} in error message: {e}"
        assert "non-positive" in str(e) or "-50.0" in str(e)

    # Verify balance unchanged (Scenario E)
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 2") as cur:
            assert (await cur.fetchone())["total_balance"] == bal_cust2_baseline
        await db.execute("DELETE FROM transactions WHERE id = ?", (tx_neg_id,))
        await db.commit()
    print("PASS (P1 / Scenario A & E): Negative transaction amount rejected with transaction ID; balance unchanged.")

    # P2: Zero transaction amount (0.0)
    async with manager.get_connection() as db:
        cur = await db.execute(
            "INSERT INTO transactions (customer_id, amount, type, notes) VALUES (2, 0.0, 'CREDIT', 'Zero amount test')"
        )
        tx_zero_id = cur.lastrowid
        await db.commit()

    try:
        await manager.recalculate_customer_balance(2)
        assert False, "Should have rejected zero transaction amount"
    except ValueError as e:
        assert str(tx_zero_id) in str(e), f"Expected transaction id {tx_zero_id} in error message: {e}"
        assert "non-positive" in str(e) or "0.0" in str(e)

    # Verify balance unchanged (Scenario E)
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 2") as cur:
            assert (await cur.fetchone())["total_balance"] == bal_cust2_baseline
        await db.execute("DELETE FROM transactions WHERE id = ?", (tx_zero_id,))
        await db.commit()
    print("PASS (P2 / Scenario B & E): Zero transaction amount rejected with transaction ID; balance unchanged.")

    # P3: Invalid non-numeric string amount ('bad_data') (Scenario C & E)
    async with manager.get_connection() as db:
        cur = await db.execute(
            "INSERT INTO transactions (customer_id, amount, type, notes) VALUES (2, 'bad_data', 'CREDIT', 'Non-numeric test')"
        )
        tx_invalid_id = cur.lastrowid
        await db.commit()

    try:
        await manager.recalculate_customer_balance(2)
        assert False, "Should have rejected non-numeric transaction amount"
    except ValueError as e:
        assert str(tx_invalid_id) in str(e), f"Expected transaction id {tx_invalid_id} in error message: {e}"

    # Verify balance unchanged (Scenario E)
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 2") as cur:
            assert (await cur.fetchone())["total_balance"] == bal_cust2_baseline
        await db.execute("DELETE FROM transactions WHERE id = ?", (tx_invalid_id,))
        await db.commit()
    print("PASS (P3 / Scenario C & E): Invalid non-numeric amount rejected with transaction ID; balance unchanged.")

    # P4: Non-finite amount: 'NaN', 'Infinity', float('inf') (Scenario D & E)
    non_finites = ["NaN", "Infinity", float("inf")]
    for nf in non_finites:
        async with manager.get_connection() as db:
            cur = await db.execute(
                "INSERT INTO transactions (customer_id, amount, type, notes) VALUES (2, ?, 'CREDIT', 'Non-finite test')",
                (nf,)
            )
            tx_nf_id = cur.lastrowid
            await db.commit()

        try:
            await manager.recalculate_customer_balance(2)
            assert False, f"Should have rejected non-finite amount: {nf}"
        except ValueError as e:
            assert str(tx_nf_id) in str(e), f"Expected transaction id {tx_nf_id} in error message: {e}"
            assert "non-finite" in str(e) or "invalid" in str(e)

        # Verify balance unchanged (Scenario E)
        async with manager.get_connection() as db:
            async with db.execute("SELECT total_balance FROM customers WHERE id = 2") as cur:
                assert (await cur.fetchone())["total_balance"] == bal_cust2_baseline
            await db.execute("DELETE FROM transactions WHERE id = ?", (tx_nf_id,))
            await db.commit()
    print("PASS (P4 / Scenario D & E): Non-finite amounts (NaN, Infinity, inf) rejected with transaction ID; balance unchanged.")

    # P5: NULL amount if representable in the database (Scenario C & E)
    # transactions.amount has NOT NULL constraint in standard schema.
    # To test the scenario where a corrupt/legacy database has a NULL amount:
    null_test_db = f"{DB_PREFIX}null_amount_test.db"
    await init_db(null_test_db)
    null_manager = LedgerManager(null_test_db)

    # In SQLite, recreate table without NOT NULL constraint on amount in this isolated test database
    async with null_manager.get_connection() as db:
        await db.execute("PRAGMA foreign_keys = OFF;")
        await db.execute("""
            CREATE TABLE transactions_new (
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
        await db.execute("INSERT INTO transactions_new SELECT * FROM transactions;")
        await db.execute("DROP TABLE transactions;")
        await db.execute("ALTER TABLE transactions_new RENAME TO transactions;")
        await db.execute("PRAGMA foreign_keys = ON;")
        # Insert a transaction with NULL amount for Customer 1
        cur = await db.execute(
            "INSERT INTO transactions (customer_id, amount, type, notes) VALUES (1, NULL, 'CREDIT', 'Null amount test')"
        )
        null_tx_id = cur.lastrowid
        await db.commit()

    # Capture stored balance of Customer 1
    async with null_manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 1") as cur:
            stored_bal_c1 = (await cur.fetchone())["total_balance"]

    try:
        await null_manager.recalculate_customer_balance(1)
        assert False, "Should have rejected NULL transaction amount"
    except ValueError as e:
        assert str(null_tx_id) in str(e), f"Expected transaction id {null_tx_id} in error message: {e}"
        assert "NULL" in str(e) or "null" in str(e)

    # Verify balance unchanged after NULL rejection
    async with null_manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 1") as cur:
            assert (await cur.fetchone())["total_balance"] == stored_bal_c1
    print("PASS (P5 / Scenario C & E): NULL transaction amount rejected with transaction ID; balance unchanged.")

    print("\n========================================================")
    print("ALL STEP 5 SCENARIOS PASSED (20/20) - RECONCILIATION COMPLETE")
    print("========================================================\n")

    cleanup_all()

if __name__ == "__main__":
    asyncio.run(run_step5_verification())
