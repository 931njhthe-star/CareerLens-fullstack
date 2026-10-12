export const ANALYSIS_STAGE_IDS = ['resume', 'role', 'report'] as const;
export type AnalysisStageId = (typeof ANALYSIS_STAGE_IDS)[number];
export type AnalysisStatus = 'pending' | 'running' | 'complete' | 'error';
export interface AnalysisStage {
  id: AnalysisStageId;
  label: string;
  status: AnalysisStatus;
  detail: string;
}
export interface AnalysisSnapshot {
  stages: AnalysisStage[];
  complete: boolean;
  completedCount: number;
  progress: number;
  hasError: boolean;
}

const labels = ['이력서 확인', '희망 직무 분석', '모의지원 준비'];
const statuses = new Set<AnalysisStatus>(['pending', 'running', 'complete', 'error']);
const safeText = (value: unknown, fallback: string, max: number): string =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;

/** State comes from completed work. No elapsed clock can finish a stage. */
export function normalizeAnalysis(value: unknown): AnalysisSnapshot {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const items = Array.isArray(input.stages) ? input.stages : [];
  const stages = ANALYSIS_STAGE_IDS.map((id, index): AnalysisStage => {
    const matches = items.filter((item) => item && typeof item === 'object' && item.id === id);
    // Missing/duplicate entries cannot create an apparently completed analysis.
    const raw = matches.length === 1 ? (matches[0] as Record<string, unknown>) : {};
    const status = statuses.has(raw.status as AnalysisStatus)
      ? (raw.status as AnalysisStatus)
      : 'pending';
    return {
      id,
      status,
      label: safeText(raw.label, labels[index], 80),
      detail: safeText(raw.detail, status === 'pending' ? '확인을 기다리고 있어요.' : '', 320),
    };
  });
  const completedCount = stages.filter((stage) => stage.status === 'complete').length;
  return {
    stages,
    completedCount,
    complete: completedCount === ANALYSIS_STAGE_IDS.length,
    progress: Math.round((completedCount / ANALYSIS_STAGE_IDS.length) * 100),
    hasError: stages.some((stage) => stage.status === 'error'),
  };
}

export function stageValue(status: AnalysisStatus): number {
  return { pending: 0, running: 1, complete: 2, error: 3 }[status];
}
