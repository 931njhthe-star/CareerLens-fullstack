import { parseCareerCatalog } from '../../features/job-postings/career-catalog.js';

const ACCESS_KEY = 'careerlens.backend.access-token';
const REFRESH_KEY = 'careerlens.backend.refresh-token';
const STATE_KEY = 'careerlens.backend.workspace';
const GUEST_KEY = 'careerlens.backend.guest';
const CUSTOM_POSTINGS_KEY = 'careerlens.backend.mock-postings';
const BOOKMARKS_KEY = 'careerlens.backend.bookmarks';
const DEMO_SESSION_KEY = 'careerlens.backend.demo-session';
const DEMO_WORKSPACE_KEY = 'careerlens.backend.demo-workspace';

let enabled = false;

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
}

function storageRemove(key) {
  sessionStorage.removeItem(key);
}

function getState() {
  return storageGet(STATE_KEY, {});
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
  if (state.expires_at && Date.parse(state.expires_at) <= Date.now()) {
    storageRemove(GUEST_KEY);
    return {};
  }
  return state;
}

function saveGuest(next) {
  storageSet(GUEST_KEY, {
    ...guestState(),
    ...next,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
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
    gaps: ['실제 평가 결과가 아닙니다. 실제 분석은 실제 계정과 백엔드 등록 이력서·공고가 필요합니다.'],
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
    if (params.get('role_id') && params.get('role_id') !== 'custom') {
      const selectedRole = catalog.roles.find((role) => role.id === params.get('role_id'));
      if (selectedRole) params.set('role', selectedRole.label);
    }
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
    const items = filteredPostings(available, params);
    const page = Math.max(1, Number(params.get('page')) || 1);
    const pageSize = Math.max(1, Number(params.get('page_size')) || 12);
    const bookmarks = new Set(storageGet(BOOKMARKS_KEY, []));
    const postings = items.map((posting) => ({ ...posting, is_saved: bookmarks.has(posting.id) }));
    const selected = postings.slice((page - 1) * pageSize, page * pageSize);
    return {
      items: selected,
      total: postings.length,
      page,
      page_size: pageSize,
      filters: {
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
    return { items: Array.from({ length: 12 }, (_, index) => ({
      ...resumeExample,
      id: `mock-resume-${index + 1}`,
      title: index ? `${resumeExample.title} ${index + 1}` : resumeExample.title,
    })), total: 12, page: 1, page_size: 12 };
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

function mapJob(posting, companyName = '') {
  const sourceMarkdown =
    posting.source_name === 'local_markdown' && typeof posting.description === 'string'
      ? posting.description
      : '';
  const requirements = Array.isArray(posting.requirements)
    ? posting.requirements.map((item) => (typeof item === 'string' ? item : item.name || item.text || ''))
    : [];
  const preferred = Array.isArray(posting.preferred_requirements)
    ? posting.preferred_requirements.map((item) =>
        typeof item === 'string' ? item : item.name || item.text || '',
      )
    : [];
  const skills = [...new Set([...requirements, ...preferred].filter(Boolean))].slice(0, 12);
  const minimum = posting.career_min_months;
  const maximum = posting.career_max_months;
  return {
    id: posting.id,
    company: companyName || posting.company_name || posting.company || '기업 정보 없음',
    role: posting.title,
    location: posting.location || '근무지 협의',
    employment_type: posting.employment_type || '정보 없음',
    experience_level:
      minimum == null && maximum == null
        ? '경력 요건 미정'
        : maximum == null
          ? `경력 ${Math.floor((minimum || 0) / 12)}년 이상`
          : `경력 ${Math.floor((minimum || 0) / 12)}~${Math.floor(maximum / 12)}년`,
    skills,
    description: sourceMarkdown || [
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
    source_url: posting.source_url || '',
    is_saved: false,
  };
}

function mockPosting(id, catalogPostings = []) {
  const custom = storageGet(CUSTOM_POSTINGS_KEY, []);
  return [...catalogPostings, ...mockPostings, ...custom].find((posting) => posting.id === id) || null;
}

function filteredPostings(items, params) {
  const q = (params.get('q') || '').toLocaleLowerCase();
  const role = (params.get('role') || '').toLocaleLowerCase();
  const filters = ['location', 'employment_type', 'experience_level', 'skill'];
  let result = items.filter((posting) => {
    const text = `${posting.company} ${posting.role} ${posting.description} ${posting.skills.join(' ')}`
      .toLocaleLowerCase();
    return (
      (!q || text.includes(q)) &&
      (!role || `${posting.role} ${posting.description}`.toLocaleLowerCase().includes(role)) &&
      filters.every((key) => {
        const value = params.get(key);
        return !value || (key === 'skill' ? posting.skills.includes(value) : posting[key] === value);
      })
    );
  });
  const saved = new Set(storageGet(BOOKMARKS_KEY, []));
  result = result.map((posting) => ({ ...posting, is_saved: saved.has(posting.id) }));
  if (params.get('saved') === '1') result = result.filter((posting) => posting.is_saved);
  return result;
}

function mapBackendReport(result, reportText = '') {
  const categories = [
    ['resume_completeness', '이력서 완성도'],
    ['job_fit', '직무 적합도'],
    ['qualifications', '지원 자격 충족도'],
    ['practical_competitiveness', '실무 경쟁력'],
  ];
  const criteria = (result.criteria || []).map((item) => {
    const detail = item.evaluation_criteria || {};
    return {
      code: detail.criterion_code || '',
      label: detail.name_ko || detail.criterion_code || '평가 기준',
      score: item.score,
      max_score: 100,
      detail: item.reasoning_summary || '',
      status:
        item.verdict === 'met' ? 'confirmed' : item.verdict === 'unknown' ? 'partial' : 'missing',
    };
  });
  const matches = criteria.map((criterion, index) => {
    const original = result.criteria[index];
    const evidence = Array.isArray(original.evidence) ? original.evidence : [];
    return {
      requirement: criterion.label,
      status: criterion.status,
      evidence_items: evidence.map((item) => ({
        excerpt: item.quote || item.text || item.excerpt || '',
        source_label: item.source || item.source_label || '이력서 근거',
      })),
    };
  });
  const values = categories.map(([key]) => result[key]);
  const known = values.filter((value) => Number.isFinite(value));
  const score =
    result.overall_score === null
      ? null
      : Number.isFinite(result.overall_score)
        ? result.overall_score
        : known.length
          ? known.reduce((total, value) => total + value, 0) / known.length
          : null;
  const scoreComponents = Object.fromEntries(
    categories.map(([key, label]) => [key, { label, score: result[key] ?? null }]),
  );
  const unresolved = criteria.filter((item) => item.status !== 'confirmed');
  return {
    source: 'backend',
    score,
    score_components: scoreComponents,
    verdict: result.eligibility_status || result.validation_status || '평가 완료',
    summary:
      score === null
        ? `백엔드 평가가 완료되었습니다. 종합점수는 검증 상태(${result.validation_status || '미확정'})로 인해 산정되지 않았습니다.`
        : `백엔드 평가 결과 종합점수는 ${score.toFixed(1)}점입니다. 점수와 판정은 저장된 이력서 및 채용공고를 기준으로 산출되었습니다.`,
    criteria: criteria.filter((item) => Number.isFinite(item.score)),
    matches,
    strengths: criteria
      .filter((item) => item.status === 'confirmed')
      .map((item) => `${item.label}: 근거가 확인되었습니다.`),
    gaps: unresolved.map((item) => `${item.label}: ${item.detail || '추가 근거를 확인해 주세요.'}`),
    priorities: unresolved.slice(0, 5).map((item) => ({
      title: item.label,
      detail: item.detail || '이력서에 관련 경험과 구체적인 결과를 추가해 보세요.',
    })),
    questions: unresolved.slice(0, 5).map((item) => `${item.label}과 관련한 본인의 경험과 결과는 무엇인가요?`),
    reference_guidance: [],
    backend_report_text: reportText,
    status: result.validation_status,
  };
}

function makeSession(user = null) {
  return {
    user,
    csrf_token: '',
    providers: [],
    mail_mode: 'unavailable',
  };
}

function decodePath(path) {
  return path.split('?')[0];
}

async function backendJobs(request, catalogPostings = []) {
  const records = await request('/jobs?limit=100');
  const companies = new Map();
  const catalogCompanies = new Map(
    catalogPostings.map((posting) => [posting.source_external_id, posting.company]),
  );
  const ids = [
    ...new Set(
      records
        .filter((posting) => !catalogCompanies.has(posting.source_external_id))
        .map((posting) => posting.company_id)
        .filter(Boolean),
    ),
  ];
  await Promise.all(
    ids.map(async (id) => {
      try {
        const company = await request(`/companies/${encodeURIComponent(id)}`);
        companies.set(id, company.name || '');
      } catch (failure) {
        if (failure.status !== 404) throw failure;
        companies.set(id, '');
      }
    }),
  );
  return records.map((posting) =>
    mapJob(
      posting,
      catalogCompanies.get(posting.source_external_id) ||
        companies.get(posting.company_id) ||
        '',
    ),
  );
}

async function getMemberWorkspace(request, signal) {
  const user = await request('/me', { signal });
  const key = `${STATE_KEY}:${user.id}`;
  let state = storageGet(key, {});
  const resumes = await request('/resumes?limit=100', { signal });
  let resume = resumes.find((item) => item.id === state.resume_id) || resumes[0] || null;
  if (resume) {
    state = { ...state, resume_id: resume.id };
    storageSet(key, state);
    resume = await request(`/resumes/${encodeURIComponent(resume.id)}`, { signal });
  }
  const draft = {
    resume_text: resume?.original_text || '',
    resume_id: resume?.id || '',
    filename: resume?.title || '',
    career_target: state.career_target || null,
    analysis_mode: 'job_posting',
  };
  let selected = state.selected_posting;
  if (state.selected_posting_id && !selected) {
    try {
      const raw = await request(`/jobs/${encodeURIComponent(state.selected_posting_id)}`, { signal });
      const company = raw.company_id
        ? await request(`/companies/${encodeURIComponent(raw.company_id)}`, { signal })
        : null;
      selected = mapJob(raw, company?.name || '');
    } catch (failure) {
      if (failure.status !== 404) throw failure;
      selected = null;
    }
  }
  if (selected) {
    draft.company = selected.company;
    draft.role = selected.role;
    draft.job_text = selected.description;
    draft.selected_posting_id = selected.id;
  }
  if (!state.report && !state.suppress_latest_report) {
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
        state.report = mapBackendReport(result, report?.report_text || '');
        storageSet(key, state);
      }
    } catch (failure) {
      if (![404, 409].includes(failure.status)) throw failure;
    }
  }
  if (state.report) {
    draft.report = state.report;
    draft.created_at = state.report_created_at || '';
  }
  if (state.preparation) draft.preparation = state.preparation;
  return { user, workspace: { draft, questions: state.questions || [] }, state, key };
}

function makeDemoCriteria() {
  return {
    statement_count: 8,
    action_statement_count: 5,
    metric_statement_count: 2,
  };
}

async function mockAnalysis(request, signal, guest = false) {
  const user = guest ? null : await request('/me', { signal });
  const source = guest ? guestState() : storageGet(`${STATE_KEY}:${user.id}`, {});
  const selected = source.selected_posting || mockPosting(source.selected_posting_id) || mockPostings[0];
  if (signal?.aborted) throw new DOMException('요청이 취소되었습니다.', 'AbortError');
  const { report } = mockReport(selected, guest);
  if (guest) {
    saveGuest({ report, completed: true });
    return {
      completed: true,
      report_locked: true,
      expires_at: guestState().expires_at,
      draft: {
        guest: true,
        resume_attached: Boolean(source.filename || source.resume_text),
        filename: source.filename || '',
        mock_upload: source.mock_upload === true,
        company: selected.company,
        role: selected.role,
        selected_posting_id: selected.id,
        analysis_mode: 'job_posting',
        report_locked: true,
        demo_report: true,
      },
    };
  }
  const key = `${STATE_KEY}:${user.id}`;
  const state = storageGet(key, {});
  const savedReport = { ...report, demo: true };
  storageSet(key, {
    ...state,
    report: savedReport,
    report_created_at: new Date().toISOString(),
  });
  return { report: savedReport };
}

async function runBackendAnalysis(request, signal, onProgress) {
  const { workspace, state, key } = await getMemberWorkspace(request, signal);
  if (!workspace.draft.resume_id)
    error(
      request.ApiError,
      '백엔드에 저장된 이력서가 없습니다. 이력서를 먼저 저장해 주세요.',
      400,
      'resume_required',
    );
  if (!state.selected_posting_id || state.selected_posting?.source_type !== 'backend')
    return mockAnalysis(request, signal, false);

  const started = await request(
    '/evaluations',
    {
      method: 'POST',
      body: {
        resume_id: workspace.draft.resume_id,
        job_posting_id: state.selected_posting_id,
      },
    },
  );
  const runId = started.run_id;
  let lastEventId = 0;
  onProgress?.({
    run: { id: runId, status: started.status || 'queued', progress_percent: 0, current_stage: 'queued' },
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
    onProgress?.(update);
    if (['failed', 'cancelled'].includes(status.status))
      error(
        request.ApiError,
        status.failure_reason || `평가가 ${status.status} 상태로 종료되었습니다.`,
        502,
        'evaluation_failed',
      );
    if (['completed', 'partial'].includes(status.status)) {
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
      const mapped = mapBackendReport(result, report.report_text);
      storageSet(key, {
        ...state,
        report: mapped,
        suppress_latest_report: false,
        report_created_at: new Date().toISOString(),
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
  error(request.ApiError, '평가가 제한 시간 안에 끝나지 않았습니다. 잠시 후 상태를 확인해 주세요.', 504);
}

function toMarkdownForm(text, title = 'My resume') {
  const form = new FormData();
  form.set('title', title);
  form.set('file', new Blob([text], { type: 'text/markdown' }), 'resume.md');
  return form;
}

function customPostings() {
  return storageGet(CUSTOM_POSTINGS_KEY, []);
}

function sessionMockWorkspace() {
  const state = guestState();
  const result = state.report
    ? { completed: state.completed === true, report_locked: true }
    : {};
  return {
    draft: {
      guest: true,
      resume_attached: Boolean(state.filename || state.resume_text),
      filename: state.filename || '',
      company: state.selected_posting?.company || '',
      role: state.selected_posting?.role || '',
      analysis_mode: 'job_posting',
      career_target: state.career_target || null,
      selected_posting_id: state.selected_posting?.id || null,
      report_locked: result.completed,
      demo_report: Boolean(state.report?.demo),
      mock_upload: state.mock_upload === true,
      expires_at: state.expires_at || null,
    },
    questions: [],
    ...(state.expires_at ? { expires_at: state.expires_at } : {}),
    completed: result.completed,
    report_locked: result.report_locked || false,
  };
}

export function enableBackendAdapter() {
  enabled = true;
}

export function enableDemoSession() {
  enabled = true;
  storageRemove(ACCESS_KEY);
  storageRemove(REFRESH_KEY);
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
  const needsCatalog =
    cleanPath === '/career-roles' ||
    ((cleanPath === '/career-target' || cleanPath === '/guest/career-target') && method === 'PUT') ||
    cleanPath.startsWith('/job-postings') ||
    cleanPath.startsWith('/guest/job-postings');
  const catalog = needsCatalog
    ? parseCareerCatalog(
        (await request('/local-data/career-markdown', { signal, auth: false })).items,
      )
    : null;

  if (cleanPath === '/career-roles') return { items: catalog.roles };
  if (demoSession()) return demoApi(path, options, ApiError, catalog);

  if (cleanPath === '/auth/session') {
    const token = sessionStorage.getItem(ACCESS_KEY);
    if (!token) return makeSession();
    try {
      const user = await request('/me', { signal });
      return makeSession({ id: user.id, email: user.email || '' });
    } catch (failure) {
      if (failure.status === 401) {
        sessionStorage.removeItem(ACCESS_KEY);
        sessionStorage.removeItem(REFRESH_KEY);
        return makeSession();
      }
      throw failure;
    }
  }

  const cancelEvaluation = /^\/evaluations\/([^/]+)\/cancel$/.exec(cleanPath);
  if (cancelEvaluation && method === 'POST')
    return request(`/evaluations/${encodeURIComponent(cancelEvaluation[1])}/cancel`, {
      method,
      body,
      signal,
      keepalive: options.keepalive,
    });

  if (cleanPath === '/auth/login' && method === 'POST') {
    const result = await request('/auth/login', {
      method,
      body,
      signal,
      auth: false,
    });
    if (!result.access_token)
      error(ApiError, '백엔드가 access token을 반환하지 않았습니다.', 502, 'missing_access_token');
    sessionStorage.setItem(ACCESS_KEY, result.access_token);
    if (result.refresh_token) sessionStorage.setItem(REFRESH_KEY, result.refresh_token);
    storageRemove(STATE_KEY);
    return { ...result, user: null, csrf_token: '' };
  }

  if (cleanPath === '/auth/register' && method === 'POST') {
    const result = await request('/auth/signup', {
      method: 'POST',
      body: { email: body.email, password: body.password },
      signal,
      auth: false,
    });
    if (result.access_token) {
      sessionStorage.setItem(ACCESS_KEY, result.access_token);
      if (result.refresh_token) sessionStorage.setItem(REFRESH_KEY, result.refresh_token);
    }
    return {
      ...result,
      user: result.access_token ? { id: result.user_id, email: body.email } : null,
      csrf_token: '',
    };
  }

  if (cleanPath === '/auth/logout' && method === 'POST') {
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    storageRemove(STATE_KEY);
    return makeSession();
  }

  if (cleanPath === '/auth/refresh' && method === 'POST') {
    const result = await request('/auth/refresh', {
      method,
      body,
      signal,
      auth: false,
    });
    if (!result.access_token)
      error(ApiError, '로그인 세션을 갱신하지 못했습니다. 다시 로그인해 주세요.', 401);
    sessionStorage.setItem(ACCESS_KEY, result.access_token);
    if (result.refresh_token) sessionStorage.setItem(REFRESH_KEY, result.refresh_token);
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
    storageRemove(GUEST_KEY);
    return sessionMockWorkspace();
  }
  if (cleanPath === '/guest/workspace') return sessionMockWorkspace();

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
    const old = getState();
    const result = await request('/resumes', {
      method: 'POST',
      body: toMarkdownForm(body.resume_text, old.resume_title || '내 이력서'),
      signal,
    });
    const user = await request('/me', { signal });
    const key = `${STATE_KEY}:${user.id}`;
    storageSet(key, {
      ...storageGet(key, {}),
      resume_id: result.id,
      resume_title: result.title,
      career_target: storageGet(key, {}).career_target || null,
      report: null,
      suppress_latest_report: true,
    });
    const { workspace } = await getMemberWorkspace(request, signal);
    return workspace;
  }

  if (cleanPath === '/resume/upload' && method === 'POST') {
    const file = body.get('file');
    if (!file || !file.name) error(ApiError, '이력서 파일을 선택해 주세요.', 400);
    if (!/\.(md|txt)$/i.test(file.name))
      error(ApiError, '현재 백엔드 업로드는 Markdown 또는 텍스트 파일만 지원합니다.', 415);
    const result = await request('/resumes', {
      method: 'POST',
      body: toMarkdownForm(await file.text(), file.name.replace(/\.(md|txt)$/i, '')),
      signal,
    });
    const user = await request('/me', { signal });
    const key = `${STATE_KEY}:${user.id}`;
    storageSet(key, {
      ...storageGet(key, {}),
      resume_id: result.id,
      resume_title: result.title,
      report: null,
      suppress_latest_report: true,
    });
    const { workspace } = await getMemberWorkspace(request, signal);
    return workspace;
  }

  if ((cleanPath === '/career-target' || cleanPath === '/guest/career-target') && method === 'PUT') {
    const careerTarget = {
      role_id: body.role_id || 'custom',
      label: body.role || catalog.roles.find((role) => role.id === body.role_id)?.label || '',
      focus: body.focus || '',
    };
    if (cleanPath.startsWith('/guest/')) {
      saveGuest({ career_target: careerTarget });
      return sessionMockWorkspace();
    }
    const user = await request('/me', { signal });
    const key = `${STATE_KEY}:${user.id}`;
    const state = storageGet(key, {});
    const fingerprint = `${Date.now()}-${careerTarget.role_id}`;
    const preparation = {
      fingerprint,
      complete: false,
      stages: [],
      questions: [],
      role_reference: { criteria: [] },
      resume_evidence: makeDemoCriteria(),
    };
    storageSet(key, {
      ...state,
      career_target: careerTarget,
      preparation,
      report: null,
      suppress_latest_report: true,
    });
    const { workspace } = await getMemberWorkspace(request, signal);
    return workspace;
  }

  if (cleanPath === '/preparation' && method === 'POST') {
    const user = await request('/me', { signal });
    const key = `${STATE_KEY}:${user.id}`;
    const state = storageGet(key, {});
    const preparation = state.preparation || {};
    if (body.fingerprint !== preparation.fingerprint)
      error(ApiError, '희망 직무가 변경되었습니다. 다시 시작해 주세요.', 409, 'preparation_stale');
    const stages = new Map((preparation.stages || []).map((stage) => [stage.id, stage]));
    stages.set(body.stage, { id: body.stage, status: 'complete', detail: '화면 체험용 단계 완료' });
    const next = { ...preparation, stages: [...stages.values()] };
    next.complete = ['resume', 'role', 'report'].every((id) => stages.get(id)?.status === 'complete');
    const updated = { ...state, preparation: next };
    storageSet(key, updated);
    const { workspace } = await getMemberWorkspace(request, signal);
    return { ...workspace, preparation: next, draft: { ...workspace.draft, preparation: next } };
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
        const raw = await request(`/jobs/${encodeURIComponent(id)}`, { signal });
        const company = raw.company_id
          ? await request(`/companies/${encodeURIComponent(raw.company_id)}`, { signal })
          : null;
        posting = mapJob(raw, company?.name || '');
      }
      if (!posting) error(ApiError, '채용공고를 찾을 수 없습니다.', 404);
      if (isGuest) {
        saveGuest({ selected_posting: posting });
        return sessionMockWorkspace();
      }
      const user = await request('/me', { signal });
      const key = `${STATE_KEY}:${user.id}`;
      const state = storageGet(key, {});
      storageSet(key, {
        ...state,
        selected_posting: posting,
        selected_posting_id: posting.source_type === 'backend' ? posting.id : '',
        report: null,
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
      const posting = mockPosting(id, catalog.postings) || (await backendPosting(id, request, signal));
      return { posting: { ...posting, is_saved: bookmarks.has(id) } };
    }

    if (detail && method === 'GET') {
      const id = decodeURIComponent(detail[1]);
      const posting = mockPosting(id, catalog.postings);
      return { posting: posting || (await backendPosting(id, request, signal)) };
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
      let backend = [];
      if (sessionStorage.getItem(ACCESS_KEY)) {
        backend = await backendJobs(request, catalog.postings);
      }
      const registeredSources = new Set(
        backend
          .filter((posting) => posting.source_name === 'local_markdown')
          .map((posting) => posting.source_external_id),
      );
      const localPostings = catalog.postings.filter(
        (posting) => !registeredSources.has(posting.source_external_id),
      );
      const available = [...backend, ...localPostings, ...mockPostings, ...customPostings()];
      const params = new URLSearchParams(path.split('?')[1] || '');
      if (params.get('role_id') && params.get('role_id') !== 'custom') {
        const selectedRole = catalog.roles.find((role) => role.id === params.get('role_id'));
        if (selectedRole) params.set('role', selectedRole.label);
      }
      if (params.get('role_id')) {
        const label =
          params.get('role_id') === 'custom'
            ? params.get('role') || '선택 직무'
            : catalog.roles.find((role) => role.id === params.get('role_id'))?.label || '선택 직무';
        const generated = {
          ...mockPostings[0],
          id: `mock-role-${encodeURIComponent(label)}`,
          company: 'CareerLens 시연 기업',
          role: label,
          description: `${label}의 관련 업무와 요구 역량을 확인하는 시연용 가상 공고입니다. 실제 채용공고가 아니며, 백엔드 평가에도 사용할 수 없습니다.`,
          source_type: 'example',
        };
        if (!available.some((posting) => posting.role.toLocaleLowerCase().includes(label.toLocaleLowerCase())))
          available.push(generated);
      }
      const filtered = filteredPostings(available, params);
      const page = Math.max(1, Number(params.get('page')) || 1);
      const pageSize = Math.max(1, Number(params.get('page_size')) || 12);
      const items = filtered.slice((page - 1) * pageSize, page * pageSize);
      return {
        items,
        total: filtered.length,
        page,
        page_size: pageSize,
        filters: {
          locations: [...new Set(available.map((item) => item.location))],
          employment_types: [...new Set(available.map((item) => item.employment_type))],
          experience_levels: [...new Set(available.map((item) => item.experience_level))],
          skills: [...new Set(available.flatMap((item) => item.skills))],
        },
        mock_notice: '가상 예시 및 직접 입력 공고는 화면 체험용이며 실제 백엔드 평가에 사용할 수 없습니다.',
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
  if (example && method === 'GET') return { example: { ...resumeExample, id: decodeURIComponent(example[1]) } };
  if (cleanPath === '/example' && method === 'POST') {
    const result = await backendApi('/resume', {
      method: 'PUT',
      body: { resume_text: resumeExample.resume_text },
      signal,
    }, request, ApiError);
    return result;
  }

  if (cleanPath === '/guest/resume/upload' && method === 'POST') {
    const file = body.get('file');
    if (!file || !file.name) error(ApiError, '이력서 파일을 선택해 주세요.', 400);
    const isText = /\.(md|txt)$/i.test(file.name);
    saveGuest({
      filename: file.name,
      resume_text: isText ? await file.text() : '',
      mock_upload: !isText,
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
    return mockAnalysis(request, signal, true);
  }

  if (cleanPath === '/guest/claim' && method === 'POST') {
    const guest = guestState();
    const { key } = await getMemberWorkspace(request, signal);
    let report = guest.report;
    if (guest.resume_text) {
      const result = await request('/resumes', {
        method: 'POST',
        body: toMarkdownForm(guest.resume_text, guest.filename || 'Guest resume'),
        signal,
      });
      const user = await request('/me', { signal });
      storageSet(`${STATE_KEY}:${user.id}`, {
        ...storageGet(`${STATE_KEY}:${user.id}`, {}),
        resume_id: result.id,
        resume_title: result.title,
      });
    }
    if (report) report = { ...report, demo: true };
    const state = storageGet(key, {});
    storageSet(key, {
      ...state,
      ...(guest.career_target ? { career_target: guest.career_target } : {}),
      ...(guest.selected_posting ? { selected_posting: guest.selected_posting } : {}),
      ...(report
        ? { report, report_created_at: new Date().toISOString(), suppress_latest_report: false }
        : {}),
    });
    storageRemove(GUEST_KEY);
    const refreshed = await getMemberWorkspace(request, signal);
    return {
      draft: {
        ...refreshed.workspace.draft,
        ...(report ? { report, report_locked: false } : {}),
      },
      questions: refreshed.workspace.questions,
    };
  }

  if (cleanPath === '/analysis' && method === 'POST') {
    const user = await request('/me', { signal });
    const state = storageGet(`${STATE_KEY}:${user.id}`, {});
    if (state.selected_posting?.source_type !== 'backend')
      return mockAnalysis(request, signal, false);
    return runBackendAnalysis(request, signal, options.onProgress);
  }

  error(
    ApiError,
    '현재 백엔드에 없는 기능입니다. 이 화면은 실제 데이터에 반영되지 않습니다.',
    501,
  );
}

async function backendPosting(id, request, signal) {
  const raw = await request(`/jobs/${encodeURIComponent(id)}`, { signal });
  let company = null;
  if (raw.company_id) {
    try {
      company = await request(`/companies/${encodeURIComponent(raw.company_id)}`, { signal });
    } catch (failure) {
      if (failure.status !== 404) throw failure;
      company = null;
    }
  }
  return mapJob(raw, company?.name || '');
}
