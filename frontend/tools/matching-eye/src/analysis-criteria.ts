import type { AnalysisFibre } from './analysis-fibres.ts';

export const CRITERION_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type CriterionCorner = (typeof CRITERION_CORNERS)[number];

/** Presentation topics only. These are not server findings or computed scores. */
export const REPORT_CRITERIA = [
  {
    id: 'experience-specificity',
    axis: '이력서 완성도',
    label: '경험 설명의 구체성',
    detail: '수행한 일과 맥락을 설명하는 정도',
  },
  {
    id: 'outcome-evidence',
    axis: '이력서 완성도',
    label: '성과 근거의 명확성',
    detail: '결과를 뒷받침하는 근거의 선명함',
  },
  {
    id: 'structure-readability',
    axis: '이력서 완성도',
    label: '구성과 가독성',
    detail: '내용의 흐름과 읽기 쉬운 구성',
  },
  {
    id: 'core-skills',
    axis: '직무 적합도',
    label: '핵심 기술 일치도',
    detail: '직무에서 요구하는 주요 기술과의 연결',
  },
  {
    id: 'work-relevance',
    axis: '직무 적합도',
    label: '담당 업무 연관성',
    detail: '수행한 경험과 담당 업무의 관련성',
  },
  {
    id: 'preferred-capabilities',
    axis: '직무 적합도',
    label: '우대 역량 부합도',
    detail: '우대하는 역량과 경험의 연결',
  },
  {
    id: 'required-experience',
    axis: '지원 자격 충족도',
    label: '관련 경력 충족도',
    detail: '지원에 필요한 경력 조건',
  },
  {
    id: 'education-major',
    axis: '지원 자격 충족도',
    label: '학력·전공 충족도',
    detail: '지원에 필요한 학력과 전공 조건',
  },
  {
    id: 'other-requirements',
    axis: '지원 자격 충족도',
    label: '기타 필수조건 충족도',
    detail: '그 밖에 지원에 필요한 필수조건',
  },
  {
    id: 'work-scale',
    axis: '실무 경쟁력',
    label: '업무 규모·난도 경쟁력',
    detail: '수행한 업무의 규모와 복잡성',
  },
  {
    id: 'operations-problems',
    axis: '실무 경쟁력',
    label: '운영·문제 해결 경쟁력',
    detail: '운영 경험과 문제 해결의 깊이',
  },
  {
    id: 'role-responsibility',
    axis: '실무 경쟁력',
    label: '역할·책임 수준 경쟁력',
    detail: '맡은 역할과 책임의 범위',
  },
] as const;

export interface CriterionFibreAssignment {
  id: string;
  fibre: AnalysisFibre;
  corner: CriterionCorner;
}

export function fibreCorner(fibre: AnalysisFibre): CriterionCorner {
  return `${Math.sin(fibre.angle) >= 0 ? 'top' : 'bottom'}-${Math.cos(fibre.angle) < 0 ? 'left' : 'right'}`;
}

/** Called once per mount. The seed never changes on API updates or resize. */
export function createAnalysisRunSeed(): number {
  return globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
    : Math.floor(Math.random() * 4294967296);
}

/** Seeded shuffle + one selection in each angular band disperses all 12 bindings. */
export function assignCriterionFibres(
  ids: readonly string[],
  fibres: readonly AnalysisFibre[],
  seed: number,
): CriterionFibreAssignment[] {
  if (!ids.length || new Set(ids).size !== ids.length || fibres.length < ids.length) return [];
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled.map((id, index) => {
    const start = Math.floor((index * fibres.length) / ids.length);
    const end = Math.floor(((index + 1) * fibres.length) / ids.length);
    // Leave a little room at quadrant boundaries, so leaders stay in their corner.
    const inset = Math.floor((end - start) * 0.2);
    const fibre = fibres[start + inset + Math.floor(random() * (end - start - inset * 2))];
    return { id, fibre, corner: fibreCorner(fibre) };
  });
}

/** Four desktop corners; two alternating columns keep mobile copy readable. */
export function criterionAssignmentsForSlot(
  assignments: readonly CriterionFibreAssignment[],
  slot: number,
  compact: boolean,
): CriterionFibreAssignment[] {
  return assignments.filter(({ corner }) =>
    compact ? corner.endsWith(slot === 0 ? 'left' : 'right') : corner === CRITERION_CORNERS[slot],
  );
}
