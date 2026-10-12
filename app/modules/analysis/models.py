from typing import Literal
from pydantic import BaseModel, Field, model_validator


class Evidence(BaseModel):
    source: Literal['resume', 'job']
    quote: str


class Career(BaseModel):
    start: str = Field(description='YYYY-MM')
    end: str | None = Field(description='YYYY-MM; null only if explicitly ongoing')
    related: bool
    kind: Literal['employment', 'internship', 'education_project', 'other']
    evidence: list[Evidence]


class Education(BaseModel):
    level: Literal['high_school', 'associate', 'bachelor', 'master', 'doctorate']
    graduated: bool
    major: str | None
    evidence: list[Evidence]


class ParsedResume(BaseModel):
    skills: list[str]
    careers: list[Career]
    explicit_no_employment: bool
    no_employment_evidence: list[Evidence]
    education: list[Education]
    projects: list[str]


class ParsedJob(BaseModel):
    title: str
    company_name: str
    responsibilities: list[str]
    technical_requirements: list[str]
    preferred_requirements: list[str]
    other_required_conditions: list[str]
    career_min_months: int | None = Field(ge=0)
    education_level: Literal['high_school', 'associate', 'bachelor', 'master', 'doctorate'] | None
    required_major: str | None
    conditions_evidence: list[Evidence]


class CriterionResult(BaseModel):
    code: str
    score: float = Field(ge=0, le=100)
    verdict: Literal['met', 'not_met']
    confidence: float = Field(ge=0, le=1)
    reasoning_summary: str
    improvement_suggestion: str
    evidence: list[Evidence]
    comparison_basis: str
    estimated: bool
    issues: list[str]

    @model_validator(mode='before')
    @classmethod
    def normalize_legacy_verdicts(cls, value):
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        verdict = normalized.get('verdict')
        if verdict == 'not_applicable':
            normalized['verdict'] = 'met'
            normalized['score'] = 100
        elif verdict == 'unknown':
            normalized['verdict'] = 'not_met'
            normalized['score'] = 0
        elif normalized.get('score') is None:
            normalized['verdict'] = 'not_met'
            normalized['score'] = 0
        elif verdict == 'met' and normalized['score'] == 0:
            normalized['verdict'] = 'not_met'
        return normalized


class CriticReview(BaseModel):
    affected_codes: list[str]
    issues: list[str]
