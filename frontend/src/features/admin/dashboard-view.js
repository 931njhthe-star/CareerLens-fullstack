import { escapeHtml as e } from '../../shared/components/ui.js';
import {
  RUN_STATUSES, RUN_LIMIT, records, isRecord, measuredNumber, measuredCount,
  overviewCounts, filterRuns, formatDuration, formatCount, formatTime,
  scoreDisplay, statusLabel,
} from './performance-data.js';

const text = (value, fallback = '기록 없음') =>
  ['string', 'number', 'boolean'].includes(typeof value) && String(value).trim()
    ? e(String(value).slice(0, 4000)) : e(fallback);
const missing = (message) => `<p class="admin-dashboard__missing">${e(message)}</p>`;
const code = (value) => `<span class="admin-dashboard__code">${text(value)}</span>`;
const TECHNICAL_LABELS = {
  parse_resume: '이력서 구조화', parse_job: '채용공고 구조화',
  resume_embedding: '이력서 벡터 생성', index_save: '검색 색인 저장',
  criterion_evaluation: '평가 기준별 평가', evaluation_graph: '평가 흐름 실행',
  match_result_save: '최종 점수 저장', report_render: '보고서 생성',
  report_sql_save: '보고서 DB 저장', report_file_write: '보고서 파일 기록',
  evaluation_total: '전체 평가', execution_report_render: '실행 기록 생성',
  execution_report_sql_save: '실행 기록 DB 저장', execution_report_file_write: '실행 기록 파일 기록',
  document_parse: '문서 구조화', draft: '평가 초안', evidence_review: '근거 검토',
  independent_evaluation: '독립 평가', disagreement_recheck: '평가 불일치 재검토',
  validation_repair: '검증 오류 수정', global_critic: '전체 결과 교차 검토',
  lexical_search: '키워드 검색', query_embedding: '검색어 벡터 생성', vector_search: '벡터 검색',
  missing_evidence: '근거 부족', conflicting_evidence: '근거 간 충돌', score_error: '점수 계산 오류',
  cross_domain_conflict: '평가 영역 간 판단 충돌', invalid_output: '응답 형식 오류', other: '기타',
  resume_completeness: '이력서 완성도 평가', job_fit: '직무 적합도 평가',
  qualifications: '지원 자격 충족도 평가', practical_competitiveness: '실무 경쟁력 평가',
  targeted_recheck: '문제 기준 재평가', calculate: '점수 계산',
};
const technical = (value) => {
  const label = TECHNICAL_LABELS[value] || (typeof value === 'string' && /^evaluate_[ABCD][123]$/.test(value) ? `${value.slice(9)} 기준 평가` : null);
  return label ? `<span class="admin-dashboard__technical-label">${e(label)}</span>${code(value)}` : code(value);
};
const badge = (status) => `<span class="admin-status admin-status--${RUN_STATUSES.some(([key]) => key === status) ? status : 'unknown'}">${e(statusLabel(status))}</span>`;
const facts = (entries) => `<dl class="admin-dashboard__facts">${entries.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
const numberHeading = (label) => ({ label, numeric: true });
const table = (caption, headings, rows) => `<div class="admin-dashboard__table-scroll" tabindex="0" role="region" aria-label="${e(caption)}"><table><caption>${e(caption)}</caption><thead><tr>${headings.map((heading) => `<th scope="col"${heading.numeric ? ' class="numeric"' : ''}>${e(heading.label || heading)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const panel = (id, number, title, description, body) => `<section id="admin-${id}" class="admin-dashboard__panel" aria-labelledby="admin-${id}-title"><header class="admin-dashboard__section-heading"><div><p class="admin-dashboard__eyebrow">${e(number)}</p><h2 id="admin-${id}-title">${e(title)}</h2><p>${e(description)}</p></div></header>${body}</section>`;
const sectionNotice = (run, section, fallback) => {
  const availability = run.availability?.[section];
  if (availability?.status === 'unavailable') return missing('조회 실패 · 이 영역을 확인하지 못했습니다. 상세를 다시 불러와 주세요.');
  if (availability?.reason) return missing(availability.reason);
  return missing(fallback);
};
const criterion = (value) => text(value, '해당 없음');
const attempt = (value) => measuredCount(value) === null ? '기록 없음' : String(value);
const verdict = (value) => text({ met: '충족', not_met: '미충족', unknown: '판정 보류', not_applicable: '해당 없음' }[value] || value);
const accountScopeLabel = (data) => data?.scope?.mode === 'account' ? '현재 계정'
  : data?.scope?.accounts === 'all' ? '전체 계정' : '현재 응답';

export function renderFlowEntry(flowUrl) {
  return `<section class="admin-dashboard__flow-entry" aria-labelledby="admin-flow-title"><div><h2 id="admin-flow-title">이 작업 창의 이용 흐름</h2><p id="admin-flow-help">현재 작업 창 하나와 연결된 별도 관찰 창을 엽니다. 다른 작업 창의 요청은 섞이지 않으며 원래 창을 새로고침해도 다시 연결합니다.</p></div><a class="button secondary" href="${e(flowUrl || '/?view=flow')}" aria-describedby="admin-flow-help" data-admin-flow>이용 흐름 새 창 열기</a></section>`;
}

export function overviewCards(data, { pending = true } = {}) {
  const counts = data ? overviewCounts(data.runs) : null;
  const scopeLabel = accountScopeLabel(data);
  const labels = [['queued', '대기 분석'], ['running', '실행 중 분석'], ['completed', '정상 완료'], ['partial', '완료 · 확인 필요'], ['failed', '실패'], ['cancelled', '취소']];
  return `<dl class="admin-dashboard__cards" aria-label="${scopeLabel}의 현재 조회 표본 상태">${labels.map(([key, label]) => `<div class="admin-dashboard__card admin-dashboard__card--${key}"><dt>${e(label)}</dt><dd>${counts ? formatCount(counts[key]) : pending ? '조회 중' : '조회 불가'}</dd><span>${scopeLabel} · 조회 표본</span></div>`).join('')}</dl>`;
}

export function renderRestrictedView() {
  return `<div class="admin-dashboard__feedback" role="status"><h2>로그인 상태를 확인해 주세요</h2><p>대시보드와 이용 흐름은 가입한 모든 회원이 이용할 수 있습니다. 관리자 권한은 필요하지 않습니다.</p><p>로그인 후에도 접근이 거절되면 프론트엔드와 백엔드를 모두 최신 버전으로 갱신하고 서버를 다시 시작해 주세요.</p><a class="button secondary" href="/#/email">로그인</a><button class="button secondary" type="button" data-admin-retry>다시 시도</button></div>${overviewCards(null, { pending: false })}`;
}

function aggregateStages(stages) {
  if (!stages.length) return missing('이 기간에 제공된 단계 기록이 없습니다. 소요 시간은 미측정입니다.');
  const max = Math.max(0, ...stages.map((stage) => measuredNumber(stage.avg_ms) ?? 0));
  return table('서버 단계별 성능 집계', ['단계', ...['측정 표본', '평균', 'P50', 'P95', '최대'].map(numberHeading)], stages.map((stage) => {
    const width = max > 0 && measuredNumber(stage.avg_ms) !== null ? ((stage.avg_ms / max) * 100).toFixed(2) : 0;
    return `<tr><th scope="row">${technical(stage.stage)}<span class="admin-dashboard__bar" aria-hidden="true"><i style="width:${width}%"></i></span></th><td class="numeric">${formatCount(stage.sample_count)}</td><td class="numeric">${formatDuration(stage.avg_ms)}</td><td class="numeric">${formatDuration(stage.p50_ms)}</td><td class="numeric">${formatDuration(stage.p95_ms)}</td><td class="numeric">${formatDuration(stage.max_ms)}</td></tr>`;
  }));
}

function runStages(stages) {
  if (!stages.length) return missing('이 실행에 제공된 단계 기록이 없습니다. 소요 시간은 미측정입니다.');
  return table('선택 실행 단계 기록', ['단계', '평가 기준', numberHeading('시도'), '상태', numberHeading('소요 시간')], stages.map((stage) => `<tr><th scope="row">${technical(stage.stage)}</th><td>${criterion(stage.criterion_code)}</td><td class="numeric">${attempt(stage.attempt_number ?? stage.attempt)}</td><td>${badge(stage.status)}</td><td class="numeric">${formatDuration(stage.duration_ms)}</td></tr>`));
}

function inputView(run) {
  if (!isRecord(run.input) && !isRecord(run.reproduction)) return sectionNotice(run, 'input', '입력·재현 기록 없음 · 이 실행에 제공된 입력 식별자와 버전 정보가 없습니다.');
  const input = run.input || {};
  const reproduction = run.reproduction || {};
  const schemas = Array.isArray(reproduction.schema_versions) ? reproduction.schema_versions.filter((v) => typeof v === 'string') : [];
  const sources = reproduction.version_sources || {};
  return facts([
    ['이력서 식별자', code(input.resume_id)], ['공고 식별자', code(input.job_posting_id ?? input.job_id)],
    ['서버 입력 형식', text(input.type ?? input.file_type)], ['모델', text(reproduction.model)],
    ['프롬프트 버전', text(reproduction.prompt_version, '버전 번호 미기록')], ['기록 형식·평가 버전', schemas.length ? schemas.map((v) => text(v)).join(', ') : text(reproduction.schema_version, '버전 번호 미기록')],
    ['점수 산정 버전', text(reproduction.scoring_version)], ['워크플로 버전', text(reproduction.workflow_version)],
  ]) + `<details class="admin-dashboard__help"><summary>버전 값은 어디서 정해지나요?</summary><p>${text(sources.prompt_version, '실행 당시 백엔드에 저장된 프롬프트 버전 값입니다. 현재 설정으로 과거 값을 대신하지 않습니다.')}</p><p>${text(sources.schema_version, '저장된 중간 결과에 기록된 스키마 버전입니다. 기록이 없으면 값을 추정하지 않습니다.')}</p><p>${text(sources.model, '모델은 실행 당시 저장된 설정입니다.')}</p></details>` +
    facts([
      ['입력 구성 해시', code(input.sha256)], ['이력서 내용 해시', code(input.resume_sha256)], ['공고 내용 해시', code(input.job_sha256)],
    ]) + missing('입력 구성 해시는 이력서·공고·평가 설정의 조합을 구분합니다. 이력서와 공고 내용 해시는 각각의 입력 내용이 같은지 확인합니다. 서버 입력 형식은 원래 첨부한 PDF·DOCX 형식과 다를 수 있습니다.') + (run.availability?.input_type ? sectionNotice(run, 'input_type') : '') + sectionNotice(run, 'input', '식별자와 해시는 실행을 추적하기 위한 메타데이터이며 원문은 공개하지 않습니다.');
}

function nodesView(run) {
  const nodes = records(run.nodes);
  const tools = records(run.tools);
  const memory = run.memory || {};
  const checkpoint = memory.checkpoints || {};
  return runStages(records(run.stages)) + missing('평가 기준이 없는 문서 파싱·공통 처리 단계는 ‘해당 없음’입니다. 시도 번호는 서버에 기록된 실제 값입니다.') +
    (nodes.length ? table('노드 실행 기록', ['노드', '평가 기준', numberHeading('시도'), '상태', numberHeading('소요 시간')], nodes.map((node) => `<tr><th scope="row">${technical(node.name)}</th><td>${criterion(node.criterion_code)}</td><td class="numeric">${attempt(node.attempt_number)}</td><td>${badge(node.status)}</td><td class="numeric">${formatDuration(node.duration_ms)}</td></tr>`)) : sectionNotice(run, 'nodes', '노드별 실행 기록 없음 · 단계 시간과 별도로 기록된 노드 정보가 없습니다.')) +
    (nodes.length && nodes.every((node) => measuredNumber(node.duration_ms) === null) ? sectionNotice(run, 'nodes', '노드 완료 기록만 저장되어 별도 실행 시간은 미측정입니다. 위 평가 기준별 평가 단계의 시간을 확인하세요.') : '') +
    (tools.length ? table('도구 사용 기록', ['도구', '평가 기준', '상태', numberHeading('결과 수'), numberHeading('소요 시간')], tools.map((tool) => `<tr><th scope="row">${technical(tool.name)}</th><td>${criterion(tool.criterion_code)}</td><td>${badge(tool.status)}</td><td class="numeric">${formatCount(tool.result_count)}</td><td class="numeric">${formatDuration(tool.duration_ms)}</td></tr>`)) : sectionNotice(run, 'tools', '도구별 기록 없음 · 도구를 사용하지 않았다는 뜻은 아닙니다.')) +
    (isRecord(run.memory) ? facts([
      ['기억 저장소', text({ retrieval_and_checkpoint: '검색·체크포인트', retrieval: '검색 기록', postgres_checkpoint: 'PostgreSQL 체크포인트' }[memory.kind] || memory.kind)], ['검색된 항목', formatCount(memory.retrieved_count)],
      ['실행 스레드', code(memory.graph_thread_id)], ['체크포인트 수', formatCount(memory.checkpoint_count ?? checkpoint.count)],
      ['최근 체크포인트', code(memory.checkpoint_id ?? checkpoint.latest_id)], ['체크포인트 기록 시각', formatTime(checkpoint.latest_at)],
    ]) + (checkpoint.status === 'unavailable' ? missing('체크포인트 조회 실패 · 검색 기록과 별도로 다시 확인이 필요합니다.') : '') + sectionNotice(run, 'memory', '검색 결과 원문과 체크포인트 내용은 공개하지 않습니다.') : sectionNotice(run, 'memory', '검색·체크포인트 기록 없음 · 실행 중 사용 여부를 추정하지 않습니다.'));
}

function validationView(run) {
  const validation = run.validation;
  if (!isRecord(validation)) return sectionNotice(run, 'validation', '검증 기록 없음 · 완료 상태만으로 검증 통과를 판단하지 않습니다.');
  const labels = { passed: '통과', partial: '확인 필요', failed: '실패', pending: '대기', completed: '완료', not_required: '해당 없음', not_recorded: '기록 없음', not_rechecked: '재검증 기록 없음', recorded: '재검증 기록 있음', issues_remaining: '확인할 이슈 남음', open: '미해결', resolved: '해결', ignored: '제외 처리', needs_review: '확인 필요', rechecking: '재검증 중', accepted_risk: '참고사항 인정', low: '낮음', medium: '보통', high: '높음', critical: '매우 높음' };
  const label = (v) => text(labels[v] || v);
  const issues = records(validation.issues);
  return facts([
    ['검증 상태', label(validation.status)], ['평가 기준 재평가 횟수', formatCount(validation.retry_count)],
    ['전역 미해결 이슈', formatCount(validation.unresolved_issue_count)], ['재검증 결과', label(validation.revalidation_status)],
    ['확인 필요한 평가 기준', formatCount(validation.criterion_issue_count)],
    ['저장된 전역 이슈', formatCount(validation.global_issue_count)],
  ]) + missing('‘완료 · 확인 필요’는 처리 종료 상태입니다. 전역 검증 이슈와 개별 평가 기준의 검증 상태는 별도로 기록되므로 전역 이슈 0건이 전체 검증 통과를 뜻하지 않습니다. 재평가 횟수는 평가 기준을 다시 평가한 횟수이며 통신 재시도와 다릅니다.') +
    (issues.length ? table('검증 이슈', ['평가 기준', '검사 유형', '심각도', '처리 상태'], issues.map((issue) => `<tr><th scope="row">${criterion(issue.criterion_code)}</th><td>${technical(issue.type ?? issue.code)}</td><td>${label(issue.severity)}</td><td>${label(issue.status ?? (issue.resolved === true ? '해결' : issue.resolved === false ? '미해결' : null))}</td></tr>`)) : sectionNotice(run, 'validation', '저장된 이슈 상세 없음 · 미해결 건수와 별도로 확인하세요.'));
}

function scoreTable(run) {
  const scores = run.scores;
  const criteria = Array.isArray(scores) ? records(scores) : records(scores?.criteria);
  if (!criteria.length && !Object.values(scores || {}).some((value) => measuredNumber(value) !== null)) return sectionNotice(run, 'scores', '점수 기록 없음 · 실행 상태나 시간으로 점수를 추정하지 않습니다.');
  const domains = isRecord(scores) ? facts([
    ['이력서 완성도', scoreDisplay(scores.resume_completeness)], ['직무 적합도', scoreDisplay(scores.job_fit)],
    ['지원 자격 충족도', scoreDisplay(scores.qualifications)], ['실무 경쟁력', scoreDisplay(scores.practical_competitiveness)],
    ['종합 점수', scoreDisplay(scores.overall_score)], ['지원 자격 판정', verdict(scores.eligibility_status)],
  ]) : '';
  if (!criteria.length) return domains + sectionNotice(run, 'scores', '점수 기록 없음 · 실행 상태나 시간으로 점수를 추정하지 않습니다.');
  return domains + table('저장된 기준별 점수', ['평가 기준', numberHeading('DB 원점수'), numberHeading('화면 표시 · 반올림'), '판정', numberHeading('근거 수')], criteria.map((item) => {
    const score = Object.hasOwn(item, 'score') ? item.score : item.raw_score;
    return `<tr><th scope="row">${text(item.criterion_code ?? item.code)}</th><td class="numeric">${scoreDisplay(score)}</td><td class="numeric">${scoreDisplay(score, { rounded: true })}</td><td>${verdict(item.verdict)}</td><td class="numeric">${formatCount(item.evidence_count)}</td></tr>`;
  })) + missing('원점수는 저장된 값 그대로이며 화면 표시만 반올림합니다. 점수 없음은 0점이 아닙니다. 공개 대시보드에서는 이력서·공고의 근거 원문을 표시하지 않습니다.');
}

function persistenceView(run) {
  const value = run.persistence;
  if (run.availability?.persistence?.status === 'unavailable') return sectionNotice(run, 'persistence');
  if (!isRecord(value)) return sectionNotice(run, 'persistence', '보고서 저장 기록 없음 · 저장 성공이나 실패를 추정하지 않습니다.');
  const stored = value.has_body === true ? '본문 저장 확인' : value.has_body === false ? '저장된 본문 없음' : text(value.status);
  const compatible = value.result_schema_compatible === true ? '현재 점수·판정 형식 호환' : value.result_schema_compatible === false ? '현재 점수·판정 형식과 호환되지 않음' : '확인 기록 없음';
  const retrievable = value.retrievable === true ? '계정 열람 확인' : value.retrievable === false ? '현재 조회 경로에서 열 수 없음' : '계정 열람 미검사';
  return facts([
    ['보고서 식별자', code(value.report_id)], ['저장 상태', stored], ['저장 시각', formatTime(value.saved_at)],
    ['저장 보고서 수', formatCount(value.report_count)], ['계정에서 실제 열람', retrievable], ['점수·판정 형식 검사', compatible],
  ]) + missing('본문 저장과 점수·판정 형식은 DB 기록으로 확인합니다. 실제 로그인 계정으로 보고서를 여는 검사는 별도이며 여기서는 실행하지 않습니다. 과거 점수 형식은 현재 결과 API와 호환되지 않을 수 있습니다.');
}

function llmView(run) {
  const llm = run.llm;
  const reproduction = run.reproduction || {};
  if (!isRecord(llm)) return sectionNotice(run, 'llm', 'LLM 호출 기록 없음 · 모델을 호출하지 않았다는 뜻은 아닙니다.');
  const cost = isRecord(llm.cost) && measuredNumber(llm.cost.amount) !== null && typeof llm.cost.currency === 'string' ? `${text(llm.cost.amount)} ${text(llm.cost.currency)}` : '미측정';
  const calls = records(llm.calls);
  if (!calls.length && measuredCount(llm.call_count) === null && !isRecord(llm.cost)) return sectionNotice(run, 'llm', 'LLM 호출 기록 없음 · 모델을 호출하지 않았다는 뜻은 아닙니다.');
  const hashes = records(reproduction.request_hashes);
  return facts([
    ['모델', text(llm.model)], ['기록된 호출 수', formatCount(llm.call_count)],
    ['입력 토큰', text(measuredCount(llm.input_tokens))], ['출력 토큰', text(measuredCount(llm.output_tokens))],
    ['실측 비용', cost], ['비용 출처', text(llm.cost?.source, '해당 없음')],
  ]) + missing('토큰 사용량과 비용은 다른 정보입니다. 실제 비용 기록이 없으면 미측정으로 표시합니다.') +
    (calls.length ? table('LLM 호출과 요청 해시', ['호출 단계', '평가 기준', '모델 · 출력 자료형', '성공 여부', numberHeading('소요 시간'), numberHeading('입력 토큰'), numberHeading('출력 토큰'), '호출 해시'], calls.map((call) => `<tr><th scope="row">${technical(call.phase)}</th><td>${criterion(call.criterion_code)}</td><td>${text(call.model)}<br>${code(call.schema)}</td><td>${call.success === true ? '성공' : call.success === false ? '실패' : '기록 없음'}</td><td class="numeric">${formatDuration(call.duration_ms)}</td><td class="numeric">${text(measuredCount(call.input_tokens))}</td><td class="numeric">${text(measuredCount(call.output_tokens))}</td><td class="admin-dashboard__hash"><details class="admin-dashboard__call-hashes"><summary>해시 보기</summary>${facts([['요청 해시', code(call.request_sha256)], ['프롬프트 본문 해시', code(call.prompt_sha256)], ['JSON 출력 스키마 해시', code(call.schema_sha256)]])}</details></td></tr>`)) : hashes.length ? table('기록된 호출별 요청 해시', ['호출 단계', '평가 기준', '출력 자료형', '요청 해시'], hashes.map((call) => `<tr><th scope="row">${technical(call.phase)}</th><td>${criterion(call.criterion_code)}</td><td>${text(call.schema)}</td><td class="admin-dashboard__hash">${code(call.sha256)}</td></tr>`)) : '') +
    missing('요청 해시는 개별 LLM 호출에 보낸 지시문과 입력을 구분합니다. 프롬프트 본문 해시는 지시문만, JSON 출력 스키마 해시는 응답 형식만 비교합니다. 입력 구성 해시·버전 번호·출력 자료형 이름과는 각각 다릅니다. 계측 추가 이전 호출의 본문·스키마 해시는 기록 없음으로 표시합니다.') + sectionNotice(run, 'llm', '위 사용량은 저장된 호출 기록에 근거합니다.');
}

export function renderRunDetail(run, {
  loading = false,
  error = false,
  reportOpen = false,
  reportLoading = false,
  reportError = false,
  reportMarkdown = null,
} = {}) {
  if (!run) return '';
  const detail = (id, title, body, open = false) => `<details id="admin-detail-${id}" class="admin-dashboard__detail-section" ${open ? 'open' : ''}><summary>${e(title)}</summary><div>${body}</div></details>`;
  const header = `<header class="admin-dashboard__detail-heading"><div><p class="admin-dashboard__eyebrow">선택한 실행</p><h2 id="admin-detail-title" tabindex="-1">실행 상세</h2><p class="admin-dashboard__code">${text(run.id)}</p><p>${badge(run.status)} <span>${formatTime(run.created_at)}</span></p></div><div class="admin-dashboard__detail-actions"><button type="button" class="button secondary compact" data-admin-execution-report aria-expanded="${reportOpen}">${reportOpen ? '테스트 보고서 닫기' : '테스트 보고서 보기'}</button><button type="button" class="button secondary compact" data-admin-close>상세 닫기</button></div></header>`;
  let body;
  if (loading) body = '<p class="admin-dashboard__missing" role="status">선택한 실행의 저장 기록을 불러오는 중입니다.</p>';
  else if (error) body = `<div class="admin-dashboard__feedback" role="alert"><p>${error === 'not_found' ? '실행 목록에는 있지만 상세 API에서 기록이 제공되지 않습니다. 서버가 최신 버전인지 확인하고 다시 불러와 주세요.' : '상세 조회 실패 · 저장 기록을 불러오지 못했습니다.'}</p><button class="button secondary" type="button" data-admin-detail-retry>상세 다시 불러오기</button></div>`;
  else body = detail('input', '입력·재현', inputView(run), true) + detail('nodes', '단계·노드·도구·기억', nodesView(run)) + detail('validation', '검증·재시도', validationView(run)) + detail('scores', '점수·보고서 저장', scoreTable(run) + persistenceView(run)) + detail('llm', 'LLM 사용량·요청 해시', llmView(run)) + detail('evidence', '시험 증거', sectionNotice(run, 'test_evidence', '실행에 연결된 시험 증거 기록 없음 · 운영 실행 완료와 시험 통과는 별개입니다.'));
  const report = reportOpen ? `<section class="admin-dashboard__execution-report-content" role="region" aria-label="테스트 보고서 원문" aria-busy="${reportLoading}">${reportLoading
    ? '<p class="admin-dashboard__missing" role="status">실행 기록 원문을 불러오는 중입니다.</p>'
    : reportError
      ? `<div class="admin-dashboard__feedback" role="alert"><p>${reportError === 'missing' ? '이 실행에는 저장된 실행 기록 원문이 없습니다.' : '실행 기록 원문을 불러오지 못했습니다.'}</p><button class="button secondary" type="button" data-admin-execution-report-retry>다시 시도</button></div>`
      : `<pre class="admin-dashboard__execution-report-source">${e(reportMarkdown)}</pre>`}</section>` : '';
  return `<aside class="admin-dashboard__detail" aria-labelledby="admin-detail-title" aria-busy="${loading}">${header}${report}${body}</aside>`;
}

function listView(data, status, selectedIndex) {
  const filtered = filterRuns(data.runs, status);
  if (!data.runs.length) return missing('조회 기간에 반환된 실행이 없습니다. 다른 기간을 선택하거나 새로고침하세요.');
  if (!filtered.length) return missing('선택한 상태의 실행이 없습니다. 상태 필터를 전체로 변경해 보세요.');
  return table(`실행 ${filtered.length}건 · 최신순`, ['실행 ID', '상태', '생성 시각', numberHeading('전체 소요'), numberHeading('측정 단계')], filtered.map((run) => {
    const index = data.runs.indexOf(run);
    return `<tr class="${index === selectedIndex ? 'is-selected' : ''}" data-admin-row="${index}"><th scope="row"><button type="button" class="admin-dashboard__run-button" data-admin-run="${index}" aria-expanded="${index === selectedIndex}" aria-controls="admin-selected-run">${code(run.id)}<span class="admin-dashboard__run-action">${index === selectedIndex ? '선택됨' : '상세 보기'}</span></button></th><td>${badge(run.status)}</td><td>${formatTime(run.created_at)}</td><td class="numeric">${formatDuration(run.total_ms)}</td><td class="numeric">${formatCount(run.stages_collected ? run.stages.length : null)}</td></tr>`;
  }));
}

export function renderPerformanceView(data, {
  days = 30,
  status = 'all',
  selectedIndex = -1,
  detailLoading = false,
  detailError = false,
  reportOpen = false,
  reportLoading = false,
  reportError = false,
  reportMarkdown = null,
  updatedAt = null,
} = {}) {
  const counts = overviewCounts(data.runs);
  const scope = data.scope || {};
  const scopeDescription = scope.mode === 'account' ? '현재 로그인한 계정의 평가 실행 기록입니다.'
    : scope.accounts === 'all' ? '전체 계정의 평가 실행 기록입니다.'
      : '서버가 반환한 평가 실행 기록입니다. 계정 범위는 제공되지 않았습니다.';
  const selected = data.runs[selectedIndex];
  const filteredCount = filterRuns(data.runs, status).length;
  return `${overviewCards(data)}<div class="admin-dashboard__scope"><p>${scopeDescription} 마이페이지에 저장된 개인 보고서 개수가 아닙니다.</p><p>최근 ${days}일 · 최근 최대 ${RUN_LIMIT}건 요청 · 현재 응답 표본 ${data.runs.length}건 · 목록 필터 결과 ${filteredCount}건. 상태 카드는 필터와 무관하게 조회 표본을 집계합니다.${counts.other ? ` 알려지지 않은 상태 ${counts.other}건은 별도입니다.` : ''}</p><p>서버 집계 ${formatCount(data.summary.run_count)} · 마지막 조회 ${formatTime(updatedAt || data.generated_at)} · 60초마다·화면 복귀 시 자동 갱신${scope.total_runs !== undefined ? ` · 기간 내 전체 실행 ${formatCount(scope.total_runs)}` : ''}</p></div>${panel('runs', '01 / EXECUTIONS', '실행 현황·목록', '실행을 선택하면 저장된 상세 기록을 조회합니다. 완료·확인 필요는 진행 중 상태가 아닙니다.', listView(data, status, selectedIndex))}<div id="admin-selected-run">${renderRunDetail(selected, { loading: detailLoading, error: detailError, reportOpen, reportLoading, reportError, reportMarkdown })}</div>${panel('timing', '02 / PERFORMANCE', '단계별 소요 시간', '입력 파싱부터 보고서 저장까지의 서버 집계입니다. 병렬 단계의 합은 전체 실행 시간과 다를 수 있습니다.', facts([['서버 성능 집계 실행 수', formatCount(data.summary.run_count)], ['평균 전체 소요', formatDuration(data.summary.avg_total_ms)], ['P95 전체 소요', formatDuration(data.summary.p95_total_ms)]]) + aggregateStages(data.stages) + missing('선택 기간의 최근 실행 표본에 저장된 계측 기록을 집계합니다. 단계 표본 수에는 재시도 기록도 포함됩니다. P50은 중앙값, P95는 측정값 95%가 이 값 이하인 시간입니다. 막대는 평균 시간의 상대 길이이며 진행률이 아닙니다.'))}`;
}

export function renderLoadingView() {
  return `${overviewCards(null)}<div class="admin-dashboard__feedback" role="status"><strong>운영 기록을 불러오는 중입니다</strong><p>선택한 기간의 최신 실행과 단계별 성능을 확인합니다.</p></div>`;
}

export function renderErrorView() {
  return '<div class="admin-dashboard__feedback admin-dashboard__feedback--error" role="alert"><h2>운영 기록을 불러오지 못했습니다</h2><p>잠시 후 다시 시도해 주세요. 문제가 계속되면 서비스 연결 상태를 확인해 주세요.</p><button class="button secondary" type="button" data-admin-retry>다시 시도</button></div>';
}
