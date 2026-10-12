# CareerLens Render PostgreSQL bootstrap

`000_full_schema.sql` builds a **new, empty PostgreSQL database** from the live Supabase `pg_dump`, the backend runtime migration definitions, and Render-specific adjustments. It does not import application data. Do not run it against an existing database.

## Preserved

- The 22 application tables in the Supabase dump, with their columns, relationships, constraints, indexes, and row-level triggers.
- The rubric seed and its 12 weighted evaluation criteria.
- Evaluation lease claiming, latest-request-wins creation, progress updates, pgvector resume search, and stage performance reporting.
- The final score-only verdict constraints from migration 004.
- The private `career_lens_checkpoints` schema used by LangGraph's PostgreSQL checkpointer.

## Render-specific changes

- Supabase `auth.users` is replaced by `app_users`, with a unique case-insensitive email and a password-hash field. `refresh_tokens` stores token digests, expiry, and revocation state. The application must hash passwords and must never store or query raw refresh tokens.
- `profiles.user_id` references `app_users.id` instead of `auth.users.id`.
- The `vector` extension is installed in `public`; functions and columns do not depend on Supabase's `extensions` schema.
- Supabase Auth/Storage objects, RLS policies, Supabase roles, and the Supabase-only RLS event trigger are omitted. API authorization must be enforced by the backend; keep the database private.
- Markdown resume text is supported in `resumes.original_text`. This schema does not create object storage or migrate existing file objects.
- PostgreSQL built-in `gen_random_uuid()` is used. The target PostgreSQL must provide the `vector` extension.
- The schema defines authentication storage but not password hashing or JWT logic; the FastAPI implementation provides those. Keep the database private because RLS is disabled.

The five security-definer RPCs retain a fixed/empty `search_path` and qualify application objects. They should only be reachable through a private backend database connection. Configure least-privilege database access for production.

## Apply to a new database

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/render/000_full_schema.sql
```

Then initialize LangGraph's checkpoint tables with the installed `AsyncPostgresSaver.setup()` using `search_path=career_lens_checkpoints,public` (see `scripts/setup_checkpoints.py`). The schema bootstrap creates the checkpoint schema, not the checkpointer-managed tables.

This SQL file does not copy Supabase records, migrate users or stored files, or initialize LangGraph tables. DDL and core RPC flows were executed on PostgreSQL 17.11 using a test-only vector type/operator substitute. The real pgvector extension and a Render database have not been tested in this environment; verify the exact bootstrap on the new Render database before using the service.
