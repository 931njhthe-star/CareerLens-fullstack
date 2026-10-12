import math
from datetime import date
from app.modules.analysis.models import CriterionResult, ParsedResume, ParsedJob
from app.modules.analysis.scoring.rubric import CRITERIA, DOMAIN_WEIGHTS

POWER_MEAN_ORDER = 0.5


def weighted_power_mean(items: list[tuple[float, float, str]]) -> float:
    if not items:
        raise ValueError('At least one score is required')
    if any(score is None for score, _, _ in items):
        raise ValueError('Every criterion must have a numeric score')
    if any(not math.isfinite(s) or s < 0 or s > 100 for s, _, _ in items):
        raise ValueError('Invalid score')
    total = sum(w for _, w, _ in items)
    if not math.isfinite(total) or total <= 0 or any(not math.isfinite(w) or w <= 0 for _, w, _ in items):
        raise ValueError('Invalid weight')
    mean = sum(w / total * (s / 100) ** POWER_MEAN_ORDER for s, w, _ in items)
    return 100 * mean ** (1 / POWER_MEAN_ORDER)


def calculate(results: dict[str, dict]) -> dict:
    if set(results) != {c[0] for c in CRITERIA}:
        raise ValueError('All twelve criteria must be present')
    domains = {}
    for domain in DOMAIN_WEIGHTS:
        rows = [(results[code]['score'], weight, results[code]['verdict']) for code, d, _, weight, _ in CRITERIA if d == domain]
        domains[domain] = weighted_power_mean(rows)
    overall = weighted_power_mean([(domains[d], w, 'met') for d, w in DOMAIN_WEIGHTS.items()])
    verdicts = [results[c]['verdict'] for c in ['C1', 'C2', 'C3']]
    eligibility = 'not_met' if 'not_met' in verdicts else 'met'
    return {**domains, 'overall_score': overall, 'eligibility_status': eligibility,
            'validation_status': 'partial' if any(r['issues'] for r in results.values()) else 'passed',
            'overall_formula': {'method': 'weighted_power_mean', 'order': POWER_MEAN_ORDER, 'weights': DOMAIN_WEIGHTS, 'excluded_domains': [], 'missing_resume_evidence_policy': 'score_as_zero_and_not_met', 'no_job_requirement_policy': 'score_as_100_and_met', 'zero_policy': 'contributes_by_weight'}}


def related_months(resume: ParsedResume, today: date) -> int:
    months = set()
    for career in resume.careers:
        if not career.related or career.kind != 'employment':
            continue
        sy, sm = map(int, career.start.split('-'))
        if not 1 <= sm <= 12: raise ValueError('Invalid month')
        ey, em = map(int, (career.end or today.strftime('%Y-%m')).split('-'))
        if not 1 <= em <= 12: raise ValueError('Invalid month')
        start, end = sy * 12 + sm - 1, ey * 12 + em - 1
        current = today.year * 12 + today.month - 1
        if end < start or end > current or start > current: raise ValueError('Invalid career interval')
        months.update(range(start, end + 1))
    return len(months)


def qualifications(code: str, resume: ParsedResume, job: ParsedJob, today: date) -> CriterionResult | None:
    def result(score, verdict, summary, evidence):
        return CriterionResult(code=code, score=score, verdict=verdict, confidence=1,
            reasoning_summary=summary, improvement_suggestion='이력서에 조건을 충족하는 경력과 근거를 구체적으로 기재하세요.' if verdict == 'not_met' else '',
            evidence=evidence, comparison_basis='공고에 명시된 지원 조건', estimated=False, issues=[])
    def no_job_requirement(summary):
        return result(100, 'met', summary, [])
    if code == 'C1':
        required = job.career_min_months
        if not required: return no_job_requirement('최소 경력 조건 없음—100점 반영')
        evidence = [e for c in resume.careers if c.related and c.kind == 'employment' for e in c.evidence] + resume.no_employment_evidence
        try: months = related_months(resume, today)
        except ValueError: return result(0, 'not_met', '경력 기간 근거가 유효하지 않아 0점 반영', evidence)
        if not evidence or (not months and not resume.explicit_no_employment):
            return result(0, 'not_met', '이력서에서 관련 고용경력 근거가 확인되지 않아 0점 반영', evidence)
        if any('인턴' in q for q in job.technical_requirements): return None
        return result(min(months / required, 1) * 100, 'met' if months >= required else 'not_met',
                      f'관련 고용경력 {months}개월 / 요구 {required}개월. 중복 월 제거, 교육 프로젝트 제외.', evidence)
    if code == 'C2':
        if job.required_major: return None
        if not job.education_level: return no_job_requirement('학력·전공 조건 없음—100점 반영')
        levels = ['high_school', 'associate', 'bachelor', 'master', 'doctorate']
        completed = [e for e in resume.education if e.graduated]
        if not completed: return result(0, 'not_met', '이력서에서 졸업 학력 근거가 확인되지 않아 0점 반영', [])
        best = max(completed, key=lambda e: levels.index(e.level))
        met = levels.index(best.level) >= levels.index(job.education_level)
        return result(100 if met else 0, 'met' if met else 'not_met', f'졸업 학력 {best.level}, 최소 요구 {job.education_level}', best.evidence)
    if code == 'C3' and not job.other_required_conditions:
        return no_job_requirement('별도 필수조건 없음—100점 반영')
    return None
