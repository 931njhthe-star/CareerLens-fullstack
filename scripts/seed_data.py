"""Explicit seed command. Does not upload synthetic resumes into real user accounts."""
import asyncio
import argparse
import re
from pathlib import Path
from app.core.config import ROOT, settings
from app.infrastructure.database.supabase import DB


def posting(text, filename):
    def field(name):
        match = re.search(r'\*\*' + re.escape(name) + r':\*\*\s*(.+)', text)
        return match.group(1).strip() if match else None
    def section(number):
        match = re.search(rf'(?ms)^### {number}\. [^\n]+\n(.*?)(?=^### |\Z)', text)
        return [line[2:].strip() for line in match.group(1).splitlines() if line.startswith('- ')] if match else []
    career = field('경력') or ''
    years = re.search(r'(\d+)년\s*이상', career)
    return {'company_name': field('회사명') or '미확인 기업', 'title': field('공고명') or filename,
            'description': text, 'responsibilities': section(3), 'requirements': section(4), 'preferred_requirements': section(5),
            'career_min_months': int(years.group(1)) * 12 if years else None, 'education_level': field('학력'),
            'employment_type': field('고용형태'), 'location': field('근무지'), 'source_name': 'local_markdown', 'source_external_id': filename}


async def main(limit):
    db = DB(settings())
    try:
        files = sorted((ROOT / 'app/modules/job_postings').glob('[0-9][0-9][0-9].md'))[:limit]
        for path in files:
            data = posting(path.read_text(encoding='utf-8-sig'), path.name)
            name = data.pop('company_name')
            existing = await db.select('companies', name=f'eq.{name}', limit=1)
            company = existing or await db.insert('companies', {'name': name})
            data['company_id'] = company[0]['id']
            old = await db.select('job_postings', source_name='eq.local_markdown', source_external_id=f'eq.{path.name}', limit=1)
            if old: await db.update('job_postings', data, id=f"eq.{old[0]['id']}")
            else: await db.insert('job_postings', data)
        print(f'Imported {len(files)} job postings. Synthetic resumes stay local until explicitly uploaded.')
    finally: await db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=100)
    args = parser.parse_args()
    if args.limit < 1: parser.error('--limit must be positive')
    asyncio.run(main(args.limit))
