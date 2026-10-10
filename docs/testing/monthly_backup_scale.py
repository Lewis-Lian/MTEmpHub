"""Opt-in synthetic SQLite scale/file-limit checks, no .env or external service.
PYTHON_DOTENV_DISABLED=1 PYTHONPATH=. .venv-mac/bin/python -m pytest docs/testing/monthly_backup_scale.py -q -s
Timings are observations, not production performance thresholds.
"""
from datetime import date
from pathlib import Path
import hashlib
import os
import resource
import time

import pytest
from sqlalchemy import text
from models import db
from models.account_set import AccountSet, AccountSetImport
from models.daily_record import DailyRecord
from models.employee import Employee
from services.account_set_backup_service import export_multi_backup, read_backup, BackupError
from services.account_set_restore_service import build_multi_preview, restore_multi_backup
from services.monthly_reference_service import ensure_month_reference
from tests.test_account_set_backup import backup_app


def timed(label, fn):
    start = time.monotonic()
    result = fn()
    print(f'{label}: {time.monotonic()-start:.3f}s', flush=True)
    return result


def test_twenty_four_months_sixty_seven_thousand_rows(backup_app):
    db.session.query(DailyRecord).delete()
    db.session.add_all([Employee(emp_no=f'SCALE-{n:04}', name=f'合成人员{n}', dept_id=1) for n in range(2,101)])
    months = [f'{year}-{month:02}' for year in (2026,2027) for month in range(1,13)]
    db.session.add_all([AccountSet(month=month, name=month) for month in months if month!='2026-06'])
    db.session.flush()
    for month in months:
        year, number = map(int, month.split('-'))
        db.session.bulk_insert_mappings(DailyRecord, [dict(emp_id=emp,record_date=date(year,number,day),actual_hours=8)
            for emp in range(1,101) for day in range(1,29)])
        ensure_month_reference(month)
    db.session.commit()
    ids = [a.id for a in AccountSet.query.order_by(AccountSet.month)]
    assert DailyRecord.query.count() == 67200
    payload = timed('24-month export + verification', lambda: export_multi_backup(ids, ['attendance']))
    document = timed('ZIP read', lambda: read_backup(payload, normalized=True))
    assert len(document['months']) == 24
    assert sum(len(block['datasets']['daily_records']) for block in document['monthly'].values()) == 67200
    db.session.execute(text("UPDATE daily_records SET actual_hours=1 WHERE record_date BETWEEN '2026-12-01' AND '2026-12-31'"))
    db.session.commit()
    selection = {'months':['2026-12'], 'categories':['attendance']}
    preview = timed('preview one selected month in 24-month package',lambda: build_multi_preview(document,selection))
    assert not preview['blockers']
    assert sum(row['enabled'] and row['status']=='changed' for row in preview['rows']) == 2800
    result = timed('restore selected month',lambda: restore_multi_backup(document,selection,{},preview['fingerprint'],1))
    assert result['counts']['updated'] == 2800
    assert DailyRecord.query.filter(DailyRecord.actual_hours!=8).count() == 0
    assert DailyRecord.query.count() == 67200
    print(f'ZIP bytes={len(payload)}; preview rows={len(preview["rows"])}; peak RSS={resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}',flush=True)


def test_real_ninety_mib_archive_and_over_limit_rejection(backup_app,tmp_path):
    path = tmp_path / 'synthetic-random.bin'
    with path.open('wb') as file:
        for _ in range(90): file.write(os.urandom(1024*1024))
    ensure_month_reference("2026-06")
    expected = hashlib.sha256(path.read_bytes()).hexdigest()
    db.session.add(AccountSetImport(account_set_id=1,source_filename=path.name,stored_path=str(path),status='ok'))
    db.session.commit()
    payload = timed('90 MiB random file export + verification',lambda: export_multi_backup([1],['attendance','archives']))
    assert 90*1024*1024 <= len(payload) <= 100*1024*1024
    document = timed('90 MiB ZIP read',lambda: read_backup(payload,normalized=True))
    assert len(document['_files']) == 1
    assert hashlib.sha256(next(iter(document['_files'].values()))).hexdigest() == expected
    print(f'near-limit ZIP bytes={len(payload)}; peak RSS={resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}',flush=True)
    db.session.query(AccountSetImport).delete()
    db.session.commit()
    selection = {'months':['2026-06'], 'categories':['attendance','archives']}
    preview = build_multi_preview(document,selection)
    assert not preview['blockers']
    result = timed('90 MiB archive restore',lambda: restore_multi_backup(document,selection,{},preview['fingerprint'],1))
    assert result['counts']['new'] == 1
    restored_path = Path(AccountSetImport.query.one().stored_path)
    assert restored_path != path and restored_path.stat().st_size == 90*1024*1024
    assert hashlib.sha256(restored_path.read_bytes()).hexdigest() == expected
    del payload,document
    with restored_path.open('wb') as file: file.truncate(100*1024*1024+1)
    with pytest.raises(BackupError,match='100 MiB|大小限制'):
        export_multi_backup([1],['attendance','archives'])
    with pytest.raises(BackupError,match='100 MiB'):
        read_backup(b'x'*(100*1024*1024+1))
