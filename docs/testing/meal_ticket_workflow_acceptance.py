"""Opt-in isolated route acceptance, using disposable SQLite and real admins."""
import tests.test_meal_ticket_followup as helpers


def test_two_admin_snapshots_cannot_overwrite_declared_operation():
    from models import db
    from models.user import User
    from models.meal_ticket import MealTicketPayment
    from routes.auth_helpers import generate_token
    fixture = helpers.FollowupFundsIntegrationTests()
    fixture.setUp()
    try:
        snapshot = fixture.prepare(enabled=False)
        with fixture.app.app_context():
            other = User(username='second-admin', role='admin', password_hash='synthetic')
            db.session.add(other)
            db.session.commit()
            other_token = generate_token(other)
        task = snapshot['tasks'][0]
        body = {'batch_id':snapshot['batch_id'], 'version':snapshot['batch_version'],
            'task_version':task['version'], 'action':'complete', 'request_key':'second-admin-complete'}
        first = fixture.progress(snapshot, task, 'complete')
        assert first.status_code == 200
        second = fixture.client.post('/api/meal-tickets/followup-tasks/' + task['key'] + '/progress',
            json=body, headers={'Authorization':'Bearer ' + other_token})
        assert second.status_code == 409
        current = fixture.queue()
        assert [(t['kind'],t['status']) for t in current['tasks']] == [('recharge','awaiting'),('refund','pending')]
        assert fixture.batch()['items'][0]['paid_amount'] == 176
        with fixture.app.app_context():
            assert MealTicketPayment.query.count() == 1
    finally:
        fixture.tearDown()
