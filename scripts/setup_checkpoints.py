"""One-time backend checkpoint setup in a schema not exposed through the Data API."""
import asyncio
from psycopg import AsyncConnection
from psycopg.rows import dict_row
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from app.core.config import settings
from app.core.asyncio import run


async def main():
    config = settings()
    if not config.supabase_db_url.get_secret_value(): raise RuntimeError('SUPABASE_DB_URL is missing')
    async with await AsyncConnection.connect(config.supabase_db_url.get_secret_value(), autocommit=True, prepare_threshold=0,
                                             row_factory=dict_row) as conn:
        await conn.execute('CREATE SCHEMA IF NOT EXISTS career_lens_checkpoints')
        await conn.execute('REVOKE ALL ON SCHEMA career_lens_checkpoints FROM PUBLIC, anon, authenticated')
        await conn.execute('SET search_path TO career_lens_checkpoints, public')
        await AsyncPostgresSaver(conn).setup()
        await conn.execute('REVOKE ALL ON ALL TABLES IN SCHEMA career_lens_checkpoints FROM PUBLIC, anon, authenticated')
    print('Private checkpoint schema initialized.')


if __name__ == '__main__': run(main())
