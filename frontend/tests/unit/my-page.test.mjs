import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSavedReports, myPage, savedReportsList } from '../../src/pages/my-page.js';

const savedReport = {
  id: 'evaluation-1234567890',
  status: 'completed',
  created_at: '2026-10-11T15:05:00Z',
};

test('my page renders only supplied account fields and preserves the saved-list contract', () => {
  const markup = myPage({ name: '홍길동', email: 'member@example.com' });
  assert.match(markup, /<h1>마이페이지<\/h1>/);
  assert.match(markup, /<dt>이름<\/dt><dd>홍길동<\/dd>/);
  assert.match(markup, /<dt>이메일<\/dt><dd>member@example.com<\/dd>/);
  assert.match(markup, /href="#\/resume"/);
  assert.match(markup, /id="saved-reports"[^>]+aria-labelledby="saved-reports-title"/);
  assert.match(markup, /<h2 id="saved-reports-title">저장한 분석 보고서<\/h2>/);
  assert.match(markup, /id="saved-reports-list" aria-live="polite"/);
  assert.match(markup, /계정에 자동으로 저장/);
  assert.match(markup, /aria-busy="true"/);
  assert.doesNotMatch(markup, /href="#\/result"/);
  assert.match(myPage({}, { hasCurrentReport: true }), /href="#\/result"/);

  const sparse = myPage({ email: 'member@example.com' });
  assert.doesNotMatch(sparse, /<dt>이름<\/dt>/);
  assert.doesNotMatch(myPage(null), /<dt>(이름|이메일)<\/dt>/);
});

test('account text, errors and evaluation identifiers cannot insert HTML', () => {
  const payload = '<img src=x onerror="alert(1)">';
  const account = myPage({ name: payload, email: payload });
  assert.doesNotMatch(account, /<img src=x/);
  assert.match(account, /&lt;img src=x/);

  const markup = savedReportsList({
    items: [{ ...savedReport, id: 'a/b?x="<img>' }],
    error: payload,
    loaded: true,
  });
  assert.match(markup, /href="#\/reports\/a%2Fb%3Fx%3D%22%3Cimg%3E"/);
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /&lt;img src=x/);
  assert.match(markup, /data-reports-retry/);
});

test('saved rows show real KST timestamps, short IDs and completed or partial status', () => {
  const markup = savedReportsList({
    items: [savedReport, { ...savedReport, id: 'partial-id', status: 'partial' }],
    loaded: true,
  });
  assert.equal((markup.match(/<li class="saved-report">/g) || []).length, 2);
  assert.match(markup, /2026\. 10\. 12\. 00:05/);
  assert.match(markup, /datetime="2026-10-11T15:05:00\.000Z"/);
  assert.match(markup, />KST<\/span>/);
  assert.match(markup, /평가 ID · evaluation-1…/);
  assert.match(markup, /title="evaluation-1234567890"/);
  assert.match(markup, />완료<\/span>/);
  assert.match(markup, />완료 · 일부 확인 필요<\/span>/);
  assert.match(markup, /href="#\/reports\/partial-id"/);
});

test('missing or malformed timestamps stay explicitly unknown', () => {
  for (const created_at of [null, '', 'not-a-date']) {
    const markup = savedReportsList({ items: [{ ...savedReport, created_at }], loaded: true });
    assert.match(markup, /날짜 정보 없음/);
    assert.doesNotMatch(markup, /datetime=|Invalid Date|1970/);
  }
});

test('loading more keeps existing report links and disables the pagination control', () => {
  const markup = savedReportsList({
    items: [savedReport],
    nextOffset: 100,
    loading: true,
    loaded: true,
  });
  assert.match(markup, /href="#\/reports\/evaluation-1234567890"/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /data-reports-more disabled/);
  assert.match(markup, /다음 보고서를 불러오는 중/);
  assert.doesNotMatch(markup, /아직 저장된/);
});

test('failed pagination retains rows and provides a disabled retry while retrying', () => {
  const markup = savedReportsList({
    items: [savedReport],
    nextOffset: 100,
    error: '연결을 확인해 주세요.',
    loading: true,
    loaded: true,
  });
  assert.match(markup, /href="#\/reports\/evaluation-1234567890"/);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /data-reports-retry disabled/);
  assert.doesNotMatch(markup, /data-reports-more/);
});

test('an empty scanned page with more records is not reported as an empty account', () => {
  const markup = savedReportsList({ nextOffset: 100, loaded: true });
  assert.match(markup, /다음 기록을 확인/);
  assert.match(markup, /data-reports-more/);
  assert.doesNotMatch(markup, /disabled|아직 저장된 분석 보고서가 없습니다/);

  const empty = savedReportsList({ loaded: true });
  assert.match(empty, /아직 저장된 분석 보고서가 없습니다/);
  assert.doesNotMatch(empty, /data-reports-more|data-reports-retry/);
});

test('initial and demo states do not invent saved report records', () => {
  const initial = savedReportsList();
  assert.match(initial, /불러오는 중/);
  assert.doesNotMatch(initial, /아직 저장된|<li /);
  const demo = savedReportsList({ loaded: true, demo: true });
  assert.match(demo, /시연 모드/);
  assert.doesNotMatch(demo, /<li |아직 저장된|불러오는 중/);
});

test('all authenticated members can open the dashboard without gaining admin rights', () => {
  for (const is_admin of [undefined, false, true, 'true']) {
    const user = { id: 'member', is_admin };
    assert.match(myPage(user), /href="#\/admin">대시보드/);
    assert.equal(user.is_admin, is_admin);
  }
  for (const user of [
    null,
    {},
    { id: ' ' },
    { is_admin: false },
    { is_admin: 'true' },
    { role: 'admin' },
    { email: 'admin@example.com' },
  ]) {
    assert.doesNotMatch(myPage(user), /href="#\/admin"/);
  }
});

test('report labels use supplied job context, escape it and explain partial results', () => {
  const markup = savedReportsList({
    items: [
      {
        ...savedReport,
        status: 'partial',
        job_context: {
          title: 'Backend <script>job</script>',
          company: '회사 & Company',
          source: 'report',
        },
      },
    ],
    loaded: true,
  });
  assert.match(markup, /회사 &amp; Company/);
  assert.match(markup, /Backend &lt;script&gt;job&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /분석은 완료되었으며 일부 항목의 근거나 검증 참고사항은 추가 확인/);
  assert.doesNotMatch(markup, /대상 공고 정보 없음|대상 공고 확인 중/);
});

test('missing job context has explicit loading, missing and retry states without blocking report access', () => {
  const loading = savedReportsList({
    items: [{ ...savedReport, context_loading: true }],
    loaded: true,
  });
  assert.match(loading, /대상 공고 확인 중/);
  const missing = savedReportsList({ items: [savedReport], loaded: true });
  assert.match(missing, /대상 공고 정보 없음/);
  const failed = savedReportsList({
    items: [{ ...savedReport, context_error: 'network failure' }],
    loaded: true,
  });
  assert.match(failed, /대상 공고 정보를 불러오지 못했어요/);
  assert.match(failed, /data-report-context-retry="evaluation-1234567890"/);
  assert.match(failed, /href="#\/reports\/evaluation-1234567890"/);
});

test('unsupported report selection and deletion remain disabled', () => {
  const markup = savedReportsList({
    items: [savedReport],
    selectedIds: [savedReport.id],
    loaded: true,
  });
  const rowSelection = markup.match(
    /<input\b[^>]*data-report-select="evaluation-1234567890"[^>]*>/,
  )[0];
  const rowDelete = markup.match(
    /<button\b[^>]*data-report-delete="evaluation-1234567890"[^>]*>/,
  )[0];
  const bulkDelete = markup.match(/<button\b[^>]*data-reports-delete-selected[^>]*>/)[0];
  assert.match(rowSelection, /checked/);
  assert.match(rowSelection, /disabled/);
  assert.match(rowDelete, /disabled/);
  assert.match(bulkDelete, /disabled/);
  assert.match(markup, /현재 저장 서버에서 삭제를 지원하지 않습니다/);
});

test('delete controls require both capability and a selection for bulk actions', () => {
  const ready = savedReportsList({
    items: [{ ...savedReport, can_delete: true }],
    selectedIds: [savedReport.id],
    loaded: true,
    canDeleteReports: true,
  });
  assert.doesNotMatch(
    ready.match(/<button\b[^>]*data-report-delete="evaluation-1234567890"[^>]*>/)[0],
    /disabled/,
  );
  assert.doesNotMatch(
    ready.match(/<button\b[^>]*data-reports-delete-selected[^>]*>/)[0],
    /disabled/,
  );
  assert.doesNotMatch(ready, /reports-delete-help|연동 준비 중/);
  const unselected = savedReportsList({
    items: [{ ...savedReport, can_delete: true }],
    loaded: true,
    canDeleteReports: true,
  });
  assert.match(unselected.match(/<button\b[^>]*data-reports-delete-selected[^>]*>/)[0], /disabled/);
  const deleting = savedReportsList({
    items: [{ ...savedReport, can_delete: true }],
    selectedIds: [savedReport.id],
    loaded: true,
    canDeleteReports: true,
    deleting: true,
  });
  assert.match(deleting, /aria-busy="true"/);
  assert.match(
    deleting.match(/<input\b[^>]*data-report-select="evaluation-1234567890"[^>]*>/)[0],
    /disabled/,
  );
  assert.match(deleting.match(/<button\b[^>]*data-reports-delete-selected[^>]*>/)[0], /disabled/);
  assert.match(deleting, /href="#\/reports\/evaluation-1234567890"/);
});

test('search and status filter only supplied rows without mutating them', () => {
  const items = [
    { ...savedReport, job_context: { title: 'Backend Engineer', company: '샘플 회사' } },
    {
      ...savedReport,
      id: 'other-evaluation',
      status: 'partial',
      job_context: { title: 'Designer', company: '다른 회사' },
    },
  ];
  assert.deepEqual(
    filterSavedReports(items, ' backend ', '').map(({ id }) => id),
    [savedReport.id],
  );
  assert.deepEqual(
    filterSavedReports(items, '다른', 'partial').map(({ id }) => id),
    ['other-evaluation'],
  );
  assert.deepEqual(filterSavedReports(items, 'other-evaluation', 'completed'), []);
  assert.deepEqual(filterSavedReports(items, '', 'invalid'), items);
  assert.equal(items.length, 2);
  const empty = savedReportsList({ items, query: '없는 공고', loaded: true, nextOffset: 100 });
  assert.match(empty, /검색 조건에 맞는 기록이 없습니다/);
  assert.match(empty, /data-reports-more/);
  assert.doesNotMatch(empty, /아직 저장된 분석 보고서가 없습니다/);
});

test('select-all reflects the filtered visible rows and reports hidden selections', () => {
  const items = [{ ...savedReport, can_delete: true }, { ...savedReport, id: 'partial-report', status: 'partial', can_delete: true }];
  const markup = savedReportsList({
    items,
    selectedIds: [savedReport.id, 'partial-report'],
    status: 'partial',
    loaded: true,
  });
  const selectAll = markup.match(/<input\b[^>]*data-reports-select-all[^>]*>/)[0];
  assert.match(selectAll, /aria-checked="true"/);
  assert.match(selectAll, /\schecked\s/);
  assert.match(markup, /현재 목록의 삭제 가능한 보고서 전체 선택/);
  assert.match(markup, /현재 목록 밖 1개 포함/);
  assert.doesNotMatch(markup, /data-report-select="evaluation-1234567890"/);
  assert.match(markup, /data-report-select="partial-report"/);
  const mixed = savedReportsList({ items, selectedIds: [savedReport.id], loaded: true });
  assert.match(
    mixed.match(/<input\b[^>]*data-reports-select-all[^>]*>/)[0],
    /aria-checked="mixed"/,
  );
});
