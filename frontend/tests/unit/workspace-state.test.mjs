import test from 'node:test';
import assert from 'node:assert/strict';
import { draftForPage, remainingEdits } from '../../src/app/workspace-state.js';
import { workspacePage } from '../../src/pages/workspace.js';

const saved = {
  resume_text: '서버에 저장된 이력서',
  company: '회사A',
  role: '개발자A',
  job_text: '공고A',
  answers: { experience: '저장된 답변' },
  report: { score: 70, verdict: '회사A 분석', summary: '회사A 공고의 분석 결과' },
};

test('desired-role editor restores its own changes without mixing resume or posting edits', () => {
  const draft = {
    ...saved,
    career_target: { role_id: 'custom', label: '저장한 직무', focus: '저장한 관심 사항' },
  };
  const edits = {
    resume_text: '수정 중인 이력서',
    company: '수정 중인 회사',
    job_text: '수정 중인 공고',
    role: '수정 중인 직무',
    role_id: 'custom',
    focus: '수정 중인 관심 사항',
  };
  const editor = draftForPage('desired-role', draft, edits);
  assert.equal(editor.resume_text, saved.resume_text);
  assert.equal(editor.company, saved.company);
  assert.equal(editor.job_text, saved.job_text);
  assert.deepEqual(editor.career_target, {
    role_id: 'custom',
    label: '수정 중인 직무',
    focus: '수정 중인 관심 사항',
  });
  assert.equal(draft.career_target.label, '저장한 직무');
  assert.deepEqual(draftForPage('questions', draft, edits).career_target, draft.career_target);
  assert.equal(draftForPage('result', draft, edits), draft);
});

test('editing company B without saving keeps report A labeled as company A', () => {
  const edits = { company: '회사B', role: '개발자B', job_text: '공고B' };
  const result = workspacePage('result', draftForPage('result', saved, edits), []);
  assert.ok(result.includes('회사A'));
  assert.ok(result.includes('회사A 공고의 분석 결과'));
  assert.ok(!result.includes('회사B'));
  assert.ok(!result.includes('개발자B'));
  assert.equal(draftForPage('job', saved, edits).company, '회사B');
});

test('saving a job after navigating away from the resume keeps unsaved resume text', () => {
  const edits = {
    resume_text: '아직 저장하지 않은 이력서 수정',
    company: '회사B',
    role: '개발자B',
    job_text: '공고B',
  };
  const responseDraft = {
    ...saved,
    company: edits.company,
    role: edits.role,
    job_text: edits.job_text,
    report: null,
  };
  const nextEdits = remainingEdits(edits, ['company', 'role', 'job_text']);
  assert.equal(draftForPage('resume', responseDraft, nextEdits).resume_text, edits.resume_text);
  assert.equal(draftForPage('job', responseDraft, nextEdits).resume_text, saved.resume_text);
  assert.equal(draftForPage('job', responseDraft, nextEdits).company, '회사B');
  assert.deepEqual(Object.keys(nextEdits), ['resume_text']);
});

test('saving resume or analyzing answers preserves the other editors', () => {
  const edits = {
    resume_text: '편집 이력서',
    company: '회사B',
    answers: { experience: '아직 저장하지 않은 답변' },
  };
  const afterResume = remainingEdits(edits, ['resume_text']);
  assert.equal(draftForPage('job', saved, afterResume).company, '회사B');
  const questions = draftForPage('questions', saved, afterResume);
  assert.equal(questions.company, '회사A');
  assert.equal(questions.answers.experience, '아직 저장하지 않은 답변');
  assert.equal(remainingEdits(afterResume, ['answers']).company, '회사B');
  assert.equal(saved.answers.experience, '저장된 답변');
});

test('changed saved analysis input invalidates old answer edits but preserves other editors', () => {
  const edits = {
    resume_text: '이력서 수정 중',
    company: '회사B',
    answers: { experience: '이전 질문에 쓰던 답변' },
  };
  const updatedJob = { ...saved, company: '회사B', answers: {}, report: null };
  const afterJob = remainingEdits(edits, ['company', 'role', 'job_text'], saved, updatedJob);
  assert.equal(afterJob.resume_text, '이력서 수정 중');
  assert.equal(afterJob.answers, undefined);
  assert.deepEqual(draftForPage('questions', updatedJob, afterJob).answers, {});

  const updatedResume = { ...saved, resume_text: '새로 저장한 이력서', answers: {}, report: null };
  const afterResume = remainingEdits(edits, ['resume_text'], saved, updatedResume);
  assert.equal(afterResume.company, '회사B');
  assert.equal(afterResume.answers, undefined);
  assert.deepEqual(remainingEdits(edits, [], saved, { ...saved }).answers, edits.answers);
});
