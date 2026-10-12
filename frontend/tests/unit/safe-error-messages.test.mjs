import test from 'node:test';
import assert from 'node:assert/strict';
import { publicErrorMessage, safeErrorCode } from '../../src/shared/api/error-messages.js';
import { validateResumeFile } from '../../src/features/resumes/file-preflight.js';

test('native exceptions and unknown codes are never treated as user-facing text', () => {
  for (const error of [null, 'secret', new Error('/srv/app.py sk-synthetic'),
    { message: 'SQL failed: postgres://private:secret@db', status: 500, code: 'sk-synthetic' },
    { message: 'private', status: 500, code: '__proto__' },
    { message: 'private', status: 400, code: 'constructor' }]) {
    assert.doesNotMatch(publicErrorMessage(error), /private|secret|SQL|postgres|synthetic|app.py/);
    assert.equal(typeof publicErrorMessage(error), 'string');
  }
  assert.equal(safeErrorCode('sk-synthetic', 404), 'not_found');
  assert.equal(safeErrorCode('report_list_invalid', 502), 'report_list_invalid');
});

test('known conditions use concrete recovery actions without service implementation terms', () => {
  for (const [status, expected] of [[401, /로그인/], [403, /권한/], [404, /새로고침/],
    [409, /새로고침/], [410, /만료/], [413, /10MB/], [415, /파일 형식/],
    [422, /입력/], [429, /잠시/], [503, /다시 시도/], [504, /상태를 확인/]]) {
    assert.match(publicErrorMessage({ status, message: 'private detail' }), expected);
  }
  for (const code of ['backend_unconfigured', 'backend_unavailable', 'missing_access_token',
    'profile_invalid', 'report_result_invalid', 'evaluation_failed']) {
    assert.doesNotMatch(publicErrorMessage({ status: 502, code }), /백엔드|API|DB|token|\.env|서버 실행/);
  }
});

test('exact local file validation survives while appended diagnostics are dropped', async () => {
  for (const file of [null, { name: 'wrong.pdf', size: 1 }, { name: 'large.md', size: 11 * 1024 * 1024 },
    { name: 'empty.md', size: 0 }, { name: 'unreadable.md', size: 1, arrayBuffer: async () => { throw new Error('private'); } }]) {
    await assert.rejects(validateResumeFile(file), (error) => {
      assert.equal(publicErrorMessage(error), error.message);
      assert.notEqual(publicErrorMessage(new Error(error.message + ' /srv/private.py')), error.message + ' /srv/private.py');
      return true;
    });
  }
});
