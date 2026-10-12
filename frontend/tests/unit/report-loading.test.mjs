import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reportLoadingSnapshot,
  requestFinalReport,
} from '../../src/features/analysis/report-state.js';

const draft = () => ({
  resume_text: '프로젝트에서 API를 설계하고 응답 시간을 개선했습니다.',
  analysis_mode: 'desired_role',
  role: '백엔드 개발자',
  career_target: { role_id: 'backend', label: '백엔드 개발자' },
  preparation: { complete: true, fingerprint: 'resume-target-v1' },
  answers: { example: '이전 답변' },
  created_at: '2026-10-07T01:00:00Z',
});

test('backend progress advances the report stages only after the underlying work completes', () => {
  const source = draft();
  const evaluation = reportLoadingSnapshot(source, false, {
    run: { current_stage: 'criterion' },
  });
  assert.deepEqual(
    evaluation.stages.map((stage) => stage.status),
    ['complete', 'running', 'running'],
  );
  const reporting = reportLoadingSnapshot(source, false, {
    run: { current_stage: 'reporting' },
  });
  assert.deepEqual(
    reporting.stages.map((stage) => stage.status),
    ['complete', 'complete', 'running'],
  );
});

const report = () => ({
  score: 70,
  verdict: '경험의 근거를 확인했습니다.',
  summary: '직무 준비 경험과 보완할 내용을 정리했습니다.',
  criteria: [
    { label: '직무 근거', score: 70, max_score: 100, detail: '입력한 경험을 확인했습니다.' },
  ],
  matches: [],
  strengths: [],
  gaps: [],
  priorities: [],
  questions: [],
  recruiter_email: { subject: '연습용 결과', body: '실제 기업의 판단이 아닙니다.' },
  methodology: '내부 참고 기준',
  analysis_mode: 'local_rules',
  company: '',
  role: '백엔드 개발자',
  requirement_count: 1,
  confirmed_count: 1,
  partial_count: 0,
  missing_count: 0,
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function statusError(status) {
  return Object.assign(new Error(`request failed: ${status}`), { status });
}

test('report loading starts incomplete even when preparation and an older report are already complete', () => {
  const source = { ...draft(), report: report() };
  const snapshot = reportLoadingSnapshot(source);
  assert.equal(snapshot.complete, false);
  assert.deepEqual(
    snapshot.stages.map((stage) => [stage.id, stage.status]),
    [
      ['resume', 'running'],
      ['role', 'running'],
      ['report', 'running'],
    ],
  );
  assert.equal(source.preparation.complete, true);
  assert.equal(source.report.score, 70);
  assert.match(snapshot.stages[1].detail, /백엔드 개발자/);
});

test('only explicit final-report success completes the overlay snapshot', () => {
  const source = { ...draft(), preparation: { complete: false } };
  const snapshot = reportLoadingSnapshot(source, true);
  assert.equal(snapshot.complete, true);
  assert.ok(snapshot.stages.every((stage) => stage.status === 'complete'));
});

test('posting analysis describes only the resume and selected posting', () => {
  const source = {
    ...draft(),
    analysis_mode: 'job_posting',
    company: '가상 기업',
  };
  const snapshot = reportLoadingSnapshot(source);
  assert.equal(snapshot.stages[0].label, '이력서 확인');
  assert.match(snapshot.stages[1].detail, /가상 기업 백엔드 개발자 공고/);
  assert.deepEqual(snapshot.insights, []);
  assert.doesNotMatch(JSON.stringify(snapshot), /답변|질문/);
  assert.equal(source.answers.example, '이전 답변');
});

test('successful final analysis posts submitted answers before accepting the refreshed workspace', async () => {
  const source = draft();
  const answers = { example: '새 보완 답변' };
  const generated = report();
  const fresh = {
    draft: { ...source, answers, report: generated },
    questions: [{ id: 'example' }],
  };
  const controller = new AbortController();
  const calls = [];
  const onProgress = () => {};
  const result = await requestFinalReport({
    draft: source,
    answers,
    signal: controller.signal,
    onProgress,
    request: async (path, options) => {
      calls.push(path);
      assert.equal(options.signal, controller.signal);
      if (path === '/analysis') {
        assert.equal(options.method, 'POST');
        assert.deepEqual(options.body, { answers });
        assert.equal(options.onProgress, onProgress);
        return { report: generated };
      }
      assert.deepEqual(calls, ['/analysis', '/workspace']);
      return fresh;
    },
  });
  assert.equal(result, fresh);
  assert.equal(source.answers.example, '이전 답변');
});

test('malformed final responses never unlock results or request a workspace refresh', async (t) => {
  const invalidReports = [
    undefined,
    null,
    {},
    [],
    'not a report',
    0,
    { error: 'generation failed' },
    { ...report(), criteria: 'not an array' },
    { ...report(), score: '70' },
    { ...report(), strengths: 'not an array' },
    { ...report(), questions: 'not an array' },
  ];
  for (let index = 0; index < invalidReports.length; index++) {
    await t.test(`invalid report ${index + 1}`, async () => {
      const calls = [];
      await assert.rejects(
        requestFinalReport({
          draft: draft(),
          answers: {},
          signal: new AbortController().signal,
          request: async (path) => {
            calls.push(path);
            return { report: invalidReports[index] };
          },
        }),
        /보고서/,
      );
      assert.deepEqual(calls, ['/analysis']);
    });
  }
});

test('analysis failures propagate without replacing saved inputs or attempting refresh', async (t) => {
  for (const status of [0, 401, 403, 409, 500]) {
    await t.test(`HTTP status ${status}`, async () => {
      const source = draft();
      const answers = { example: '보존할 답변' };
      const before = JSON.stringify({ source, answers });
      const failure = statusError(status);
      const calls = [];
      await assert.rejects(
        requestFinalReport({
          draft: source,
          answers,
          signal: new AbortController().signal,
          request: async (path) => {
            calls.push(path);
            throw failure;
          },
        }),
        (error) => error === failure,
      );
      assert.deepEqual(calls, ['/analysis']);
      assert.equal(JSON.stringify({ source, answers }), before);
    });
  }
});

test('an already-cancelled report does not send either API request', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    requestFinalReport({
      draft: draft(),
      answers: {},
      signal: controller.signal,
      request: () => assert.fail('cancelled analysis must not reach the server'),
    }),
    { name: 'AbortError' },
  );
});

test('a report returned after cancellation is not refreshed or applied', async () => {
  const pending = deferred();
  const controller = new AbortController();
  let applied = 0;
  const calls = [];
  const completion = requestFinalReport({
    draft: draft(),
    answers: {},
    signal: controller.signal,
    request: (path) => {
      calls.push(path);
      return pending.promise;
    },
  }).then((value) => {
    applied++;
    return value;
  });
  const cancelled = assert.rejects(completion, { name: 'AbortError' });
  controller.abort();
  pending.resolve({ report: report() });
  await cancelled;
  assert.equal(applied, 0);
  assert.deepEqual(calls, ['/analysis']);
});

test('a late analysis transport failure after cancellation remains a cancellation', async () => {
  const pending = deferred();
  const controller = new AbortController();
  const completion = requestFinalReport({
    draft: draft(),
    answers: {},
    signal: controller.signal,
    request: () => pending.promise,
  });
  const cancelled = assert.rejects(completion, { name: 'AbortError' });
  controller.abort();
  pending.reject(statusError(0));
  await cancelled;
});

test('workspace refresh failure keeps the generated report and submitted answers', async (t) => {
  for (const status of [0, 500, 503]) {
    await t.test(`HTTP status ${status}`, async () => {
      const source = draft();
      const before = JSON.stringify(source);
      const answers = { example: '새 보완 답변' };
      const generated = report();
      const result = await requestFinalReport({
        draft: source,
        answers,
        signal: new AbortController().signal,
        request: async (path) => {
          if (path === '/analysis') return { report: generated };
          throw statusError(status);
        },
      });
      assert.equal(result.draft.report, generated);
      assert.deepEqual(result.draft.answers, answers);
      assert.equal(result.draft.resume_text, source.resume_text);
      assert.deepEqual(result.draft.career_target, source.career_target);
      assert.equal(result.draft.created_at, '');
      assert.equal(JSON.stringify(source), before);
    });
  }
});

test('malformed workspace refresh falls back to the valid report already generated', async (t) => {
  const invalidWorkspaces = [
    undefined,
    {},
    { draft: {} },
    { draft: { report: {} } },
    { draft: { report: { ...report(), criteria: 'bad criteria' } } },
  ];
  for (const [index, fresh] of invalidWorkspaces.entries()) {
    await t.test(`invalid workspace ${index + 1}`, async () => {
      const generated = report();
      const result = await requestFinalReport({
        draft: draft(),
        answers: {},
        signal: new AbortController().signal,
        request: async (path) => (path === '/analysis' ? { report: generated } : fresh),
      });
      assert.equal(result.draft.report, generated);
    });
  }
});

test('workspace authorization and stale-state errors cannot be hidden by a successful earlier report', async (t) => {
  for (const status of [401, 403, 409]) {
    await t.test(`HTTP status ${status}`, async () => {
      const failure = statusError(status);
      await assert.rejects(
        requestFinalReport({
          draft: draft(),
          answers: {},
          signal: new AbortController().signal,
          request: async (path) => {
            if (path === '/analysis') return { report: report() };
            throw failure;
          },
        }),
        (error) => error === failure,
      );
    });
  }
});

test('cancellation during workspace refresh never applies either a late response or fallback', async (t) => {
  for (const outcome of ['resolve', 'reject']) {
    await t.test(outcome, async () => {
      const refresh = deferred();
      const enteredRefresh = deferred();
      const controller = new AbortController();
      let applied = 0;
      const completion = requestFinalReport({
        draft: draft(),
        answers: {},
        signal: controller.signal,
        request: async (path) => {
          if (path === '/analysis') return { report: report() };
          enteredRefresh.resolve();
          return refresh.promise;
        },
      }).then((value) => {
        applied++;
        return value;
      });
      const cancelled = assert.rejects(completion, { name: 'AbortError' });
      await enteredRefresh.promise;
      controller.abort();
      if (outcome === 'resolve') refresh.resolve({ draft: { report: report() } });
      else refresh.reject(statusError(500));
      await cancelled;
      assert.equal(applied, 0);
    });
  }
});
