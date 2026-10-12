import json
import pytest
from app.agent.graphs.matching import EvaluationEngine, evidence_issues
from app.modules.analysis.models import CriterionResult, CriticReview


def initial():
    return {'run_id': 'test', 'as_of': '2026-10-08', 'resume': {'skills': [], 'careers': [], 'education': [], 'projects': [], 'explicit_no_employment': False, 'no_employment_evidence': []},
            'job': {'title': 'job', 'company_name': 'company', 'responsibilities': [], 'technical_requirements': [], 'preferred_requirements': [], 'other_required_conditions': [], 'career_min_months': None, 'education_level': None, 'required_major': None, 'conditions_evidence': []},
            'resume_text': '직접 구현한 경험', 'job_text': '업무', 'finance': {}, 'chunks': [], 'results': {}, 'rechecks': 0}


class FakeLLM:
    def __init__(self, conflict=False): self.conflict, self.critics = conflict, 0
    async def parse(self, schema, instruction, payload):
        if schema is CriticReview:
            self.critics += 1
            return CriticReview(affected_codes=['B1'] if self.conflict and self.critics == 1 else [], issues=[])
        code = json.loads(payload.split('\n')[0])['criterion'][0]
        return CriterionResult(code=code, score=80, verdict='met', confidence=.5 if code.startswith('D') else .9,
            reasoning_summary='근거 확인', improvement_suggestion='', evidence=[{'source':'resume','quote':'직접 구현한 경험'}], comparison_basis='공고', estimated=code.startswith('D'), issues=[])


@pytest.mark.asyncio
async def test_graph_joins_all_domains_and_rechecks_only_affected():
    calls = []
    async def trace(state, code, result): calls.append(code)
    llm = FakeLLM(conflict=True)
    result = await EvaluationEngine(llm,trace).build().ainvoke(initial())
    assert len(result['results']) == 12
    assert calls.count('B1') == 2
    assert all(calls.count(code) == 1 for code in result['results'] if code != 'B1')
    assert result['scores']['overall_score'] == pytest.approx(80)
    assert llm.critics == 2


def test_fabricated_evidence_is_rejected():
    r = CriterionResult(code='B1',score=100,verdict='met',confidence=1,reasoning_summary='',improvement_suggestion='',evidence=[{'source':'resume','quote':'없는 근거'}],comparison_basis='',estimated=False,issues=[])
    assert evidence_issues(r,initial())


@pytest.mark.asyncio
async def test_unresolved_critic_is_bounded_and_withholds_total():
    class PersistentCritic(FakeLLM):
        async def parse(self, schema, instruction, payload):
            if schema is CriticReview:
                return CriticReview(affected_codes=['B1'], issues=['판단 근거 추가 확인'])
            return await super().parse(schema,instruction,payload)
    calls = []
    async def trace(state,code,result): calls.append(code)
    result = await EvaluationEngine(PersistentCritic(),trace).build().ainvoke(initial())
    assert calls.count('B1') == 2
    assert result['scores']['overall_score'] is None
    assert result['scores']['validation_status'] == 'partial'
