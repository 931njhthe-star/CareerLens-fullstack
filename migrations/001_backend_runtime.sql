-- Additional backend RPCs. Run once after schema v4 in Supabase SQL Editor.
-- Does not change Storage bucket metadata or disable RLS.
-- Existing project defaults may not grant Data API access to the backend role.
grant usage on schema public,extensions to service_role;
grant select,insert,update,delete on public.profiles,public.resumes,public.companies,
 public.company_tickers,public.job_postings,public.company_financials,public.company_prices,
 public.document_chunks,public.evaluation_rubrics,public.evaluation_criteria,public.evaluation_runs,
 public.criterion_results,public.evaluation_events,public.match_results,public.analysis_reports,
 public.mock_applications,public.agent_executions,public.node_executions,public.intermediate_artifacts,
 public.progress_events,public.evaluation_input_snapshots,public.validation_issues to service_role;
grant usage,select on sequence public.evaluation_events_id_seq,public.progress_events_id_seq to service_role;
create unique index if not exists uq_resume_chunk_full on public.document_chunks(resume_id,chunk_index);

alter table public.evaluation_runs
  add column if not exists worker_id text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists recovery_count integer not null default 0;

create or replace function public.claim_evaluation(p_worker text, p_lease_seconds integer default 180)
returns setof public.evaluation_runs
language plpgsql security definer set search_path = '' as $$
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

create or replace function public.create_evaluation(p_user uuid,p_resume uuid,p_job uuid,p_rubric uuid,p_key text,p_fingerprint text,p_snapshot jsonb,p_model text)
returns setof public.evaluation_runs
language plpgsql security definer set search_path = '' as $$
declare new_run public.evaluation_runs; existing public.evaluation_runs;
begin
  if not exists(select 1 from public.resumes where id=p_resume and user_id=p_user and parse_status='ready') then
    raise exception 'Resume unavailable';
  end if;
  if not exists(select 1 from public.job_postings where id=p_job) then raise exception 'Job unavailable'; end if;
  if p_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_key,0));
    select * into existing from public.evaluation_runs where user_id=p_user and idempotency_key=p_key;
    if found then
      if existing.input_fingerprint is distinct from p_fingerprint then raise exception 'Idempotency key reused with different input'; end if;
      return next existing; return;
    end if;
  end if;
  insert into public.evaluation_runs(user_id,resume_id,job_posting_id,rubric_id,model_name,idempotency_key,input_fingerprint,graph_thread_id,scoring_version,prompt_version,workflow_version,embedding_model)
  values(p_user,p_resume,p_job,p_rubric,p_model,p_key,p_fingerprint,extensions.gen_random_uuid()::text,'career-lens-v1','career-lens-v1','career-lens-v1','text-embedding-3-small') returning * into new_run;
  insert into public.evaluation_input_snapshots(run_id,resume_id,job_posting_id,rubric_id,resume_version,resume_hash,job_hash,snapshot_hash,resume_snapshot,job_snapshot,financial_snapshot,model_config_snapshot,prompt_config_snapshot,input_manifest)
  values(new_run.id,p_resume,p_job,p_rubric,(p_snapshot->'resume'->>'version')::integer,
    p_snapshot->>'resume_hash',p_snapshot->>'job_hash',p_fingerprint,
    p_snapshot->'resume',p_snapshot->'job',coalesce(p_snapshot->'finance','{}'::jsonb),p_snapshot->'model_config',
    jsonb_build_object('version','career-lens-v1'),jsonb_build_object('scoring_version','career-lens-v1'));
  return next new_run;
end $$;

create or replace function public.search_resume_chunks(p_resume_id uuid,p_source_hash text,p_model text,p_query extensions.vector(1536),p_limit integer default 5)
returns table(content text,section text,metadata jsonb,similarity double precision)
language sql stable security definer set search_path = '' as $$
  select c.content,c.section,c.metadata,1-(c.embedding operator(extensions.<=>) p_query)
  from public.document_chunks c
  where c.resume_id=p_resume_id and c.source_hash=p_source_hash and c.embedding_model=p_model
    and c.embedding_version='v1' and c.indexing_status='ready' and c.embedding is not null
  order by c.embedding operator(extensions.<=>) p_query limit greatest(1,least(p_limit,20));
$$;

revoke all on function public.claim_evaluation(text,integer) from public,anon,authenticated;
revoke all on function public.create_evaluation(uuid,uuid,uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.search_resume_chunks(uuid,text,text,extensions.vector,integer) from public,anon,authenticated;
grant execute on function public.claim_evaluation(text,integer) to service_role;
grant execute on function public.create_evaluation(uuid,uuid,uuid,uuid,text,text,jsonb,text) to service_role;
grant execute on function public.search_resume_chunks(uuid,text,text,extensions.vector,integer) to service_role;

create or replace function public.update_evaluation_progress(p_run uuid,p_stage text,p_percent numeric)
returns void language sql security definer set search_path='' as $$
 update public.evaluation_runs set
   current_stage=case when p_percent>=progress_percent then p_stage else current_stage end,
   progress_percent=greatest(progress_percent,least(100,greatest(0,p_percent)))
 where id=p_run and status='running';
$$;
revoke all on function public.update_evaluation_progress(uuid,text,numeric) from public,anon,authenticated;
grant execute on function public.update_evaluation_progress(uuid,text,numeric) to service_role;
