import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reportGatePage, bindReportGate } from '../../src/features/auth/report-gate.js';
import { guestResumePage, guestFileMetadata } from '../../src/features/resumes/guest.js';

test('guest attachment permits uploading and continuing without an editor or preview', () => {
  const html = guestResumePage('<script>private</script>.pdf');
  assert.match(html, /id="guest-upload-form"/);
  assert.match(html, /id="guest-resume-file" name="file" type="file"[^>]*required/);
  assert.match(html, /accept="\.md,\.pdf,\.docx,\.txt"/);
  assert.match(html, /type="submit"[^>]*>첨부한 이력서로 계속/);
  assert.match(html, /예시 데이터로 만드는 시연용 결과/);
  assert.match(html, /파일은 백엔드로 전송하지 않고/);
  assert.doesNotMatch(html, /서버로 전송해|원본 파일은 저장하지 않습니다/);
  assert.match(html, /30분/);
  assert.match(html, /&lt;script&gt;private&lt;\/script&gt;/);
  assert.doesNotMatch(
    html,
    /<script>|<textarea|contenteditable|<iframe|<object|resume-preview|resume-examples/,
  );
  assert.doesNotMatch(html, /disabled|전송하거나 읽지 않습니다|파일명만 확인/);
  const attached = guestResumePage({ filename: '경험.pdf', resume_attached: true });
  assert.match(attached, /첨부 완료 · 경험.pdf/);
  assert.doesNotMatch(attached, /\brequired\b/);
});

test('guest file metadata validates 10MB and format without reading the file', () => {
  const file = {
    name: '경험.PDF',
    size: 10 * 1024 * 1024,
    text: () => assert.fail('metadata validation must not read text'),
    arrayBuffer: () => assert.fail('metadata validation must not read bytes'),
  };
  assert.equal(guestFileMetadata(file), '경험.PDF');
  assert.equal(guestFileMetadata({ name: 'resume.MD', size: 100 }), 'resume.MD');
  assert.equal(guestFileMetadata(null), '');
  assert.throws(() => guestFileMetadata({ ...file, size: file.size + 1 }), /10MB/);
  assert.throws(
    () => guestFileMetadata({ name: 'wrong.html', size: 12 }),
    /Markdown, PDF, DOCX, TXT/,
  );
});

test('report gate contains only an empty inaccessible skeleton and explicit auth or discard actions', () => {
  const html = reportGatePage({ report: { score: 97, summary: 'PRIVATE_REPORT_SECRET' } });
  assert.match(html, /분석이 완료되었어요/);
  const demoHtml = reportGatePage({ demo: true });
  assert.match(demoHtml, /시연용 결과가 준비됐어요/);
  assert.match(
    demoHtml,
    /예시 데이터로 만든 화면 시연용이며 실제 이력서와 공고를 평가하지 않습니다/,
  );
  assert.match(
    html,
    /로그인·회원가입 없이 임시 보관 시간이 지나면 첨부한 이력서와 분석 결과가 자동 삭제됩니다\./,
  );
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /report-gate__skeleton" aria-hidden="true" inert/);
  for (const action of ['login', 'signup', 'discard'])
    assert.match(html, new RegExp(`data-report-gate-${action}`));
  assert.match(html, /이력서와 결과 파기하기/);
  assert.match(html, /id="report-gate-error"[^>]*role="alert" hidden/);
  assert.doesNotMatch(
    html,
    /PRIVATE_REPORT_SECRET|97|점수|평가 점수|print-report|download=|data-report-gate-close/,
  );
  const skeleton = html.split('<div class="report-gate__shade">')[0];
  assert.equal(skeleton.replace(/<[^>]*>/g, '').trim(), '');
  const css = readFileSync(
    new URL('../../src/shared/styles/report-gate.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /@media print\s*\{\s*\.report-gate,[\s\S]*display: none !important/);
});

test('expiry rendering accepts a valid date and cannot inject untrusted markup', () => {
  assert.match(
    reportGatePage({ expires_at: '2026-10-08T12:30:00Z' }),
    /<time datetime="2026-10-08T12:30:00.000Z">/,
  );
  assert.match(reportGatePage({ expires_at: '2026-10-08T12:30:00Z' }), /기기 시간 기준/);
  for (const expires_at of ['<img src=x onerror=alert(1)>', '', null, 0, 'invalid']) {
    const html = reportGatePage({ expires_at });
    assert.doesNotMatch(html, /<time|<img|Invalid Date/);
  }
});

function modalHarness() {
  const doc = new EventTarget();
  class Element extends EventTarget {
    constructor(parentElement) {
      super();
      this.ownerDocument = doc;
      this.parentElement = parentElement;
      this.children = [];
      this.attributes = new Map();
      this.style = {};
      this.disabled = false;
      this.hidden = false;
      this.isConnected = true;
      parentElement?.children.push(this);
    }
    getAttribute(key) {
      return this.attributes.get(key) ?? null;
    }
    setAttribute(key, value) {
      this.attributes.set(key, value);
    }
    removeAttribute(key) {
      this.attributes.delete(key);
    }
    focus() {
      doc.activeElement = this;
    }
    contains(target) {
      for (let node = target; node; node = node.parentElement) if (node === this) return true;
      return false;
    }
  }
  doc.body = new Element();
  doc.body.style.overflow = 'clip';
  const header = new Element(doc.body);
  header.setAttribute('aria-hidden', 'false');
  const main = new Element(doc.body);
  const footer = new Element(doc.body);
  footer.setAttribute('inert', '');
  const notice = new Element(main);
  const gate = new Element(main);
  const dialog = new Element(gate);
  const login = new Element(dialog);
  const signup = new Element(dialog);
  const discard = new Element(dialog);
  const errorMessage = new Element(dialog);
  errorMessage.hidden = true;
  const selectors = {
    '[data-report-gate]': gate,
    '[role="dialog"]': dialog,
    '[data-report-gate-login]': login,
    '[data-report-gate-signup]': signup,
    '[data-report-gate-discard]': discard,
    '#report-gate-error': errorMessage,
  };
  doc.querySelector = gate.querySelector = (selector) => selectors[selector];
  header.focus();
  const key = (key, shiftKey = false) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key, shiftKey });
    doc.dispatchEvent(event);
    return event;
  };
  return {
    doc,
    header,
    main,
    footer,
    notice,
    gate,
    dialog,
    login,
    signup,
    discard,
    errorMessage,
    key,
  };
}

test('modal traps focus, Escape is nondestructive, and disposal restores the surrounding page', async () => {
  const h = modalHarness();
  let discarded = 0;
  const dispose = bindReportGate({ root: h.doc, onDiscard: () => discarded++ });
  assert.equal(h.doc.activeElement, h.dialog);
  assert.equal(h.doc.body.style.overflow, 'hidden');
  for (const node of [h.header, h.footer, h.notice]) {
    assert.equal(node.getAttribute('inert'), '');
    assert.equal(node.getAttribute('aria-hidden'), 'true');
  }
  assert.equal(h.main.getAttribute('inert'), null);
  assert.equal(h.key('Tab').defaultPrevented, true);
  assert.equal(h.doc.activeElement, h.login);
  h.key('Tab', true);
  assert.equal(h.doc.activeElement, h.discard);
  h.key('Tab');
  assert.equal(h.doc.activeElement, h.login);
  h.key('Escape');
  assert.equal(h.doc.activeElement, h.discard);
  assert.equal(discarded, 0);
  const focus = new Event('focusin');
  Object.defineProperty(focus, 'target', { value: h.header });
  h.doc.dispatchEvent(focus);
  assert.equal(h.doc.activeElement, h.dialog);
  h.discard.dispatchEvent(new Event('click'));
  await new Promise(setImmediate);
  assert.equal(discarded, 1);
  dispose();
  assert.equal(h.doc.activeElement, h.header);
  assert.equal(h.doc.body.style.overflow, 'clip');
  assert.equal(h.header.getAttribute('aria-hidden'), 'false');
  assert.equal(h.header.getAttribute('inert'), null);
  assert.equal(h.footer.getAttribute('inert'), '');
  assert.equal(h.footer.getAttribute('aria-hidden'), null);
  assert.equal(h.notice.getAttribute('aria-hidden'), null);
  h.discard.dispatchEvent(new Event('click'));
  assert.equal(discarded, 1);
  assert.equal(h.key('Escape').defaultPrevented, false);
  dispose();
});

test('a failed action stays in the gate, announces its error and allows retry', async () => {
  const h = modalHarness();
  let reject;
  let calls = 0;
  const dispose = bindReportGate({
    root: h.doc,
    onDiscard: () => {
      calls++;
      return new Promise((resolve, fail) => {
        reject = fail;
      });
    },
  });
  h.discard.dispatchEvent(new Event('click'));
  h.discard.dispatchEvent(new Event('click'));
  assert.equal(calls, 1);
  assert.equal(h.dialog.getAttribute('aria-busy'), 'true');
  assert.ok([h.login, h.signup, h.discard].every((button) => button.disabled));
  h.key('Escape');
  assert.equal(h.doc.activeElement, h.dialog);
  reject(new Error('삭제하지 못했습니다. 다시 시도해 주세요.'));
  await new Promise(setImmediate);
  assert.equal(h.errorMessage.hidden, false);
  assert.equal(h.errorMessage.textContent, '삭제하지 못했습니다. 다시 시도해 주세요.');
  assert.equal(h.dialog.getAttribute('aria-busy'), null);
  assert.ok([h.login, h.signup, h.discard].every((button) => !button.disabled));
  assert.equal(h.header.getAttribute('inert'), '');
  dispose();
});

test('login and signup call their own handlers without discarding the guest session', async () => {
  const h = modalHarness();
  const calls = [];
  const dispose = bindReportGate({
    root: h.doc,
    onLogin: () => calls.push('login'),
    onSignup: () => calls.push('signup'),
    onDiscard: () => assert.fail('auth must not discard'),
  });
  h.login.dispatchEvent(new Event('click'));
  await new Promise(setImmediate);
  h.signup.dispatchEvent(new Event('click'));
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['login', 'signup']);
  dispose();
});
