"""Read-only checks. Never print secrets, connection URLs or document content."""
import asyncio
from app.core.config import settings
from app.infrastructure.database.supabase import DB
from app.integrations.llm.client import LLM


async def main():
    config = settings()
    for name in ['openai_api_key', 'supabase_url', 'supabase_service_role_key', 'supabase_db_url']:
        value = getattr(config, name)
        print(name + ': ' + ('configured' if (value.get_secret_value() if hasattr(value, 'get_secret_value') else value) else 'missing'))
    db, llm = DB(config), LLM(config)
    try:
        for table in ['evaluation_rubrics', 'job_postings', 'resumes']:
            try:
                rows = await db.select(table, select='id', limit=1)
                print(table + ': reachable')
            except Exception as error: print(table + ': failed (' + type(error).__name__ + ')')
        try:
            await llm.client.models.retrieve(config.openai_model)
            print('LLM model: reachable')
        except Exception as error: print('LLM model: failed (' + type(error).__name__ + ')')
    finally:
        await db.close()
        await llm.close()


if __name__ == '__main__': asyncio.run(main())
