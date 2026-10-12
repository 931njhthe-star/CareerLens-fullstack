from typing import Literal
from pydantic import BaseModel, Field


class UploadedResume(BaseModel):
    id: str
    parse_status: str
    title: str


class EvaluationStarted(BaseModel):
    run_id: str
    status: str
    status_url: str | None = None


class RunStatus(BaseModel):
    id: str
    status: Literal['queued','running','completed','partial','failed','cancelled']
    current_stage: str | None = None
    progress_percent: float
    started_at: str | None = None
    completed_at: str | None = None
    failure_reason: str | None = None


class CriterionView(BaseModel):
    score: float
    verdict: Literal['met','not_met']
    confidence: float | None
    reasoning_summary: str | None
    improvement_suggestion: str | None
    evidence: list[dict] = Field(default_factory=list)
    validation_status: str
    evaluation_criteria: dict
    comparison_basis: str = ''
    estimated: bool = False
    issues: list[str] = Field(default_factory=list)


class MatchResult(BaseModel):
    id: str
    run_id: str
    resume_completeness: float
    job_fit: float
    qualifications: float
    practical_competitiveness: float
    overall_score: float
    overall_formula: dict
    eligibility_status: Literal['met','not_met']
    validation_status: str
    created_at: str
    criteria: list[CriterionView]
    reports: list[dict]


class ReportView(BaseModel):
    id: str
    status: str
    report_text: str | None
    created_at: str
    completed_at: str | None
