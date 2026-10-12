import { escapeHtml as e, icon } from '../shared/components/ui.js';
import { api as requestApi } from '../shared/api/client.js';
import { getFlowViewerUrl } from '../features/activity-flow/events.js';
import {
  RUN_STATUSES,
  RUN_LIMIT,
  normalizePerformance,
  filterRuns,
} from '../features/admin/performance-data.js';
import {
  renderPerformanceView,
  renderLoadingView,
  renderErrorView,
  renderRestrictedView,
  renderFlowEntry,
} from '../features/admin/dashboard-view.js';

// Compatibility fallback for older servers that still return 401; entry itself is public.
export function adminAccessDenied() {
  return `<section class="saved-report-status admin-access-denied" aria-labelledby="admin-access-title">
    <h1 id="admin-access-title">로그인이 필요합니다</h1>
    <p role="alert">로그인 세션을 확인할 수 없습니다. 다시 로그인한 뒤 대시보드를 열어 주세요.</p>
    <a class="button secondary" href="#/email">로그인하러 가기 ${icon('arrow', 16)}</a>
  </section>`;
}

export function adminDashboard() {
  return `<div class="admin-dashboard" data-admin-dashboard>
    <div class="page-heading"><div><p class="admin-dashboard__eyebrow">CAREERLENS / OPERATIONS</p><h1>대시보드</h1><p>실행 기록을 살펴보고, 확인이 필요한 평가를 추적합니다.</p></div><a class="button secondary" href="#/mypage">마이페이지로 돌아가기</a></div>
    <div class="admin-dashboard__body">
      ${renderFlowEntry(getFlowViewerUrl())}
      <div class="admin-dashboard__toolbar" aria-label="실행 조회 조건">
        <label for="admin-days">조회 기간<select id="admin-days" data-admin-days><option value="7">최근 7일</option><option value="30" selected>최근 30일</option><option value="90">최근 90일</option></select></label>
        <label for="admin-status">실행 상태<select id="admin-status" data-admin-status><option value="all">전체 상태</option>${RUN_STATUSES.map(([value, label]) => `<option value="${value}">${e(label)}</option>`).join('')}<option value="other">기타 상태</option></select></label>
        <button type="button" class="button secondary" data-admin-refresh>${icon('refresh', 16)} 새로고침</button>
      </div>
      <nav class="admin-dashboard__section-nav" aria-label="운영 영역">${[
        ['runs', '실행'],
        ['timing', '소요 시간'],
        ['detail', '선택한 실행 상세'],
      ]
        .map(([id, label]) => `<button type="button" data-admin-section="${id}">${label}</button>`)
        .join('')}</nav>
      <p class="admin-dashboard__live" role="status" aria-live="polite" data-admin-announcement></p>
      <div data-admin-content aria-busy="true">${renderLoadingView()}</div>
    </div>
  </div>`;
}

/** Public read-only mount. Dispose requests and listeners on navigation. */
export function mountAdminDashboard(root, {
  api = requestApi,
  window: windowObject = root?.ownerDocument?.defaultView ?? globalThis.window,
  refreshIntervalMs = 60000,
} = {}) {
  const host = root?.matches?.('[data-admin-dashboard]')
    ? root
    : root?.querySelector?.('[data-admin-dashboard]');
  if (!host) return () => {};
  const content = host.querySelector('[data-admin-content]');
  const announcement = host.querySelector('[data-admin-announcement]');
  const refresh = host.querySelector('[data-admin-refresh]');
  if (!content || !announcement || !refresh) return () => {};
  let days = 30,
    status = 'all',
    selectedIndex = -1,
    data = null,
    request = null,
    detailRequest = null,
    detailLoading = false,
    detailError = false,
    updatedAt = null,
    lastLoadedAt = 0,
    loading = false,
    detailGeneration = 0,
    disposed = false,
    generation = 0;
  const disclosureStates = new Map();

  function render() {
    if (disposed || !data) return;
    const selectedId = data.runs[selectedIndex]?.id;
    const listScroller = content.querySelector?.('#admin-runs .admin-dashboard__table-scroll');
    const listScrollTop = listScroller?.scrollTop || 0;
    const listScrollLeft = listScroller?.scrollLeft || 0;
    const oldId = content.querySelector?.('#admin-selected-run')?.dataset.runId;
    const existingDisclosures = [...(content.querySelectorAll?.('#admin-selected-run details') || [])];
    if (oldId && existingDisclosures.length) disclosureStates.set(oldId, existingDisclosures.map((item) => item.open));
    const disclosures = disclosureStates.get(selectedId) || [];
    content.innerHTML = renderPerformanceView(data, { days, status, selectedIndex, detailLoading, detailError, updatedAt });
    const nextScroller = content.querySelector?.('#admin-runs .admin-dashboard__table-scroll');
    if (nextScroller) {
      nextScroller.scrollTop = listScrollTop;
      nextScroller.scrollLeft = listScrollLeft;
    }
    const detail = content.querySelector?.('#admin-selected-run');
    if (detail) detail.dataset.runId = selectedId;
    if (disclosures.length) {
      [...(detail?.querySelectorAll('details') || [])].forEach((item, index) => {
        if (index < disclosures.length) item.open = disclosures[index];
      });
    }
    announcement.textContent = `조회 표본 ${data.runs.length}건 중 ${filterRuns(data.runs, status).length}건 표시`;
  }

  function cancelDetail() {
    detailRequest?.abort();
    detailGeneration++;
    detailLoading = false;
    detailError = false;
  }

  async function loadDetail() {
    const selectedId = data?.runs[selectedIndex]?.id;
    cancelDetail();
    if (!selectedId || disposed) return;
    detailRequest = new AbortController();
    const current = detailGeneration;
    detailLoading = true;
    render();
    try {
      const payload = await api(`/admin/evaluation-performance/${encodeURIComponent(selectedId)}`, {
        signal: detailRequest.signal,
      });
      if (disposed || current !== detailGeneration || data?.runs[selectedIndex]?.id !== selectedId) return;
      if (!payload?.run || payload.run.id !== selectedId) throw new Error('Invalid detail response');
      const normalized = normalizePerformance({ summary: {}, stages: [], runs: [payload.run] });
      data.runs[selectedIndex] = { ...data.runs[selectedIndex], ...normalized.runs[0] };
      detailLoading = false;
      render();
    } catch (error) {
      if (disposed || current !== detailGeneration || error?.name === 'AbortError') return;
      detailLoading = false;
      detailError = error?.status === 404 ? 'not_found' : 'unavailable';
      render();
      announcement.textContent = error?.status === 404
        ? '선택한 실행이 삭제되었거나 더 이상 제공되지 않습니다. 목록을 갱신합니다.'
        : '상세 기록을 불러오지 못했습니다. 상세에서 다시 시도할 수 있습니다.';
      if (error?.status === 404) {
        void load({ silent: true, refreshSelection: false, missingDetailId: selectedId });
      }
    }
  }

  async function load({ silent = false, refreshSelection = true, missingDetailId = null } = {}) {
    request?.abort();
    cancelDetail();
    request = new AbortController();
    const current = ++generation;
    const selectedId = data?.runs[selectedIndex]?.id;
    loading = true;
    if (!silent || !data) {
      data = null;
      content.innerHTML = renderLoadingView();
    }
    content.setAttribute('aria-busy', 'true');
    refresh.disabled = true;
    announcement.textContent = '운영 기록 조회 중';
    try {
      const payload = await api(
        `/admin/evaluation-performance?days=${days}&run_limit=${RUN_LIMIT}`,
        { signal: request.signal },
      );
      if (disposed || current !== generation) return;
      data = normalizePerformance(payload);
      updatedAt = payload.generated_at || new Date().toISOString();
      lastLoadedAt = Date.now();
      selectedIndex =
        typeof selectedId === 'string'
          ? data.runs.findIndex((run) => run.id === selectedId && filterRuns([run], status).length)
          : -1;
      if (missingDetailId && data.runs[selectedIndex]?.id === missingDetailId) detailError = 'not_found';
      render();
      if (selectedIndex >= 0 && refreshSelection) void loadDetail();
    } catch (error) {
      if (disposed || current !== generation || error?.name === 'AbortError') return;
      if (error?.status === 401) {
        cleanup();
        host.innerHTML = adminAccessDenied();
        return;
      }
      if (error?.status === 403) {
        data = null;
        selectedIndex = -1;
        content.innerHTML = renderRestrictedView();
        announcement.textContent = '대시보드는 열렸지만 운영 데이터 조회 권한이 없습니다';
        return;
      }
      if (silent && data) {
        announcement.textContent = '자동 갱신에 실패했습니다. 마지막 조회 결과를 표시합니다. 새로고침해 주세요.';
        return;
      }
      data = null;
      selectedIndex = -1;
      content.innerHTML = renderErrorView();
      announcement.textContent = '운영 기록 조회 실패';
    } finally {
      if (!disposed && current === generation) {
        loading = false;
        content.setAttribute('aria-busy', 'false');
        refresh.disabled = false;
      }
    }
  }

  function click(event) {
    const target = event.target;
    if (!target?.closest) return;
    if (target.closest('[data-admin-retry], [data-admin-refresh]')) {
      void load();
      return;
    }
    if (target.closest('[data-admin-detail-retry]')) {
      void loadDetail();
      return;
    }
    const section = target.closest('[data-admin-section]');
    if (section) {
      const id = section.dataset.adminSection;
      if (!['runs', 'timing', 'detail'].includes(id))
        return;
      const heading = host.querySelector(`#admin-${id}-title`);
      if (!heading && id === 'detail') announcement.textContent = '목록에서 실행의 상세 보기를 먼저 선택해 주세요.';
      heading?.setAttribute('tabindex', '-1');
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
      return;
    }
    if (target.closest('[data-admin-close]')) {
      const previous = selectedIndex;
      cancelDetail();
      selectedIndex = -1;
      render();
      host.querySelector(`[data-admin-run="${previous}"]`)?.focus();
      return;
    }
    const row = target.closest('[data-admin-row]');
    if (!row || !data) return;
    const index = Number(row.dataset.adminRow);
    if (!Number.isInteger(index) || !data.runs[index]) return;
    selectedIndex = index;
    void loadDetail();
    host.querySelector('#admin-detail-title')?.focus({ preventScroll: true });
    host
      .querySelector('#admin-selected-run')
      ?.scrollIntoView({ block: 'start', behavior: 'instant' });
    announcement.textContent = '선택한 실행의 상세 기록을 조회합니다';
  }

  function change(event) {
    if (event.target?.matches?.('[data-admin-days]')) {
      const next = Number(event.target.value);
      if (![7, 30, 90].includes(next)) return;
      days = next;
      void load();
    } else if (event.target?.matches?.('[data-admin-status]')) {
      const next = event.target.value;
      if (!['all', 'other', ...RUN_STATUSES.map(([key]) => key)].includes(next)) return;
      status = next;
      if (data?.runs[selectedIndex] && !filterRuns([data.runs[selectedIndex]], status).length) {
        cancelDetail();
        selectedIndex = -1;
      }
      render();
    }
  }

  function syncWhenVisible() {
    if (disposed || loading || windowObject?.document?.visibilityState === 'hidden') return;
    if (Date.now() - lastLoadedAt >= 10000) void load({ silent: true });
  }
  const timer = windowObject?.setInterval?.(syncWhenVisible, refreshIntervalMs);
  windowObject?.addEventListener?.('focus', syncWhenVisible);
  windowObject?.document?.addEventListener?.('visibilitychange', syncWhenVisible);

  function cleanup() {
    if (disposed) return;
    disposed = true;
    generation++;
    request?.abort();
    cancelDetail();
    if (timer !== undefined) windowObject?.clearInterval?.(timer);
    windowObject?.removeEventListener?.('focus', syncWhenVisible);
    windowObject?.document?.removeEventListener?.('visibilitychange', syncWhenVisible);
    host.removeEventListener('click', click);
    host.removeEventListener('change', change);
    data = null;
    disclosureStates.clear();
  }
  host.addEventListener('click', click);
  host.addEventListener('change', change);
  void load();
  return cleanup;
}
