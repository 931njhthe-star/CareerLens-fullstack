import pytest
from app.application.parsing import parse_document
from app.modules.analysis.models import ParsedResume


@pytest.mark.asyncio
async def test_explicit_no_career_row_survives_extraction():
    class FakeLLM:
        async def parse(self,*args):
            return ParsedResume(skills=[],careers=[],education=[],projects=[],explicit_no_employment=False,no_employment_evidence=[])
    original = '# 이력서\n| 기존 직무 경력 | 정규직 경력 없음 |\n'
    result = await parse_document(FakeLLM(), original, 'resume')
    assert result['explicit_no_employment']
    assert result['no_employment_evidence'][0]['quote'] in original
