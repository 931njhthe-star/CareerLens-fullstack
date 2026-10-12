import test from 'node:test';
import assert from 'node:assert/strict';
import { shell, renderPrimaryNav, renderPostingPhases } from '../../src/shared/components/ui.js';
import { introductionPage } from '../../src/pages/introduction.js';
import {
  bindIntroduction,
  INTRODUCTION_DURATION_MS,
} from '../../src/features/introduction/intro.js';

const navigationLinks = (markup) => [
  ...markup.matchAll(/<a href="#\/([^"]+)"([^>]*)>([^<]+)<\/a>/g),
];

test('global navigation has three workflow destinations while the brand opens home', () => {
  for (const [page, current] of [
    ['intro', null],
    ['resume', 'resume'],
    ['desired-role', 'desired-role'],
    ['job', 'desired-role'],
    ['jobs', 'desired-role'],
    ['opportunities', 'desired-role'],
    ['practice', 'practice'],
    ['preparing', null],
    ['questions', null],
    ['result', 'practice'],
    ['email', null],
    ['register', null],
  ]) {
    const markup = renderPrimaryNav(page);
    const links = navigationLinks(markup);
    assert.deepEqual(
      links.map((link) => [link[1], link[3]]),
      [
        ['resume', '이력서'],
        ['desired-role', '채용공고'],
        ['practice', '모의 지원'],
      ],
    );
    assert.deepEqual(
      links.filter((link) => link[2].includes('aria-current="page"')).map((link) => link[1]),
      current ? [current] : [],
    );
  }
});

test('desired-role and posting selection share the global posting destination and second step', () => {
  const draft = { resume_text: '경력', career_target: { role_id: 'developer' } };
  const markup = shell('', { page: 'desired-role', draft });
  const header = markup.slice(0, markup.indexOf('</header>'));
  assert.doesNotMatch(header, /희망 직무/);
  assert.match(header, /aria-current="page">채용공고/);
  assert.match(
    markup,
    /aria-current="step"[^>]*>\s*<span class="step-number">2<\/span>[\s\S]*?<span>채용공고<\/span>/,
  );
});

test('posting navigation opens the chosen role and starts role selection without one', () => {
  const draft = { career_target: { role_id: 'custom', label: '데이터 & AI "분석"' } };
  for (const markup of [
    renderPrimaryNav('opportunities', draft),
    shell('', { page: 'opportunities', draft }),
  ]) {
    const postings = navigationLinks(markup).find((link) => link[3] === '채용공고');
    assert.match(postings[1], /^opportunities\?role_id=custom&amp;label=/);
    assert.match(postings[2], /aria-current="page"/);
    const query = new URLSearchParams(postings[1].replaceAll('&amp;', '&').split('?')[1]);
    assert.equal(query.get('role_id'), 'custom');
    assert.equal(query.get('label'), draft.career_target.label);
  }
  for (const draft of [undefined, {}, { career_target: { label: '미선택' } }]) {
    const postings = navigationLinks(renderPrimaryNav('email', draft)).find(
      (link) => link[3] === '채용공고',
    );
    assert.equal(postings[1], 'desired-role');
    assert.ok(!postings[2].includes('aria-current'));
  }
});

test('workflow indicator has three steps and groups both posting phases under step two', () => {
  const draft = { resume_text: '경력', career_target: { role_id: 'developer' } };
  for (const [page, activeLabel] of [
    ['resume', '이력서'],
    ['desired-role', '채용공고'],
    ['job', '채용공고'],
    ['jobs', '채용공고'],
    ['opportunities', '채용공고'],
    ['practice', '모의 지원'],
    ['preparing', '모의 지원'],
    ['questions', '모의 지원'],
    ['result', '모의 지원'],
  ]) {
    const markup = shell('', { page, draft });
    const headerEnd = markup.indexOf('</header>');
    const indicatorStart = markup.indexOf('aria-label="모의지원 진행 단계"');
    assert.ok(indicatorStart > headerEnd);
    assert.equal([...markup.matchAll(/class="step(?: |")/g)].length, 3);
    const currentStep = markup.match(
      /<(?:a|span)\s+[^>]*class="step active[^>]*>[\s\S]*?<span>([^<]+)<\/span>/,
    );
    assert.equal(currentStep?.[1], activeLabel, page);
  }
});

test('workflow links require the relevant data, including a posting before practice', () => {
  const workflowLinks = (draft) => {
    const markup = shell('', { page: 'resume', draft });
    const workflow = markup.match(/<nav\s+class="steps"[\s\S]*?<\/nav>/)[0];
    return [...workflow.matchAll(/href="#\/([^"]+)"/g)].map((link) => link[1]);
  };
  assert.deepEqual(workflowLinks({}), ['resume']);
  assert.deepEqual(workflowLinks({ resume_text: '경력' }), ['resume', 'desired-role']);
  assert.deepEqual(workflowLinks({ guest: true }), ['resume', 'desired-role']);
  const draft = { resume_text: '경력', career_target: { role_id: 'developer' } };
  const beforeSelection = workflowLinks(draft);
  assert.equal(beforeSelection.length, 2);
  assert.match(beforeSelection[1], /^opportunities\?role_id=developer&amp;label=&amp;scope=category&amp;page=1$/);
  assert.ok(!beforeSelection.includes('practice'));
  for (const ready of [
    { selected_posting_id: 'posting-1' },
    { job_text: '실제 선택한 공고 본문' },
    { preparation: { complete: true } },
    { report: { id: 'report-1' } },
    { report_locked: true },
  ]) {
    assert.ok(workflowLinks({ ...draft, ...ready }).includes('practice'));
  }
});

test('posting inner phases keep role selection first and allow return from the posting list', () => {
  const start = renderPostingPhases('role');
  assert.match(start, /href="#\/desired-role" aria-current="step"/);
  assert.match(start, /aria-disabled="true"><span>2<\/span> 공고 선택/);
  const ready = renderPostingPhases('role', { role_id: 'role-001', label: '데이터 분석' });
  assert.doesNotMatch(ready, /href="#\/opportunities/);
  assert.match(ready, /aria-disabled="true"/);
  const postings = renderPostingPhases('posting');
  assert.match(postings, /href="#\/desired-role"/);
  assert.match(postings, /aria-current="step"><span>2<\/span> 공고 선택/);
});

test('introduction and auth have no workflow indicator', () => {
  for (const page of ['intro', 'login', 'email', 'register']) {
    const markup = shell('', { page });
    assert.ok(!markup.includes('aria-label="모의지원 진행 단계"'), page);
    assert.match(markup, /class="brand"\s+href="#\/intro"/);
  }
  const markup = introductionPage();
  assert.match(markup, /data-intro-skip/);
  assert.match(markup, /잠시 후 이력서 화면으로 이동합니다/);
});

function introHarness(t) {
  const listeners = new Map();
  const skip = {
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: (type) => listeners.delete(type),
  };
  const root = { querySelector: () => skip };
  const originalDocument = globalThis.document;
  globalThis.document = { querySelector: () => root };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  let callback;
  let duration;
  let cancelled = false;
  t.mock.method(globalThis, 'setTimeout', (action, delay) => {
    callback = action;
    duration = delay;
    return 7;
  });
  t.mock.method(globalThis, 'clearTimeout', (id) => {
    assert.equal(id, 7);
    cancelled = true;
  });
  return {
    skip: () => listeners.get('click')?.(),
    finish: () => callback(),
    delay: () => duration,
    cancelled: () => cancelled,
    listenerCount: () => listeners.size,
  };
}

test('introduction completes once after the short presentation', (t) => {
  const intro = introHarness(t);
  let completed = 0;
  bindIntroduction({ onComplete: () => completed++ });
  assert.equal(intro.delay(), INTRODUCTION_DURATION_MS);
  assert.equal(INTRODUCTION_DURATION_MS, 2500);
  intro.finish();
  intro.finish();
  assert.equal(completed, 1);
  assert.equal(intro.listenerCount(), 0);
});

test('skip completes immediately and prevents a second timer navigation', (t) => {
  const intro = introHarness(t);
  let completed = 0;
  bindIntroduction({ onComplete: () => completed++ });
  intro.skip();
  assert.equal(completed, 1);
  assert.ok(intro.cancelled());
  intro.finish();
  assert.equal(completed, 1);
});

test('leaving introduction cancels delayed navigation and allows a fresh replay', (t) => {
  const intro = introHarness(t);
  let completed = 0;
  const dispose = bindIntroduction({ onComplete: () => completed++ });
  dispose();
  intro.finish();
  intro.skip();
  assert.equal(completed, 0);
  assert.ok(intro.cancelled());
  assert.equal(intro.listenerCount(), 0);
  bindIntroduction({ onComplete: () => completed++ });
  intro.finish();
  assert.equal(completed, 1);
});
