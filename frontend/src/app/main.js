import { api, getSession, setSession, completeAuthCallback } from '../shared/api/client.js';
import { publicErrorMessage } from '../shared/api/error-messages.js';
import { shell, notice, pending, bindCounters, escapeHtml } from '../shared/components/ui.js';
import { renderAuth, bindAuth } from '../features/auth/auth.js';
import { consumeAuthCallback, parseAuthCallback } from '../features/auth/auth-callback.js';
import { workspacePage } from '../pages/workspace.js';
import { myPage, savedReportsList, filterSavedReports } from '../pages/my-page.js';
import { adminDashboard, mountAdminDashboard } from '../pages/admin-dashboard.js';
import { analysisReport } from '../features/analysis/report.js';
import { bindSavedReportPicker } from '../features/analysis/saved-report-picker.js';
import { draftForPage, remainingEdits } from './workspace-state.js';
import { createReportLoading } from '../features/analysis/report-loading.js';
import { requestFinalReport } from '../features/analysis/report-state.js';
import { roleChoicesMarkup } from '../features/job-postings/job.js';
import { catalogRoute } from '../features/job-postings/catalog-state.js';
import {
  bindCatalog,
  stopCatalogLoad,
  hasCatalogEdits,
  clearCatalogEdits,
} from '../features/job-postings/catalog.js';
import { jobsLoading } from '../pages/jobs.js';
import { bindResumeExamples, stopResumeExamples } from '../features/resumes/examples.js';
import { guestResumePage, guestFileMetadata } from '../features/resumes/guest.js';
import { validateResumeFile } from '../features/resumes/file-preflight.js';
import { opportunityRoute, opportunityPath } from '../features/job-postings/opportunity-state.js';
import { opportunitiesPage } from '../pages/opportunities.js';
import { bindOpportunities } from '../features/job-postings/opportunities.js';
import {
  guestWorkspace,
  requestGuestReport,
  practiceDestination,
} from '../features/analysis/guest-state.js';
import { introductionPage } from '../pages/introduction.js';
import { bindIntroduction } from '../features/introduction/intro.js';
import { reportGatePage, bindReportGate } from '../features/auth/report-gate.js';
import {
  beginFlowEvent,
  finishFlowEvent,
  recordFlowEvent,
  observeFlowProgress,
  setFlowSession,
  mountFlowLauncher,
} from '../features/activity-flow/events.js';

const app = document.getElementById('app');
const authPages = new Set(['login', 'email', 'signup', 'forgot', 'reset']);
const workflowPages = new Set(['resume', 'desired-role', 'result']);
const params = new URLSearchParams(location.search);
const flowViewer = params.get('view') === 'flow';
const resetToken = params.get('reset_token') || '';
let authError = params.get('auth_error');
let session;
let workspace = { draft: {}, questions: [] };
let edits = {};
let navigationMessage;
let returnAfterLogin;
let loginMessage;
let selectedPosting;
let selectionOwner;
let disposeReportLoading;
let roleRequest;
let disposeStatusRadar;
let disposeReportPicker;
let reportPickerState = {};
let reportPickerOwner;
let disposeAdminDashboard;
let viewRevision = 0;
const guest = { filename: '', target: null };
let disposeOpportunities;
let disposeIntroduction;
let disposeReportGate;
let guestExpiryTimer;
let accountRequest;
let previousFlowRoute;
const flowSource = () => session?.user?.demo === true ? 'demo' : 'observed';

async function observeFlowAction(node, action, { current = () => true } = {}) {
  const observation = beginFlowEvent(node, { source: flowSource() });
  try {
    const result = await action();
    finishFlowEvent(observation, { state: current() ? 'complete' : 'cancelled' });
    return result;
  } catch (error) {
    const stale = !current();
    finishFlowEvent(observation, {
      state: stale || error.name === 'AbortError' ? 'cancelled' : 'failed',
    });
    if (stale) throw new DOMException('요청한 화면이 변경되었습니다.', 'AbortError');
    throw error;
  }
}

async function validateObservedResume(file) {
  const observation = beginFlowEvent('input_check', { source: flowSource() });
  try {
    await validateResumeFile(file);
    finishFlowEvent(observation);
  } catch (error) {
    finishFlowEvent(observation, { state: 'blocked' });
    throw error;
  }
}

function flowSession(options) {
  const mode = session?.user?.demo === true ? 'demo' : session?.user ? 'member' : 'guest';
  setFlowSession(mode, options);
  recordFlowEvent('auth', { kind: 'session', source: mode === 'demo' ? 'demo' : 'observed' });
}

// Reloads and authentication returns query the durable guest run. Rehydrate only
// its safe progress metadata; a missing event is never inferred from completion.
function readGuestWorkspace({ signal } = {}) {
  const revision = viewRevision;
  const owner = session?.user?.id;
  return api('/guest/workspace', { signal, onProgress(update) {
    if (!signal?.aborted && revision === viewRevision && owner === session?.user?.id)
      observeFlowProgress(update);
  } });
}
function stopReportVisuals({ preserveLoading } = {}) {
  viewRevision += 1;
  disposeIntroduction?.();
  disposeIntroduction = undefined;
  disposeReportGate?.();
  disposeReportGate = undefined;
  if (disposeReportLoading !== preserveLoading?.dispose) {
    disposeReportLoading?.({ cancelAnalysis: true });
    disposeReportLoading = undefined;
  }
  delete app.dataset.reportTransition;
  roleRequest?.abort();
  roleRequest = undefined;
  accountRequest?.abort();
  accountRequest = undefined;
  disposeStatusRadar?.();
  disposeStatusRadar = undefined;
  disposeReportPicker?.();
  disposeReportPicker = undefined;
  disposeAdminDashboard?.();
  disposeAdminDashboard = undefined;
  disposeOpportunities?.();
  disposeOpportunities = undefined;
}

async function mountReportVisuals(report = workspace.draft.report || {}) {
  const radarHost = document.querySelector('[data-status-radar]');
  const revision = viewRevision;

  async function mountRadar() {
    if (!radarHost) return;
    try {
      const { mountStatusRadar } = await import('../features/analysis/status-radar.js');
      if (revision !== viewRevision || !radarHost.isConnected) return;
      disposeStatusRadar = mountStatusRadar(radarHost, report);
    } catch {
      if (revision !== viewRevision || !radarHost.isConnected) return;
      radarHost.textContent =
        '그래프를 불러오지 못했습니다. 아래 점수표에서 분석 결과를 확인해 주세요.';
    }
  }

  // Both modules share the navigation revision, so a replaced report cannot remount.
  await mountRadar();
}

function isAccountPage(page) {
  return page === 'mypage' || page === 'admin' || /^reports\/[^/?#]+$/.test(page || '');
}

function requireLogin(page, message) {
  recordFlowEvent('notice', { state: 'blocked', source: flowSource() });
  returnAfterLogin = page;
  loginMessage =
    message || '모의지원은 로그인이 필요합니다. 로그인하거나 회원가입한 뒤 이어가 주세요.';
  navigate('email');
}

async function selectPosting(posting, { continuePending = false } = {}) {
  if (disposeReportLoading) return;
  recordFlowEvent('posting', { source: session.user?.demo === true ? 'demo' : 'observed' });
  selectedPosting = posting;
  selectionOwner = session.user?.id;
  const member = Boolean(session.user);
  if (!(member ? workspace.draft.resume_text : workspace.draft.resume_attached)) {
    recordFlowEvent('input_check', { state: 'blocked', source: flowSource() });
    navigationMessage = '선택한 공고로 분석하려면 이력서를 먼저 첨부하거나 저장해 주세요.';
    navigate('resume');
    return;
  }
  let guestPreview = !member && session.capabilities?.guest_analysis === false && session.capabilities?.guest_report_preview === true;
  if (!member && session.capabilities?.guest_analysis === false && !guestPreview) {
    // A server restart can restore guest analysis while this page still has the
    // unavailable capability captured at startup. Recheck before blocking it.
    const capabilityRevision = viewRevision;
    const capabilitySession = session;
    const current = () => capabilityRevision === viewRevision && session === capabilitySession &&
      !session.user && selectedPosting === posting && !disposeReportLoading;
    let refreshed;
    try {
      refreshed = await api('/auth/session');
    } catch {
      // Keep the existing unavailable state and actionable message below.
    }
    if (!current() || refreshed?.user) return;
    if (refreshed && typeof refreshed.capabilities?.guest_analysis === 'boolean') {
      session = refreshed;
      setSession(session);
      guestPreview = session.capabilities.guest_analysis === false && session.capabilities.guest_report_preview === true;
    }
  }
  if (!member && session.capabilities?.guest_analysis === false && !guestPreview) {
    recordFlowEvent('notice', { state: 'blocked', source: flowSource() });
    notice('비회원 분석 서비스에 연결할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.', 'error');
    return;
  }

  let revision = viewRevision;
  const owner = session.user?.id;
  const answers = {};
  let evaluationRunId;
  let guestAnalysisStarted = false;
  let cancellationRequested = false;
  let cancellationSent = false;
  let cancellationObservation;
  function cancelEvaluation() {
    if (!cancellationRequested)
      cancellationObservation = beginFlowEvent('cancel', { source: flowSource() });
    cancellationRequested = true;
    if (!member && guestAnalysisStarted && !cancellationSent) {
      cancellationSent = true;
      const cancelRevision = viewRevision;
      void api('/guest/analysis/cancel', { method: 'POST', body: {} })
        .then((result) => {
          if (owner === session.user?.id && cancelRevision === viewRevision) applyGuestWorkspace(result);
          finishFlowEvent(cancellationObservation, { state: 'cancelled' });
          recordFlowEvent('guest_cleanup', { state: 'cancelled', execution: 'guest', source: flowSource() });
        })
        .catch(() => finishFlowEvent(cancellationObservation, { state: 'failed' }));
      return;
    }
    if (!evaluationRunId || cancellationSent || !member) return;
    cancellationSent = true;
    void api(`/evaluations/${encodeURIComponent(evaluationRunId)}/cancel`, {
      method: 'POST',
      body: {},
      keepalive: true,
    }).then(() => finishFlowEvent(cancellationObservation)).catch((error) => {
      finishFlowEvent(cancellationObservation, {
        state: error.name === 'AbortError' ? 'cancelled' : 'failed',
      });
      if (error.status !== 409 && owner === session.user?.id)
        notice(publicErrorMessage(error), 'error');
    });
  }
  const loading = createReportLoading({
    demo: session.user?.demo === true,
    preview: guestPreview,
    draft: {
      ...workspace.draft,
      analysis_mode: 'job_posting',
      company: posting.company,
      role: posting.role,
    },
    onCancel() {
      cancelEvaluation();
      if (revision === viewRevision && owner === session.user?.id)
        navigate(`jobs/${encodeURIComponent(posting.id)}`);
    },
  });
  const analysisObservation = beginFlowEvent('evaluate', {
    source: session.user?.demo === true ? 'demo' : 'observed',
    ...(!member ? { execution: 'guest' } : {}),
  });
  let analysisObservedComplete = false;
  let analysisObservationError;
  disposeReportLoading = loading.dispose;
  try {
    const result = await loading.run(async (signal, onProgress) => {
      const selection = continuePending
        ? null
        : await api(
            `${member ? '' : '/guest'}/job-postings/${encodeURIComponent(posting.id)}/select`,
            { method: 'POST', body: {}, signal },
          );
      signal.throwIfAborted();
      if (revision !== viewRevision || owner !== session.user?.id)
        throw new DOMException('분석 화면이 변경되었습니다.', 'AbortError');
      if (selection) {
        if (member) applyWorkspace(selection, ['answers']);
        else applyGuestWorkspace(selection);
      }
      selectedPosting = null;
      delete edits.answers;
      if (!member) guestAnalysisStarted = true;
      return member
        ? requestFinalReport({
            draft: workspace.draft,
            answers,
            signal,
            request: api,
            onProgress(update) {
              if (update.run?.id) evaluationRunId = update.run.id;
              if (cancellationRequested) cancelEvaluation();
              if (loading.signal.aborted || revision !== viewRevision || owner !== session.user?.id) return;
              observeFlowProgress(update, { demo: session.user?.demo === true });
              onProgress(update);
            },
          })
        : requestGuestReport({ answers, signal, request: api, onProgress(update) {
            if (loading.signal.aborted || revision !== viewRevision || owner !== session.user?.id) return;
            observeFlowProgress(update);
            onProgress(update);
          } });
    });
    if (loading.signal.aborted || revision !== viewRevision || owner !== session.user?.id) return;
    // Guest reports are already reduced to the safe workspace shape by requestGuestReport.
    applyWorkspace(result, ['answers']);
    let view;
    try {
      view = renderReportBridge(loading);
    } finally {
      // This synchronous render owns one new revision even if markup fails.
      revision = viewRevision;
    }
    await loading.reveal(view);
    if (loading.signal.aborted || revision !== viewRevision || owner !== session.user?.id) return;
    finishFlowEvent(analysisObservation, {
      state: guestPreview ? 'waiting' : (workspace.draft.report?.status || workspace.draft.analysis_status) === 'partial' ? 'partial' : 'complete',
    });
    analysisObservedComplete = true;
    if (member && workspace.draft.report)
      recordFlowEvent('report', { source: session.user?.demo === true ? 'demo' : 'observed' });
    loading.dispose({ restoreFocus: false });
    view.activate?.();
    if (!member)
      recordFlowEvent('report_lock', { state: 'waiting', execution: 'guest', source: flowSource() });
  } catch (error) {
    analysisObservationError = error;
    if (revision === viewRevision && owner === session.user?.id && error.name !== 'AbortError') {
      delete app.dataset.reportTransition;
      throw error;
    }
  } finally {
    if (!analysisObservedComplete) {
      // Loading cleanup aborts its signal on every error. Use the actual failure
      // category; an aborted cleanup signal alone does not mean user cancellation.
      const cancelled =
        cancellationRequested ||
        analysisObservationError?.name === 'AbortError' ||
        analysisObservationError?.code === 'evaluation_cancelled' ||
        (!analysisObservationError && loading.signal.aborted);
      finishFlowEvent(analysisObservation, { state: cancelled ? 'cancelled' : 'failed' });
    }
    // If no server run was ever created, this ends only the local operation;
    // it must not leave a pending marker or imply a confirmed server cancellation.
    if (cancellationRequested && !cancellationSent)
      finishFlowEvent(cancellationObservation, { state: 'cancelled' });
    loading.dispose();
    if (disposeReportLoading === loading.dispose) disposeReportLoading = undefined;
  }
}

function renderReportBridge(loading) {
  // pushState avoids a second asynchronous hashchange render disposing the bridge.
  history.pushState({}, '', `${location.pathname}${location.search}#/result`);
  return render({ reportBridge: loading });
}

function navigate(page) {
  if (location.hash === `#/${page}`) render();
  else location.hash = `/${page}`;
}

function applyWorkspace(result, savedFields = []) {
  edits = remainingEdits(edits, savedFields, workspace.draft, result.draft);
  if (result.draft) workspace.draft = result.draft;
  if (result.questions) workspace.questions = result.questions;
}

async function loadWorkspace(savedFields = [], current = () => true) {
  const result = await api('/workspace');
  if (current()) applyWorkspace(result, savedFields);
}

function applyGuestWorkspace(result) {
  workspace = guestWorkspace(result);
  guest.filename = workspace.draft.filename;
  guest.target = workspace.draft.career_target;
  clearTimeout(guestExpiryTimer);
  const expires = Date.parse(workspace.draft.expires_at);
  if (!session.user && Number.isFinite(expires)) {
    guestExpiryTimer = setTimeout(
      async () => {
        if (session.user) return;
        try {
          const refreshed = await readGuestWorkspace();
          if (session.user) return;
          applyGuestWorkspace(refreshed);
          if (!refreshed.expired && Date.parse(workspace.draft.expires_at) > Date.now()) return;
          recordFlowEvent('guest_cleanup', { state: 'expired', execution: 'guest', source: flowSource() });
          edits = {};
          selectedPosting = null;
          const message =
            '임시 보관 시간이 지나 준비한 자료가 만료되었습니다. 이력서를 다시 첨부해 주세요.';
          if (authPages.has(location.hash.slice(2)))
            notice(message, 'info', document.getElementById('auth-notices'));
          else {
            navigationMessage = message;
            navigate('resume');
          }
        } catch (error) {
          await handleError(error);
        }
      },
      Math.max(100, expires - Date.now() + 100),
    );
  }
}

async function claimCompletedGuest({ completed = false } = {}) {
  let observation;
  const owner = session.user?.id;
  const revision = viewRevision;
  const controller = new AbortController();
  accountRequest?.abort();
  accountRequest = controller;
  const current = () => !controller.signal.aborted && owner === session.user?.id && revision === viewRevision;
  try {
    // The visible locked result already confirmed completion. The claim endpoint
    // still verifies readiness, expiry and ownership; another metadata round trip
    // would only delay displaying the saved result after authentication.
    const temporary = completed
      ? { completed: true }
      : await readGuestWorkspace({ signal: controller.signal });
    if (!current()) return 'superseded';
    if (temporary.expired || (returnAfterLogin === 'result' && !temporary.completed && !temporary.preview_ready)) {
      recordFlowEvent('guest_cleanup', { state: 'expired', execution: 'guest', source: flowSource() });
      navigationMessage =
        '임시 분석 자료가 만료되어 결과를 연결하지 못했습니다. 이력서를 다시 첨부해 주세요.';
      return 'expired';
    }
    const stagedResume = session.backend_adapter && temporary.draft?.resume_attached;
    if (!temporary.completed && !stagedResume) return false;
    if (temporary.completed)
      observation = beginFlowEvent('guest_claim', { execution: 'guest', source: flowSource() });
    try {
      const claimed = await api('/guest/claim', { method: 'POST', body: {}, signal: controller.signal });
      if (!current()) return 'superseded';
      applyWorkspace(claimed);
      if (temporary.completed && workspace.draft.report)
        finishFlowEvent(observation);
    } catch (error) {
      if (!current()) return 'superseded';
      if (error.status !== 410 && !['guest_missing', 'guest_expired'].includes(error.code)) throw error;
      finishFlowEvent(observation, { state: 'expired' });
      recordFlowEvent('guest_cleanup', { state: 'expired', execution: 'guest', source: flowSource() });
      navigationMessage =
        '보고서를 연결하기 전에 임시 자료가 만료되거나 파기되었습니다. 이력서를 다시 첨부해 주세요.';
      return 'expired';
    }
    clearTimeout(guestExpiryTimer);
    guest.filename = '';
    guest.target = null;
    selectedPosting = null;
    return temporary.completed ? 'claimed' : 'prepared';
  } catch (error) {
    if (!current()) return 'superseded';
    finishFlowEvent(observation, { state: 'failed' });
    throw error;
  } finally {
    finishFlowEvent(observation, { state: 'cancelled' });
    if (accountRequest === controller) accountRequest = undefined;
  }
}

function openReportLogin(page) {
  returnAfterLogin = 'result';
  loginMessage = null;
  navigate(page);
}

// A guest's confirmed request continues only with the newly authenticated owner.
// A completed claim already contains the report: authentication must not replay
// the loading presentation or submit another evaluation.
async function continueGuestReport({ claimed, accountDestination = false, deliveryObservation } = {}) {
  if (accountDestination || !session.user || claimed === 'expired') return false;
  const draft = workspace.draft;
  const completed = claimed === 'claimed' && draft.report;
  const posting = !completed && draft.pending_guest_analysis && draft.selected_posting;
  if (!posting?.id && !completed) return false;
  if (posting?.id && !draft.resume_text) return false;
  const owner = session.user.id;
  returnAfterLogin = null;
  stopReportVisuals();
  history.replaceState({}, '', `${location.pathname}${location.search}#/${posting?.id ? `jobs/${encodeURIComponent(posting.id)}` : 'result'}`);
  try {
    if (posting?.id) {
      await selectPosting(posting, { continuePending: true });
    } else {
      render();
      if (owner === session.user?.id && location.hash === '#/result' && workspace.draft.report) {
        recordFlowEvent('report_lock', { state: 'complete', execution: 'guest', source: flowSource() });
        finishFlowEvent(deliveryObservation);
      }
    }
  } catch (error) {
    finishFlowEvent(deliveryObservation, { state: error.name === 'AbortError' ? 'cancelled' : 'failed' });
    if (owner === session.user?.id && error.name !== 'AbortError') {
      render();
      await handleError(error);
    }
  }
  return true;
}

async function discardGuest() {
  applyGuestWorkspace(await observeFlowAction('guest_cleanup',
    () => api('/guest/workspace', { method: 'DELETE' })));
  recordFlowEvent('guest_cleanup', { state: 'cleared', execution: 'guest', source: flowSource() });
  edits = {};
  selectedPosting = null;
  returnAfterLogin = null;
  navigationMessage = '임시 보관한 자료를 파기했습니다.';
  navigate('resume');
}

function prepareAccountChange(nextSession) {
  if (session?.user?.id !== nextSession.user?.id) {
    // A guest result belongs to the same journey after signup/login. Switching
    // away from an existing member must not leave that member's completed cards.
    if (session?.user)
      setFlowSession(nextSession.user?.demo === true ? 'demo' : nextSession.user ? 'member' : 'guest', { resetRun: true });
    stopReportVisuals();
    if (session?.user)
      app.innerHTML =
        '<main id="main" class="loading-screen" role="status">계정 정보를 확인하고 있습니다.</main>';
    reportPickerState = {};
    reportPickerOwner = nextSession.user?.id;
  }
}

async function onSession(nextSession, { deliveryObservation } = {}) {
  const completedGuest = !session?.user && workspace.draft.guest === true &&
    workspace.draft.report_locked === true && workspace.draft.preview_ready !== true &&
    workspace.draft.analysis_pending !== true && workspace.draft.analysis_running !== true;
  // Callers outside the credential form start when the verified session arrives.
  // Reloads and OAuth returns without a measured start remain unmeasured.
  if (completedGuest && nextSession.user && !deliveryObservation)
    deliveryObservation = beginFlowEvent('result_delivery', { execution: 'guest', source: flowSource() });
  try {
    prepareAccountChange(nextSession);
    if (selectedPosting?.source_type === 'manual' && selectionOwner !== nextSession.user?.id)
      selectedPosting = null;
    session = nextSession;
    setSession(session);
    flowSession();
    edits = {};
    clearCatalogEdits();
    workspace = { draft: {}, questions: [] };
    if (!session.user) {
      applyGuestWorkspace(await readGuestWorkspace());
      navigate('resume');
      return;
    }
    const accountDestination = isAccountPage(returnAfterLogin);
    const owner = session.user.id;
    const revision = viewRevision;
    const current = () => owner === session.user?.id && revision === viewRevision;
    const claimed = accountDestination ? null : await claimCompletedGuest({ completed: completedGuest });
    if (!current() || claimed === 'superseded') return;
    if (!['claimed', 'prepared'].includes(claimed)) await loadWorkspace([], current);
    if (!current()) return;
    if (await continueGuestReport({ claimed, accountDestination, deliveryObservation })) return;
    if (claimed === 'expired') finishFlowEvent(deliveryObservation, { state: 'expired' });
    const destination = accountDestination
      ? returnAfterLogin
      : claimed
        ? claimed === 'expired'
          ? 'resume'
          : claimed === 'prepared'
            ? practiceDestination(workspace.draft)
            : 'result'
        : returnAfterLogin || (workspace.draft.report ? 'result' : 'resume');
    returnAfterLogin = null;
    navigate(destination);
  } catch (error) {
    finishFlowEvent(deliveryObservation, { state: error.name === 'AbortError' ? 'cancelled' : 'failed' });
    throw error;
  } finally {
    // No stale request may leave a running metric or claim successful display.
    finishFlowEvent(deliveryObservation, { state: 'cancelled' });
  }
}

function render({ reportBridge } = {}) {
  if (!session) return;
  stopReportVisuals({ preserveLoading: reportBridge });
  if (reportBridge) app.dataset.reportTransition = 'forming';
  stopCatalogLoad();
  stopResumeExamples();
  let page = location.hash.replace(/^#\//, '') || (resetToken ? 'reset' : 'intro');
  // Keep saved links to the former role-selection route working.
  if (page === 'job') page = 'desired-role';
  // Supplemental questions were removed. Old links reopen the selected posting or report.
  if (['practice', 'questions', 'preparing'].includes(page)) {
    navigate(practiceDestination(workspace.draft));
    return;
  }
  const catalog = catalogRoute(location.hash);
  const opportunities = opportunityRoute(location.hash);
  if (catalog) page = location.hash.replace(/^#\//, '');
  if (opportunities) page = location.hash.replace(/^#\//, '');
  const savedReportRoute = /^reports\/([^/?#]+)$/.exec(page);
  const accountPage = isAccountPage(page);
  if (accountPage && page !== 'admin' && !session.user) {
    requireLogin(page, '마이페이지와 저장한 보고서는 로그인 후 확인할 수 있습니다.');
    return;
  }
  if (
    !session.user &&
    !authPages.has(page) &&
    !catalog &&
    !opportunities &&
    !['intro', 'resume', 'desired-role', 'result', 'admin'].includes(page)
  )
    page = 'login';
  if (session.user && authPages.has(page) && page !== 'reset')
    page = workspace.draft.report ? 'result' : 'resume';
  if (!session.user && page === 'result') {
    if (!workspace.draft.resume_attached) page = 'resume';
    else if (!workspace.draft.report_locked) {
      navigate(practiceDestination(workspace.draft));
      return;
    }
  }
  if (
    session.user &&
    page !== 'intro' &&
    !authPages.has(page) &&
    !catalog &&
    !opportunities &&
    !accountPage
  ) {
    if (!workflowPages.has(page)) page = 'resume';
    if (page !== 'resume' && !workspace.draft.resume_text) page = 'resume';
    if (page === 'result' && !workspace.draft.report) {
      navigate(practiceDestination(workspace.draft));
      return;
    }
  }
  if (location.hash !== `#/${page}`)
    history.replaceState({}, '', `${location.pathname}${location.search}#/${page}`);
  const flowRoute = page === 'signup'
    ? 'signup'
    : authPages.has(page)
      ? 'auth'
    : catalog || opportunities
      ? 'posting'
      : page === 'desired-role'
        ? 'role'
        : page === 'resume'
          ? 'resume'
          : savedReportRoute || page === 'mypage'
            ? 'history'
            : page === 'admin'
              ? 'dashboard'
          : 'visit';
  // Compare the actual local route, but emit only a fixed category. IDs, role
  // labels and query values must never enter the observation stream.
  if (page !== previousFlowRoute) {
    previousFlowRoute = page;
    recordFlowEvent(flowRoute, {
      kind: 'navigation',
      source: session.user?.demo === true ? 'demo' : 'observed',
    });
  }
  const title = {
    intro: '소개',
    login: '로그인',
    email: '이메일 로그인',
    signup: '회원가입',
    forgot: '비밀번호 찾기',
    reset: '비밀번호 재설정',
    resume: '이력서 입력',
    'desired-role': '희망 직무',
    result: '모의지원 결과',
    mypage: '마이페이지',
    admin: '대시보드',
  }[page];
  document.title = `${catalog || opportunities ? '채용공고' : savedReportRoute ? '저장한 분석보고서' : title} · CareerLens`;
  if (page === 'admin') {
    app.innerHTML = shell(adminDashboard(session.user), {
      user: session.user,
      page,
      draft: workspace.draft,
    });
    bindAccount();
    disposeAdminDashboard = mountAdminDashboard(app, { user: session.user, api });
  } else if (page === 'mypage') {
    app.innerHTML = shell(
      myPage(session.user, { hasCurrentReport: Boolean(workspace.draft.report) }),
      {
        user: session.user,
        page,
        draft: workspace.draft,
      },
    );
    bindAccount();
    bindSavedReports();
  } else if (savedReportRoute) {
    app.innerHTML = shell(savedReportStatus('저장한 분석보고서를 불러오는 중입니다.'), {
      user: session.user,
      page: 'saved-report',
      draft: workspace.draft,
    });
    bindAccount();
    loadSavedReport(savedReportRoute[1]);
  } else if (page === 'intro') {
    app.innerHTML = shell(introductionPage(), {
      user: session.user,
      page,
      draft: workspace.draft,
    });
    bindAccount();
    disposeIntroduction = bindIntroduction({ onComplete: () => navigate('resume') });
  } else if (opportunities) {
    if (!opportunities.role_id) {
      navigate('desired-role');
      return;
    }
    app.innerHTML = shell(opportunitiesPage(), {
      user: session.user,
      draft: {
        ...workspace.draft,
        guest: !session.user,
        career_target: { role_id: opportunities.role_id, label: opportunities.label },
      },
      page: 'opportunities',
    });
    bindAccount();
    disposeOpportunities = bindOpportunities({
      route: opportunities,
      user: session.user,
      navigate,
      onSelect: selectPosting,
      onError: handleError,
    });
  } else if (catalog) {
    app.innerHTML = shell(jobsLoading(), {
      user: session.user,
      draft: workspace.draft,
      page: 'jobs',
    });
    bindAccount();
    bindCatalog({
      route: catalog,
      user: session.user,
      navigate,
      requireLogin,
      onSelect: (posting) => selectPosting(posting).catch(handleError),
      onError: handleError,
      rerender: render,
    });
  } else if (authPages.has(page)) {
    const lockedAuth = !session.user && workspace.draft.report_locked;
    app.innerHTML = lockedAuth
      ? shell(reportGatePage(workspace.draft, { authPage: page, session }), { user: session.user, page: 'result', draft: workspace.draft })
      : renderAuth(page, session, workspace.draft);
    if (lockedAuth) {
      recordFlowEvent('report_lock', { state: 'waiting', execution: 'guest', source: flowSource() });
      returnAfterLogin = 'result';
      disposeReportGate = bindReportGate({
        onLogin: () => openReportLogin('email'),
        onSignup: () => openReportLogin('signup'),
        onBack: () => navigate('result'),
        onDiscard: discardGuest,
      });
    }
    bindAuth({ onSession, resetToken, navigate, demo: session.user?.demo === true });
    if (loginMessage) {
      notice(loginMessage, 'info', document.getElementById('auth-notices'));
      loginMessage = null;
    }
    if (authError) {
      recordFlowEvent('auth', { state: 'failed', source: flowSource() });
      notice(
        '소셜 로그인을 완료하지 못했습니다. 설정을 확인하거나 이메일로 로그인해 주세요.',
        'error',
        document.getElementById('auth-notices'),
      );
      authError = null;
      history.replaceState(
        {},
        '',
        `${location.pathname}${resetToken ? `?reset_token=${encodeURIComponent(resetToken)}` : ''}${location.hash}`,
      );
    }
    if (page === 'reset' && !resetToken) {
      recordFlowEvent('input_check', { state: 'blocked', source: flowSource() });
      notice(
        '재설정 링크가 없습니다. 비밀번호 찾기에서 안내를 다시 요청해 주세요.',
        'error',
        document.getElementById('auth-notices'),
      );
      document.querySelector('#auth-form [type="submit"]').disabled = true;
    }
  } else {
    const draft = draftForPage(page, workspace.draft, edits);
    const locked = !session.user && page === 'result';
    app.innerHTML = shell(
      locked
        ? reportGatePage(draft)
        : !session.user && page === 'resume'
          ? guestResumePage({
              ...draft,
              previewBeforeLogin: session.capabilities?.guest_report_preview === true,
              analysisUnavailable: session.capabilities?.guest_analysis === false && session.capabilities?.guest_report_preview !== true,
            })
          : workspacePage(page, draft),
      { user: session.user, draft: workspace.draft, page },
    );
    bindWorkflow();
    bindCounters();
    if (locked && !reportBridge) {
      recordFlowEvent('report_lock', { state: 'waiting', execution: 'guest', source: flowSource() });
      disposeReportGate = bindReportGate({
        onLogin: () => openReportLogin('email'),
        onSignup: () => openReportLogin('signup'),
        onDiscard: discardGuest,
      });
    } else if (!locked && page === 'result') {
      mountReportVisuals();
      bindReportPicker(draft);
      if (!reportBridge && draft.report)
        recordFlowEvent('report', { source: flowSource() });
    }
    if (page === 'desired-role') bindCareerRoleOptions();
    if (page === 'resume' && session.user)
      bindResumeExamples({
        hasContent: () => Boolean(draftForPage('resume', workspace.draft, edits).resume_text),
        onSelect: async (example) => {
          const revision = viewRevision;
          const owner = session.user?.id;
          const current = () => revision === viewRevision && owner === session.user?.id;
          const saved = await observeFlowAction('resume',
            () => api('/resume', { method: 'PUT', body: { resume_text: example.resume_text } }), { current });
          if (!current()) return;
          applyWorkspace(saved, ['resume_text']);
          navigationMessage =
            '가상 이력서를 불러와 저장했습니다. 내 이력서 입력란에서 내용을 확인해 주세요.';
          render();
        },
        onError: handleError,
      });
    if (selectedPosting && page === 'resume') {
      const banner = document.createElement('aside');
      banner.className = 'selected-posting-banner';
      banner.innerHTML = `
        <div>
          <strong>선택한 공고 · ${escapeHtml(selectedPosting.role)}</strong>
          <p>
            ${escapeHtml(selectedPosting.company)} ·
            ${
              page === 'resume'
                ? '이력서 저장 후 이 공고로 모의지원을 준비합니다.'
                : '아직 입력란에 반영하지 않았습니다.'
            }
          </p>
        </div>
        <button
          type="button"
          id="dismiss-selected-posting"
          class="text-button">
          선택 취소
        </button>
      `;
      document.getElementById('main').prepend(banner);
      document.getElementById('dismiss-selected-posting')?.addEventListener('click', () => {
        selectedPosting = null;
        recordFlowEvent('posting', { state: 'cleared', source: flowSource() });
        render();
      });
    }
    if (navigationMessage) {
      notice(navigationMessage, 'success');
      navigationMessage = null;
    } else if (
      page === 'result' &&
      ['resume_text', 'company', 'role', 'job_text', 'role_id', 'focus'].some((field) =>
        Object.hasOwn(edits, field),
      )
    ) {
      notice(
        '저장되지 않은 수정 내용이 있습니다. 이 결과는 마지막으로 저장하고 분석한 내용을 기준으로 표시합니다.',
        'info',
      );
    }
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (!reportBridge && (session.user || (page !== 'result' && !workspace.draft.report_locked)))
    document.getElementById('main')?.focus({ preventScroll: true });
  if (reportBridge) {
    const currentRevision = viewRevision;
    const currentOwner = session.user?.id;
    const main = document.getElementById('main');
    const locked = !session.user;
    const order = { heading: 0, graphic: 1, details: 2 };
    [...(main?.querySelectorAll('[data-report-reveal]') || [])]
      .sort(
        (first, second) =>
          (order[first.dataset.reportReveal] ?? 3) - (order[second.dataset.reportReveal] ?? 3),
      )
      .forEach((element, index) => {
        element.style.setProperty('--report-reveal-index', String(Math.min(index, 8)));
      });
    return {
      frame: document.querySelector('[data-report-frame]') || document.querySelector('[data-report-gate]') || main,
      onReveal() {
        if (currentRevision !== viewRevision || currentOwner !== session.user?.id) return;
        app.dataset.reportTransition = 'revealing';
      },
      activate() {
        if (currentRevision !== viewRevision || currentOwner !== session.user?.id) return;
        // Let the last staggered details finish after the modal releases focus.
        // Navigation clears this state along with all report visual lifecycles.
        if (locked) {
          disposeReportGate = bindReportGate({
            onLogin: () => openReportLogin('email'),
            onSignup: () => openReportLogin('signup'),
            onDiscard: discardGuest,
          });
        } else main?.focus({ preventScroll: true });
      },
    };
  }
}

function bindReportPicker(draft) {
  disposeReportPicker?.();
  if (reportPickerOwner !== session.user?.id) {
    reportPickerState = {};
    reportPickerOwner = session.user?.id;
  }
  disposeReportPicker = bindSavedReportPicker(document.querySelector('[data-open-report-picker]'), {
    draft,
    api,
    onUnauthorized: handleError,
    state: reportPickerState,
  });
}

function savedReportStatus(message, { error = false } = {}) {
  return `<section class="saved-report-status">
    <a class="text-button" href="#/mypage">마이페이지 · 저장한 보고서 목록</a>
    <h1>저장한 분석보고서</h1>
    <p role="${error ? 'alert' : 'status'}">${escapeHtml(message)}</p>
    ${error ? '<button class="button secondary" type="button" id="retry-saved-report">다시 불러오기</button>' : ''}
  </section>`;
}

function bindSavedReports() {
  const host = document.getElementById('saved-reports-list');
  if (!host) return;
  const revision = viewRevision;
  const owner = session.user?.id;
  const controller = new AbortController();
  accountRequest = controller;
  const state = {
    items: [],
    loading: false,
    loaded: false,
    error: '',
    nextOffset: null,
    demo: Boolean(session.user?.demo),
    // The fetched backend has no report-deletion API. Never simulate a delete
    // by removing a row locally; real deletion needs a confirmed server contract.
    canDeleteReports: false,
    selectedIds: [],
    query: '',
    status: '',
  };
  const current = () =>
    !controller.signal.aborted &&
    revision === viewRevision &&
    owner === session.user?.id &&
    host.isConnected;
  let failedOffset = 0;
  const contextQueue = [];
  let contextWorkers = 0;
  function paint() {
    if (!current()) return;
    const active = document.activeElement;
    const editingQuery = Boolean(
      active?.matches?.('[data-reports-query]') && host.contains?.(active),
    );
    const selection = editingQuery ? [active.selectionStart, active.selectionEnd] : null;
    const activeAttribute =
      !editingQuery && host.contains?.(active)
        ? [
            'data-report-select',
            'data-reports-select-all',
            'data-reports-status',
            'data-report-context-retry',
            'data-reports-more',
            'data-reports-retry',
          ].find((attribute) => active?.hasAttribute?.(attribute))
        : null;
    const activeValue = activeAttribute ? active.getAttribute(activeAttribute) : null;
    host.innerHTML = savedReportsList(state);
    host
      .querySelector('[data-reports-more]')
      ?.addEventListener('click', () => load(state.nextOffset));
    host.querySelector('[data-reports-retry]')?.addEventListener('click', () => load(failedOffset));
    host.querySelector('[data-reports-query]')?.addEventListener('input', (event) => {
      state.query = event.target.value;
      paint();
    });
    host.querySelector('[data-reports-status]')?.addEventListener('change', (event) => {
      state.status = event.target.value;
      paint();
      host.querySelector('[data-reports-status]')?.focus();
    });
    host.querySelectorAll('[data-report-select]').forEach((checkbox) =>
      checkbox.addEventListener('change', (event) => {
        const id = event.currentTarget.dataset.reportSelect;
        state.selectedIds = event.currentTarget.checked
          ? [...new Set([...state.selectedIds, id])]
          : state.selectedIds.filter((selected) => selected !== id);
        paint();
        [...host.querySelectorAll('[data-report-select]')]
          .find((node) => node.dataset.reportSelect === id)
          ?.focus();
      }),
    );
    host.querySelector('[data-reports-select-all]')?.addEventListener('change', (event) => {
      const visible = new Set(
        filterSavedReports(state.items, state.query, state.status).map(({ id }) => id),
      );
      state.selectedIds = event.currentTarget.checked
        ? [...new Set([...state.selectedIds, ...visible])]
        : state.selectedIds.filter((id) => !visible.has(id));
      paint();
      host.querySelector('[data-reports-select-all]')?.focus();
    });
    const selectAll = host.querySelector('[data-reports-select-all]');
    if (selectAll) selectAll.indeterminate = selectAll.getAttribute?.('aria-checked') === 'mixed';
    host.querySelectorAll('[data-report-context-retry]').forEach((button) =>
      button.addEventListener('click', () => {
        const item = state.items.find(({ id }) => id === button.dataset.reportContextRetry);
        if (item && !item.context_loading) void hydrateContexts([item]);
      }),
    );
    if (editingQuery) {
      const input = host.querySelector('[data-reports-query]');
      input?.focus({ preventScroll: true });
      if (selection) input?.setSelectionRange(...selection);
    } else if (activeAttribute) {
      [...host.querySelectorAll(`[${activeAttribute}]`)]
        .find((node) => node.getAttribute(activeAttribute) === activeValue)
        ?.focus({ preventScroll: true });
    }
  }
  function hydrateContexts(items) {
    for (const item of items) {
      item.context_loading = true;
      contextQueue.push(item);
    }
    async function worker() {
      while (contextQueue.length && current()) {
        const item = contextQueue.shift();
        item.context_loading = true;
        item.context_error = '';
        paint();
        try {
          const result = await api(`/account/reports/${encodeURIComponent(item.id)}/context`, {
            signal: controller.signal,
          });
          if (!current()) return;
          item.job_context = result.job_context;
        } catch (error) {
          if (!current() || error.name === 'AbortError') return;
          if (error.status === 401) {
            host.replaceChildren();
            await handleError(error);
            return;
          }
          item.context_error = '공고 정보를 불러오지 못했습니다.';
        } finally {
          if (current()) {
            item.context_loading = false;
            paint();
          }
        }
      }
    }
    while (contextWorkers < 3 && contextQueue.length && current()) {
      contextWorkers += 1;
      void worker().finally(() => {
        contextWorkers -= 1;
        if (contextQueue.length && current()) hydrateContexts([]);
      });
    }
  }
  async function load(offset = 0) {
    if (state.loading || offset === null || !current()) return;
    failedOffset = offset;
    state.loading = true;
    state.error = '';
    paint();
    try {
      const result = await observeFlowAction('history',
        () => api(`/account/reports?offset=${offset}`, { signal: controller.signal }), { current });
      if (!current()) return;
      const known = new Set(state.items.map(({ id }) => id));
      const newItems = result.items
        .filter(({ id }) => !known.has(id))
        .map((item) => ({ ...item, context_loading: true }));
      state.items.push(...newItems);
      state.nextOffset = result.next_offset;
      state.demo = Boolean(result.demo || session.user?.demo);
      state.loaded = true;
      if (state.items.length === 0)
        recordFlowEvent('history', { state: 'empty', source: flowSource() });
      void hydrateContexts(newItems);
    } catch (error) {
      if (!current() || error.name === 'AbortError') return;
      if (error.status === 401) {
        host.replaceChildren();
        await handleError(error);
        return;
      }
      state.error =
        error.status === 404
          ? '현재 연결된 서버에서 저장한 보고서 목록을 제공하지 않습니다.'
          : publicErrorMessage(error);
    } finally {
      state.loading = false;
      paint();
    }
  }
  void load();
}

async function loadSavedReport(encodedId) {
  const revision = viewRevision;
  const owner = session.user?.id;
  const controller = new AbortController();
  accountRequest = controller;
  const current = () =>
    !controller.signal.aborted && revision === viewRevision && owner === session.user?.id;
  const observation = beginFlowEvent('history', { source: flowSource() });
  try {
    const { draft } = await api(`/account/reports/${encodedId}`, { signal: controller.signal });
    if (!current()) return;
    // Historical results are read-only and never replace the current workspace or edits.
    const main = document.getElementById('main');
    main.innerHTML = analysisReport(draft);
    bindReportSections();
    bindReportPicker(draft);
    await mountReportVisuals(draft.report);
    if (current()) {
      finishFlowEvent(observation);
      recordFlowEvent('report', { source: session.user?.demo === true ? 'demo' : 'observed' });
      main.focus({ preventScroll: true });
    }
  } catch (error) {
    finishFlowEvent(observation, {
      state: !current() || error.name === 'AbortError' ? 'cancelled' : 'failed',
    });
    if (!current() || error.name === 'AbortError') return;
    if (error.status === 401) {
      document.getElementById('main').replaceChildren();
      await handleError(error);
      return;
    }
    const message = [403, 404].includes(error.status)
      ? '이 보고서를 찾을 수 없거나 현재 계정으로 열 수 없습니다.'
      : publicErrorMessage(error);
    document.getElementById('main').innerHTML = savedReportStatus(message, { error: true });
    document.getElementById('retry-saved-report')?.addEventListener('click', () => render());
  } finally {
    if (!current()) finishFlowEvent(observation, { state: 'cancelled' });
  }
}

async function handleError(error) {
  if (error.status === 410 || ['guest_missing', 'guest_expired'].includes(error.code)) {
    recordFlowEvent('notice', { state: 'expired', source: flowSource() });
    if (!session.user) applyGuestWorkspace({});
    edits = {};
    selectedPosting = null;
    navigationMessage =
      '임시 이력서와 분석 결과가 만료되었거나 파기되었습니다. 이력서를 다시 첨부해 주세요.';
    navigate('resume');
  } else if (error.status === 401) {
    recordFlowEvent('session', { state: 'expired', source: flowSource() });
    // Drop the previous identity before awaiting a session refresh. Anonymous
    // routes must never render a former member's saved or unsaved inputs.
    stopReportVisuals();
    clearTimeout(guestExpiryTimer);
    workspace = { draft: {}, questions: [] };
    edits = {};
    selectedPosting = null;
    selectionOwner = null;
    guest.filename = '';
    guest.target = null;
    returnAfterLogin = null;
    clearCatalogEdits();
    session = { ...session, user: null };
    // The application has already discarded this identity. Publish that change
    // before verification, which can be slow or fail without returning a session.
    flowSession({ resetRun: true });
    session = await getSession();
    flowSession();
    if (session.user) await loadWorkspace();
    else applyGuestWorkspace(await readGuestWorkspace());
    navigate('email');
    setTimeout(
      () =>
        notice(
          '로그인 시간이 만료되었습니다. 다시 로그인해 주세요.',
          'error',
          document.getElementById('auth-notices'),
        ),
      0,
    );
  } else {
    recordFlowEvent('notice', { state: 'failed', source: flowSource() });
    notice(publicErrorMessage(error));
  }
}

function bindForm(id, label, action) {
  const form = document.getElementById(id);
  form?.addEventListener('invalid', () => {
    recordFlowEvent('input_check', { state: 'blocked', source: flowSource() });
  }, true);
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    recordFlowEvent('input_check', { source: flowSource() });
    pending(form, label, async () => {
      try {
        await action(new FormData(form));
      } catch (error) {
        if (error.name === 'AbortError') return;
        await handleError(error);
      }
    });
  });
}

async function bindCareerRoleOptions() {
  const select = document.getElementById('career-role');
  const submit = document.getElementById('prepare-submit');
  const custom = document.getElementById('custom-role-field');
  const role = document.getElementById('role');
  if (!select) return;
  const revision = viewRevision;
  const controller = new AbortController();
  roleRequest = controller;
  const { signal } = controller;
  const draft = draftForPage(
    'desired-role',
    session.user
      ? workspace.draft
      : { career_target: guest.target, role: guest.target?.label || '' },
    edits,
  );
  const selected = draft.career_target?.role_id || (draft.role ? 'custom' : '');
  function updateCustom() {
    custom.hidden = select.value !== 'custom';
    role.required = select.value === 'custom';
    role.disabled = select.value !== 'custom';
    submit.disabled = !select.value;
    const description = document.getElementById('career-role-description');
    if (description) description.textContent = select.selectedOptions[0]?.dataset.description || '';
  }
  select.addEventListener(
    'change',
    () => {
      edits.role_id = select.value;
      updateCustom();
    },
    { signal },
  );
  try {
    const { items } = await api('/career-roles', { signal });
    if (signal.aborted || revision !== viewRevision) return;
    select.innerHTML = roleChoicesMarkup(items || [], selected);
    select.disabled = false;
    updateCustom();
  } catch (error) {
    if (signal.aborted || revision !== viewRevision) return;
    await handleError(error);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button secondary compact';
    retry.textContent = '직무 목록 다시 불러오기';
    retry.addEventListener('click', () => {
      controller.abort();
      retry.remove();
      bindCareerRoleOptions();
    });
    document.getElementById('career-role-options').append(retry);
  }
}

function bindAccount() {
  document.getElementById('logout')?.addEventListener('click', async (event) => {
    if (
      (Object.keys(edits).length || hasCatalogEdits()) &&
      !window.confirm(
        '저장하지 않은 편집 내용이 있습니다. 로그아웃하면 미저장 내용은 삭제됩니다. 로그아웃할까요?',
      )
    )
      return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await observeFlowAction('logout', () => api('/auth/logout', { method: 'POST', body: {} }));
      stopReportVisuals();
      app.innerHTML =
        '<main id="main" class="loading-screen"><p role="status">로그아웃 중입니다.</p></main>';
      session = { ...session, user: null };
      flowSession({ resetRun: true });
      workspace = { draft: {}, questions: [] };
      edits = {};
      selectedPosting = null;
      clearTimeout(guestExpiryTimer);
      guest.filename = '';
      guest.target = null;
      returnAfterLogin = null;
      clearCatalogEdits();
      session = await getSession();
      flowSession();
      applyGuestWorkspace(await readGuestWorkspace());
      navigate('resume');
    } catch (error) {
      button.disabled = false;
      await handleError(error);
    }
  });
}

function bindWorkflow() {
  bindAccount();
  document.getElementById('guest-resume-file')?.addEventListener('change', (event) => {
    try {
      guest.filename = guestFileMetadata(event.target.files?.[0]);
      document.getElementById('guest-file-status').textContent =
        guest.filename || '선택한 파일이 없습니다.';
    } catch (error) {
      recordFlowEvent('input_check', { state: 'blocked', source: flowSource() });
      event.target.value = '';
      guest.filename = '';
      document.getElementById('guest-file-status').textContent = publicErrorMessage(error);
    }
  });
  bindForm('guest-upload-form', '이력서 첨부 중…', async (form) => {
    const file = form.get('file');
    if (file?.name) {
      const revision = viewRevision;
      await validateObservedResume(file);
      if (revision !== viewRevision || session.user) return;
      const result = await observeFlowAction('resume',
        () => api('/guest/resume/upload', { method: 'POST', body: form }),
        { current: () => revision === viewRevision && !session.user });
      if (revision !== viewRevision || session.user) return;
      applyGuestWorkspace(result);
      edits = {};
    } else if (!workspace.draft.resume_attached) {
      recordFlowEvent('input_check', { state: 'blocked', source: flowSource() });
      throw new Error('분석할 이력서 파일을 먼저 선택해 주세요.');
    }
    if (selectedPosting) await selectPosting(selectedPosting);
    else navigate('desired-role');
  });
  document
    .querySelectorAll('#resume-form textarea, #job-form input, #job-form textarea')
    .forEach((field) => {
      field.addEventListener('input', () => {
        edits[field.name] = field.value;
      });
    });
  bindForm('resume-form', '이력서 저장 중…', async (form) => {
    if (!session.user) {
      requireLogin('resume');
      return;
    }
    const revision = viewRevision;
    const owner = session.user.id;
    const current = () => revision === viewRevision && owner === session.user?.id;
    const saved = await observeFlowAction('resume',
      () => api('/resume', { method: 'PUT', body: { resume_text: form.get('resume_text') } }), { current });
    if (!current()) return;
    applyWorkspace(saved, ['resume_text']);
    if (selectedPosting) {
      if (guest.target) {
        const target = await observeFlowAction('role',
          () => api('/career-target', {
            method: 'PUT',
            body: {
              role_id: guest.target.role_id,
              role: guest.target.label,
              focus: guest.target.focus,
            },
          }), { current });
        if (!current()) return;
        applyWorkspace(target);
      }
      await selectPosting(selectedPosting);
      guest.target = null;
      return;
    }
    navigate('desired-role');
  });
  bindForm('upload-form', '불러오는 중…', async (form) => {
    if (!session.user) {
      requireLogin('resume');
      return;
    }
    const file = form.get('file');
    const revision = viewRevision;
    const owner = session.user.id;
    await validateObservedResume(file);
    if (revision !== viewRevision || owner !== session.user?.id) return;
    const result = await observeFlowAction('resume',
      () => api('/resume/upload', { method: 'POST', body: form }),
      { current: () => revision === viewRevision && owner === session.user?.id });
    if (revision !== viewRevision || owner !== session.user?.id) return;
    applyWorkspace(result, ['resume_text']);
    navigationMessage =
      'Markdown 이력서를 불러왔습니다. 내용을 확인하고 다음 단계로 진행해 주세요.';
    render();
  });
  bindForm('job-form', '희망 직무 저장 중…', async (form) => {
    const revision = viewRevision;
    const owner = session.user?.id;
    const current = () => revision === viewRevision && owner === session.user?.id;
    const selection = document.getElementById('career-role');
    if (!session.user) {
      guest.target = {
        role_id: form.get('role_id'),
        label:
          form.get('role_id') === 'custom'
            ? String(form.get('role') || '').trim()
            : selection.selectedOptions[0].textContent.trim(),
        focus: String(form.get('focus') || ''),
      };
      if (workspace.draft.resume_attached) {
        const saved = await observeFlowAction('role', () => api('/guest/career-target', {
            method: 'PUT',
            body: Object.fromEntries(form),
          }), { current });
        if (!current()) return;
        applyGuestWorkspace(saved);
      } else {
        workspace.draft.career_target = guest.target;
        recordFlowEvent('role', { source: flowSource() });
      }
      edits = {};
      navigate(opportunityPath(guest.target));
      return;
    }
    const saved = await observeFlowAction('role',
      () => api('/career-target', { method: 'PUT', body: Object.fromEntries(form) }), { current });
    if (!current()) return;
    applyWorkspace(saved, [
      'company',
      'role',
      'job_text',
      'role_id',
      'focus',
    ]);
    guest.target = null;
    navigate(opportunityPath(workspace.draft.career_target));
  });
  document.getElementById('example')?.addEventListener('click', async (event) => {
    if (Object.keys(edits).length && !window.confirm('작성 중인 내용을 예시 이력서로 바꿀까요?'))
      return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '예시를 불러오는 중…';
    try {
      applyWorkspace(await api('/example', { method: 'POST', body: {} }));
      edits = {};
      navigationMessage =
        '가상 이력서를 불러왔습니다. 희망 직무를 선택하고 모의지원을 진행해 보세요.';
      navigate('desired-role');
    } catch (error) {
      button.disabled = false;
      button.textContent = '예시로 체험하기';
      await handleError(error);
    }
  });
  document.getElementById('clear-workspace')?.addEventListener('click', async (event) => {
    if (
      !window.confirm(
        '내 계정의 이력서, 공고, 추가 답변과 분석 결과를 삭제할까요? 삭제한 내용은 복구할 수 없습니다.',
      )
    )
      return;
    event.currentTarget.disabled = true;
    try {
      const result = await api('/workspace', { method: 'DELETE' });
      workspace = { draft: {}, questions: [] };
      edits = {};
      applyWorkspace(result);
      navigationMessage = '입력 내용과 분석 결과를 삭제했습니다.';
      navigate('resume');
    } catch (error) {
      render();
      await handleError(error);
    }
  });
  bindReportSections();
}

function bindReportSections() {
  document.querySelectorAll('[data-section]').forEach((link) =>
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const card = document.querySelector('[data-resume-score-card]');
      const section = document.getElementById(link.dataset.section);
      if (!card || !section) return;
      const top =
        card.scrollTop +
        section.getBoundingClientRect().top -
        card.getBoundingClientRect().top -
        card.clientTop;
      card.focus({ preventScroll: true });
      card.scrollTo({
        top: Math.max(0, top - 20),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    }),
  );
}

window.addEventListener('hashchange', () => {
  if (flowViewer) return;
  if (parseAuthCallback(location.hash)) void start();
  else render();
});
window.addEventListener('pagehide', () => {
  stopReportVisuals();
  stopCatalogLoad();
  stopResumeExamples();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) render();
});
window.addEventListener('beforeunload', (event) => {
  if (Object.keys(edits).length || hasCatalogEdits()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

async function start() {
  if (flowViewer) {
    const { mountFlowViewer } = await import('../features/activity-flow/viewer.js');
    mountFlowViewer(app);
    return;
  }
  mountFlowLauncher();
  const callback = consumeAuthCallback(location, history);
  let callbackSession;
  let callbackMessage;
  let callbackFailed = false;
  try {
    if (callback?.kind === 'error') {
      recordFlowEvent('input_check', { state: 'blocked', source: flowSource() });
      recordFlowEvent('session', { state: 'failed', source: flowSource() });
      callbackMessage =
        '이메일 인증을 완료하지 못했습니다. 인증 링크를 다시 확인하거나 로그인해 주세요.';
      callbackFailed = true;
    } else if (callback?.kind === 'session') {
      try {
        callbackSession = await observeFlowAction('session', () => completeAuthCallback(callback));
        callbackMessage = '이메일 인증을 확인했습니다. 로그인되었습니다.';
      } catch {
        callbackFailed = true;
        callbackMessage =
          '이메일 인증 정보로 로그인하지 못했습니다. 기존 로그인 상태는 유지됩니다. 이메일로 다시 로그인해 주세요.';
      }
    }
    const nextSession = callbackSession || (await getSession());
    prepareAccountChange(nextSession);
    session = nextSession;
    flowSession();
    if (session.user) {
      const accountDestination = isAccountPage(location.hash.replace(/^#\//, ''));
      const owner = session.user.id;
      const revision = viewRevision;
      const current = () => owner === session.user?.id && revision === viewRevision;
      const claimed = accountDestination
        ? null
        : await claimCompletedGuest();
      if (!current() || claimed === 'superseded') return;
      if (!['claimed', 'prepared'].includes(claimed)) await loadWorkspace([], current);
      if (!current()) return;
      if (await continueGuestReport({ claimed, accountDestination })) return;
      if (claimed)
        history.replaceState(
          {},
          '',
          `${location.pathname}#/${claimed === 'expired' ? 'resume' : claimed === 'prepared' ? practiceDestination(workspace.draft) : 'result'}`,
        );
    } else {
      applyGuestWorkspace(await readGuestWorkspace());
      const pending = workspace.draft.analysis_running && workspace.draft.selected_posting;
      if (pending?.id && session.capabilities?.guest_analysis === true) {
        render();
        await selectPosting(pending, { continuePending: true });
        return;
      }
    }
    render();
    if (callbackMessage)
      notice(
        callbackMessage,
        callbackFailed ? 'error' : 'success',
        document.getElementById('auth-notices') || document.getElementById('notices'),
      );
  } catch (error) {
    stopReportVisuals();
    reportPickerState = {};
    reportPickerOwner = undefined;
    app.innerHTML = `
      <main
        id="main"
        class="loading-screen">
        <h1>연결을 확인해 주세요.</h1>
        <p
          id="startup-error"
          role="alert"></p>
        <button
          id="retry"
          class="button primary">
          다시 시도
        </button>
      </main>
    `;
    document.getElementById('startup-error').textContent = publicErrorMessage(error);
    document.getElementById('retry').addEventListener('click', start);
  }
}
start();
