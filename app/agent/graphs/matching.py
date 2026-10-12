import asyncio
import json
from datetime import date, datetime, timezone
from time import perf_counter
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END
from app.agent.prompts.evaluation import SYSTEM
from app.modules.analysis.models import CriterionResult, CriticReview, ParsedResume, ParsedJob
from app.modules.analysis.scoring.rubric import CRITERIA, BY_CODE, DOMAIN_WEIGHTS
from app.modules.analysis.scoring.calculator import calculate, qualifications
from app.retrieval.indexing.markdown import lexical_search


def merge(left, right):
    return {**left, **right}


class State(TypedDict, total=False):
    run_id: str
    resume: dict
    job: dict
    resume_text: str
    job_text: str
    finance: dict
    chunks: list[dict]
    results: Annotated[dict, merge]
    rechecks: int
    affected: list[str]
    scores: dict
    issues: list[str]
    as_of: str


def evidence_issues(result: CriterionResult, state: State) -> list[str]:
    problems = []
    job = ParsedJob.model_validate(state['job'])
    no_job_requirement = (
        (result.code == 'B1' and not job.technical_requirements)
        or (result.code == 'B2' and not job.responsibilities)
        or (result.code == 'B3' and not job.preferred_requirements)
        or (result.code.startswith('C') and (
            (result.code == 'C1' and not job.career_min_months)
            or (result.code == 'C2' and not job.education_level and not job.required_major)
            or (result.code == 'C3' and not job.other_required_conditions)
        ))
        or (result.code.startswith('D') and not job.responsibilities)
    )
    for item in result.evidence:
        text = state['resume_text'] if item.source == 'resume' else state['job_text']
        if not item.quote.strip() or item.quote not in text:
            problems.append('원문에서 확인되지 않는 인용')
    if result.score is not None and result.score > 0 and not result.evidence and not no_job_requirement:
        problems.append('점수 판단에 대한 원문 근거 없음')
    if result.code.startswith('D') and not no_job_requirement and (not result.estimated or result.confidence > .6):
        problems.append('경쟁자 비교 추정 표시·신뢰도 상한 위반')
    return problems


class EvaluationEngine:
    def __init__(self, llm, trace, search=None, progress=None, llm_audit=None, timing=None):
        self.llm, self.trace, self.search, self.progress = llm, trace, search, progress
        self.llm_audit = llm_audit
        self.timing = timing

    async def parse(self, schema, instruction, payload, phase, code=None):
        if self.llm_audit:
            return await self.llm.parse(schema, instruction, payload, audit=self.llm_audit,
                call_context={'phase': phase, 'criterion_code': code})
        return await self.llm.parse(schema, instruction, payload)

    async def report_progress(self, code: str, message: str, fraction: float, status: str = 'running'):
        if self.progress:
            await self.progress(code, message, fraction, status)

    async def evaluate(self, state: State, code: str, feedback: str = '') -> dict:
        started_at = datetime.now(timezone.utc)
        started = perf_counter()
        status = 'completed'
        try:
            return await self._evaluate(state, code, feedback)
        except asyncio.CancelledError:
            status = 'cancelled'
            raise
        except Exception:
            status = 'failed'
            raise
        finally:
            if self.timing:
                await self.timing(
                    'criterion_evaluation', started_at,
                    round((perf_counter() - started) * 1000), status, code,
                )

    async def _evaluate(self, state: State, code: str, feedback: str = '') -> dict:
        await self.report_progress(code, '평가 시작', 0.0)
        parsed_resume = ParsedResume.model_validate(state['resume'])
        parsed_job = ParsedJob.model_validate(state['job'])
        fixed = qualifications(code, parsed_resume, parsed_job, date.fromisoformat(state['as_of'])) if code.startswith('C') else None
        no_requirement = (
            (code == 'B1' and not parsed_job.technical_requirements)
            or (code == 'B2' and not parsed_job.responsibilities)
            or (code == 'B3' and not parsed_job.preferred_requirements)
            or (code.startswith('D') and not parsed_job.responsibilities)
        )
        if not fixed and no_requirement:
            fixed = CriterionResult(code=code, score=100, verdict='met', confidence=1,
                reasoning_summary='공고에 비교할 요구사항이 없어 100점 반영',
                improvement_suggestion='', evidence=[], comparison_basis='공고에 관련 요구사항 없음',
                estimated=False, issues=[])
        context = lexical_search(state['chunks'], BY_CODE[code][2] + ' ' + ' '.join(parsed_job.technical_requirements))
        if not fixed and self.search and code in ('A2', 'B1', 'B2', 'B3', 'C3', 'D1', 'D2', 'D3'):
            await self.report_progress(code, '이력서 근거 검색 시작', 0.05)
            extra = await self.search(state, code)
            if extra: context = extra
            await self.report_progress(code, '이력서 근거 검색 완료', 0.15)
        payload = json.dumps({'criterion': BY_CODE[code], 'resume': state['resume_text'], 'job': state['job_text'],
                              'parsed_resume': state['resume'], 'parsed_job': state['job'], 'company_context': state['finance'],
                              'retrieved_evidence': context, 'feedback': feedback}, ensure_ascii=False)
        methods = ['python'] if fixed else ['structured_evaluation', 'retrieval', 'self_refine']
        if fixed:
            draft = fixed
            await self.report_progress(code, '규칙 기반 점수 판정 완료', 0.75)
        else:
            await self.report_progress(code, '초안 평가 요청 중', 0.2)
            draft = await self.parse(CriterionResult, SYSTEM, payload, 'draft', code)
            if draft.code != code: raise ValueError('Criterion code mismatch')
            await self.report_progress(code, '초안 평가 완료', 0.45)
            # A single evidence-focused review, never a loop of unconstrained reasoning.
            await self.report_progress(code, '근거 검토 요청 중', 0.5)
            draft = await self.parse(CriterionResult, SYSTEM,
                payload + '\n초안의 근거 누락·과대해석을 검토하고 필요한 경우 수정하라.\n' + draft.model_dump_json(),
                'evidence_review', code)
            await self.report_progress(code, '근거 검토 완료', 0.7)
        if not fixed and (code in ('D1', 'D3') or draft.confidence < .65):
            await self.report_progress(code, '독립 평가 요청 중', 0.72)
            independent = await self.parse(CriterionResult, SYSTEM, payload + '\n독립적으로 평가하라.',
                                           'independent_evaluation', code)
            methods.append('self_consistency')
            if independent.code != code: raise ValueError('Criterion code mismatch')
            await self.report_progress(code, '독립 평가 완료', 0.8)
            disagreement = draft.verdict != independent.verdict or (draft.score is not None and independent.score is not None and abs(draft.score - independent.score) > 15)
            if disagreement:
                await self.report_progress(code, '평가 차이 재검토 요청 중', 0.84)
                draft = await self.parse(CriterionResult, SYSTEM,
                    payload + '\n두 평가의 불일치 근거를 확인하고 한번만 재평가하라.\n' + draft.model_dump_json() + '\n' + independent.model_dump_json(),
                    'disagreement_recheck', code)
                methods.append('bounded_recheck')
                await self.report_progress(code, '평가 차이 재검토 완료', 0.9)
        if draft.code != code: raise ValueError('Criterion code mismatch')
        await self.report_progress(code, '원문 인용 및 점수 검증 중', 0.92)
        problems = evidence_issues(draft, state)
        if problems:
            if not fixed:
                await self.report_progress(code, '검증 오류 보완 요청 중', 0.94)
                draft = await self.parse(CriterionResult, SYSTEM,
                    payload + '\n검증 오류를 한번 수정하라: ' + json.dumps(problems, ensure_ascii=False),
                    'validation_repair', code)
                await self.report_progress(code, '검증 오류 보완 완료', 0.97)
                problems = evidence_issues(draft, state)
            if problems:
                draft.score, draft.verdict = 0, 'not_met'
                draft.evidence = [e for e in draft.evidence if e.quote.strip() and e.quote in state[f'{e.source}_text']]
                draft.issues.extend(problems)
        result = draft.model_dump()
        result['applied_methods'] = methods
        await self.trace(state, code, result)
        return result

    def build(self, checkpointer=None):
        graph = StateGraph(State)
        domains = list(DOMAIN_WEIGHTS)
        for domain in domains:
            async def node(state, domain=domain):
                codes = [c[0] for c in CRITERIA if c[1] == domain]
                evaluated = await asyncio.gather(*(self.evaluate(state, code) for code in codes))
                return {'results': {r['code']: r for r in evaluated}}
            graph.add_node(domain, node)
            graph.add_edge(START, domain)

        async def critic(state):
            await self.report_progress('all', '전체 평가 결과 교차 검토 시작', 82 / 100)
            review = await self.parse(CriticReview, SYSTEM + '\n너는 전역 검증자다. 점수 재작성 없이 원문 근거 충돌·항목 누락·과대해석만 확인하라.',
                json.dumps({'results': state['results'], 'resume': state['resume_text'], 'job': state['job_text']}, ensure_ascii=False),
                'global_critic')
            affected = sorted(set(c for c in review.affected_codes if c in BY_CODE))
            await self.report_progress('all', '전체 평가 결과 교차 검토 완료', 87 / 100, 'completed')
            if affected:
                await self.report_progress('all', f'검토 지적 항목 {len(affected)}개 재평가 시작', 87 / 100)
            return {'affected': affected, 'issues': review.issues}

        async def recheck(state):
            codes = state['affected']
            results = await asyncio.gather(*(self.evaluate(state, c, '\n'.join(state['issues'])) for c in codes))
            await self.report_progress('all', f'검토 지적 항목 {len(codes)}개 재평가 완료', 91 / 100, 'completed')
            return {'results': {r['code']: r for r in results}, 'rechecks': 1}

        def score(state):
            values = calculate(state['results'])
            if state.get('affected') and state.get('rechecks', 0):
                values['validation_status'] = 'partial'
            return {'scores': values}

        graph.add_node('global_critic', critic)
        graph.add_node('targeted_recheck', recheck)
        async def calculate_scores(state):
            await self.report_progress('all', '최종 점수 계산 시작', 92 / 100)
            result = score(state)
            await self.report_progress('all', '최종 점수 계산 완료', 94 / 100, 'completed')
            return result

        graph.add_node('calculate', calculate_scores)
        graph.add_edge(domains, 'global_critic')
        graph.add_conditional_edges('global_critic', lambda s: 'targeted_recheck' if s['affected'] and not s.get('rechecks', 0) else 'calculate', ['targeted_recheck', 'calculate'])
        graph.add_edge('targeted_recheck', 'global_critic')
        graph.add_edge('calculate', END)
        return graph.compile(checkpointer=checkpointer)
