import test from 'node:test';
import assert from 'node:assert/strict';
import { api, setSession } from '../../src/shared/api/client.js';
import { bindAuth } from '../../src/features/auth/auth.js';

test('password reset refreshes the session before the next login request', async () => {
  const globals = Object.fromEntries(
    ['document', 'location', 'history', 'fetch', 'FormData', 'setTimeout'].map((key) => [
      key,
      globalThis[key],
    ]),
  );
  const requests = [];
  let submit;
  let receivedSession;
  const button = { disabled: false, innerHTML: '비밀번호 변경', textContent: '' };
  const attributes = new Map();
  const form = {
    dataset: { action: 'reset-password' },
    addEventListener(type, listener) {
      if (type === 'submit') submit = listener;
    },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
    querySelectorAll: () => [button],
    querySelector: () => button,
  };
  try {
    globalThis.document = {
      querySelectorAll: () => [],
      getElementById: (id) => (id === 'auth-form' ? form : null),
    };
    globalThis.location = { pathname: '/', hash: '#/reset' };
    globalThis.history = { replaceState() {} };
    globalThis.setTimeout = (callback) => callback();
    globalThis.FormData = class {
      *[Symbol.iterator]() {
        yield ['password', 'new-password-123'];
      }
    };
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      const data = url.endsWith('/session')
        ? { user: null, csrf_token: 'new-session-csrf', providers: [], mail_mode: 'local' }
        : { message: '완료' };
      return { ok: true, json: async () => data };
    };
    setSession({ csrf_token: 'old-session-csrf' });
    bindAuth({
      resetToken: 'one-use-token',
      navigate() {},
      onSession: async (session) => {
        receivedSession = session;
        setSession(session);
      },
    });
    await submit({ preventDefault() {} });
    assert.equal(receivedSession.user, null);
    assert.equal(receivedSession.csrf_token, 'new-session-csrf');
    await api('/auth/login', {
      method: 'POST',
      body: { email: 'student@example.com', password: 'new-password-123' },
    });
    assert.equal(requests[0].options.headers['X-CSRF-Token'], 'old-session-csrf');
    assert.equal(requests.at(-1).options.headers['X-CSRF-Token'], 'new-session-csrf');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      token: 'one-use-token',
      password: 'new-password-123',
    });
    assert.equal(button.disabled, false);
  } finally {
    for (const [key, value] of Object.entries(globals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
