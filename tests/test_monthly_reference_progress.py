"""Real snapshot work reports progress without changing transactional guarantees."""
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import event

from models import db
from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
from models.user import User
from routes.auth_helpers import generate_token
from tests.test_account_set_backup import backup_app
from tests.test_account_set_backup_api import logged_in

BASE = '/api/admin/monthly-references'


def test_progress_counts_actual_capture_rows_and_preview_rolls_back(backup_app):
    from services.monthly_reference_management_service import preview_reference_operation
    backup_app.config['SECRET_KEY'] = 'synthetic-progress-secret'
    events = []
    result, _ = preview_reference_operation('2026-06', {'action': 'capture'}, progress=lambda **work: events.append(work))
    assert len(result['changes']) == 2
    assert MonthlyReferenceSnapshot.query.count() == 0
    writes = [row for row in events if row['phase'] == 'write']
    assert [(row['completed'], row['total']) for row in writes] == [(0, 2), (1, 2), (2, 2)]
    assert all(row.get('status') != 'completed' for row in events)


@pytest.mark.parametrize('path', ['', '/2026-06?summary=1', '/2026-06/preview'])
def test_routes_preserve_response_and_complete_progress(backup_app, path):
    client = logged_in(backup_app)
    method = client.post if path.endswith('preview') else client.get
    kwargs = {'json': {'action': 'rebuild'}} if path.endswith('preview') else {}
    original = method(BASE + path, **kwargs)
    token = 'a' * 32
    tracked = method(BASE + path + ('&' if '?' in path else '?') + 'progress_token=' + token, **kwargs)
    assert tracked.status_code == original.status_code == 200
    assert tracked.get_json() == original.get_json()
    progress = client.get(BASE + '/progress?progress_token=' + token).get_json()
    assert set(progress) == {'status', 'phase', 'stage', 'completed', 'total', 'percent'}
    assert progress['status'] == 'completed'
    assert progress['percent'] == 100
    assert MonthlyReferenceSnapshot.query.count() == 0


def test_apply_commit_failure_rolls_back_and_never_completes(backup_app, monkeypatch):
    from services import monthly_reference_progress_service as progress_service
    client = logged_in(backup_app)
    operation = {'action': 'capture'}
    compared = client.post(BASE + '/2026-06/preview', json=operation).get_json()
    token = 'b' * 32
    observed = []
    original_start = progress_service.start_reference_progress
    def tracked_start(*args):
        update = original_start(*args)
        def tracked(**work):
            observed.append(work)
            update(**work)
        return tracked
    monkeypatch.setattr(progress_service, 'start_reference_progress', tracked_start)
    def reject_commit(session):
        raise RuntimeError('synthetic commit failure')
    event.listen(db.session(), 'before_commit', reject_commit)
    try:
        with pytest.raises(RuntimeError, match='synthetic commit failure'):
            client.post(BASE + '/2026-06/apply?progress_token=' + token,
                        json={**operation, 'fingerprint': compared['fingerprint']})
    finally:
        event.remove(db.session(), 'before_commit', reject_commit)
    assert MonthlyReferenceSnapshot.query.count() == 0
    progress = client.get(BASE + '/progress?progress_token=' + token).get_json()
    assert progress['status'] == 'failed'
    assert progress['percent'] is None
    assert not any(row.get('status') == 'completed' for row in observed)


def test_progress_owner_reuse_stale_cleanup_and_indeterminate(backup_app):
    from services.monthly_reference_progress_service import (
        get_reference_progress, progress_path, start_reference_progress,
    )
    token, foreign, expired = 'c' * 32, 'd' * 32, 'e' * 32
    update = start_reference_progress(token, 1)
    assert get_reference_progress(token, 1)['percent'] is None
    update(phase='write', stage='写入快照', completed=1, total=2)
    assert get_reference_progress(token, 1)['percent'] == 50
    with pytest.raises(ValueError):
        get_reference_progress(token, 2)
    with pytest.raises(ValueError):
        start_reference_progress(token, 1)
    start_reference_progress(foreign, 2)
    start_reference_progress(expired, 1)
    for old in (foreign, expired):
        path = progress_path(old)
        payload = json.loads(path.read_text())
        payload['updated_at'] = time.time() - 7200
        path.write_text(json.dumps(payload))
        os.utime(path, (time.time() - 7200,) * 2)
    start_reference_progress('f' * 32, 1)
    assert progress_path(foreign).exists()
    assert not progress_path(expired).exists()
    with pytest.raises(ValueError):
        get_reference_progress(foreign, 1)


def test_atomic_claim_allows_only_one_worker(backup_app):
    from services.monthly_reference_progress_service import start_reference_progress
    def claim(_):
        with backup_app.app_context():
            try:
                start_reference_progress('1' * 32, 1)
                return True
            except ValueError:
                return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(claim, range(2))) == [False, True]


def test_progress_endpoint_is_admin_only_and_validates_tokens(backup_app):
    client = logged_in(backup_app)
    assert client.get(BASE + '/progress?progress_token=invalid').status_code == 400
    assert client.get(BASE + '/progress?progress_token=' + '0' * 32).get_json()['status'] == 'idle'
    assert client.get(BASE + '?progress_token=invalid').status_code == 400
    user = User(username='progress-reader', role='viewer', password_hash='unused')
    db.session.add(user)
    db.session.commit()
    client.delete_cookie('access_token')
    assert client.get(BASE + '/progress?progress_token=' + '0' * 32,
                      headers={'Authorization': 'Bearer ' + generate_token(user)}).status_code == 403


def test_successful_apply_completes_only_after_commit(backup_app):
    from services.monthly_reference_progress_service import get_reference_progress
    client = logged_in(backup_app)
    compared = client.post(BASE + '/2026-06/preview', json={'action': 'capture'}).get_json()
    token = '2' * 32
    seen = []
    def observe_commit(session):
        seen.append(get_reference_progress(token, 1))
    event.listen(db.session(), 'before_commit', observe_commit)
    try:
        response = client.post(BASE + '/2026-06/apply?progress_token=' + token,
                               json={'action': 'capture', 'fingerprint': compared['fingerprint']})
    finally:
        event.remove(db.session(), 'before_commit', observe_commit)
    assert response.status_code == 200
    assert response.get_json()['changed_count'] == 2
    assert MonthlyReferenceSnapshot.query.count() == 2
    assert seen and all(row['status'] == 'running' and row['phase'] == 'commit' and row['percent'] is None for row in seen)
    assert get_reference_progress(token, 1)['status'] == 'completed'


def test_failed_progress_clears_completed_phase_percentage(backup_app):
    from services.monthly_reference_progress_service import get_reference_progress, start_reference_progress
    update = start_reference_progress('3' * 32, 1)
    update(phase='write', stage='暂存快照写入', completed=2, total=2)
    update(status='failed', stage='快照任务失败')
    assert get_reference_progress('3' * 32, 1)['percent'] is None


def test_capture_progress_never_claims_a_row_before_it_is_staged(backup_app):
    from services.monthly_reference_management_service import execute_operation, reference_detail
    missing = reference_detail('2026-06', include_evidence=False)['missing']
    observed = []
    def observe(**work):
        if work['phase'] == 'write':
            observed.append((work['completed'], len(db.session.new)))
    execute_operation('2026-06', {'action': 'capture'}, missing, progress=observe)
    assert observed == [(0, 0), (1, 1), (2, 2)]
    db.session.rollback()
