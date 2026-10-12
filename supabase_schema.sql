--
-- PostgreSQL database dump
--

\restrict HcXg1YZEbGmrJ8QBLJgYO52p4sXiuFfYN49DXbTrLopJ3bdMHV1Bya4xnU3YJ42

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: check_criterion_rubric(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_criterion_rubric() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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


--
-- Name: check_execution_lineage(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_execution_lineage() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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


--
-- Name: check_mock_application_resume_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_mock_application_resume_owner() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.resumes r where r.id = new.resume_id and r.user_id = new.user_id
  ) then
    raise exception 'Resume does not belong to application user';
  end if;
  return new;
end;
$$;


--
-- Name: check_result_artifact(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_result_artifact() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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


--
-- Name: check_run_resume_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_run_resume_owner() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.resumes r where r.id = new.resume_id and r.user_id = new.user_id
  ) then
    raise exception 'Resume does not belong to evaluation user';
  end if;
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: evaluation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    resume_id uuid NOT NULL,
    job_posting_id uuid NOT NULL,
    rubric_id uuid NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    model_name text,
    failure_reason text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    current_stage text,
    progress_percent numeric(5,2) DEFAULT 0 NOT NULL,
    graph_thread_id text,
    input_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    run_mode text DEFAULT 'production'::text NOT NULL,
    parent_run_id uuid,
    prompt_version text,
    scoring_version text,
    embedding_model text,
    workflow_version text,
    idempotency_key text,
    input_fingerprint text,
    worker_id text,
    lease_expires_at timestamp with time zone,
    recovery_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT evaluation_runs_progress_percent_check CHECK (((progress_percent >= (0)::numeric) AND (progress_percent <= (100)::numeric))),
    CONSTRAINT evaluation_runs_run_mode_check CHECK ((run_mode = ANY (ARRAY['production'::text, 'test'::text, 'replay'::text, 'resume'::text]))),
    CONSTRAINT evaluation_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'partial'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: claim_evaluation(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_evaluation(p_worker text, p_lease_seconds integer DEFAULT 180) RETURNS SETOF public.evaluation_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare picked uuid;
begin
  -- A crashed worker gets one bounded recovery. The workflow replays frozen inputs.
  update public.evaluation_runs set status='failed', failure_reason='Worker recovery limit reached',completed_at=now()
  where status='running' and lease_expires_at < now() and recovery_count >= 1;
  select id into picked from public.evaluation_runs
  where status='queued' or (status='running' and lease_expires_at < now() and recovery_count < 1)
  order by created_at for update skip locked limit 1;
  if picked is not null then
    return query update public.evaluation_runs set worker_id=p_worker,
      recovery_count=recovery_count + case when status='running' then 1 else 0 end,
      status='running', started_at=coalesce(started_at,now()),
      lease_expires_at=now()+make_interval(secs=>greatest(30,least(p_lease_seconds,900)))
    where id=picked returning *;
  end if;
end $$;


--
-- Name: create_evaluation(uuid, uuid, uuid, uuid, text, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_evaluation(p_user uuid, p_resume uuid, p_job uuid, p_rubric uuid, p_key text, p_fingerprint text, p_snapshot jsonb, p_model text) RETURNS SETOF public.evaluation_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  new_run public.evaluation_runs;
  existing public.evaluation_runs;
  previous_run record;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  if not exists (
    select 1 from public.resumes
    where id = p_resume and user_id = p_user and parse_status = 'ready'
  ) then
    raise exception 'Resume unavailable';
  end if;
  if not exists (select 1 from public.job_postings where id = p_job) then
    raise exception 'Job unavailable';
  end if;

  if p_key is not null then
    select * into existing
    from public.evaluation_runs
    where user_id = p_user and idempotency_key = p_key;
    if found then
      if existing.input_fingerprint is distinct from p_fingerprint then
        raise exception 'Idempotency key reused with different input';
      end if;
      return next existing;
      return;
    end if;
  end if;

  for previous_run in
    update public.evaluation_runs
    set status = 'cancelled',
        failure_reason = 'Superseded by a newer evaluation',
        completed_at = now(),
        lease_expires_at = null
    where user_id = p_user and status in ('queued', 'running')
    returning id, progress_percent
  loop
    insert into public.progress_events (
      run_id, stage, status, message, progress_percent
    ) values (
      previous_run.id, 'cancelled', 'skipped',
      '새 평가 요청으로 이전 평가가 취소되었습니다.',
      previous_run.progress_percent
    );
  end loop;

  insert into public.evaluation_runs (
    user_id, resume_id, job_posting_id, rubric_id, model_name,
    idempotency_key, input_fingerprint, graph_thread_id,
    scoring_version, prompt_version, workflow_version, embedding_model
  ) values (
    p_user, p_resume, p_job, p_rubric, p_model, p_key, p_fingerprint,
    extensions.gen_random_uuid()::text,
    'career-lens-v1', 'career-lens-v1', 'career-lens-v1',
    'text-embedding-3-small'
  ) returning * into new_run;

  insert into public.evaluation_input_snapshots (
    run_id, resume_id, job_posting_id, rubric_id, resume_version,
    resume_hash, job_hash, snapshot_hash, resume_snapshot, job_snapshot,
    financial_snapshot, model_config_snapshot, prompt_config_snapshot,
    input_manifest
  ) values (
    new_run.id, p_resume, p_job, p_rubric,
    (p_snapshot->'resume'->>'version')::integer,
    p_snapshot->>'resume_hash', p_snapshot->>'job_hash', p_fingerprint,
    p_snapshot->'resume', p_snapshot->'job',
    coalesce(p_snapshot->'finance', '{}'::jsonb),
    p_snapshot->'model_config',
    jsonb_build_object('version', 'career-lens-v1'),
    jsonb_build_object('scoring_version', 'career-lens-v1')
  );

  return next new_run;
end
$$;


--
-- Name: get_evaluation_performance(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_evaluation_performance(p_days integer DEFAULT 30, p_run_limit integer DEFAULT 100) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with selected_runs as materialized (
    select r.id, r.status, r.created_at
    from public.evaluation_runs r
    where r.created_at >= now() - make_interval(days => greatest(1, least(p_days, 90)))
    order by r.created_at desc
    limit greatest(1, least(p_run_limit, 200))
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'run_count', (select count(*) from selected_runs),
      'avg_total_ms', (
        select round(avg(t.duration_ms)::numeric, 1)
        from public.evaluation_stage_timings t
        where t.stage = 'evaluation_total'
          and t.run_id in (select id from selected_runs)
      ),
      'p95_total_ms', (
        select round((percentile_cont(0.95) within group (order by t.duration_ms))::numeric, 1)
        from public.evaluation_stage_timings t
        where t.stage = 'evaluation_total'
          and t.run_id in (select id from selected_runs)
      )
    ),
    'stages', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.stage)
      from (
        select t.stage, count(*) as sample_count,
          round(avg(t.duration_ms)::numeric, 1) as avg_ms,
          round((percentile_cont(0.5) within group (order by t.duration_ms))::numeric, 1) as p50_ms,
          round((percentile_cont(0.95) within group (order by t.duration_ms))::numeric, 1) as p95_ms,
          max(t.duration_ms) as max_ms
        from public.evaluation_stage_timings t
        where t.run_id in (select id from selected_runs)
        group by t.stage
      ) s
    ), '[]'::jsonb),
    'runs', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from (
        select sr.id, sr.status, sr.created_at,
          (select t.duration_ms from public.evaluation_stage_timings t
           where t.run_id = sr.id and t.stage = 'evaluation_total'
           order by t.created_at desc limit 1) as total_ms,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'stage', t.stage, 'criterion_code', t.criterion_code,
              'status', t.status, 'duration_ms', t.duration_ms
            ) order by t.started_at, t.id)
            from public.evaluation_stage_timings t where t.run_id = sr.id
          ), '[]'::jsonb) as stages
        from selected_runs sr
      ) r
    ), '[]'::jsonb)
  );
$$;


--
-- Name: prevent_immutable_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_immutable_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'Immutable record: insert a new version or delete under retention policy';
end;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: search_resume_chunks(uuid, text, text, extensions.vector, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_resume_chunks(p_resume_id uuid, p_source_hash text, p_model text, p_query extensions.vector, p_limit integer DEFAULT 5) RETURNS TABLE(content text, section text, metadata jsonb, similarity double precision)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select c.content,c.section,c.metadata,1-(c.embedding operator(extensions.<=>) p_query)
  from public.document_chunks c
  where c.resume_id=p_resume_id and c.source_hash=p_source_hash and c.embedding_model=p_model
    and c.embedding_version='v1' and c.indexing_status='ready' and c.embedding is not null
  order by c.embedding operator(extensions.<=>) p_query limit greatest(1,least(p_limit,20));
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: update_evaluation_progress(uuid, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_evaluation_progress(p_run uuid, p_stage text, p_percent numeric) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
 update public.evaluation_runs set
   current_stage=case when p_percent>=progress_percent then p_stage else current_stage end,
   progress_percent=greatest(progress_percent,least(100,greatest(0,p_percent)))
 where id=p_run and status='running';
$$;


--
-- Name: validate_evaluation_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_evaluation_snapshot() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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


--
-- Name: agent_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    agent_type text NOT NULL,
    attempt_number integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    progress_percent numeric(5,2) DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_summary text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_executions_agent_type_check CHECK ((agent_type = ANY (ARRAY['resume_completeness'::text, 'job_fit'::text, 'qualifications'::text, 'practical_competitiveness'::text, 'global_critic'::text, 'report_generator'::text]))),
    CONSTRAINT agent_executions_attempt_number_check CHECK ((attempt_number >= 1)),
    CONSTRAINT agent_executions_progress_percent_check CHECK (((progress_percent >= (0)::numeric) AND (progress_percent <= (100)::numeric))),
    CONSTRAINT agent_executions_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: analysis_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analysis_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    match_result_id uuid NOT NULL,
    report_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    report_text text,
    pdf_storage_path text,
    model_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    generation_error text,
    completed_at timestamp with time zone,
    CONSTRAINT analysis_reports_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'generating'::text, 'validating'::text, 'rendering_pdf'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    industry text,
    description text,
    website text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: company_financials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_financials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_ticker_id uuid NOT NULL,
    source text DEFAULT 'yahoo_finance'::text NOT NULL,
    statement_type text DEFAULT 'income'::text NOT NULL,
    period_type text NOT NULL,
    period_end date NOT NULL,
    currency text,
    revenue numeric,
    operating_income numeric,
    net_income numeric,
    total_assets numeric,
    market_cap numeric,
    raw_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    collected_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_financials_period_type_check CHECK ((period_type = ANY (ARRAY['annual'::text, 'quarterly'::text, 'ttm'::text, 'snapshot'::text]))),
    CONSTRAINT company_financials_statement_type_check CHECK ((statement_type = ANY (ARRAY['income'::text, 'balance_sheet'::text, 'cash_flow'::text, 'summary'::text])))
);


--
-- Name: company_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_ticker_id uuid NOT NULL,
    price_date date NOT NULL,
    currency text,
    open_price numeric,
    high_price numeric,
    low_price numeric,
    close_price numeric,
    adjusted_close numeric,
    volume bigint,
    source text DEFAULT 'yahoo_finance'::text NOT NULL,
    collected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: company_tickers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_tickers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    ticker text NOT NULL,
    exchange text,
    currency text,
    is_primary boolean DEFAULT false NOT NULL
);


--
-- Name: criterion_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.criterion_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    criterion_id uuid NOT NULL,
    score numeric(6,3),
    verdict text,
    confidence numeric(5,4),
    reasoning_summary text,
    improvement_suggestion text,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    applied_methods jsonb DEFAULT '[]'::jsonb NOT NULL,
    validation_status text DEFAULT 'pending'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    final_artifact_id uuid,
    finalized_at timestamp with time zone,
    CONSTRAINT criterion_results_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT criterion_results_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT criterion_results_score_check CHECK (((score >= (0)::numeric) AND (score <= (100)::numeric))),
    CONSTRAINT criterion_results_validation_status_check CHECK ((validation_status = ANY (ARRAY['pending'::text, 'passed'::text, 'needs_review'::text, 'failed'::text]))),
    CONSTRAINT criterion_results_verdict_check CHECK ((verdict = ANY (ARRAY['met'::text, 'not_met'::text, 'unknown'::text, 'not_applicable'::text])))
);


--
-- Name: document_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resume_id uuid,
    job_posting_id uuid,
    company_id uuid,
    chunk_index integer NOT NULL,
    section text,
    content text NOT NULL,
    embedding extensions.vector(1536),
    embedding_model text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    embedding_version text,
    indexing_status text DEFAULT 'ready'::text NOT NULL,
    CONSTRAINT document_chunks_chunk_index_check CHECK ((chunk_index >= 0)),
    CONSTRAINT document_chunks_indexing_status_check CHECK ((indexing_status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text]))),
    CONSTRAINT exactly_one_chunk_source CHECK ((num_nonnulls(resume_id, job_posting_id, company_id) = 1))
);


--
-- Name: evaluation_criteria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluation_criteria (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rubric_id uuid NOT NULL,
    domain_code text NOT NULL,
    criterion_code text NOT NULL,
    name_ko text NOT NULL,
    weight numeric(5,4) NOT NULL,
    method_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    display_order smallint NOT NULL,
    CONSTRAINT evaluation_criteria_domain_code_check CHECK ((domain_code = ANY (ARRAY['resume_completeness'::text, 'job_fit'::text, 'qualifications'::text, 'practical_competitiveness'::text]))),
    CONSTRAINT evaluation_criteria_weight_check CHECK (((weight > (0)::numeric) AND (weight <= (1)::numeric)))
);


--
-- Name: evaluation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluation_events (
    id bigint NOT NULL,
    run_id uuid NOT NULL,
    criterion_id uuid,
    event_type text NOT NULL,
    attempt_number integer DEFAULT 0 NOT NULL,
    event_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evaluation_events_event_type_check CHECK ((event_type = ANY (ARRAY['retrieval'::text, 'draft'::text, 'self_refine'::text, 'consistency'::text, 'validation'::text, 'retry'::text, 'error'::text])))
);


--
-- Name: evaluation_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.evaluation_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.evaluation_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: evaluation_input_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluation_input_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    resume_id uuid NOT NULL,
    job_posting_id uuid NOT NULL,
    rubric_id uuid NOT NULL,
    resume_version integer NOT NULL,
    resume_hash text NOT NULL,
    job_hash text NOT NULL,
    finance_as_of timestamp with time zone,
    financial_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    input_manifest jsonb DEFAULT '{}'::jsonb NOT NULL,
    storage_path text,
    snapshot_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resume_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    job_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    model_config_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    prompt_config_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    retention_until timestamp with time zone,
    CONSTRAINT evaluation_input_snapshots_snapshot_hash_check CHECK ((length(snapshot_hash) > 0))
);


--
-- Name: evaluation_rubrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluation_rubrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rubric_version text NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: evaluation_stage_timings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluation_stage_timings (
    id bigint NOT NULL,
    run_id uuid NOT NULL,
    stage text NOT NULL,
    criterion_code text,
    attempt_number integer DEFAULT 1 NOT NULL,
    status text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone NOT NULL,
    duration_ms bigint NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evaluation_stage_timings_attempt_number_check CHECK ((attempt_number >= 1)),
    CONSTRAINT evaluation_stage_timings_check CHECK ((completed_at >= started_at)),
    CONSTRAINT evaluation_stage_timings_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT evaluation_stage_timings_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: evaluation_stage_timings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.evaluation_stage_timings ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.evaluation_stage_timings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: intermediate_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intermediate_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    node_execution_id uuid,
    criterion_id uuid,
    artifact_type text NOT NULL,
    artifact_version integer DEFAULT 1 NOT NULL,
    content jsonb DEFAULT '{}'::jsonb NOT NULL,
    storage_path text,
    content_hash text,
    schema_version text,
    is_test_fixture boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_artifact_id uuid,
    input_hash text,
    producer_version text,
    source_snapshot_id uuid,
    CONSTRAINT intermediate_artifacts_artifact_version_check CHECK ((artifact_version >= 1)),
    CONSTRAINT intermediate_artifacts_check CHECK (((content <> '{}'::jsonb) OR (storage_path IS NOT NULL)))
);


--
-- Name: job_postings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_postings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    title text NOT NULL,
    description text NOT NULL,
    responsibilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    requirements jsonb DEFAULT '[]'::jsonb NOT NULL,
    preferred_requirements jsonb DEFAULT '[]'::jsonb NOT NULL,
    career_min_months integer,
    career_max_months integer,
    education_level text,
    employment_type text,
    location text,
    source_name text,
    source_external_id text,
    source_url text,
    deadline date,
    published_at timestamp with time zone,
    collected_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_postings_career_max_months_check CHECK (((career_max_months IS NULL) OR (career_max_months >= 0))),
    CONSTRAINT job_postings_career_min_months_check CHECK (((career_min_months IS NULL) OR (career_min_months >= 0))),
    CONSTRAINT job_postings_check CHECK (((career_max_months IS NULL) OR (career_min_months IS NULL) OR (career_max_months >= career_min_months)))
);


--
-- Name: match_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    resume_completeness numeric(6,3),
    job_fit numeric(6,3),
    qualifications numeric(6,3),
    practical_competitiveness numeric(6,3),
    overall_score numeric(6,3),
    overall_formula jsonb DEFAULT '{}'::jsonb NOT NULL,
    eligibility_status text,
    validation_status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT match_results_eligibility_status_check CHECK ((eligibility_status = ANY (ARRAY['met'::text, 'not_met'::text, 'unknown'::text]))),
    CONSTRAINT match_results_job_fit_check CHECK (((job_fit >= (0)::numeric) AND (job_fit <= (100)::numeric))),
    CONSTRAINT match_results_overall_score_check CHECK (((overall_score >= (0)::numeric) AND (overall_score <= (100)::numeric))),
    CONSTRAINT match_results_practical_competitiveness_check CHECK (((practical_competitiveness >= (0)::numeric) AND (practical_competitiveness <= (100)::numeric))),
    CONSTRAINT match_results_qualifications_check CHECK (((qualifications >= (0)::numeric) AND (qualifications <= (100)::numeric))),
    CONSTRAINT match_results_resume_completeness_check CHECK (((resume_completeness >= (0)::numeric) AND (resume_completeness <= (100)::numeric))),
    CONSTRAINT match_results_validation_status_check CHECK ((validation_status = ANY (ARRAY['pending'::text, 'passed'::text, 'partial'::text, 'failed'::text])))
);


--
-- Name: mock_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mock_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    resume_id uuid NOT NULL,
    job_posting_id uuid NOT NULL,
    evaluation_run_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mock_applications_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'evaluating'::text, 'evaluated'::text, 'cancelled'::text])))
);


--
-- Name: node_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    agent_execution_id uuid,
    criterion_id uuid,
    node_name text NOT NULL,
    attempt_number integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    input_artifact_id uuid,
    output_artifact_id uuid,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    duration_ms bigint,
    error_summary text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    retry_reason text,
    parent_node_execution_id uuid,
    node_version text,
    model_name text,
    token_usage jsonb DEFAULT '{}'::jsonb NOT NULL,
    execution_key text,
    worker_id text,
    lease_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    CONSTRAINT node_executions_attempt_number_check CHECK ((attempt_number >= 1)),
    CONSTRAINT node_executions_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT node_executions_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    user_id uuid NOT NULL,
    display_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: progress_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.progress_events (
    id bigint NOT NULL,
    run_id uuid NOT NULL,
    agent_execution_id uuid,
    node_execution_id uuid,
    stage text NOT NULL,
    status text NOT NULL,
    message text NOT NULL,
    progress_percent numeric(5,2),
    event_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT progress_events_progress_percent_check CHECK (((progress_percent >= (0)::numeric) AND (progress_percent <= (100)::numeric))),
    CONSTRAINT progress_events_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: progress_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.progress_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.progress_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: resumes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resumes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text DEFAULT 'My resume'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    storage_path text,
    original_text text,
    parsed_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    parse_status text DEFAULT 'pending'::text NOT NULL,
    parser_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resumes_parse_status_check CHECK ((parse_status = ANY (ARRAY['pending'::text, 'processing'::text, 'ready'::text, 'failed'::text]))),
    CONSTRAINT resumes_version_check CHECK ((version >= 1))
);


--
-- Name: validation_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.validation_issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    criterion_id uuid,
    node_execution_id uuid,
    issue_type text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    description text NOT NULL,
    resolution_status text DEFAULT 'open'::text NOT NULL,
    source_artifact_id uuid,
    resolved_artifact_id uuid,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT validation_issues_issue_type_check CHECK ((issue_type = ANY (ARRAY['missing_evidence'::text, 'conflicting_evidence'::text, 'score_error'::text, 'cross_domain_conflict'::text, 'invalid_output'::text, 'other'::text]))),
    CONSTRAINT validation_issues_resolution_status_check CHECK ((resolution_status = ANY (ARRAY['open'::text, 'rechecking'::text, 'resolved'::text, 'accepted_risk'::text]))),
    CONSTRAINT validation_issues_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])))
);


--
-- Name: agent_executions agent_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_executions
    ADD CONSTRAINT agent_executions_pkey PRIMARY KEY (id);


--
-- Name: agent_executions agent_executions_run_id_agent_type_attempt_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_executions
    ADD CONSTRAINT agent_executions_run_id_agent_type_attempt_number_key UNIQUE (run_id, agent_type, attempt_number);


--
-- Name: analysis_reports analysis_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analysis_reports
    ADD CONSTRAINT analysis_reports_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: company_financials company_financials_company_ticker_id_source_statement_type__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_financials
    ADD CONSTRAINT company_financials_company_ticker_id_source_statement_type__key UNIQUE (company_ticker_id, source, statement_type, period_type, period_end);


--
-- Name: company_financials company_financials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_financials
    ADD CONSTRAINT company_financials_pkey PRIMARY KEY (id);


--
-- Name: company_prices company_prices_company_ticker_id_price_date_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_prices
    ADD CONSTRAINT company_prices_company_ticker_id_price_date_source_key UNIQUE (company_ticker_id, price_date, source);


--
-- Name: company_prices company_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_prices
    ADD CONSTRAINT company_prices_pkey PRIMARY KEY (id);


--
-- Name: company_tickers company_tickers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_tickers
    ADD CONSTRAINT company_tickers_pkey PRIMARY KEY (id);


--
-- Name: company_tickers company_tickers_ticker_exchange_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_tickers
    ADD CONSTRAINT company_tickers_ticker_exchange_key UNIQUE (ticker, exchange);


--
-- Name: criterion_results criterion_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.criterion_results
    ADD CONSTRAINT criterion_results_pkey PRIMARY KEY (id);


--
-- Name: criterion_results criterion_results_run_id_criterion_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.criterion_results
    ADD CONSTRAINT criterion_results_run_id_criterion_id_key UNIQUE (run_id, criterion_id);


--
-- Name: document_chunks document_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_pkey PRIMARY KEY (id);


--
-- Name: evaluation_criteria evaluation_criteria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_criteria
    ADD CONSTRAINT evaluation_criteria_pkey PRIMARY KEY (id);


--
-- Name: evaluation_criteria evaluation_criteria_rubric_id_criterion_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_criteria
    ADD CONSTRAINT evaluation_criteria_rubric_id_criterion_code_key UNIQUE (rubric_id, criterion_code);


--
-- Name: evaluation_events evaluation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_events
    ADD CONSTRAINT evaluation_events_pkey PRIMARY KEY (id);


--
-- Name: evaluation_input_snapshots evaluation_input_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_input_snapshots
    ADD CONSTRAINT evaluation_input_snapshots_pkey PRIMARY KEY (id);


--
-- Name: evaluation_input_snapshots evaluation_input_snapshots_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_input_snapshots
    ADD CONSTRAINT evaluation_input_snapshots_run_id_key UNIQUE (run_id);


--
-- Name: evaluation_rubrics evaluation_rubrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_rubrics
    ADD CONSTRAINT evaluation_rubrics_pkey PRIMARY KEY (id);


--
-- Name: evaluation_rubrics evaluation_rubrics_rubric_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_rubrics
    ADD CONSTRAINT evaluation_rubrics_rubric_version_key UNIQUE (rubric_version);


--
-- Name: evaluation_runs evaluation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_pkey PRIMARY KEY (id);


--
-- Name: evaluation_stage_timings evaluation_stage_timings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_stage_timings
    ADD CONSTRAINT evaluation_stage_timings_pkey PRIMARY KEY (id);


--
-- Name: intermediate_artifacts intermediate_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intermediate_artifacts
    ADD CONSTRAINT intermediate_artifacts_pkey PRIMARY KEY (id);


--
-- Name: job_postings job_postings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_postings
    ADD CONSTRAINT job_postings_pkey PRIMARY KEY (id);


--
-- Name: match_results match_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_pkey PRIMARY KEY (id);


--
-- Name: match_results match_results_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_run_id_key UNIQUE (run_id);


--
-- Name: mock_applications mock_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_applications
    ADD CONSTRAINT mock_applications_pkey PRIMARY KEY (id);


--
-- Name: node_executions node_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_executions
    ADD CONSTRAINT node_executions_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);


--
-- Name: progress_events progress_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_events
    ADD CONSTRAINT progress_events_pkey PRIMARY KEY (id);


--
-- Name: resumes resumes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resumes
    ADD CONSTRAINT resumes_pkey PRIMARY KEY (id);


--
-- Name: validation_issues validation_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_issues
    ADD CONSTRAINT validation_issues_pkey PRIMARY KEY (id);


--
-- Name: idx_agent_executions_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_executions_run ON public.agent_executions USING btree (run_id, status);


--
-- Name: idx_artifact_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artifact_parent ON public.intermediate_artifacts USING btree (parent_artifact_id);


--
-- Name: idx_artifacts_criterion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artifacts_criterion ON public.intermediate_artifacts USING btree (run_id, criterion_id, artifact_type);


--
-- Name: idx_artifacts_node; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artifacts_node ON public.intermediate_artifacts USING btree (node_execution_id);


--
-- Name: idx_artifacts_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artifacts_run ON public.intermediate_artifacts USING btree (run_id, created_at);


--
-- Name: idx_chunks_embedding_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chunks_embedding_version ON public.document_chunks USING btree (embedding_model, embedding_version);


--
-- Name: idx_company_prices_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_prices_date ON public.company_prices USING btree (company_ticker_id, price_date DESC);


--
-- Name: idx_criteria_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_criteria_domain ON public.evaluation_criteria USING btree (rubric_id, domain_code);


--
-- Name: idx_criterion_results_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_criterion_results_run ON public.criterion_results USING btree (run_id);


--
-- Name: idx_events_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_run ON public.evaluation_events USING btree (run_id, created_at);


--
-- Name: idx_financials_ticker_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financials_ticker_period ON public.company_financials USING btree (company_ticker_id, period_end DESC);


--
-- Name: idx_jobs_collected; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_collected ON public.job_postings USING btree (collected_at DESC);


--
-- Name: idx_jobs_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_company ON public.job_postings USING btree (company_id);


--
-- Name: idx_mock_apps_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mock_apps_user ON public.mock_applications USING btree (user_id, created_at DESC);


--
-- Name: idx_node_executions_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_executions_run ON public.node_executions USING btree (run_id, created_at);


--
-- Name: idx_nodes_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nodes_lease ON public.node_executions USING btree (status, lease_expires_at) WHERE (status = 'running'::text);


--
-- Name: idx_progress_events_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_progress_events_run ON public.progress_events USING btree (run_id, id);


--
-- Name: idx_reports_match; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_match ON public.analysis_reports USING btree (match_result_id);


--
-- Name: idx_resumes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resumes_user ON public.resumes USING btree (user_id, created_at DESC);


--
-- Name: idx_runs_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_runs_parent ON public.evaluation_runs USING btree (parent_run_id);


--
-- Name: idx_runs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_runs_user ON public.evaluation_runs USING btree (user_id, created_at DESC);


--
-- Name: idx_snapshots_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snapshots_hash ON public.evaluation_input_snapshots USING btree (snapshot_hash);


--
-- Name: idx_stage_timings_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stage_timings_created ON public.evaluation_stage_timings USING btree (created_at DESC);


--
-- Name: idx_stage_timings_run_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stage_timings_run_stage ON public.evaluation_stage_timings USING btree (run_id, stage, started_at);


--
-- Name: idx_tickers_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickers_company ON public.company_tickers USING btree (company_id);


--
-- Name: idx_validation_issues_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validation_issues_run ON public.validation_issues USING btree (run_id, resolution_status);


--
-- Name: uq_chunk_company; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_chunk_company ON public.document_chunks USING btree (company_id, chunk_index) WHERE (company_id IS NOT NULL);


--
-- Name: uq_chunk_job; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_chunk_job ON public.document_chunks USING btree (job_posting_id, chunk_index) WHERE (job_posting_id IS NOT NULL);


--
-- Name: uq_chunk_resume; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_chunk_resume ON public.document_chunks USING btree (resume_id, chunk_index) WHERE (resume_id IS NOT NULL);


--
-- Name: uq_jobs_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_jobs_source ON public.job_postings USING btree (source_name, source_external_id) WHERE ((source_name IS NOT NULL) AND (source_external_id IS NOT NULL));


--
-- Name: uq_node_execution_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_node_execution_key ON public.node_executions USING btree (run_id, execution_key) WHERE (execution_key IS NOT NULL);


--
-- Name: uq_resume_chunk_full; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_resume_chunk_full ON public.document_chunks USING btree (resume_id, chunk_index);


--
-- Name: uq_runs_graph_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_runs_graph_thread ON public.evaluation_runs USING btree (graph_thread_id) WHERE (graph_thread_id IS NOT NULL);


--
-- Name: uq_runs_user_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_runs_user_idempotency ON public.evaluation_runs USING btree (user_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: companies trg_companies_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: criterion_results trg_criterion_results_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_criterion_results_updated BEFORE UPDATE ON public.criterion_results FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: intermediate_artifacts trg_immutable_artifact; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_immutable_artifact BEFORE UPDATE ON public.intermediate_artifacts FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_update();


--
-- Name: evaluation_input_snapshots trg_immutable_snapshot; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_immutable_snapshot BEFORE UPDATE ON public.evaluation_input_snapshots FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_update();


--
-- Name: job_postings trg_jobs_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON public.job_postings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: intermediate_artifacts trg_lineage_artifact; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lineage_artifact BEFORE INSERT ON public.intermediate_artifacts FOR EACH ROW EXECUTE FUNCTION public.check_execution_lineage();


--
-- Name: validation_issues trg_lineage_issue; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lineage_issue BEFORE INSERT OR UPDATE ON public.validation_issues FOR EACH ROW EXECUTE FUNCTION public.check_execution_lineage();


--
-- Name: node_executions trg_lineage_node; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lineage_node BEFORE INSERT OR UPDATE ON public.node_executions FOR EACH ROW EXECUTE FUNCTION public.check_execution_lineage();


--
-- Name: progress_events trg_lineage_progress; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lineage_progress BEFORE INSERT OR UPDATE ON public.progress_events FOR EACH ROW EXECUTE FUNCTION public.check_execution_lineage();


--
-- Name: mock_applications trg_mock_application_resume_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mock_application_resume_owner BEFORE INSERT OR UPDATE OF user_id, resume_id ON public.mock_applications FOR EACH ROW EXECUTE FUNCTION public.check_mock_application_resume_owner();


--
-- Name: profiles trg_profiles_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: criterion_results trg_result_artifact; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_result_artifact BEFORE INSERT OR UPDATE ON public.criterion_results FOR EACH ROW EXECUTE FUNCTION public.check_result_artifact();


--
-- Name: criterion_results trg_result_criterion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_result_criterion BEFORE INSERT OR UPDATE ON public.criterion_results FOR EACH ROW EXECUTE FUNCTION public.check_criterion_rubric();


--
-- Name: resumes trg_resumes_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_resumes_updated BEFORE UPDATE ON public.resumes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: evaluation_criteria trg_rubric_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rubric_immutable BEFORE DELETE OR UPDATE ON public.evaluation_criteria FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_update();


--
-- Name: evaluation_runs trg_run_resume_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_run_resume_owner BEFORE INSERT OR UPDATE OF user_id, resume_id ON public.evaluation_runs FOR EACH ROW EXECUTE FUNCTION public.check_run_resume_owner();


--
-- Name: evaluation_runs trg_runs_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_runs_updated BEFORE UPDATE ON public.evaluation_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: evaluation_input_snapshots trg_validate_snapshot; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_snapshot BEFORE INSERT OR UPDATE ON public.evaluation_input_snapshots FOR EACH ROW EXECUTE FUNCTION public.validate_evaluation_snapshot();


--
-- Name: agent_executions agent_executions_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_executions
    ADD CONSTRAINT agent_executions_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.evaluation_runs(id) ON DELETE CASCADE;


--
-- Name: analysis_reports analysis_reports_match_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analysis_reports
    ADD CONSTRAINT analysis_reports_match_result_id_fkey FOREIGN KEY (match_result_id) REFERENCES public.match_results(id) ON DELETE CASCADE;


--
-- Name: company_financials company_financials_company_ticker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_financials
    ADD CONSTRAINT company_financials_company_ticker_id_fkey FOREIGN KEY (company_ticker_id) REFERENCES public.company_tickers(id) ON DELETE CASCADE;


--
-- Name: company_prices company_prices_company_ticker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_prices
    ADD CONSTRAINT company_prices_company_ticker_id_fkey FOREIGN KEY (company_ticker_id) REFERENCES public.company_tickers(id) ON DELETE CASCADE;


--
-- Name: company_tickers company_tickers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_tickers
    ADD CONSTRAINT company_tickers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: criterion_results criterion_results_criterion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.criterion_results
    ADD CONSTRAINT criterion_results_criterion_id_fkey FOREIGN KEY (criterion_id) REFERENCES public.evaluation_criteria(id);


--
-- Name: criterion_results criterion_results_final_artifact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.criterion_results
    ADD CONSTRAINT criterion_results_final_artifact_id_fkey FOREIGN KEY (final_artifact_id) REFERENCES public.intermediate_artifacts(id) ON DELETE SET NULL;


--
-- Name: criterion_results criterion_results_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.criterion_results
    ADD CONSTRAINT criterion_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.evaluation_runs(id) ON DELETE CASCADE;


--
-- Name: document_chunks document_chunks_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: document_chunks document_chunks_job_posting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_job_posting_id_fkey FOREIGN KEY (job_posting_id) REFERENCES public.job_postings(id) ON DELETE CASCADE;


--
-- Name: document_chunks document_chunks_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES public.resumes(id) ON DELETE CASCADE;


--
-- Name: evaluation_criteria evaluation_criteria_rubric_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_criteria
    ADD CONSTRAINT evaluation_criteria_rubric_id_fkey FOREIGN KEY (rubric_id) REFERENCES public.evaluation_rubrics(id) ON DELETE CASCADE;


--
-- Name: evaluation_events evaluation_events_criterion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_events
    ADD CONSTRAINT evaluation_events_criterion_id_fkey FOREIGN KEY (criterion_id) REFERENCES public.evaluation_criteria(id);


--
-- Name: evaluation_events evaluation_events_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_events
    ADD CONSTRAINT evaluation_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.evaluation_runs(id) ON DELETE CASCADE;


--
-- Name: evaluation_input_snapshots evaluation_input_snapshots_job_posting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_input_snapshots
    ADD CONSTRAINT evaluation_input_snapshots_job_posting_id_fkey FOREIGN KEY (job_posting_id) REFERENCES public.job_postings(id);


--
-- Name: evaluation_input_snapshots evaluation_input_snapshots_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_input_snapshots
    ADD CONSTRAINT evaluation_input_snapshots_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES public.resumes(id);


--
-- Name: evaluation_input_snapshots evaluation_input_snapshots_rubric_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_input_snapshots
    ADD CONSTRAINT evaluation_input_snapshots_rubric_id_fkey FOREIGN KEY (rubric_id) REFERENCES public.evaluation_rubrics(id);


--
-- Name: evaluation_input_snapshots evaluation_input_snapshots_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_input_snapshots
    ADD CONSTRAINT evaluation_input_snapshots_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.evaluation_runs(id) ON DELETE CASCADE;


--
-- Name: evaluation_runs evaluation_runs_job_posting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_job_posting_id_fkey FOREIGN KEY (job_posting_id) REFERENCES public.job_postings(id) ON DELETE CASCADE;


--
-- Name: evaluation_runs evaluation_runs_parent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_parent_run_id_fkey FOREIGN KEY (parent_run_id) REFERENCES public.evaluation_runs(id) ON DELETE SET NULL;


--
-- Name: evaluation_runs evaluation_runs_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES public.resumes(id) ON DELETE CASCADE;


--
-- Name: evaluation_runs evaluation_runs_rubric_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_rubric_id_fkey FOREIGN KEY (rubric_id) REFERENCES public.evaluation_rubrics(id);


--
-- Name: evaluation_runs evaluation_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: evaluation_stage_timings evaluation_stage_timings_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_stage_timings
    ADD CONSTRAINT evaluation_stage_timings_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.evaluation_runs(id) ON DELETE CASCADE;


--
-- Name: intermediate_artifacts fk_artifact_snapshot; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intermediate_artifacts
    ADD CONSTRAINT fk_artifact_snapshot FOREIGN KEY (source_snapshot_id) REFERENCES public.evaluation_input_snapshots(id) ON DELETE SET NULL;


--
-- Name: node_executions fk_node_input_artifact; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_executions
    ADD CONSTRAINT fk_node_input_artifact FOREIGN KEY (input_artifact_id) REFERENCES public.intermediate_artifacts(id) ON DELETE SET NULL;


--
-- Name: node_executions fk_node_output_artifact; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_executions
    ADD CONSTRAINT fk_node_output_artifact FOREIGN KEY (output_artifact_id) REFERENCES public.intermediate_artifacts(id) ON DELETE SET NULL;


--
-- Name: intermediate_artifacts intermediate_artifacts_criterion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intermediate_artifacts
    ADD CONSTRAINT intermediate_artifacts_criterion_id_fkey FOREIGN KEY (criterion_id) REFERENCES public.evaluation_criteria(id) ON DELETE SET NULL;


--
-- Name: intermediate_artifacts intermediate_artifacts_node_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intermediate_artifacts
    ADD CONSTRAINT intermediate_artifacts_node_execution_id_fkey FOREIGN KEY (node_execution_id) REFERENCES public.node_executions(id) ON DELETE SET NULL;


--
-- Name: intermediate_artifacts intermediate_artifacts_parent_artifact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intermediate_artifacts
    ADD CONSTRAINT intermediate_artifacts_parent_artifact_id_fkey FOREIGN KEY (parent_artifact_id) REFERENCES public.intermediate_artifacts(id) ON DELETE SET NULL;


--
-- Name: intermediate_artifacts intermediate_artifacts_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intermediate_artifacts
    ADD CONSTRAINT intermediate_artifacts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.evaluation_runs(id) ON DELETE CASCADE;


--
-- Name: job_postings job_postings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_postings
    ADD CONSTRAINT job_postings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: match_results match_results_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.evaluation_runs(id) ON DELETE CASCADE;


--
-- Name: mock_applications mock_applications_evaluation_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_applications
    ADD CONSTRAINT mock_applications_evaluation_run_id_fkey FOREIGN KEY (evaluation_run_id) REFERENCES public.evaluation_runs(id) ON DELETE SET NULL;


--
-- Name: mock_applications mock_applications_job_posting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_applications
    ADD CONSTRAINT mock_applications_job_posting_id_fkey FOREIGN KEY (job_posting_id) REFERENCES public.job_postings(id) ON DELETE CASCADE;


--
-- Name: mock_applications mock_applications_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_applications
    ADD CONSTRAINT mock_applications_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES public.resumes(id) ON DELETE CASCADE;


--
-- Name: mock_applications mock_applications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_applications
    ADD CONSTRAINT mock_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: node_executions node_executions_agent_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_executions
    ADD CONSTRAINT node_executions_agent_execution_id_fkey FOREIGN KEY (agent_execution_id) REFERENCES public.agent_executions(id) ON DELETE SET NULL;


--
-- Name: node_executions node_executions_criterion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_executions
    ADD CONSTRAINT node_executions_criterion_id_fkey FOREIGN KEY (criterion_id) REFERENCES public.evaluation_criteria(id) ON DELETE SET NULL;


--
-- Name: node_executions node_executions_parent_node_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_executions
    ADD CONSTRAINT node_executions_parent_node_execution_id_fkey FOREIGN KEY (parent_node_execution_id) REFERENCES public.node_executions(id) ON DELETE SET NULL;


--
-- Name: node_executions node_executions_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_executions
    ADD CONSTRAINT node_executions_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.evaluation_runs(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: progress_events progress_events_agent_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_events
    ADD CONSTRAINT progress_events_agent_execution_id_fkey FOREIGN KEY (agent_execution_id) REFERENCES public.agent_executions(id) ON DELETE SET NULL;


--
-- Name: progress_events progress_events_node_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_events
    ADD CONSTRAINT progress_events_node_execution_id_fkey FOREIGN KEY (node_execution_id) REFERENCES public.node_executions(id) ON DELETE SET NULL;


--
-- Name: progress_events progress_events_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_events
    ADD CONSTRAINT progress_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.evaluation_runs(id) ON DELETE CASCADE;


--
-- Name: resumes resumes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resumes
    ADD CONSTRAINT resumes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: validation_issues validation_issues_criterion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_issues
    ADD CONSTRAINT validation_issues_criterion_id_fkey FOREIGN KEY (criterion_id) REFERENCES public.evaluation_criteria(id) ON DELETE SET NULL;


--
-- Name: validation_issues validation_issues_node_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_issues
    ADD CONSTRAINT validation_issues_node_execution_id_fkey FOREIGN KEY (node_execution_id) REFERENCES public.node_executions(id) ON DELETE SET NULL;


--
-- Name: validation_issues validation_issues_resolved_artifact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_issues
    ADD CONSTRAINT validation_issues_resolved_artifact_id_fkey FOREIGN KEY (resolved_artifact_id) REFERENCES public.intermediate_artifacts(id) ON DELETE SET NULL;


--
-- Name: validation_issues validation_issues_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_issues
    ADD CONSTRAINT validation_issues_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.evaluation_runs(id) ON DELETE CASCADE;


--
-- Name: validation_issues validation_issues_source_artifact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_issues
    ADD CONSTRAINT validation_issues_source_artifact_id_fkey FOREIGN KEY (source_artifact_id) REFERENCES public.intermediate_artifacts(id) ON DELETE SET NULL;


--
-- Name: agent_executions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY;

--
-- Name: analysis_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analysis_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: document_chunks chunks_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chunks_read ON public.document_chunks FOR SELECT TO authenticated USING ((((resume_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.resumes r
  WHERE ((r.id = document_chunks.resume_id) AND (r.user_id = ( SELECT auth.uid() AS uid)))))) OR (job_posting_id IS NOT NULL) OR (company_id IS NOT NULL)));


--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: companies companies_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_read ON public.companies FOR SELECT TO authenticated USING (true);


--
-- Name: company_financials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_financials ENABLE ROW LEVEL SECURITY;

--
-- Name: company_prices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: company_tickers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_tickers ENABLE ROW LEVEL SECURITY;

--
-- Name: evaluation_criteria criteria_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY criteria_read ON public.evaluation_criteria FOR SELECT TO authenticated USING (true);


--
-- Name: criterion_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.criterion_results ENABLE ROW LEVEL SECURITY;

--
-- Name: criterion_results criterion_results_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY criterion_results_owner_read ON public.criterion_results FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.evaluation_runs r
  WHERE ((r.id = criterion_results.run_id) AND (r.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: document_chunks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

--
-- Name: evaluation_criteria; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evaluation_criteria ENABLE ROW LEVEL SECURITY;

--
-- Name: evaluation_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evaluation_events ENABLE ROW LEVEL SECURITY;

--
-- Name: evaluation_input_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evaluation_input_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: evaluation_rubrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evaluation_rubrics ENABLE ROW LEVEL SECURITY;

--
-- Name: evaluation_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evaluation_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: evaluation_stage_timings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evaluation_stage_timings ENABLE ROW LEVEL SECURITY;

--
-- Name: company_financials financials_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY financials_read ON public.company_financials FOR SELECT TO authenticated USING (true);


--
-- Name: intermediate_artifacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intermediate_artifacts ENABLE ROW LEVEL SECURITY;

--
-- Name: job_postings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;

--
-- Name: job_postings jobs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jobs_read ON public.job_postings FOR SELECT TO authenticated USING (true);


--
-- Name: match_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_results ENABLE ROW LEVEL SECURITY;

--
-- Name: match_results matches_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY matches_owner_read ON public.match_results FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.evaluation_runs r
  WHERE ((r.id = match_results.run_id) AND (r.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: mock_applications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mock_applications ENABLE ROW LEVEL SECURITY;

--
-- Name: mock_applications mock_apps_owner_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mock_apps_owner_delete ON public.mock_applications FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: mock_applications mock_apps_owner_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mock_apps_owner_insert ON public.mock_applications FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: mock_applications mock_apps_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mock_apps_owner_read ON public.mock_applications FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: mock_applications mock_apps_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mock_apps_owner_update ON public.mock_applications FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: node_executions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.node_executions ENABLE ROW LEVEL SECURITY;

--
-- Name: company_prices prices_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prices_read ON public.company_prices FOR SELECT TO authenticated USING (true);


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_owner_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_owner_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles profiles_owner_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_owner_select ON public.profiles FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles profiles_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_owner_update ON public.profiles FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: progress_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.progress_events ENABLE ROW LEVEL SECURITY;

--
-- Name: progress_events progress_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY progress_owner_read ON public.progress_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.evaluation_runs r
  WHERE ((r.id = progress_events.run_id) AND (r.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: analysis_reports reports_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_owner_read ON public.analysis_reports FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.match_results m
     JOIN public.evaluation_runs r ON ((r.id = m.run_id)))
  WHERE ((m.id = analysis_reports.match_result_id) AND (r.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: resumes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;

--
-- Name: resumes resumes_owner_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY resumes_owner_delete ON public.resumes FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: resumes resumes_owner_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY resumes_owner_insert ON public.resumes FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: resumes resumes_owner_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY resumes_owner_select ON public.resumes FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: resumes resumes_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY resumes_owner_update ON public.resumes FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: evaluation_rubrics rubrics_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rubrics_read ON public.evaluation_rubrics FOR SELECT TO authenticated USING (true);


--
-- Name: evaluation_runs runs_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY runs_owner_read ON public.evaluation_runs FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: company_tickers tickers_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tickers_read ON public.company_tickers FOR SELECT TO authenticated USING (true);


--
-- Name: validation_issues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.validation_issues ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict HcXg1YZEbGmrJ8QBLJgYO52p4sXiuFfYN49DXbTrLopJ3bdMHV1Bya4xnU3YJ42

