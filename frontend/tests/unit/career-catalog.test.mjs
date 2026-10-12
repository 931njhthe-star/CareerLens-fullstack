import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCareerCatalog } from '../../src/features/job-postings/career-catalog.js';

function markdown(id, role, company) {
  return {
    id,
    filename: `${id}.md`,
    content: `# ${id}. ${role}
- **회사명:** ${company}
- **공고명:** ${company} ${role} 채용
- **직무명:** ${role}
- **근무지:** 서울
- **고용형태:** 정규직
- **경력:** 신입
- **직무 소개:** 한글 직무 설명

### 3. 담당업무
- 원문 업무

### 4. 자격요건
- 원문 자격

### 5. 우대사항
- 원문 우대
`,
  };
}

test('frontend parses the original Markdown files into unique roles and source postings', () => {
  const original = markdown('001', '예시 직무', '예시 회사');
  const catalog = parseCareerCatalog([
    original,
    markdown('002', '예시 직무', '다른 회사'),
    markdown('003', '두 번째 직무', '세 번째 회사'),
  ]);

  assert.deepEqual(
    catalog.roles.map((role) => role.id),
    ['role-001', 'role-003', 'custom'],
  );
  assert.equal(catalog.roles[0].label, '예시 직무');
  assert.equal(catalog.postings.length, 3);
  assert.equal(catalog.postings[0].company, '예시 회사');
  assert.equal(catalog.postings[0].source_type, 'example');
  assert.match(catalog.postings[0].description, /원문 자격/);
  assert.equal(catalog.postings[0].source_markdown, original.content);
});

test('frontend rejects malformed source files instead of hiding them', () => {
  assert.throws(
    () => parseCareerCatalog([{ id: '001', filename: '001.md', content: '# missing fields' }]),
    /필수 공고 항목/,
  );
});
