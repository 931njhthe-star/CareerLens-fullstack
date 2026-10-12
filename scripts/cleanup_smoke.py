"""Clean only the temporary run recorded by the live smoke report."""
import re
from uuid import UUID
from app.core.config import ROOT, settings
from app.core.asyncio import run
from app.infrastructure.database.supabase import DB


async def main():
    text = (ROOT/'.runtime/integration-report.md').read_text(encoding='utf-8')
    match = re.search(r'평가 ID: ([0-9a-f-]+)',text)
    ident = str(UUID(match.group(1)))
    db = DB(settings())
    try:
        runs = await db.select('evaluation_runs',id=f'eq.{ident}',limit=1)
        if not runs:
            print('Temporary evaluation already removed.')
            return
        uid = runs[0]['user_id']
        auth = await db.request('GET',f'/auth/v1/admin/users/{uid}')
        assert auth['email'].startswith('career-lens-test-') and auth['email'].endswith('@example.invalid')
        await db.delete('intermediate_artifacts',run_id=f'eq.{ident}')
        await db.delete('evaluation_runs',id=f'eq.{ident}')
        await db.request('DELETE',f'/auth/v1/admin/users/{uid}')
        print('Temporary smoke account and evaluation deleted.')
    finally: await db.close()


if __name__ == '__main__': run(main())
