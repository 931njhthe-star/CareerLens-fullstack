from datetime import date
import pytest
from app.modules.analysis.scoring.calculator import geometric, related_months, qualifications, calculate
from app.modules.analysis.models import ParsedResume, ParsedJob
from app.modules.analysis.scoring.rubric import CRITERIA


def resume(careers=None, **kwargs):
    return ParsedResume(skills=[], careers=careers or [], explicit_no_employment=False, no_employment_evidence=[], education=[], projects=[], **kwargs)


def job(**kwargs):
    return ParsedJob(title='job', company_name='company', responsibilities=[], technical_requirements=[], preferred_requirements=[], other_required_conditions=[],
                     career_min_months=kwargs.get('months'), education_level=None, required_major=None, conditions_evidence=[])


def test_geometric_reference():
    assert geometric([(82,.15,'met'),(78,.30,'met'),(25,.35,'not_met'),(35,.20,'met')]) == pytest.approx(44.9565598, abs=.000001)


def test_unknown_is_not_zero_and_exclusion_renormalizes():
    assert geometric([(None,.6,'unknown'),(100,.4,'met')]) is None
    assert geometric([(None,.6,'not_applicable'),(81,.4,'met')]) == pytest.approx(81)
    assert geometric([(0,.6,'not_met'),(100,.4,'met')]) == 0
    assert geometric([(None,1,'not_applicable')]) is None


def test_overlapping_careers_and_education_project():
    careers = [dict(start='2024-01',end='2024-12',related=True,kind='employment',evidence=[]),
               dict(start='2024-07',end='2025-06',related=True,kind='employment',evidence=[]),
               dict(start='2023-01',end='2023-12',related=True,kind='education_project',evidence=[])]
    assert related_months(resume(careers), date(2026,10,8)) == 18


def test_no_employment_and_unknown_differ():
    r = resume()
    assert qualifications('C1', r, job(months=24), date(2026,10,8)).score is None
    r.explicit_no_employment = True
    r.no_employment_evidence = [{'source': 'resume', 'quote': '경력 없음'}]
    assert qualifications('C1', r, job(months=24), date(2026,10,8)).score == 0


def test_no_other_requirements():
    assert qualifications('C3',resume(),job(),date(2026,10,8)).verdict == 'not_applicable'


def test_missing_criterion_rejected():
    with pytest.raises(ValueError): calculate({})


def test_invalid_future_career():
    r = resume([dict(start='2027-01',end='2027-03',related=True,kind='employment',evidence=[])])
    with pytest.raises(ValueError): related_months(r,date(2026,10,8))
