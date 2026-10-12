import { escapeHtml as e } from '../../shared/components/ui.js';
import { reportJobContext } from './report-context.js';

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const sidebarIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>`;

export function currentSavedReport(draft) {
  const report = draft?.report;
  if (report?.source !== 'backend' || !report.run_id) return null;
  return { id: report.run_id, created_at: draft.created_at, status: report.status,
    job_context: reportJobContext(report) };
}

/** Enrich an existing account row, but never insert or reorder the current report. */
export function pickerItems(items, current) {
  const unique = new Map();
  for (const item of items) {
    if (unique.has(item.id)) continue;
    unique.set(item.id, item.id === current?.id && !item.job_context
      ? { ...item, job_context: current.job_context }
      : item);
  }
  return [...unique.values()];
}

export function pickerRows(items, currentId, { start = 0, total = items.length } = {}) {
  return items.map((item, index) => {
    const active = item.id === currentId;
    const title = item.job_context?.title ||
      (item.context_loading ? '대상 공고 확인 중…' : '대상 공고 정보 없음');
    const company = item.job_context?.company ||
      (item.context_error ? '공고 정보를 불러오지 못했습니다' : '저장한 분석 보고서');
    const date = item.created_at ? new Date(item.created_at) : null;
    const time = date && Number.isFinite(date.getTime())
      ? `${dateFormat.format(date)} KST` : '날짜 정보 없음';
    return `<li class="report-picker__row" style="--picker-index:${start + index}" aria-posinset="${start + index + 1}" aria-setsize="${total}"><a class="report-picker__item${active ? ' report-picker__item--current' : ''}"
      href="#/reports/${e(encodeURIComponent(item.id))}" data-picker-report="${e(item.id)}" ${active ? 'aria-current="page"' : ''}>
      <span class="report-picker__company">${e(company)}</span>
      <strong class="report-picker__title" title="${e(title)}">${e(title)}</strong>
      <span class="report-picker__meta"><span>${e(time)}</span><span>${active ? '현재 보고서' : item.status === 'partial' ? '일부 확인 필요' : '완료'}</span></span>
    </a></li>`;
  }).join('');
}

/** Read through sparse account pages until four rows and the current row are found. */
export async function loadPickerPages({ state, current, api, signal, findCurrent = true, onPage }) {
  do {
    if (signal.aborted || state.offset === null) return;
    const offset = state.offset;
    const result = await api(`/account/reports?offset=${offset}`, { signal });
    if (signal.aborted) return;
    const next = result.next_offset;
    if (!Array.isArray(result.items) ||
      (next !== null && (!Number.isSafeInteger(next) || next <= offset)))
      throw new Error('Invalid report page');
    // A new analysis may have inserted a leading row before our cached offsets.
    // Keep old rows available on failure, then replace them atomically on success.
    const cached = state.replaceOnNextPage ? [] : state.items;
    state.items = pickerItems([...cached, ...result.items], current);
    if (state.replaceOnNextPage) state.scrollTop = 0;
    state.replaceOnNextPage = false;
    state.offset = next;
    state.loaded = true;
    onPage?.();
  } while (state.offset !== null && (state.items.length < 4 ||
    (findCurrent && current && !state.items.some((item) => item.id === current.id))));
}

/** `state` belongs to one signed-in account and may be reused across report routes. */
export function bindSavedReportPicker(trigger, { draft, api, onUnauthorized, state = {} }) {
  if (!trigger) return () => {};
  state.items ??= [];
  state.offset ??= state.loaded ? null : 0;
  state.scrollTop ??= 0;
  state.expanded ??= false;
  const current = currentSavedReport(draft);
  if (current && current.id !== state.currentId && state.loaded &&
    !state.items.some((item) => item.id === current.id)) {
    state.offset = 0;
    state.loaded = false;
    state.replaceOnNextPage = true;
  }
  state.currentId = current?.id ?? null;
  state.items = pickerItems(state.items, current);
  const drawerQuery = window.matchMedia('(max-width: 1200px)');
  const panel = document.createElement('aside');
  panel.id = 'saved-report-sidebar';
  panel.className = 'report-picker';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'report-picker-title');
  panel.innerHTML = `<header class="report-picker__header"><div><h2 id="report-picker-title">저장한 보고서</h2>
    <p>보고서를 선택해 다시 확인하세요.</p></div>
    <button type="button" class="report-picker-toggle" data-picker-close aria-label="저장한 보고서 사이드바 접기" title="사이드바 접기">${sidebarIcon}</button></header>
    <ul class="report-picker__list" aria-label="저장한 분석 보고서 목록" tabindex="-1"></ul>
    <p class="report-picker__feedback" role="status" aria-live="polite"></p>
    <footer class="report-picker__footer"><button class="button secondary compact" type="button" data-picker-more hidden>더 불러오기</button>
    <a href="#/mypage">마이페이지에서 전체 보기</a></footer>`;
  const backdrop = document.createElement('div');
  backdrop.className = 'report-picker-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.append(backdrop, panel);
  const list = panel.querySelector('.report-picker__list');
  const feedback = panel.querySelector('.report-picker__feedback');
  const more = panel.querySelector('[data-picker-more]');
  const closeButton = panel.querySelector('[data-picker-close]');
  const app = document.getElementById('app');
  let controller, loading = false, failed = false, disposed = false;
  let needsCurrentReveal = false, inertBeforeDrawer;
  let contextQueue = [], contextWorkers = 0;
  const queuedContexts = new Set();
  const rowHeight = () => Number.parseFloat(getComputedStyle(list).getPropertyValue('--picker-row-height')) || 96;
  const live = (signal) => !disposed && !signal.aborted && controller?.signal === signal;
  const reportLink = (id) => [...list.querySelectorAll('[data-picker-report]')]
    .find((link) => link.dataset.pickerReport === id);

  trigger.classList.add('report-picker-toggle');
  trigger.innerHTML = `${sidebarIcon}<span>저장한 보고서</span>`;
  trigger.removeAttribute('aria-haspopup');
  trigger.setAttribute('aria-controls', panel.id);

  function syncLayout() {
    const drawer = state.expanded && drawerQuery.matches;
    panel.hidden = !state.expanded;
    backdrop.hidden = !drawer;
    panel.setAttribute('role', drawer ? 'dialog' : 'complementary');
    if (drawer) panel.setAttribute('aria-modal', 'true');
    else panel.removeAttribute('aria-modal');
    if (app && drawer && inertBeforeDrawer === undefined) {
      inertBeforeDrawer = Boolean(app.inert);
      app.inert = true;
    } else if (app && !drawer && inertBeforeDrawer !== undefined) {
      app.inert = inertBeforeDrawer;
      inertBeforeDrawer = undefined;
    }
    document.body.classList.toggle('report-picker-open', state.expanded);
    document.body.classList.toggle('report-picker-drawer-open', drawer);
    trigger.setAttribute('aria-expanded', String(state.expanded));
    const label = `저장한 보고서 사이드바 ${state.expanded ? '접기' : '열기'}`;
    trigger.setAttribute('aria-label', label);
    trigger.title = label;
    if (drawer && !panel.contains(document.activeElement)) closeButton.focus({ preventScroll: true });
  }

  function revealCurrent() {
    if (!needsCurrentReveal) return;
    const index = state.items.findIndex((item) => item.id === current?.id);
    if (index < 0) return;
    const height = rowHeight();
    const top = index * height;
    const viewport = list.clientHeight || height * 4;
    if (top < list.scrollTop || top + height > list.scrollTop + viewport)
      state.scrollTop = Math.max(0, top - (viewport - height) / 2);
    needsCurrentReveal = false;
  }

  function paint() {
    if (!state.expanded || disposed) return;
    const focusedId = document.activeElement?.dataset?.pickerReport;
    const moreHadFocus = document.activeElement === more;
    revealCurrent();
    // Only a small viewport window is mounted, even for an old report many pages deep.
    const start = Math.max(0, Math.floor(state.scrollTop / rowHeight()) - 6);
    const indices = new Set(Array.from({ length: Math.min(40, Math.max(0, state.items.length - start)) }, (_, index) => start + index));
    const focusedIndex = state.items.findIndex((item) => item.id === focusedId);
    if (focusedIndex >= 0) indices.add(focusedIndex);
    list.innerHTML = `<li class="report-picker__spacer" aria-hidden="true" style="height:calc(${state.items.length} * var(--picker-row-height))"></li>` +
      [...indices].sort((a, b) => a - b).map((index) => pickerRows([state.items[index]], current?.id,
        { start: index, total: state.offset === null ? state.items.length : -1 })).join('');
    list.scrollTop = state.scrollTop;
    if (focusedId) reportLink(focusedId)?.focus({ preventScroll: true });
    more.hidden = !failed && state.offset === null;
    more.disabled = loading;
    more.textContent = failed ? '다시 불러오기' : loading ? '불러오는 중…' : '더 불러오기';
    if (moreHadFocus && more.hidden) {
      const lastLink = list.querySelectorAll('[data-picker-report]');
      (lastLink[lastLink.length - 1] || closeButton).focus({ preventScroll: true });
    }
    list.setAttribute('aria-busy', String(loading));
    if (!loading && !failed) feedback.textContent = state.items.length
      ? `${state.items.length}개의 보고서${state.offset !== null ? ' 불러옴' : ''}`
      : '아직 저장된 보고서가 없습니다. 분석을 완료하면 이곳에서 볼 수 있어요.';
    hydrateVisible();
  }

  function unauthorized(error, signal) {
    if (!live(signal) || error?.status !== 401) return false;
    close(false);
    state.items = [];
    state.offset = 0;
    state.loaded = false;
    onUnauthorized?.(error);
    return true;
  }

  function hydrateVisible() {
    if (!controller || controller.signal.aborted || state.replaceOnNextPage) return;
    const signal = controller.signal;
    for (const link of list.querySelectorAll('[data-picker-report]')) {
      const item = state.items.find((row) => row.id === link.dataset.pickerReport);
      if (!item || item.job_context || item.context_error || queuedContexts.has(item.id)) continue;
      queuedContexts.add(item.id);
      item.context_loading = true;
      contextQueue.push(item);
    }
    while (contextWorkers < 3 && contextQueue.length) {
      const item = contextQueue.shift();
      contextWorkers++;
      void (async () => {
        try {
          const result = await api(`/account/reports/${encodeURIComponent(item.id)}/context`, { signal });
          if (live(signal)) item.job_context = result.job_context;
        } catch (error) {
          if (live(signal) && !unauthorized(error, signal)) item.context_error = true;
        } finally {
          if (live(signal)) {
            item.context_loading = false;
            contextWorkers--;
            paint();
          }
        }
      })();
    }
  }

  async function load(findCurrent = true) {
    if (loading || state.offset === null || !controller) return;
    const signal = controller.signal;
    loading = true;
    failed = false;
    feedback.textContent = current && findCurrent && !state.items.some((item) => item.id === current.id)
      ? '현재 보고서가 있는 위치를 찾는 중…' : '저장한 보고서를 불러오는 중…';
    paint();
    try {
      await loadPickerPages({ state, current, api, signal, findCurrent, onPage: paint });
    } catch (error) {
      if (!live(signal) || unauthorized(error, signal)) return;
      failed = true;
      feedback.textContent = '저장한 보고서를 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.';
    } finally {
      if (live(signal)) { loading = false; paint(); }
    }
  }

  function open() {
    state.expanded = true;
    controller = new AbortController();
    needsCurrentReveal = Boolean(current);
    syncLayout();
    list.scrollTop = state.scrollTop;
    paint();
    if (!state.loaded || failed || (current && !state.items.some((item) => item.id === current.id)))
      void load();
  }

  function cancelRequests() {
    controller?.abort();
    controller = undefined;
    contextQueue = [];
    contextWorkers = 0;
    queuedContexts.clear();
    for (const item of state.items) item.context_loading = false;
    loading = false;
  }

  function close(restoreFocus = true) {
    state.scrollTop = list.scrollTop;
    state.expanded = false;
    cancelRequests();
    syncLayout();
    if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  const toggle = () => state.expanded ? close() : open();
  const onScroll = () => { state.scrollTop = list.scrollTop; paint(); };
  const onResize = () => { syncLayout(); if (state.expanded) paint(); };
  const onKey = (event) => {
    if (!state.expanded) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    const id = document.activeElement?.dataset?.pickerReport;
    const index = state.items.findIndex((item) => item.id === id);
    let next = index;
    if (index >= 0 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) next++;
      if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) next--;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = state.items.length - 1;
      if (next !== index && next >= 0 && next < state.items.length) {
        event.preventDefault();
        const top = next * rowHeight();
        if (top < list.scrollTop || top + rowHeight() > list.scrollTop + list.clientHeight)
          state.scrollTop = Math.max(0, top - rowHeight());
        paint();
        reportLink(state.items[next].id)?.focus({ preventScroll: true });
        return;
      }
    }
    if (event.key !== 'Tab' || !drawerQuery.matches) return;
    const focusable = [...panel.querySelectorAll('button:not([disabled]), a[href]')]
      .filter((element) => !element.hidden);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const onPanelClick = (event) => {
    const link = event.target.closest('[data-picker-report]');
    if (link?.dataset.pickerReport === current?.id) event.preventDefault();
    // Report navigation retains the expanded state; route disposal cancels old requests.
  };
  trigger.addEventListener('click', toggle);
  closeButton.addEventListener('click', () => close());
  backdrop.addEventListener('click', () => close());
  more.addEventListener('click', () => void load(failed));
  panel.addEventListener('click', onPanelClick);
  list.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('keydown', onKey);
  drawerQuery.addEventListener('change', onResize);
  syncLayout();
  if (state.expanded) open();
  return () => {
    if (disposed) return;
    disposed = true;
    if (state.expanded) state.scrollTop = list.scrollTop;
    cancelRequests();
    if (app && inertBeforeDrawer !== undefined) app.inert = inertBeforeDrawer;
    document.body.classList.remove('report-picker-open', 'report-picker-drawer-open');
    trigger.removeEventListener('click', toggle);
    document.removeEventListener('keydown', onKey);
    drawerQuery.removeEventListener('change', onResize);
    panel.remove();
    backdrop.remove();
  };
}
