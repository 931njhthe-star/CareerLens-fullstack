"""Apply additive backend migrations, never re-run the full v4 schema."""
import asyncio
from psycopg import AsyncConnection
from app.core.config import ROOT, settings
from app.core.asyncio import run


async def main():
    config = settings()
    try:
        async with await AsyncConnection.connect(config.supabase_db_url.get_secret_value(), connect_timeout=15) as conn:
            for migration in sorted((ROOT / 'migrations').glob('[0-9][0-9][0-9]_*.sql')):
                await conn.execute(migration.read_text(encoding='utf-8-sig'))
            await conn.execute("notify pgrst, 'reload schema'")
        print('Backend runtime migrations applied.')
    except Exception as error:
        print('Migration failed: ' + type(error).__name__ + '. No credentials printed.')
        message = str(error).lower()
        labels = {'dns': ['getaddrinfo', 'name or service not known', 'could not translate host', 'nodename nor servname'],
                  'authentication': ['password authentication failed', 'tenant or user not found'],
                  'network': ['network is unreachable', 'connection refused', 'timeout expired', 'connection timed out', 'unreachable network'],
                  'connection_format': ['invalid connection option', 'missing', 'invalid uri'],
                  'ssl': ['ssl', 'certificate']}
        print('Failure category: ' + next((label for label, tokens in labels.items() if any(t in message for t in tokens)), 'database_or_network'))
        raise SystemExit(1) from None


if __name__ == '__main__': run(main())
