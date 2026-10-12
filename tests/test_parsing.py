import pytest
import json
from pathlib import Path
from app.application.parsing import DocumentParseError, parse_document
from app.modules.analysis.models import Evidence, ParsedJob, ParsedResume


@pytest.mark.asyncio
async def test_explicit_no_career_row_survives_extraction():
    class FakeLLM:
        async def parse(self,*args):
            return ParsedResume(skills=[],careers=[],education=[],projects=[],explicit_no_employment=False,no_employment_evidence=[])
    original = '# 이력서\n| 기존 직무 경력 | 정규직 경력 없음 |\n'
    result = await parse_document(FakeLLM(), original, 'resume')
    assert result['explicit_no_employment']
    assert result['no_employment_evidence'][0]['quote'] in original


@pytest.fixture
def samsung_posting():
    catalog = json.loads((Path(__file__).resolve().parents[1] / 'frontend/data/career-postings.json').read_text(encoding='utf-8'))
    # This is the same Markdown source used by the deployment's posting seed.
    return next(item['content'] for item in catalog['items'] if item['filename'] == '009.md')


def parsed_job(evidence):
    return ParsedJob(title='반도체 공정 지식 RAG 엔지니어', company_name='삼성전자',
        responsibilities=[], technical_requirements=[], preferred_requirements=[],
        other_required_conditions=[], career_min_months=None, education_level='bachelor',
        required_major=None, conditions_evidence=evidence)


def test_deployment_seed_preserves_posting_markdown(samsung_posting):
    seed = (Path(__file__).resolve().parents[1] / 'scripts/seed-demo-job-postings.sql').read_text(encoding='utf-8')
    assert samsung_posting.strip() in seed


@pytest.mark.asyncio
async def test_job_receives_exact_markdown_and_records_audited_kind(samsung_posting):
    class FakeLLM:
        async def parse(self, schema, instruction, payload, **kwargs):
            assert schema is ParsedJob
            assert payload == samsung_posting
            assert '문서 종류: job' in instruction
            assert kwargs['call_context']['document_kind'] == 'job'
            return parsed_job([Evidence(source='job', quote='관련 분야 학사 이상 또는 이에 준하는 경험')])
    result = await parse_document(FakeLLM(), samsung_posting, 'job', audit=object())
    assert result['conditions_evidence'][0]['quote'] in samsung_posting


@pytest.mark.asyncio
async def test_job_repairs_paraphrased_evidence_without_changing_source(samsung_posting):
    class FakeLLM:
        calls = 0

        async def parse(self, schema, instruction, payload):
            self.calls += 1
            assert payload == samsung_posting
            if self.calls == 1:
                return parsed_job([Evidence(source='job', quote='관련 분야의 학사 학위를 필수로 요구')])
            assert 'evidence_not_in_original' in instruction
            return parsed_job([Evidence(source='job', quote='관련 분야 학사 이상 또는 이에 준하는 경험')])
    llm = FakeLLM()
    result = await parse_document(llm, samsung_posting, 'job')
    assert llm.calls == 2
    assert result['conditions_evidence'][0]['quote'] in samsung_posting


@pytest.mark.asyncio
async def test_job_missing_evidence_stops_after_one_repair(samsung_posting):
    class FakeLLM:
        calls = 0

        async def parse(self, *args):
            self.calls += 1
            return parsed_job([])
    llm = FakeLLM()
    with pytest.raises(DocumentParseError) as error:
        await parse_document(llm, samsung_posting, 'job')
    assert llm.calls == 2
    assert error.value.kind == 'job'
    assert error.value.reason == 'mandatory_conditions_without_evidence'
    assert samsung_posting not in str(error.value)


@pytest.mark.asyncio
async def test_job_without_education_condition_does_not_require_evidence(samsung_posting):
    class FakeLLM:
        async def parse(self, *args):
            return parsed_job([]).model_copy(update={'education_level': None})
    assert (await parse_document(FakeLLM(), samsung_posting, 'job'))['education_level'] is None


@pytest.mark.asyncio
async def test_failed_structured_output_identifies_job_without_logging_source(samsung_posting):
    class FakeLLM:
        async def parse(self, *args):
            raise ValueError('No structured output')
    with pytest.raises(DocumentParseError) as error:
        await parse_document(FakeLLM(), samsung_posting, 'job')
    assert error.value.kind == 'job'
    assert error.value.reason == 'invalid_structured_output'
