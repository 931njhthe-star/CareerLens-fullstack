begin;

update public.criterion_results
set verdict = case
      when verdict = 'not_applicable' then 'met'
      else 'not_met'
    end,
    score = case
      when verdict = 'not_applicable' then 100
      when verdict = 'unknown' or verdict is null or score is null then 0
      else score
    end
where verdict in ('unknown', 'not_applicable')
   or verdict is null
   or score is null;

update public.match_results
set eligibility_status = case
      when eligibility_status = 'met' then 'met'
      else 'not_met'
    end,
    resume_completeness = coalesce(resume_completeness, 0),
    job_fit = coalesce(job_fit, 0),
    qualifications = coalesce(qualifications, 0),
    practical_competitiveness = coalesce(practical_competitiveness, 0),
    overall_score = coalesce(overall_score, 0)
where eligibility_status = 'unknown'
   or eligibility_status is null
   or resume_completeness is null
   or job_fit is null
   or qualifications is null
   or practical_competitiveness is null
   or overall_score is null;

alter table public.criterion_results
  drop constraint if exists criterion_results_verdict_check;
alter table public.criterion_results
  add constraint criterion_results_verdict_check
    check (verdict in ('met', 'not_met')),
  alter column verdict set not null,
  alter column score set not null;

alter table public.match_results
  drop constraint if exists match_results_eligibility_status_check;
alter table public.match_results
  add constraint match_results_eligibility_status_check
    check (eligibility_status in ('met', 'not_met')),
  alter column eligibility_status set not null,
  alter column resume_completeness set not null,
  alter column job_fit set not null,
  alter column qualifications set not null,
  alter column practical_competitiveness set not null,
  alter column overall_score set not null;

commit;
