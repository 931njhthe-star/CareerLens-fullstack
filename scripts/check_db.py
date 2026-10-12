"""Read-only Render PostgreSQL inspection. Never prints credentials or row contents."""
import asyncio
import sys

from psycopg import AsyncConnection, sql

from app.core.config import settings


async def main() -> None:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    dsn = settings().database_url.get_secret_value()
    if not dsn:
        raise SystemExit('DATABASE_URL is missing.')

    try:
        async with await AsyncConnection.connect(dsn, connect_timeout=15, prepare_threshold=None) as conn:
            await conn.execute('SET default_transaction_read_only = on')
            version = await (await conn.execute('SHOW server_version')).fetchone()
            extensions = await (await conn.execute(
                'SELECT extname, extversion FROM pg_extension ORDER BY extname'
            )).fetchall()
            tables = await (await conn.execute(
                "SELECT table_schema, table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
                'ORDER BY table_name'
            )).fetchall()

            print(f'PostgreSQL {version[0]}')
            print('Extensions: ' + ', '.join(f'{name} {extversion}' for name, extversion in extensions))
            print(f'\nPublic tables: {len(tables)}')
            for schema_name, table_name in tables:
                query = sql.SQL('SELECT count(*) FROM {}.{}').format(
                    sql.Identifier(schema_name), sql.Identifier(table_name),
                )
                count = await (await conn.execute(query)).fetchone()
                print(f'  {schema_name}.{table_name}: {count[0]} rows')
    except Exception as error:
        print(f'Database inspection failed: {type(error).__name__}; credentials and data were not printed.')
        raise SystemExit(1) from None


if __name__ == '__main__':
    asyncio.run(main())
