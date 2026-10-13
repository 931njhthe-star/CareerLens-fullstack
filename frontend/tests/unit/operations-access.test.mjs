import test from 'node:test';
import assert from 'node:assert/strict';
import { isOperationsMember, mountMemberFlow } from '../../src/features/auth/operations-access.js';

test('operations accept ordinary members, never guests or synthetic accounts', () => {
  assert.equal(isOperationsMember({user: {id: 'member', is_admin: false}}), true);
  for (const session of [null, {}, {user: null}, {user: {}}, {user: {id: 'demo', demo: true}}])
    assert.equal(isOperationsMember(session), false);
});

test('guest and failed authentication never import the flow viewer or fetch its records', async () => {
  for (const readSession of [async () => ({user: null}),
    ...[401, 403].map((status) => async () => { throw Object.assign(new Error('PRIVATE'), { status }); })]) {
    const root = {innerHTML: ''};
    let loaded = false;
    await mountMemberFlow(root, {readSession, loadViewer: async () => {loaded = true;}});
    assert.equal(loaded, false);
    assert.match(root.innerHTML, /로그인 후/);
    assert.doesNotMatch(root.innerHTML, /PRIVATE/);
  }
});

function reconnectBrowser() {
  const browser = lifecycleBrowser();
  const pending = new Map();
  const delays = [];
  let nextId = 0;
  return Object.assign(browser, {
    delays,
    setTimeout(handler, delay) { const id = ++nextId; delays.push(delay); pending.set(id, handler); return id; },
    clearTimeout: (id) => pending.delete(id),
    pendingRetries: () => pending.size,
    retry() {
      const [id, handler] = pending.entries().next().value || [];
      pending.delete(id);
      return handler?.();
    },
  });
}

function retryRoot() {
  const listeners = new Map();
  return {
    innerHTML: '',
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    clickRetry: () => listeners.get('click')?.({ target: { closest: () => ({}) } }),
  };
}

test('initial temporary outage does not claim logout or mount data and recovers after verification', async () => {
  const browser = reconnectBrowser(), root = retryRoot();
  let calls = 0, mounts = 0;
  const cleanup = await mountMemberFlow(root, {
    browser,
    readSession: async () => {
      if (++calls === 1) throw Object.assign(new Error('PRIVATE'), { status: 503 });
      return { user: { id: 'member' } };
    },
    loadViewer: async () => ({ mountFlowViewer(target) { mounts++; target.innerHTML = 'verified flow'; return () => {}; } }),
  });
  assert.equal(mounts, 0);
  assert.match(root.innerHTML, /다시 연결/);
  assert.doesNotMatch(root.innerHTML, /로그인 후 이용|PRIVATE/);
  await browser.retry();
  assert.equal(mounts, 1);
  assert.equal(root.innerHTML, 'verified flow');
  assert.equal(browser.pendingRetries(), 0);
  cleanup();
});

test('an observer opened in the background still performs its first membership check', async () => {
  const browser = reconnectBrowser(), root = retryRoot();
  browser.document.hidden = true;
  let calls = 0;
  const cleanup = await mountMemberFlow(root, {
    browser,
    readSession: async () => { calls++; return { user: { id: 'member' } }; },
    loadViewer: async () => ({ mountFlowViewer(target) { target.innerHTML = 'verified flow'; return () => {}; } }),
  });
  assert.equal(calls, 1);
  assert.equal(root.innerHTML, 'verified flow');
  await browser.tick();
  assert.equal(calls, 1, 'periodic checks stay paused while hidden');
  cleanup();
});

test('a background observer recovers from a temporary outage through its bounded retry', async () => {
  const browser = reconnectBrowser(), root = retryRoot();
  browser.document.hidden = true;
  let calls = 0;
  const cleanup = await mountMemberFlow(root, {
    browser,
    readSession: async () => {
      if (++calls === 1) throw Object.assign(new Error('offline'), { status: 503 });
      return { user: { id: 'member' } };
    },
    loadViewer: async () => ({ mountFlowViewer(target) { target.innerHTML = 'verified flow'; return () => {}; } }),
  });
  assert.equal(browser.pendingRetries(), 1);
  await browser.retry();
  assert.equal(calls, 2, 'a hidden tab must not consume its retry without checking membership');
  assert.equal(root.innerHTML, 'verified flow');
  assert.equal(browser.pendingRetries(), 0);
  await browser.tick();
  assert.equal(calls, 2, 'ordinary periodic checks must still stay paused while hidden');
  cleanup();
});

test('a temporary membership-check failure hides existing data and has bounded retries and manual recovery', async () => {
  const browser = reconnectBrowser(), root = retryRoot();
  let unavailable = false, mounts = 0, disposed = 0, calls = 0;
  const cleanup = await mountMemberFlow(root, {
    browser,
    readSession: async () => {
      calls++;
      if (unavailable) throw Object.assign(new Error('PRIVATE'), { status: 502 });
      return { user: { id: 'member' } };
    },
    loadViewer: async () => ({ mountFlowViewer(target) { mounts++; target.innerHTML = 'private history'; return () => { disposed++; }; } }),
  });
  unavailable = true;
  await browser.fire('focus');
  assert.equal(disposed, 1);
  assert.doesNotMatch(root.innerHTML, /private|로그인 후 이용|PRIVATE/);
  for (let index = 0; index < 3; index++) await browser.retry();
  assert.deepEqual(browser.delays, [1000, 3000, 7000]);
  assert.equal(browser.pendingRetries(), 0);
  assert.equal(browser.active(), false);
  assert.equal(calls, 5);
  unavailable = false;
  root.clickRetry();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mounts, 2);
  assert.equal(root.innerHTML, 'private history');
  cleanup();
});

test('unauthorized retry locks access and disposal cancels all pending reconnect work', async () => {
  const browser = reconnectBrowser(), root = retryRoot();
  let status = 503;
  const cleanup = await mountMemberFlow(root, {
    browser, readSession: async () => { throw Object.assign(new Error('PRIVATE'), { status }); },
    loadViewer: async () => { throw new Error('must never import'); },
  });
  status = 401;
  await browser.retry();
  assert.match(root.innerHTML, /로그인 후 이용/);
  assert.equal(browser.pendingRetries(), 0);
  cleanup();
  const other = reconnectBrowser();
  const stop = await mountMemberFlow(root, { browser: other, readSession: async () => { throw new Error('offline'); } });
  assert.equal(other.pendingRetries(), 1);
  stop();
  assert.equal(other.pendingRetries(), 0);
});

test('a member can mount and expiry disposes the viewer and removes its data', async () => {
  const root = {innerHTML: ''};
  let options;
  let disposed = false;
  await mountMemberFlow(root, {
    readSession: async () => ({user: {id: 'normal-member', is_admin: false}}),
    loadViewer: async () => ({mountFlowViewer(target, input) {
      options = input; target.innerHTML = 'operational events';
      return () => {disposed = true;};
    }}),
  });
  assert.match(root.innerHTML, /operational/);
  options.onUnauthorized();
  assert.equal(disposed, true);
  assert.doesNotMatch(root.innerHTML, /operational/);
});

function lifecycleBrowser() {
  const listeners = new Map();
  let tick;
  return {
    document: { hidden: false },
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
    setInterval: (handler, delay) => { assert.equal(delay, 60000); tick = handler; return 1; },
    clearInterval: () => { tick = undefined; },
    fire: (name) => listeners.get(name)?.(),
    tick: () => tick?.(),
    active: () => Boolean(tick || listeners.size),
  };
}

for (const trigger of ['focus', 'pageshow', 'timer']) {
  test(`member access revalidates on ${trigger} even when the viewer is not polling`, async () => {
    const browser = lifecycleBrowser();
    const root = { innerHTML: '' };
    let member = true, disposed = false;
    const cleanup = await mountMemberFlow(root, {
      browser,
      readSession: async () => ({ user: member ? { id: 'member' } : null }),
      loadViewer: async () => ({ mountFlowViewer(target) {
        target.innerHTML = 'private operational history';
        return () => { disposed = true; };
      } }),
    });
    member = false;
    await (trigger === 'timer' ? browser.tick() : browser.fire(trigger));
    assert.equal(disposed, true);
    assert.match(root.innerHTML, /로그인 후/);
    assert.doesNotMatch(root.innerHTML, /private/);
    assert.equal(browser.active(), false);
    cleanup();
  });
}

test('member access rechecks are single-flight, skip hidden tabs and cannot mutate a disposed owner', async () => {
  const browser = lifecycleBrowser();
  const root = { innerHTML: '' };
  let release, calls = 0;
  const cleanup = await mountMemberFlow(root, {
    browser,
    readSession: () => ++calls === 1 ? Promise.resolve({ user: { id: 'member' } }) : new Promise((resolve) => { release = resolve; }),
    loadViewer: async () => ({ mountFlowViewer: () => () => {} }),
  });
  browser.document.hidden = true;
  await browser.tick(); assert.equal(calls, 1);
  browser.document.hidden = false;
  const verification = browser.fire('focus');
  await browser.tick(); assert.equal(calls, 2);
  cleanup(); root.innerHTML = 'replacement page';
  release({ user: null }); await verification;
  assert.equal(root.innerHTML, 'replacement page');
  assert.equal(browser.active(), false);
});
