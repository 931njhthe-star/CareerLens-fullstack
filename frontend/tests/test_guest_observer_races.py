"""Synthetic cancellation/claim races must not create false shared-flow events."""
from contextlib import contextmanager

import pytest

from guest_analysis_service import PREFIX
from test_guest_analysis_service import setup_service, start, wait_for, RESULT


@pytest.mark.parametrize('operation', ['cancel', 'discard'])
def test_claim_wins_after_guest_lookup_without_false_cancel(setup_service, monkeypatch, operation):
    events = []
    _, client, service = setup_service(observer=lambda *args, **kwargs: events.append((args, kwargs)))
    ident = start(client).json['run_id']
    assert wait_for(client, ident).json['completed']
    original = service.owned_guest

    def claimed_after_lookup(run_id):
        row = original(run_id)
        with service.connect() as db:
            db.execute('UPDATE guest_analyses SET owner_user=? WHERE id=?', ('user-a', run_id))
        return row

    monkeypatch.setattr(service, 'owned_guest', claimed_after_lookup)
    before = len(events)
    response = (client.post(PREFIX + f'/analyses/{ident}/cancel', json={}) if operation == 'cancel'
                else client.delete(PREFIX + f'/analyses/{ident}'))
    assert response.status_code == 409
    assert len(events) == before
    with service.connect() as db:
        row = db.execute('SELECT owner_user,status,result FROM guest_analyses WHERE id=?', (ident,)).fetchone()
    assert row['owner_user'] == 'user-a' and row['status'] == 'completed' and row['result']


@pytest.mark.parametrize('trigger', ["UPDATE guest_analyses SET status='running'", 'UPDATE guest_analyses SET stage=?,progress='])
def test_cancel_wins_conditional_write_without_running_or_success_event(setup_service, monkeypatch, trigger):
    events, called = [], []
    async def runner(resume, job, run_id, progress, cancelled):
        called.append(run_id)
        await progress('evaluation', 50, {'node': 'domain_a', 'state': 'running', 'criterion': 'A1'})
        return RESULT
    _, client, service = setup_service(runner, observer=lambda *args, **kwargs: events.append((args, kwargs)))
    original = service.connect

    @contextmanager
    def cancelling_connection():
        with original() as db:
            class Connection:
                def execute(self, sql, params=()):
                    if sql.startswith(trigger):
                        db.execute("UPDATE guest_analyses SET status='cancelled' WHERE status IN ('queued','running')")
                    return db.execute(sql, params)
            yield Connection()

    monkeypatch.setattr(service, 'connect', cancelling_connection)
    ident = start(client).json['run_id']
    assert wait_for(client, ident).json['status'] == 'cancelled'
    service.shutdown()
    assert not any(args[1] == 'analysis' and fields.get('progress') == 50 for args, fields in events)
    assert not any(args[1] == 'guest_store' or (args[1] == 'analysis' and args[2] == 'complete') for args, _ in events)
    if "status='running'" in trigger:
        assert called == []
