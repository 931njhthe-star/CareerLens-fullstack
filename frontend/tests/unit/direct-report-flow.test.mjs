import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { remainingEdits } from '../../src/app/workspace-state.js';
import { guestWorkspace, requestGuestReport } from '../../src/features/analysis/guest-state.js';
import { requestFinalReport } from '../../src/features/analysis/report-state.js';

// Run the controller and report requests together; replace only browser effects,
// the presentation clock and HTTP so every asynchronous boundary is controllable.
const controller = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
  .replace(/\bstart\(\);\s*$/, '');
const posting = { id: 'chosen/posting', company: '선택한 기업', role: '선택한 직무' };
const report = { score: 80, summary: '새 보고서', verdict: '분석 완료' };
const nextTurn = () => new Promise(setImmediate);
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function selectionFixture({
  member = true,
  hasResume = true,
  request,
  presentation,
  transition,
} = {}) {
  const events = [];
  const calls = [];
  const overlays = [];
  const routes = [];
  let hash = '#/jobs/chosen%2Fposting';
  const initialDraft = {
    ...(hasResume ? (member ? { resume_text: '저장된 이력서' } : { resume_attached: true }) : {}),
    career_target: { role_id: 'backend', label: '백엔드 개발자' },
    company: '이전 기업',
    role: '이전 직무',
    answers: { old: '이전 질문 답변' },
  };
  const selectedDraft = {
    ...initialDraft,
    selected_posting_id: posting.id,
    company: posting.company,
    role: posting.role,
    analysis_mode: 'job_posting',
    job_text: '선택한 공고 본문',
    answers: {},
    report: null,
  };
  const guestResponse = {
    completed: true,
    report_locked: true,
    expires_at: '2030-01-01T00:00:00Z',
    draft: {
      ...selectedDraft,
      resume_attached: true,
      resume_text: 'PRIVATE_GUEST_RESUME',
      answers: { old: 'PRIVATE_GUEST_ANSWER' },
      report: { ...report, summary: 'PRIVATE_GUEST_REPORT' },
    },
  };
  const location = {
    search: '',
    get hash() {
      return hash;
    },
    set hash(value) {
      hash = value.startsWith('#') ? value : `#${value}`;
      routes.push(hash);
      events.push(`route:${hash}`);
    },
  };
  function responseFor(path) {
    if (path.endsWith('/select')) return { draft: selectedDraft, questions: [] };
    if (path.endsWith('/cancel')) return { status: 'cancelled' };
    if (path === '/analysis') return { report };
    if (path === '/workspace') return { draft: { ...selectedDraft, report }, questions: [] };
    if (path === '/guest/analysis') return guestResponse;
    throw new Error(`Unexpected request: ${path}`);
  }
  const context = vm.createContext({
    document: { getElementById: () => ({ dataset: {} }) },
    window: { addEventListener() {} },
    location,
    URLSearchParams,
    DOMException,
    setTimeout() {},
    clearTimeout() {},
    remainingEdits,
    guestWorkspace,
    requestFinalReport,
    requestGuestReport,
    initialDraft: structuredClone(initialDraft),
    initialUser: member ? { id: 'member-a' } : null,
    createReportLoading(options) {
      const abort = new AbortController();
      const overlay = { options, signal: abort.signal, disposed: false };
      overlay.dispose = () => {
        overlay.disposed = true;
        abort.abort();
      };
      overlays.push(overlay);
      events.push('overlay');
      return {
        signal: abort.signal,
        async run(action) {
          const result = await action(abort.signal, () => {});
          events.push('analysis-ready');
          if (presentation) await presentation;
          abort.signal.throwIfAborted();
          return result;
        },
        async reveal(view) {
          events.push('transition-start');
          if (transition) await transition;
          abort.signal.throwIfAborted();
          view.onReveal();
        },
        dispose: overlay.dispose,
      };
    },
    api: async (path, options) => {
      events.push(path);
      calls.push({ path, options });
      return request ? request(path, options, responseFor) : responseFor(path);
    },
    bridgeEvent: (event) => events.push(event),
  });
  vm.runInContext(controller, context);
  vm.runInContext(
    `
    session = { user: initialUser };
    workspace = { draft: initialDraft, questions: [] };
    edits = { resume_text: '저장 전 이력서', answers: { old: '저장 전 답변' } };
    renderReportBridge = (loading) => {
      stopReportVisuals({ preserveLoading: loading });
      navigate('result');
      return {
        onReveal: () => bridgeEvent('report-reveal'),
        activate: () => bridgeEvent(loading.signal.aborted ? 'result-active' : 'active-before-modal-closed'),
      };
    };
  `,
    context,
  );
  return {
    events,
    calls,
    overlays,
    routes,
    location,
    select(value = posting) {
      context.chosenPosting = value;
      return vm.runInContext('selectPosting(chosenPosting)', context);
    },
    abort: () => vm.runInContext('stopReportVisuals()', context),
    changeSession: () =>
      vm.runInContext(
        `
      session = { user: { id: 'member-b' } };
      workspace = { draft: { resume_text: '다른 회원 이력서' }, questions: [] };
    `,
        context,
      ),
    attachResume: () => {
      selectedDraft.resume_text = '새로 저장한 이력서';
      selectedDraft.resume_attached = true;
      vm.runInContext(
        `
      workspace.draft.resume_text = '새로 저장한 이력서';
      workspace.draft.resume_attached = true;
    `,
        context,
      );
    },
    snapshot: () =>
      JSON.parse(vm.runInContext('JSON.stringify({ workspace, edits, selectedPosting })', context)),
  };
}

test('cancelling an active member analysis sends a backend cancellation request', async () => {
  const delayed = deferred();
  const fixture = selectionFixture({
    request: async (path, _options, responseFor) => {
      if (path === '/analysis') await delayed.promise;
      return responseFor(path);
    },
  });
  fixture.location.hash = '#/opportunities?role_id=backend';
  const completion = fixture.select();
  await nextTurn();
  const analysis = fixture.calls.find((call) => call.path === '/analysis');
  assert.ok(analysis);
  analysis.options.onProgress({ run: { id: 'run-123', status: 'running' } });
  fixture.overlays[0].dispose();
  fixture.overlays[0].options.onCancel();
  const cancellation = fixture.calls.find((call) => call.path === '/evaluations/run-123/cancel');
  assert.ok(cancellation);
  assert.equal(cancellation.options.method, 'POST');
  assert.equal(cancellation.options.keepalive, true);
  delayed.resolve();
  await completion;
});

for (const member of [true, false]) {
  const identity = member ? 'member' : 'guest';
  test(`${identity} posting selection shows the overlay before requests and opens only the final result`, async () => {
    const hold = deferred();
    const fixture = selectionFixture({ member, presentation: hold.promise });
    const completion = fixture.select();
    const prefix = member ? '' : '/guest';
    assert.deepEqual(fixture.events.slice(0, 2), [
      'overlay',
      `${prefix}/job-postings/chosen%2Fposting/select`,
    ]);
    assert.equal(fixture.overlays[0].options.draft.company, posting.company);
    assert.equal(fixture.overlays[0].options.draft.role, posting.role);
    await nextTurn();
    assert.deepEqual(
      fixture.calls.map(({ path }) => path),
      [
        `${prefix}/job-postings/chosen%2Fposting/select`,
        `${prefix}/analysis`,
        ...(member ? ['/workspace'] : []),
      ],
    );
    for (const { options } of fixture.calls.slice(0, 2)) {
      assert.equal(options.method, 'POST');
      assert.equal(options.signal, fixture.overlays[0].signal);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls[0].options.body)), {});
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls[1].options.body)), { answers: {} });
    assert.deepEqual(fixture.routes, [], 'presentation must finish before navigation');
    await fixture.select({ ...posting, id: 'duplicate-click' });
    assert.equal(fixture.overlays.length, 1);
    hold.resolve();
    await completion;
    assert.deepEqual(fixture.routes, ['#/result']);
    assert.equal(fixture.snapshot().selectedPosting, null);
    assert.equal(fixture.snapshot().edits.answers, undefined);
    assert.equal(fixture.snapshot().edits.resume_text, '저장 전 이력서');
    assert.equal(fixture.overlays[0].disposed, true);
    assert.ok(
      fixture.events.indexOf('analysis-ready') < fixture.events.indexOf('transition-start'),
    );
    assert.ok(fixture.events.indexOf('transition-start') < fixture.events.indexOf('report-reveal'));
    assert.equal(
      fixture.events.at(-1),
      'result-active',
      'result activates only after modal disposal',
    );
    if (member) assert.deepEqual(fixture.snapshot().workspace.draft.report, report);
    else {
      const state = fixture.snapshot();
      assert.equal(state.workspace.draft.report_locked, true);
      assert.equal(state.workspace.draft.expires_at, '2030-01-01T00:00:00Z');
      assert.doesNotMatch(JSON.stringify(state), /PRIVATE_GUEST|"score"/);
      assert.equal(state.workspace.draft.resume_text, undefined);
      assert.equal(state.workspace.draft.answers, undefined);
    }
  });

  test(`${identity} without a saved resume keeps the chosen posting and starts analysis after attaching it`, async () => {
    const fixture = selectionFixture({ member, hasResume: false });
    await fixture.select();
    assert.deepEqual(fixture.routes, ['#/resume']);
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.overlays.length, 0);
    assert.equal(fixture.snapshot().selectedPosting.id, posting.id);
    fixture.attachResume();
    await fixture.select(fixture.snapshot().selectedPosting);
    assert.equal(
      fixture.calls[0].path,
      `${member ? '' : '/guest'}/job-postings/chosen%2Fposting/select`,
    );
    assert.equal(fixture.routes.at(-1), '#/result');
  });

  test(`${identity} cancelling analysis started after resume attachment returns to the exact selected posting`, async () => {
    const delayed = deferred();
    const fixture = selectionFixture({
      member,
      hasResume: false,
      request: async (path, _options, responseFor) => {
        if (path.endsWith('/analysis')) await delayed.promise;
        return responseFor(path);
      },
    });
    await fixture.select();
    assert.equal(fixture.location.hash, '#/resume');
    fixture.attachResume();
    const completion = fixture.select(fixture.snapshot().selectedPosting);
    await nextTurn();
    assert.equal(
      fixture.snapshot().selectedPosting,
      null,
      'selection completed before cancellation',
    );
    assert.equal(fixture.calls.at(-1).path, `${member ? '' : '/guest'}/analysis`);
    const overlay = fixture.overlays[0];
    overlay.dispose();
    overlay.options.onCancel();
    assert.equal(overlay.signal.aborted, true);
    assert.deepEqual(fixture.routes, ['#/resume', '#/jobs/chosen%2Fposting']);
    delayed.resolve();
    await completion;
    assert.deepEqual(fixture.routes, ['#/resume', '#/jobs/chosen%2Fposting']);
    assert.ok(!fixture.events.includes('report-reveal'));
    assert.equal(
      fixture.calls.length,
      2,
      'cancelled analysis must not refresh or reveal its report',
    );
  });

  test(`${identity} stale selection and analysis responses cannot replace a changed page or session`, async (t) => {
    for (const phase of ['selection', 'analysis']) {
      for (const change of ['navigation', 'session']) {
        await t.test(`${change} during ${phase}`, async () => {
          const delayed = deferred();
          const fixture = selectionFixture({
            member,
            request: async (path, _options, responseFor) => {
              if (phase === 'selection' ? path.endsWith('/select') : path.endsWith('/analysis'))
                await delayed.promise;
              return responseFor(path);
            },
          });
          const completion = fixture.select();
          await nextTurn();
          if (change === 'navigation') fixture.abort();
          else fixture.changeSession();
          fixture.overlays[0].options.onCancel();
          const stateAfterChange = fixture.snapshot();
          delayed.resolve();
          await completion;
          assert.deepEqual(fixture.snapshot(), stateAfterChange);
          assert.deepEqual(fixture.routes, []);
          assert.equal(fixture.overlays[0].disposed, true);
          if (phase === 'selection') assert.equal(fixture.calls.length, 1);
        });
      }
    }
  });
}

test('failed direct analysis closes its overlay, stays on the posting and allows a new attempt', async () => {
  let fail = true;
  const fixture = selectionFixture({
    request: async (path, _options, responseFor) => {
      if (path === '/analysis' && fail) throw new Error('Synthetic analysis failure');
      return responseFor(path);
    },
  });
  await assert.rejects(fixture.select(), /Synthetic analysis failure/);
  assert.equal(fixture.overlays[0].disposed, true);
  assert.deepEqual(fixture.routes, []);
  assert.equal(fixture.snapshot().workspace.draft.report, null);
  fail = false;
  await fixture.select();
  assert.equal(fixture.overlays.length, 2);
  assert.deepEqual(fixture.routes, ['#/result']);
});

for (const member of [true, false]) {
  test(`${member ? 'member' : 'guest'} navigation during particles prevents late report activation`, async () => {
    const hold = deferred();
    const fixture = selectionFixture({ member, transition: hold.promise });
    const completion = fixture.select();
    await nextTurn();
    assert.ok(fixture.events.includes('transition-start'));
    assert.ok(!fixture.events.includes('report-reveal'));
    if (!member) assert.doesNotMatch(JSON.stringify(fixture.snapshot()), /PRIVATE_GUEST|"score"/);
    fixture.abort();
    const state = fixture.snapshot();
    hold.resolve();
    await completion;
    assert.ok(!fixture.events.includes('report-reveal'));
    assert.ok(!fixture.events.includes('result-active'));
    assert.deepEqual(fixture.snapshot(), state);
  });
}
