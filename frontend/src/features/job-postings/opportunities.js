import { api } from '../../shared/api/client.js';
import { publicErrorMessage } from '../../shared/api/error-messages.js';
import { escapeHtml as e } from '../../shared/components/ui.js';
import {
  opportunityList,
  opportunityDetail,
  opportunityCountLabel,
} from '../../pages/opportunities.js';
import { opportunityPath, opportunityQuery } from './opportunity-state.js';
import { recordFlowEvent } from '../activity-flow/events.js';

export function bindOpportunities({ route, user, navigate, onSelect, onError }) {
  const controller = new AbortController();
  const { signal } = controller;
  const list = document.getElementById('opportunity-list');
  const detail = document.getElementById('opportunity-detail');
  const count = document.getElementById('opportunity-count');
  const pagination = document.getElementById('opportunity-pagination');
  const scope = document.getElementById('opportunity-scope');
  const catalog = document.getElementById('opportunity-catalog');
  const status = document.getElementById('opportunity-list-status');
  const panel = document.getElementById('opportunities-panel');
  const heading = document.getElementById('opportunity-list-heading');
  scope.value = route.scope;
  let currentRoute = { ...route };
  let listController;
  let detailController;
  let roleLoaded = false;
  let result;
  let items = [];
  let selected = route.selected;

  function syncLocation() {
    const path = opportunityPath(currentRoute, currentRoute.page, selected);
    history.replaceState({}, '', `#/${path}`);
    catalog.href = `#/jobs?return_to=${encodeURIComponent(path)}`;
  }

  function measurePanels() {
    if (signal.aborted) return;
    const heights = [...list.querySelectorAll('[data-posting-id]')].map(
      (row) => row.getBoundingClientRect().height,
    );
    // Long titles/skills and browser font scaling must not squeeze the list below four rows.
    let listHeight = 640;
    for (let start = 0; start < heights.length; start++) {
      listHeight = Math.max(listHeight, heights.slice(start, start + 4).reduce((a, b) => a + b, 0));
    }
    panel.style.setProperty('--opportunity-list-height', `${Math.ceil(listHeight)}px`);
    panel.style.setProperty(
      '--opportunity-panel-height',
      `${Math.ceil(listHeight + heading.getBoundingClientRect().height + pagination.getBoundingClientRect().height + 2)}px`,
    );
  }

  function renderPagination() {
    if (!result) return;
    const page = currentRoute.page;
    const pages = Math.max(1, Math.ceil(result.total / result.page_size));
    pagination.innerHTML = `<button type="button" class="button secondary compact opportunity-page-button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="이전 공고 목록">이전</button><span aria-live="polite">${page} / ${pages}</span><button type="button" class="button secondary compact opportunity-page-button" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="다음 공고 목록">다음</button>`;
  }

  async function select(id, focus = false) {
    detailController?.abort();
    detailController = new AbortController();
    const request = detailController;
    selected = id;
    syncLocation();
    for (const row of list.querySelectorAll('[data-posting-id]'))
      row.setAttribute('aria-current', String(row.dataset.postingId === id));
    detail.setAttribute('aria-busy', 'true');
    detail.innerHTML =
      '<div class="opportunities__empty" role="status"><p>공고 상세 내용을 불러오는 중…</p></div>';
    try {
      const { posting } = await api(`/job-postings/${encodeURIComponent(id)}`, {
        signal: request.signal,
      });
      if (signal.aborted || request.signal.aborted) return;
      detail.innerHTML = opportunityDetail(posting, user);
      // Detail rows replace history in place, so the app router does not emit a
      // navigation event. Observe actual display even when the data was cached.
      recordFlowEvent('posting', { kind: 'navigation', source: user?.demo === true ? 'demo' : 'observed' });
      detail.scrollTop = 0;
      if (focus) detail.focus({ preventScroll: true });
      const apply = document.getElementById('opportunity-apply');
      apply.addEventListener(
        'click',
        async () => {
          if (apply.disabled) return;
          apply.disabled = true;
          try {
            await onSelect(posting);
          } catch (error) {
            if (!signal.aborted) await onError(error);
          } finally {
            if (apply.isConnected) apply.disabled = false;
          }
        },
        { signal },
      );
    } catch (error) {
      if (signal.aborted || request.signal.aborted) return;
      detail.innerHTML = `<div class="opportunities__empty" role="alert"><h2>공고를 불러오지 못했어요.</h2><p>${e(publicErrorMessage(error))}</p><button id="retry-opportunity" class="button secondary" type="button">다시 불러오기</button></div>`;
      document
        .getElementById('retry-opportunity')
        .addEventListener('click', () => select(id), { signal });
    } finally {
      if (!signal.aborted && !request.signal.aborted) detail.setAttribute('aria-busy', 'false');
    }
  }

  async function load(page = currentRoute.page) {
    listController?.abort();
    listController = new AbortController();
    const request = listController;
    const nextRoute = { ...currentRoute, page };
    const current = () => !signal.aborted && !request.signal.aborted && listController === request;
    list.setAttribute('aria-busy', 'true');
    count.textContent = '목록을 불러오는 중…';
    status.hidden = true;
    status.innerHTML = '';
    try {
      if (!roleLoaded) {
        const roles = await api('/career-roles', { signal: request.signal });
        if (!current()) return;
        const role = roles.items.find((item) => item.id === route.role_id);
        if (!role || (role.id === 'custom' && !route.label.trim()))
          throw new Error('희망 직무를 다시 선택해 주세요.');
        document.getElementById('opportunity-role').textContent =
          role.id === 'custom' ? route.label : role.label;
        roleLoaded = true;
      }
      const nextResult = await api(opportunityQuery(nextRoute), { signal: request.signal });
      if (!current()) return;
      const lastPage = Math.max(1, Math.ceil(nextResult.total / nextResult.page_size));
      if (page > lastPage) return load(lastPage);
      result = nextResult;
      currentRoute = nextRoute;
      items = result.items;
      count.textContent = opportunityCountLabel(result, currentRoute);
      // The open detail can belong to another list page. Only an explicit row click replaces it.
      const firstSelection = !detailController;
      if (firstSelection && !selected) selected = items[0]?.id || '';
      list.innerHTML = opportunityList(items, selected);
      recordFlowEvent('posting', { kind: 'navigation', source: user?.demo === true ? 'demo' : 'observed' });
      list.scrollTop = 0;
      renderPagination();
      syncLocation();
      measurePanels();
      if (firstSelection && selected) await select(selected);
      else if (firstSelection) {
        detail.setAttribute('aria-busy', 'false');
        detail.innerHTML =
          '<div class="opportunities__empty"><h2>이 범위의 공고가 아직 없어요.</h2><p>공고 표시 범위를 바꾸거나 다른 희망 직무를 선택해 주세요. 등록된 공고가 추가되면 이 목록에 표시됩니다.</p><a class="back-link" href="#/desired-role">희망 직무 수정</a></div>';
      }
    } catch (error) {
      if (!current() || error.name === 'AbortError') return;
      count.textContent = result ? opportunityCountLabel(result, currentRoute) : '목록을 불러오지 못했어요.';
      status.hidden = false;
      status.innerHTML = `<p>${e(publicErrorMessage(error))}</p><button id="retry-opportunities" class="button secondary compact" type="button">목록 다시 불러오기</button>`;
      document.getElementById('retry-opportunities').addEventListener('click', () => load(page), { signal });
      if (!detailController) {
        detail.setAttribute('aria-busy', 'false');
        detail.innerHTML = '<div class="opportunities__empty"><h2>공고 목록을 불러오지 못했어요.</h2><p>목록 다시 불러오기를 눌러 주세요.</p></div>';
      }
      measurePanels();
    } finally {
      if (current()) list.setAttribute('aria-busy', 'false');
    }
  }

  list.addEventListener(
    'click',
    (event) => {
      const row = event.target.closest('[data-posting-id]');
      if (row && row.dataset.postingId !== selected) select(row.dataset.postingId, true);
    },
    { signal },
  );
  pagination.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest('[data-page]');
      if (button && !button.disabled) load(Number(button.dataset.page));
    },
    { signal },
  );
  scope.addEventListener(
    'change',
    () => navigate(opportunityPath({ ...currentRoute, scope: scope.value })),
    { signal },
  );
  let measuredWidth = 0;
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    if (list.clientWidth === measuredWidth) return;
    measuredWidth = list.clientWidth;
    measurePanels();
  });
  resizeObserver?.observe(list);
  document.fonts?.ready.then(measurePanels);
  syncLocation();
  load();
  return () => {
    controller.abort();
    listController?.abort();
    detailController?.abort();
    resizeObserver?.disconnect();
  };
}
