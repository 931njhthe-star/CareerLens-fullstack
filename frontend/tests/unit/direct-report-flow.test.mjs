import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { remainingEdits } from '../../src/app/workspace-state.js';
import { guestWorkspace, requestGuestReport } from '../../src/features/analysis/guest-state.js';
import { requestFinalReport } from '../../src/features/analysis/report-state.js';
import { createFlowStore } from '../../src/features/activity-flow/events.js';
import { ApiError } from '../../src/shared/api/client.js';

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
  guestPreview = false,
  guestUnavailable = false,
  hasResume = true,
  draftExtras = {},
  request,
  presentation,
  transition,
} = {}) {
  const events = [];
  const calls = [];
  const overlays = [];
  const routes = [];
  const notices = [];
  const progressUpdates = [];
  const flow = createFlowStore();
  let hash = '#/jobs/chosen%2Fposting';
  const initialDraft = {
    ...(hasResume ? (member ? { resume_text: '저장된 이력서' } : { resume_attached: true }) : {}),
    career_target: { role_id: 'backend', label: '백엔드 개발자' },
    company: '이전 기업',
    role: '이전 직무',
    answers: { old: '이전 질문 답변' },
    ...draftExtras,
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
    completed: !guestPreview,
    report_locked: true,
    ...(guestPreview ? { preview_ready: true, analysis_pending: true } : {}),
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
    if (path === '/auth/session') return {
      user: null,
      capabilities: { guest_analysis: !guestUnavailable, guest_report_preview: guestPreview },
    };
    if (path.endsWith('/select')) return { draft: selectedDraft, questions: [] };
    if (path === '/analysis') return { report };
    if (path === '/workspace') return { draft: { ...selectedDraft, report }, questions: [] };
    if (path === '/guest/analysis') return guestResponse;
    if (path === '/guest/analysis/cancel') return {
      completed: false, report_locked: false,
      draft: { ...selectedDraft, resume_attached: true },
    };
    throw new Error(`Unexpected request: ${path}`);
  }
  const context = vm.createContext({
    beginFlowEvent: flow.begin, finishFlowEvent: flow.finish, recordFlowEvent: flow.record,
    observeFlowProgress(update) { progressUpdates.push(update); },
    endFlowObservation(observation, options = {}) { events.push(`observation-ended:${options.confirmedCancelled === true ? 'confirmed' : 'stopped'}`); },
    setFlowSession() {}, mountFlowLauncher() {},
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
    guestPreview,
    guestUnavailable,
    setSession(value) { events.push(`session:${value.user?.id || 'guest'}`); },
    notice(message, kind) { notices.push({ message, kind }); },
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
          try {
            const result = await action(abort.signal, () => {});
            events.push('analysis-ready');
            if (presentation) await presentation;
            abort.signal.throwIfAborted();
            return result;
          } catch (error) {
            // The real loading presentation also aborts while cleaning up failures.
            abort.abort();
            throw error;
          }
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
    session = {
      user: initialUser,
      ...(guestPreview ? { capabilities: { guest_analysis: false, guest_report_preview: true } } : {}),
      ...(guestUnavailable ? { capabilities: { guest_analysis: false, guest_report_preview: false } } : {}),
    };
    workspace = { draft: initialDraft, questions: [] };
    edits = { resume_text: '저장 전 이력서', answers: { old: '저장 전 답변' } };
    render = () => { stopReportVisuals(); bridgeEvent('rerender'); };
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
    flow,
    calls,
    overlays,
    routes,
    notices,
    progressUpdates,
    location,
    select(value = posting, options) {
      context.chosenPosting = value;
      context.selectionOptions = options;
      return vm.runInContext('selectPosting(chosenPosting, selectionOptions)', context);
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

test('unavailable guest analysis stays on the posting and cannot fake a completed gate or defer analysis to login', async () => {
  const fixture = selectionFixture({ member: false, guestUnavailable: true });
  await fixture.select();
  assert.equal(fixture.overlays.length, 0);
  assert.deepEqual(fixture.calls.map(({ path }) => path), ['/auth/session']);
  assert.equal(fixture.routes.length, 0);
  assert.equal(fixture.location.hash, '#/jobs/chosen%2Fposting');
  assert.equal(fixture.notices.length, 1);
  assert.equal(fixture.notices[0].kind, 'error');
  assert.match(fixture.notices[0].message, /비회원 분석 서비스에 연결할 수 없습니다/);
  assert.doesNotMatch(fixture.notices[0].message, /로그인|회원가입|완료/);
  assert.equal(fixture.events.includes('report-reveal'), false);
});

for (const member of [false, true]) {
  test(`${member ? 'member' : 'guest'} loading clears an old report and rejects progress from a replaced view`, async () => {
    const response = deferred();
    let progress;
    const fixture = selectionFixture({ member, request: async (path, options, responseFor) => {
      if (path === (member ? '/analysis' : '/guest/analysis')) {
        progress = options.onProgress;
        await response.promise;
      }
      return responseFor(path);
    } });
    fixture.flow.record('analysis', { state: 'complete', progress: 100, source: 'backend' });
    fixture.flow.record('report');
    const pending = fixture.select();
    await nextTurn();
    assert.equal(typeof progress, 'function');
    progress({ run: { status: 'running', progress_percent: 52 } });
    assert.equal(fixture.progressUpdates.length, 1);
    assert.equal(fixture.flow.snapshot().states.some(({ node }) => node === 'report'), false);
    fixture.abort();
    progress({ run: { status: 'completed', progress_percent: 100 } });
    assert.equal(fixture.progressUpdates.length, 1, 'late completion must not overwrite the current flow');
    response.resolve();
    await pending;
    assert.equal(fixture.flow.snapshot().states.some(({ node }) => node === 'report'), false);
  });
}

test('guest analysis recovers a stale unavailable capability after choosing a posting then attaching a resume', async () => {
  const fixture = selectionFixture({
    member: false, guestUnavailable: true, hasResume: false,
    request: async (path, _options, responseFor) => path === '/auth/session'
      ? { user: null, capabilities: { guest_analysis: true, guest_report_preview: false } }
      : responseFor(path),
  });
  await fixture.select();
  assert.deepEqual(fixture.routes, ['#/resume']);
  assert.equal(fixture.calls.length, 0);
  fixture.attachResume();
  await fixture.select(fixture.snapshot().selectedPosting);
  assert.deepEqual(fixture.calls.map(({ path }) => path), [
    '/auth/session', '/guest/job-postings/chosen%2Fposting/select', '/guest/analysis',
  ]);
  assert.equal(fixture.overlays.length, 1);
  assert.equal(fixture.overlays[0].options.preview, false);
  assert.equal(fixture.routes.at(-1), '#/result');
  assert.equal(fixture.notices.length, 0);
});

for (const supersede of ['navigation', 'account']) {
  test(`guest capability recovery cannot start analysis after ${supersede} changes`, async () => {
    const waiting = deferred();
    const fixture = selectionFixture({
      member: false, guestUnavailable: true,
      request: async (path, _options, responseFor) => path === '/auth/session'
        ? waiting.promise : responseFor(path),
    });
    const completion = fixture.select();
    if (supersede === 'navigation') fixture.abort();
    else fixture.changeSession();
    waiting.resolve({ user: null, capabilities: { guest_analysis: true, guest_report_preview: false } });
    await completion;
    assert.deepEqual(fixture.calls.map(({ path }) => path), ['/auth/session']);
    assert.equal(fixture.overlays.length, 0);
    assert.equal(fixture.notices.length, 0);
    assert.equal(fixture.events.includes('session:guest'), false);
  });
}

test('failed guest capability refresh does not start loading or lose the selected posting', async () => {
  const fixture = selectionFixture({
    member: false, guestUnavailable: true,
    request: async (path, _options, responseFor) => {
      if (path === '/auth/session') throw new Error('network unavailable');
      return responseFor(path);
    },
  });
  await fixture.select();
  assert.equal(fixture.overlays.length, 0);
  assert.equal(fixture.snapshot().selectedPosting.id, posting.id);
  assert.match(fixture.notices[0].message, /비회원 분석 서비스에 연결할 수 없습니다/);
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
    assert.equal(fixture.flow.snapshot().events.some((event) => event.node === 'report'), false);
    await fixture.select({ ...posting, id: 'duplicate-click' });
    assert.equal(fixture.overlays.length, 1);
    hold.resolve();
    await completion;
    assert.deepEqual(fixture.routes, ['#/result']);
    assert.equal(fixture.snapshot().selectedPosting, null);
    assert.equal(fixture.snapshot().edits.answers, undefined);
    assert.equal(fixture.snapshot().edits.resume_text, '저장 전 이력서');
    assert.equal(fixture.overlays[0].disposed, true);
    if (member) {
      assert.equal(fixture.flow.snapshot().events.at(-1).node, 'report');
      assert.equal(fixture.flow.snapshot().events.at(-1).state, 'complete');
    } else {
      assert.equal(fixture.flow.snapshot().events.some((event) => event.node === 'report'), false,
        'a guest login gate is not an opened report');
      assert.equal(fixture.flow.snapshot().events.find((event) => event.node === 'evaluate').state, 'complete');
    }
    assert.doesNotMatch(JSON.stringify(fixture.flow.snapshot()), /PRIVATE|chosen|저장 전|기업/);
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
    assert.equal(fixture.flow.snapshot().events.some((event) => event.node === 'report'), false);
    assert.equal(fixture.flow.snapshot().events.find((event) => event.node === 'evaluate').state, 'cancelled');
    const cancellations = fixture.flow.snapshot().events.filter(({ node }) => node === 'cancel');
    assert.equal(cancellations.length, 1, 'one cancellation action owns its start and finish');
    assert.equal(cancellations[0].state, 'cancelled', 'cancelling before a run ID exists finishes the local action');
    assert.equal(fixture.calls.some(({ path }) => path.endsWith('/cancel')), !member,
      'guest cancellation delegates to its retained temporary run; members wait for a run ID');
    assert.equal(
      fixture.calls.length,
      member ? 2 : 3,
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
  assert.equal(fixture.flow.snapshot().events.some((event) => event.node === 'report'), false);
  assert.equal(fixture.flow.snapshot().events.find((event) => event.node === 'evaluate').state, 'failed');
  assert.ok(fixture.events.includes('observation-ended:stopped'), 'failed transport releases active progress without inventing a server failure');
  assert.ok(!fixture.events.includes('observation-ended:confirmed'));
  fail = false;
  await fixture.select();
  assert.equal(fixture.overlays.length, 2);
  assert.deepEqual(fixture.routes, ['#/result']);
});

test('a displayed partial report remains partial in the browser evaluation lifecycle', async () => {
  const fixture = selectionFixture({
    request: async (path, _options, responseFor) => {
      const result = responseFor(path);
      if (path === '/analysis') result.report = { ...result.report, status: 'partial' };
      if (path === '/workspace') result.draft.report = { ...result.draft.report, status: 'partial' };
      return result;
    },
  });
  await fixture.select();
  const observations = fixture.flow.snapshot().events;
  assert.equal(observations.find(({ node }) => node === 'evaluate').state, 'partial');
  assert.equal(observations.some(({ node }) => node === 'analysis'), false,
    'browser presentation must not fabricate a backend worker completion');
  assert.equal(observations.find(({ node }) => node === 'report').state, 'complete');
});

for (const [code, expectedState] of [['evaluation_failed', 'failed'], ['evaluation_cancelled', 'cancelled']]) {
  test(`backend ${code} remains ${expectedState} after loading cleanup aborts the signal`, async () => {
    const failure = new ApiError('', 502, code);
    const fixture = selectionFixture({
      request: async (path, options, responseFor) => {
        if (path === '/analysis') {
          options.onProgress({ run: { status: expectedState, progress_percent: null } });
          throw failure;
        }
        return responseFor(path);
      },
    });
    await assert.rejects(fixture.select(), (error) => error === failure);
    assert.equal(fixture.overlays[0].signal.aborted, true);
    assert.equal(fixture.flow.snapshot().events.find((event) => event.node === 'evaluate').state, expectedState);
    assert.equal(fixture.flow.snapshot().events.some((event) => event.node === 'report'), false);
  });
}

test('backend guest preview uses the eye and locked shell without a real evaluation or completed-report event', async () => {
  const fixture = selectionFixture({ member: false, guestPreview: true });
  await fixture.select();
  assert.deepEqual(fixture.calls.map(({ path }) => path), [
    '/guest/job-postings/chosen%2Fposting/select', '/guest/analysis',
  ]);
  assert.equal(fixture.overlays[0].options.preview, true);
  assert.equal(fixture.overlays[0].options.demo, false);
  assert.deepEqual(fixture.routes, ['#/result']);
  assert.equal(fixture.snapshot().workspace.draft.report_locked, true);
  assert.equal(fixture.snapshot().workspace.draft.analysis_pending, true);
  assert.equal(fixture.snapshot().workspace.draft.report, undefined);
  assert.doesNotMatch(JSON.stringify(fixture.snapshot()), /PRIVATE_GUEST|"score"/);
  const observations = fixture.flow.snapshot().events;
  assert.equal(observations.find(({ node }) => node === 'evaluate').state, 'waiting');
  assert.equal(observations.some(({ node }) => node === 'report'), false);
  assert.ok(fixture.events.indexOf('transition-start') < fixture.events.indexOf('report-reveal'));
  assert.equal(fixture.events.at(-1), 'result-active');
});

test('cancelling a prepared guest preview never reveals the gate or sends a server cancellation', async () => {
  const hold = deferred();
  const fixture = selectionFixture({ member: false, guestPreview: true, presentation: hold.promise });
  const completion = fixture.select();
  await nextTurn();
  fixture.overlays[0].options.onCancel();
  fixture.abort();
  hold.resolve();
  await completion;
  assert.equal(fixture.location.hash, '#/jobs/chosen%2Fposting');
  assert.ok(fixture.events.includes('rerender'), 'returning to the current posting releases the loading overlay');
  assert.equal(fixture.calls.some(({ path }) => path.includes('/evaluations/') || path === '/analysis'), false);
  assert.equal(fixture.calls.filter(({ path }) => path === '/guest/analysis/cancel').length, 1);
  assert.equal(fixture.snapshot().workspace.draft.report_locked, false);
  assert.equal(fixture.events.includes('report-reveal'), false);
  assert.equal(fixture.flow.snapshot().events.find(({ node }) => node === 'evaluate').state, 'cancelled');
});

test('a failed guest cancellation does not claim server cleanup succeeded', async () => {
  const hold = deferred();
  const fixture = selectionFixture({ member: false, presentation: hold.promise,
    request: async (path, _options, responseFor) => {
      if (path === '/guest/analysis/cancel') throw new Error('cancel connection unavailable');
      return responseFor(path);
    } });
  const completion = fixture.select();
  await nextTurn();
  fixture.overlays[0].options.onCancel();
  fixture.abort();
  hold.resolve();
  await completion;
  await nextTurn();
  const observations = fixture.flow.snapshot().events;
  assert.equal(observations.find(({ node }) => node === 'cancel')?.state, 'failed');
  assert.equal(observations.some(({ node }) => node === 'guest_cleanup'), false);
  assert.equal(observations.some(({ node }) => node === 'report'), false);
});

test('a late guest preview cannot replace a newly authenticated account workspace', async () => {
  const hold = deferred();
  const fixture = selectionFixture({
    member: false,
    guestPreview: true,
    request: async (path, _options, responseFor) => {
      if (path === '/guest/analysis') await hold.promise;
      return responseFor(path);
    },
  });
  const completion = fixture.select();
  await nextTurn();
  fixture.changeSession();
  const authenticated = fixture.snapshot();
  hold.resolve();
  await completion;
  assert.deepEqual(fixture.snapshot(), authenticated);
  assert.equal(fixture.events.includes('report-reveal'), false);
  assert.deepEqual(fixture.routes, []);
});

test('authenticated continuation preserves its claimed selection and starts one real analysis', async () => {
  const fixture = selectionFixture({
    draftExtras: {
      pending_guest_analysis: true,
      selected_posting_id: posting.id,
      selected_posting: { ...posting, source_type: 'backend' },
    },
  });
  await fixture.select(posting, { continuePending: true });
  assert.deepEqual(fixture.calls.map(({ path }) => path), ['/analysis', '/workspace']);
  assert.equal(fixture.overlays.length, 1);
  assert.equal(fixture.overlays[0].options.preview, false);
  assert.deepEqual(fixture.snapshot().workspace.draft.report, report);
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
