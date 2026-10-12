"""Guest privacy, ownership and concurrency tests; no network/model calls."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import sqlite3
import threading
import time

from flask import Flask
import pytest
from werkzeug.exceptions import ServiceUnavailable

from guest_analysis_service import COOKIE, PREFIX, create_guest_blueprint, append_flow_event, read_flow_events


JOB = {"id": "backup-005", "title": "Synthetic role", "company_name": "Synthetic Co", "description": "Private job text"}
RESULT = {"status": "completed", "report_text": "Private computed report", "scores": {"overall_score": 73.5},
          "criteria": [{"score": 73.5}], "report_data": {"criteria": {}},
          "created_at": "2026-10-12T00:00:00+00:00", "completed_at": "2026-10-12T00:01:00+00:00"}


@pytest.fixture
def setup_service(tmp_path):
    services = []
    releases = []

    def factory(runner=None, **options):
        async def normal(resume, job, run_id, on_progress, is_cancelled):
            await on_progress("criterion", 62)
            return {**RESULT, "run_id": run_id}
        path = options.pop("path", tmp_path / f"guest-{len(services)}.sqlite3")
        verify = options.pop("verify", lambda token: {"Bearer member-a": "user-a", "Bearer member-b": "user-b"}.get(token))
        blueprint = create_guest_blueprint(path, lambda ident: JOB if ident == JOB["id"] else None,
                                          verify, runner=runner or normal, available=lambda: True, **options)
        app = Flask(f"guest-test-{len(services)}")
        app.register_blueprint(blueprint)
        service = blueprint.guest_service
        services.append(service)
        return app, app.test_client(), service

    factory.releases = releases
    yield factory
    for event in releases:
        event.set()
    for service in services:
        service.shutdown()


def start(client, key="first", **payload):
    return client.post(PREFIX + "/analyses", json={"resume_text": "Private resume input", "job_id": JOB["id"], **payload}, headers={"Idempotency-Key": key})


def wait_for(client, run_id, expected=("completed", "partial", "failed", "cancelled")):
    until = time.monotonic() + 3
    while time.monotonic() < until:
        response = client.get(PREFIX + "/analyses/" + run_id)
        if response.status_code != 200 or response.json["status"] in expected:
            return response
        time.sleep(.01)
    raise AssertionError("Synthetic worker did not finish")


def claim(client, run_id, user="member-a"):
    return client.post(PREFIX + f"/analyses/{run_id}/claim", json={}, headers={"Authorization": "Bearer " + user})


def test_capabilities_does_not_create_db_or_worker(setup_service):
    _, client, service = setup_service()
    assert client.get(PREFIX + "/capabilities").json["available"] is True
    assert client.get_cookie(COOKIE, path=PREFIX).http_only
    assert not service.path.exists()
    assert service._executor is None


def test_cancel_unknown_creation_stops_accepted_or_late_request(setup_service):
    _, client, service = setup_service()
    client.get(PREFIX + "/capabilities")
    cancelled = client.post(PREFIX + "/analyses/cancel-pending", json={"idempotency_key": "late"})
    assert cancelled.status_code == 200
    assert start(client, key="late").status_code == 409
    assert service._executor is None
    created = start(client, key="accepted")
    ident = created.json["run_id"]
    assert client.post(PREFIX + "/analyses/cancel-pending", json={"idempotency_key": "accepted"}).status_code == 200
    assert wait_for(client, ident).json["status"] == "cancelled"
    assert claim(client, ident).status_code == 409


def test_private_progress_then_claim_and_owner_only_storage(setup_service):
    app, client, service = setup_service()
    response = start(client)
    assert response.status_code == 202
    assert "HttpOnly" in response.headers["Set-Cookie"]
    assert "SameSite=Strict" in response.headers["Set-Cookie"]
    ident = response.json["run_id"]
    locked = wait_for(client, ident)
    assert locked.json["completed"] is True
    assert locked.json["report_locked"] is True
    assert locked.headers["Cache-Control"] == "no-store"
    assert not {"scores", "report_text", "report_data", "resume_text", "job_snapshot", "owner_user_id"} & locked.json.keys()
    assert app.test_client().get(PREFIX + "/analyses/" + ident).status_code == 404
    assert claim(client, ident, "invalid").status_code == 401
    report = claim(client, ident)
    assert report.status_code == 200
    assert report.json["scores"] == RESULT["scores"]
    assert report.json["resume_text"] == "Private resume input"
    assert report.json["job_snapshot"] == JOB
    assert report.json["criteria"] == RESULT["criteria"]
    assert report.json["storage_origin"] == "frontend_guest"
    assert report.json["owner_user_id"] == "user-a"
    assert claim(client, ident).json == report.json
    assert claim(client, ident, "member-b").status_code == 409
    stranger = app.test_client()
    assert stranger.get(PREFIX + "/reports/" + ident, headers={"Authorization": "Bearer member-b"}).status_code == 404
    listing = stranger.get(PREFIX + "/reports", headers={"Authorization": "Bearer member-a"}).json["reports"]
    assert len(listing) == 1 and listing[0]["title"] == JOB["title"]
    assert "report_text" not in listing[0] and "resume_text" not in listing[0]
    with service.connect() as db:
        row = db.execute("SELECT guest_hash FROM guest_analyses").fetchone()
    assert row[0] != client.get_cookie(COOKIE, path=PREFIX).value


def test_completion_requires_persisted_result_not_progress_or_elapsed_time(setup_service):
    release = threading.Event()
    reached_last_progress = threading.Event()
    setup_service.releases.append(release)

    async def runner(resume, job, ident, progress, cancelled):
        await progress("completed", 100, {"node": "guest_store", "state": "complete"})
        reached_last_progress.set()
        while not release.is_set():
            await asyncio.sleep(.005)
        return RESULT

    _, client, service = setup_service(runner)
    ident = start(client).json["run_id"]
    assert reached_last_progress.wait(1)
    pending = client.get(PREFIX + "/analyses/" + ident).json
    assert pending["status"] == "running"
    assert pending["completed"] is False
    assert pending["progress_percent"] == 99
    assert pending["flow_events"] == [], "Runner completion cannot claim the result was persisted"
    assert pending["analysis_duration_ms"] is None
    assert claim(client, ident).status_code == 409
    with service.connect() as db:
        assert db.execute("SELECT result FROM guest_analyses WHERE id=?", (ident,)).fetchone()[0] is None
    release.set()
    completed = wait_for(client, ident).json
    assert completed["completed"] is True
    assert completed["progress_percent"] == 100
    assert completed["flow_events"] == [{"id": 1, "node": "guest_store", "state": "complete"}]
    assert completed["analysis_duration_ms"] >= 0
    with service.connect() as db:
        stored = json.loads(db.execute("SELECT result FROM guest_analyses WHERE id=?", (ident,)).fetchone()[0])
    assert stored["report_text"] == RESULT["report_text"]
    assert stored["scores"] == RESULT["scores"]


def test_guest_telemetry_strips_payloads_and_keeps_only_measured_callback_metadata(setup_service):
    async def runner(resume, job, ident, progress, cancelled):
        await progress("parsing", 5, {"node": "parse_resume", "state": "running", "resume": resume, "run_id": ident})
        await progress("parsing", 8, {"node": "parse_resume", "state": "complete", "durationMs": 8.25, "report": RESULT})
        await progress("criterion", 20, {"node": "domain_a", "state": "running", "criterion": "A1", "message": resume})
        await progress("criterion", 21, {"node": "domain_a", "state": "running", "criterion": "A1"})
        await progress("criterion", 22, {"node": "domain_a", "state": "complete", "criterion": "A1", "durationMs": float("nan")})
        await progress("criterion", 30, {"node": "database", "state": "complete"})
        await progress("criterion", 30, {"node": "domain_a", "state": "complete", "criterion": "B1"})
        return RESULT
    _, client, _ = setup_service(runner)
    ident = start(client).json["run_id"]
    data = wait_for(client, ident).json
    assert data["flow_events"] == [
        {"id": 1, "node": "parse_resume", "state": "running"},
        {"id": 2, "node": "parse_resume", "state": "complete", "durationMs": 8.25},
        {"id": 3, "node": "domain_a", "state": "running", "criterion": "A1"},
        {"id": 4, "node": "domain_a", "state": "complete", "criterion": "A1"},
        {"id": 5, "node": "guest_store", "state": "complete"},
    ]
    assert "Private" not in json.dumps(data["flow_events"])
    assert "database" not in json.dumps(data["flow_events"])


def test_guest_telemetry_history_is_bounded_with_monotonic_ids():
    serialized = "[]"
    for number in range(150):
        serialized = append_flow_event(serialized, {"node": "validation", "state": "running" if number % 2 == 0 else "complete"})
    events = read_flow_events(serialized)
    assert len(events) == 100
    assert [row["id"] for row in events] == list(range(51, 151))
    assert read_flow_events('{"private":"text"}') == []
    for invalid in [{"node": {}, "state": "complete"}, {"node": "validation", "state": []},
                    {"node": "domain_a", "state": "complete", "criterion": {}}]:
        assert read_flow_events(json.dumps([{"id": 1, **invalid}])) == []


def test_idempotency_and_changed_input_conflict(setup_service):
    calls = []
    async def runner(resume, job, ident, progress, cancelled):
        calls.append(ident)
        return RESULT
    _, client, _ = setup_service(runner)
    first = start(client)
    wait_for(client, first.json["run_id"])
    assert start(client).json["run_id"] == first.json["run_id"]
    assert start(client, resume_text="Changed input").status_code == 409
    assert len(calls) == 1


def test_cancelled_or_deleted_job_never_resurrects(setup_service):
    release = threading.Event()
    entered = threading.Event()
    setup_service.releases.append(release)
    async def runner(*args):
        entered.set()
        while not release.is_set():
            await asyncio.sleep(.005)
        return RESULT  # Simulates a provider which returned just after cancel.
    _, client, service = setup_service(runner)
    ident = start(client).json["run_id"]
    assert entered.wait(1)
    assert client.post(PREFIX + f"/analyses/{ident}/cancel", json={}).json["status"] == "cancelled"
    assert client.delete(PREFIX + f"/analyses/{ident}").status_code == 204
    release.set()
    service.shutdown()
    assert client.get(PREFIX + f"/analyses/{ident}").status_code == 404
    with service.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM guest_analyses").fetchone()[0] == 0


def test_global_capacity_and_one_active_per_cookie(setup_service):
    release = threading.Event()
    setup_service.releases.append(release)
    async def runner(*args):
        while not release.is_set():
            await asyncio.sleep(.005)
        return RESULT
    app, first, _ = setup_service(runner, max_active=1, max_queued=1)
    assert start(first).status_code == 202
    assert start(first, "second").status_code == 429
    assert start(app.test_client()).status_code == 202
    assert start(app.test_client()).status_code == 429
    release.set()


def test_expiry_and_no_late_result_resurrection(setup_service):
    release = threading.Event()
    entered = threading.Event()
    setup_service.releases.append(release)
    async def runner(*args):
        entered.set()
        while not release.is_set():
            await asyncio.sleep(.005)
        return RESULT
    _, client, service = setup_service(runner)
    ident = start(client).json["run_id"]
    assert entered.wait(1)
    service._clock = lambda: time.time() + 1900
    assert client.get(PREFIX + f"/analyses/{ident}").status_code == 410
    release.set()
    service.shutdown()
    assert client.get(PREFIX + f"/analyses/{ident}").status_code == 404


def test_fixed_expiry_is_not_extended_by_new_run(setup_service):
    _, client, service = setup_service()
    first = start(client)
    wait_for(client, first.json["run_id"])
    service._clock = lambda: time.time() + 300
    second = start(client, "second")
    assert second.json["expires_at"] == first.json["expires_at"]


def test_claimed_report_survives_expiry_and_service_restart(setup_service):
    _, client, service = setup_service()
    ident = start(client).json["run_id"]
    wait_for(client, ident)
    assert claim(client, ident).status_code == 200
    service.shutdown()
    _, new_client, restarted = setup_service(path=service.path)
    restarted._clock = lambda: time.time() + 3600
    response = new_client.get(PREFIX + f"/reports/{ident}", headers={"Authorization": "Bearer member-a"})
    assert response.status_code == 200 and response.json["report_text"] == RESULT["report_text"]
    assert len(new_client.get(PREFIX + "/reports", headers={"Authorization": "Bearer member-a"}).json["reports"]) == 1


def test_old_frontend_store_adds_measurements_without_changing_or_reanalysing_results(setup_service):
    _, client, service = setup_service()
    ident = start(client).json["run_id"]
    wait_for(client, ident)
    cookie = client.get_cookie(COOKIE, path=PREFIX).value
    service.shutdown()
    with sqlite3.connect(service.path) as db:
        saved = db.execute("SELECT result FROM guest_analyses WHERE id=?", (ident,)).fetchone()[0]
        db.execute("ALTER TABLE guest_analyses DROP COLUMN flow_events")
        db.execute("ALTER TABLE guest_analyses DROP COLUMN analysis_duration_ms")
    _, new_client, restarted = setup_service(path=service.path)
    new_client.set_cookie(COOKIE, cookie, path=PREFIX)
    old_run = new_client.get(PREFIX + f"/analyses/{ident}").json
    assert old_run["completed"] is True
    assert old_run["flow_events"] == [] and old_run["analysis_duration_ms"] is None
    assert restarted._executor is None
    assert claim(new_client, ident).json["report_text"] == RESULT["report_text"]
    with restarted.connect() as db:
        assert db.execute("SELECT result FROM guest_analyses WHERE id=?", (ident,)).fetchone()[0] == saved


def test_concurrent_claims_bind_exactly_one_owner(setup_service):
    app, client, _ = setup_service()
    ident = start(client).json["run_id"]
    wait_for(client, ident)
    cookie = client.get_cookie(COOKIE, path=PREFIX).value
    def request_claim(user):
        other = app.test_client()
        other.set_cookie(COOKIE, cookie, path=PREFIX)
        return claim(other, ident, user).status_code
    with ThreadPoolExecutor(2) as pool:
        responses = list(pool.map(request_claim, ["member-a", "member-b"]))
    assert sorted(responses) == [200, 409]


def test_rate_limit_survives_discard(setup_service):
    _, client, _ = setup_service()
    for index in range(3):
        response = start(client, str(index))
        assert response.status_code == 202
        ident = response.json["run_id"]
        wait_for(client, ident)
        assert client.delete(PREFIX + f"/analyses/{ident}").status_code == 204
    assert start(client, "fourth").status_code == 429


def test_origin_content_type_and_input_boundaries(setup_service):
    _, client, _ = setup_service()
    assert client.post(PREFIX + "/analyses", json={}, headers={"Origin": "https://attacker.example"}).status_code == 403
    assert client.post(PREFIX + "/analyses", data="{}").status_code == 415
    assert start(client, resume_text="x" * 50001).status_code == 422
    assert start(client, resume_text="x\0y").status_code == 422
    assert start(client, job_id="not-registered").status_code == 404
    assert start(client, expires_at="2000-01-01T00:00:00Z").status_code == 410
    assert client.post(PREFIX + "/analyses", json={"resume_text": "resume", "job_id": JOB["id"]}).status_code == 400


def test_progress_and_exception_details_never_leak(setup_service):
    async def runner(resume, job, ident, progress, cancelled):
        await progress("Private provider secret", 50)
        raise RuntimeError("Private provider secret")
    _, client, _ = setup_service(runner)
    ident = start(client).json["run_id"]
    response = wait_for(client, ident)
    assert response.json["status"] == "failed"
    assert "Private" not in response.get_data(as_text=True)
    assert claim(client, ident).status_code == 409


def test_timeout_fails_without_persisting_report(setup_service):
    async def runner(*args):
        await asyncio.sleep(5)
        return RESULT
    _, client, _ = setup_service(runner, timeout_seconds=.02)
    ident = start(client).json["run_id"]
    assert wait_for(client, ident).json["status"] == "failed"


def test_verified_owner_delete_removes_only_own_report(setup_service):
    _, client, _ = setup_service()
    ident = start(client).json["run_id"]
    wait_for(client, ident)
    claim(client, ident)
    assert client.delete(PREFIX + f"/reports/{ident}", headers={"Authorization": "Bearer member-b"}).status_code == 404
    assert client.delete(PREFIX + f"/analyses/{ident}").status_code == 409
    assert client.delete(PREFIX + f"/reports/{ident}", headers={"Authorization": "Bearer member-a"}).status_code == 204
    assert client.get(PREFIX + f"/reports/{ident}", headers={"Authorization": "Bearer member-a"}).status_code == 404


def test_auth_outage_does_not_return_private_data(setup_service):
    def unavailable(token):
        raise ServiceUnavailable("PRIVATE upstream response")
    _, client, _ = setup_service(verify=unavailable)
    response = client.get(PREFIX + "/reports", headers={"Authorization": "Bearer member-a"})
    assert response.status_code == 503
    assert "PRIVATE" not in response.get_data(as_text=True)


def test_capability_cookie_makes_concurrent_first_post_idempotent(setup_service):
    calls = []
    async def runner(resume, job, ident, progress, cancelled):
        calls.append(ident)
        return RESULT
    app, client, _ = setup_service(runner)
    client.get(PREFIX + "/capabilities")
    cookie = client.get_cookie(COOKIE, path=PREFIX).value
    def create():
        other = app.test_client()
        other.set_cookie(COOKIE, cookie, path=PREFIX)
        return start(other).json["run_id"]
    with ThreadPoolExecutor(2) as pool:
        ids = list(pool.map(lambda _: create(), range(2)))
    assert ids[0] == ids[1]
    wait_for(client, ids[0])
    assert calls == [ids[0]]


def test_https_cookie_is_secure_and_claim_ignores_forged_user_and_result(setup_service):
    _, client, _ = setup_service()
    response = client.get(PREFIX + "/capabilities", base_url="https://localhost")
    assert "Secure" in response.headers["Set-Cookie"]
    ident = start(client).json["run_id"]
    wait_for(client, ident)
    response = client.post(PREFIX + f"/analyses/{ident}/claim", json={"user_id": "user-b", "report_text": "FORGED"}, headers={"Authorization": "Bearer member-a"})
    assert response.status_code == 200
    assert response.json["report_text"] == RESULT["report_text"]
    assert client.get(PREFIX + f"/reports/{ident}", headers={"Authorization": "Bearer member-b"}).status_code == 404


def test_canonical_job_http_error_is_controlled(setup_service):
    from werkzeug.exceptions import NotFound
    _, client, service = setup_service()
    def missing(ident):
        raise NotFound("PRIVATE fixture path")
    service.fetch_job = missing
    response = start(client)
    assert response.status_code == 404
    assert "PRIVATE" not in response.get_data(as_text=True)


def test_unavailable_runner_cannot_start_analysis(setup_service):
    _, client, service = setup_service()
    service.available = lambda: False
    assert client.get(PREFIX + "/capabilities").json["available"] is False
    assert start(client).status_code == 503
    assert service._executor is None
