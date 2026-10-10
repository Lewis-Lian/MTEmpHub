"""Keep large dependency error lists from requiring quadratic comparisons."""
from datetime import date, timedelta
from sqlalchemy import event
from models import db
from models.account_set import AccountSet
from models.daily_record import DailyRecord
from services.account_set_backup_schema import V2_DATASETS
from services.multi_month_restore_preview import _target_state, _validate
from tests.test_account_set_backup import backup_app


class CountedKey(str):
    comparisons = 0
    __hash__ = str.__hash__

    def __eq__(self, other):
        type(self).comparisons += 1
        return super().__eq__(other)


def test_many_locked_changes_keep_distinct_errors_without_quadratic_work(backup_app):
    count = 1000
    changes = [dict(row_key=CountedKey('record/%s' % n), dataset='daily_records',
                    month=None, backup=None, system=None, affected_months=['2026-06'])
               for n in range(count)]
    # Repeated reports must still be deduplicated without losing distinct rows.
    changes += changes[:10]
    final = {'shared/users': {'admin': dict(username='synthetic-admin', role='admin',
                                          password_hash='synthetic-hash', is_active=True)}}
    CountedKey.comparisons = 0
    errors = _validate(final, {}, {}, [], changes, {}, {'months': []},
                       {'2026-06': AccountSet(month='2026-06', is_locked=True)})
    assert len(errors) == count
    assert [str(error['row_key']) for error in errors] == ['record/%s' % n for n in range(count)]
    assert all(error['code'] == 'locked' and error['month'] == '2026-06' for error in errors)
    assert CountedKey.comparisons < count * 5


def test_historical_references_do_not_rescan_target_for_every_child(backup_app):
    class CountedState(dict):
        scans = 0

        def items(self):
            self.scans += 1
            return super().items()

    target = CountedState({'shared/employees': {'historic': {'emp_no': 'historic'}}})
    final = {'month/2026-06/daily_records': {
        str(n): {'emp_no': 'historic'} for n in range(1000)}}
    errors = _validate(final, target, {}, [], [], {}, {'months': []}, {})
    assert errors == []  # Retained historical references may use the old anchor.
    assert target.scans <= len(V2_DATASETS)


def test_target_serialization_reuses_loaded_relationships(backup_app):
    db.session.add_all([DailyRecord(emp_id=1, record_date=date(2025, 1, 1) + timedelta(days=n),
                                   actual_hours=8) for n in range(200)])
    db.session.commit()
    db.session.remove()
    queries = []
    def record_query(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith('SELECT'):
            queries.append(statement)
    event.listen(db.engine, 'before_cursor_execute', record_query)
    try:
        state, _ = _target_state()
    finally:
        event.remove(db.engine, 'before_cursor_execute', record_query)
    records = [value for scope, values in state.items() if scope.endswith('/daily_records')
               for value in values.values()]
    assert len(records) == 201 and all(value['emp_no'] == 'E1' for value in records)
    assert len(queries) < len(V2_DATASETS) * 3
