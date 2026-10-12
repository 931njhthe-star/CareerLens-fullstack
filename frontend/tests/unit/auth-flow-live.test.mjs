import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { bindAuth } from '../../src/features/auth/auth.js';
import { api, getSession, setSession } from '../../src/shared/api/client.js';
import { enableBackendAdapter } from '../../src/shared/api/backend-adapter.js';
import * as flow from '../../src/features/activity-flow/events.js';
import { remainingEdits } from '../../src/app/workspace-state.js';

const controller = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
  .replace(/\bstart\(\);\s*$/, '');
const settle = () => new Promise(setImmediate);

// The credential handler, API adapter, verified-session callback, metadata store
// and channel publisher are production code. Only HTTP and browser surfaces are
// synthetic; this never authenticates a real account or requests model work.
for (const action of ['login', 'register']) {
  test(`${action} publishes verified member state to an already subscribed viewer before workspace loading finishes`, async () => {
    const names = ['document', 'window', 'location', 'history', 'sessionStorage', 'BroadcastChannel', 'fetch', 'FormData'];
    const originals = Object.fromEntries(names.map((key) => [key, globalThis[key]]));
    const stored = new Map();
    const channels = [];
    const messages = [];
    const notices = [];
    const requests = [];
    const attributes = new Map();
    const lifecycle = new Map();
    const app = { dataset: {}, innerHTML: '' };
    const button = { disabled: false, innerHTML: 'submit' };
    let submit;
    let releaseWorkspace;
    const workspace = new Promise((resolve) => { releaseWorkspace = resolve; });
    let workspaceRequested = false;
    const form = {
      dataset: { action },
      addEventListener(type, handler) { if (type === 'submit') submit = handler; },
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: (key) => attributes.delete(key),
      querySelectorAll: () => [button], querySelector: () => button,
    };
    let dispose;
    try {
      globalThis.document = {
        getElementById: (id) => id === 'app' ? app : id === 'auth-form' ? form
          : id === 'auth-notices' ? { replaceChildren(node) { notices.push(node.textContent); } } : null,
        querySelector: () => null, querySelectorAll: () => [],
        createElement: () => ({ setAttribute() {}, scrollIntoView() {} }),
      };
      globalThis.window = {
        addEventListener(type, listener) {
          if (!lifecycle.has(type)) lifecycle.set(type, new Set());
          lifecycle.get(type).add(listener);
        },
        removeEventListener(type, listener) { lifecycle.get(type)?.delete(listener); },
      };
      globalThis.location = { pathname: '/', search: '', hash: action === 'login' ? '#/email' : '#/signup' };
      globalThis.history = {};
      globalThis.sessionStorage = {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, String(value)),
        removeItem: (key) => stored.delete(key),
        key: (index) => [...stored.keys()][index] ?? null,
        get length() { return stored.size; },
      };
      globalThis.BroadcastChannel = class {
        constructor(name) { this.name = name; this.listeners = []; channels.push(this); }
        addEventListener(_type, listener) { this.listeners.push(listener); }
        postMessage(data) {
          for (const other of channels) if (other !== this && !other.closed && other.name === this.name)
            for (const listener of other.listeners) listener({ data: structuredClone(data) });
        }
        close() { this.closed = true; }
      };
      globalThis.FormData = class {
        *[Symbol.iterator]() { yield ['email', 'PRIVATE_EMAIL@example.test']; yield ['password', 'PRIVATE_PASSWORD']; }
      };
      globalThis.fetch = async (url) => {
        requests.push(url);
        if (url === '/api/v1/auth/login' || url === '/api/v1/auth/signup')
          return Response.json({ access_token: 'PRIVATE_ACCESS', refresh_token: 'PRIVATE_REFRESH', user_id: 'PRIVATE_OWNER' });
        if (url === '/api/v1/me') return Response.json({ id: 'PRIVATE_OWNER', email: 'PRIVATE_EMAIL@example.test' });
        if (url === '/api/v1/local-guest/capabilities') return Response.json({ available: true, storage_origin: 'frontend_guest' });
        assert.fail(`Unexpected HTTP request: ${url}`);
      };
      enableBackendAdapter();
      flow.setFlowSession('guest', { resetRun: true });
      flow.recordFlowEvent('auth', { kind: 'session' });
      dispose = flow.mountFlowLauncher();
      const stream = new URL(flow.getFlowViewerUrl(), 'http://localhost').searchParams.get('stream');
      const viewer = new BroadcastChannel(flow.FLOW_CHANNEL);
      viewer.addEventListener('message', ({ data }) => { if (data.stream === stream) messages.push(data); });
      viewer.postMessage({ kind: 'subscribe', stream });
      assert.equal(messages.at(-1).session.mode, 'guest');
      messages.length = 0;

      const context = vm.createContext({
        ...flow, document, window, location, history, URLSearchParams, AbortController, DOMException,
        setTimeout, clearTimeout, setSession, getSession, remainingEdits,
        stopCatalogLoad() {}, stopResumeExamples() {}, clearCatalogEdits() {},
        destinations: [],
        api: async (path, options) => {
          if (path === '/workspace') { workspaceRequested = true; return workspace; }
          return api(path, options);
        },
      });
      vm.runInContext(controller, context);
      vm.runInContext(`session = { user: null, backend_adapter: true };
        workspace = { draft: {}, questions: [] };
        navigate = (page) => destinations.push(page);`, context);
      bindAuth({ onSession: context.onSession });
      const pending = submit({ preventDefault() {} });
      for (let index = 0; index < 12 && !workspaceRequested; index++) await settle();
      assert.equal(workspaceRequested, true);
      assert.equal(button.disabled, true, 'profile verification finished but workspace loading is still pending');
      const member = messages.findIndex((message) => message.kind === 'snapshot' && message.session.mode === 'member');
      const verified = messages.findIndex((message) => message.kind === 'event' && message.event.node === 'auth'
        && message.event.kind === 'session' && message.event.sessionMode === 'member');
      assert.ok(member >= 0 && verified > member, 'verified login is delivered immediately to the open viewer');
      assert.equal(channels.filter((channel) => !channel.closed).length, 2, 'login keeps the existing app/viewer channel pair');
      assert.equal(new URL(flow.getFlowViewerUrl(), 'http://localhost').searchParams.get('stream'), stream);
      assert.ok(messages.every((message) => message.stream === stream));
      assert.doesNotMatch(JSON.stringify(messages), /PRIVATE_|password|access_token|refresh_token/);
      assert.ok(requests.includes(action === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/signup'));
      assert.ok(requests.includes('/api/v1/me'));
      releaseWorkspace({ draft: {}, questions: [] });
      await pending;
      assert.deepEqual(notices, []);
      assert.equal(context.destinations.at(-1), 'resume');
      viewer.postMessage({ kind: 'subscribe', stream });
      assert.equal(messages.at(-1).session.mode, 'member');
      assert.equal(messages.at(-1).states.find(({ node }) => node === 'auth').sessionMode, 'member');
      viewer.close();
    } finally {
      releaseWorkspace({ draft: {}, questions: [] });
      dispose?.();
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
      }
    }
  });
}
