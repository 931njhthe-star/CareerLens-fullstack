"""Original API contract, real thread scheduling, no database/model requests."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from email.message import Message
from io import BytesIO
import json
import os
from pathlib import Path
from threading import Barrier, Lock
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit, parse_qs
from unittest.mock import patch
from uuid import UUID

import pytest
from werkzeug.exceptions import Unauthorized

import server
from job_catalog_service import JobCatalogService


def identifier(number):
    return str(UUID(int=number + 1))


class Response:
    code = 200
    def __init__(self, value):
        self.value = value
        self.headers = Message()
        self.headers["Content-Type"] = "application/json"
    def read(self): return json.dumps(self.value).encode()
    def __enter__(self): return self
    def __exit__(self, *_): return False


class OriginalApi:
    def __init__(self, count=100, latency=0.003):
        self.rows = [{"id": identifier(index), "company_id": identifier(1000 + index % 20),
                      "title": f"현재 공고 {index}", "career_min_months": 12}
                     for index in range(count)]
        self.calls = []
        self.lock = Lock()
        self.active = 0
        self.peak = 0
        self.fail = None
        self.latency = latency
        self.bulk = False
        self.detail_text = "서버의 현재 원문"

    def open(self, req, timeout):
        path = urlsplit(req.full_url).path.removeprefix("/api/v1/")
        with self.lock:
            self.calls.append((path, req.get_header("Authorization")))
            self.active += 1
            self.peak = max(self.peak, self.active)
        try:
            time.sleep(self.latency)
            if self.fail == path:
                raise HTTPError(req.full_url, 503, "private diagnostic", {}, BytesIO(b"secret"))
            if path == "me":
                if req.get_header("Authorization") != "Bearer member":
                    raise HTTPError(req.full_url, 401, "private", {}, BytesIO(b"secret"))
                return Response({"user_id": identifier(5000)})
            if path == "jobs":
                query = parse_qs(urlsplit(req.full_url).query)
                start = int(query.get("offset", [0])[0])
                rows = deepcopy(self.rows[start:start + int(query.get("limit", [20])[0])])
                if self.bulk:
                    for row in rows:
                        row.update(description="이미 완전한 원문", companies={"name": "현재 기업"})
                return Response(rows)
            if path.startswith("jobs/"):
                row = next(item for item in self.rows if item["id"] == path[5:])
                return Response({**row, "description": self.detail_text, "location": "부산",
                                 "requirements": ["실제 기술"], "employment_type": "정규직"})
            if path.startswith("companies/"):
                return Response({"name": "실제 회사 " + path[10:]})
            raise AssertionError(path)
        finally:
            with self.lock: self.active -= 1


@pytest.fixture
def setup():
    upstream = OriginalApi()
    with patch.dict(os.environ, {}, clear=True), patch("server.build_opener", return_value=upstream):
        app = server.create_app("https://api.example.test")
    yield upstream, app
    app.extensions["job_catalog"].pool.shutdown(wait=True, cancel_futures=True)


PATH = "/api/v1/jobs?limit=100&include_details=true"
HEADERS = {"Authorization": "Bearer member"}


def test_original_summary_api_cold_100_are_bounded_and_company_calls_are_deduplicated(setup):
    upstream, app = setup
    result = app.test_client().get(PATH, headers=HEADERS)
    assert result.status_code == 200
    assert len(result.json) == 100
    assert result.json[99]["id"] == identifier(99)
    assert result.json[99]["location"] == "부산"
    assert result.json[99]["description"] == "서버의 현재 원문"
    assert result.json[99]["companies"]["name"].startswith("실제 회사")
    assert 4 < upstream.peak <= 16
    assert sum(path.startswith("jobs/") for path, _ in upstream.calls) == 100
    assert sum(path.startswith("companies/") for path, _ in upstream.calls) == 20
    assert result.headers["Cache-Control"] == "no-store"


def test_reentry_and_new_browser_reload_validate_auth_and_summary_without_rehydrating(setup):
    upstream, app = setup
    first = app.test_client().get(PATH, headers=HEADERS).json
    for _ in range(2):
        upstream.calls.clear()
        result = app.test_client().get(PATH, headers=HEADERS)
        assert result.json == first
        assert [path for path, _ in upstream.calls] == ["me", "jobs"]


def test_current_summary_change_addition_and_deletion_invalidate_only_needed_details(setup):
    upstream, app = setup
    browser = app.test_client()
    browser.get(PATH, headers=HEADERS)
    upstream.calls.clear()
    upstream.rows.pop()
    upstream.rows[0]["title"] = "수정된 공고"
    result = browser.get(PATH, headers=HEADERS)
    assert len(result.json) == 99
    assert result.json[0]["title"] == "수정된 공고"
    assert all(row["id"] != identifier(99) for row in result.json)
    assert sum(path.startswith("jobs/") for path, _ in upstream.calls) == 1


def test_expiry_reloads_details_and_cache_capacity_is_bounded(setup):
    upstream, app = setup
    service = app.extensions["job_catalog"]
    service.ttl = -1
    service.max_entries = 7
    app.test_client().get(PATH, headers=HEADERS)
    assert len(service.cache) == 7
    upstream.calls.clear()
    app.test_client().get(PATH, headers=HEADERS)
    assert sum(path.startswith("jobs/") for path, _ in upstream.calls) == 100


def test_cached_catalog_never_bypasses_live_membership_or_missing_bearer(setup):
    upstream, app = setup
    browser = app.test_client()
    browser.get(PATH, headers=HEADERS)
    upstream.calls.clear()
    for headers in ({}, {"Authorization": "Bearer expired"}):
        response = browser.get(PATH, headers=headers)
        assert response.status_code == 401
        assert "secret" not in response.text
    assert all(path == "me" for path, _ in upstream.calls)


def test_failed_page_is_not_cached_and_retry_recovers(setup):
    upstream, app = setup
    upstream.fail = "jobs/" + identifier(5)
    response = app.test_client().get(PATH, headers=HEADERS)
    assert response.status_code == 503
    assert "private" not in response.text and "secret" not in response.text
    assert not app.extensions["job_catalog"].cache
    upstream.fail = None
    assert app.test_client().get(PATH, headers=HEADERS).status_code == 200


def test_complete_upstream_bulk_payload_does_not_generate_detail_requests(setup):
    upstream, app = setup
    upstream.bulk = True
    result = app.test_client().get(PATH, headers=HEADERS)
    assert result.status_code == 200
    assert [path for path, _ in upstream.calls] == ["me", "jobs"]


def test_offset_and_page_order_are_preserved(setup):
    upstream, app = setup
    result = app.test_client().get(PATH + "&offset=97", headers=HEADERS)
    assert [row["id"] for row in result.json] == [identifier(97), identifier(98), identifier(99)]


def test_selected_detail_bypasses_cached_catalog_and_reads_current_document(setup):
    upstream, app = setup
    browser = app.test_client()
    browser.get(PATH, headers=HEADERS)
    upstream.detail_text = "선택 시 변경된 원문"
    upstream.calls.clear()
    result = browser.get("/api/v1/jobs/" + identifier(0), headers=HEADERS)
    assert result.status_code == 200
    assert result.json["description"] == "선택 시 변경된 원문"
    assert [path for path, _ in upstream.calls] == ["jobs/" + identifier(0)]


def test_jobs_without_opt_in_preserve_original_summary_route(setup):
    upstream, app = setup
    result = app.test_client().get("/api/v1/jobs?limit=2", headers=HEADERS)
    assert result.status_code == 200
    assert len(result.json) == 2
    assert "description" not in result.json[0]
    assert [path for path, _ in upstream.calls] == ["jobs"]


@pytest.mark.parametrize("query", ["limit=101", "offset=-1", "company_id=not-uuid"])
def test_invalid_pagination_never_calls_backend(setup, query):
    upstream, app = setup
    result = app.test_client().get("/api/v1/jobs?include_details=true&" + query, headers=HEADERS)
    assert result.status_code == 422
    assert not upstream.calls


def test_simultaneous_same_owner_requests_singleflight_the_full_catalog(setup):
    upstream, app = setup
    barrier = Barrier(4)
    def read():
        barrier.wait()
        return app.test_client().get(PATH, headers=HEADERS).json
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: read(), range(4)))
    assert all(len(rows) == 100 for rows in results)
    assert sum(path == "me" for path, _ in upstream.calls) == 4
    assert sum(path == "jobs" for path, _ in upstream.calls) == 1
    assert sum(path.startswith("jobs/") for path, _ in upstream.calls) == 100


def test_distinct_accounts_keep_cache_isolated_and_share_global_detail_capacity():
    upstream = OriginalApi(count=32)
    service = JobCatalogService("https://api.example.test", upstream, lambda bearer: bearer.removeprefix("Bearer "))
    try:
        barrier = Barrier(3)
        def read(owner):
            barrier.wait()
            return service.page("limit=100", "Bearer " + owner)
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(read, ["owner-a", "owner-b", "owner-c"]))
        assert all(len(rows) == 32 for rows in results)
        assert len(service.cache) == 96
        # Three summary reads can overlap the shared sixteen detail workers.
        assert upstream.peak <= 19
        assert {key[0] for key in service.cache} == {"owner-a", "owner-b", "owner-c"}
        assert all("Bearer" not in repr(key) for key in service.cache)
    finally:
        service.pool.shutdown(wait=True, cancel_futures=True)


def test_deployment_copies_and_allows_the_frontend_compatibility_module():
    folder = Path(__file__).parents[1] / "infra" / "deploy"
    assert "CareerLens-frontend/job_catalog_service.py" in (folder / "Dockerfile").read_text()
    assert "!CareerLens-frontend/job_catalog_service.py" in (folder / "Dockerfile.dockerignore").read_text()
