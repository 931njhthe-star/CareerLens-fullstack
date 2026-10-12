-- Resume & Job Match / Supabase PostgreSQL schema (22 tables, hardened workflow instrumentation)
-- Run in Supabase SQL Editor on a NEW project. Not a migration for an existing schema.
-- Assumptions: Supabase auth.users, storage.objects and extensions schema are available.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

-- Shared timestamp helper
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 1. User profile (credentials remain in auth.users)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Uploaded resumes. Raw PDF bytes belong in a private Storage bucket.
create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  title text not null default 'My resume',
  version integer not null default 1 check (version >= 1),
  storage_path text,
  original_text text,
  parsed_data jsonb not null default '{}'::jsonb,
  parse_status text not null default 'pending'
    check (parse_status in ('pending','processing','ready','failed')),
  parser_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_resumes_user on public.resumes(user_id,created_at desc);

-- 3. Companies, including one-or-more market listings
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text,
  description text,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.company_tickers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ticker text not null,
  exchange text,
  currency text,
  is_primary boolean not null default false,
  unique (ticker, exchange)
);
create index if not exists idx_tickers_company on public.company_tickers(company_id);

-- 4. Job postings (nullable company_id supports unlinked job ads)
create table if not exists public.job_postings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  title text not null,
  description text not null,
  responsibilities jsonb not null default '[]'::jsonb,
  requirements jsonb not null default '[]'::jsonb,
  preferred_requirements jsonb not null default '[]'::jsonb,
  career_min_months integer check (career_min_months is null or career_min_months >= 0),
  career_max_months integer check (career_max_months is null or career_max_months >= 0),
  education_level text,
  employment_type text,
  location text,
  source_name text,
  source_external_id text,
  source_url text,
  deadline date,
  published_at timestamptz,
  collected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (career_max_months is null or career_min_months is null or career_max_months >= career_min_months)
);
create index if not exists idx_jobs_company on public.job_postings(company_id);
create index if not exists idx_jobs_collected on public.job_postings(collected_at desc);
create unique index if not exists uq_jobs_source on public.job_postings(source_name,source_external_id)
  where source_name is not null and source_external_id is not null;

-- 5. Market/financial snapshots from Yahoo Finance (or other recorded sources)
create table if not exists public.company_financials (
  id uuid primary key default gen_random_uuid(),
  company_ticker_id uuid not null references public.company_tickers(id) on delete cascade,
  source text not null default 'yahoo_finance',
  statement_type text not null default 'income'
    check (statement_type in ('income','balance_sheet','cash_flow','summary')),
  period_type text not null check (period_type in ('annual','quarterly','ttm','snapshot')),
  period_end date not null,
  currency text,
  revenue numeric,
  operating_income numeric,
  net_income numeric,
  total_assets numeric,
  market_cap numeric,
  raw_data jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  unique (company_ticker_id,source,statement_type,period_type,period_end)
);
create index if not exists idx_financials_ticker_period on public.company_financials(company_ticker_id,period_end desc);

create table if not exists public.company_prices (
  id uuid primary key default gen_random_uuid(),
  company_ticker_id uuid not null references public.company_tickers(id) on delete cascade,
  price_date date not null,
  currency text,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  close_price numeric,
  adjusted_close numeric,
  volume bigint,
  source text not null default 'yahoo_finance',
  collected_at timestamptz not null default now(),
  unique(company_ticker_id,price_date,source)
);
create index if not exists idx_company_prices_date on public.company_prices(company_ticker_id,price_date desc);

-- 6. Semantic search: resume/job/company narrative chunks. '1536' must match embedding model.
-- Using explicit nullable FKs avoids orphaned cross-table polymorphic source_id references.
create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid references public.resumes(id) on delete cascade,
  job_posting_id uuid references public.job_postings(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  section text,
  content text not null,
  embedding extensions.vector(1536),
  embedding_model text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint exactly_one_chunk_source check (
    num_nonnulls(resume_id,job_posting_id,company_id) = 1
  )
);
create unique index if not exists uq_chunk_resume on public.document_chunks(resume_id,chunk_index) where resume_id is not null;
create unique index if not exists uq_chunk_job on public.document_chunks(job_posting_id,chunk_index) where job_posting_id is not null;
create unique index if not exists uq_chunk_company on public.document_chunks(company_id,chunk_index) where company_id is not null;
-- Create ANN index only after data volume grows and measure query patterns:
-- create index idx_chunks_hnsw on public.document_chunks using hnsw (embedding vector_cosine_ops);

-- 7. Four score domains + 12 weighted subcriteria: weights stored as explicit rubric version
create table if not exists public.evaluation_rubrics (
  id uuid primary key default gen_random_uuid(),
  rubric_version text not null unique,
  name text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.evaluation_criteria (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references public.evaluation_rubrics(id) on delete cascade,
  domain_code text not null check (domain_code in ('resume_completeness','job_fit','qualifications','practical_competitiveness')),
  criterion_code text not null,
  name_ko text not null,
  weight numeric(5,4) not null check (weight > 0 and weight <= 1),
  method_config jsonb not null default '{}'::jsonb,
  display_order smallint not null,
  unique (rubric_id,criterion_code)
);
create index if not exists idx_criteria_domain on public.evaluation_criteria(rubric_id,domain_code);

-- 8. Async evaluation task state: supports 4 domain workers and per-criterion retries
create table if not exists public.evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  resume_id uuid not null references public.resumes(id) on delete cascade,
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,
  rubric_id uuid not null references public.evaluation_rubrics(id),
  status text not null default 'queued'
    check (status in ('queued','running','completed','partial','failed','cancelled')),
  model_name text,
  failure_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_runs_user on public.evaluation_runs(user_id,created_at desc);

create table if not exists public.criterion_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.evaluation_runs(id) on delete cascade,
  criterion_id uuid not null references public.evaluation_criteria(id),
  score numeric(6,3) check (score between 0 and 100),
  verdict text check (verdict in ('met','not_met','unknown','not_applicable')),
  confidence numeric(5,4) check (confidence between 0 and 1),
  reasoning_summary text,
  improvement_suggestion text,
  evidence jsonb not null default '[]'::jsonb,
  applied_methods jsonb not null default '[]'::jsonb,
  validation_status text not null default 'pending'
    check (validation_status in ('pending','passed','needs_review','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  updated_at timestamptz not null default now(),
  unique(run_id,criterion_id)
);
create index if not exists idx_criterion_results_run on public.criterion_results(run_id);

-- 9. Exact audit of tool calls/feedback; do not store hidden chain-of-thought
create table if not exists public.evaluation_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.evaluation_runs(id) on delete cascade,
  criterion_id uuid references public.evaluation_criteria(id),
  event_type text not null check (event_type in ('retrieval','draft','self_refine','consistency','validation','retry','error')),
  attempt_number integer not null default 0,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_events_run on public.evaluation_events(run_id,created_at);

-- 10. Final domain/overall scored output + reports
create table if not exists public.match_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.evaluation_runs(id) on delete cascade,
  resume_completeness numeric(6,3) check (resume_completeness between 0 and 100),
  job_fit numeric(6,3) check (job_fit between 0 and 100),
  qualifications numeric(6,3) check (qualifications between 0 and 100),
  practical_competitiveness numeric(6,3) check (practical_competitiveness between 0 and 100),
  overall_score numeric(6,3) check (overall_score between 0 and 100),
  overall_formula jsonb not null default '{}'::jsonb,
  eligibility_status text check (eligibility_status in ('met','not_met','unknown')),
  validation_status text not null default 'pending'
    check (validation_status in ('pending','passed','partial','failed')),
  created_at timestamptz not null default now()
);
create table if not exists public.analysis_reports (
  id uuid primary key default gen_random_uuid(),
  match_result_id uuid not null references public.match_results(id) on delete cascade,
  report_data jsonb not null default '{}'::jsonb,
  report_text text,
  pdf_storage_path text,
  model_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_reports_match on public.analysis_reports(match_result_id);

-- 11. Mock applications (not real submissions to employers)
create table if not exists public.mock_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  resume_id uuid not null references public.resumes(id) on delete cascade,
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,
  evaluation_run_id uuid references public.evaluation_runs(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','evaluating','evaluated','cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists idx_mock_apps_user on public.mock_applications(user_id,created_at desc);


-- 12. Workflow observability and resumable test artifacts
-- Percent is weighted task completion, never an ETA.
alter table public.evaluation_runs
  add column if not exists current_stage text,
  add column if not exists progress_percent numeric(5,2) not null default 0
    check (progress_percent between 0 and 100),
  add column if not exists graph_thread_id text,
  add column if not exists input_snapshot jsonb not null default '{}'::jsonb;
create unique index if not exists uq_runs_graph_thread on public.evaluation_runs(graph_thread_id)
  where graph_thread_id is not null;

create table if not exists public.agent_executions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.evaluation_runs(id) on delete cascade,
  agent_type text not null check (agent_type in
    ('resume_completeness','job_fit','qualifications','practical_competitiveness','global_critic','report_generator')),
  attempt_number integer not null default 1 check (attempt_number >= 1),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','skipped')),
  progress_percent numeric(5,2) not null default 0 check (progress_percent between 0 and 100),
  started_at timestamptz,
  completed_at timestamptz,
  error_summary text,
  created_at timestamptz not null default now(),
  unique (run_id, agent_type, attempt_number)
);
create index if not exists idx_agent_executions_run on public.agent_executions(run_id,status);

create table if not exists public.node_executions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.evaluation_runs(id) on delete cascade,
  agent_execution_id uuid references public.agent_executions(id) on delete set null,
  criterion_id uuid references public.evaluation_criteria(id) on delete set null,
  node_name text not null,
  attempt_number integer not null default 1 check (attempt_number >= 1),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','skipped')),
  input_artifact_id uuid, -- added as an FK after intermediate_artifacts exists
  output_artifact_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms bigint check (duration_ms >= 0),
  error_summary text,
  created_at timestamptz not null default now()
);
create index if not exists idx_node_executions_run on public.node_executions(run_id,created_at);

-- Store structured *outputs*, feedback, retrieval IDs and reproducible inputs;
-- do not store private model chain-of-thought or credentials.
create table if not exists public.intermediate_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.evaluation_runs(id) on delete cascade,
  node_execution_id uuid references public.node_executions(id) on delete set null,
  criterion_id uuid references public.evaluation_criteria(id) on delete set null,
  artifact_type text not null,
  artifact_version integer not null default 1 check (artifact_version >= 1),
  content jsonb not null default '{}'::jsonb,
  storage_path text,
  content_hash text,
  schema_version text,
  is_test_fixture boolean not null default false,
  created_at timestamptz not null default now(),
  check (content <> '{}'::jsonb or storage_path is not null)
);
create index if not exists idx_artifacts_run on public.intermediate_artifacts(run_id,created_at);
create index if not exists idx_artifacts_node on public.intermediate_artifacts(node_execution_id);
create index if not exists idx_artifacts_criterion on public.intermediate_artifacts(run_id,criterion_id,artifact_type);

alter table public.node_executions
  add constraint fk_node_input_artifact foreign key (input_artifact_id)
    references public.intermediate_artifacts(id) on delete set null,
  add constraint fk_node_output_artifact foreign key (output_artifact_id)
    references public.intermediate_artifacts(id) on delete set null;

create table if not exists public.progress_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.evaluation_runs(id) on delete cascade,
  agent_execution_id uuid references public.agent_executions(id) on delete set null,
  node_execution_id uuid references public.node_executions(id) on delete set null,
  stage text not null,
  status text not null check (status in ('queued','running','completed','failed','skipped')),
  message text not null,
  progress_percent numeric(5,2) check (progress_percent between 0 and 100),
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_progress_events_run on public.progress_events(run_id,id);

-- Ownership integrity for jobs executed by a user
create or replace function public.check_run_resume_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.resumes r where r.id = new.resume_id and r.user_id = new.user_id
  ) then
    raise exception 'Resume does not belong to evaluation user';
  end if;
  return new;
end;
$$;
create trigger trg_run_resume_owner before insert or update of user_id,resume_id
on public.evaluation_runs for each row execute function public.check_run_resume_owner();

create or replace function public.check_mock_application_resume_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.resumes r where r.id = new.resume_id and r.user_id = new.user_id
  ) then
    raise exception 'Resume does not belong to application user';
  end if;
  return new;
end;
$$;
create trigger trg_mock_application_resume_owner before insert or update of user_id,resume_id
on public.mock_applications for each row execute function public.check_mock_application_resume_owner();

create trigger trg_profiles_updated before update on public.profiles
for each row execute function public.set_updated_at();
create trigger trg_resumes_updated before update on public.resumes
for each row execute function public.set_updated_at();
create trigger trg_companies_updated before update on public.companies
for each row execute function public.set_updated_at();
create trigger trg_jobs_updated before update on public.job_postings
for each row execute function public.set_updated_at();
create trigger trg_runs_updated before update on public.evaluation_runs
for each row execute function public.set_updated_at();
create trigger trg_criterion_results_updated before update on public.criterion_results
for each row execute function public.set_updated_at();


-- 13. Reproducibility, test runs, lineage, model versions (enhancements)
alter table public.evaluation_runs
  add column if not exists run_mode text not null default 'production'
    check (run_mode in ('production','test','replay','resume')),
  add column if not exists parent_run_id uuid references public.evaluation_runs(id) on delete set null,
  add column if not exists prompt_version text,
  add column if not exists scoring_version text,
  add column if not exists embedding_model text,
  add column if not exists workflow_version text;
create index if not exists idx_runs_parent on public.evaluation_runs(parent_run_id);

alter table public.node_executions
  add column if not exists retry_reason text,
  add column if not exists parent_node_execution_id uuid references public.node_executions(id) on delete set null,
  add column if not exists node_version text,
  add column if not exists model_name text,
  add column if not exists token_usage jsonb not null default '{}'::jsonb;

alter table public.intermediate_artifacts
  add column if not exists parent_artifact_id uuid references public.intermediate_artifacts(id) on delete set null,
  add column if not exists input_hash text,
  add column if not exists producer_version text,
  add column if not exists source_snapshot_id uuid;
create index if not exists idx_artifact_parent on public.intermediate_artifacts(parent_artifact_id);

-- Immutable input payload/reference used by a specific evaluation run.
-- For PII, prefer content hashes + storage_path to repeated raw JSON.
create table if not exists public.evaluation_input_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.evaluation_runs(id) on delete cascade,
  resume_id uuid not null references public.resumes(id),
  job_posting_id uuid not null references public.job_postings(id),
  rubric_id uuid not null references public.evaluation_rubrics(id),
  resume_version integer not null,
  resume_hash text not null,
  job_hash text not null,
  finance_as_of timestamptz,
  financial_snapshot jsonb not null default '{}'::jsonb,
  input_manifest jsonb not null default '{}'::jsonb,
  storage_path text,
  snapshot_hash text not null,
  created_at timestamptz not null default now(),
  check (length(snapshot_hash) > 0)
);
create index if not exists idx_snapshots_hash on public.evaluation_input_snapshots(snapshot_hash);

alter table public.intermediate_artifacts
  add constraint fk_artifact_snapshot foreign key (source_snapshot_id)
  references public.evaluation_input_snapshots(id) on delete set null;

-- Global Critic and deterministic checks: issue lifecycle and affected criterion.
create table if not exists public.validation_issues (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.evaluation_runs(id) on delete cascade,
  criterion_id uuid references public.evaluation_criteria(id) on delete set null,
  node_execution_id uuid references public.node_executions(id) on delete set null,
  issue_type text not null check (issue_type in
    ('missing_evidence','conflicting_evidence','score_error','cross_domain_conflict','invalid_output','other')),
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  description text not null,
  resolution_status text not null default 'open' check (resolution_status in ('open','rechecking','resolved','accepted_risk')),
  source_artifact_id uuid references public.intermediate_artifacts(id) on delete set null,
  resolved_artifact_id uuid references public.intermediate_artifacts(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_validation_issues_run on public.validation_issues(run_id,resolution_status);

-- Operational policy: client sees public progress, NOT node inputs and raw debug artifacts.
-- Keep application authorization in the backend for test/replay/resume runs.

-- Seed rubric and exact 12 weighted criteria; rerun safe via ON CONFLICT
insert into public.evaluation_rubrics (rubric_version,name,is_active)
values ('v1','Four-domain resume-job evaluation',true)
on conflict (rubric_version) do update set name=excluded.name;

insert into public.evaluation_criteria (rubric_id,domain_code,criterion_code,name_ko,weight,method_config,display_order)
select r.id,v.domain_code,v.criterion_code,v.name_ko,v.weight,v.method_config::jsonb,v.display_order
from public.evaluation_rubrics r
cross join (values
 ('resume_completeness','A1','경험 설명의 구체성',0.40,'{"cot":"primary","react":"none","self_consistency":"none","self_refine":"primary"}',1),
 ('resume_completeness','A2','성과 근거의 명확성',0.35,'{"cot":"primary","react":"conditional","self_consistency":"none","self_refine":"primary"}',2),
 ('resume_completeness','A3','구성과 가독성',0.25,'{"cot":"conditional","react":"none","self_consistency":"none","self_refine":"conditional"}',3),
 ('job_fit','B1','핵심 기술 일치도',0.45,'{"cot":"primary","react":"primary","self_consistency":"conditional","self_refine":"conditional"}',4),
 ('job_fit','B2','담당 업무 연관성',0.40,'{"cot":"primary","react":"primary","self_consistency":"conditional","self_refine":"primary"}',5),
 ('job_fit','B3','우대 역량 부합도',0.15,'{"cot":"primary","react":"conditional","self_consistency":"none","self_refine":"conditional"}',6),
 ('qualifications','C1','관련 경력 충족도',0.60,'{"cot":"conditional","react":"none","self_consistency":"none","self_refine":"none"}',7),
 ('qualifications','C2','학력·전공 충족도',0.25,'{"cot":"conditional","react":"none","self_consistency":"none","self_refine":"none"}',8),
 ('qualifications','C3','기타 필수조건 충족도',0.15,'{"cot":"conditional","react":"conditional","self_consistency":"none","self_refine":"conditional"}',9),
 ('practical_competitiveness','D1','업무 규모·난도 경쟁력',0.35,'{"cot":"primary","react":"conditional","self_consistency":"primary","self_refine":"primary"}',10),
 ('practical_competitiveness','D2','운영·문제 해결 경쟁력',0.35,'{"cot":"primary","react":"conditional","self_consistency":"conditional","self_refine":"primary"}',11),
 ('practical_competitiveness','D3','역할·책임 수준 경쟁력',0.30,'{"cot":"primary","react":"conditional","self_consistency":"primary","self_refine":"primary"}',12)
) as v(domain_code,criterion_code,name_ko,weight,method_config,display_order)
where r.rubric_version = 'v1'
on conflict (rubric_id,criterion_code) do update set
name_ko=excluded.name_ko, weight=excluded.weight,
method_config=excluded.method_config, display_order=excluded.display_order;

-- RLS on ALL application tables. Server-side job ingestion/evaluation: use service_role securely.
alter table public.profiles enable row level security;
alter table public.resumes enable row level security;
alter table public.companies enable row level security;
alter table public.company_tickers enable row level security;
alter table public.job_postings enable row level security;
alter table public.company_financials enable row level security;
alter table public.company_prices enable row level security;
alter table public.document_chunks enable row level security;
alter table public.evaluation_rubrics enable row level security;
alter table public.evaluation_criteria enable row level security;
alter table public.evaluation_runs enable row level security;
alter table public.criterion_results enable row level security;
alter table public.evaluation_events enable row level security;
alter table public.match_results enable row level security;
alter table public.analysis_reports enable row level security;
alter table public.mock_applications enable row level security;
alter table public.agent_executions enable row level security;
alter table public.node_executions enable row level security;
alter table public.intermediate_artifacts enable row level security;
alter table public.progress_events enable row level security;
alter table public.evaluation_input_snapshots enable row level security;
alter table public.validation_issues enable row level security;

create policy profiles_owner_select on public.profiles for select to authenticated using (user_id=(select auth.uid()));
create policy profiles_owner_insert on public.profiles for insert to authenticated with check (user_id=(select auth.uid()));
create policy profiles_owner_update on public.profiles for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy resumes_owner_select on public.resumes for select to authenticated using (user_id=(select auth.uid()));
create policy resumes_owner_insert on public.resumes for insert to authenticated with check (user_id=(select auth.uid()));
create policy resumes_owner_update on public.resumes for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy resumes_owner_delete on public.resumes for delete to authenticated using (user_id=(select auth.uid()));

-- Shared reference tables are readable to authenticated users, writable only by trusted server.
create policy companies_read on public.companies for select to authenticated using (true);
create policy tickers_read on public.company_tickers for select to authenticated using (true);
create policy jobs_read on public.job_postings for select to authenticated using (true);
create policy financials_read on public.company_financials for select to authenticated using (true);
create policy prices_read on public.company_prices for select to authenticated using (true);
create policy rubrics_read on public.evaluation_rubrics for select to authenticated using (true);
create policy criteria_read on public.evaluation_criteria for select to authenticated using (true);

-- Explicitly limit chunk reads to their parent visibility; insert/update by trusted server only.
create policy chunks_read on public.document_chunks for select to authenticated using (
  (resume_id is not null and exists (
    select 1 from public.resumes r where r.id = resume_id and r.user_id = (select auth.uid())
  )) or job_posting_id is not null or company_id is not null
);

create policy runs_owner_read on public.evaluation_runs for select to authenticated using (user_id=(select auth.uid()));
create policy criterion_results_owner_read on public.criterion_results for select to authenticated using (
  exists (select 1 from public.evaluation_runs r where r.id=run_id and r.user_id=(select auth.uid()))
);
create policy events_owner_read on public.evaluation_events for select to authenticated using (
  exists (select 1 from public.evaluation_runs r where r.id=run_id and r.user_id=(select auth.uid()))
);
create policy matches_owner_read on public.match_results for select to authenticated using (
  exists (select 1 from public.evaluation_runs r where r.id=run_id and r.user_id=(select auth.uid()))
);
create policy reports_owner_read on public.analysis_reports for select to authenticated using (
  exists (select 1 from public.match_results m join public.evaluation_runs r on r.id=m.run_id
          where m.id=match_result_id and r.user_id=(select auth.uid()))
);
create policy mock_apps_owner_read on public.mock_applications for select to authenticated using (user_id=(select auth.uid()));
create policy mock_apps_owner_insert on public.mock_applications for insert to authenticated with check (user_id=(select auth.uid()));
create policy mock_apps_owner_update on public.mock_applications for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy mock_apps_owner_delete on public.mock_applications for delete to authenticated using (user_id=(select auth.uid()));

-- Workflow execution writes belong to trusted server workers, not the browser.
create policy agent_executions_owner_read on public.agent_executions for select to authenticated using (
  exists (select 1 from public.evaluation_runs r where r.id=run_id and r.user_id=(select auth.uid()))
);
create policy node_executions_owner_read on public.node_executions for select to authenticated using (
  exists (select 1 from public.evaluation_runs r where r.id=run_id and r.user_id=(select auth.uid()))
);
-- Intermediate node data may contain PII. Read through authenticated owner check only.
create policy artifacts_owner_read on public.intermediate_artifacts for select to authenticated using (
  exists (select 1 from public.evaluation_runs r where r.id=run_id and r.user_id=(select auth.uid()))
);
create policy progress_owner_read on public.progress_events for select to authenticated using (
  exists (select 1 from public.evaluation_runs r where r.id=run_id and r.user_id=(select auth.uid()))
);
-- Input snapshots and Critic findings remain server-only by default (no authenticated SELECT policy).
-- Backend service_role can access these; browser clients should query sanitized API responses.


-- Private Storage buckets. User path convention: <auth.uid()>/<filename>
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('resume-files','resume-files',false,10485760,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('report-files','report-files',false,20971520,array['application/pdf'])
on conflict (id) do nothing;

create policy resume_files_read on storage.objects for select to authenticated
using (bucket_id='resume-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy resume_files_insert on storage.objects for insert to authenticated
with check (bucket_id='resume-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy resume_files_update on storage.objects for update to authenticated
using (bucket_id='resume-files' and (storage.foldername(name))[1]=(select auth.uid())::text)
with check (bucket_id='resume-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy resume_files_delete on storage.objects for delete to authenticated
using (bucket_id='resume-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy report_files_read on storage.objects for select to authenticated
using (bucket_id='report-files' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- After execution: add per-user profile row at sign-up using server code; do not expose service_role key.
-- Important: catalog read policies assume job postings and finance data are shared/public content.

-- LangGraph PostgresSaver checkpoint tables are managed by the checkpoint library's setup().
-- Configure PostgresSaver with a dedicated backend connection; do NOT expose checkpoint tables in Data API.
-- Avoid exposing raw intermediate_artifacts to browser UI; progress_events is the preferred UI feed.


-- ==============================================================
-- V4 HARDENING. Applies to NEW projects as part of this full script.
-- ==============================================================

-- Immutable, reproducible input payloads. Do not keep secrets in snapshots.
-- These JSON values are frozen copies taken at evaluation time, not live pointers.
alter table public.evaluation_input_snapshots
  add column resume_snapshot jsonb not null default '{}'::jsonb,
  add column job_snapshot jsonb not null default '{}'::jsonb,
  add column model_config_snapshot jsonb not null default '{}'::jsonb,
  add column prompt_config_snapshot jsonb not null default '{}'::jsonb,
  add column retention_until timestamptz;

-- A run must reference its user's resume, and rubric must agree with snapshot.
create or replace function public.validate_evaluation_snapshot()
returns trigger language plpgsql set search_path = '' as $$
declare r record;
begin
  select resume_id,job_posting_id,rubric_id into r
  from public.evaluation_runs where id=new.run_id;
  if not found or new.resume_id is distinct from r.resume_id
    or new.job_posting_id is distinct from r.job_posting_id
    or new.rubric_id is distinct from r.rubric_id then
    raise exception 'Input snapshot references do not match evaluation run';
  end if;
  if new.resume_snapshot = '{}'::jsonb or new.job_snapshot = '{}'::jsonb then
    raise exception 'Input snapshots must contain reproducible data';
  end if;
  return new;
end;
$$;
create trigger trg_validate_snapshot before insert or update on public.evaluation_input_snapshots
for each row execute function public.validate_evaluation_snapshot();

create or replace function public.prevent_immutable_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Immutable record: insert a new version or delete under retention policy';
end;
$$;
create trigger trg_immutable_snapshot before update on public.evaluation_input_snapshots
for each row execute function public.prevent_immutable_update();
create trigger trg_immutable_artifact before update on public.intermediate_artifacts
for each row execute function public.prevent_immutable_update();

-- Generic run-scoped FK verification for multi-table execution provenance.
-- Triggers are used because lineage spans multiple optional relations.
create or replace function public.check_execution_lineage()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'node_executions' then
    if new.agent_execution_id is not null and not exists
      (select 1 from public.agent_executions a where a.id=new.agent_execution_id and a.run_id=new.run_id) then
      raise exception 'Agent execution belongs to another run'; end if;
    if new.input_artifact_id is not null and not exists
      (select 1 from public.intermediate_artifacts a where a.id=new.input_artifact_id and a.run_id=new.run_id) then
      raise exception 'Input artifact belongs to another run'; end if;
    if new.output_artifact_id is not null and not exists
      (select 1 from public.intermediate_artifacts a where a.id=new.output_artifact_id and a.run_id=new.run_id) then
      raise exception 'Output artifact belongs to another run'; end if;
    if new.parent_node_execution_id is not null and not exists
      (select 1 from public.node_executions n where n.id=new.parent_node_execution_id and n.run_id=new.run_id) then
      raise exception 'Parent node belongs to another run'; end if;
  elsif tg_table_name = 'intermediate_artifacts' then
    if new.node_execution_id is not null and not exists
      (select 1 from public.node_executions n where n.id=new.node_execution_id and n.run_id=new.run_id) then
      raise exception 'Artifact node belongs to another run'; end if;
    if new.parent_artifact_id is not null and not exists
      (select 1 from public.intermediate_artifacts a where a.id=new.parent_artifact_id and a.run_id=new.run_id) then
      raise exception 'Parent artifact belongs to another run'; end if;
    if new.source_snapshot_id is not null and not exists
      (select 1 from public.evaluation_input_snapshots s where s.id=new.source_snapshot_id and s.run_id=new.run_id) then
      raise exception 'Snapshot belongs to another run'; end if;
  elsif tg_table_name = 'progress_events' then
    if new.agent_execution_id is not null and not exists
      (select 1 from public.agent_executions a where a.id=new.agent_execution_id and a.run_id=new.run_id) then
      raise exception 'Progress agent belongs to another run'; end if;
    if new.node_execution_id is not null and not exists
      (select 1 from public.node_executions n where n.id=new.node_execution_id and n.run_id=new.run_id) then
      raise exception 'Progress node belongs to another run'; end if;
  elsif tg_table_name = 'validation_issues' then
    if new.node_execution_id is not null and not exists
      (select 1 from public.node_executions n where n.id=new.node_execution_id and n.run_id=new.run_id) then
      raise exception 'Issue node belongs to another run'; end if;
    if new.source_artifact_id is not null and not exists
      (select 1 from public.intermediate_artifacts a where a.id=new.source_artifact_id and a.run_id=new.run_id) then
      raise exception 'Issue source belongs to another run'; end if;
    if new.resolved_artifact_id is not null and not exists
      (select 1 from public.intermediate_artifacts a where a.id=new.resolved_artifact_id and a.run_id=new.run_id) then
      raise exception 'Issue resolution belongs to another run'; end if;
  end if;
  return new;
end;
$$;
create trigger trg_lineage_node before insert or update on public.node_executions
for each row execute function public.check_execution_lineage();
create trigger trg_lineage_artifact before insert on public.intermediate_artifacts
for each row execute function public.check_execution_lineage();
create trigger trg_lineage_progress before insert or update on public.progress_events
for each row execute function public.check_execution_lineage();
create trigger trg_lineage_issue before insert or update on public.validation_issues
for each row execute function public.check_execution_lineage();

-- Criterion must be from the selected rubric, not another scoring version.
create or replace function public.check_criterion_rubric()
returns trigger language plpgsql set search_path = '' as $$
declare expected_rubric uuid;
begin
  select rubric_id into expected_rubric from public.evaluation_runs where id=new.run_id;
  if not exists(select 1 from public.evaluation_criteria c
       where c.id=new.criterion_id and c.rubric_id=expected_rubric) then
    raise exception 'Criterion rubric does not match evaluation run rubric';
  end if;
  return new;
end;
$$;
create trigger trg_result_criterion before insert or update on public.criterion_results
for each row execute function public.check_criterion_rubric();

alter table public.criterion_results
  add column final_artifact_id uuid references public.intermediate_artifacts(id) on delete set null,
  add column finalized_at timestamptz;
create or replace function public.check_result_artifact()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.final_artifact_id is not null and not exists
     (select 1 from public.intermediate_artifacts a
      where a.id=new.final_artifact_id and a.run_id=new.run_id
      and a.criterion_id=new.criterion_id) then
    raise exception 'Final result artifact must belong to same run and criterion';
  end if;
  return new;
end;
$$;
create trigger trg_result_artifact before insert or update on public.criterion_results
for each row execute function public.check_result_artifact();

-- Idempotent submissions and protected retries. Enforcement of leases/timeouts
-- and compare-and-set updates remains in worker transactions.
alter table public.evaluation_runs
  add column idempotency_key text,
  add column input_fingerprint text;
create unique index uq_runs_user_idempotency on public.evaluation_runs(user_id,idempotency_key)
  where idempotency_key is not null;
alter table public.node_executions
  add column execution_key text,
  add column worker_id text,
  add column lease_expires_at timestamptz,
  add column heartbeat_at timestamptz;
create unique index uq_node_execution_key on public.node_executions(run_id,execution_key)
  where execution_key is not null;
create index idx_nodes_lease on public.node_executions(status,lease_expires_at)
  where status='running';

-- Prevent retroactive changes to published scoring criteria (new rubric instead).
create trigger trg_rubric_immutable before update or delete on public.evaluation_criteria
for each row execute function public.prevent_immutable_update();

-- Version-safe embeddings: prevent mixing different embedding models/dimensions
-- in queries; application must filter by model and source revision.
alter table public.document_chunks
  add column source_hash text,
  add column embedding_version text,
  add column indexing_status text not null default 'ready'
    check (indexing_status in ('pending','ready','failed'));
create index idx_chunks_embedding_version on public.document_chunks(embedding_model,embedding_version);

-- Report lifecycle is independent from evaluation completion.
alter table public.analysis_reports
  add column status text not null default 'queued'
    check (status in ('queued','generating','validating','rendering_pdf','completed','failed')),
  add column generation_error text,
  add column completed_at timestamptz;

-- Remove browser access to sensitive developer traces. Trusted backend only.
drop policy if exists events_owner_read on public.evaluation_events;
drop policy if exists agent_executions_owner_read on public.agent_executions;
drop policy if exists node_executions_owner_read on public.node_executions;
drop policy if exists artifacts_owner_read on public.intermediate_artifacts;
-- Keep the run's public-friendly progress events separately readable.
-- These tables are also revoked at the SQL privilege layer.
revoke all on public.evaluation_events,public.agent_executions,
  public.node_executions,public.intermediate_artifacts,
  public.evaluation_input_snapshots,public.validation_issues from anon,authenticated;

-- Production policy: service role key only in backend. Snapshot/artifact access
-- must be audited and purged when user erasure/retention policy requires it.
-- Checkpoint tables (PostgresSaver.setup) must use a private schema/connection.
