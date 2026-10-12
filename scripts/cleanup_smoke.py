"""Clean only the temporary run recorded by the live smoke report."""
import re
from uuid import UUID
from app.core.config import ROOT, settings
from app.core.asyncio import run
from app.infrastructure.database.postgres import DB


async def main():
    text = (ROOT/'.runtime/integration-report.md').read_text(encoding='utf-8')
    match = re.search(r'평가 ID: ([0-9a-f-]+)',text)
    ident = str(UUID(match.group(1)))
    db = DB(settings())
    try:
        await db.open()
        runs = await db.select('evaluation_runs',id=f'eq.{ident}',limit=1)
        if not runs:
            print('Temporary evaluation already removed.')
            return
        uid = runs[0]['user_id']
        auth = await db.select('app_users',id=f'eq.{uid}',select='email',limit=1)
        assert auth and auth[0]['email'].startswith('career-lens-test-') and auth[0]['email'].endswith('@example.invalid')
        await db.delete('app_users',id=f'eq.{uid}')
        print('Temporary smoke account and evaluation deleted.')
    finally: await db.close()


if __name__ == '__main__': run(main())
