// Only persisted backend work completes the stages in the loading presentation.
export function reportLoadingSnapshot(draft, complete = false, update = null) {
  const stage = update?.run?.current_stage;
  const evaluationStarted = ['criterion', 'validation', 'reporting', 'completed'].includes(stage);
  const reportingStarted = ['reporting', 'completed'].includes(stage);
  const status = (done) => (complete || done ? 'complete' : 'running');
  return {
    stages: [
      {
        id: 'resume',
        label: '이력서 확인',
        status: status(evaluationStarted),
        detail: '이력서에 담긴 경험과 성과를 살펴봅니다.',
      },
      {
        id: 'role',
        label:
          draft.analysis_mode === 'job_posting' ? '선택한 공고 기준 분석' : '희망 직무 기준 분석',
        status: status(reportingStarted),
        detail:
          draft.analysis_mode === 'job_posting'
            ? `${draft.company || '선택한 기업'} ${draft.role || ''} 공고의 요구사항과 경험을 비교합니다.`
            : `${draft.career_target?.label || draft.role || '희망 직무'}의 참고 기준으로 경험을 살펴봅니다.`,
      },
      {
        id: 'report',
        label: '최종 보고서 작성',
        status: status(complete),
        detail: '경험에 대한 요약과 보완할 부분을 정리합니다.',
      },
    ],
    insights: [],
    complete,
  };
}

function validReport(report) {
  const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const optionalList = (value, valid) =>
    value == null || (Array.isArray(value) && value.every(valid));
  const text = (value) => typeof value === 'string';
  if (
    !record(report) ||
    !(
      report.source === 'backend'
        ? report.score === null ||
          (Number.isFinite(report.score) && report.score >= 0 && report.score <= 100)
        : Number.isFinite(report.score) && report.score >= 0 && report.score <= 100
    ) ||
    !text(report.summary) ||
    !text(report.verdict)
  )
    return false;
  return (
    optionalList(
      report.criteria,
      (item) =>
        record(item) &&
        text(item.label) &&
        Number.isFinite(item.score) &&
        Number.isFinite(item.max_score) &&
        item.max_score > 0,
    ) &&
    optionalList(
      report.matches,
      (item) => record(item) && optionalList(item.evidence_items, record),
    ) &&
    ['strengths', 'gaps', 'questions'].every((key) => optionalList(report[key], text)) &&
    ['priorities', 'reference_guidance'].every((key) => optionalList(report[key], record)) &&
    (report.ai_coaching == null ||
      (record(report.ai_coaching) && optionalList(report.ai_coaching.recommendations, record)))
  );
}

export async function requestFinalReport({ draft, answers, signal, request, onProgress }) {
  signal.throwIfAborted();
  let result;
  try {
    result = await request('/analysis', { method: 'POST', body: { answers }, signal, onProgress });
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
  signal.throwIfAborted();
  if (!validReport(result?.report))
    throw new Error('완성된 보고서를 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
  // Keep the successful report if only the subsequent workspace refresh fails.
  const fallback = { draft: { ...draft, answers, report: result.report, created_at: '' } };
  try {
    const fresh = await request('/workspace', { signal });
    signal.throwIfAborted();
    if (!validReport(fresh?.draft?.report)) return fallback;
    return fresh;
  } catch (error) {
    signal.throwIfAborted();
    if (error.status === 401 || error.status === 403 || error.status === 409) throw error;
    return fallback;
  }
}
