export const PREPARATION_STAGES = [
  { id: 'resume', label: '이력서 근거 확인' },
  { id: 'role', label: '희망 직무 기준 확인' },
  { id: 'report', label: '보고서 기초 분석' },
];
const ACTIVE_DETAILS = {
  resume: '이력서의 수행 경험과 근거 문장을 확인하고 있어요.',
  role: '선택한 직무의 참고 기준을 확인하고 있어요.',
  report: '경험 요약과 보완 질문을 준비하고 있어요.',
};

export function preparationSnapshot(preparation = {}, active, failure) {
  const stages = PREPARATION_STAGES.map((stage) => {
    const saved = preparation.stages?.find((item) => item.id === stage.id);
    return {
      ...stage,
      status:
        stage.id === active
          ? failure
            ? 'error'
            : 'running'
          : saved?.status === 'complete'
            ? 'complete'
            : 'pending',
      detail: stage.id === active ? failure || ACTIVE_DETAILS[stage.id] : saved?.detail || '',
    };
  });
  const insights = [];
  const evidence = preparation.resume_evidence || {};
  for (const [id, label, key, unit] of [
    ['statements', '경험 문장', 'statement_count', '개 문장'],
    ['actions', '수행 경험', 'action_statement_count', '개 수행 표현'],
    ['metrics', '성과와 규모', 'metric_statement_count', '개 수치 표현'],
  ]) {
    if (Number.isInteger(evidence[key]) && evidence[key] >= 0) {
      insights.push({
        id,
        stageId: 'resume',
        label,
        detail: `이력서에서 ${evidence[key]}${unit}을 확인했습니다.`,
      });
    }
  }
  const reference = preparation.role_reference;
  if (Array.isArray(reference?.criteria))
    insights.push({
      id: 'reference',
      stageId: 'role',
      label: '직무 참고 기준',
      detail: `${reference.criteria.length}개 내부 참고 항목과 경험을 살펴봅니다.`,
    });
  if (Array.isArray(preparation.questions))
    insights.push({
      id: 'questions',
      stageId: 'report',
      label: '보완할 이야기',
      detail: `경험을 더 설명할 질문 ${preparation.questions.length}개를 준비했습니다.`,
    });
  return { stages, insights, complete: stages.every((stage) => stage.status === 'complete') };
}

// Completion is acknowledged by the API, never inferred from an animation clock.
export async function runPreparationStages({ initial, request, signal, onSnapshot, onWorkspace }) {
  let preparation = initial || {};
  const fingerprint = preparation.fingerprint;
  if (!fingerprint) throw new Error('희망 직무를 다시 저장한 뒤 분석을 시작해 주세요.');
  for (const stage of PREPARATION_STAGES) {
    signal.throwIfAborted();
    if (preparation.stages?.some((item) => item.id === stage.id && item.status === 'complete'))
      continue;
    onSnapshot(preparationSnapshot(preparation, stage.id));
    try {
      const result = await request(stage.id, fingerprint, signal);
      signal.throwIfAborted();
      const next = result.preparation || result.draft?.preparation;
      if (
        next?.fingerprint !== fingerprint ||
        !next.stages?.some((item) => item.id === stage.id && item.status === 'complete')
      ) {
        throw new Error(
          '분석 완료 상태를 확인하지 못했습니다. 희망 직무를 확인하고 다시 시도해 주세요.',
        );
      }
      preparation = next;
      onWorkspace(result);
      onSnapshot(preparationSnapshot(preparation));
    } catch (error) {
      if (!signal.aborted) onSnapshot(preparationSnapshot(preparation, stage.id, error.message));
      throw error;
    }
  }
  if (!preparation.complete || !preparationSnapshot(preparation).complete)
    throw new Error('아직 완료되지 않은 분석이 있습니다. 다시 시도해 주세요.');
  return preparation;
}
