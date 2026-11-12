"""
Comprehensive Verification Suite for Step 3: Transaction Update (update_transaction).
Tests covered:
A. Update transaction amount (balance adjusted by net difference).
B. Change CREDIT to PAYMENT (balance adjusted by -2 * amount).
C. Change PAYMENT to CREDIT (balance adjusted by +2 * amount).
D. Update transaction notes (balance remains unchanged).
E. Verify customer balance after each update matches exact mathematical expectations.
F. Reject invalid transaction ID (<= 0, boolean, non-int).
G. Reject invalid amount (<= 0, boolean, NaN, Inf, non-numeric).
H. Reject invalid transaction type (not CREDIT or PAYMENT).
I. Reject updating nonexistent transaction (ValueError).
J. Reject updating soft-deleted transaction (ValueError).
K. Verify rollback if an update fails midway (balance and transaction untouched).
L. Verify another customer's balance remains completely unchanged (customer isolation).
M. Verify existing idempotency mappings remain intact and valid after transaction update.
"""
import os
import sys
import glob
import math
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

DB_PREFIX = "test_step3_"


def cleanup_all():
    for f in glob.glob(f"{DB_PREFIX}*"):
        try:
            os.remove(f)
        except Exception:
            pass


async def test_scenarios_a_to_e_financial_updates_and_balance():
    print("\n--- Tests A-E: Transaction Updates & Customer Balance Mathematical Consistency ---")
    db_name = f"{DB_PREFIX}updates.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Use Customer 2 (Ramesh Verma, initial balance = 0.0)
    # 1. Create an initial CREDIT transaction of Rs. 100.00
    tx, bal = await manager.record_transaction(
        customer_id=2, amount=100.0, tx_type="CREDIT", notes="Initial credit"
    )
    tx_id = tx["id"]
    assert bal == 100.0, f"Expected 100.0, got {bal}"

    # Scenario A & E: Update transaction amount from 100.0 to 160.0 (CREDIT)
    # Expected: balance increases by (160 - 100) = +60 -> new balance = 160.0
    up1, bal1 = await manager.update_transaction(transaction_id=tx_id, amount=160.0)
    assert up1["amount"] == 160.0
    assert up1["type"] == "CREDIT"
    assert up1["notes"] == "Initial credit"
    assert bal1 == 160.0, f"Expected 160.0, got {bal1}"
    print("PASS (A & E1): Amount updated from 100 to 160, balance adjusted +60 to 160.0.")

    # Scenario B & E: Change CREDIT (160.0) to PAYMENT (160.0)
    # Expected: balance was +160. Changing to payment (-160) results in delta = -320 -> new balance = -160.0 (in advance)
    up2, bal2 = await manager.update_transaction(transaction_id=tx_id, tx_type="PAYMENT")
    assert up2["type"] == "PAYMENT"
    assert up2["amount"] == 160.0
    assert bal2 == -160.0, f"Expected -160.0, got {bal2}"
    print("PASS (B & E2): Type changed from CREDIT to PAYMENT, balance adjusted to -160.0.")

    # Scenario C & E: Change PAYMENT (160.0) to CREDIT (200.0)
    # Expected: old was PAYMENT 160 (-160). New is CREDIT 200 (+200). Delta = +200 - (-160) = +360.
    # New balance = -160 + 360 = +200.0
    up3, bal3 = await manager.update_transaction(transaction_id=tx_id, amount=200.0, tx_type="CREDIT")
    assert up3["type"] == "CREDIT"
    assert up3["amount"] == 200.0
    assert bal3 == 200.0, f"Expected 200.0, got {bal3}"
    print("PASS (C & E3): Type changed from PAYMENT to CREDIT with new amount, balance adjusted to 200.0.")

    # Scenario D & E: Update notes only
    # Expected: amount and type unchanged, balance remains 200.0
    up4, bal4 = await manager.update_transaction(transaction_id=tx_id, notes="Updated note description")
    assert up4["notes"] == "Updated note description"
    assert up4["amount"] == 200.0
    assert up4["type"] == "CREDIT"
    assert bal4 == 200.0, f"Expected balance unchanged at 200.0, got {bal4}"
    print("PASS (D & E4): Notes updated without affecting balance.")


async def test_scenarios_f_to_h_input_validation():
    print("\n--- Tests F-H: Input Validation (ID, Amount, Type) ---")
    db_name = f"{DB_PREFIX}validation.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)
    tx, _ = await manager.record_transaction(customer_id=1, amount=50.0, tx_type="CREDIT", notes="Valid")
    valid_id = tx["id"]

    # F: Invalid transaction ID
    for bad_id in [0, -1, -99, True, False, "1", None]:
        try:
            await manager.update_transaction(transaction_id=bad_id, amount=60.0)  # type: ignore
            assert False, f"Failed to reject invalid transaction_id: {bad_id}"
        except ValueError as e:
            assert "positive integer" in str(e)
    print("PASS (F): Invalid transaction IDs correctly rejected.")

    # G: Invalid amount
    for bad_amt in [0, -10.0, math.nan, math.inf, -math.inf, True, False, "100"]:
        try:
            await manager.update_transaction(transaction_id=valid_id, amount=bad_amt)  # type: ignore
            assert False, f"Failed to reject invalid amount: {bad_amt}"
        except ValueError:
            pass
    print("PASS (G): Invalid amounts (<=0, NaN, Inf, non-numeric) correctly rejected.")

    # H: Invalid transaction type
    for bad_type in ["DEBIT", "TRANSFER", "credit_card", 123, ""]:
        try:
            await manager.update_transaction(transaction_id=valid_id, tx_type=bad_type)  # type: ignore
            assert False, f"Failed to reject invalid tx_type: {bad_type}"
        except ValueError:
            pass
    print("PASS (H): Invalid transaction types correctly rejected.")

    # No fields provided
    try:
        await manager.update_transaction(transaction_id=valid_id)
        assert False, "Failed to reject update with no fields provided"
    except ValueError as e:
        assert "At least one field" in str(e)
    print("PASS: Calling update with no fields provided correctly rejected.")


async def test_scenarios_i_and_j_nonexistent_and_soft_deleted():
    print("\n--- Tests I & J: Nonexistent & Soft-Deleted Transaction Rejection ---")
    db_name = f"{DB_PREFIX}nonexistent.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # I: Nonexistent transaction
    try:
        await manager.update_transaction(transaction_id=88888, amount=100.0)
        assert False, "Failed to reject nonexistent transaction ID"
    except ValueError as e:
        assert "not found" in str(e).lower()
    print("PASS (I): Updating nonexistent transaction correctly rejected with ValueError.")

    # J: Soft-deleted transaction
    tx, _ = await manager.record_transaction(customer_id=1, amount=75.0, tx_type="CREDIT", notes="Will be deleted")
    del_id = tx["id"]
    async with manager.transaction() as db:
        await db.execute("UPDATE transactions SET is_deleted = 1 WHERE id = ?", (del_id,))

    try:
        await manager.update_transaction(transaction_id=del_id, amount=150.0)
        assert False, "Failed to reject updating soft-deleted transaction"
    except ValueError as e:
        assert "soft-deleted" in str(e).lower()
    print("PASS (J): Updating soft-deleted transaction correctly rejected with ValueError.")


async def test_scenario_k_atomic_rollback():
    print("\n--- Test K: Atomic Rollback on Midway Failure ---")
    db_name = f"{DB_PREFIX}rollback.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Initial state
    tx, initial_bal = await manager.record_transaction(customer_id=1, amount=100.0, tx_type="CREDIT", notes="Pre-rollback")
    tx_id = tx["id"]

    # Attempt a flawed transaction update that fails inside the transaction block
    try:
        async with manager.transaction() as db:
            # Step 1: Update transaction
            await db.execute("UPDATE transactions SET amount = 999.0 WHERE id = ?", (tx_id,))
            # Step 2: Update balance
            await db.execute("UPDATE customers SET total_balance = 9999.0 WHERE id = 1;")
            # Step 3: Trigger intentional failure before commit
            raise RuntimeError("Midway database update failure!")
    except RuntimeError:
        pass

    # Verify that neither the transaction amount nor the customer balance was altered
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 1;") as cur:
            current_bal = (await cur.fetchone())[0]
        async with db.execute("SELECT amount FROM transactions WHERE id = ?", (tx_id,)) as cur:
            current_amt = (await cur.fetchone())[0]

    assert current_bal == initial_bal, f"Rollback failed: balance changed from {initial_bal} to {current_bal}"
    assert current_amt == 100.0, f"Rollback failed: transaction amount changed from 100.0 to {current_amt}"
    print("PASS (K): Rollback successfully restored both transaction and balance on midway failure.")


async def test_scenario_l_customer_isolation():
    print("\n--- Test L: Customer Balance Isolation ---")
    db_name = f"{DB_PREFIX}isolation.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Record transactions for Customer 1 and Customer 3
    tx1, c1_init = await manager.record_transaction(customer_id=1, amount=100.0, tx_type="CREDIT", notes="C1")
    tx3, c3_init = await manager.record_transaction(customer_id=3, amount=300.0, tx_type="CREDIT", notes="C3")

    # Update Customer 1's transaction
    _, c1_new = await manager.update_transaction(transaction_id=tx1["id"], amount=500.0)
    assert c1_new == c1_init + 400.0

    # Verify Customer 3's balance was completely untouched
    async with manager.get_connection() as db:
        async with db.execute("SELECT total_balance FROM customers WHERE id = 3;") as cur:
            c3_current = (await cur.fetchone())[0]

    assert c3_current == c3_init, f"Customer 3 balance was corrupted! Expected {c3_init}, got {c3_current}"
    print("PASS (L): Updating Customer 1's transaction left Customer 3's balance completely untouched.")


async def test_scenario_m_idempotency_compatibility():
    print("\n--- Test M: Existing Idempotency Mappings Remain Valid ---")
    db_name = f"{DB_PREFIX}idemp.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    key = "idemp_update_key_001"
    # Create a transaction with an idempotency key
    tx, bal = await manager.record_transaction(
        customer_id=1, amount=120.0, tx_type="CREDIT", notes="Original item", idempotency_key=key
    )
    tx_id = tx["id"]

    # Verify idempotency_requests record exists
    async with manager.get_connection() as db:
        async with db.execute("SELECT * FROM idempotency_requests WHERE idempotency_key = ?", (key,)) as cur:
            ir_row = await cur.fetchone()
            assert ir_row is not None
            assert ir_row["transaction_id"] == tx_id
            orig_hash = ir_row["request_hash"]

    # Now perform an update on the transaction (e.g. shopkeeper corrects notes and amount)
    up_tx, up_bal = await manager.update_transaction(transaction_id=tx_id, amount=150.0, notes="Corrected item")
    assert up_tx["amount"] == 150.0

    # Verify that the idempotency mapping was NOT deleted or overwritten!
    async with manager.get_connection() as db:
        async with db.execute("SELECT * FROM idempotency_requests WHERE idempotency_key = ?", (key,)) as cur:
            ir_after = await cur.fetchone()
            assert ir_after is not None, "Idempotency mapping was deleted by update_transaction!"
            assert ir_after["transaction_id"] == tx_id, "Idempotency transaction_id was altered!"
            assert ir_after["request_hash"] == orig_hash, "Original request hash was corrupted!"

    print("PASS (M): Existing idempotency mapping preserved without deletion or alteration after update.")


async def main():
    try:
        cleanup_all()
        await test_scenarios_a_to_e_financial_updates_and_balance()
        await test_scenarios_f_to_h_input_validation()
        await test_scenarios_i_and_j_nonexistent_and_soft_deleted()
        await test_scenario_k_atomic_rollback()
        await test_scenario_l_customer_isolation()
        await test_scenario_m_idempotency_compatibility()
        print("\n========================================================")
        print("ALL STEP 3 SCENARIOS PASSED (13/13) - UPDATE COMPLETE")
        print("========================================================\n")
    finally:
        cleanup_all()


if __name__ == "__main__":
    asyncio.run(main())
