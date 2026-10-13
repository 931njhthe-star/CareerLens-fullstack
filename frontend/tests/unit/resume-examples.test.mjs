import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { filterResumeExamples, parseResumeExample } from '../../src/features/resumes/examples.js';

const examplesDirectory = fileURLToPath(
  new URL('../../public/resume-examples/', import.meta.url),
);

const examples = Object.freeze([
  Object.freeze({
    id: 'frontend',
    title: '웹 서비스 지원자',
    role: '프론트엔드 개발',
    experience_level: '신입',
    summary: '접근성 개선 프로젝트를 진행했습니다.',
    skills: Object.freeze(['TypeScript', 'React']),
  }),
  Object.freeze({
    id: 'accounting',
    title: '재무 지원자',
    role: '회계 담당자',
    experience_level: '경력 3년',
    summary: '월별 결산과 Excel 보고서를 작성했습니다.',
    skills: Object.freeze(['회계', 'Excel']),
  }),
  Object.freeze({ id: 'minimal', title: '기본 이력서', role: '운영' }),
]);

test('resume search combines terms across role, summary and skills regardless of case', () => {
  assert.deepEqual(
    filterResumeExamples(examples, '  프론트엔드\t react  접근성 ').map((item) => item.id),
    ['frontend'],
  );
  assert.deepEqual(filterResumeExamples(examples, '회계 REACT'), []);
});

test('experience search includes the advertised experience-level field', () => {
  assert.deepEqual(
    filterResumeExamples(examples, '경력 3년').map((item) => item.id),
    ['accounting'],
  );
  assert.deepEqual(
    filterResumeExamples(examples, '신입').map((item) => item.id),
    ['frontend'],
  );
});

test('empty searches preserve catalog order and tolerate omitted optional fields', () => {
  assert.deepEqual(filterResumeExamples(examples, ' \t\n '), examples);
  assert.deepEqual(
    filterResumeExamples(examples, '운영').map((item) => item.id),
    ['minimal'],
  );
  assert.deepEqual(
    examples.map((item) => item.id),
    ['frontend', 'accounting', 'minimal'],
  );
});

test('frontend catalog contains all 12 full resumes and parses searchable metadata', async () => {
  const filenames = (await readdir(examplesDirectory)).sort();
  assert.deepEqual(
    filenames,
    Array.from({ length: 12 }, (_, index) => `CV-${String(index + 1).padStart(3, '0')}.md`),
  );

  const items = await Promise.all(
    filenames.map(async (filename) =>
      parseResumeExample(
        filename,
        await readFile(new URL(`../../public/resume-examples/${filename}`, import.meta.url), 'utf8'),
      ),
    ),
  );
  assert.equal(new Set(items.map((item) => item.title)).size, 12);
  assert.ok(items.every((item) => item.role && item.summary && item.skills.length));
  assert.ok(items.every((item) => new TextEncoder().encode(item.resume_text).length > 2000));
  assert.ok(items.some((item) => item.resume_text.includes('주요 구현')));
  assert.deepEqual(
    filterResumeExamples(items, 'LangGraph').map((item) => item.id),
    ['CV-001', 'CV-007', 'CV-009'],
  );
});
