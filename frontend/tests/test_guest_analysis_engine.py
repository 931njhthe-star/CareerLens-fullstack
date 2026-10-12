"""Actual team graph and scoring, synthetic provider responses; no model/DB calls."""

import asyncio
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import guest_analysis_engine as module


class Secret:
    def __init__(self, value="synthetic-not-a-key"):
        self.value = value

    def get_secret_value(self):
        return self.value


def configuration():
    return SimpleNamespace(
        openai_api_key=Secret(), embedding_dimensions=1536,
        chunk_tokens=600, chunk_overlap=80, openai_model="synthetic-model",
        evaluation_timeout_seconds=5,
        max_document_tokens=20000,
    )


RESUME = "직접 구현한 경험"
JOB = {"id": "canonical-posting", "description": "Python API 개발"}


class SyntheticLLM:
    instances = []
    fail = False
    conflict = False
    block = False

    def __init__(self, _config):
        self.closed = False
        self.queries = []
        self.calls = []
        self.instances.append(self)

    async def parse(self, schema, instruction, payload):
        self.calls.append(schema.__name__)
        if self.fail:
            raise ValueError("synthetic-provider-failure")
        if self.block:
            await asyncio.sleep(30)
        name = schema.__name__
        if name == "ParsedResume":
            return schema(
                skills=["Python"], careers=[], education=[], projects=[RESUME],
                explicit_no_employment=False, no_employment_evidence=[],
            )
        if name == "ParsedJob":
            return schema(
                title="Synthetic job", company_name="Synthetic company",
                responsibilities=["API 개발"], technical_requirements=["Python"],
                preferred_requirements=[], other_required_conditions=[],
                career_min_months=None, education_level=None,
                required_major=None, conditions_evidence=[],
            )
        if name == "CriticReview":
            return schema(affected_codes=["B1"] if self.conflict else [],
                          issues=["추가 확인"] if self.conflict else [])
        code = json.loads(payload.split("\n")[0])["criterion"][0]
        return schema(
            code=code, score=80, verdict="met", confidence=.5 if code.startswith("D") else .9,
            reasoning_summary="근거 확인", improvement_suggestion="",
            evidence=[{"source": "resume", "quote": RESUME}], comparison_basis="공고",
            estimated=code.startswith("D"), issues=[],
        )

    async def embed(self, texts):
        self.queries.extend(texts)
        return [[1.0, 0.0, 0.0] for _ in texts]

    async def close(self):
        self.closed = True


class VectorTests(unittest.TestCase):
    def test_cosine_ranking_matches_backend_metric_and_preserves_evidence_shape(self):
        rows = [{"content": str(i), "section": "evidence", "metadata": {"line_start": i}}
                for i in range(6)]
        result = module._vector_search(rows, [[0, 1], [1, 1], [8, 0], [-1, 0], [1, 2], [1, 4]], [1, 0])
        self.assertEqual([row["content"] for row in result], ["2", "1", "4", "5", "0"])
        self.assertEqual(result[0], {"content": "2", "section": "evidence", "metadata": {"line_start": 2}, "similarity": 1.0})

    def test_invalid_embeddings_fail_instead_of_silently_dropping_evidence(self):
        row = {"content": "text", "section": "section", "metadata": {}}
        for vectors, query in [([], [1]), ([[1, 2]], [1]), ([[0]], [1]), ([[float("nan")]], [1]), ([[1]], [0])]:
            with self.subTest(vectors=vectors, query=query), self.assertRaises(ValueError):
                module._vector_search([row], vectors, query)

    def test_missing_dependency_and_key_are_not_advertised_as_available(self):
        with patch.object(module, "_load_backend", side_effect=module.EngineUnavailable("unavailable")):
            self.assertFalse(module.engine_available())
        config = configuration()
        config.openai_api_key = Secret("")
        with patch.object(module, "_load_backend", return_value=SimpleNamespace(settings=lambda: config)):
            self.assertFalse(module.engine_available())
        with patch.object(module, "_load_backend", return_value=SimpleNamespace(settings=configuration)):
            self.assertTrue(module.engine_available())


class EngineTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.real = module._load_backend()
        except module.EngineUnavailable:
            raise unittest.SkipTest("Sibling team backend dependencies are not installed")

    def setUp(self):
        SyntheticLLM.instances = []
        SyntheticLLM.fail = False
        SyntheticLLM.conflict = False
        SyntheticLLM.block = False
        # Real parsing, graph, validation, score calculator and Markdown renderer.
        # Synthetic chunks avoid tokenizer cache/network initialization in tests.
        self.backend = SimpleNamespace(**vars(self.real))
        self.backend.settings = configuration
        self.backend.llm = SyntheticLLM
        self.backend.token_count = len
        self.backend.chunks = lambda text, *_: [{
            "content": text, "section": "본문", "metadata": {"line_start": 1},
            "chunk_index": 0, "source_hash": "synthetic",
        }]
        self.patch = patch.object(module, "_load_backend", return_value=self.backend)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    async def test_complete_report_uses_real_twelve_criteria_graph_and_scoring(self):
        events = []
        result = await module.run_analysis(RESUME, JOB, "guest-run", lambda *row: events.append(row), lambda: False)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["run_id"], "guest-run")
        self.assertEqual(len(result["criteria"]), 12)
        self.assertEqual(set(result["report_data"]["criteria"]), {row[0] for row in self.real.criteria})
        self.assertIn("# 이력서·채용공고 매칭 보고서", result["report_text"])
        self.assertEqual(result["scores"]["qualifications"], 100)
        self.assertAlmostEqual(result["scores"]["resume_completeness"], 80)
        self.assertEqual(result["criteria"][0]["evaluation_criteria"]["criterion_code"], "A1")
        self.assertEqual(result["report_data"]["company_context"]["status"], "unavailable")
        self.assertEqual(events[-1], ("completed", 100))
        self.assertEqual([row[1] for row in events], sorted(row[1] for row in events))
        self.assertGreater(len(SyntheticLLM.instances[0].queries), 1)
        self.assertTrue(SyntheticLLM.instances[0].closed)

    async def test_real_callbacks_emit_private_free_steps_and_never_claim_storage(self):
        events = []
        await module.run_analysis(RESUME, JOB, "PRIVATE_RUN", lambda *row: events.append(row), lambda: False)
        observations = [row[2] for row in events if len(row) == 3]
        for node in ["parse_resume", "parse_job", "indexing", "validation", "scoring"]:
            self.assertEqual([item["state"] for item in observations if item["node"] == node], ["running", "complete"])
        for code, *_ in self.real.criteria:
            rows = [item for item in observations if item.get("criterion") == code]
            self.assertEqual([item["state"] for item in rows], ["running", "complete"])
            self.assertGreaterEqual(rows[-1]["durationMs"], 0)
        self.assertTrue(all(set(item) <= {"node", "state", "criterion", "durationMs"} for item in observations))
        self.assertNotIn("PRIVATE_RUN", json.dumps(observations))
        self.assertNotIn("guest_store", {item["node"] for item in observations})

    async def test_partial_validation_is_not_changed_to_passed_and_async_progress_works(self):
        SyntheticLLM.conflict = True
        events = []

        async def progress(*row):
            events.append(row)

        result = await module.run_analysis(RESUME, JOB, "partial-run", progress, lambda: False)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["scores"]["validation_status"], "partial")
        self.assertEqual(events[-1], ("completed", 100))

    async def test_provider_failure_returns_no_completed_event_or_fabricated_report(self):
        SyntheticLLM.fail = True
        events = []
        with self.assertRaises(ValueError):
            await module.run_analysis(RESUME, JOB, "failed-run", lambda *row: events.append(row), lambda: False)
        self.assertNotIn(("completed", 100), events)
        self.assertTrue(SyntheticLLM.instances[0].closed)

    async def test_cancelled_before_start_makes_no_provider_instance(self):
        with self.assertRaises(asyncio.CancelledError):
            await module.run_analysis(RESUME, JOB, "cancelled", lambda *_: None, lambda: True)
        self.assertEqual(SyntheticLLM.instances, [])

    async def test_cancel_during_provider_call_stops_promptly_and_closes_client(self):
        SyntheticLLM.block = True
        cancelled = False
        task = asyncio.create_task(module.run_analysis(RESUME, JOB, "cancelled", lambda *_: None, lambda: cancelled))
        await asyncio.sleep(.02)
        cancelled = True
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=.5)
        self.assertTrue(SyntheticLLM.instances[0].closed)
        self.assertEqual(SyntheticLLM.instances[0].calls, ["ParsedResume"])

    async def test_empty_or_unverified_job_description_never_starts_model(self):
        with self.assertRaises(ValueError):
            await module.run_analysis(RESUME, {"title": "unverified"}, "invalid", lambda *_: None, lambda: False)
        self.assertEqual(SyntheticLLM.instances, [])

    async def test_document_token_limit_and_nul_fail_before_provider_initialization(self):
        for text in ("x" * 20001, "resume\x00text"):
            with self.subTest(text_length=len(text)), self.assertRaises(ValueError):
                await module.run_analysis(text, JOB, "invalid", lambda *_: None, lambda: False)
        self.assertEqual(SyntheticLLM.instances, [])


if __name__ == "__main__":
    unittest.main()
