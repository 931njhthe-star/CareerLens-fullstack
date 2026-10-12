-- Stage-level evaluation timings and an admin-only aggregate/recent-run RPC.
-- Apply after schema v4 and migrations 001_backend_runtime.sql and 002_latest_evaluation_wins.sql.
create table if not exists public.evaluation_stage_timings (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.evaluation_runs(id) on delete cascade,
  stage text not null,
  criterion_code text,
  attempt_number integer not null default 1 check (attempt_number >= 1),
  status text not null check (status in ('completed','failed','cancelled')),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  duration_ms bigint not null check (duration_ms >= 0),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (completed_at >= started_at)
);
create index if not exists idx_stage_timings_run_stage
  on public.evaluation_stage_timings(run_id, stage, started_at);
create index if not exists idx_stage_timings_created
  on public.evaluation_stage_timings(created_at desc);

alter table public.evaluation_stage_timings enable row level security;
revoke all on public.evaluation_stage_timings from public, anon, authenticated;
grant select, insert, update, delete on public.evaluation_stage_timings to service_role;
grant usage, select on sequence public.evaluation_stage_timings_id_seq to service_role;

create or replace function public.get_evaluation_performance(
  p_days integer default 30,
  p_run_limit integer default 100
)
returns jsonb
language sql stable security definer set search_path = '' as $$
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

revoke all on function public.get_evaluation_performance(integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_evaluation_performance(integer, integer)
  to service_role;
