import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guestWorkspace,
  requestGuestReport,
  practiceDestination,
} from '../../src/features/analysis/guest-state.js';

test('guest workspace excludes accidental private report and resume fields', () => {
  const value = guestWorkspace({
    completed: true,
    report_locked: true,
    expires_at: '2030-01-01T00:00:00Z',
    draft: {
      resume_attached: true,
      filename: 'attached.pdf',
      resume_text: 'PRIVATE RESUME',
      report: { score: 83, summary: 'PRIVATE REPORT' },
      answers: { one: 'PRIVATE ANSWER' },
      selected_posting_id: 'posting-a',
    },
  });
  assert.equal(value.draft.report_locked, true);
  assert.equal(value.draft.resume_attached, true);
  assert.ok(!JSON.stringify(value).includes('PRIVATE'));
  assert.ok(!JSON.stringify(value).includes('score'));
});

test('guest completion requires server confirmation and never fetches a report', async () => {
  const calls = [];
  const request = async (path, options) => {
    calls.push([path, options.body]);
    return { completed: true, report_locked: true, draft: { resume_attached: true } };
  };
  const result = await requestGuestReport({
    answers: { one: 'An experience' },
    signal: new AbortController().signal,
    request,
  });
  assert.deepEqual(calls, [['/guest/analysis', { answers: { one: 'An experience' } }]]);
  assert.equal(result.draft.report_locked, true);
  await assert.rejects(
    requestGuestReport({
      answers: {},
      signal: new AbortController().signal,
      request: async () => ({ completed: false, report_locked: true }),
    }),
    /분석 완료/,
  );
});

test('real guest progress is passed to loading while the locked workspace excludes private fields', async () => {
  const updates = [];
  const progress = { run: { progress_percent: 63, current_stage: 'evaluation' } };
  const result = await requestGuestReport({
    signal: new AbortController().signal,
    onProgress: (update) => updates.push(update),
    request: async (_path, options) => {
      options.onProgress(progress);
      return { completed: true, report_locked: true, status: 'partial',
        draft: { resume_attached: true, selected_posting: { id: 'backup-001', company: '회사', role: '직무', description: 'PRIVATE' } } };
    },
  });
  assert.deepEqual(updates, [progress]);
  assert.equal(result.draft.analysis_status, 'partial');
  assert.equal(result.draft.selected_posting.id, 'backup-001');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|report_text|scores/);
});

test('cancelled guest analysis does not open completed result', async () => {
  const controller = new AbortController();
  await assert.rejects(
    requestGuestReport({
      answers: {},
      signal: controller.signal,
      request: async () => {
        controller.abort();
        return { completed: true, report_locked: true };
      },
    }),
    { name: 'AbortError' },
  );
});

test('explicit unexpired preview opens only a locked pending shell without private content', async () => {
  const preview = {
    completed: false, preview_ready: true, analysis_pending: true, report_locked: true,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    draft: { resume_attached: true, selected_posting_id: 'preview-job', resume_text: 'PRIVATE', report: { score: 99 } },
  };
  const result = await requestGuestReport({ answers: {}, signal: new AbortController().signal, request: async () => preview });
  assert.equal(result.draft.preview_ready, true);
  assert.equal(result.draft.analysis_pending, true);
  assert.equal(result.draft.report_locked, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|score|"report":/);
  for (const change of [{ preview_ready: false }, { analysis_pending: false }, { report_locked: false },
    { expires_at: new Date(Date.now() - 1).toISOString() }, { expires_at: 'invalid' },
    { draft: { resume_attached: true } }, { draft: { selected_posting_id: 'preview-job' } }]) {
    const invalid = { ...preview, ...change };
    assert.equal(guestWorkspace(invalid).draft.preview_ready, false);
    assert.equal(guestWorkspace(invalid).draft.report_locked, false);
    await assert.rejects(requestGuestReport({ answers: {}, signal: new AbortController().signal, request: async () => invalid }), /분석 완료/);
  }
});

test('practice navigation respects resume, posting and locked report prerequisites', () => {
  assert.equal(practiceDestination({}), 'resume');
  assert.equal(practiceDestination({ resume_attached: true }), 'desired-role');
  assert.equal(practiceDestination({ resume_text: '저장한 이력서' }), 'desired-role');
  assert.equal(practiceDestination({ resume_attached: true, selected_posting_id: 'a' }), 'jobs/a');
  assert.equal(practiceDestination({ report_locked: true }), 'result');
  assert.equal(practiceDestination({ report: { score: 0 } }), 'result');
});

test('adapter running metadata survives the allowlist for refresh continuation', () => {
  const value = guestWorkspace({ draft: { resume_attached: true, analysis_running: true,
    analysis_status: 'running', selected_posting: { id: 'backup-005', role: '직무' } } });
  assert.equal(value.draft.analysis_running, true);
  assert.equal(value.draft.analysis_status, 'running');
  assert.equal(value.draft.selected_posting.id, 'backup-005');
  assert.equal(value.draft.report_locked, false);
});

test('practice returns to the saved role listing or selected posting until its report is ready', () => {
  const draft = {
    resume_attached: true,
    career_target: { role_id: 'backend', label: '백엔드 개발자' },
  };
  const destination = practiceDestination(draft);
  assert.equal(destination.split('?')[0], 'opportunities');
  const query = new URLSearchParams(destination.split('?')[1]);
  assert.equal(query.get('role_id'), 'backend');
  assert.equal(query.get('label'), '백엔드 개발자');
  assert.equal(query.get('page'), '1');
  const selected = practiceDestination({ ...draft, selected_posting_id: 'selected/a' });
  assert.equal(selected, 'jobs/selected%2Fa');
  assert.equal(practiceDestination({ selected_posting_id: 'selected/a' }), 'jobs/selected%2Fa');
  assert.equal(practiceDestination({ ...draft, report_locked: true }), 'result');
});
