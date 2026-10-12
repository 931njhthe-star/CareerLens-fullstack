import logging
import re
from app.agent.prompts.evaluation import EXTRACT
from app.modules.analysis.models import ParsedResume, ParsedJob

log = logging.getLogger(__name__)


class DocumentParseError(ValueError):
    """A safe diagnostic without document text or generated quotes."""

    def __init__(self, kind: str, reason: str):
        self.kind, self.reason = kind, reason
        super().__init__(f'{kind}: {reason}')


def extraction_problem(parsed, text: str, kind: str) -> str | None:
    evidence = []
    if kind == 'resume':
        evidence.extend(parsed.no_employment_evidence)
        evidence.extend(e for c in parsed.careers for e in c.evidence)
        evidence.extend(e for ed in parsed.education for e in ed.evidence)
    else:
        evidence.extend(parsed.conditions_evidence)
    if any(e.source != kind or not e.quote.strip() or e.quote not in text for e in evidence):
        return 'evidence_not_in_original'
    if kind == 'job' and (parsed.career_min_months or parsed.education_level or parsed.required_major) and not parsed.conditions_evidence:
        return 'mandatory_conditions_without_evidence'
    return None


async def parse_document(llm, text: str, kind: str, audit=None):
    if kind not in ('resume', 'job'):
        raise DocumentParseError(kind, 'unsupported_document_kind')
    if not isinstance(text, str) or not text.strip():
        raise DocumentParseError(kind, 'empty_or_non_text_original')
    model = ParsedResume if kind == 'resume' else ParsedJob
    instruction = f'{EXTRACT}\n문서 종류: {kind}. evidence.source는 {kind}로 지정하라.'
    for attempt in range(1, 3):
        try:
            if audit:
                parsed = await llm.parse(model, instruction, text, audit=audit,
                    call_context={'phase': 'document_parse', 'document_kind': kind, 'attempt': attempt})
            else:
                parsed = await llm.parse(model, instruction, text)
        except ValueError as exc:
            raise DocumentParseError(kind, 'invalid_structured_output') from exc
        if kind == 'resume' and not any(c.kind == 'employment' for c in parsed.careers):
            row = re.search(r'(?m)^\|\s*기존 직무 경력\s*\|[^\n]*경력 없음[^\n]*$', text)
            if row:
                from app.modules.analysis.models import Evidence
                parsed.explicit_no_employment = True
                parsed.no_employment_evidence = [Evidence(source='resume', quote=row.group(0))]
        problem = extraction_problem(parsed, text, kind)
        if problem is None:
            return parsed.model_dump()
        log.warning('Document extraction rejected: document_kind=%s attempt=%s reason=%s', kind, attempt, problem)
        if attempt == 2:
            raise DocumentParseError(kind, problem)
        instruction += (
            f'\n이전 추출 검증 실패: {problem}. 원문을 다시 읽고 추출하라. '
            '인용은 Markdown 기호·공백·줄바꿈까지 원문에서 그대로 복사하라. '
            '원문에서 확인되지 않는 조건을 만들어 넣지 마라.'
        )
        if kind == 'job':
            instruction += ' 학력·경력·전공 조건을 추출하면 해당 원문을 conditions_evidence에 반드시 넣어라.'
