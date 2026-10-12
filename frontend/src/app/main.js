import { api, getSession, setSession } from '../shared/api/client.js';
import { shell, notice, pending, bindCounters, escapeHtml } from '../shared/components/ui.js';
import { renderAuth, bindAuth } from '../features/auth/auth.js';
import { workspacePage } from '../pages/workspace.js';
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

const app = document.getElementById('app');
const authPages = new Set(['login', 'email', 'signup', 'forgot', 'reset']);
const workflowPages = new Set(['resume', 'desired-role', 'result']);
const params = new URLSearchParams(location.search);
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
let viewRevision = 0;
const guest = { filename: '', target: null };
let disposeOpportunities;
let disposeIntroduction;
let disposeReportGate;
let guestExpiryTimer;

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
  disposeStatusRadar?.();
  disposeStatusRadar = undefined;
  disposeOpportunities?.();
  disposeOpportunities = undefined;
}

async function mountReportVisuals() {
  const radarHost = document.querySelector('[data-status-radar]');
  const report = workspace.draft.report || {};
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
        '그래프를 불러오지 못했습니다. 아래 점수 변화 시연 안내에서 항목별 시연 값을 확인하세요.';
    }
  }

  // Both modules share the navigation revision, so a replaced report cannot remount.
  await mountRadar();
}

function requireLogin(page) {
  returnAfterLogin = page;
  loginMessage = '모의지원은 로그인이 필요합니다. 로그인하거나 회원가입한 뒤 이어가 주세요.';
  navigate('email');
}

async function selectPosting(posting) {
  if (disposeReportLoading) return;
  selectedPosting = posting;
  selectionOwner = session.user?.id;
  const member = Boolean(session.user);
  if (!(member ? workspace.draft.resume_text : workspace.draft.resume_attached)) {
    navigationMessage = '선택한 공고로 분석하려면 이력서를 먼저 첨부하거나 저장해 주세요.';
    navigate('resume');
    return;
  }

  let revision = viewRevision;
  const owner = session.user?.id;
  const answers = {};
  let evaluationRunId;
  let cancellationRequested = false;
  let cancellationSent = false;
  function cancelEvaluation() {
    cancellationRequested = true;
    if (!evaluationRunId || cancellationSent || !member) return;
    cancellationSent = true;
    void api(`/evaluations/${encodeURIComponent(evaluationRunId)}/cancel`, {
      method: 'POST',
      body: {},
      keepalive: true,
    }).catch((error) => {
      if (error.status !== 409 && owner === session.user?.id)
        notice(`평가 취소 요청에 실패했습니다: ${error.message}`, 'error');
    });
  }
  const loading = createReportLoading({
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
  disposeReportLoading = loading.dispose;
  try {
    const result = await loading.run(async (signal, onProgress) => {
      const selection = await api(
        `${member ? '' : '/guest'}/job-postings/${encodeURIComponent(posting.id)}/select`,
        { method: 'POST', body: {}, signal },
      );
      signal.throwIfAborted();
      if (revision !== viewRevision || owner !== session.user?.id)
        throw new DOMException('분석 화면이 변경되었습니다.', 'AbortError');
      if (member) applyWorkspace(selection, ['answers']);
      else applyGuestWorkspace(selection);
      selectedPosting = null;
      delete edits.answers;
      return member
        ? requestFinalReport({
            draft: workspace.draft,
            answers,
            signal,
            request: api,
            onProgress(update) {
              if (update.run?.id) evaluationRunId = update.run.id;
              if (cancellationRequested) cancelEvaluation();
              onProgress(update);
            },
          })
        : requestGuestReport({ answers, signal, request: api });
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
    loading.dispose({ restoreFocus: false });
    view.activate?.();
  } catch (error) {
    if (revision === viewRevision && owner === session.user?.id && error.name !== 'AbortError') {
      delete app.dataset.reportTransition;
      throw error;
    }
  } finally {
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

async function loadWorkspace(savedFields = []) {
  applyWorkspace(await api('/workspace'), savedFields);
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
          applyGuestWorkspace(await api('/guest/workspace'));
          edits = {};
          selectedPosting = null;
          const message =
            '임시 보관 시간이 지나 이력서와 분석 결과가 파기되었습니다. 다시 첨부해 주세요.';
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

async function claimCompletedGuest() {
  const temporary = await api('/guest/workspace');
  if (temporary.expired || (returnAfterLogin === 'result' && !temporary.completed)) {
    navigationMessage =
      '임시 분석 자료가 만료되어 결과를 연결하지 못했습니다. 이력서를 다시 첨부해 주세요.';
    return 'expired';
  }
  if (session.user.demo && temporary.resume_attached) {
    applyWorkspace(await api('/guest/claim', { method: 'POST', body: {} }));
    clearTimeout(guestExpiryTimer);
    guest.filename = '';
    guest.target = null;
    selectedPosting = null;
    return temporary.completed ? 'claimed' : false;
  }
  if (session.user.demo && temporary.resume_attached) {
    applyWorkspace(await api('/guest/claim', { method: 'POST', body: {} }));
    clearTimeout(guestExpiryTimer);
    guest.filename = '';
    guest.target = null;
    selectedPosting = null;
    return temporary.completed ? 'claimed' : false;
  }
  if (!temporary.completed) return false;
  try {
    applyWorkspace(await api('/guest/claim', { method: 'POST', body: {} }));
  } catch (error) {
    if (error.status !== 410 && error.code !== 'guest_missing') throw error;
    navigationMessage =
      '보고서를 연결하기 전에 임시 자료가 만료되거나 파기되었습니다. 이력서를 다시 첨부해 주세요.';
    return 'expired';
  }
  clearTimeout(guestExpiryTimer);
  guest.filename = '';
  guest.target = null;
  selectedPosting = null;
  return 'claimed';
}

function openReportLogin(page) {
  returnAfterLogin = 'result';
  loginMessage =
    '분석이 완료되었습니다. 로그인·회원가입 후 이번 이력서와 보고서를 현재 작업 공간으로 연결합니다. 기존 작업 내용은 이번 분석으로 바뀝니다. 임시 보관 시간이 지나면 이력서와 결과가 자동 파기됩니다.';
  navigate(page);
}

async function discardGuest() {
  applyGuestWorkspace(await api('/guest/workspace', { method: 'DELETE' }));
  edits = {};
  selectedPosting = null;
  returnAfterLogin = null;
  navigationMessage = '임시 이력서와 분석 결과를 파기했습니다.';
  navigate('resume');
}

async function onSession(nextSession) {
  if (selectedPosting?.source_type === 'manual' && selectionOwner !== nextSession.user?.id)
    selectedPosting = null;
  session = nextSession;
  setSession(session);
  edits = {};
  clearCatalogEdits();
  workspace = { draft: {}, questions: [] };
  if (!session.user) {
    applyGuestWorkspace(await api('/guest/workspace'));
    navigate('resume');
    return;
  }
  const claimed = await claimCompletedGuest();
  if (claimed !== 'claimed') await loadWorkspace();
  const destination = claimed
    ? claimed === 'expired'
      ? 'resume'
      : 'result'
    : returnAfterLogin || (workspace.draft.report ? 'result' : 'resume');
  returnAfterLogin = null;
  navigate(destination);
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
  if (
    !session.user &&
    !authPages.has(page) &&
    !catalog &&
    !opportunities &&
    !['intro', 'resume', 'desired-role', 'result'].includes(page)
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
  if (session.user && page !== 'intro' && !authPages.has(page) && !catalog && !opportunities) {
    if (!workflowPages.has(page)) page = 'resume';
    if (page !== 'resume' && !workspace.draft.resume_text) page = 'resume';
    if (page === 'result' && !workspace.draft.report) {
      navigate(practiceDestination(workspace.draft));
      return;
    }
  }
  if (location.hash !== `#/${page}`)
    history.replaceState({}, '', `${location.pathname}${location.search}#/${page}`);
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
  }[page];
  document.title = `${catalog || opportunities ? '채용공고' : title} · CareerLens`;
  if (page === 'intro') {
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
    app.innerHTML = renderAuth(page, session, workspace.draft);
    bindAuth({ onSession, resetToken, navigate });
    if (loginMessage) {
      notice(loginMessage, 'info', document.getElementById('auth-notices'));
      loginMessage = null;
    }
    if (authError) {
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
        ? reportGatePage({ expires_at: draft.expires_at, demo: draft.demo_report })
        : !session.user && page === 'resume'
          ? guestResumePage(draft)
          : workspacePage(page, draft),
      { user: session.user, draft: workspace.draft, page },
    );
    bindWorkflow();
    bindCounters();
    if (locked && !reportBridge)
      disposeReportGate = bindReportGate({
        onLogin: () => openReportLogin('email'),
        onSignup: () => openReportLogin('signup'),
        onDiscard: discardGuest,
      });
    else if (!locked && page === 'result') mountReportVisuals();
    if (page === 'desired-role') bindCareerRoleOptions();
    if (page === 'resume' && session.user)
      bindResumeExamples({
        hasContent: () => Boolean(draftForPage('resume', workspace.draft, edits).resume_text),
        onSelect: async (example) => {
          applyWorkspace(
            await api('/resume', { method: 'PUT', body: { resume_text: example.resume_text } }),
            ['resume_text'],
          );
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
  if (!reportBridge && (session.user || page !== 'result'))
    document.getElementById('main')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
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
      frame: document.querySelector('[data-report-frame], [data-report-gate]') || main,
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

async function handleError(error) {
  if (error.status === 410 || error.code === 'guest_missing') {
    if (!session.user) applyGuestWorkspace({});
    edits = {};
    selectedPosting = null;
    navigationMessage =
      '임시 이력서와 분석 결과가 만료되었거나 파기되었습니다. 이력서를 다시 첨부해 주세요.';
    navigate('resume');
  } else if (error.status === 401) {
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
    session = await getSession();
    if (session.user) await loadWorkspace();
    else applyGuestWorkspace(await api('/guest/workspace'));
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
    notice(error.message);
  }
}

function bindForm(id, label, action) {
  const form = document.getElementById(id);
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    pending(form, label, async () => {
      try {
        await action(new FormData(form));
      } catch (error) {
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
      await api('/auth/logout', { method: 'POST', body: {} });
      session = await getSession();
      workspace = { draft: {}, questions: [] };
      edits = {};
      selectedPosting = null;
      clearTimeout(guestExpiryTimer);
      guest.filename = '';
      guest.target = null;
      returnAfterLogin = null;
      clearCatalogEdits();
      applyGuestWorkspace(await api('/guest/workspace'));
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
      event.target.value = '';
      guest.filename = '';
      document.getElementById('guest-file-status').textContent = error.message;
    }
  });
  bindForm('guest-upload-form', '이력서 첨부 중…', async (form) => {
    const file = form.get('file');
    if (file?.name) {
      guestFileMetadata(file);
      applyGuestWorkspace(await api('/guest/resume/upload', { method: 'POST', body: form }));
      edits = {};
    } else if (!workspace.draft.resume_attached) {
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
    applyWorkspace(
      await api('/resume', { method: 'PUT', body: { resume_text: form.get('resume_text') } }),
      ['resume_text'],
    );
    if (selectedPosting) {
      if (guest.target)
        applyWorkspace(
          await api('/career-target', {
            method: 'PUT',
            body: {
              role_id: guest.target.role_id,
              role: guest.target.label,
              focus: guest.target.focus,
            },
          }),
        );
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
    if (file.size > 10 * 1024 * 1024) throw new Error('파일은 10MB 이하로 선택해 주세요.');
    applyWorkspace(await api('/resume/upload', { method: 'POST', body: form }), ['resume_text']);
    navigationMessage = '이력서를 불러왔습니다. 추출한 내용을 확인하고 다음 단계로 진행해 주세요.';
    render();
  });
  bindForm('job-form', '희망 직무 저장 중…', async (form) => {
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
        applyGuestWorkspace(
          await api('/guest/career-target', {
            method: 'PUT',
            body: Object.fromEntries(form),
          }),
        );
      } else {
        workspace.draft.career_target = guest.target;
      }
      edits = {};
      navigate(opportunityPath(guest.target));
      return;
    }
    applyWorkspace(await api('/career-target', { method: 'PUT', body: Object.fromEntries(form) }), [
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

window.addEventListener('hashchange', render);
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
  try {
    session = await getSession();
    if (session.user) {
      const claimed = await claimCompletedGuest();
      if (claimed !== 'claimed') await loadWorkspace();
      if (claimed)
        history.replaceState(
          {},
          '',
          `${location.pathname}#/${claimed === 'expired' ? 'resume' : 'result'}`,
        );
    } else applyGuestWorkspace(await api('/guest/workspace'));
    render();
  } catch (error) {
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
    document.getElementById('startup-error').textContent = error.message;
    document.getElementById('retry').addEventListener('click', start);
  }
}
start();
