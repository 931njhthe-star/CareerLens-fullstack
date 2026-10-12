"""Explicit paid model smoke test; no Supabase writes, output is local Markdown."""
import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo
from app.core.config import ROOT, settings
from app.integrations.llm.client import LLM
from app.application.parsing import parse_document
from app.agent.graphs.matching import EvaluationEngine
from app.modules.analysis.reporting.markdown import render
from app.retrieval.indexing.markdown import chunks
from app.integrations.company_info.yahoo import collect


async def main():
    config = settings()
    llm = LLM(config)
    try:
        resume_path = sorted((ROOT / 'app/modules/resumes').glob('CV-001_*.md'))[0]
        resume_text = resume_path.read_text(encoding='utf-8-sig')
        job_text = (ROOT / 'app/modules/job_postings/001.md').read_text(encoding='utf-8-sig')
        resume = await parse_document(llm, resume_text, 'resume')
        job = await parse_document(llm, job_text, 'job')
        try: finance = await asyncio.wait_for(asyncio.to_thread(collect, '035420.KS'), 20)
        except Exception: finance = {'status': 'unavailable', 'reason': '기업정보 조회 실패'}
        async def trace(state, code, result): print(code + ': evaluated', flush=True)
        state = {'run_id': 'local-preview', 'as_of': datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat(),
                 'resume': resume, 'job': job, 'resume_text': resume_text, 'job_text': job_text, 'finance': finance,
                 'chunks': chunks(resume_text), 'results': {}, 'rechecks': 0}
        result = await EvaluationEngine(llm,trace).build().ainvoke(state, {'recursion_limit':15})
        destination = ROOT / '.runtime/preview-report.md'
        destination.parent.mkdir(parents=True,exist_ok=True)
        destination.write_text(render(result),encoding='utf-8')
        print('Preview generated: .runtime/preview-report.md')
        print('Validation: ' + result['scores']['validation_status'])
    finally: await llm.close()


if __name__ == '__main__': asyncio.run(main())
