import type { AnalysisSnapshot, AnalysisStageId } from './analysis-state.ts';
import { REPORT_CRITERIA } from './analysis-criteria.ts';
export interface AnalysisReadout {
  id: string;
  stageId?: AnalysisStageId;
  axis?: string;
  label: string;
  detail: string;
}
export type AnalysisPurpose = 'preparation' | 'report';

/** Only backend-returned evidence becomes a finding; defaults describe the work. */
export function analysisReadouts(
  value: unknown,
  snapshot: AnalysisSnapshot,
  purpose: AnalysisPurpose = 'preparation',
): AnalysisReadout[] {
  if (purpose === 'report') return REPORT_CRITERIA.map((criterion) => ({ ...criterion }));
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const items = Array.isArray(input.insights) ? input.insights : [];
  const insights = items.flatMap((item: unknown): AnalysisReadout[] => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    if (!snapshot.stages.some((stage) => stage.id === raw.stageId && stage.status === 'complete'))
      return [];
    if (
      typeof raw.label !== 'string' ||
      typeof raw.detail !== 'string' ||
      !raw.label.trim() ||
      !raw.detail.trim()
    )
      return [];
    return [
      {
        id: String(raw.id || raw.label).slice(0, 80),
        stageId: raw.stageId as AnalysisStageId,
        label: raw.label.trim().slice(0, 60),
        detail: raw.detail.trim().slice(0, 180),
      },
    ];
  });
  if (insights.length) return insights.slice(0, 16);
  return [
    {
      id: 'resume-structure',
      stageId: 'resume',
      label: '이력서 구조',
      detail: '경력과 프로젝트 내용을 살펴보고 있어요.',
    },
    {
      id: 'desired-role',
      stageId: 'role',
      label: '희망 직무 기준',
      detail: '선택한 직무의 참고 기준을 확인하고 있어요.',
    },
    {
      id: 'experience',
      stageId: 'resume',
      label: '경험의 근거',
      detail: '수행한 일과 결과를 담은 문장을 확인해요.',
    },
    {
      id: 'report-preparation',
      stageId: 'report',
      label: '보고서 구성',
      detail: '분석 내용과 보완할 부분을 정리해요.',
    },
    {
      id: 'role-context',
      stageId: 'role',
      label: '직무와 경험',
      detail: '이력서에 담긴 직무 관련 경험을 살펴봐요.',
    },
    {
      id: 'questions',
      stageId: 'report',
      label: '보완 방향',
      detail: '이력서에서 더 설명하면 좋을 경험을 정리해요.',
    },
  ];
}
