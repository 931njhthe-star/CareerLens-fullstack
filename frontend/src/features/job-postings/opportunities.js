import { api } from '../../shared/api/client.js';
import { escapeHtml as e } from '../../shared/components/ui.js';
import { opportunityList, opportunityDetail } from '../../pages/opportunities.js';
import { opportunityPath, opportunityQuery } from './opportunity-state.js';

export function bindOpportunities({ route, user, navigate, onSelect, onError }) {
  const controller = new AbortController();
  const { signal } = controller;
  const list = document.getElementById('opportunity-list');
  const detail = document.getElementById('opportunity-detail');
  const count = document.getElementById('opportunity-count');
  const pagination = document.getElementById('opportunity-pagination');
  let detailController;
  let items = [];
  let selected = route.selected;

  async function select(id, focus = false) {
    detailController?.abort();
    detailController = new AbortController();
    const request = detailController;
    selected = id;
    history.replaceState({}, '', `#/${opportunityPath(route, route.page, id)}`);
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
      detail.innerHTML = `<div class="opportunities__empty" role="alert"><h2>공고를 불러오지 못했어요.</h2><p>${e(error.message)}</p><button id="retry-opportunity" class="button secondary" type="button">다시 불러오기</button></div>`;
      document
        .getElementById('retry-opportunity')
        .addEventListener('click', () => select(id), { signal });
    } finally {
      if (!signal.aborted && !request.signal.aborted) detail.setAttribute('aria-busy', 'false');
    }
  }

  async function load() {
    list.setAttribute('aria-busy', 'true');
    count.textContent = '목록을 불러오는 중…';
    try {
      const roles = await api('/career-roles', { signal });
      if (signal.aborted) return;
      const role = roles.items.find((item) => item.id === route.role_id);
      if (!role || (role.id === 'custom' && !route.label.trim()))
        throw new Error('희망 직무를 다시 선택해 주세요.');
      document.getElementById('opportunity-role').textContent =
        role.id === 'custom' ? route.label : role.label;
      const result = await api(opportunityQuery(route), { signal });
      if (signal.aborted) return;
      items = result.items;
      selected = items.some((item) => item.id === selected) ? selected : items[0]?.id;
      count.textContent = `${result.total.toLocaleString('ko-KR')}개 공고 · 직무명 기준`;
      list.innerHTML = opportunityList(items, selected);
      pagination.innerHTML = `<button class="text-button" data-page="${route.page - 1}" ${route.page === 1 ? 'disabled' : ''}>이전</button><span>${route.page} / ${Math.max(1, Math.ceil(result.total / result.page_size))}</span><button class="text-button" data-page="${route.page + 1}" ${route.page * result.page_size >= result.total ? 'disabled' : ''}>다음</button>`;
      if (selected) await select(selected);
      else {
        detail.setAttribute('aria-busy', 'false');
        detail.innerHTML =
          '<div class="opportunities__empty"><h2>이 직무의 공고가 아직 없어요.</h2><p>다른 희망 직무를 선택해 주세요. 등록된 공고가 추가되면 이 목록에 표시됩니다.</p><a class="back-link" href="#/desired-role">희망 직무 수정</a></div>';
      }
    } catch (error) {
      if (signal.aborted) return;
      count.textContent = '목록을 불러오지 못했어요.';
      detail.setAttribute('aria-busy', 'false');
      detail.innerHTML = `<div class="opportunities__empty" role="alert"><p>${e(error.message)}</p><button id="retry-opportunities" class="button secondary">다시 불러오기</button><a class="back-link" href="#/desired-role">희망 직무 수정</a></div>`;
      document.getElementById('retry-opportunities').addEventListener('click', load, { signal });
    } finally {
      if (!signal.aborted) list.setAttribute('aria-busy', 'false');
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
      if (button && !button.disabled) navigate(opportunityPath(route, Number(button.dataset.page)));
    },
    { signal },
  );
  load();
  return () => {
    controller.abort();
    detailController?.abort();
  };
}
