"""Initialize the Render schema on a new, empty PostgreSQL database only."""
import asyncio
from psycopg import AsyncConnection
from app.core.config import ROOT, settings
from app.core.asyncio import run


async def main():
    config = settings()
    dsn = config.database_url.get_secret_value()
    if not dsn:
        raise RuntimeError('DATABASE_URL is required')
    schema = (ROOT / 'migrations/render/000_full_schema.sql').read_text(encoding='utf-8-sig')
    try:
        async with await AsyncConnection.connect(dsn, connect_timeout=15) as conn:
            existing = await (await conn.execute(
                "select exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                "where n.nspname='public' and c.relkind in ('r','p','v','m','S')) as has_objects"
            )).fetchone()
            if existing['has_objects']:
                raise RuntimeError('Refusing to initialize a non-empty public schema')
            await conn.execute(schema, prepare=False)
        print('Render schema initialized. Run scripts.setup_checkpoints next.')
    except Exception as error:
        print('Schema initialization failed: ' + type(error).__name__ + '. No credentials printed.')
        raise SystemExit(1) from None


if __name__ == '__main__':
    run(main())
