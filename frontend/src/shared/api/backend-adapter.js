import { parseCareerCatalog } from '../../features/job-postings/career-catalog.js';
import { extractReportJobContext } from '../../features/analysis/report-context.js';
import { backendStatusLabel } from '../../features/analysis/report-presentation.js';
import { recordFlowEvent } from '../../features/activity-flow/events.js';
import { sanitizeFlowProgressEvents, sanitizeGuestFlowEvents } from '../../features/activity-flow/backend-progress.js';

const ACCESS_KEY = 'careerlens.backend.access-token';
const REFRESH_KEY = 'careerlens.backend.refresh-token';
const STATE_KEY = 'careerlens.backend.workspace';
const GUEST_KEY = 'careerlens.backend.guest';
const CUSTOM_POSTINGS_KEY = 'careerlens.backend.mock-postings';
const BOOKMARKS_KEY = 'careerlens.backend.bookmarks';
const DEMO_SESSION_KEY = 'careerlens.backend.demo-session';
const DEMO_WORKSPACE_KEY = 'careerlens.backend.demo-workspace';
const REPORT_PAGE_SIZE = 20;
const LOCAL_CATALOG_TTL_MS = 5 * 60_000;
const JOB_LIST_TTL_MS = 30_000;
const LOCAL_GUEST_PREFIX = 'local-guest:';
const localGuestCapabilities = new WeakMap();
const localGuestStores = new WeakMap();
const localCatalogs = new WeakMap();
let backendJobLists = new WeakMap();

let enabled = false;

// A refreshed bearer token belongs to the same browser login. A new login,
// logout, or externally replaced token invalidates every in-flight owner guard.
let sessionGeneration = 0;
let sessionStorageOwner;
let knownAccessToken = null;

export function captureBackendSession() {
  const token = sessionStorage.getItem(ACCESS_KEY);
  if (sessionStorageOwner !== sessionStorage || knownAccessToken !== token) {
    sessionGeneration += 1;
    sessionStorageOwner = sessionStorage;
    knownAccessToken = token;
  }
  return { generation: sessionGeneration, token };
}

export function assertBackendSession(session, signal) {
  signal?.throwIfAborted();
  if (captureBackendSession().generation !== session.generation)
    throw new DOMException('계정이 변경되어 요청을 취소했습니다.', 'AbortError');
}

export function storeBackendCredentials(credentials, refreshedSession = null) {
  if (refreshedSession) assertBackendSession(refreshedSession);
  else {
    captureBackendSession();
    sessionGeneration += 1;
  }
  sessionStorage.setItem(ACCESS_KEY, credentials.access_token);
  if (credentials.refresh_token) sessionStorage.setItem(REFRESH_KEY, credentials.refresh_token);
  else if (!refreshedSession) sessionStorage.removeItem(REFRESH_KEY);
  knownAccessToken = credentials.access_token;
  sessionStorageOwner = sessionStorage;
  recordFlowEvent('local_data');
}

function ownerBoundRequest(transport, signal) {
  const session = captureBackendSession();
  const request = async (...args) => {
    assertBackendSession(session, signal);
    let result;
    try { result = await transport(...args); }
    catch (failure) {
      if (failure?.name !== 'AbortError') assertBackendSession(session, signal);
      throw failure;
    }
    assertBackendSession(session, signal);
    return result;
  };
  request.ApiError = transport.ApiError;
  return { request, assertCurrentOwner: () => assertBackendSession(session, signal) };
}

const mockPostings = [
  {
    id: 'mock-backend-engineer',
    company: '샘플테크',
    role: 'Python 백엔드 개발자',
    location: '서울',
    employment_type: '정규직',
    experience_level: '경력 3년 이상',
    skills: ['Python', 'FastAPI', 'PostgreSQL'],
    description: 'API와 데이터 서비스를 설계하고 운영하는 가상 채용공고입니다.',
    source_type: 'example',
    is_saved: false,
  },
  {
    id: 'mock-data-analyst',
    company: '오빗스튜디오',
    role: '데이터 분석가',
    location: '원격',
    employment_type: '정규직',
    experience_level: '경력 2년 이상',
    skills: ['SQL', 'Python', '실험 분석'],
    description: '제품 데이터 분석과 지표 기반 의사결정을 돕는 가상 채용공고입니다.',
    source_type: 'example',
    is_saved: false,
  },
  {
    id: 'mock-product-designer',
    company: '넥스트랩',
    role: '프로덕트 디자이너',
    location: '경기',
    employment_type: '정규직',
    experience_level: '경력 3년 이상',
    skills: ['Figma', '프로토타이핑', '사용자 조사'],
    description: '사용자 경험과 제품 인터랙션을 개선하는 가상 채용공고입니다.',
    source_type: 'example',
    is_saved: false,
  },
];

const resumeExample = {
  id: 'mock-resume-backend',
  title: '가상 백엔드 개발자 이력서',
  role: '백엔드 개발자',
  experience_level: '경력 3년',
  summary: 'API와 데이터 파이프라인을 개발한 가상 이력서 예시입니다.',
  skills: ['Python', 'FastAPI', 'PostgreSQL'],
  resume_text:
    '# 가상 이력서 예시\n\n## 경력\n- Python API 서비스를 개발하고 운영했습니다.\n- PostgreSQL 기반 데이터 모델을 설계했습니다.\n\n## 기술\nPython, FastAPI, PostgreSQL',
};

function storageGet(key, fallback = null) {
  try {
    const value = sessionStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  sessionStorage.setItem(key, JSON.stringify(value));
  recordFlowEvent('local_data', { source: key === DEMO_SESSION_KEY || key === DEMO_WORKSPACE_KEY || demoSession() ? 'demo' : 'observed' });
}

function storageRemove(key) {
  const existed = sessionStorage.getItem(key) !== null;
  const demo = key === DEMO_SESSION_KEY || key === DEMO_WORKSPACE_KEY || demoSession();
  sessionStorage.removeItem(key);
  if (existed) recordFlowEvent('local_data', { state: 'cleared', source: demo ? 'demo' : 'observed' });
}

function clearMemberStorage() {
  backendJobLists = new WeakMap();
  const keys = [];
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index);
    if (key === STATE_KEY || key?.startsWith(`${STATE_KEY}:`)) keys.push(key);
  }
  keys.forEach(storageRemove);
  storageRemove(ACCESS_KEY);
  storageRemove(REFRESH_KEY);
  storageRemove(BOOKMARKS_KEY);
}

function demoSession() {
  return storageGet(DEMO_SESSION_KEY, false) === true;
}

function demoWorkspace() {
  const state = storageGet(DEMO_WORKSPACE_KEY, {});
  const draft = {
    resume_text: state.resume_text || '',
    resume_id: 'demo-resume',
    filename: state.filename || '',
    career_target: state.career_target || null,
    analysis_mode: 'job_posting',
    ...(state.selected_posting
      ? {
          company: state.selected_posting.company,
          role: state.selected_posting.role,
          job_text: state.selected_posting.description,
          selected_posting_id: state.selected_posting.id,
        }
      : {}),
    ...(state.report ? { report: state.report, created_at: state.created_at || '' } : {}),
    ...(state.preparation ? { preparation: state.preparation } : {}),
  };
  return { draft, questions: state.questions || [] };
}

function updateDemoWorkspace(next) {
  const state = storageGet(DEMO_WORKSPACE_KEY, {});
  storageSet(DEMO_WORKSPACE_KEY, { ...state, ...next });
  return demoWorkspace();
}

function guestState() {
  const state = storageGet(GUEST_KEY, {});
  if (state.resume_text && (!Number.isFinite(Date.parse(state.expires_at)) || Date.parse(state.expires_at) <= Date.now())) {
    storageRemove(GUEST_KEY);
    return {};
  }
  return state;
}

function saveGuest(next) {
  const current = guestState();
  const changedInput = ['resume_text', 'career_target', 'selected_posting'].some((key) => Object.hasOwn(next, key));
  storageSet(GUEST_KEY, {
    ...current,
    ...(changedInput ? { preview_ready: false, analysis_pending: false, report_locked: false, completed: false, report: null, local_run: null } : {}),
    ...next,
    expires_at:
      current.expires_at ||
      (next.resume_text ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null),
  });
}

async function probeLocalGuest(request, signal) {
  try {
    const capabilities = await request('/local-guest/capabilities', { signal, auth: false });
    const available = capabilities?.available === true && capabilities.storage_origin === 'frontend_guest';
    localGuestCapabilities.set(request, available);
    localGuestStores.set(request, capabilities?.storage_origin === 'frontend_guest');
    return available;
  } catch (failure) {
    if (signal?.aborted || failure?.name === 'AbortError') throw failure;
    // An unavailable analysis server cannot produce a completed guest report.
    localGuestCapabilities.set(request, false);
    localGuestStores.set(request, false);
    return false;
  }
}

function localRunId(id) {
  return typeof id === 'string' && id.startsWith(LOCAL_GUEST_PREFIX) ? id.slice(LOCAL_GUEST_PREFIX.length) : null;
}

function localReport(result, ApiError) {
  if (!result || !['completed', 'partial'].includes(result.status) ||
      typeof result.run_id !== 'string' || !result.run_id ||
      typeof result.report_text !== 'string' || !result.report_text.trim() ||
      result.storage_origin !== 'frontend_guest')
    error(ApiError, '저장한 보고서 형식이 올바르지 않습니다.', 502, 'report_result_invalid');
  const scores = result.scores || {};
  const backendResult = {
    ...scores,
    run_id: `${LOCAL_GUEST_PREFIX}${result.run_id}`,
    criteria: result.criteria || result.report_data?.criteria || [],
    validation_status: scores.validation_status || result.status,
  };
  const mapped = mapBackendReport(backendResult, result.report_text, {
    id: `${LOCAL_GUEST_PREFIX}${result.run_id}`, status: result.status,
  });
  return { ...mapped, storage_origin: 'frontend_guest' };
}

function localReportWorkspace(result, ApiError) {
  const report = localReport(result, ApiError);
  const context = report.job_context;
  return { draft: {
    analysis_mode: 'saved_report', saved_report: true,
    company: context.company || result.job_summary?.company_name || '',
    role: context.title || result.job_summary?.title || '대상 공고 정보 없음',
    selected_posting_id: result.job_id || '',
    created_at: result.completed_at || result.created_at || '', report,
  }, questions: [] };
}

async function readLocalReport(id, request, signal) {
  const session = captureBackendSession();
  const value = await request(`/local-guest/reports/${encodeURIComponent(id)}`, { signal });
  assertBackendSession(session, signal);
  return value;
}

function storeGuestRun(update, expectedKey, ApiError) {
  const current = guestState();
  if (current.local_run?.idempotency_key !== expectedKey)
    throw new DOMException('임시 분석이 변경되었습니다.', 'AbortError');
  if (!update || typeof update.run_id !== 'string' || !update.run_id ||
      !['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'].includes(update.status) ||
      update.storage_origin !== 'frontend_guest')
    error(ApiError, '분석 상태를 확인하지 못했습니다.', 502, 'invalid_response');
  // Guest storage contains identifiers and progress only. The actual document
  // and scores remain server-side until a verified account claims the result.
  const complete = ['completed', 'partial'].includes(update.status) && update.completed === true;
  const serverExpiry = Date.parse(update.expires_at);
  const localExpiry = Date.parse(current.expires_at);
  saveGuest({
    ...(Number.isFinite(serverExpiry) ? { expires_at: new Date(Number.isFinite(localExpiry) ? Math.min(serverExpiry, localExpiry) : serverExpiry).toISOString() } : {}),
    local_run: { id: update.run_id, idempotency_key: expectedKey, status: update.status,
      progress_percent: Number.isFinite(update.progress_percent) ? update.progress_percent : null,
      current_stage: typeof update.current_stage === 'string' ? update.current_stage : '',
      created_at: update.created_at || '', completed_at: update.completed_at || '' },
    completed: complete, report_locked: complete, preview_ready: false, analysis_pending: false,
  });
}

function guestProgress(state, onProgress, metadata) {
  const run = state.local_run;
  onProgress?.({ run: { id: `${LOCAL_GUEST_PREFIX}${run.id}`, status: run.status,
    progress_percent: run.progress_percent, current_stage: run.current_stage }, events: [],
    execution: 'guest', flowEvents: sanitizeGuestFlowEvents(metadata?.flow_events),
    durationMs: typeof metadata?.analysis_duration_ms === 'number' && Number.isFinite(metadata.analysis_duration_ms)
      && metadata.analysis_duration_ms >= 0 && metadata.analysis_duration_ms <= 86400000 ? metadata.analysis_duration_ms : null });
}

async function runGuestAnalysis(request, signal, onProgress) {
  let guest = guestState();
  // A terminal run cannot resume. Only the user's next explicit attempt starts
  // another run; uncertain or still-running requests keep their existing key.
  if (['failed', 'cancelled'].includes(guest.local_run?.status)) {
    saveGuest({ local_run: null, completed: false, report_locked: false });
    guest = guestState();
  }
  if (!guest.local_run?.idempotency_key) {
    saveGuest({ local_run: { idempotency_key: crypto.randomUUID(), status: 'queued' }, completed: false,
      report_locked: false, preview_ready: false, analysis_pending: false });
    guest = guestState();
  }
  const key = guest.local_run.idempotency_key;
  const assertCurrent = () => {
    signal?.throwIfAborted();
    if (guestState().local_run?.idempotency_key !== key)
      throw new DOMException('임시 분석이 변경되었습니다.', 'AbortError');
  };
  if (!guest.local_run.id) {
    // Retain the creation response even if this view is cancelled. The server
    // may already have accepted a paid job; its ID is needed to stop that job.
    const started = await request('/local-guest/analyses', { method: 'POST', auth: false,
      idempotencyKey: key,
      body: { resume_text: guest.resume_text, job_id: guest.selected_posting.id, expires_at: guest.expires_at } });
    try { assertCurrent(); }
    catch (failure) {
      if (started?.run_id) await request(`/local-guest/analyses/${encodeURIComponent(started.run_id)}/cancel`,
        { method: 'POST', body: {}, auth: false, keepalive: true }).catch(() => {});
      throw failure;
    }
    storeGuestRun(started, key, request.ApiError);
  }
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    assertCurrent();
    guest = guestState();
    let update;
    try {
      update = await request(`/local-guest/analyses/${encodeURIComponent(guest.local_run.id)}`, { signal, auth: false });
    } catch (failure) {
      assertCurrent();
      if (![404, 410].includes(failure.status)) throw failure;
      storageRemove(GUEST_KEY);
      error(request.ApiError, '임시 분석이 만료되었습니다. 이력서를 다시 첨부해 주세요.', 409, 'guest_expired');
    }
    assertCurrent();
    storeGuestRun(update, key, request.ApiError);
    guest = guestState();
    guestProgress(guest, onProgress, update);
    if (guest.completed) return sessionMockWorkspace();
    if (['failed', 'cancelled'].includes(guest.local_run.status))
      error(request.ApiError, '분석을 완료하지 못했습니다. 다시 시도해 주세요.', 502,
        guest.local_run.status === 'cancelled' ? 'evaluation_cancelled' : 'evaluation_failed');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 2000);
      function abort() { clearTimeout(timer); reject(new DOMException('요청이 취소되었습니다.', 'AbortError')); }
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  error(request.ApiError, '분석 상태를 다시 확인해 주세요.', 504, 'evaluation_timeout');
}

function error(ApiError, message, status = 501, code = 'backend_feature_unavailable') {
  throw new ApiError(message, status, code);
}

function mockReport({ company, role }) {
  const report = {
    source: 'mock',
    score: 68,
    verdict: '시연용 결과',
    summary: `이 보고서는 ${company || '가상 기업'}의 ${role || '가상 직무'} 공고와 연결한 화면 시연용 예시입니다. 백엔드 평가를 실행한 결과가 아닙니다.`,
    criteria: [],
    matches: [],
    strengths: ['가상 보고서 화면을 확인할 수 있습니다.'],
    gaps: [
      '실제 평가 결과가 아닙니다. 실제 분석은 실제 계정과 백엔드 등록 이력서·공고가 필요합니다.',
    ],
    priorities: [],
    questions: [],
    reference_guidance: [],
    demo: true,
  };
  return { report };
}

async function demoApi(path, options, ApiError, catalog) {
  const method = options.method || 'GET';
  const body = options.body;
  const cleanPath = decodePath(path);
  if (cleanPath === '/auth/session') {
    return makeSession(
      demoSession()
        ? { id: 'demo-user', email: 'demo@careerlens.local', name: '시연', demo: true }
        : null,
    );
  }

  if (cleanPath === '/auth/logout' && method === 'POST') {
    storageRemove(DEMO_SESSION_KEY);
    storageRemove(DEMO_WORKSPACE_KEY);
    storageRemove(BOOKMARKS_KEY);
    return makeSession();
  }
  if (cleanPath === '/guest/workspace') return sessionMockWorkspace();
  if (cleanPath === '/guest/claim' && method === 'POST') {
    const guest = guestState();
    if (
      guest.filename ||
      guest.resume_text ||
      guest.report ||
      guest.career_target ||
      guest.selected_posting
    ) {
      storageSet(DEMO_WORKSPACE_KEY, {
        ...(guest.resume_text ? { resume_text: guest.resume_text } : {}),
        ...(guest.filename ? { filename: guest.filename } : {}),
        ...(guest.career_target ? { career_target: guest.career_target } : {}),
        ...(guest.selected_posting ? { selected_posting: guest.selected_posting } : {}),
        ...(guest.report
          ? {
              report: { ...guest.report, demo: true },
              created_at: new Date().toISOString(),
            }
          : {}),
      });
      storageRemove(GUEST_KEY);
    }
    return demoWorkspace();
  }
  if (cleanPath === '/workspace' && method === 'GET') return demoWorkspace();
  if (cleanPath === '/workspace' && method === 'DELETE') {
    storageRemove(DEMO_WORKSPACE_KEY);
    return demoWorkspace();
  }
  if (cleanPath === '/resume' && method === 'PUT') {
    if (typeof body?.resume_text !== 'string' || body.resume_text.length < 40)
      error(ApiError, '이력서를 40자 이상 입력해 주세요.', 400, 'resume_invalid');
    return updateDemoWorkspace({
      resume_text: body.resume_text,
      filename: '내 이력서.md',
      report: null,
    });
  }
  if (cleanPath === '/resume/upload' && method === 'POST') {
    const file = body.get('file');
    if (!file?.name) error(ApiError, '이력서 파일을 선택해 주세요.', 400);
    if (file.size > 10 * 1024 * 1024) error(ApiError, '파일은 10MB 이하로 선택해 주세요.', 413);
    if (!/\.(md|txt)$/i.test(file.name))
      error(ApiError, '시연용 계정은 Markdown 또는 텍스트 파일만 지원합니다.', 415);
    return updateDemoWorkspace({
      resume_text: await file.text(),
      filename: file.name,
      report: null,
    });
  }
  if (cleanPath === '/career-target' && method === 'PUT') {
    const target = {
      role_id: body.role_id || 'custom',
      label: body.role || catalog.roles.find((role) => role.id === body.role_id)?.label || '',
      focus: body.focus || '',
    };
    return updateDemoWorkspace({ career_target: target, report: null });
  }
  if (cleanPath === '/job-postings' && method === 'GET') {
    const available = [...catalog.postings, ...mockPostings, ...customPostings()];
    const params = new URLSearchParams(path.split('?')[1] || '');
    if (params.get('role_id')) {
      const label =
        params.get('role_id') === 'custom'
          ? params.get('role') || '선택 직무'
          : catalog.roles.find((role) => role.id === params.get('role_id'))?.label || '선택 직무';
      if (!available.some((posting) => posting.role === label)) {
        available.push({
          ...mockPostings[0],
          id: `mock-role-${encodeURIComponent(label)}`,
          company: 'CareerLens 시연 기업',
          role: label,
          description: `${label}의 관련 업무와 요구 역량을 확인하는 시연용 가상 공고입니다. 실제 채용공고가 아니며, 백엔드 평가에도 사용할 수 없습니다.`,
          source_type: 'example',
        });
      }
    }
    const roleScope = applyPostingRoleScope(params, catalog.roles);
    const items = filteredPostings(available, params);
    const page = Math.max(1, Number(params.get('page')) || 1);
    const pageSize = Math.max(1, Number(params.get('page_size')) || 12);
    const bookmarks = new Set(storageGet(BOOKMARKS_KEY, []));
    const postings = items.map((posting) => ({ ...posting, is_saved: bookmarks.has(posting.id) }));
    const selected = postings.slice((page - 1) * pageSize, page * pageSize);
    return {
      items: selected,
      total: postings.length,
      available_total: available.length,
      ...roleScope,
      page,
      page_size: pageSize,
      filters: {
        roles: [
          ...new Set(available.map((item) => item.role_category || item.role).filter(Boolean)),
        ].sort((a, b) => a.localeCompare(b, 'ko')),
        locations: [...new Set(available.map((item) => item.location))],
        employment_types: [...new Set(available.map((item) => item.employment_type))],
        experience_levels: [...new Set(available.map((item) => item.experience_level))],
        skills: [...new Set(available.flatMap((item) => item.skills))],
      },
      mock_notice: '시연용 가상 공고이며 실제 백엔드 평가에 사용할 수 없습니다.',
    };
  }
  if (cleanPath === '/job-matches') return { items: [], total: 0 };
  const customPostingPath = /^\/job-postings\/([^/]+)$/.exec(cleanPath);
  if (customPostingPath && method === 'DELETE') {
    const id = decodeURIComponent(customPostingPath[1]);
    storageSet(
      CUSTOM_POSTINGS_KEY,
      customPostings().filter((posting) => posting.id !== id),
    );
    return null;
  }
  if ((customPostingPath || cleanPath === '/job-postings') && ['PUT', 'POST'].includes(method)) {
    const posting = {
      ...body,
      id: customPostingPath?.[1] || `mock-custom-${crypto.randomUUID()}`,
      source_type: 'mock',
      company: body.company || '직접 입력',
      role: body.role || body.title || '',
      description: body.description || '',
      skills: body.skills || [],
      is_saved: false,
    };
    const postings = customPostings().filter((item) => item.id !== posting.id);
    storageSet(CUSTOM_POSTINGS_KEY, [...postings, posting]);
    return { posting };
  }
  const select = /^\/job-postings\/([^/]+)\/select$/.exec(cleanPath);
  if (select && method === 'POST') {
    const posting = mockPosting(decodeURIComponent(select[1]), catalog.postings);
    if (!posting) error(ApiError, '시연용 공고를 찾을 수 없습니다.', 404);
    return updateDemoWorkspace({
      selected_posting: posting,
      report: null,
      questions: [],
    });
  }
  const bookmark = /^\/job-postings\/([^/]+)\/bookmark$/.exec(cleanPath);
  if (bookmark && ['POST', 'DELETE'].includes(method)) {
    const id = decodeURIComponent(bookmark[1]);
    const saved = new Set(storageGet(BOOKMARKS_KEY, []));
    if (method === 'POST') saved.add(id);
    else saved.delete(id);
    storageSet(BOOKMARKS_KEY, [...saved]);
    const posting = mockPosting(id, catalog.postings);
    if (!posting) error(ApiError, '시연용 공고를 찾을 수 없습니다.', 404);
    return { posting: { ...posting, is_saved: saved.has(id) } };
  }
  const detail = /^\/job-postings\/([^/]+)$/.exec(cleanPath);
  if (detail && method === 'GET') {
    const posting = mockPosting(decodeURIComponent(detail[1]), catalog.postings);
    if (!posting) error(ApiError, '시연용 공고를 찾을 수 없습니다.', 404);
    return { posting };
  }
  if (cleanPath === '/analysis' && method === 'POST') {
    const state = storageGet(DEMO_WORKSPACE_KEY, {});
    const { report } = mockReport(state.selected_posting || mockPostings[0]);
    const savedReport = { ...report, demo: true };
    updateDemoWorkspace({ report: savedReport, created_at: new Date().toISOString() });
    return { report: savedReport };
  }
  if (cleanPath === '/preparation' && method === 'POST') {
    const state = storageGet(DEMO_WORKSPACE_KEY, {});
    const stages = new Map((state.preparation?.stages || []).map((stage) => [stage.id, stage]));
    stages.set(body.stage, { id: body.stage, status: 'complete', detail: '시연용 단계 완료' });
    const preparation = {
      ...(state.preparation || {}),
      complete: ['resume', 'role', 'report'].every((id) => stages.get(id)?.status === 'complete'),
      stages: [...stages.values()],
    };
    return { ...updateDemoWorkspace({ preparation }), preparation };
  }
  if (cleanPath === '/resume-examples') {
    return {
      items: Array.from({ length: 12 }, (_, index) => ({
        ...resumeExample,
        id: `mock-resume-${index + 1}`,
        title: index ? `${resumeExample.title} ${index + 1}` : resumeExample.title,
      })),
      total: 12,
      page: 1,
      page_size: 12,
    };
  }
  const resumeExamplePath = /^\/resume-examples\/([^/]+)$/.exec(cleanPath);
  if (resumeExamplePath && method === 'GET')
    return { example: { ...resumeExample, id: decodeURIComponent(resumeExamplePath[1]) } };
  if (cleanPath === '/example' && method === 'POST')
    return updateDemoWorkspace({
      resume_text: resumeExample.resume_text,
      filename: resumeExample.title,
      report: null,
    });
  error(ApiError, '이 기능은 시연 계정에서 지원하지 않습니다.', 501);
}

function matchingCatalogPosting(posting, catalogPostings) {
  if (posting.source_name !== 'local_markdown') return undefined;
  return catalogPostings.find(
    (item) =>
      item.source_name === posting.source_name &&
      item.source_external_id === posting.source_external_id,
  );
}

function mapJob(posting, companyName = '', catalogPostings = []) {
  const local = matchingCatalogPosting(posting, catalogPostings);
  const sourceMarkdown =
    posting.source_name === 'local_markdown' && typeof posting.description === 'string'
      ? posting.description
      : '';
  // Read metadata from the backend's current document, never an older local copy.
  const sourceField = (name) =>
    new RegExp(`^\\s*-\\s+\\*\\*${name}:\\*\\*\\s*(.*?)\\s*$`, 'm')
      .exec(sourceMarkdown)?.[1]
      ?.trim() || '';
  const role = posting.role || sourceField('직무명') || posting.title;
  const requirements = Array.isArray(posting.requirements)
    ? posting.requirements.map((item) =>
        typeof item === 'string' ? item : item.name || item.text || '',
      )
    : [];
  const preferred = Array.isArray(posting.preferred_requirements)
    ? posting.preferred_requirements.map((item) =>
        typeof item === 'string' ? item : item.name || item.text || '',
      )
    : [];
  const skills = [...new Set([...requirements, ...preferred].filter(Boolean))].slice(0, 12);
  const minimum = posting.career_min_months;
  const maximum = posting.career_max_months;
  const monthsLabel = (months) => {
    const years = Math.floor(months / 12);
    const rest = months % 12;
    return (
      [years ? `${years}년` : '', rest ? `${rest}개월` : ''].filter(Boolean).join(' ') || '0개월'
    );
  };
  return {
    id: posting.id,
    company:
      companyName ||
      posting.company_name ||
      posting.company ||
      sourceField('회사명') ||
      '기업 정보 없음',
    role,
    // The local taxonomy is supplementary, and applies only while the role still matches.
    role_category: posting.role_category || (local?.role === role ? local.role_category : '') || '',
    title: posting.title || sourceField('공고명') || '공고명 정보 없음',
    location: posting.location || sourceField('근무지') || '근무지 정보 없음',
    employment_type: posting.employment_type || sourceField('고용형태') || '정보 없음',
    experience_level:
      minimum == null && maximum == null
        ? sourceField('경력') || '경력 요건 미정'
        : maximum == null
          ? `경력 ${monthsLabel(minimum)} 이상`
          : minimum == null
            ? `경력 ${monthsLabel(maximum)} 이하`
            : `경력 ${monthsLabel(minimum)}~${monthsLabel(maximum)}`,
    skills,
    description: [
      posting.description,
      ...(Array.isArray(posting.responsibilities) ? posting.responsibilities : []),
      ...requirements,
      ...preferred,
    ]
      .filter(Boolean)
      .map((value) => (typeof value === 'string' ? value : value.text || value.name || ''))
      .filter(Boolean)
      .join('\n'),
    source_markdown: sourceMarkdown,
    source_name: posting.source_name || '',
    source_external_id: posting.source_external_id || '',
    source_type: 'backend',
    is_example: Boolean(local),
    source_url: posting.source_url || '',
    is_saved: false,
  };
}

function mockPosting(id, catalogPostings = []) {
  const custom = storageGet(CUSTOM_POSTINGS_KEY, []);
  return (
    [...catalogPostings, ...mockPostings, ...custom].find((posting) => posting.id === id) || null
  );
}

// Scope changes only browsing. The selected backend posting ID remains unchanged.
function applyPostingRoleScope(params, roles) {
  const selectedRole = roles.find(
    (role) => role.id === params.get('role_id') && role.id !== 'custom',
  );
  if (selectedRole) params.set('role', selectedRole.label);
  if (!params.has('role_scope')) return {};

  const requested = params.get('role_scope');
  const scope = ['category', 'exact', 'all'].includes(requested) ? requested : 'category';
  const category = selectedRole?.role_category || '';
  const categoryUnavailable = scope === 'category' && selectedRole && !category;
  // Older local servers may not expose the optional source taxonomy yet.
  // Keep all postings visible instead of silently reverting to one exact title.
  if (scope === 'all' || categoryUnavailable) {
    params.delete('role');
  } else if (scope === 'category' && category) {
    params.delete('role');
    params.set('role_category', category);
  } else if (selectedRole) {
    params.delete('role');
    params.set('role_exact', selectedRole.label);
  }
  // Free-text roles keep keyword matching when no source classification is available.
  return {
    role_scope: categoryUnavailable ? 'all' : scope === 'category' && !category ? 'exact' : scope,
    role_category: category,
  };
}

function filteredPostings(items, params) {
  const q = (params.get('q') || '').toLocaleLowerCase();
  const role = (params.get('role') || '').toLocaleLowerCase();
  const roleCategory = params.get('role_category') || '';
  const exactRole = params.get('role_exact') || '';
  const filters = ['location', 'employment_type', 'experience_level', 'skill'];
  let result = items.filter((posting) => {
    const text =
      `${posting.company} ${posting.role} ${posting.description} ${posting.skills.join(' ')}`.toLocaleLowerCase();
    return (
      (!q || text.includes(q)) &&
      (!roleCategory || posting.role_category === roleCategory || posting.role === roleCategory) &&
      (!exactRole || posting.role === exactRole) &&
      (!role || `${posting.role} ${posting.description}`.toLocaleLowerCase().includes(role)) &&
      filters.every((key) => {
        const value = params.get(key);
        return (
          !value || (key === 'skill' ? posting.skills.includes(value) : posting[key] === value)
        );
      })
    );
  });
  const saved = new Set(storageGet(BOOKMARKS_KEY, []));
  result = result.map((posting) => ({ ...posting, is_saved: saved.has(posting.id) }));
  if (params.get('saved') === '1') result = result.filter((posting) => posting.is_saved);
  return result;
}

function mapBackendReport(result, reportText = '', run = {}) {
  const categories = [
    ['resume_completeness', '이력서 완성도'],
    ['job_fit', '직무 적합도'],
    ['qualifications', '지원 자격 충족도'],
    ['practical_competitiveness', '실무 경쟁력'],
  ];
  const criteria = (result.criteria || []).map((item) => {
    const detail = item.evaluation_criteria || {};
    return {
      ...item,
      code: detail.criterion_code || '',
      label: detail.name_ko || detail.criterion_code || '평가 기준',
      domain_code: detail.domain_code || '',
      weight: detail.weight ?? null,
      score: item.score,
      max_score: 100,
      detail: item.reasoning_summary || '',
      status:
        item.verdict === 'met'
          ? 'confirmed'
          : item.verdict === 'not_applicable'
            ? 'excluded'
            : item.verdict === 'not_met'
              ? 'missing'
              : 'partial',
    };
  });
  const matches = criteria.map((criterion, index) => {
    const original = result.criteria[index];
    const evidence = Array.isArray(original.evidence) ? original.evidence : [];
    return {
      requirement: criterion.label,
      status: criterion.status,
      verdict: criterion.verdict,
      confidence: criterion.confidence,
      validation_status: criterion.validation_status,
      comparison_basis: criterion.comparison_basis,
      estimated: criterion.estimated,
      issues: criterion.issues,
      evidence_items: evidence
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          ...item,
          excerpt: item.quote || item.text || item.excerpt || '',
          source_label:
            item.source === 'resume'
              ? '이력서'
              : item.source === 'job'
                ? '채용공고'
                : item.source_label || '출처 정보 없음',
        })),
    };
  });
  // An omitted overall score is withheld, not permission to invent a frontend average.
  const score = Number.isFinite(result.overall_score) ? result.overall_score : null;
  const scoreComponents = Object.fromEntries(
    categories.map(([key, label]) => [key, { label, score: result[key] ?? null }]),
  );
  const unresolved = criteria.filter((item) => ['missing', 'partial'].includes(item.status));
  return {
    source: 'backend',
    score,
    score_components: scoreComponents,
    verdict: result.eligibility_status || result.validation_status || '평가 완료',
    summary:
      score === null
        ? `백엔드 평가가 완료되었습니다. 종합점수는 제공되지 않았습니다. 검증 상태: ${backendStatusLabel(result.validation_status || '미확정')}.`
        : `백엔드 평가 결과 종합점수는 ${Math.round(score)}점입니다. 점수와 판정은 저장된 이력서 및 채용공고를 기준으로 산출되었습니다.`,
    criteria: criteria.filter((item) => Number.isFinite(item.score)),
    matches,
    strengths: criteria
      .filter((item) => item.status === 'confirmed' && item.detail.trim())
      .map((item) => `${item.label}: ${item.detail}`),
    gaps: unresolved
      .filter((item) => item.detail.trim())
      .map((item) => `${item.label}: ${item.detail}`),
    priorities: criteria
      .filter(
        (item) =>
          item.status !== 'excluded' &&
          typeof item.improvement_suggestion === 'string' &&
          item.improvement_suggestion.trim(),
      )
      .map((item) => ({
        title: item.label,
        detail: item.improvement_suggestion,
      })),
    questions: [],
    reference_guidance: [],
    backend_report_text: reportText,
    job_context: extractReportJobContext(reportText),
    status: run.status || result.validation_status,
    run_id: run.id || result.run_id || '',
    validation_status: result.validation_status || '',
    eligibility_status: result.eligibility_status || '',
    backend_criteria: Array.isArray(result.criteria) ? result.criteria : [],
    backend_result: result,
  };
}

function requireReportSession(ApiError) {
  if (!sessionStorage.getItem(ACCESS_KEY))
    error(ApiError, '저장한 보고서를 보려면 로그인해 주세요.', 401, 'login_required');
}

async function savedReportList(path, request, signal, ApiError) {
  const rawOffset = new URLSearchParams(path.split('?')[1] || '').get('offset') ?? '0';
  const offset = Number(rawOffset);
  if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(offset) || offset < 0)
    error(ApiError, '보고서 목록 위치가 올바르지 않습니다.', 400, 'report_offset_invalid');
  if (demoSession()) return { items: [], next_offset: null, demo: true };
  requireReportSession(ApiError);
  request = ownerBoundRequest(request, signal).request;
  const runs = await request(`/evaluations?limit=${REPORT_PAGE_SIZE}&offset=${offset}`, { signal });
  if (
    !Array.isArray(runs) ||
    runs.some(
      (run) =>
        !run ||
        typeof run.id !== 'string' ||
        !run.id ||
        typeof run.status !== 'string' ||
        typeof run.created_at !== 'string',
    )
  )
    error(ApiError, '저장한 보고서 목록 형식이 올바르지 않습니다.', 502, 'report_list_invalid');
  const nextOffset = runs.length === REPORT_PAGE_SIZE ? offset + REPORT_PAGE_SIZE : null;
  if (nextOffset !== null && !Number.isSafeInteger(nextOffset))
    error(ApiError, '보고서의 다음 목록 위치가 올바르지 않습니다.', 502, 'report_offset_invalid');
  const items = runs
      .filter((run) => ['completed', 'partial'].includes(run.status))
      .map(({ id, status, created_at }) => ({ id, status, created_at }));
  return {
    items,
    next_offset: nextOffset,
  };
}

function savedReportId(encodedId, ApiError) {
  if (demoSession())
    error(ApiError, '시연 계정에는 저장된 실제 보고서가 없습니다.', 404, 'saved_report_missing');
  requireReportSession(ApiError);
  let id;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    error(ApiError, '보고서 주소가 올바르지 않습니다.', 400, 'report_id_invalid');
  }
  return id;
}

async function storedReportBody(id, request, signal, ApiError) {
  const result = await request(`/evaluations/${encodeURIComponent(id)}/result`, { signal });
  if (!result || !Array.isArray(result.reports) || !Array.isArray(result.criteria))
    error(ApiError, '저장한 평가 결과 형식이 올바르지 않습니다.', 502, 'report_result_invalid');
  const latestReport = result.reports
    .filter(
      (report) => report?.status === 'completed' && typeof report.id === 'string' && report.id,
    )
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))[0];
  if (!latestReport)
    error(ApiError, '이 평가에 저장된 완료 보고서가 없습니다.', 404, 'saved_report_missing');
  const report = await request(`/reports/${encodeURIComponent(latestReport.id)}`, { signal });
  if (report?.status !== 'completed')
    error(ApiError, '보고서 작성이 아직 완료되지 않았습니다.', 409, 'saved_report_incomplete');
  if (typeof report.report_text !== 'string' || !report.report_text.trim())
    error(ApiError, '저장한 보고서의 본문이 비어 있습니다.', 502, 'saved_report_empty');
  return { result, report };
}

async function savedReportContext(encodedId, request, signal, ApiError) {
  request = ownerBoundRequest(request, signal).request;
  const id = savedReportId(encodedId, ApiError);
  if (localRunId(id)) {
    const workspace = localReportWorkspace(await readLocalReport(localRunId(id), request, signal), ApiError);
    return { job_context: { company: workspace.draft.company, title: workspace.draft.role } };
  }
  const { report } = await storedReportBody(id, request, signal, ApiError);
  return { job_context: extractReportJobContext(report.report_text) };
}

function backendReportDate(run = {}, result = {}, report = {}) {
  return (
    report.completed_at ||
    run.completed_at ||
    report.created_at ||
    result.created_at ||
    run.created_at ||
    run.started_at ||
    ''
  );
}

async function savedReportWorkspace(encodedId, request, signal, ApiError) {
  request = ownerBoundRequest(request, signal).request;
  const id = savedReportId(encodedId, ApiError);
  if (localRunId(id)) return localReportWorkspace(await readLocalReport(localRunId(id), request, signal), ApiError);
  const run = await request(`/evaluations/${encodeURIComponent(id)}`, { signal });
  if (!run || typeof run.id !== 'string' || !run.id)
    error(ApiError, '평가 정보 형식이 올바르지 않습니다.', 502, 'report_run_invalid');
  if (!['completed', 'partial'].includes(run.status))
    error(ApiError, '아직 완료되지 않았거나 취소된 평가입니다.', 409, 'saved_report_incomplete');
  const { result, report } = await storedReportBody(id, request, signal, ApiError);
  const context = extractReportJobContext(report.report_text);
  return {
    draft: {
      analysis_mode: 'saved_report',
      saved_report: true,
      role: context.title || '대상 공고 정보 없음',
      company: context.company,
      created_at: backendReportDate(run, result, report),
      report: mapBackendReport(result, report.report_text, run),
    },
    questions: [],
  };
}

function makeSession(user = null, realGuest = false) {
  return {
    user,
    csrf_token: '',
    providers: [],
    mail_mode: 'unavailable',
    backend_adapter: true,
    capabilities: {
      guest_analysis: realGuest,
      guest_report_preview: false,
      document_conversion: !user?.demo,
      password_reset: false,
      preparation_analysis: false,
    },
  };
}

async function backendUser(request, signal) {
  const profile = await request('/me', { signal });
  return profileUser(profile, request.ApiError);
}

function profileUser(profile, ApiError) {
  const id = profile.user_id || profile.id;
  if (!id) error(ApiError, '로그인한 계정을 확인하지 못했습니다.', 502, 'profile_invalid');
  const label = [profile.display_name, profile.name, profile.email].find(
    (value) => typeof value === 'string' && value.trim(),
  );
  return {
    ...profile,
    id,
    name: label?.trim() || '회원',
    // This value comes from the authenticated /me response, never an email list,
    // query parameter, user-editable metadata, or a client preference.
    is_admin: profile.is_admin === true || profile.role === 'admin',
  };
}

function decodePath(path) {
  return path.split('?')[0];
}

async function careerCatalog(request, signal) {
  signal?.throwIfAborted();
  const cached = localCatalogs.get(request);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const response = await request('/local-data/career-markdown', { signal, auth: false });
  signal?.throwIfAborted();
  const value = parseCareerCatalog(response.items);
  localCatalogs.set(request, { value, expiresAt: Date.now() + LOCAL_CATALOG_TTL_MS });
  return value;
}

async function backendJobRecords(request, signal, includeDetails = false) {
  const records = [];
  const seen = new Set();
  for (let offset = 0; ; offset += 100) {
    const page = await request(
      `/jobs?limit=100${offset ? `&offset=${offset}` : ''}${includeDetails ? '&include_details=true' : ''}`,
      { signal },
    );
    if (!Array.isArray(page))
      error(request.ApiError, '채용공고 목록 형식이 올바르지 않습니다.', 502, 'jobs_invalid');
    const unseen = page.filter((posting) => !seen.has(posting.id));
    for (const posting of unseen) seen.add(posting.id);
    records.push(...unseen);
    if (page.length < 100) return records;
    if (!unseen.length)
      error(
        request.ApiError,
        '채용공고의 다음 목록을 불러오지 못했습니다.',
        502,
        'jobs_pagination_failed',
      );
  }
}

async function backendJobs(request, catalogPostings = [], signal) {
  signal?.throwIfAborted();
  const token = sessionStorage.getItem(ACCESS_KEY);
  const cached = backendJobLists.get(request);
  if (cached && cached.token === token && cached.catalogPostings === catalogPostings && cached.expiresAt > Date.now())
    return cached.value;
  // One authenticated page includes the current filter fields and company name.
  // Older servers ignore the optional flag; only those responses need hydration.
  const records = await backendJobRecords(request, signal, true);
  const companies = new Map();
  const mapped = new Array(records.length);
  let index = 0;
  async function companyName(id) {
    if (!id) return '';
    if (!companies.has(id)) {
      companies.set(
        id,
        request(`/companies/${encodeURIComponent(id)}`, { signal })
          .then((company) => company.name || '')
          .catch((failure) => {
            if (failure.status !== 404) throw failure;
            return '';
          }),
      );
    }
    return companies.get(id);
  }
  async function worker() {
    while (index < records.length) {
      signal?.throwIfAborted();
      const position = index++;
      const record = records[position];
      let raw = record;
      if (record.description === undefined) {
        try {
          raw = await request(`/jobs/${encodeURIComponent(record.id)}`, { signal });
        } catch (failure) {
          if (failure.status === 404) continue;
          throw failure;
        }
      }
      if (!raw || raw.id !== record.id)
        error(request.ApiError, '채용공고 상세 형식이 올바르지 않습니다.', 502, 'job_invalid');
      const company = Object.hasOwn(raw, 'companies')
        ? (typeof raw.companies?.name === 'string' ? raw.companies.name : '')
        : await companyName(raw.company_id);
      mapped[position] = mapJob(raw, company, catalogPostings);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, records.length) }, worker));
  signal?.throwIfAborted();
  const value = mapped.filter(Boolean);
  // Completed lists only: a failed/cancelled fetch cannot poison later browsing.
  // Detail and evaluation selection still read the current server record.
  backendJobLists.set(request, { token, catalogPostings, value, expiresAt: Date.now() + JOB_LIST_TTL_MS });
  return value;
}

async function getMemberWorkspace(request, signal) {
  const transport = request;
  const owner = ownerBoundRequest(request, signal);
  const assertCurrentOwner = owner.assertCurrentOwner;
  // A workspace can span several requests without an AbortSignal. Keep every
  // response and state write bound to the account that started this load.
  request = owner.request;
  const user = await backendUser(request, signal);
  const key = `${STATE_KEY}:${user.id}`;
  const saveState = (value) => {
    assertCurrentOwner();
    // A slower workspace read must not erase another request's creation intent.
    const current = storageGet(key, {});
    storageSet(key, { ...value, ...(Object.hasOwn(current, 'pending_evaluation')
      ? { pending_evaluation: current.pending_evaluation } : {}) });
  };
  let state = storageGet(key, {});
  let restoredLocalReport = null;
  const resumes = await request('/resumes?limit=100', { signal });
  let resume = resumes.find((item) => item.id === state.resume_id) || resumes[0] || null;
  if (resume) {
    state = { ...state, resume_id: resume.id };
    saveState(state);
    resume = await request(`/resumes/${encodeURIComponent(resume.id)}`, { signal });
  }
  const draft = {
    resume_text: resume?.original_text || state.claimed_resume_text || '',
    resume_id: resume?.id || '',
    filename: resume?.title || '',
    career_target: state.career_target || null,
    analysis_mode: 'job_posting',
  };
  let selected = state.selected_posting;
  if (state.selected_posting_id && (!selected || selected.source_type === 'backend')) {
    try {
      selected = await backendPosting(
        state.selected_posting_id,
        request,
        signal,
        selected ? [selected] : [],
      );
    } catch (failure) {
      if (failure.status !== 404) throw failure;
      selected = null;
    }
    state = { ...state, selected_posting: selected, selected_posting_id: selected?.id || '' };
    saveState(state);
  }
  if (selected) {
    draft.company = selected.company;
    draft.role = selected.role;
    draft.job_text = selected.description;
    draft.selected_posting_id = selected.id;
  }
  if (state.pending_guest_analysis === true) {
    draft.pending_guest_analysis = Boolean(resume?.id && selected?.source_type === 'backend');
    if (draft.pending_guest_analysis) {
      draft.selected_posting = Object.fromEntries(
        ['id', 'company', 'role', 'description', 'source_type', 'source_name', 'source_external_id']
          .map((field) => [field, selected[field] || '']),
      );
    } else {
      state = { ...state, pending_guest_analysis: false };
      saveState(state);
    }
  }
  const restoreLatest = !state.report && !state.suppress_latest_report && !state.pending_guest_analysis;
  if (restoreLatest) {
    try {
      const runs = await request('/evaluations?limit=1', { signal });
      if (runs[0] && ['completed', 'partial'].includes(runs[0].status)) {
        const result = await request(`/evaluations/${encodeURIComponent(runs[0].id)}/result`, {
          signal,
        });
        const reportId = result.reports?.[0]?.id;
        const report = reportId
          ? await request(`/reports/${encodeURIComponent(reportId)}`, { signal })
          : null;
        state.report = mapBackendReport(result, report?.report_text || '', runs[0]);
        state.report_created_at = backendReportDate(runs[0], result, report || {});
        saveState(state);
      }
    } catch (failure) {
      // Restoring a prior report is optional. Old server-side records may no
      // longer satisfy the new response schema; keep login and new work usable.
      // Authentication and cancellation failures must still propagate.
      if (![404, 409, 500, 502, 503, 504].includes(failure.status)) throw failure;
    }
  }
  if (restoreLatest && localGuestStores.get(transport) === true) {
    const response = await request('/local-guest/reports', { signal });
    const latest = Array.isArray(response.reports)
      ? response.reports.filter((item) => ['completed', 'partial'].includes(item.status))
        .sort((a, b) => Date.parse(b.completed_at || b.created_at) - Date.parse(a.completed_at || a.created_at))[0]
      : null;
    if (latest && (!state.report || Date.parse(latest.completed_at || latest.created_at) > Date.parse(state.report_created_at || 0))) {
      const local = await readLocalReport(latest.run_id, request, signal);
      restoredLocalReport = local;
      state.report = localReport(local, request.ApiError);
      state.report_created_at = local.completed_at || local.created_at || '';
      state.claimed_resume_text = local.resume_text || '';
      saveState(state);
    }
  }
  if (localRunId(state.report?.run_id)) {
    try {
      const local = restoredLocalReport || await readLocalReport(localRunId(state.report.run_id), request, signal);
      state.report = localReport(local, request.ApiError);
      state.report_created_at = local.completed_at || local.created_at || '';
      // A claimed guest report belongs to its original input, even when this
      // account already has an unrelated resume stored in the team backend.
      state.claimed_resume_text = typeof local.resume_text === 'string' ? local.resume_text : '';
      state.resume_id = '';
      draft.resume_text = state.claimed_resume_text;
      draft.resume_id = '';
      draft.filename = '';
      saveState(state);
    } catch (failure) {
      if (failure.status !== 404 && failure.status !== 410) throw failure;
      state = { ...state, report: null, suppress_latest_report: true };
      saveState(state);
    }
  }
  if (state.report && !state.pending_guest_analysis) {
    if (state.report.source === 'backend' && state.report.backend_result) {
      // Refresh derived labels for existing tabs without changing the stored server result.
      const origin = state.report.storage_origin;
      state.report = mapBackendReport(
        state.report.backend_result,
        state.report.backend_report_text || '',
        {
          id: state.report.run_id,
          status: state.report.status,
        },
      );
      if (origin) state.report.storage_origin = origin;
    }
    draft.report = state.report;
    draft.created_at = state.report_created_at || '';
  }
  if (state.preparation) draft.preparation = unavailablePreparation();
  assertCurrentOwner();
  return { user, workspace: { draft, questions: state.questions || [] }, state, key };
}

function unavailablePreparation() {
  return {
    available: false,
    status: 'unavailable',
    complete: false,
    stages: [],
    questions: [],
    resume_evidence: {},
  };
}

async function runBackendAnalysis(request, signal, onProgress) {
  const transport = request;
  const session = captureBackendSession();
  const owner = ownerBoundRequest(request, signal);
  const { workspace, state, key } = await getMemberWorkspace(request, signal);
  owner.assertCurrentOwner();
  request = owner.request;
  if (!workspace.draft.resume_id)
    error(
      request.ApiError,
      '백엔드에 저장된 이력서가 없습니다. 이력서를 먼저 저장해 주세요.',
      400,
      'resume_required',
    );
  if (!state.selected_posting_id || state.selected_posting?.source_type !== 'backend')
    error(
      request.ApiError,
      '이 공고는 평가 서버에 등록되어 있지 않습니다. 백엔드 등록 공고를 선택해 주세요.',
      409,
      'backend_posting_required',
    );

  const input = { resume_id: workspace.draft.resume_id, job_posting_id: state.selected_posting_id };
  const previous = storageGet(key, state).pending_evaluation;
  const attempt = previous && previous.resume_id === input.resume_id && previous.job_posting_id === input.job_posting_id &&
    typeof previous.idempotency_key === 'string' && previous.idempotency_key &&
    Number.isFinite(previous.created_at) && Date.now() - previous.created_at < 24 * 60 * 60_000
    ? previous : { ...input, idempotency_key: crypto.randomUUID(), created_at: Date.now() };
  const saveAttempt = (value) => {
    owner.assertCurrentOwner();
    const current = storageGet(key, state);
    if (value === null && current.pending_evaluation?.idempotency_key !== attempt.idempotency_key) return;
    storageSet(key, { ...current, pending_evaluation: value });
  };
  // Persist before transport: retrying a lost response must recover the same run.
  saveAttempt(attempt);
  let started;
  try {
    // Keep the creation response observable after user cancellation so the UI
    // can cancel a run accepted concurrently; never use a replacement login.
    started = await transport('/evaluations', { method: 'POST', body: input, idempotencyKey: attempt.idempotency_key });
    assertBackendSession(session);
  } catch (failure) {
    if ([400, 404, 409, 413, 422].includes(failure.status)) saveAttempt(null);
    throw failure;
  }
  if (typeof started?.run_id !== 'string' || !started.run_id)
    error(request.ApiError, '분석 요청 결과를 확인하지 못했습니다. 다시 시도해 주세요.', 502, 'invalid_response');
  const runId = started.run_id;
  let lastEventId = 0;
  onProgress?.({
    run: {
      id: runId,
      status: started.status || 'queued',
      progress_percent: 0,
      current_stage: 'queued',
    },
    events: [],
  });
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('요청이 취소되었습니다.', 'AbortError');
    let update;
    try {
      update = await request(
        `/evaluations/${encodeURIComponent(runId)}/progress?after_id=${lastEventId}`,
        { signal },
      );
    } catch (failure) {
      if (failure.status !== 404) throw failure;
      const run = await request(`/evaluations/${encodeURIComponent(runId)}`, { signal });
      update = { run, events: [] };
    }
    const status = update.run;
    for (const event of update.events || []) {
      if (Number.isSafeInteger(event.id)) lastEventId = Math.max(lastEventId, event.id);
    }
    onProgress?.({
      run: Object.fromEntries(
        ['id', 'status', 'current_stage', 'progress_percent', 'started_at', 'completed_at']
          .filter((key) => Object.hasOwn(status, key))
          .map((key) => [key, status[key]]),
      ),
      events: [],
      flowEvents: sanitizeFlowProgressEvents(update.events),
    });
    if (['failed', 'cancelled'].includes(status.status)) {
      saveAttempt(null);
      error(
        request.ApiError,
        status.status === 'cancelled'
          ? '분석이 취소되었습니다. 공고를 선택해 다시 시작할 수 있습니다.'
          : '분석을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        502,
        status.status === 'cancelled' ? 'evaluation_cancelled' : 'evaluation_failed',
      );
    }
    if (['completed', 'partial'].includes(status.status)) {
      // A throttled tab may receive a terminal run with an older full event page.
      // Drain bounded pages before showing the final report; telemetry failure
      // must not turn a successfully completed evaluation into an application error.
      let pageEvents = update.events;
      for (let page = 0; Array.isArray(pageEvents) && pageEvents.length === 100 && page < 9; page += 1) {
        const previousId = lastEventId;
        let remaining;
        try {
          remaining = await request(`/evaluations/${encodeURIComponent(runId)}/progress?after_id=${lastEventId}`, { signal });
        } catch { break; }
        pageEvents = remaining.events;
        for (const event of Array.isArray(pageEvents) ? pageEvents : [])
          if (Number.isSafeInteger(event.id)) lastEventId = Math.max(lastEventId, event.id);
        if (lastEventId <= previousId) break;
        onProgress?.({
          run: Object.fromEntries(['id', 'status', 'current_stage', 'progress_percent', 'started_at', 'completed_at']
            .filter((key) => Object.hasOwn(status, key)).map((key) => [key, status[key]])),
          events: [], flowEvents: sanitizeFlowProgressEvents(pageEvents),
        });
      }
      const result = await request(`/evaluations/${encodeURIComponent(runId)}/result`, {
        signal,
      });
      const reportId = result.reports?.[0]?.id;
      if (!reportId)
        error(
          request.ApiError,
          '에이전트 최종 보고서가 아직 준비되지 않았습니다. 평가 상태를 확인한 뒤 다시 시도해 주세요.',
          502,
          'final_report_missing',
        );
      const report = await request(`/reports/${encodeURIComponent(reportId)}`, { signal });
      if (typeof report.report_text !== 'string' || !report.report_text.trim())
        error(
          request.ApiError,
          '백엔드에서 최종 보고서 본문을 받지 못했습니다. 잠시 후 다시 시도해 주세요.',
          502,
          'final_report_empty',
        );
      const mapped = mapBackendReport(result, report.report_text, status);
      owner.assertCurrentOwner();
      storageSet(key, {
        ...storageGet(key, state),
        pending_evaluation: null,
        pending_guest_analysis: false,
        report: mapped,
        suppress_latest_report: false,
        report_created_at: backendReportDate(status, result, report),
        questions: [],
      });
      return { report: mapped };
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, 2000);
      function abort() {
        clearTimeout(timer);
        reject(new DOMException('요청이 취소되었습니다.', 'AbortError'));
      }
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  error(
    request.ApiError,
    '평가가 제한 시간 안에 끝나지 않았습니다. 잠시 후 상태를 확인해 주세요.',
    504,
  );
}

function toMarkdownForm(text, title = 'My resume') {
  const form = new FormData();
  form.set('title', String(title).slice(0, 200));
  form.set('file', new Blob([text], { type: 'text/markdown' }), 'resume.md');
  return form;
}

async function convertResume(body, request, signal, ApiError) {
  const file = body?.get('file');
  if (!file?.name) error(ApiError, '이력서 파일을 선택해 주세요.', 400);
  if (file.size > 10 * 1024 * 1024) error(ApiError, '파일은 10MB 이하로 선택해 주세요.', 413);
  const converted = await request('/local-data/convert-resume', {
    method: 'POST',
    body,
    signal,
    auth: false,
  });
  if (typeof converted.text !== 'string' || !converted.text.trim())
    error(ApiError, '이력서에서 읽을 수 있는 본문을 찾지 못했습니다.', 422, 'resume_text_empty');
  return { filename: file.name, text: converted.text };
}

function customPostings() {
  return storageGet(CUSTOM_POSTINGS_KEY, []);
}

function sessionMockWorkspace() {
  const state = guestState();
  const realComplete = !demoSession() && state.completed === true && Boolean(state.local_run?.id) &&
    ['completed', 'partial'].includes(state.local_run.status);
  const running = !demoSession() && Boolean(state.local_run?.idempotency_key) &&
    ['queued', 'running'].includes(state.local_run.status);
  const result =
    demoSession() && state.report
      ? { completed: state.completed === true, report_locked: true }
      : { completed: realComplete, report_locked: realComplete };
  return {
    draft: {
      guest: true,
      resume_attached: Boolean(state.resume_text),
      filename: state.filename || '',
      company: state.selected_posting?.company || '',
      role: state.selected_posting?.role || '',
      analysis_mode: 'job_posting',
      career_target: state.career_target || null,
      selected_posting_id: state.selected_posting?.id || null,
      ...(running ? { selected_posting: Object.fromEntries(
        ['id', 'company', 'role', 'description', 'source_type', 'source_name', 'source_external_id']
          .map((field) => [field, state.selected_posting?.[field] || ''])) } : {}),
      guest_run_id: state.local_run?.id ? `${LOCAL_GUEST_PREFIX}${state.local_run.id}` : null,
      analysis_running: running,
      analysis_status: state.local_run?.status || null,
      ...(realComplete ? { storage_origin: 'frontend_guest' } : {}),
      report_locked: result.report_locked,
      preview_ready: false,
      analysis_pending: false,
      demo_report: demoSession() && Boolean(state.report?.demo),
      expires_at: state.expires_at || null,
    },
    questions: [],
    ...(state.expires_at ? { expires_at: state.expires_at } : {}),
    completed: result.completed,
    report_locked: result.report_locked || false,
    preview_ready: false,
    analysis_pending: false,
  };
}

export function enableBackendAdapter() {
  enabled = true;
}

export async function acceptBackendAuthCallback({ accessToken, refreshToken }, request, ApiError) {
  if (
    typeof accessToken !== 'string' ||
    !accessToken ||
    typeof refreshToken !== 'string' ||
    !refreshToken
  )
    error(
      ApiError,
      '이메일 인증 정보가 완전하지 않습니다. 다시 로그인해 주세요.',
      400,
      'auth_callback_invalid',
    );
  // Validate the new identity before replacing a working session or its guest binding.
  const validationRequest = ownerBoundRequest(request).request;
  const profile = await validationRequest('/me', { auth: false, accessToken });
  const user = profileUser(profile, ApiError);
  storeBackendCredentials({ access_token: accessToken, refresh_token: refreshToken });
  storageRemove(DEMO_SESSION_KEY);
  enabled = true;
  return makeSession({
    id: user.id,
    email: user.email || '',
    name: user.name,
    is_admin: user.is_admin,
  });
}

export function enableDemoSession() {
  enabled = true;
  clearMemberStorage();
  storageSet(DEMO_SESSION_KEY, true);
}

export function isDemoSessionEnabled() {
  return demoSession();
}

export function isBackendAdapterEnabled() {
  return enabled;
}

export async function backendApi(path, options, request, ApiError) {
  if (demoSession()) enabled = true;
  if (!enabled) throw new Error('Backend adapter is not enabled.');
  request.ApiError = ApiError;
  const method = options.method || 'GET';
  const body = options.body;
  const signal = options.signal;
  const cleanPath = decodePath(path);
  // A mutation can span conversion, profile, storage and workspace requests.
  // Bind that complete operation before its first await, not each HTTP call
  // separately, so an account change cannot redirect a later write.
  if (!['GET', 'HEAD'].includes(method) && !/^\/(?:auth|guest|flow)(?:\/|$)/.test(cleanPath))
    request = ownerBoundRequest(request).request;
  if (/^\/flow(?:\/|$)/.test(cleanPath))
    return request(path, { method, body, signal, keepalive: options.keepalive });
  if (/^\/admin\/evaluation-performance(?:\/[0-9a-f-]{36})?$/i.test(cleanPath) && method === 'GET') {
    requireReportSession(ApiError);
    return request(path, { signal });
  }
  if (/^\/member\/evaluation-performance(?:\/[0-9a-f-]{36})?$/i.test(cleanPath) && method === 'GET') {
    requireReportSession(ApiError);
    request = ownerBoundRequest(request, signal).request;
    return request(path, { signal });
  }
  if (/^\/evaluations(?:\/[0-9a-f-]{36})?$/i.test(cleanPath) && method === 'GET') {
    requireReportSession(ApiError);
    request = ownerBoundRequest(request, signal).request;
    return request(path, { signal });
  }
  if (/^\/evaluations\/[0-9a-f-]{36}\/execution-report$/i.test(cleanPath) && method === 'GET') {
    requireReportSession(ApiError);
    request = ownerBoundRequest(request, signal).request;
    return request(path, { signal });
  }
  if (cleanPath === '/account/reports' && method === 'GET')
    return savedReportList(path, request, signal, ApiError);
  const reportContext = /^\/account\/reports\/([^/]+)\/context$/.exec(cleanPath);
  if (reportContext && method === 'GET')
    return savedReportContext(reportContext[1], request, signal, ApiError);
  const savedReport = /^\/account\/reports\/([^/]+)$/.exec(cleanPath);
  if (savedReport && method === 'GET')
    return savedReportWorkspace(savedReport[1], request, signal, ApiError);
  if (savedReport && method === 'DELETE') {
    const id = savedReportId(savedReport[1], ApiError);
    const localId = localRunId(id);
    if (!localId) error(ApiError, '현재 서버에서 보고서 삭제를 지원하지 않습니다.', 501);
    const session = captureBackendSession();
    const user = await backendUser(request, signal);
    assertBackendSession(session, signal);
    await request(`/local-guest/reports/${encodeURIComponent(localId)}`, { method: 'DELETE', signal });
    assertBackendSession(session, signal);
    const key = `${STATE_KEY}:${user.id}`;
    const state = storageGet(key, {});
    if (state.report?.run_id === id) storageSet(key, { ...state, report: null, suppress_latest_report: true });
    return { deleted: true };
  }
  const needsCatalog =
    cleanPath === '/career-roles' ||
    ((cleanPath === '/career-target' || cleanPath === '/guest/career-target') &&
      method === 'PUT') ||
    cleanPath.startsWith('/job-postings') ||
    cleanPath.startsWith('/guest/job-postings');
  const catalog = needsCatalog
    ? await careerCatalog(request, signal)
    : null;

  if (cleanPath === '/career-roles') return { items: catalog.roles };
  if (demoSession()) return demoApi(path, options, ApiError, catalog);

  if (cleanPath === '/auth/session') {
    const session = captureBackendSession();
    if (!session.token) {
      const realGuest = await probeLocalGuest(request, signal);
      assertBackendSession(session, signal);
      return makeSession(null, realGuest);
    }
    const capabilities = probeLocalGuest(request, signal);
    try {
      const [realGuest, user] = await Promise.all([capabilities, backendUser(request, signal)]);
      assertBackendSession(session, signal);
      return makeSession({
        id: user.id,
        email: user.email || '',
        name: user.name || '',
        is_admin: user.is_admin,
      }, realGuest);
    } catch (failure) {
      assertBackendSession(session, signal);
      if (failure.status === 401) {
        const realGuest = await capabilities;
        assertBackendSession(session, signal);
        storageRemove(ACCESS_KEY);
        storageRemove(REFRESH_KEY);
        return makeSession(null, realGuest);
      }
      throw failure;
    }
  }

  const cancelEvaluation = /^\/evaluations\/([^/]+)\/cancel$/.exec(cleanPath);
  if (cancelEvaluation && method === 'POST' && localRunId(decodeURIComponent(cancelEvaluation[1])))
    return request(`/local-guest/analyses/${encodeURIComponent(localRunId(decodeURIComponent(cancelEvaluation[1])))}/cancel`,
      { method, body: {}, signal, auth: false, keepalive: options.keepalive });
  if (cancelEvaluation && method === 'POST')
    return request(`/evaluations/${encodeURIComponent(cancelEvaluation[1])}/cancel`, {
      method,
      body,
      signal,
      keepalive: options.keepalive,
    });

  if (cleanPath === '/auth/login' && method === 'POST') {
    const loginRequest = ownerBoundRequest(request, signal).request;
    const result = await loginRequest('/auth/login', {
      method,
      body,
      signal,
      auth: false,
    });
    if (!result.access_token)
      error(ApiError, '백엔드가 access token을 반환하지 않았습니다.', 502, 'missing_access_token');
    storeBackendCredentials(result);
    storageRemove(STATE_KEY);
    return { ...result, user: null, csrf_token: '' };
  }

  if (cleanPath === '/auth/register' && method === 'POST') {
    const signupRequest = ownerBoundRequest(request, signal).request;
    const result = await signupRequest('/auth/signup', {
      method: 'POST',
      body: { email: body.email, password: body.password },
      signal,
      auth: false,
    });
    if (result.access_token) {
      storeBackendCredentials(result);
    }
    return {
      ...result,
      user: result.access_token ? { id: result.user_id, email: body.email } : null,
      csrf_token: '',
    };
  }

  if (cleanPath === '/auth/logout' && method === 'POST') {
    clearMemberStorage();
    return makeSession();
  }

  if (cleanPath === '/auth/refresh' && method === 'POST') {
    const session = captureBackendSession();
    const result = await request('/auth/refresh', {
      method,
      body,
      signal,
      auth: false,
    });
    if (!result.access_token)
      error(ApiError, '로그인 세션을 갱신하지 못했습니다. 다시 로그인해 주세요.', 401);
    storeBackendCredentials(result, session);
    return result;
  }

  if (cleanPath === '/auth/forgot-password' || cleanPath === '/auth/reset-password')
    error(
      ApiError,
      '현재 연결된 백엔드는 비밀번호 재설정 기능을 제공하지 않습니다.',
      501,
      'password_reset_unavailable',
    );

  if (cleanPath === '/guest/workspace' && method === 'DELETE') {
    const pending = guestState().local_run;
    const id = pending?.id;
    storageRemove(GUEST_KEY);
    if (id) await request(`/local-guest/analyses/${encodeURIComponent(id)}`, { method: 'DELETE', signal, auth: false });
    else if (pending?.idempotency_key) await request('/local-guest/analyses/cancel-pending',
      { method: 'POST', body: { idempotency_key: pending.idempotency_key }, auth: false, keepalive: true });
    return sessionMockWorkspace();
  }
  if (cleanPath === '/guest/workspace') {
    const guest = guestState();
    if (guest.local_run?.id) {
      let update;
      try {
        update = await request(`/local-guest/analyses/${encodeURIComponent(guest.local_run.id)}`, { signal, auth: false });
      } catch (failure) {
        signal?.throwIfAborted();
        if (![404, 410].includes(failure.status)) throw failure;
        if (guestState().local_run?.idempotency_key === guest.local_run.idempotency_key) storageRemove(GUEST_KEY);
        error(ApiError, '임시 분석이 만료되었습니다. 이력서를 다시 첨부해 주세요.', 409, 'guest_expired');
      }
      signal?.throwIfAborted();
      storeGuestRun(update, guest.local_run.idempotency_key, ApiError);
      guestProgress(guestState(), options.onProgress, update);
    }
    return sessionMockWorkspace();
  }

  if (cleanPath === '/workspace' && method === 'GET') {
    const { workspace } = await getMemberWorkspace(request, signal);
    return workspace;
  }

  if (cleanPath === '/workspace' && method === 'DELETE') {
    const { state, key } = await getMemberWorkspace(request, signal);
    if (state.resume_id) {
      await request(`/resumes/${encodeURIComponent(state.resume_id)}`, {
        method: 'DELETE',
        signal,
      });
    }
    storageRemove(key);
    return { draft: {}, questions: [] };
  }

  if (cleanPath === '/resume' && method === 'PUT') {
    if (typeof body?.resume_text !== 'string' || !body.resume_text.trim())
      error(ApiError, '이력서 본문을 입력해 주세요.', 400, 'resume_invalid');
    const user = await backendUser(request, signal);
    const key = `${STATE_KEY}:${user.id}`;
    const old = storageGet(key, {});
    const result = await request('/resumes', {
      method: 'POST',
      body: toMarkdownForm(body.resume_text, old.resume_title || '내 이력서'),
      signal,
    });
    storageSet(key, {
      ...storageGet(key, {}),
      resume_id: result.id,
      resume_title: result.title,
      career_target: storageGet(key, {}).career_target || null,
      report: null,
      pending_guest_analysis: false,
      suppress_latest_report: true,
    });
    const { workspace } = await getMemberWorkspace(request, signal);
    return workspace;
  }

  if (cleanPath === '/resume/upload' && method === 'POST') {
    const converted = await convertResume(body, request, signal, ApiError);
    const result = await request('/resumes', {
      method: 'POST',
      body: toMarkdownForm(converted.text, converted.filename.replace(/\.(md|txt|pdf|docx)$/i, '')),
      signal,
    });
    const user = await backendUser(request, signal);
    const key = `${STATE_KEY}:${user.id}`;
    storageSet(key, {
      ...storageGet(key, {}),
      resume_id: result.id,
      resume_title: result.title,
      report: null,
      pending_guest_analysis: false,
      suppress_latest_report: true,
    });
    const { workspace } = await getMemberWorkspace(request, signal);
    return workspace;
  }

  if (
    (cleanPath === '/career-target' || cleanPath === '/guest/career-target') &&
    method === 'PUT'
  ) {
    const careerTarget = {
      role_id: body.role_id || 'custom',
      label: body.role || catalog.roles.find((role) => role.id === body.role_id)?.label || '',
      focus: body.focus || '',
    };
    if (cleanPath.startsWith('/guest/')) {
      saveGuest({ career_target: careerTarget });
      return sessionMockWorkspace();
    }
    const user = await backendUser(request, signal);
    const key = `${STATE_KEY}:${user.id}`;
    const state = storageGet(key, {});
    const preparation = unavailablePreparation();
    storageSet(key, {
      ...state,
      career_target: careerTarget,
      preparation,
      report: null,
      pending_guest_analysis: false,
      suppress_latest_report: true,
    });
    const { workspace } = await getMemberWorkspace(request, signal);
    return workspace;
  }

  if (cleanPath === '/preparation' && method === 'POST') {
    error(
      ApiError,
      '현재 평가 서버는 사전 준비 분석을 제공하지 않습니다. 채용공고를 선택한 뒤 실제 분석을 시작해 주세요.',
      501,
      'preparation_unavailable',
    );
  }

  if (cleanPath.startsWith('/job-postings')) {
    const detail = /^\/job-postings\/([^/]+)$/.exec(cleanPath);
    const select = /^\/(guest\/)?job-postings\/([^/]+)\/select$/.exec(cleanPath);
    const bookmark = /^\/job-postings\/([^/]+)\/bookmark$/.exec(cleanPath);
    const customEdit = /^\/job-postings\/([^/]+)$/.exec(cleanPath);

    if (select && method === 'POST') {
      const isGuest = Boolean(select[1]);
      const id = decodeURIComponent(select[2]);
      let posting = mockPosting(id, catalog.postings);
      if (!posting && !id.startsWith('mock-')) {
        posting = await backendPosting(id, request, signal, catalog.postings);
      }
      if (!posting) error(ApiError, '채용공고를 찾을 수 없습니다.', 404);
      if (isGuest) {
        saveGuest({ selected_posting: posting });
        return sessionMockWorkspace();
      }
      const user = await backendUser(request, signal);
      const key = `${STATE_KEY}:${user.id}`;
      const state = storageGet(key, {});
      storageSet(key, {
        ...state,
        selected_posting: posting,
        selected_posting_id: posting.source_type === 'backend' ? posting.id : '',
        report: null,
        pending_guest_analysis: false,
        suppress_latest_report: true,
        questions: [],
      });
      const { workspace } = await getMemberWorkspace(request, signal);
      return workspace;
    }

    if (bookmark && ['POST', 'DELETE'].includes(method)) {
      const id = decodeURIComponent(bookmark[1]);
      const bookmarks = new Set(storageGet(BOOKMARKS_KEY, []));
      if (method === 'POST') bookmarks.add(id);
      else bookmarks.delete(id);
      storageSet(BOOKMARKS_KEY, [...bookmarks]);
      const posting =
        mockPosting(id, catalog.postings) ||
        (await backendPosting(id, request, signal, catalog.postings));
      return { posting: { ...posting, is_saved: bookmarks.has(id) } };
    }

    if (detail && method === 'GET') {
      const id = decodeURIComponent(detail[1]);
      const posting = mockPosting(id, catalog.postings);
      return { posting: posting || (await backendPosting(id, request, signal, catalog.postings)) };
    }

    if (customEdit && method === 'DELETE') {
      const id = decodeURIComponent(customEdit[1]);
      storageSet(
        CUSTOM_POSTINGS_KEY,
        customPostings().filter((posting) => posting.id !== id),
      );
      return null;
    }

    if ((customEdit || cleanPath === '/job-postings') && ['PUT', 'POST'].includes(method)) {
      const posting = {
        ...body,
        id: customEdit?.[1] || `mock-custom-${crypto.randomUUID()}`,
        source_type: 'mock',
        company: body.company || '직접 입력',
        role: body.role || body.title || '',
        description: body.description || '',
        skills: body.skills || [],
        is_saved: false,
      };
      const current = customPostings().filter((item) => item.id !== posting.id);
      storageSet(CUSTOM_POSTINGS_KEY, [...current, posting]);
      return { posting };
    }

    if (cleanPath === '/job-postings' && method === 'GET') {
      const authenticated = Boolean(sessionStorage.getItem(ACCESS_KEY));
      const available = authenticated
        ? await backendJobs(request, catalog.postings, signal)
        : [...catalog.postings];
      const params = new URLSearchParams(path.split('?')[1] || '');
      const roleScope = applyPostingRoleScope(params, catalog.roles);
      const filtered = filteredPostings(available, params);
      const page = Math.max(1, Number(params.get('page')) || 1);
      const pageSize = Math.max(1, Number(params.get('page_size')) || 12);
      const items = filtered.slice((page - 1) * pageSize, page * pageSize);
      return {
        items,
        total: filtered.length,
        available_total: available.length,
        ...roleScope,
        page,
        page_size: pageSize,
        filters: {
          roles: [
            ...new Set(available.map((item) => item.role_category || item.role).filter(Boolean)),
          ].sort((a, b) => a.localeCompare(b, 'ko')),
          locations: [...new Set(available.map((item) => item.location))],
          employment_types: [...new Set(available.map((item) => item.employment_type))],
          experience_levels: [...new Set(available.map((item) => item.experience_level))],
          skills: [...new Set(available.flatMap((item) => item.skills))],
        },
        mock_notice: authenticated
          ? ''
          : localGuestCapabilities.get(request) === true
            ? '가상 공고로 실제 분석을 진행합니다. 분석한 결과는 로그인 후 확인할 수 있습니다.'
            : '공고 미리보기입니다. 실제 평가는 로그인 후 백엔드 등록 공고로 진행합니다.',
      };
    }
  }

  if (cleanPath === '/job-matches') return { items: [], total: 0 };

  if (cleanPath === '/resume-examples') {
    const items = Array.from({ length: 12 }, (_, index) => ({
      ...resumeExample,
      id: `mock-resume-${index + 1}`,
      title: index ? `${resumeExample.title} ${index + 1}` : resumeExample.title,
    }));
    return { items, total: items.length, page: 1, page_size: items.length };
  }

  const example = /^\/resume-examples\/([^/]+)$/.exec(cleanPath);
  if (example && method === 'GET')
    return { example: { ...resumeExample, id: decodeURIComponent(example[1]) } };
  if (cleanPath === '/example' && method === 'POST') {
    const result = await backendApi(
      '/resume',
      {
        method: 'PUT',
        body: { resume_text: resumeExample.resume_text },
        signal,
      },
      request,
      ApiError,
    );
    return result;
  }

  if (cleanPath === '/guest/resume/upload' && method === 'POST') {
    const converted = await convertResume(body, request, signal, ApiError);
    saveGuest({
      filename: converted.filename,
      resume_text: converted.text,
      report: null,
      completed: false,
    });
    return sessionMockWorkspace();
  }

  if (cleanPath.startsWith('/guest/job-postings/')) {
    const select = /^\/guest\/job-postings\/([^/]+)\/select$/.exec(cleanPath);
    if (select && method === 'POST') {
      const posting = mockPosting(decodeURIComponent(select[1]), catalog.postings);
      if (!posting) error(ApiError, '가상 공고를 찾을 수 없습니다.', 404);
      saveGuest({ selected_posting: posting });
      return sessionMockWorkspace();
    }
  }

  if (cleanPath === '/guest/analysis' && method === 'POST') {
    signal?.throwIfAborted();
    const guest = guestState();
    if (!guest.resume_text || !(Date.parse(guest.expires_at) > Date.now()))
      error(ApiError, '임시 이력서가 만료되었거나 첨부되지 않았습니다. 다시 첨부해 주세요.', 409, 'guest_expired');
    if (!guest.selected_posting?.id)
      error(ApiError, '채용공고를 먼저 선택해 주세요.', 400, 'posting_required');
    if (localGuestCapabilities.get(request) === true || guest.local_run?.idempotency_key)
      return runGuestAnalysis(request, signal, options.onProgress);
    saveGuest({ preview_ready: false, analysis_pending: false, report_locked: false, completed: false, report: null });
    error(ApiError, '비회원 분석 서버에 연결되지 않았습니다. 잠시 후 다시 시도해 주세요.', 503, 'guest_analysis_unavailable');
  }

  if (cleanPath === '/guest/analysis/cancel' && method === 'POST') {
    const pending = guestState().local_run;
    const id = pending?.id;
    if (guestState().resume_text)
      saveGuest({ preview_ready: false, analysis_pending: false, report_locked: false, completed: false, report: null, local_run: null });
    if (id) await request(`/local-guest/analyses/${encodeURIComponent(id)}/cancel`,
      { method: 'POST', body: {}, signal, auth: false, keepalive: options.keepalive });
    else if (pending?.idempotency_key) await request('/local-guest/analyses/cancel-pending',
      { method: 'POST', body: { idempotency_key: pending.idempotency_key }, auth: false, keepalive: true });
    return sessionMockWorkspace();
  }

  if (cleanPath === '/guest/claim' && method === 'POST') {
    const guest = guestState();
    if (!guest.resume_text)
      error(
        ApiError,
        '임시 이력서가 만료되었거나 첨부되지 않았습니다. 다시 첨부해 주세요.',
        409,
        'guest_expired',
      );
    const session = captureBackendSession();
    const guestSnapshot = JSON.stringify(guest);
    let transferring = true;
    const assertCurrentClaim = () => {
      assertBackendSession(session, signal);
      if (transferring && JSON.stringify(guestState()) !== guestSnapshot)
        throw new DOMException('계정 또는 임시 이력서가 변경되어 연결을 취소했습니다.', 'AbortError');
    };
    // Check both sides of every transport, including helpers and transports that
    // ignore AbortSignal. Never upload with a replacement account's credentials.
    const claimRequest = async (...args) => {
      assertCurrentClaim();
      const value = await request(...args);
      assertCurrentClaim();
      return value;
    };
    claimRequest.ApiError = request.ApiError;
    if (guest.local_run?.id) {
      const result = await claimRequest(`/local-guest/analyses/${encodeURIComponent(guest.local_run.id)}/claim`,
        { method: 'POST', body: {}, signal, accessToken: session.token });
      // The frontend server has already authenticated this token against /me
      // and atomically assigned the report. Reuse its verified owner instead
      // of inserting another identity request before displaying the result.
      if (typeof result.owner_user_id !== 'string' ||
          !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(result.owner_user_id))
        error(ApiError, '보고서를 연결한 계정을 확인하지 못했습니다. 다시 시도해 주세요.', 502, 'report_owner_invalid');
      const key = `${STATE_KEY}:${result.owner_user_id}`;
      const workspace = localReportWorkspace(result, ApiError);
      const snapshot = result.job_snapshot;
      const selected = snapshot ? mapJob(snapshot, snapshot.company_name || '') : guest.selected_posting;
      // This report is already calculated. Claiming only associates it with the
      // verified account; it never uploads a resume or queues another evaluation.
      storageSet(key, {
        career_target: guest.career_target || null,
        selected_posting: selected ? { ...selected, source_type: 'frontend_guest' } : null,
        selected_posting_id: selected?.id || result.job_id || '',
        claimed_resume_text: typeof result.resume_text === 'string' ? result.resume_text : guest.resume_text,
        report: workspace.draft.report, report_created_at: workspace.draft.created_at,
        pending_guest_analysis: false, suppress_latest_report: true, questions: [],
      });
      storageRemove(GUEST_KEY);
      transferring = false;
      return { ...workspace, draft: { ...workspace.draft,
        resume_text: typeof result.resume_text === 'string' ? result.resume_text : guest.resume_text,
        career_target: guest.career_target || null,
        selected_posting: selected ? { ...selected, source_type: 'frontend_guest' } : null,
        pending_guest_analysis: false,
      } };
    }
    const user = await backendUser(claimRequest, signal);
    const key = `${STATE_KEY}:${user.id}`;
    let selected = null;
    if (guest.selected_posting) {
      const records = await backendJobRecords(claimRequest, signal);
      const matching = records.find(
        (posting) =>
          (guest.selected_posting.source_type === 'backend' &&
            posting.id === guest.selected_posting.id) ||
          (guest.selected_posting.source_external_id &&
            posting.source_name === guest.selected_posting.source_name &&
            posting.source_external_id === guest.selected_posting.source_external_id),
      );
      if (matching)
        selected = await backendPosting(matching.id, claimRequest, signal, [guest.selected_posting]);
    }
    const result = await claimRequest('/resumes', {
      method: 'POST',
      body: toMarkdownForm(guest.resume_text, guest.filename || 'Guest resume'),
      signal,
    });
    assertCurrentClaim();
    storageSet(key, {
      resume_id: result.id,
      resume_title: result.title,
      career_target: guest.career_target || null,
      selected_posting: selected,
      selected_posting_id: selected?.id || '',
      report: null,
      pending_guest_analysis: false,
      suppress_latest_report: true,
      questions: [],
    });
    storageRemove(GUEST_KEY);
    transferring = false;
    const refreshed = await getMemberWorkspace(claimRequest, signal);
    return refreshed.workspace;
  }

  if (cleanPath === '/analysis' && method === 'POST') {
    const user = await backendUser(request, signal);
    const key = `${STATE_KEY}:${user.id}`;
    const state = storageGet(key, {});
    if (state.selected_posting?.source_type !== 'backend')
      error(
        ApiError,
        '이 공고는 평가 서버에 등록되어 있지 않습니다. 백엔드 등록 공고를 선택해 주세요.',
        409,
        'backend_posting_required',
      );
    // Consume once before creation or further loading. An uncertain response,
    // cancellation or reload must not automatically create a second evaluation.
    if (state.pending_guest_analysis === true)
      storageSet(key, { ...state, pending_guest_analysis: false, report: null, suppress_latest_report: true });
    return runBackendAnalysis(request, signal, options.onProgress);
  }

  error(ApiError, '현재 백엔드에 없는 기능입니다. 이 화면은 실제 데이터에 반영되지 않습니다.', 501);
}

async function backendPosting(id, request, signal, catalogPostings = []) {
  const raw = await request(`/jobs/${encodeURIComponent(id)}`, { signal });
  if (!raw || raw.id !== id)
    error(request.ApiError, '채용공고 상세 형식이 올바르지 않습니다.', 502, 'job_invalid');
  let company = null;
  if (raw.company_id) {
    try {
      company = await request(`/companies/${encodeURIComponent(raw.company_id)}`, { signal });
    } catch (failure) {
      if (failure.status !== 404) throw failure;
      company = null;
    }
  }
  return mapJob(raw, company?.name || '', catalogPostings);
}
