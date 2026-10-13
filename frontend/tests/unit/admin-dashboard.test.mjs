import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminAccessDenied,
  adminDashboard,
  mountAdminDashboard,
} from '../../src/pages/admin-dashboard.js';
import {
  renderPerformanceView,
  renderRunDetail,
  overviewCards,
  renderFlowEntry,
} from '../../src/features/admin/dashboard-view.js';
import {
  normalizePerformance,
  overviewCounts,
  formatDuration,
  scoreDisplay,
  filterRuns,
} from '../../src/features/admin/performance-data.js';

const payload = (runs = []) => ({
  summary: { run_count: 999, avg_total_ms: 0, p95_total_ms: 1300 },
  stages: [],
  runs: runs.map((run) => ({ created_at: new Date().toISOString(), ...run })),
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test('member flow entry launches a separate observer bound to the current work tab', () => {
  const linked = renderFlowEntry('/?view=flow&stream=tab-stream');
  assert.match(linked, /href="\/\?view=flow&amp;stream=tab-stream"/);
  assert.doesNotMatch(linked, /target="_blank"|로그인 없이/);
  assert.match(linked, /현재 작업 창 하나/);
  assert.match(linked, /data-admin-flow/);
  assert.match(renderFlowEntry(null), /href="\/\?view=flow"/);
});

function harness() {
  const content = {
    innerHTML: '',
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
  const announcement = { textContent: '' };
  const refresh = { disabled: false };
  const handlers = new Map();
  const nodes = new Map([
    ['[data-admin-content]', content],
    ['[data-admin-announcement]', announcement],
    ['[data-admin-refresh]', refresh],
  ]);
  const root = {
    innerHTML: '',
    matches: (selector) => selector === '[data-admin-dashboard]',
    querySelector: (selector) => nodes.get(selector),
    addEventListener: (type, handler) => handlers.set(type, handler),
    removeEventListener: (type, handler) => {
      if (handlers.get(type) === handler) handlers.delete(type);
    },
  };
  const change = (selector, value) =>
    handlers.get('change')?.({ target: { matches: (candidate) => candidate === selector, value } });
  const click = (selector, element = {}) =>
    handlers.get('click')?.({
      target: { closest: (candidate) => (candidate === selector ? element : null) },
    });
  return { root, content, announcement, refresh, handlers, nodes, change, click };
}

test('anonymous or synthetic identities cannot render operational records', () => {
  for (const user of [undefined, null, {}, {is_admin: true}, {id: ''}, {id: '  '}, {id: true}, {id: 1}, {id: 'demo', demo: true}]) {
    const markup = adminDashboard(user);
    assert.doesNotMatch(markup, /data-admin-dashboard|data-admin-flow/);
    assert.match(markup, /로그인 상태/);
  }
});

test('ordinary signed-in members open the dashboard without an admin role', async () => {
  for (const user of [
    { id: 'member-only' },
    { id: 'member-not-admin', is_admin: false },
    { id: 'member-admin-string', is_admin: 'false' },
  ]) {
    assert.match(adminDashboard(user), /data-admin-dashboard/);
    const h = harness();
    let path;
    const cleanup = mountAdminDashboard(h.root, {
      user,
      api: async (requested) => {
        path = requested;
        return payload();
      },
    });
    await tick();
    assert.equal(path, '/evaluations?limit=100&offset=0');
    assert.match(h.content.innerHTML, /실행 현황·목록/);
    cleanup();
  }
});

test('dashboard summary request filters the database run list by selected period', async () => {
  const h = harness();
  const calls = [];
  const cleanup = mountAdminDashboard(h.root, {
    api: async (path, options) => {
      calls.push({ path, options });
      return [
        { id: 'recent-run', status: 'completed', created_at: new Date().toISOString() },
        { id: 'old-run', status: 'failed', created_at: '2020-01-01T00:00:00Z' },
      ];
    },
  });
  await tick();
  assert.equal(calls[0].path, '/evaluations?limit=100&offset=0');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.match(h.content.innerHTML, />recent-run</);
  assert.doesNotMatch(h.content.innerHTML, />old-run</);
  cleanup();
});

test('dashboard shell starts loading with exactly six cards and accessible filters', () => {
  const markup = adminDashboard({ id: 'signed-in-user', is_admin: true });
  assert.match(markup, /<h1>대시보드<\/h1>/);
  assert.equal(
    (markup.match(/class="admin-dashboard__card admin-dashboard__card--/g) || []).length,
    6,
  );
  assert.match(markup, /for="admin-days"/);
  assert.match(markup, /for="admin-status"/);
  for (const label of [
    '대기 분석',
    '실행 중 분석',
    '정상 완료',
    '완료 · 확인 필요',
    '실패',
    '취소',
  ]) {
    assert.ok(markup.includes(`<dt>${label}</dt>`));
  }
  assert.doesNotMatch(markup, /0건|정상 가동|연동 준비 중|withdraw|계정 탈퇴/);
});

test('access denial gives a login path without mounting the flow entry', () => {
  const markup = adminAccessDenied();
  assert.doesNotMatch(markup, /data-admin-flow/);
  assert.match(markup, /로그인 상태를 확인해 주세요/);
  assert.match(markup, /href="\/#\/email"/);
});

test('six card counts come from the bounded returned sample, not aggregate run_count', () => {
  const data = normalizePerformance(
    payload([
      { status: 'queued' },
      { status: 'running' },
      { status: 'completed' },
      { status: 'partial' },
      { status: 'failed' },
      { status: 'cancelled' },
      { status: 'new-state' },
    ]),
  );
  assert.deepEqual(overviewCounts(data.runs), {
    queued: 1,
    running: 1,
    completed: 1,
    partial: 1,
    failed: 1,
    cancelled: 1,
    unresolved: null,
    other: 1,
  });
  const markup = overviewCards(data);
  assert.doesNotMatch(markup, /999/);
  assert.match(markup, /취소<\/dt><dd>1건/);
  const view = renderPerformanceView(data);
  assert.match(view, /현재 응답 표본 7건/);
  assert.match(view, /서버 성능 집계 실행 수/);
  assert.match(view, /999건/);
  assert.equal(filterRuns(data.runs, 'other').length, 1);
});

test('unresolved issues need complete counts, preserve explicit zero, and never infer from partial', () => {
  assert.equal(overviewCounts([]).unresolved, null);
  assert.equal(overviewCounts([{ status: 'partial' }]).unresolved, null);
  assert.equal(overviewCounts([{ validation: { unresolved_issue_count: 0 } }]).unresolved, 0);
  assert.equal(
    overviewCounts([{ validation: { unresolved_issue_count: 2 } }, {}]).unresolved,
    null,
  );
  assert.equal(
    overviewCounts([
      { validation: { unresolved_issue_count: 2 } },
      { validation: { unresolved_issue_count: 3 } },
    ]).unresolved,
    5,
  );
});

test('measurement and score formatting preserve zero and decimal raw values', () => {
  for (const value of [undefined, null, '', '0', false, NaN, Infinity, -1]) {
    assert.equal(formatDuration(value), '미측정');
    assert.equal(scoreDisplay(value), '점수 없음');
  }
  assert.equal(formatDuration(0), '0 ms');
  assert.equal(formatDuration(1500), '1.5 초');
  assert.equal(scoreDisplay(48.3), '48.3');
  assert.equal(scoreDisplay(48.3, { rounded: true }), '48');
  assert.equal(scoreDisplay(0, { rounded: true }), '0');
  assert.equal(scoreDisplay(101), '점수 없음');
});

test('normalization rejects missing response lists and bounds the sample without mutating input', () => {
  for (const bad of [null, {}, { runs: null }, { runs: {} }])
    assert.throws(() => normalizePerformance(bad));
  const input = payload(Array.from({ length: 220 }, (_, id) => ({ id, total_ms: 0 })));
  const normalized = normalizePerformance(input);
  assert.equal(normalized.runs.length, 200);
  assert.equal(input.runs.length, 220);
  assert.equal(normalized.runs[0].stages_collected, false);
  assert.equal(normalizePerformance(payload([{ stages: [] }])).runs[0].stages_collected, true);
});

test('one selected detail replaces duplicate panels and explains missing data by section', () => {
  const data = normalizePerformance(
    payload([
      {
        id: 'synthetic-run',
        status: 'completed',
        total_ms: 0,
        stages: [{ stage: 'parse_resume', duration_ms: 0, status: 'completed' }],
      },
    ]),
  );
  const markup = renderPerformanceView(data, { selectedIndex: 0 });
  for (const title of [
    '실행 현황·목록',
    '단계별 소요 시간',
  ])
    assert.ok(markup.includes(title));
  for (const title of ['입력·재현', '단계·노드·도구·기억', '검증·재시도', '점수·보고서 저장', 'LLM 사용량·요청 해시', '시험 증거'])
    assert.ok(markup.includes(`<summary>${title}</summary>`));
  assert.match(markup, /0 ms/);
  assert.match(markup, /LLM 호출 기록 없음/);
  assert.doesNotMatch(markup, /id="admin-(scores|validation|llm|persistence)"|미수집/);
  assert.equal((markup.match(/<summary>검증·재시도<\/summary>/g) || []).length, 1);
  assert.match(markup, /aria-expanded="true"/);
  assert.doesNotMatch(markup, /31건|71.116|gpt-6-luna/);
});

test('rich stored telemetry preserves raw score, rounding, zero, cost and report incompatibility', () => {
  const run = normalizePerformance(
    payload([
      {
        id: 'synthetic',
        status: 'partial',
        stages: [],
        scores: { criteria: [
          { criterion_code: 'A1', score: 48.3, verdict: 'met', evidence_count: 2 },
          { criterion_code: 'C1', score: 0, verdict: 'not_met', evidence_count: 0 },
          { criterion_code: 'D1', score: null, verdict: 'unknown' },
        ] },
        llm: {
          call_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          cost: { amount: 0, currency: 'USD', source: 'meter' },
        },
        persistence: { retrievable: false, has_body: true, result_schema_compatible: false },
      },
    ]),
  ).runs[0];
  const detail = renderRunDetail(run);
  assert.match(detail, /48\.3<\/td><td class="numeric">48<\/td><td>충족/);
  assert.match(detail, /0<\/td><td class="numeric">0<\/td><td>미충족/);
  assert.match(detail, /점수 없음<\/td><td class="numeric">점수 없음<\/td><td>판정 보류/);
  const markup = renderPerformanceView(
    { summary: {}, stages: [], runs: [run] },
    { selectedIndex: 0 },
  );
  assert.match(markup, /0 USD/);
  assert.match(markup, /본문 저장 확인/);
  assert.match(markup, /현재 조회 경로에서 열 수 없음/);
  assert.match(markup, /현재 점수·판정 형식과 호환되지 않음/);
});

test('all returned identifiers, metadata and evidence are escaped and never executable', () => {
  const attack = '<img src=x onerror="alert(1)"><script>bad()</script>';
  const data = normalizePerformance({
    summary: {},
    stages: [{ stage: attack, avg_ms: attack }],
    runs: [
      {
        id: attack,
        status: attack,
        stages: [{ stage: attack, criterion_code: attack }],
        input: { resume_id: attack },
        reproduction: { request_sha256: attack },
        scores: [{ code: attack, evidence: [{ source: attack, quote: attack }] }],
        validation: { status: attack, issues: [{ code: attack }] },
        llm: { model: attack, cost: { amount: 0, currency: attack } },
        test_evidence: [{ name: attack, result: attack, reference: 'javascript:alert(1)' }],
      },
    ],
  });
  const markup = renderPerformanceView(data, { selectedIndex: 0 });
  assert.doesNotMatch(
    markup,
    /<img|<script|href="javascript|width:<|class="admin-status--<|data-admin-run="</,
  );
  assert.match(markup, /&lt;img/);
  assert.match(markup, /상태 확인 불가/);
});

test('empty data and empty filters have distinct messages', () => {
  assert.match(
    renderPerformanceView(normalizePerformance(payload())),
    /조회 기간에 반환된 실행이 없습니다/,
  );
  assert.match(
    renderPerformanceView(normalizePerformance(payload([{ status: 'completed' }])), {
      status: 'failed',
    }),
    /선택한 상태의 실행이 없습니다/,
  );
});

test('public mount requests the bounded API without a user option and cleans listeners', async () => {
  const h = harness();
  const calls = [];
  const cleanup = mountAdminDashboard(h.root, {
    api: async (...args) => {
      calls.push(args);
      return payload([{ id: 'run-zero', status: 'completed', total_ms: 0 }]);
    },
  });
  assert.equal(h.refresh.disabled, true);
  await tick();
  assert.equal(calls[0][0], '/evaluations?limit=100&offset=0');
  assert.ok(calls[0][1].signal instanceof AbortSignal);
  assert.match(h.content.innerHTML, /run-zero/);
  assert.equal(h.content.attrs['aria-busy'], 'false');
  assert.equal(h.refresh.disabled, false);
  h.change('[data-admin-status]', 'failed');
  assert.match(h.content.innerHTML, /선택한 상태의 실행이 없습니다/);
  assert.equal(calls.length, 1);
  cleanup();
  cleanup();
  assert.equal(h.handlers.size, 0);
  assert.equal(calls[0][1].signal.aborted, true);
});

test('date changes abort stale work; late results and cleanup cannot repopulate data', async () => {
  const h = harness();
  const requests = [];
  const cleanup = mountAdminDashboard(h.root, {
    user: { id: 'signed-in-user', is_admin: true },
    api: (path, options) => {
      const d = deferred();
      requests.push({ ...d, path, options });
      return d.promise;
    },
  });
  h.change('[data-admin-days]', '7');
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(requests[1].path, '/evaluations?limit=100&offset=0');
  requests[1].resolve(payload([{ id: 'new-data', status: 'completed' }]));
  await tick();
  requests[0].resolve(payload([{ id: 'stale-data', status: 'failed' }]));
  await tick();
  assert.match(h.content.innerHTML, /new-data/);
  assert.doesNotMatch(h.content.innerHTML, /stale-data/);
  h.change('[data-admin-days]', '90');
  cleanup();
  const before = h.content.innerHTML;
  requests[2].resolve(payload([{ id: 'after-cleanup' }]));
  await tick();
  assert.equal(h.content.innerHTML, before);
});

test('authorization errors clear stale data and allow a member to retry', async () => {
  for (const status of [401, 403]) {
    const h = harness();
    h.root.innerHTML = adminDashboard({ id: 'member', is_admin: false });
    let requests = 0;
    const cleanup = mountAdminDashboard(h.root, {
      api: async () => {
        requests++;
        if (requests === 1) return payload([{ id: 'private-run' }]);
        if (requests > 2) return payload([{ id: 'public-after-update' }]);
        throw { status, message: 'private backend trace' };
      },
    });
    await tick();
    assert.match(h.content.innerHTML, /private-run/);
    h.click('[data-admin-retry], [data-admin-refresh]');
    await tick();
    assert.match(h.root.innerHTML, /data-admin-dashboard/);
    assert.match(h.root.innerHTML, /실시간 이용 흐름/);
    assert.match(h.content.innerHTML, /로그인 상태를 확인해 주세요/);
    assert.doesNotMatch(h.content.innerHTML, /private-run|private backend trace|로그인이 필요합니다|href="#\/email"/);
    assert.equal(h.refresh.disabled, false);
    assert.equal(h.handlers.size, 2);
    h.click('[data-admin-retry], [data-admin-refresh]');
    await tick();
    assert.match(h.content.innerHTML, /public-after-update/);
    cleanup();
  }
});

test('403 clears private detail and preserves six unavailable cards with retry', async () => {
  const user = { id: 'ordinary-member', is_admin: false };
  const h = harness();
  h.root.innerHTML = adminDashboard(user);
  let requests = 0;
  const cleanup = mountAdminDashboard(h.root, {
    user,
    api: async (path) => {
      if (path.startsWith('/evaluations/'))
        return { id: 'previous-private-run', status: 'completed', stages: [] };
      requests++;
      if (requests === 1) return payload([{ id: 'previous-private-run', status: 'completed' }]);
      if (requests === 2) throw { status: 403, message: 'private backend trace' };
      return payload([{ id: 'newly-permitted-run', status: 'partial' }]);
    },
  });
  await tick();
  h.click('[data-admin-row]', { dataset: { adminRow: '0' } });
  assert.match(h.content.innerHTML, /previous-private-run/);
  h.click('[data-admin-retry], [data-admin-refresh]');
  await tick();
  assert.match(h.root.innerHTML, /data-admin-dashboard/);
  assert.match(h.content.innerHTML, /로그인 상태를 확인해 주세요/);
  assert.equal((h.content.innerHTML.match(/<dd>조회 불가<\/dd>/g) || []).length, 6);
  assert.doesNotMatch(
    h.content.innerHTML,
    /previous-private-run|private backend trace|0건|<summary>/,
  );
  assert.equal(h.refresh.disabled, false);
  assert.equal(h.content.attrs['aria-busy'], 'false');
  assert.equal(h.handlers.size, 2);
  h.change('[data-admin-status]', 'all');
  assert.match(h.content.innerHTML, /로그인 상태를 확인해 주세요/);
  h.click('[data-admin-retry], [data-admin-refresh]');
  await tick();
  assert.match(h.content.innerHTML, /newly-permitted-run/);
  assert.doesNotMatch(h.content.innerHTML, /로그인 상태를 확인해 주세요|previous-private-run/);
  assert.deepEqual(user, { id: 'ordinary-member', is_admin: false });
  cleanup();
});

test('failures show generic retry UI and successful retry recovers', async () => {
  const h = harness();
  let calls = 0;
  const cleanup = mountAdminDashboard(h.root, {
    user: { id: 'signed-in-user', is_admin: true },
    api: async () => {
      if (++calls === 1) throw new Error('API_KEY=secret SQL traceback');
      return payload();
    },
  });
  await tick();
  assert.match(h.content.innerHTML, /다시 시도/);
  assert.doesNotMatch(h.content.innerHTML, /API_KEY|secret|traceback/);
  h.click('[data-admin-retry], [data-admin-refresh]');
  await tick();
  assert.match(h.content.innerHTML, /조회 기간에 반환된 실행이 없습니다/);
  cleanup();
});

test('run selection opens loaded detail groups, restores focus on close, and clears hidden selection', async () => {
  const h = harness();
  let detailFocus = 0,
    rowFocus = 0;
  h.nodes.set('#admin-detail-title', { focus: () => detailFocus++ });
  h.nodes.set('#admin-selected-run', { scrollIntoView() {} });
  h.nodes.set('[data-admin-run="0"]', { focus: () => rowFocus++ });
  const cleanup = mountAdminDashboard(h.root, {
    user: { id: 'signed-in-user', is_admin: true },
    api: async (path) => path.startsWith('/evaluations/')
      ? { id: 'selected-synthetic', status: 'completed', stages: [], test_evidence: [] }
      : payload([{ id: 'selected-synthetic', status: 'completed', stages: [] }]),
  });
  await tick();
  h.click('[data-admin-row]', { dataset: { adminRow: '0' } });
  await tick();
  assert.equal(detailFocus, 1);
  assert.match(h.content.innerHTML, /<summary>시험 증거<\/summary>/);
  assert.match(h.content.innerHTML, /aria-expanded="true"/);
  h.click('[data-admin-close]');
  assert.equal(rowFocus, 1);
  assert.doesNotMatch(h.content.innerHTML, /<summary>시험 증거/);
  h.click('[data-admin-row]', { dataset: { adminRow: '0' } });
  h.change('[data-admin-status]', 'failed');
  assert.doesNotMatch(h.content.innerHTML, /<summary>시험 증거/);
  cleanup();
});

test('malformed response shows a retryable error instead of a fabricated empty state', async () => {
  const h = harness();
  const cleanup = mountAdminDashboard(h.root, {
    user: { id: 'signed-in-user', is_admin: true },
    api: async () => ({ summary: {} }),
  });
  await tick();
  assert.match(h.content.innerHTML, /운영 기록을 불러오지 못했습니다/);
  assert.doesNotMatch(
    h.content.innerHTML,
    /조회 기간에 반환된 실행이 없습니다|Invalid performance/,
  );
  cleanup();
});

test('stage attempts are actual server values and whole-document parsing has no criterion', () => {
  const markup = renderRunDetail({ id: 'run', stages: [
    { stage: 'parse_resume', criterion_code: null, attempt_number: 1, status: 'completed', duration_ms: 1250 },
    { stage: 'criterion_evaluation', criterion_code: 'A1', attempt_number: 3, status: 'completed', duration_ms: 0 },
  ] });
  assert.match(markup, /이력서 구조화<\/span><span class="admin-dashboard__code">parse_resume<\/span><\/th><td>해당 없음<\/td><td class="numeric">1/);
  assert.match(markup, /A1<\/td><td class="numeric">3/);
  assert.match(markup, /<th scope="col" class="numeric">시도<\/th>/);
  assert.match(markup, /<th scope="col" class="numeric">소요 시간<\/th>/);
  assert.doesNotMatch(markup, /미수집/);
});

test('input composition, prompt versions and per-call hashes remain distinct with zero tokens', () => {
  const markup = renderRunDetail({ id: 'run', stages: [],
    input: { resume_id: 'resume-1', job_posting_id: 'job-1', type: 'markdown', sha256: 'composition-hash', resume_sha256: 'resume-hash', job_sha256: 'job-hash' },
    reproduction: { prompt_version: 'career-lens-v1', schema_versions: ['career-lens-v1', 'tool-call-v1'], version_sources: { prompt_version: '저장 함수가 명시한 버전' } },
    llm: { model: 'test-model', call_count: 1, input_tokens: 0, output_tokens: 0, calls: [{ model: 'test-model', phase: 'evaluation', schema: 'CriterionResult', request_sha256: 'request-hash', prompt_sha256: 'prompt-hash', schema_sha256: 'json-schema-hash', input_tokens: 0, output_tokens: 0, success: true, duration_ms: 0 }] },
  });
  for (const value of ['입력 구성 해시', 'composition-hash', 'resume-hash', 'job-hash', '저장 함수가 명시한 버전', '기록 형식·평가 버전', 'CriterionResult', 'request-hash', 'prompt-hash', 'json-schema-hash']) assert.ok(markup.includes(value));
  assert.match(markup, /입력 토큰<\/dt><dd>0<\/dd>/);
  assert.match(markup, /실측 비용<\/dt><dd>미측정/);
  assert.doesNotMatch(markup, /입력 구성 해시<\/dt><dd>request-hash/);
});

test('public details suppress source quotes and distinguish query failures from no records', () => {
  const run = { id: 'run', stages: [],
    availability: { tools: { status: 'not_recorded', reason: '도구별 기록을 저장하지 않은 실행입니다.' }, scores: { status: 'unavailable', reason: 'controlled failure' }, persistence: { status: 'unavailable' } },
    scores: { criteria: [] },
    persistence: {},
    memory: { kind: 'postgres_checkpoint', checkpoint_count: null, checkpoints: { status: 'unavailable' } },
    report_text: 'PRIVATE_REPORT_BODY', failure_reason: 'PRIVATE_SQL_TRACE',
    validation: { status: 'partial', retry_count: 2, unresolved_issue_count: 0, criterion_issue_count: 1, revalidation_status: 'not_rechecked', issues: [] },
  };
  const markup = renderRunDetail(run);
  assert.match(markup, /도구별 기록을 저장하지 않은 실행/);
  assert.match(markup, /조회 실패/);
  assert.match(markup, /체크포인트 조회 실패/);
  assert.match(markup, /PostgreSQL 체크포인트/);
  assert.match(markup, /재검증 기록 없음/);
  assert.match(markup, /미해결 이슈<\/dt><dd>0건/);
  assert.match(markup, /확인 필요한 평가 기준<\/dt><dd>1건/);
  assert.doesNotMatch(markup, /PRIVATE_REPORT_BODY|PRIVATE_SQL_TRACE|controlled failure|미수집/);
  const withEvidence = renderRunDetail({ id: 'run', scores: { criteria: [{ criterion_code: 'A1', score: 50, evidence_count: 1, evidence: [{ quote: 'PRIVATE_QUOTE' }] }] } });
  assert.doesNotMatch(withEvidence, /PRIVATE_QUOTE/);
});

test('loading and failed detail never display stale sections or raw errors', () => {
  const run = { id: 'run', input: { resume_id: 'stale-resume' } };
  const loading = renderRunDetail(run, { loading: true });
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /불러오는 중/);
  assert.doesNotMatch(loading, /stale-resume|<summary>/);
  const failed = renderRunDetail(run, { error: 'PRIVATE_SQL_TRACE' });
  assert.match(failed, /data-admin-detail-retry/);
  assert.match(failed, /상세 조회 실패/);
  assert.doesNotMatch(failed, /stale-resume|PRIVATE_SQL_TRACE|<summary>/);
});

test('scope and freshness clearly identify all-account executions rather than saved personal reports', () => {
  const data = normalizePerformance({ ...payload([{ id: 'run', status: 'cancelled' }]), generated_at: '2026-10-12T09:00:00Z', scope: { accounts: 'all', record_type: 'evaluation_runs', sample_count: 1 } });
  assert.equal(data.scope.accounts, 'all');
  assert.equal(data.generated_at, '2026-10-12T09:00:00Z');
  const markup = renderPerformanceView(data, { status: 'completed' });
  assert.match(markup, /전체 계정의 평가 실행 기록/);
  assert.match(markup, /마이페이지에 저장된 개인 보고서 개수가 아닙니다/);
  assert.match(markup, /현재 응답 표본 1건 · 목록 필터 결과 0건/);
  assert.match(markup, /마지막 조회/);
  assert.match(markup, /18:00 KST/);
  assert.match(markup, /60초마다·화면 복귀 시 자동 갱신/);
});

test('original API account scope is correctly reflected in cards, accessibility and explanation', () => {
  const data = normalizePerformance({ ...payload([{ id: 'own-run', status: 'completed' }]),
    scope: { mode: 'account', days: 30, run_limit: 100 } });
  const markup = renderPerformanceView(data);
  assert.match(markup, /현재 로그인한 계정의 평가 실행 기록입니다/);
  assert.match(markup, /aria-label="현재 계정의 현재 조회 표본 상태"/);
  assert.equal((markup.match(/현재 계정 · 조회 표본/g) || []).length, 6);
  assert.doesNotMatch(markup, /전체 계정/);
  assert.match(markup, /마이페이지에 저장된 개인 보고서 개수가 아닙니다/);
});

test('missing scope or a loading response never assumes all-account access', () => {
  const markup = renderPerformanceView(normalizePerformance(payload([])));
  assert.match(markup, /계정 범위는 제공되지 않았습니다/);
  assert.match(markup, /현재 응답 · 조회 표본/);
  assert.doesNotMatch(markup + overviewCards(null), /전체 계정/);
});

test('technical names have Korean explanations and missing node duration is not derived', () => {
  const markup = renderRunDetail({ id: 'run', stages: [{ stage: 'criterion_evaluation', criterion_code: 'A1', duration_ms: 900 }],
    nodes: [{ name: 'evaluate_A1', criterion_code: 'A1', status: 'completed', duration_ms: null }],
    tools: [{ name: 'vector_search', status: 'completed', result_count: 2, duration_ms: null }],
    validation: { issues: [{ type: 'cross_domain_conflict', status: 'rechecking' }] },
    llm: { call_count: 1, calls: [{ phase: 'independent_evaluation', schema: 'CriterionResult', success: true }] },
    availability: { nodes: { status: 'available', reason: '노드 완료 기록만 저장되어 별도 실행 시간은 미측정입니다. 위 단계 기록의 criterion_evaluation 시간을 확인하세요.' } },
  });
  for (const label of ['A1 기준 평가', '벡터 검색', '평가 영역 간 판단 충돌', '재검증 중', '독립 평가', '노드 완료 기록만 저장']) assert.ok(markup.includes(label));
  for (const technicalName of ['evaluate_A1', 'vector_search', 'cross_domain_conflict', 'independent_evaluation']) assert.ok(markup.includes(`<span class="admin-dashboard__code">${technicalName}</span>`));
  assert.match(markup, /evaluate_A1<\/span><\/th><td>A1<\/td><td class="numeric">기록 없음<\/td><td>.*?<\/td><td class="numeric">미측정<\/td>/);
});
