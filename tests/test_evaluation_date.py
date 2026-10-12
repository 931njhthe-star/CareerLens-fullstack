from datetime import datetime, timezone

import pytest

from app.application.evaluation import evaluation_as_of


@pytest.mark.parametrize('timestamp', [
    datetime(2026, 10, 12, 23, 35, tzinfo=timezone.utc),
    '2026-10-12T23:35:00Z',
    '2026-10-12T23:35:00+00:00',
])
def test_postgres_and_json_snapshot_dates_use_same_korean_date(timestamp):
    assert evaluation_as_of(timestamp) == '2026-10-13'
