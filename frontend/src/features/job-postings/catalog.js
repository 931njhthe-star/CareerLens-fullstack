import { api } from '../../shared/api/client.js';
import { notice, pending, bindCounters } from '../../shared/components/ui.js';
import { jobListPage, jobDetailPage, postingEditorPage, jobsError } from '../../pages/jobs.js';
import { catalogQuery, postingPayload } from './catalog-state.js';

const drafts = new Map();
let activeRequest;

export function stopCatalogLoad() {
  activeRequest?.abort();
}
export function hasCatalogEdits() {
  return [...drafts.values()].some((draft) => draft.dirty);
}
export function clearCatalogEdits() {
  drafts.clear();
}

export async function bindCatalog({
  route,
  user,
  navigate,
  requireLogin,
  onSelect,
  onError,
  rerender,
}) {
  stopCatalogLoad();
  const controller = new AbortController();
  activeRequest = controller;
  const target = document.getElementById('main');
  const current = () => !controller.signal.aborted && target === document.getElementById('main');
  const read = (path) => api(path, { signal: controller.signal });
  if (['new', 'edit'].includes(route.kind) && !user) {
    requireLogin(location.hash.slice(2));
    return;
  }
  let posting;
  let query;
  let list;
  try {
    if (route.kind === 'list') {
      query = catalogQuery(route.query);
      if (query.get('saved') === '1' && !user) {
        requireLogin(`jobs?${query}`);
        return;
      }
      list = await read(`/job-postings?${query}`);
      if (!current()) return;
      // A deletion or changed dataset can make the last page empty.
      if (!list.items.length && list.page > 1) {
        query.set('page', String(Math.max(1, Math.ceil(list.total / list.page_size))));
        navigate(`jobs?${query}`);
        return;
      }
      target.innerHTML = jobListPage(list, query, user);
    } else {
      if (route.id) posting = (await read(`/job-postings/${encodeURIComponent(route.id)}`)).posting;
      if (!current()) return;
      if (route.kind === 'detail') target.innerHTML = jobDetailPage(posting, user);
      else {
        if (route.kind === 'edit' && !['manual', 'mock'].includes(posting.source_type))
          throw new Error(
            '가상 예시는 수정할 수 없습니다. 공고 직접 입력에서 내 공고를 만들어 주세요.',
          );
        const key = route.id || 'new';
        target.innerHTML = postingEditorPage(drafts.get(key)?.value || posting, route.id);
      }
    }
  } catch (error) {
    if (!current() || error.name === 'AbortError') return;
    if (error.status === 401) {
      await onError(error);
      return;
    }
    target.innerHTML = jobsError(error.message);
    document.getElementById('retry-jobs')?.addEventListener('click', rerender);
    return;
  }
  bindCounters(target);
  document.getElementById('catalog-search')?.addEventListener('submit', (event) => {
    event.preventDefault();
    navigate(`jobs?${catalogQuery(new FormData(event.currentTarget))}`);
  });
  target.querySelectorAll('[data-bookmark]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!user) {
        requireLogin(location.hash.slice(2));
        return;
      }
      button.disabled = true;
      const selected = posting || list.items.find((item) => item.id === button.dataset.bookmark);
      try {
        const result = await api(`/job-postings/${encodeURIComponent(selected.id)}/bookmark`, {
          method: selected.is_saved ? 'DELETE' : 'POST',
          body: {},
        });
        if (!current()) return;
        Object.assign(selected, result.posting);
        if (query?.get('saved') === '1' && !selected.is_saved) {
          rerender();
          return;
        }
        button.textContent = selected.is_saved ? '저장됨' : '관심 공고 저장';
        button.setAttribute('aria-pressed', String(selected.is_saved));
        button.setAttribute(
          'aria-label',
          `${selected.role} ${selected.is_saved ? '저장 해제' : '저장'}`,
        );
        notice(
          selected.is_saved ? '관심 공고에 저장했습니다.' : '관심 공고에서 해제했습니다.',
          'success',
        );
      } catch (error) {
        if (current()) await onError(error);
      } finally {
        button.disabled = false;
      }
    }),
  );
  document.getElementById('select-posting')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try {
      await onSelect(posting);
    } catch (error) {
      if (current()) await onError(error);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  document.getElementById('delete-posting')?.addEventListener('click', async (event) => {
    if (
      !window.confirm(
        '직접 입력한 이 공고와 저장 표시를 삭제할까요? 이미 모의지원에 복사한 내용은 유지됩니다.',
      )
    )
      return;
    event.currentTarget.disabled = true;
    try {
      await api(`/job-postings/${encodeURIComponent(posting.id)}`, { method: 'DELETE' });
      drafts.delete(posting.id);
      if (current()) navigate('jobs');
    } catch (error) {
      event.target.disabled = false;
      if (current()) await onError(error);
    }
  });
  const form = document.getElementById('posting-form');
  form?.addEventListener('input', () =>
    drafts.set(route.id || 'new', { dirty: true, value: Object.fromEntries(new FormData(form)) }),
  );
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    pending(form, '저장하는 중…', async () => {
      try {
        const payload = postingPayload(new FormData(form));
        if (payload.skills.length > 20 || payload.skills.some((skill) => skill.length > 50))
          throw new Error('기술·역량은 항목당 50자 이하, 최대 20개까지 입력해 주세요.');
        const result = await api(
          `/job-postings${route.id ? `/${encodeURIComponent(route.id)}` : ''}`,
          { method: route.id ? 'PUT' : 'POST', body: payload },
        );
        drafts.delete(route.id || 'new');
        if (current()) navigate(`jobs/${encodeURIComponent(result.posting.id)}`);
      } catch (error) {
        if (current()) await onError(error);
      }
    });
  });
}
