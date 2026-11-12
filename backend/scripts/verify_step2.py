"""
Verification Suite for Step 2: Customer-Specific Transaction History Retrieval.
Tests covered:
A. Customer with multiple transactions.
B. Two customers with separate transaction histories.
C. Customer with no transactions (returns []).
D. Invalid customer ID (<= 0, non-int, non-existent -> ValueError).
E. Soft-deleted transactions are excluded (is_deleted = 1).
F. Pagination using limit and offset.
G. Newest-first ordering (created_at DESC).
H. Transactions with identical timestamps (tie-broken by id DESC).
I. Invalid limit and offset values (ValueError).
"""
import os
import sys
import glob
import asyncio
import aiosqlite

# Ensure backend can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from backend.database.ledger import (
    init_db,
    LedgerManager,
    to_currency_float,
)

DB_PREFIX = "test_step2_"


def cleanup_all():
    for f in glob.glob(f"{DB_PREFIX}*"):
        try:
            os.remove(f)
        except Exception:
            pass


async def test_scenario_a_multiple_transactions():
    print("\n--- Test A: Customer with Multiple Transactions ---")
    db_name = f"{DB_PREFIX}multi.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Customer 1 (Ramesh Gupta) has 1 seeded transaction.
    # Add 2 more transactions for Customer 1.
    await manager.record_transaction(customer_id=1, amount=150.0, tx_type="CREDIT", notes="Atta 5kg")
    await manager.record_transaction(customer_id=1, amount=50.0, tx_type="PAYMENT", notes="Cash payment")

    txs = await manager.get_customer_transactions(customer_id=1, limit=10, offset=0)
    assert len(txs) == 3, f"Expected 3 transactions, found {len(txs)}"
    for t in txs:
        assert t["customer_id"] == 1, f"Found transaction belonging to wrong customer: {t['customer_id']}"
        assert t["customer_name"] == "Ramesh Gupta"
    print("PASS (A): Successfully retrieved all active transactions for the customer.")


async def test_scenario_b_two_customers_isolation():
    print("\n--- Test B: Isolation Between Multiple Customers ---")
    db_name = f"{DB_PREFIX}isolation.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Record 2 transactions for Customer 1, 3 transactions for Customer 3 (Suresh Sharma)
    await manager.record_transaction(customer_id=1, amount=100.0, tx_type="CREDIT", notes="C1 note 1")
    await manager.record_transaction(customer_id=1, amount=200.0, tx_type="PAYMENT", notes="C1 note 2")

    await manager.record_transaction(customer_id=3, amount=300.0, tx_type="CREDIT", notes="C3 note 1")
    await manager.record_transaction(customer_id=3, amount=400.0, tx_type="CREDIT", notes="C3 note 2")
    await manager.record_transaction(customer_id=3, amount=500.0, tx_type="PAYMENT", notes="C3 note 3")

    c1_txs = await manager.get_customer_transactions(customer_id=1)
    c3_txs = await manager.get_customer_transactions(customer_id=3)

    # Note: seeded DB has 1 tx for C1 and 1 tx for C3 initially
    assert len(c1_txs) == 3, f"Expected 3 transactions for C1, got {len(c1_txs)}"
    assert len(c3_txs) == 4, f"Expected 4 transactions for C3, got {len(c3_txs)}"

    for t in c1_txs:
        assert t["customer_id"] == 1
    for t in c3_txs:
        assert t["customer_id"] == 3

    print("PASS (B): Transaction history is strictly isolated between different customers.")


async def test_scenario_c_customer_with_no_transactions():
    print("\n--- Test C: Customer with No Transactions ---")
    db_name = f"{DB_PREFIX}no_tx.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Customer 2 (Ramesh Verma) was seeded with 0.0 balance and has NO transactions.
    txs = await manager.get_customer_transactions(customer_id=2)
    assert txs == [], f"Expected empty list for customer with no transactions, got {txs}"
    print("PASS (C): Returned empty list for existing customer with zero transactions.")


async def test_scenario_d_invalid_customer_id():
    print("\n--- Test D: Invalid Customer ID Validation ---")
    db_name = f"{DB_PREFIX}invalid_cid.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # 1. Non-existent customer ID
    try:
        await manager.get_customer_transactions(customer_id=99999)
        assert False, "Failed to raise ValueError for non-existent customer ID"
    except ValueError as e:
        assert "not found" in str(e).lower()

    # 2. Zero ID
    try:
        await manager.get_customer_transactions(customer_id=0)
        assert False, "Failed to raise ValueError for customer_id=0"
    except ValueError as e:
        assert "positive integer" in str(e)

    # 3. Negative ID
    try:
        await manager.get_customer_transactions(customer_id=-5)
        assert False, "Failed to raise ValueError for customer_id=-5"
    except ValueError as e:
        assert "positive integer" in str(e)

    # 4. Non-integer ID (boolean)
    try:
        await manager.get_customer_transactions(customer_id=True)  # type: ignore
        assert False, "Failed to raise ValueError for boolean customer_id"
    except ValueError as e:
        assert "positive integer" in str(e)

    print("PASS (D): Invalid customer IDs (non-existent, zero, negative, non-int) correctly rejected with ValueError.")


async def test_scenario_e_soft_deleted_excluded():
    print("\n--- Test E: Soft-Deleted Transactions Excluded ---")
    db_name = f"{DB_PREFIX}soft_del.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Add 2 transactions for Customer 1
    t1, _ = await manager.record_transaction(customer_id=1, amount=75.0, tx_type="CREDIT", notes="Active item")
    t2, _ = await manager.record_transaction(customer_id=1, amount=85.0, tx_type="CREDIT", notes="To be soft-deleted")

    # Soft-delete t2 manually
    async with manager.transaction() as db:
        await db.execute("UPDATE transactions SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?", (t2["id"],))

    # Fetch customer transactions
    txs = await manager.get_customer_transactions(customer_id=1)
    tx_ids = [t["id"] for t in txs]

    assert t1["id"] in tx_ids, "Active transaction was unexpectedly missing!"
    assert t2["id"] not in tx_ids, "Soft-deleted transaction was returned!"
    for t in txs:
        assert t.get("is_deleted", 0) == 0
    print("PASS (E): Soft-deleted transactions are strictly excluded from customer transaction history.")


async def test_scenario_f_pagination():
    print("\n--- Test F: Pagination (Limit and Offset) ---")
    db_name = f"{DB_PREFIX}pagination.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Create 5 new transactions for Customer 1
    created_ids = []
    for i in range(5):
        t, _ = await manager.record_transaction(customer_id=1, amount=10.0 + i, tx_type="CREDIT", notes=f"Page item {i}")
        created_ids.append(t["id"])

    # Page 1: limit=2, offset=0
    page1 = await manager.get_customer_transactions(customer_id=1, limit=2, offset=0)
    assert len(page1) == 2, f"Expected 2 items on page 1, got {len(page1)}"

    # Page 2: limit=2, offset=2
    page2 = await manager.get_customer_transactions(customer_id=1, limit=2, offset=2)
    assert len(page2) == 2, f"Expected 2 items on page 2, got {len(page2)}"

    # Ensure page 1 and page 2 do not overlap
    page1_ids = {t["id"] for t in page1}
    page2_ids = {t["id"] for t in page2}
    assert page1_ids.isdisjoint(page2_ids), "Page 1 and Page 2 overlapped!"

    # Page 3: limit=2, offset=4
    page3 = await manager.get_customer_transactions(customer_id=1, limit=2, offset=4)
    # Total txs = 1 (seeded) + 5 (new) = 6. So offset 4 with limit 2 gives 2 items.
    assert len(page3) == 2

    # Beyond total: offset=100
    page_empty = await manager.get_customer_transactions(customer_id=1, limit=10, offset=100)
    assert page_empty == []

    print("PASS (F): Pagination with limit and offset retrieves discrete, non-overlapping pages.")


async def test_scenario_g_newest_first_ordering():
    print("\n--- Test G: Newest-First Ordering (created_at DESC) ---")
    db_name = f"{DB_PREFIX}ordering.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Insert 3 transactions with explicitly staggered timestamps for Customer 2 (who starts with 0 transactions)
    async with manager.transaction() as db:
        await db.execute("""
            INSERT INTO transactions (customer_id, amount, type, notes, created_at)
            VALUES (2, 10.0, 'CREDIT', 'Oldest', '2026-01-01 10:00:00');
        """)
        await db.execute("""
            INSERT INTO transactions (customer_id, amount, type, notes, created_at)
            VALUES (2, 20.0, 'CREDIT', 'Middle', '2026-01-02 10:00:00');
        """)
        await db.execute("""
            INSERT INTO transactions (customer_id, amount, type, notes, created_at)
            VALUES (2, 30.0, 'CREDIT', 'Newest', '2026-01-03 10:00:00');
        """)

    txs = await manager.get_customer_transactions(customer_id=2, limit=3, offset=0)
    assert len(txs) == 3, f"Expected 3 transactions, got {len(txs)}"
    # The first item must be 'Newest', followed by 'Middle', then 'Oldest'
    assert txs[0]["notes"] == "Newest"
    assert txs[1]["notes"] == "Middle"
    assert txs[2]["notes"] == "Oldest"
    print("PASS (G): Transactions correctly ordered newest-first by created_at DESC.")


async def test_scenario_h_identical_timestamps_tiebreaker():
    print("\n--- Test H: Identical Timestamps Tie-Breaker (id DESC) ---")
    db_name = f"{DB_PREFIX}tiebreaker.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # Insert two transactions for Customer 2 (who starts with 0 transactions) with the exact same timestamp
    fixed_ts = "2026-06-15 12:00:00"
    async with manager.transaction() as db:
        cur1 = await db.execute("""
            INSERT INTO transactions (customer_id, amount, type, notes, created_at)
            VALUES (2, 111.0, 'CREDIT', 'First inserted', ?);
        """, (fixed_ts,))
        id1 = cur1.lastrowid

        cur2 = await db.execute("""
            INSERT INTO transactions (customer_id, amount, type, notes, created_at)
            VALUES (2, 222.0, 'CREDIT', 'Second inserted', ?);
        """, (fixed_ts,))
        id2 = cur2.lastrowid

    assert id2 > id1, "Expected id2 to be greater than id1"

    txs = await manager.get_customer_transactions(customer_id=2, limit=2, offset=0)
    # When timestamps match, id DESC dictates that id2 appears before id1
    assert txs[0]["id"] == id2, f"Expected higher ID {id2} first, got {txs[0]['id']}"
    assert txs[1]["id"] == id1, f"Expected lower ID {id1} second, got {txs[1]['id']}"
    print("PASS (H): Transactions with identical timestamps are tie-broken deterministically by id DESC.")


async def test_scenario_i_invalid_limit_and_offset():
    print("\n--- Test I: Invalid Limit and Offset Validation ---")
    db_name = f"{DB_PREFIX}invalid_params.db"
    await init_db(db_name)
    manager = LedgerManager(db_name)

    # 1. limit <= 0
    for bad_limit in [0, -1, -50]:
        try:
            await manager.get_customer_transactions(customer_id=1, limit=bad_limit)
            assert False, f"Failed to raise ValueError for limit={bad_limit}"
        except ValueError as e:
            assert "between 1 and 100" in str(e)

    # 2. limit > 100
    try:
        await manager.get_customer_transactions(customer_id=1, limit=101)
        assert False, "Failed to raise ValueError for limit=101"
    except ValueError as e:
        assert "between 1 and 100" in str(e)

    # 3. limit is boolean or float
    try:
        await manager.get_customer_transactions(customer_id=1, limit=True)  # type: ignore
        assert False, "Failed to raise ValueError for boolean limit"
    except ValueError as e:
        assert "between 1 and 100" in str(e)

    # 4. offset < 0
    try:
        await manager.get_customer_transactions(customer_id=1, offset=-1)
        assert False, "Failed to raise ValueError for offset=-1"
    except ValueError as e:
        assert "greater than or equal to 0" in str(e)

    # 5. offset is boolean
    try:
        await manager.get_customer_transactions(customer_id=1, offset=False)  # type: ignore
        assert False, "Failed to raise ValueError for boolean offset"
    except ValueError as e:
        assert "greater than or equal to 0" in str(e)

    print("PASS (I): Invalid limit (<=0, >100, non-int) and offset (<0, non-int) correctly rejected.")


async def main():
    try:
        cleanup_all()
        await test_scenario_a_multiple_transactions()
        await test_scenario_b_two_customers_isolation()
        await test_scenario_c_customer_with_no_transactions()
        await test_scenario_d_invalid_customer_id()
        await test_scenario_e_soft_deleted_excluded()
        await test_scenario_f_pagination()
        await test_scenario_g_newest_first_ordering()
        await test_scenario_h_identical_timestamps_tiebreaker()
        await test_scenario_i_invalid_limit_and_offset()
        print("\n========================================================")
        print("ALL STEP 2 SCENARIOS PASSED (9/9) - HISTORY COMPLETE")
        print("========================================================\n")
    finally:
        cleanup_all()


if __name__ == "__main__":
    asyncio.run(main())
