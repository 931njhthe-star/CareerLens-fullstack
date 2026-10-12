-- Replace outstanding evaluations for a user when they submit a newer request.
create or replace function public.create_evaluation(
  p_user uuid,
  p_resume uuid,
  p_job uuid,
  p_rubric uuid,
  p_key text,
  p_fingerprint text,
  p_snapshot jsonb,
  p_model text
)
returns setof public.evaluation_runs
language plpgsql security definer set search_path = '' as $$
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

revoke all on function public.create_evaluation(uuid,uuid,uuid,uuid,text,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.create_evaluation(uuid,uuid,uuid,uuid,text,text,jsonb,text)
  to service_role;
