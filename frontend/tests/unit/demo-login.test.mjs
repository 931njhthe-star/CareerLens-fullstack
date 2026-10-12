import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, getSession, startDemoSession } from '../../src/shared/api/client.js';
import { renderAuth } from '../../src/features/auth/auth.js';
import { shell } from '../../src/shared/components/ui.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

beforeEach(() => {
  globalThis.sessionStorage = createStorage();
});

test('email login page offers an explicitly offline demo account', () => {
  const html = renderAuth('email', { providers: [] });
  assert.match(html, /data-demo-login/);
  assert.match(html, /시연용 계정으로 로그인/);
  assert.match(html, /백엔드 인증 없이/);
});

test('demo login keeps resume and mock analysis in this tab without backend requests', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    assert.fail('Demo account must not send requests to the backend');
  };
  try {
    startDemoSession();
    const session = await getSession();
    assert.deepEqual(session.user, {
      id: 'demo-user',
      email: 'demo@careerlens.local',
      name: '시연',
      demo: true,
    });
    const app = shell('<p>demo</p>', { user: session.user });
    assert.match(app, /시연 계정/);
    assert.match(app, /백엔드에 전송되지 않습니다/);

    const resume =
      '프로젝트에서 API를 개발하고 운영하며 성능을 개선한 경험이 있습니다. 협업을 통해 서비스 안정성도 높였습니다.';
    await api('/resume', { method: 'PUT', body: { resume_text: resume } });
    const postings = await api('/job-postings?page=1&page_size=12');
    assert.ok(postings.items.length > 0);
    const selected = postings.items[0];
    await api(`/job-postings/${encodeURIComponent(selected.id)}/select`, {
      method: 'POST',
      body: {},
    });
    const analysis = await api('/analysis', { method: 'POST', body: { answers: {} } });
    const workspace = await api('/workspace');
    assert.equal(analysis.report.demo, true);
    assert.match(analysis.report.summary, new RegExp(selected.company));
    assert.equal(workspace.draft.resume_text, resume);
    assert.equal(workspace.draft.selected_posting_id, selected.id);
    assert.equal(workspace.draft.report.demo, true);

    await api('/auth/logout', { method: 'POST', body: {} });
    assert.equal((await getSession()).user, null);
    assert.equal(globalThis.sessionStorage.getItem('careerlens.backend.demo-workspace'), null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
