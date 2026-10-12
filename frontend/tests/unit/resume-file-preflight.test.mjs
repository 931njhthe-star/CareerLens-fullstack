import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import {
  RESUME_MAX_BYTES,
  validateResumeFileMetadata,
  validateResumeFile,
} from '../../src/features/resumes/file-preflight.js';
import { resumeEditor } from '../../src/features/resumes/resume.js';
import { guestResumePage } from '../../src/features/resumes/guest.js';

test('Markdown preflight accepts Korean UTF-8, BOM, ordinary text and Windows line endings', async () => {
  for (const text of ['# 신영석의 이력서\n\n- 기술: Python, SQL 🚀', '경력\r\n\t서비스 개발', '\uFEFF# 경력\n프로젝트 구현']) {
    const result = await validateResumeFile(new File([text], '이력서.MD'));
    assert.equal(result.filename, '이력서.MD');
    assert.equal(result.text, text.replace(/^\uFEFF/u, ''));
  }
});

test('preflight rejects an unsupported extension or oversize file before reading its bytes', async () => {
  const unreadable = {
    arrayBuffer() { assert.fail('metadata failures must not read file bytes'); },
  };
  for (const name of ['resume.pdf', 'resume.docx', 'resume.txt', 'resume.markdown', 'resume.md.exe']) {
    await assert.rejects(validateResumeFile({ ...unreadable, name, size: 100 }), /Markdown\(\.md\)/);
  }
  await assert.rejects(
    validateResumeFile({ ...unreadable, name: 'large.md', size: RESUME_MAX_BYTES + 1 }),
    /10MB/,
  );
  assert.equal(validateResumeFileMetadata({ name: 'limit.md', size: RESUME_MAX_BYTES }), 'limit.md');
});

test('preflight rejects missing, empty and whitespace-only resume attachments', async () => {
  await assert.rejects(validateResumeFile(null), /먼저 선택/);
  await assert.rejects(validateResumeFile(new File([], 'empty.md')), /빈 파일/);
  await assert.rejects(validateResumeFile(new File(['\uFEFF\r\n\t  '], 'blank.md')), /본문이 비어/);
});

test('preflight rejects binary files renamed to md and invalid UTF-8 without correcting content', async () => {
  for (const bytes of [new Uint8Array([0xFF, 0xFE, 0x61, 0]), new Uint8Array([0xC3, 0x28])]) {
    await assert.rejects(validateResumeFile(new File([bytes], 'invalid.md')), /UTF-8/);
  }
  for (const content of ['%PDF-1.7\nrenamed document', 'PK\u0003\u0004archive', '# Text\n\u0000binary']) {
    await assert.rejects(validateResumeFile(new File([content], 'renamed.md')), /텍스트로 작성한/);
  }
});

test('file read failure offers recovery without uploading or exposing native errors', async () => {
  await assert.rejects(validateResumeFile({
    name: 'locked.md',
    size: 100,
    arrayBuffer: async () => { throw new Error('private file path'); },
  }), /파일을 읽지 못했습니다/);
});

test('member and guest choosers advertise only Markdown while the member editor retains paste', () => {
  for (const html of [resumeEditor({ resume_text: '' }), guestResumePage()]) {
    assert.match(html, /accept="\.md"/);
    assert.match(html, /Markdown\(\.md\)만 첨부 가능/);
    assert.match(html, /UTF-8 텍스트 · 최대 10MB/);
    assert.doesNotMatch(html, /accept="[^"]*(?:\.pdf|\.docx|\.txt)/);
  }
  assert.match(resumeEditor({ resume_text: '' }), /id="resume-text"/);
  assert.match(resumeEditor({ resume_text: '' }), /직접 붙여넣어도 좋아요/);
});
