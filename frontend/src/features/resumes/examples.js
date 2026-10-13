import { publicErrorMessage } from '../../shared/api/error-messages.js';
import { escapeHtml as e } from '../../shared/components/ui.js';

const PAGE_SIZE = 12;
const EXAMPLE_FILES = Array.from(
  { length: 12 },
  (_, index) => `CV-${String(index + 1).padStart(3, '0')}.md`,
);
let request;

function markdownField(markdown, label) {
  const row = markdown.match(new RegExp(`^\\|\\s*${label}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, 'm'));
  return row?.[1]?.trim() || '';
}

export function parseResumeExample(filename, markdown) {
  const id = /^CV-(\d{3})\.md$/.exec(filename)?.[1];
  const name = markdownField(markdown, '이름');
  const role = markdownField(markdown, '지원 직무') || markdownField(markdown, '직무 분야');
  if (!id || !name || !role) throw new Error('가상 이력서 원문 형식을 확인할 수 없습니다.');

  const competencies = markdown.split(/^## 핵심 역량\s*$/m)[1]?.split(/^## /m)[0] || '';
  const summary = competencies
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s*(.+)$/)?.[1]?.trim())
    .filter(Boolean)
    .join(' · ');
  const skillsSection = markdown.split(/^## 기술 및 활용 경험\s*$/m)[1]?.split(/^## /m)[0] || '';
  const skills = skillsSection
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line))
    .slice(1)
    .flatMap((line) => line.split('|')[1]?.split(/[·,，]/) || [])
    .map((skill) => skill.trim())
    .filter(Boolean);
  const experience = [
    markdownField(markdown, '지원 구분'),
    markdownField(markdown, '기존 직무 경력'),
  ].filter(Boolean);

  return {
    id: `CV-${id}`,
    title: `${name} 이력서`,
    role,
    experience_level: experience.join(' · '),
    summary,
    skills: [...new Set(skills)],
    resume_text: markdown,
  };
}

async function loadResumeExamples(signal) {
  return Promise.all(
    EXAMPLE_FILES.map(async (filename) => {
      const response = await fetch(`/public/resume-examples/${filename}`, { signal });
      if (!response.ok) throw new Error('가상 이력서 파일을 불러오지 못했습니다.');
      return parseResumeExample(filename, await response.text());
    }),
  );
}

export function stopResumeExamples() {
  request?.abort();
}

export function resumeExamplesPanel() {
  return `
    <details
      class="resume-examples"
      id="resume-examples">
      <summary>
        가상 이력서로 체험하기
        <span>직무별 검색 · 무작위 선택</span>
      </summary>
      <p class="input-hint">
        학습용으로 새로 작성한 가상 인물과 경력입니다. 선택하면 내 계정의 이력서에 저장됩니다.
      </p>
      <div
        id="resume-example-list"
        aria-live="polite"></div>
    </details>
  `;
}

function exampleCard(item) {
  return `
    <article class="resume-example-card">
      <span class="badge neutral">가상 이력서</span>
      <h3>${e(item.title)}</h3>
      <p class="posting-meta">${e(item.role)} · ${e(item.experience_level)}</p>
      <p>${e(item.summary)}</p>
      <div class="skill-tags">
        ${(item.skills || [])
          .map(
            (skill) => `
              <span>${e(skill)}</span>
            `,
          )
          .join('')}
      </div>
      <button
        class="button secondary compact"
        type="button"
        data-resume-example="${e(item.id)}">
        이 이력서 불러오기
      </button>
    </article>
  `;
}

export function filterResumeExamples(items, query) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const text = [
      item.title,
      item.role,
      item.experience_level,
      item.summary,
      ...(item.skills || []),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function bindResumeExamples({ hasContent, onSelect, onError }) {
  const panel = document.getElementById('resume-examples');
  if (!panel) return;

  const list = document.getElementById('resume-example-list');
  const controller = new AbortController();
  request = controller;
  let items = [];
  let filtered = [];
  let page = 1;
  let loaded = false;
  let loading = false;
  let selecting = false;

  const current = () =>
    !controller.signal.aborted && list === document.getElementById('resume-example-list');

  function renderCards() {
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.min(page, pages);
    const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    list.querySelector('[data-example-results]').innerHTML = `
      <p class="input-hint">
        전체 ${items.length}개 중 ${filtered.length}개 · ${page} / ${pages}페이지
      </p>
      <div class="resume-example-grid">
        ${
          visible.length
            ? visible.map(exampleCard).join('')
            : '<p class="input-hint">검색에 맞는 이력서가 없습니다.</p>'
        }
      </div>
      <div class="resume-example-pagination">
        <button
          class="button secondary compact"
          type="button"
          data-example-page="previous"
          ${page <= 1 ? 'disabled' : ''}>
          이전
        </button>
        <button
          class="button secondary compact"
          type="button"
          data-example-page="next"
          ${page >= pages ? 'disabled' : ''}>
          다음
        </button>
      </div>
    `;
    list.querySelector('[data-resume-random]').disabled = !filtered.length;
  }

  async function choose(exampleId) {
    if (selecting) return;
    if (
      hasContent() &&
      !window.confirm(
        '현재 이력서를 선택한 가상 이력서로 바꾸고 저장할까요? 이전 답변과 분석 결과는 초기화되며, 입력한 공고는 유지됩니다.',
      )
    )
      return;

    selecting = true;
    list.setAttribute('aria-busy', 'true');
    list.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    try {
      const example = items.find((item) => item.id === exampleId);
      if (!example) throw new Error('선택한 가상 이력서를 찾을 수 없습니다.');
      if (current()) await onSelect(example);
    } catch (error) {
      if (current() && error.name !== 'AbortError') await onError(error);
    } finally {
      selecting = false;
      if (current()) {
        list.removeAttribute('aria-busy');
        renderCards();
      }
    }
  }

  async function load() {
    if (loaded || loading) return;
    loading = true;
    list.innerHTML = '<p class="input-hint" role="status">가상 이력서를 불러오는 중…</p>';
    try {
      const result = await loadResumeExamples(controller.signal);
      if (!current()) return;
      items = result;
      filtered = items;
      loaded = true;
      list.innerHTML = `
        <div class="resume-example-controls">
          <label>
            <span>직무·기술·경력 검색</span>
            <input
              type="search"
              data-example-search
              placeholder="예: LangGraph, 회계, 물류" />
          </label>
          <button
            class="button secondary compact"
            type="button"
            data-resume-random>
            무작위 이력서 불러오기
          </button>
        </div>
        <div data-example-results></div>
      `;
      renderCards();
      list.querySelector('[data-example-search]').addEventListener('input', (event) => {
        filtered = filterResumeExamples(items, event.target.value);
        page = 1;
        renderCards();
      });
    } catch (error) {
      if (!current() || error.name === 'AbortError') return;
      list.innerHTML = `
        <p
          class="notice error"
          role="alert">
          ${e(publicErrorMessage(error))}
        </p>
        <button
          class="button secondary compact"
          data-retry-examples
          type="button">
          다시 시도
        </button>
      `;
    } finally {
      loading = false;
    }
  }

  list.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || selecting) return;
    if (button.hasAttribute('data-retry-examples')) load();
    if (button.dataset.resumeExample) choose(button.dataset.resumeExample);
    if (button.hasAttribute('data-resume-random') && filtered.length) {
      const value = crypto.getRandomValues(new Uint32Array(1))[0];
      choose(filtered[value % filtered.length].id);
    }
    if (button.dataset.examplePage) {
      page += button.dataset.examplePage === 'next' ? 1 : -1;
      renderCards();
    }
  });
  panel.addEventListener('toggle', () => {
    if (panel.open) load();
  });
}
