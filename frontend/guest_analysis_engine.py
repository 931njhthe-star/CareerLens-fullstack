"""Run the team's real evaluation graph without an account or production DB writes.

The frontend server owns guest access, input validation, expiry and persistence.
This module only computes a result using the sibling backend's unchanged engine.
Imports and configuration are lazy so frontend-only deployments remain usable.
"""

import asyncio
from datetime import datetime, timezone
from functools import lru_cache
import importlib
import inspect
import math
from pathlib import Path
import sys
import time
from threading import RLock
from types import SimpleNamespace
from zoneinfo import ZoneInfo


_BACKEND_ROOT = Path(__file__).resolve().parent.parent / "CareerLens-backend"
_IMPORT_LOCK = RLock()


class EngineUnavailable(RuntimeError):
    """Safe public-facing classification; never contains settings or provider text."""


@lru_cache(maxsize=1)
def _load_backend():
    with _IMPORT_LOCK:
        package = _BACKEND_ROOT / "app" / "__init__.py"
        if not package.is_file():
            raise EngineUnavailable("Guest analysis engine is unavailable")
        existing = sys.modules.get("app")
        if existing is not None:
            source = getattr(existing, "__file__", None)
            if not source or Path(source).resolve() != package.resolve():
                raise EngineUnavailable("Guest analysis engine is unavailable")
        root = str(_BACKEND_ROOT)
        if root not in sys.path:
            sys.path.insert(0, root)
        try:
            def module(name):
                return importlib.import_module("app." + name)

            rubric = module("modules.analysis.scoring.rubric")
            indexing = module("retrieval.indexing.markdown")
            return SimpleNamespace(
                settings=module("core.config").settings,
                llm=module("integrations.llm.client").LLM,
                parse_document=module("application.parsing").parse_document,
                engine=module("agent.graphs.matching").EvaluationEngine,
                chunks=indexing.chunks,
                token_count=lambda text: len(indexing.tiktoken.get_encoding("cl100k_base").encode(text)),
                render=module("modules.analysis.reporting.markdown").render,
                criteria=rubric.CRITERIA,
                version=rubric.VERSION,
            )
        except (ImportError, OSError, RuntimeError, ValueError) as error:
            raise EngineUnavailable("Guest analysis engine is unavailable") from error


def _configuration(backend):
    try:
        config = backend.settings()
        if not config.openai_api_key.get_secret_value() or config.embedding_dimensions != 1536:
            raise ValueError("Missing supported model configuration")
        return config
    except (AttributeError, TypeError, ValueError) as error:
        raise EngineUnavailable("Guest analysis engine is unavailable") from error


def engine_available():
    """Check installed engine/configuration only; makes no model or DB request."""
    try:
        _configuration(_load_backend())
        return True
    except EngineUnavailable:
        return False


def _vector_search(rows, vectors, query, limit=5):
    """Equivalent ranking to the backend RPC's pgvector cosine distance."""
    if len(rows) != len(vectors) or not query:
        raise ValueError("Invalid embedding result")
    if any(not isinstance(value, (float, int)) or not math.isfinite(value) for value in query):
        raise ValueError("Invalid embedding result")
    query_norm = math.sqrt(sum(value * value for value in query))
    if not query_norm:
        raise ValueError("Invalid embedding result")
    ranked = []
    for row, vector in zip(rows, vectors):
        if len(vector) != len(query) or any(
            not isinstance(value, (float, int)) or not math.isfinite(value) for value in vector
        ):
            raise ValueError("Invalid embedding result")
        norm = math.sqrt(sum(value * value for value in vector))
        if not norm:
            raise ValueError("Invalid embedding result")
        similarity = sum(a * b for a, b in zip(vector, query)) / (norm * query_norm)
        ranked.append({
            "content": row["content"], "section": row["section"],
            "metadata": row["metadata"], "similarity": similarity,
        })
    return sorted(ranked, key=lambda row: row["similarity"], reverse=True)[:limit]


async def run_analysis(resume_text, job, run_id, on_progress, is_cancelled):
    """Compute a genuine report; never sends private result data to a guest client.

    `job` must be a canonical posting obtained by the hosting server, not a client
    supplied description. `on_progress(stage, percent, flow_event=None)` may be
    sync or async. Flow events contain fixed codes and measured durations only;
    `is_cancelled()` is synchronous. The caller handles delivery and ownership.
    """
    backend = _load_backend()
    config = _configuration(backend)
    job_text = job.get("description") if isinstance(job, dict) else None
    if not isinstance(resume_text, str) or not resume_text.strip() or not isinstance(job_text, str) or not job_text.strip():
        raise ValueError("Analysis requires nonempty documents")
    if any("\x00" in text or backend.token_count(text) > config.max_document_tokens
           for text in (resume_text, job_text)):
        raise ValueError("Analysis document exceeds supported limits")
    created_at = datetime.now(timezone.utc)
    raw_llm = None

    def guard():
        if is_cancelled():
            raise asyncio.CancelledError()

    class CheckedLLM:
        async def parse(self, *args, **kwargs):
            guard()
            result = await raw_llm.parse(*args, **kwargs)
            guard()
            return result

        async def embed(self, *args, **kwargs):
            guard()
            result = await raw_llm.embed(*args, **kwargs)
            guard()
            return result

    latest_percent = 0
    flow_started = {}
    flow_states = {}

    async def progress(stage, percent, node=None, state=None, criterion=None):
        nonlocal latest_percent
        guard()
        latest_percent = max(latest_percent, min(100, int(percent)))
        event = None
        key = (node, criterion)
        if node and flow_states.get(key) != state:
            flow_states[key] = state
            if state == "running":
                flow_started[key] = time.monotonic()
            event = {"node": node, "state": state}
            if criterion:
                event["criterion"] = criterion
            if state == "complete" and key in flow_started:
                event["durationMs"] = max(0, (time.monotonic() - flow_started.pop(key)) * 1000)
        response = on_progress(stage, latest_percent, event) if event else on_progress(stage, latest_percent)
        if inspect.isawaitable(response):
            await response

    async def compute():
        guard()
        llm = CheckedLLM()
        await progress("parsing", 5, "parse_resume", "running")
        resume = await backend.parse_document(llm, resume_text, "resume")
        await progress("parsing", 8, "parse_resume", "complete")
        await progress("parsing", 8, "parse_job", "running")
        parsed_job = await backend.parse_document(llm, job_text, "job")
        await progress("parsing", 12, "parse_job", "complete")
        await progress("indexing", 12, "indexing", "running")
        text_chunks = backend.chunks(resume_text, config.chunk_tokens, config.chunk_overlap)
        guard()
        vectors = await llm.embed([row["content"] for row in text_chunks])
        if len(vectors) != len(text_chunks):
            raise ValueError("Invalid embedding result")
        await progress("indexing", 18, "indexing", "complete")
        by_code = {row[0]: row for row in backend.criteria}
        criterion_progress = {code: 0.0 for code in by_code}

        async def criterion_event(code, message, fraction, status="running"):
            if code == "all":
                # These callbacks surround the actual graph operations. A broad
                # progress percentage alone never proves validation or scoring.
                meaning = {
                    "전체 평가 결과 교차 검토 시작": ("validation", "running"),
                    "전체 평가 결과 교차 검토 완료": ("validation", "complete"),
                    "최종 점수 계산 시작": ("scoring", "running"),
                    "최종 점수 계산 완료": ("scoring", "complete"),
                }.get(message)
                if message.startswith("검토 지적 항목 ") and message.endswith("개 재평가 시작"):
                    meaning = ("validation", "running")
                elif message.startswith("검토 지적 항목 ") and message.endswith("개 재평가 완료"):
                    meaning = ("validation", "complete")
                if meaning and status == ("completed" if meaning[1] == "complete" else "running"):
                    await progress("validation", fraction * 100, *meaning)
                else:
                    await progress("validation", fraction * 100)
            else:
                criterion_progress[code] = max(criterion_progress[code], fraction)
                await progress("evaluation", 18 + 64 * sum(criterion_progress.values()) / len(criterion_progress),
                               "domain_" + code[0].lower(), "complete" if status == "completed" else "running", code)

        async def trace(state, code, result):
            guard()
            await criterion_event(code, "", 1.0, "completed")

        async def search(state, code):
            # Same query, embedding model, chunking and top-5 cosine ranking as
            # app.application.evaluation.execute; only persistence is omitted.
            query = await llm.embed([by_code[code][2] + " " + " ".join(parsed_job["technical_requirements"])])
            if len(query) != 1:
                raise ValueError("Invalid embedding result")
            return _vector_search(text_chunks, vectors, query[0])

        finance = job.get("company_context")
        if not isinstance(finance, dict):
            finance = {
                "status": "unavailable", "reason": "비회원 분석에 기업 재무자료가 제공되지 않았습니다.",
                "competitor_data_available": False,
            }
        state = {
            "run_id": run_id, "resume": resume, "job": parsed_job,
            "resume_text": resume_text, "job_text": job_text, "finance": finance,
            "chunks": text_chunks, "results": {}, "rechecks": 0,
            "as_of": created_at.astimezone(ZoneInfo("Asia/Seoul")).date().isoformat(),
        }
        graph = backend.engine(llm, trace, search, criterion_event).build(checkpointer=None)
        result = await graph.ainvoke(state, {"configurable": {"thread_id": run_id}, "recursion_limit": 15})
        guard()
        await progress("reporting", 94)
        report_text = backend.render(result)
        if not isinstance(report_text, str) or not report_text.strip():
            raise ValueError("Report rendering failed")
        completed_at = datetime.now(timezone.utc).isoformat()
        criteria = []
        for code, domain, name, weight, *_ in backend.criteria:
            item = result["results"][code]
            criteria.append({
                **item,
                "validation_status": "needs_review" if item["issues"] else "passed",
                "evaluation_criteria": {
                    "criterion_code": code, "name_ko": name,
                    "domain_code": domain, "weight": weight,
                },
            })
        output = {
            "run_id": run_id,
            "status": "partial" if result["scores"]["validation_status"] == "partial" else "completed",
            "report_text": report_text,
            "report_data": {
                "criteria": result["results"], "scoring_version": backend.version,
                "company_context": finance,
            },
            "scores": result["scores"], "criteria": criteria,
            "model_name": config.openai_model,
            "created_at": created_at.isoformat(), "completed_at": completed_at,
        }
        await progress("completed", 100)
        return output

    async def cancellation_watch():
        while True:
            guard()
            await asyncio.sleep(0.1)

    guard()
    raw_llm = backend.llm(config)
    task = asyncio.create_task(compute())
    watch = asyncio.create_task(cancellation_watch())
    try:
        async with asyncio.timeout(config.evaluation_timeout_seconds):
            done, _ = await asyncio.wait({task, watch}, return_when=asyncio.FIRST_COMPLETED)
            if watch in done:
                await watch
            guard()
            return await task
    finally:
        task.cancel()
        watch.cancel()
        await asyncio.gather(task, watch, return_exceptions=True)
        await raw_llm.close()
