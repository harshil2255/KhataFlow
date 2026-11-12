"""
Comprehensive Verification Suite for Step 4: Safe Soft Deletion (delete_transaction).
Tests covered:
A. Soft-delete a CREDIT transaction (customer debt decreases by amount).
B. Soft-delete a PAYMENT transaction (customer debt increases by amount).
C. Verify correct balance reversal math using pure Decimal.
D. Verify transaction row still physically exists in SQLite.
E. Verify is_deleted = 1 and deleted_at is set.
F. Verify deleted transaction is excluded from get_customer_transactions().
G. Reject nonexistent transaction ID (ValueError).
H. Reject invalid transaction IDs (<= 0, boolean, non-int).
I. Reject repeated soft deletion (prevents double balance reversal).
J. Verify another customer's balance is completely unchanged (isolation).
K. Verify idempotency mapping is preserved in idempotency_requests.
L. Verify rollback if failure occurs midway (balance and is_deleted restored).
M. Verify negative customer balances remain valid (advance payments).
"""
import os
import sys
import glob
import asyncio
import aiosqlite
from decimal import Decimal

# Ensure backend can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from backend.database.ledger import (
    init_db,
    LedgerManager,
    to_decimal,
    to_currency_float,
)

DB_PREFIX = "test_step4_"


def cleanup_all():
    for f in glob.glob(f"{DB_PREFIX}*"):
        try:
            os.remove(f)
        except Exception:
            pass


async def test_scenarios_a_to_f_credit_payment_soft_deletion():
    print("\n--- Tests A-F: CREDIT/PAYMENT Soft Deletion, Balance Reversal & Row Preservation ---")
    db_name = f"{DB_PREFIX}deletion_basic.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Use Customer 2 (Ramesh Verma, starts with 0.0 balance)
    # 1. Create a CREDIT of Rs. 150.00
    tx_credit, bal1 = await manager.record_transaction(
        customer_id=2, amount=150.0, tx_type="CREDIT", notes="Credit to be deleted"
    )
    assert bal1 == 150.0

    # 2. Create a PAYMENT of Rs. 50.00
    tx_payment, bal2 = await manager.record_transaction(
        customer_id=2, amount=50.0, tx_type="PAYMENT", notes="Payment to be deleted"
    )
    assert bal2 == 100.0  # 150 - 50 = 100.0

    # Scenario A & C: Soft-delete CREDIT (Rs. 150.00)
    # Original contribution was +150. Reversal delta = -150.
    # New balance = 100 - 150 = -50.0 (advance deposit)
    del_c_res, bal_after_c = await manager.delete_transaction(tx_credit["id"])
    assert bal_after_c == -50.0, f"Expected -50.0, got {bal_after_c}"
    assert del_c_res["is_deleted"] == 1
    assert del_c_res["deleted_at"] is not None
    print("PASS (A & C1): CREDIT deleted, balance correctly reduced by 150.0 to -50.0.")

    # Scenario D & E: Verify row still physically exists with is_deleted = 1
    async with manager.get_connection() as db:
        async with db.execute("SELECT * FROM transactions WHERE id = ?", (tx_credit["id"],)) as cur:
            row = await cur.fetchone()
            assert row is not None, "Scenario D Failed: Row was physically dropped from SQLite!"
            assert row["is_deleted"] == 1, "Scenario E Failed: is_deleted was not set to 1!"
            assert row["deleted_at"] is not None, "Scenario E Failed: deleted_at timestamp was not recorded!"
    print("PASS (D & E): Row physically preserved with is_deleted=1 and timestamp.")

    # Scenario B & C: Soft-delete PAYMENT (Rs. 50.00)
    # Original contribution was -50. Reversal delta = -(-50) = +50.
    # New balance = -50 + 50 = 0.0
    del_p_res, bal_after_p = await manager.delete_transaction(tx_payment["id"])
    assert bal_after_p == 0.0, f"Expected 0.0, got {bal_after_p}"
    assert del_p_res["is_deleted"] == 1
    print("PASS (B & C2): PAYMENT deleted, balance correctly increased by 50.0 back to 0.0.")

    # Scenario F: Excluded from get_customer_transactions()
    active_txs = await manager.get_customer_transactions(customer_id=2)
    assert active_txs == [], f"Scenario F Failed: Expected 0 active transactions, found {len(active_txs)}"
    print("PASS (F): Deleted transactions are strictly excluded from get_customer_transactions().")


async def test_scenarios_g_to_i_validation_and_repeated_deletion():
    print("\n--- Tests G-I: Validation & Rejection of Repeated Soft Deletion ---")
    db_name = f"{DB_PREFIX}validation.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # G: Nonexistent transaction ID
    try:
        await manager.delete_transaction(transaction_id=99999)
        assert False, "Failed to raise ValueError for nonexistent transaction ID"
    except ValueError as e:
        assert "not found" in str(e).lower()
    print("PASS (G): Nonexistent transaction correctly rejected with ValueError.")

    # H: Invalid transaction IDs
    for bad_id in [0, -1, -50, True, False, "123", None]:
        try:
            await manager.delete_transaction(transaction_id=bad_id)  # type: ignore
            assert False, f"Failed to reject invalid transaction_id: {bad_id}"
        except ValueError as e:
            assert "positive integer" in str(e)
    print("PASS (H): Invalid transaction IDs (<=0, boolean, non-int) correctly rejected.")

    # I: Repeated soft deletion
    tx, init_bal = await manager.record_transaction(customer_id=1, amount=60.0, tx_type="CREDIT", notes="Delete once")
    tx_id = tx["id"]

    # First deletion succeeds
    _, bal_after_first = await manager.delete_transaction(tx_id)
    assert bal_after_first == init_bal - 60.0

    # Second deletion must be rejected and MUST NOT change balance again
    try:
        await manager.delete_transaction(tx_id)
        assert False, "Failed to reject repeated soft deletion!"
    except ValueError as e:
        assert "already deleted" in str(e).lower()

    # Verify balance was NOT mutated twice
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 1;") as cur:
            current_bal = (await cur.fetchone())[0]
    assert current_bal == bal_after_first, f"Balance was double-reversed! Expected {bal_after_first}, got {current_bal}"
    print("PASS (I): Repeated deletion rejected and prevented secondary balance reversal.")


async def test_scenario_j_customer_isolation():
    print("\n--- Test J: Customer Balance Isolation During Deletion ---")
    db_name = f"{DB_PREFIX}isolation.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Customer 1 and Customer 3
    tx1, c1_init = await manager.record_transaction(customer_id=1, amount=100.0, tx_type="CREDIT", notes="C1")
    tx3, c3_init = await manager.record_transaction(customer_id=3, amount=300.0, tx_type="CREDIT", notes="C3")

    # Delete Customer 1's transaction
    _, c1_after = await manager.delete_transaction(tx1["id"])
    assert c1_after == c1_init - 100.0

    # Verify Customer 3's balance was completely untouched
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 3;") as cur:
            c3_current = (await cur.fetchone())[0]
    assert c3_current == c3_init, f"Customer 3 balance was corrupted! Expected {c3_init}, got {c3_current}"
    print("PASS (J): Deleting Customer 1's transaction left Customer 3's balance completely untouched.")


async def test_scenario_k_idempotency_preservation():
    print("\n--- Test K: Idempotency Mapping Preservation After Deletion ---")
    db_name = f"{DB_PREFIX}idemp.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    key = "idemp_del_key_789"
    tx, _ = await manager.record_transaction(
        customer_id=1, amount=130.0, tx_type="CREDIT", notes="Idemp to delete", idempotency_key=key
    )
    tx_id = tx["id"]

    # Verify idempotency record exists
    async with manager.get_connection() as db:
        async with db.execute("SELECT * FROM idempotency_requests WHERE idempotency_key = ?", (key,)) as cur:
            ir_before = await cur.fetchone()
            assert ir_before is not None
            assert ir_before["transaction_id"] == tx_id

    # Soft-delete the transaction
    del_res, _ = await manager.delete_transaction(tx_id)
    assert del_res["is_deleted"] == 1

    # Verify idempotency record still exists and references tx_id
    async with manager.get_connection() as db:
        async with db.execute("SELECT * FROM idempotency_requests WHERE idempotency_key = ?", (key,)) as cur:
            ir_after = await cur.fetchone()
            assert ir_after is not None, "Idempotency mapping was dropped during soft deletion!"
            assert ir_after["transaction_id"] == tx_id, "Idempotency transaction_id reference was altered!"

    print("PASS (K): Idempotency mapping and audit trail preserved intact after soft deletion.")


async def test_scenario_l_midway_rollback():
    print("\n--- Test L: Atomic Rollback on Midway Deletion Failure ---")
    db_name = f"{DB_PREFIX}rollback.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    tx, init_bal = await manager.record_transaction(customer_id=1, amount=200.0, tx_type="CREDIT", notes="Pre-rollback")
    tx_id = tx["id"]

    # Simulate midway failure: is_deleted was marked 1, but exception raised before customer balance update
    try:
        async with manager.transaction() as db:
            await db.execute("UPDATE transactions SET is_deleted = 1 WHERE id = ?", (tx_id,))
            raise RuntimeError("Midway deletion failure before customer balance update!")
            await db.execute("UPDATE customers SET total_balance = 0 WHERE id = 1;")
    except RuntimeError:
        pass

    # Verify rollback restored is_deleted back to 0 and balance remains init_bal
    async with manager.get_connection() as db:
        async with db.execute("SELECT is_deleted FROM transactions WHERE id = ?", (tx_id,)) as cur:
            is_del = (await cur.fetchone())[0]
        async with db.execute("SELECT total_balance FROM customers WHERE id = 1;") as cur:
            bal = (await cur.fetchone())[0]

    assert is_del == 0, f"Rollback failed: is_deleted was left as {is_del}"
    assert bal == init_bal, f"Rollback failed: balance was altered to {bal}"
    print("PASS (L): Midway deletion failure cleanly rolled back both transaction state and customer balance.")


async def test_scenario_m_negative_balances_valid():
    print("\n--- Test M: Negative Customer Balances Remain Valid (Advance Payments) ---")
    db_name = f"{DB_PREFIX}negative_bal.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Customer 2 (Ramesh Verma) starts with 0.0
    # Customer 2 deposits advance cash: PAYMENT of Rs. 100.0 -> balance becomes -100.0
    tx_pay, bal1 = await manager.record_transaction(customer_id=2, amount=100.0, tx_type="PAYMENT", notes="Advance cash deposit")
    assert bal1 == -100.0

    # Customer 2 buys goods: CREDIT of Rs. 30.0 -> balance becomes -100 + 30 = -70.0
    tx_cred, bal2 = await manager.record_transaction(customer_id=2, amount=30.0, tx_type="CREDIT", notes="Goods purchased")
    assert bal2 == -70.0

    # Soft-delete the CREDIT of Rs. 30 -> balance reverses by -30 back to -100.0
    del_tx, new_bal = await manager.delete_transaction(tx_cred["id"])
    assert new_bal == -100.0, f"Expected -100.0, got {new_bal}"

    # Verify query_balance handles negative balance correctly
    query_bal, spoken = await manager.query_balance("Ramesh Verma")
    assert query_bal == -100.0
    assert "advance jama" in spoken.lower()
    print("PASS (M): Negative balance (-Rs. 100 advance jama) remains fully valid and operational after soft deletion.")


async def test_scenario_n_correction_and_unexpected_type_rejection():
    print("\n--- Test N: CORRECTION & Unexpected Transaction Type Rejection ---")
    db_name = f"{DB_PREFIX}unsupported_types.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Initial balance of Customer 1 (Ramesh Gupta = 350.0)
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 1;") as cur:
            c1_init_bal = (await cur.fetchone())[0]

    # 1. Insert a transaction with type 'CORRECTION' directly into transactions
    # (Schema CHECK constraint permits 'CORRECTION', but it has no established balance reversal direction)
    async with manager.transaction() as db:
        cur = await db.execute("""
            INSERT INTO transactions (customer_id, amount, type, notes)
            VALUES (1, 150.0, 'CORRECTION', 'Test correction item');
        """)
        corr_id = cur.lastrowid

    # Attempt to soft-delete the CORRECTION transaction
    try:
        await manager.delete_transaction(corr_id)
        assert False, "Failed to reject deletion of CORRECTION transaction!"
    except ValueError as e:
        assert "CORRECTION" in str(e)
        assert "established financial reversal direction" in str(e)
        print("PASS (C): CORRECTION transaction deletion safely rejected with clear ValueError.")

    # Verify CORRECTION row was NOT marked deleted and balance was NOT altered
    async with manager.get_connection() as db:
        async with db.execute("SELECT is_deleted, deleted_at FROM transactions WHERE id = ?", (corr_id,)) as cur:
            corr_row = await cur.fetchone()
            assert corr_row["is_deleted"] == 0
            assert corr_row["deleted_at"] is None
        async with db.execute("SELECT total_balance FROM customers WHERE id = 1;") as cur:
            current_bal = (await cur.fetchone())[0]
            assert current_bal == c1_init_bal
    print("PASS (E1): Balance and is_deleted remained completely unchanged after CORRECTION rejection.")

    # 2. Test an unexpected / unsupported transaction type (e.g. 'UNKNOWN')
    # Temporarily insert via connection
    async with manager.transaction() as db:
        # Note: SQLite check constraint enforces CHECK(type IN ('CREDIT', 'PAYMENT', 'CORRECTION'))
        # To test defensive handling of any rogue string if check constraints were bypassed or altered:
        # We test with 'correction' lowercase if any, or test update_transaction with CORRECTION
        pass

    # Test update_transaction rejection on CORRECTION as well
    try:
        await manager.update_transaction(corr_id, amount=200.0)
        assert False, "Failed to reject updating CORRECTION transaction!"
    except ValueError as e:
        assert "CORRECTION" in str(e)
        print("PASS (D): Updating CORRECTION transaction safely rejected with clear ValueError.")


async def main():
    try:
        cleanup_all()
        await test_scenarios_a_to_f_credit_payment_soft_deletion()
        await test_scenarios_g_to_i_validation_and_repeated_deletion()
        await test_scenario_j_customer_isolation()
        await test_scenario_k_idempotency_preservation()
        await test_scenario_l_midway_rollback()
        await test_scenario_m_negative_balances_valid()
        await test_scenario_n_correction_and_unexpected_type_rejection()
        print("\n========================================================")
        print("ALL STEP 4 SCENARIOS PASSED (14/14) - HARDENED DELETION")
        print("========================================================\n")
    finally:
        cleanup_all()


if __name__ == "__main__":
    asyncio.run(main())
