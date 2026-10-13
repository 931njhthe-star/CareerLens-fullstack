import { BACKEND_FLOW_NODES, GUEST_FLOW_NODES } from './backend-progress.js';

export const FLOW_COLUMNS = [
  { title: '사용자 행동', subtitle: '화면에서 시작된 동작', color: 'cyan', nodes: [
    ['visit', '화면 진입', '현재 화면의 이동'],
    ['auth', '로그인', '확인된 인증 상태'],
    ['resume', '이력서 준비', '첨부·저장 결과'],
    ['role', '희망 직무', '직무 선택 완료'],
    ['posting', '채용공고', '공고 탐색·선택'],
  ] },
  { title: 'API 요청', subtitle: '브라우저와 서비스 연결', color: 'violet', nodes: [
    ['api_auth', '인증 요청', '로그인·세션 확인'],
    ['api_resume', '이력서 요청', '이력서 조회·저장'],
    ['api_jobs', '공고 요청', '공고 목록·상세'],
    ['api_evaluation', '회원 분석 요청', '백엔드 실행 생성·상태 확인'],
    ['api_report', '회원 보고서 요청', '백엔드에 저장한 결과 조회'],
    ['api_guest_service', '비회원 서비스 확인', '실제 분석 연결 가능 여부'],
    ['api_guest_analysis', '비회원 분석 요청', '프론트 서버 실행 생성·진행 조회·폐기'],
    ['api_guest_claim', '비회원 결과 연결 요청', '인증 후 저장된 결과의 계정 연결'],
    ['api_guest_reports', '연결된 보고서 요청', '프론트 서버의 계정별 결과 조회·삭제'],
  ] },
  { title: '분석 처리', subtitle: '진행 상태와 내부 단계', color: 'lime', nodes: [
    ['queue', '분석 대기', '서버가 알린 대기 상태'],
    ['parse_resume', '이력서 해석', '실제 분석 엔진의 문서 구조화 기록', true],
    ['parse_job', '공고 해석', '실제 분석 엔진의 공고 구조화 기록', true],
    ['indexing', '근거 검색 준비', '임베딩·검색 인덱스 준비 상태', true],
    ['domain_a', '이력서 완성도', 'A1~A3 항목의 최근 처리 상태', true],
    ['domain_b', '직무 적합도', 'B1~B3 항목의 최근 처리 상태', true],
    ['domain_c', '지원 자격 충족도', 'C1~C3 항목의 최근 처리 상태', true],
    ['domain_d', '실무 경쟁력', 'D1~D3 항목의 최근 처리 상태', true],
    ['analysis', '적합도 분석', '서버가 보낸 진행률'],
    ['validation', '결과 검증', '교차 검토·필요 항목 재평가', true],
    ['scoring', '최종 점수 계산', '서버가 알린 점수 계산 상태', true],
  ] },
  { title: '데이터·결과', subtitle: '저장과 사용자에게 전달', color: 'amber', nodes: [
    ['database', '회원 보고서 저장', '백엔드 워커의 결과·보고서 저장 기록', true],
    ['guest_store', '비회원 결과 임시 저장', '프론트 서버 저장 완료 응답·최대 30분', true],
    ['report_lock', '결과 잠금·인증 대기', '계산·저장 완료 후 결과 화면에서 인증 대기'],
    ['guest_claim', '저장 결과의 계정 연결', '서버가 인증 확인 후 기존 결과를 계정에 연결'],
    ['result_delivery', '인증 후 결과 표시 시간', '인증 성공부터 저장 보고서 표시까지 실측'],
    ['guest_cleanup', '임시 자료 정리', '만료 확인·폐기 응답·브라우저 임시 자료 제거'],
    ['report', '보고서 표시', '검증된 보고서 표시 완료'],
    ['archive', '기록 보관', '서버 내부 계측 필요', true],
  ] },
];
// Shared case nodes are also live only when a real observation point exists.
const DEMO_NODES = [
  [
    ['signup', '회원가입', '가입 제출·이메일 확인 대기'], ['logout', '로그아웃', '브라우저 세션 종료'],
    ['session', '세션 확인', '인증 만료·갱신'], ['cancel', '분석 취소', '사용자의 취소 요청'],
    ['history', '저장 보고서', '기존 결과 조회'], ['dashboard', '운영 대시보드', '회원 운영 기록 조회'],
    ['evaluate', '모의지원 실행', '분석 요청부터 결과 준비까지'],
  ],
  [
    ['api_signup', '회원가입 요청', '계정 생성 요청'], ['api_session', '세션 요청', '세션 확인·인증 갱신'],
    ['api_cancel', '취소 요청', '진행 중인 분석 취소'], ['api_dashboard', '운영 기록 요청', '최근 운영 표본 조회'],
    ['api_convert', '파일 변환 요청', '첨부 파일에서 본문 추출'],
  ],
  [['input_check', '입력 확인', '브라우저의 파일·필수 값 확인']],
  [
    ['local_data', '브라우저 보관', '입력·선택·세션·분석 상태 보관'],
    ['database_read', '저장 데이터 조회', '서버 데이터 읽기'], ['notice', '결과 안내', '분기 결과·다음 행동'],
    ['storage_ack', '서버 저장 응답', '가입·이력서 저장의 성공 응답'],
  ],
];
export const FLOW_DEMO_COLUMNS = FLOW_COLUMNS.map((column, index) => ({ ...column,
  nodes: [...column.nodes, ...DEMO_NODES[index].map((node) => [...node, false, node[0] === 'database_read'])],
}));
export const FLOW_NODES = new Map(FLOW_DEMO_COLUMNS.flatMap((column) => column.nodes.map(
  ([id, label, description, internal = false, demoOnly = false]) => [id, { id, label, description, internal, demoOnly, telemetry: BACKEND_FLOW_NODES.includes(id) || GUEST_FLOW_NODES.includes(id), color: column.color }],
)));

// Preserve the 40 cards visible before guest telemetry was added, plus one
// authentication/result-link card. Raw observation IDs remain unchanged.
export const FLOW_BASELINE_CARD_COUNT = 40;
const CARD_PROJECTION = Object.freeze({
  api_guest_service: 'api_evaluation', api_guest_analysis: 'api_evaluation',
  api_guest_claim: 'api_report', api_guest_reports: 'api_report',
  guest_store: 'database', guest_claim: 'report_lock',
  result_delivery: 'report', guest_cleanup: 'local_data', database_read: 'database',
});
export const projectFlowNode = (id) => FLOW_NODES.has(id) ? CARD_PROJECTION[id] || id : null;
const CARD_COPY = {
  api_evaluation: ['분석 요청', '회원·비회원 분석 생성·진행 확인'],
  api_report: ['보고서 요청', '결과 조회·계정 연결·삭제'],
  database: ['결과·자료 저장', '회원 서버·비회원 프론트 서버의 저장 확인'],
  report_lock: ['결과 잠금·계정 연결', '인증 대기와 기존 결과 연결'],
  report: ['보고서 표시', '실제 표시 완료·인증 후 표시 시간'],
  local_data: ['브라우저 보관·정리', '임시 입력·선택 보관·만료·폐기 확인'],
};
export const FLOW_VIEW_COLUMNS = FLOW_DEMO_COLUMNS.map((column) => ({ ...column,
  nodes: column.nodes.filter(([id]) => projectFlowNode(id) === id).map(([id, label, description, ...rest]) =>
    [id, ...(CARD_COPY[id] || [label, description]), ...rest]),
}));
export const FLOW_VIEW_NODES = new Map(FLOW_VIEW_COLUMNS.flatMap((column) => column.nodes.map(
  ([id, label, description]) => [id, { ...FLOW_NODES.get(id), label, description,
    members: [...FLOW_NODES.keys()].filter((node) => projectFlowNode(node) === id),
  }],
)));
export function projectFlowEdges(edges) {
  const found = new Set();
  return edges.flatMap(([from, to]) => {
    const a = projectFlowNode(from), b = projectFlowNode(to), key = `${a}:${b}`;
    if (!a || !b || a === b || found.has(key)) return [];
    found.add(key);
    return [[a, b]];
  });
}
export const FLOW_STATES = {
  pending: '요청 중', running: '진행 중', queued: '대기 중', complete: '완료',
  completed: '완료', ready: '확인됨', failed: '실패', cancelled: '취소',
  partial: '부분 완료', guest: '비회원', member: '로그인됨', logout: '로그아웃',
  blocked: '진행 불가', empty: '결과 없음', waiting: '확인 대기', expired: '만료', cleared: '비움',
};
export const FLOW_SOURCES = { observed: '브라우저에서 관측', backend: '서버 응답', demo: '가상 시연' };

export function flowEventLabel(event) {
  if (event.node === 'queue' && event.state === 'cleared') return '대기 종료';
  if (event.node === 'report_lock') {
    if (['complete', 'cleared'].includes(event.state)) return '잠금 해제';
    if (event.state === 'waiting') return '인증 대기';
  }
  if (event.kind === 'navigation') return '화면 열림';
  if (event.kind === 'session') return event.sessionMode === 'member' ? '회원 확인' : event.sessionMode === 'demo' ? '시연 계정' : event.sessionMode === 'guest' ? '비회원 확인' : '세션 확인';
  return `${event.criterion ? `${event.criterion} · ` : ''}${FLOW_STATES[event.state]}`;
}

export function normalizeFlowEvent(value, { demo = false } = {}) {
  if (!value || typeof value !== 'object' || !FLOW_NODES.has(value.node)) return null;
  if (typeof value.id !== 'string' || value.id.length > 100 || !Object.hasOwn(FLOW_STATES, value.state)) return null;
  if (!Object.hasOwn(FLOW_SOURCES, value.source) || (!demo && value.source === 'demo')) return null;
  const definition = FLOW_NODES.get(value.node);
  if (!demo && (definition.demoOnly || (definition.internal && (!definition.telemetry || value.source !== 'backend')))) return null;
  if (!demo && ((value.node === 'guest_store' && value.execution !== 'guest') || (value.node === 'database' && value.execution === 'guest'))) return null;
  if (!demo && value.node === 'storage_ack' && value.source !== 'backend') return null;
  if (!Number.isFinite(value.at) || value.at < 0) return null;
  return {
    id: value.id, node: value.node, state: value.state, source: demo ? 'demo' : value.source,
    kind: ['action', 'request', 'navigation', 'progress', 'session'].includes(value.kind) ? value.kind : 'action', at: value.at,
    durationMs: typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs >= 0 ? value.durationMs : null,
    progress: typeof value.progress === 'number' && Number.isFinite(value.progress) && value.progress >= 0 && value.progress <= 100 ? value.progress : null,
    ...(value.kind === 'session' && ['guest', 'member', 'demo'].includes(value.sessionMode) ? { sessionMode: value.sessionMode } : {}),
    ...(value.execution === 'guest' ? { execution: 'guest' } : {}),
    ...(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(value.method) ? { method: value.method } : {}),
    ...(typeof value.criterion === 'string' && /^domain_[a-d]$/.test(value.node) && new RegExp(`^${value.node.at(-1).toUpperCase()}[1-3]$`).test(value.criterion) ? { criterion: value.criterion } : {}),
    ...(demo && typeof value.from === 'string' && value.from !== value.node && FLOW_NODES.has(value.from) ? { from: value.from } : {}),
  };
}

// Dependencies follow the active FastAPI/Supabase/worker implementation. These
// relationships are not distributed traces and do not prove unobserved work ran.
export const LIVE_FLOW_EDGES = [
  ['auth', 'api_auth'], ['signup', 'api_signup'], ['session', 'api_session'],
  ['resume', 'api_convert'], ['api_convert', 'api_resume'], ['resume', 'api_resume'],
  ['role', 'api_jobs'], ['posting', 'api_jobs'], ['evaluate', 'api_evaluation'],
  ['cancel', 'api_cancel'], ['history', 'api_report'], ['dashboard', 'api_dashboard'],
  ['api_signup', 'storage_ack'], ['api_resume', 'storage_ack'],
  ['api_auth', 'local_data'], ['api_session', 'local_data'], ['logout', 'local_data'], ['role', 'local_data'],
  ['api_evaluation', 'queue'], ['queue', 'parse_resume'], ['parse_resume', 'parse_job'], ['parse_job', 'indexing'],
  ...['a', 'b', 'c', 'd'].flatMap((domain) => [['indexing', `domain_${domain}`], [`domain_${domain}`, 'validation']]),
  ['validation', 'scoring'], ['scoring', 'database'], ['database', 'api_report'], ['api_report', 'report'],
  ['resume', 'api_guest_service'], ['evaluate', 'api_guest_analysis'], ['api_guest_analysis', 'queue'],
  ['scoring', 'guest_store'], ['guest_store', 'report_lock'], ['report_lock', 'api_auth'],
  ['report_lock', 'api_signup'], ['api_auth', 'api_guest_claim'], ['api_signup', 'api_guest_claim'],
  ['api_guest_claim', 'guest_claim'], ['guest_claim', 'result_delivery'], ['result_delivery', 'report'],
  ['history', 'api_guest_reports'], ['api_guest_reports', 'report'],
  ['cancel', 'guest_cleanup'], ['api_cancel', 'guest_cleanup'], ['api_guest_analysis', 'guest_cleanup'],
];

// A fixed, clearly labelled demonstration. It never sends a request to an API.
export const DEMO_SEQUENCE = [
  [0, 'visit', 'complete'], [700, 'auth', 'pending'], [1100, 'api_auth', 'pending', null, null, 'request'],
  [1650, 'api_auth', 'complete', null, 550, 'request'], [1950, 'auth', 'member'],
  [2900, 'resume', 'pending'], [3400, 'api_resume', 'pending', null, null, 'request'],
  [4050, 'api_resume', 'complete', null, 650, 'request'], [4450, 'resume', 'complete'],
  [5300, 'role', 'complete'], [5900, 'api_jobs', 'pending', null, null, 'request'],
  [6250, 'api_jobs', 'complete', null, 350, 'request'], [6800, 'posting', 'complete'],
  [7600, 'api_evaluation', 'pending', null, null, 'request'],
  [8100, 'api_evaluation', 'complete', null, 500, 'request'], [8500, 'queue', 'queued'],
  [9600, 'queue', 'cleared'], [9700, 'parse_resume', 'running'], [10400, 'parse_job', 'running'],
  [11500, 'parse_resume', 'complete'], [12100, 'parse_job', 'complete'],
  [12800, 'analysis', 'running', 22], [14200, 'analysis', 'running', 48],
  [15800, 'analysis', 'running', 71], [17300, 'validation', 'running'],
  [18700, 'validation', 'complete'], [19400, 'analysis', 'complete', 100],
  [20100, 'database', 'running'], [20900, 'database', 'complete'],
  [21600, 'api_report', 'pending', null, null, 'request'],
  [22020, 'api_report', 'complete', null, 420, 'request'],
  [22900, 'report', 'complete'], [23700, 'archive', 'complete'],
];
