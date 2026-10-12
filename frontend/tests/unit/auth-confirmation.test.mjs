import test from 'node:test';
import assert from 'node:assert/strict';
import { bindAuth, renderAuth } from '../../src/features/auth/auth.js';
import { flowSnapshot } from '../../src/features/activity-flow/events.js';

test('signup includes plain confirmation guidance and a real login link', () => {
  const html = renderAuth('signup', { providers: [] });
  assert.match(html, /id="auth-confirmation"[^>]*hidden/);
  assert.match(html, /가장 최근에 받은 인증 메일의 링크를 한 번만/);
  assert.match(html, /이 창으로 돌아와 로그인/);
  assert.match(html, /href="#\/email">이메일로 로그인/);
  assert.doesNotMatch(html, /data-resend|인증 메일을 발송했습니다/);
});

for (const failed of [false, true]) {
  test(`signup ${failed ? 'failure offers existing-account recovery' : 'pending confirmation stays signed out'} without sending another email`, async () => {
    const globals = Object.fromEntries(
      ['document', 'fetch', 'FormData'].map((key) => [key, globalThis[key]]),
    );
    let submit;
    let sessionCalls = 0;
    let requests = 0;
    const messages = [];
    const confirmation = { hidden: true };
    const button = { disabled: false, innerHTML: '회원가입', textContent: '' };
    const attributes = new Map();
    const form = {
      dataset: { action: 'register' },
      addEventListener(type, handler) {
        if (type === 'submit') submit = handler;
      },
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: (key) => attributes.delete(key),
      querySelectorAll: () => [button],
      querySelector: () => button,
    };
    try {
      const existing = new Set(flowSnapshot().events.map(({ id }) => id));
      globalThis.document = {
        querySelectorAll: () => [],
        getElementById: (id) =>
          id === 'auth-form'
            ? form
            : id === 'auth-confirmation'
              ? confirmation
              : id === 'auth-notices'
                ? {
                    replaceChildren(node) {
                      messages.push(node.textContent);
                    },
                  }
                : null,
        createElement: () => ({ setAttribute() {}, scrollIntoView() {} }),
      };
      globalThis.FormData = class {
        *[Symbol.iterator]() {
          yield ['email', 'synthetic@example.test'];
          yield ['password', 'fixture-password'];
        }
      };
      globalThis.fetch = async (url) => {
        requests += 1;
        assert.equal(url, '/api/v1/auth/register');
        return failed
          ? Response.json({ detail: 'User already registered' }, { status: 409 })
          : Response.json({ access_token: null, email_confirmation_required: true });
      };
      bindAuth({
        onSession: async () => {
          sessionCalls += 1;
        },
      });
      await submit({ preventDefault() {} });
      assert.equal(requests, 1);
      assert.equal(sessionCalls, 0);
      assert.equal(confirmation.hidden, false);
      assert.equal(button.disabled, false);
      assert.match(
        messages[0],
        failed ? /이미 인증한 계정이라면 이메일로 로그인/ : /이메일 인증을 기다리고/,
      );
      assert.doesNotMatch(messages[0], /발송했습니다/);
      const events = flowSnapshot().events.filter(({ id }) => !existing.has(id));
      assert.ok(events.some(({ node, state }) => node === 'signup' && state === (failed ? 'failed' : 'waiting')));
      assert.equal(events.some(({ node }) => node === 'database' || node === 'auth'), false);
      assert.doesNotMatch(JSON.stringify(events), /synthetic@example|fixture-password/);
    } finally {
      for (const [key, value] of Object.entries(globals)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    }
  });
}
