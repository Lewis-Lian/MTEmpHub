"""Opt-in follow-up acceptance on the existing private, socket-only MySQL.

Use the guarded fixture from monthly_backup_mysql: it checks @@datadir,
creates a random schema per test, and drops only that schema afterwards.
No .env or application database connection is used.
"""
from docs.testing.monthly_backup_mysql import backup_app
from tests.test_meal_ticket_followup_backup import (
    test_export_restore_remaps_ids_keeps_partial_and_cursor,
    test_old_v2_absent_preserves_tasks_and_navigation,
    test_old_v1_absent_does_not_delete_followup_state,
    test_upgrade_old_structure_twice_and_migration_order,
    test_invalid_allocation_blocks_preview,
    test_followup_portable_sources_must_exist_and_match,
    test_partial_funds_cannot_be_restored_as_pending_without_explicit_retry,
)


def test_mysql_followup_foreign_keys_reject_missing_payment(backup_app):
    import pytest
    from sqlalchemy import inspect, text
    from sqlalchemy.exc import IntegrityError
    from models import db
    from models.meal_ticket import MealTicketFollowupAllocation
    from tests.test_meal_ticket_followup_backup import seed
    _, task, _ = seed()
    assert db.session.execute(text('SELECT @@foreign_key_checks')).scalar() == 1
    parents = {fk['referred_table'] for fk in inspect(db.engine).get_foreign_keys('meal_ticket_followup_allocations')}
    assert parents == {'meal_ticket_followup_tasks', 'meal_ticket_payments'}
    db.session.add(MealTicketFollowupAllocation(month='2026-06', task_key=task.key,
        payment_key='f'*32, amount_cents=100, operator='admin'))
    with pytest.raises(IntegrityError):
        db.session.flush()
    db.session.rollback()
    assert MealTicketFollowupAllocation.query.count() == 1
