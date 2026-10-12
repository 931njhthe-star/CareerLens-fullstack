import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  finishPreparationPresentation,
  withPresentationSignal,
} from '../../src/features/analysis/preparation-transition.js';
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
  const result = await requestFinalReport({
    draft: source,
    answers,
    signal: controller.signal,
    request: async (path, options) => {
      calls.push(path);
      assert.equal(options.signal, controller.signal);
      if (path === '/analysis') {
        assert.equal(options.method, 'POST');
        assert.deepEqual(options.body, { answers });
        return { report: generated };
      }
      assert.deepEqual(calls, ['/analysis', '/workspace']);
      return fresh;
    },
  });
  assert.equal(result, fresh);
  assert.equal(source.answers.example, '이전 답변');
});

test('backend reports with a withheld total or an actual zero remain valid through final analysis', async () => {
  for (const score of [null, 0]) {
    const generated = {
      ...report(),
      source: 'backend',
      score,
      status: 'partial',
      backend_report_text: '# 실제 보고서\n\n확인되지 않은 점수는 보류합니다.',
    };
    const updates = [];
    const progress = { run: { id: 'synthetic-run', current_stage: 'reporting' } };
    const result = await requestFinalReport({
      draft: draft(),
      answers: {},
      signal: new AbortController().signal,
      onProgress: (update) => updates.push(update),
      request: async (path, options) => {
        if (path === '/analysis') {
          options.onProgress(progress);
          return { report: generated };
        }
        return { draft: { ...draft(), report: generated } };
      },
    });
    assert.equal(result.draft.report, generated);
    assert.equal(result.draft.report.score, score);
    assert.deepEqual(updates, [progress]);
  }
});

test('nullable support remains specific to backend reports and never accepts invalid numeric totals', async () => {
  for (const invalid of [
    { ...report(), score: null },
    ...[undefined, '0', NaN, Infinity, -1, 101].map((score) => ({
      ...report(),
      source: 'backend',
      score,
    })),
  ]) {
    const calls = [];
    await assert.rejects(
      requestFinalReport({
        draft: draft(),
        answers: {},
        signal: new AbortController().signal,
        request: async (path) => {
          calls.push(path);
          return { report: invalid };
        },
      }),
      /보고서/,
    );
    assert.deepEqual(calls, ['/analysis']);
  }
});

test('backend progress events describe work without unlocking a final report', () => {
  const source = draft();
  const running = reportLoadingSnapshot(source, false, {
    run: { current_stage: 'reporting', progress_percent: 100, status: 'completed' },
  });
  assert.deepEqual(
    running.stages.map((stage) => stage.status),
    ['complete', 'complete', 'running'],
  );
  assert.equal(running.complete, false);
  assert.deepEqual(running.insights, []);
  const finished = reportLoadingSnapshot(source, true);
  assert.ok(finished.stages.every((stage) => stage.status === 'complete'));
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

// Exercise the real modal controller with browser effects and module loading
// replaced, so a slow renderer cannot accidentally delay or complete the API.
const overlayController = readFileSync(
  new URL('../../src/features/analysis/report-loading.js', import.meta.url),
  'utf8',
)
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
  .replace('export function createReportLoading', 'function createReportLoading')
  .replace("import('./live-eye-motion.js')", 'loadEyeModule()');
const nextTurn = () => new Promise(setImmediate);

function overlayFixture({
  graphics = deferred(),
  settled = deferred(),
  demo = false,
  preview = false,
  ready = false,
  now = 4000,
  wait,
} = {}) {
  const attrs = new Map();
  const events = [];
  const classes = new Set();
  const host = {
    setAttribute: (key, value) => attrs.set(key, value),
    removeAttribute: (key) => attrs.delete(key),
    style: {},
  };
  const evaluationStatus = { textContent: '' };
  const percentage = { textContent: '0%' };
  const button = { addEventListener: (type, callback) => (button[type] = callback) };
  const dialog = {
    style: {},
    classList: { add: (name) => classes.add(name) },
    querySelector: (selector) =>
      selector === 'button'
        ? button
        : selector === '[data-evaluation-status]'
          ? evaluationStatus
          : selector === '[data-loading-percent]'
            ? percentage
            : host,
    setAttribute() {},
    addEventListener: (type, callback) => (dialog[type] = callback),
    showModal: () => events.push('modal-open'),
    focus() {},
    close: () => events.push('modal-close'),
    remove: () => events.push('modal-remove'),
  };
  const focused = {
    isConnected: true,
    focus: () => events.push('focus-restored'),
  };
  const document = {
    body: { style: { overflow: 'auto' }, append() {} },
    activeElement: focused,
    createElement: () => dialog,
  };
  let mounted;
  const module = {
    mountLiveAnalysisEye(target, options) {
      assert.equal(target, host);
      mounted = options;
      events.push('eye-mounted');
      return {
        complete: () => events.push('eye-complete'),
        whenSettled: () => settled.promise,
        dispose: () => events.push('eye-disposed'),
      };
    },
  };
  const context = vm.createContext({
    AbortController,
    document,
    window: { matchMedia: () => ({ matches: false }) },
    performance: { now: () => 0 },
    loadEyeModule: () => graphics.promise,
    withPresentationSignal,
    finishPreparationPresentation: (options) =>
      finishPreparationPresentation({ ...options, now: () => now, ...(wait ? { wait } : {}) }),
  });
  vm.runInContext(overlayController, context);
  const loading = context.createReportLoading({
    draft: draft(),
    onCancel: () => events.push('cancelled'),
    demo,
    preview,
    ready,
  });
  return {
    loading,
    graphics,
    settled,
    module,
    attrs,
    evaluationStatus,
    percentage,
    events,
    document,
    dialog,
    button,
    mounted: () => mounted,
  };
}

test('the real overlay starts analysis before graphics arrive and completes only after success and final drawing', async () => {
  const fixture = overlayFixture();
  const request = deferred();
  let requested = false;
  let returned = false;
  const run = fixture.loading
    .run(() => {
      requested = true;
      return request.promise;
    })
    .then((result) => {
      returned = true;
      return result;
    });
  assert.equal(requested, true);
  assert.equal(fixture.events.includes('eye-mounted'), false);
  fixture.graphics.resolve(fixture.module);
  await nextTurn();
  fixture.mounted().onProgress(100);
  assert.equal(fixture.attrs.has('aria-valuenow'), false);
  assert.equal(fixture.percentage.textContent, '확인 중');
  assert.equal(fixture.events.includes('eye-complete'), false);
  request.resolve('validated-report');
  await nextTurn();
  assert.equal(fixture.events.includes('eye-complete'), true);
  assert.equal(returned, false);
  fixture.settled.resolve();
  assert.equal(await run, 'validated-report');
  assert.equal(fixture.attrs.get('aria-valuenow'), '100');
  assert.equal(fixture.percentage.textContent, '100%');
  assert.equal(fixture.attrs.get('aria-busy'), 'false');
  fixture.loading.dispose();
});

test('an API failure closes the modal and never completes the eye', async () => {
  const fixture = overlayFixture();
  fixture.graphics.resolve(fixture.module);
  const request = deferred();
  const failure = statusError(500);
  const run = fixture.loading.run(() => request.promise);
  const rejection = assert.rejects(run, (error) => error === failure);
  await nextTurn();
  request.reject(failure);
  await rejection;
  assert.equal(fixture.events.includes('eye-complete'), false);
  assert.equal(fixture.events.includes('eye-disposed'), true);
  assert.equal(fixture.events.includes('modal-remove'), true);
  assert.equal(fixture.document.body.style.overflow, 'auto');
});

test('cancellation while the eye module loads aborts success and prevents a late mount', async () => {
  const fixture = overlayFixture();
  const run = fixture.loading.run(async () => 'validated-report');
  const rejection = assert.rejects(run, { name: 'AbortError' });
  await nextTurn();
  fixture.button.click();
  await rejection;
  fixture.graphics.resolve(fixture.module);
  await nextTurn();
  assert.equal(fixture.events.includes('eye-mounted'), false);
  assert.equal(fixture.events.includes('cancelled'), true);
  assert.equal(fixture.events.includes('focus-restored'), true);
  assert.equal(fixture.events.filter((event) => event === 'modal-remove').length, 1);
});

test('native Escape cancellation aborts a pending final animation and restores the page', async () => {
  const fixture = overlayFixture();
  fixture.graphics.resolve(fixture.module);
  const run = fixture.loading.run(async () => 'validated-report');
  const rejection = assert.rejects(run, { name: 'AbortError' });
  await nextTurn();
  let prevented = false;
  fixture.dialog.cancel({ preventDefault: () => (prevented = true) });
  await rejection;
  assert.equal(prevented, true);
  assert.equal(fixture.loading.signal.aborted, true);
  assert.equal(fixture.events.includes('eye-disposed'), true);
  assert.equal(fixture.document.body.style.overflow, 'auto');
});

test('server stage updates use safe copy and cannot complete or update a cancelled overlay', async () => {
  const fixture = overlayFixture();
  fixture.graphics.resolve(fixture.module);
  const request = deferred();
  let progress;
  const run = fixture.loading.run((_signal, onProgress) => {
    progress = onProgress;
    return request.promise;
  });
  const rejection = assert.rejects(run, { name: 'AbortError' });
  await nextTurn();
  progress({ run: { current_stage: 'parsing' } });
  assert.equal(fixture.evaluationStatus.textContent, '이력서와 공고 내용을 확인하고 있어요.');
  progress({ run: { current_stage: '<img src=x onerror=alert(1)>', progress_percent: 100 } });
  assert.equal(
    fixture.evaluationStatus.textContent,
    '분석 진행률이 100%입니다. 보고서를 확인하고 있어요.',
  );
  progress({ run: { current_stage: 'completed', progress_percent: 100 } });
  assert.equal(fixture.events.includes('eye-complete'), false);
  fixture.mounted().onProgress(100);
  assert.equal(fixture.attrs.get('aria-valuenow'), '100');
  assert.equal(fixture.percentage.textContent, '100%');
  fixture.button.click();
  const statusAfterCancel = fixture.evaluationStatus.textContent;
  progress({ run: { current_stage: 'reporting' } });
  assert.equal(fixture.evaluationStatus.textContent, statusAfterCancel);
  fixture.mounted().onProgress(12);
  assert.equal(fixture.attrs.get('aria-valuenow'), '100');
  assert.equal(fixture.percentage.textContent, '100%');
  request.resolve('late report');
  await rejection;
});

test('navigation disposal aborts pending work and requests server cancellation only once', async () => {
  const fixture = overlayFixture();
  const request = deferred();
  const run = fixture.loading.run(() => request.promise);
  const rejection = assert.rejects(run, { name: 'AbortError' });
  fixture.loading.dispose({ restoreFocus: false, cancelAnalysis: true });
  fixture.loading.dispose({ cancelAnalysis: true });
  fixture.button.click();
  assert.equal(fixture.loading.signal.aborted, true);
  assert.equal(fixture.events.filter((event) => event === 'cancelled').length, 1);
  assert.equal(fixture.events.includes('focus-restored'), false);
  assert.equal(fixture.events.filter((event) => event === 'modal-remove').length, 1);
  request.resolve('late report');
  await rejection;
});

test('success disposal and failure cleanup do not send a redundant server cancellation', async () => {
  const completed = overlayFixture();
  completed.graphics.resolve(completed.module);
  completed.settled.resolve();
  await completed.loading.run(async () => 'validated report');
  completed.loading.dispose({ cancelAnalysis: true });
  assert.equal(completed.events.includes('cancelled'), false);
  const failed = overlayFixture();
  await assert.rejects(
    failed.loading.run(async () => {
      throw statusError(500);
    }),
    /request failed/,
  );
  failed.loading.dispose({ cancelAnalysis: true });
  assert.equal(failed.events.includes('cancelled'), false);
});

test('real progress is indeterminate until the backend sends a valid number and preserves zero and decimals', async () => {
  const fixture = overlayFixture();
  const request = deferred();
  let progress;
  const run = fixture.loading.run((_signal, onProgress) => {
    progress = onProgress;
    return request.promise;
  });
  const rejection = assert.rejects(run, { name: 'AbortError' });
  assert.equal(fixture.percentage.textContent, '확인 중');
  assert.equal(fixture.attrs.has('aria-valuenow'), false);
  assert.match(fixture.attrs.get('aria-valuetext'), /진행률을 확인/);
  assert.match(fixture.dialog.innerHTML, /분석 서버가 보내는 작업 진행률/);
  for (const value of [0, 12.345, 99.99, 100]) {
    progress({ run: { current_stage: 'criterion', progress_percent: value } });
    assert.equal(fixture.percentage.textContent, `${value}%`);
    assert.equal(fixture.attrs.get('aria-valuenow'), String(value));
    assert.equal(fixture.attrs.get('aria-valuetext'), `${value}% · 분석 서버 작업 진행률`);
    assert.equal(fixture.events.includes('eye-complete'), false);
  }
  fixture.graphics.resolve(fixture.module);
  await nextTurn();
  fixture.mounted().onProgress(17);
  assert.equal(fixture.percentage.textContent, '100%');
  assert.equal(fixture.attrs.get('aria-valuenow'), '100');
  fixture.button.click();
  request.resolve('late report');
  await rejection;
});

test('missing, nonnumeric and out-of-range backend values never turn into invented progress', async () => {
  const fixture = overlayFixture();
  fixture.graphics.resolve(fixture.module);
  const request = deferred();
  let progress;
  const run = fixture.loading.run((_signal, onProgress) => {
    progress = onProgress;
    return request.promise;
  });
  const rejection = assert.rejects(run, { name: 'AbortError' });
  await nextTurn();
  for (const value of [undefined, null, NaN, Infinity, -1, 100.001, '50', true]) {
    progress({ run: { current_stage: 'criterion', progress_percent: 42.125 } });
    progress({ run: { current_stage: 'criterion', progress_percent: value } });
    fixture.mounted().onProgress(75);
    assert.equal(fixture.percentage.textContent, '확인 중');
    assert.equal(fixture.attrs.has('aria-valuenow'), false);
  }
  progress({});
  assert.equal(fixture.percentage.textContent, '확인 중');
  fixture.button.click();
  request.resolve('late report');
  await rejection;
});

test('a backend 100 percent update cannot unlock results or bypass the minimum and final motion', async () => {
  const minimum = deferred();
  const waits = [];
  const fixture = overlayFixture({
    now: 1000,
    wait: (milliseconds, signal) => {
      waits.push(milliseconds);
      return withPresentationSignal(minimum.promise, signal);
    },
  });
  fixture.graphics.resolve(fixture.module);
  const request = deferred();
  let progress;
  let resolved = false;
  const run = fixture.loading
    .run((_signal, onProgress) => {
      progress = onProgress;
      return request.promise;
    })
    .then((value) => {
      resolved = true;
      return value;
    });
  await nextTurn();
  progress({ run: { current_stage: 'completed', progress_percent: 100 } });
  fixture.mounted().onProgress(99);
  assert.equal(fixture.percentage.textContent, '100%');
  assert.match(fixture.evaluationStatus.textContent, /보고서를 확인/);
  assert.equal(fixture.events.includes('eye-complete'), false);
  assert.equal(resolved, false);
  await assert.rejects(fixture.loading.reveal(), /분석이 완료된 뒤/);
  request.resolve('validated-report');
  await nextTurn();
  assert.equal(fixture.events.includes('eye-complete'), true);
  assert.deepEqual(waits, [3000]);
  fixture.settled.resolve();
  await nextTurn();
  assert.equal(resolved, false);
  assert.equal(fixture.attrs.get('aria-busy'), 'true');
  minimum.resolve();
  assert.equal(await run, 'validated-report');
  assert.equal(fixture.attrs.get('aria-busy'), 'false');
  assert.equal(fixture.evaluationStatus.textContent, '보고서가 준비됐어요.');
  progress({ run: { progress_percent: 12 } });
  assert.equal(fixture.percentage.textContent, '100%');
  fixture.loading.dispose();
});

test('backend progress at 100 percent remains cancellable and a later transport failure stays cancelled', async () => {
  const fixture = overlayFixture();
  fixture.graphics.resolve(fixture.module);
  const request = deferred();
  let progress;
  const run = fixture.loading.run((_signal, onProgress) => {
    progress = onProgress;
    return request.promise;
  });
  const rejection = assert.rejects(run, { name: 'AbortError' });
  await nextTurn();
  progress({ run: { progress_percent: 100, current_stage: 'completed' } });
  fixture.button.click();
  request.reject(statusError(503));
  await rejection;
  assert.equal(fixture.events.includes('eye-complete'), false);
  assert.equal(fixture.events.filter((event) => event === 'cancelled').length, 1);
  assert.equal(fixture.events.includes('modal-remove'), true);
});

test('a failed report request after backend 100 percent is still a failure', async () => {
  const fixture = overlayFixture();
  fixture.graphics.resolve(fixture.module);
  const failure = statusError(500);
  await assert.rejects(
    fixture.loading.run(async (_signal, onProgress) => {
      onProgress({ run: { progress_percent: 100, current_stage: 'completed' } });
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(fixture.events.includes('eye-complete'), false);
  assert.equal(fixture.events.includes('cancelled'), false);
  assert.equal(fixture.events.includes('modal-remove'), true);
});

test('only an explicit demo session may use the illustrative percentage', async () => {
  const fixture = overlayFixture({ demo: true });
  fixture.graphics.resolve(fixture.module);
  const request = deferred();
  let progress;
  const run = fixture.loading.run((_signal, onProgress) => {
    progress = onProgress;
    return request.promise;
  });
  assert.equal(fixture.percentage.textContent, '0%');
  assert.match(fixture.dialog.innerHTML, /시연용 진행률/);
  await nextTurn();
  fixture.mounted().onProgress(12.7);
  assert.equal(fixture.percentage.textContent, '13%');
  assert.equal(fixture.attrs.get('aria-valuetext'), '13% · 시연용 진행률');
  progress({ run: { progress_percent: 90 } });
  assert.equal(fixture.percentage.textContent, '13%');
  fixture.mounted().onProgress(100);
  assert.equal(fixture.percentage.textContent, '99%');
  request.resolve('demo-report');
  fixture.settled.resolve();
  assert.equal(await run, 'demo-report');
  assert.equal(fixture.percentage.textContent, '100%');
  assert.equal(fixture.attrs.get('aria-valuetext'), '100% · 시연 완료');
  fixture.loading.dispose();

  const nonBoolean = overlayFixture({ demo: 'true' });
  assert.equal(nonBoolean.percentage.textContent, '확인 중');
  assert.equal(nonBoolean.attrs.has('aria-valuenow'), false);
  nonBoolean.loading.dispose();
});

test('guest preview preserves the eye lifecycle without fabricating analysis progress or completion', async () => {
  const fixture = overlayFixture({ preview: true });
  const request = deferred();
  let progress;
  const run = fixture.loading.run((_signal, update) => {
    progress = update;
    return request.promise;
  });
  assert.match(fixture.dialog.innerHTML, /실제 분석은 로그인 후/);
  assert.doesNotMatch(fixture.dialog.innerHTML, /분석 서버가 보내는|시연용 진행률/);
  assert.equal(fixture.percentage.textContent, '준비 중');
  fixture.graphics.resolve(fixture.module);
  await nextTurn();
  fixture.mounted().onProgress(99);
  progress({ run: { progress_percent: 100, current_stage: 'completed' } });
  assert.equal(fixture.attrs.has('aria-valuenow'), false);
  assert.equal(fixture.percentage.textContent, '준비 중');
  request.resolve({ completed: false, preview_ready: true, analysis_pending: true });
  await nextTurn();
  assert.ok(fixture.events.includes('eye-complete'));
  assert.equal(fixture.attrs.get('aria-busy'), 'true');
  fixture.settled.resolve();
  const result = await run;
  assert.equal(result.completed, false);
  assert.equal(fixture.attrs.has('aria-valuenow'), false);
  assert.equal(fixture.percentage.textContent, '준비됨');
  assert.match(fixture.evaluationStatus.textContent, /로그인 후 실제 분석/);
  fixture.loading.dispose();
});

test('cancelling guest preview during its presentation cannot complete the locked view', async () => {
  const fixture = overlayFixture({ preview: true });
  fixture.graphics.resolve(fixture.module);
  const run = fixture.loading.run(async () => ({ completed: false, preview_ready: true }));
  await nextTurn();
  fixture.button.click();
  await assert.rejects(run, { name: 'AbortError' });
  fixture.settled.resolve();
  assert.equal(fixture.attrs.has('aria-valuenow'), false);
  assert.equal(fixture.events.filter((event) => event === 'cancelled').length, 1);
  assert.equal(fixture.document.body.style.overflow, 'auto');
});

test('unlocking a stored guest report only plays its reveal without another analysis minimum', async () => {
  const waits = [];
  const fixture = overlayFixture({ ready: true, now: 0, wait: async (duration) => { waits.push(duration); } });
  assert.match(fixture.dialog.innerHTML, /완성된 보고서를 열고/);
  assert.match(fixture.dialog.innerHTML, /추가 분석 없이/);
  assert.equal(fixture.percentage.textContent, '완료');
  fixture.graphics.resolve(fixture.module);
  fixture.settled.resolve();
  const result = await fixture.loading.run(async () => 'stored-authenticated-report');
  assert.equal(result, 'stored-authenticated-report');
  assert.deepEqual(waits, [0]);
  assert.equal(fixture.mounted().ready, true);
  assert.ok(fixture.events.includes('eye-complete'));
  fixture.loading.dispose();
});
