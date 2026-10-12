import json
import re
from app.agent.prompts.evaluation import EXTRACT
from app.modules.analysis.models import ParsedResume, ParsedJob


async def parse_document(llm, text: str, kind: str, audit=None):
    model = ParsedResume if kind == 'resume' else ParsedJob
    payload = json.dumps({'kind': kind, 'document': text}, ensure_ascii=False)
    if audit:
        parsed = await llm.parse(model, EXTRACT, payload, audit=audit,
                                 call_context={'phase': 'document_parse', 'document_kind': kind})
    else:
        parsed = await llm.parse(model, EXTRACT, payload)
    if kind == 'resume' and not any(c.kind == 'employment' for c in parsed.careers):
        row = re.search(r'(?m)^\|\s*기존 직무 경력\s*\|[^\n]*경력 없음[^\n]*$', text)
        if row:
            from app.modules.analysis.models import Evidence
            parsed.explicit_no_employment = True
            parsed.no_employment_evidence = [Evidence(source='resume', quote=row.group(0))]
    evidence = []
    if kind == 'resume':
        evidence.extend(parsed.no_employment_evidence)
        evidence.extend(e for c in parsed.careers for e in c.evidence)
        evidence.extend(e for ed in parsed.education for e in ed.evidence)
    else: evidence.extend(parsed.conditions_evidence)
    if any(e.source != kind or not e.quote.strip() or e.quote not in text for e in evidence):
        raise ValueError('Extraction evidence does not match original document')
    if kind == 'job' and (parsed.career_min_months or parsed.education_level or parsed.required_major) and not parsed.conditions_evidence:
        raise ValueError('Missing evidence for mandatory conditions')
    return parsed.model_dump()
