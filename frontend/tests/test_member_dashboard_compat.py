"""Member dashboard against only the untouched backend's ownership APIs."""
from datetime import datetime, timezone
from io import BytesIO
import json
import os
from unittest.mock import patch
from urllib.error import HTTPError
from uuid import UUID

import pytest
import server

RUN = "10000000-0000-4000-8000-000000000001"

class Response:
    code = 200
    def __init__(self, value): self.value = value
    def read(self): return json.dumps(self.value).encode()
    def __enter__(self): return self
    def __exit__(self, *_): return False

class Opener:
    def __init__(self, result=None, status=None):
        self.result = result
        self.status = status
        self.calls = []
    def open(self, req, timeout):
        self.calls.append(req)
        if self.status:
            raise HTTPError(req.full_url, self.status, "private diagnostic", {}, BytesIO(b"private"))
        return Response(self.result)

def client(opener):
    with patch.dict(os.environ, {}, clear=True), patch("server.build_opener", return_value=opener):
        return server.create_app("https://api.example.test").test_client()

def row(**extra):
    return {"id": RUN, "status": "completed", "created_at": datetime.now(timezone.utc).isoformat(), **extra}

@pytest.mark.parametrize("path", ["", "/" + RUN])
def test_guest_denied_before_any_upstream_request(path):
    opener = Opener([])
    response = client(opener).get("/api/v1/admin/evaluation-performance" + path)
    assert response.status_code == 401
    assert not opener.calls


def test_member_route_avoids_integrated_backend_admin_path():
    opener = Opener([row()])
    response = client(opener).get(
        "/api/v1/member/evaluation-performance?run_limit=100",
        headers={"Authorization": "Bearer fixture-token"},
    )
    assert response.status_code == 200
    assert response.json["scope"]["mode"] == "account"
    assert opener.calls[0].full_url == "https://api.example.test/api/v1/evaluations?limit=100&offset=0"


def test_member_uses_existing_owned_list_not_administrator_route():
    opener = Opener([row(user_id="private-owner", original_text="private-resume", token="private-token")])
    response = client(opener).get("/api/v1/admin/evaluation-performance?run_limit=100", headers={"Authorization": "Bearer synthetic-member"})
    assert response.status_code == 200
    assert response.json["scope"]["mode"] == "account"
    assert response.json["summary"]["run_count"] == 1
    assert response.json["runs"][0]["id"] == RUN
    assert "private" not in response.text
    assert opener.calls[0].full_url == "https://api.example.test/api/v1/evaluations?limit=100&offset=0"
    assert opener.calls[0].get_header("Authorization") == "Bearer synthetic-member"

@pytest.mark.parametrize("status", [401, 403, 404, 429])
def test_detail_preserves_backend_ownership_denial(status):
    opener = Opener(status=status)
    response = client(opener).get("/api/v1/admin/evaluation-performance/" + RUN, headers={"Authorization": "Bearer synthetic-member"})
    assert response.status_code == status
    assert "private" not in response.text
    assert opener.calls[0].full_url.endswith("/evaluations/" + RUN)

def test_detail_does_not_invent_or_disclose_missing_metrics():
    opener = Opener(row(failure_reason="private diagnostic", original_text="private resume"))
    response = client(opener).get("/api/v1/admin/evaluation-performance/" + RUN, headers={"Authorization": "Bearer synthetic-member"})
    assert response.status_code == 200
    result = response.json["run"]
    assert result["availability"]["llm"]["status"] == "unsupported"
    assert "stages" not in result and "scores" not in result and "usage" not in result
    assert "private" not in response.text

def test_list_limit_validation_and_backend_errors():
    opener = Opener(status=500)
    browser = client(opener)
    assert browser.get("/api/v1/admin/evaluation-performance?run_limit=201").status_code == 422
    assert not opener.calls
    response = browser.get("/api/v1/admin/evaluation-performance", headers={"Authorization": "Bearer synthetic-member"})
    assert response.status_code == 503
    assert "private" not in response.text
