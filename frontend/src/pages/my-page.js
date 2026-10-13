import { escapeHtml as e, icon } from '../shared/components/ui.js';

const reportDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function reportTime(value) {
  const date = typeof value === 'string' && value.trim() ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return '<span>날짜 정보 없음</span>';
  }
  const parts = Object.fromEntries(
    reportDate.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  const label = `${parts.year}. ${parts.month}. ${parts.day}. ${parts.hour}:${parts.minute}`;
  return `<time datetime="${e(date.toISOString())}">${label} <span class="saved-report__timezone">KST</span></time>`;
}

const contextText = (value) => (typeof value === 'string' ? value.trim() : '');

export function filterSavedReports(items = [], query = '', status = '') {
  const filter = ['completed', 'partial'].includes(status) ? status : '';
  const search = contextText(query).toLocaleLowerCase('ko-KR');
  return items.filter((item) => {
    const text = [item.job_context?.company, item.job_context?.title, item.id]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('ko-KR');
    return (!filter || item.status === filter) && (!search || text.includes(search));
  });
}

function savedReportRow(
  item,
  { selectedIds, selectionDisabled },
) {
  const canDelete = item.can_delete === true;
  const id = String(item.id ?? '');
  const shortId = id.length > 12 ? `${id.slice(0, 12)}…` : id;
  const partial = item.status === 'partial';
  const status = partial ? '완료 · 일부 확인 필요' : '완료';
  const title = contextText(item.job_context?.title);
  const company = contextText(item.job_context?.company);
  const label = [company, title].filter(Boolean).join(' · ') || `평가 ID ${id}`;
  return `
    <li class="saved-report">
      <label class="saved-report__selection">
        <input
          type="checkbox"
          data-report-select="${e(id)}"
          value="${e(id)}"
          aria-label="${e(label)} 보고서 선택"
          ${selectedIds.has(id) ? 'checked' : ''}
          ${selectionDisabled || !canDelete ? 'disabled' : ''}>
        <span>선택</span>
      </label>
      <div class="saved-report__details">
        ${company ? `<p class="saved-report__company">${e(company)}</p>` : ''}
        <h3 class="saved-report__title">${e(title || (item.context_loading ? '대상 공고 확인 중' : '대상 공고 정보 없음'))}</h3>
        <p class="saved-report__date">${reportTime(item.created_at)}</p>
        <div class="saved-report__meta">
          <span class="saved-report__status${partial ? ' saved-report__status--partial' : ''}">${status}</span>
          <span class="saved-report__id" title="${e(id)}">평가 ID · ${e(shortId)}</span>
        </div>
        ${partial ? '<p class="saved-report__partial-note">분석은 완료되었으며 일부 항목의 근거나 검증 참고사항은 추가 확인이 필요합니다.</p>' : ''}
        ${
          item.context_error
            ? `<div class="saved-report__context-error">
                <p>대상 공고 정보를 불러오지 못했어요.</p>
                <button class="text-button" type="button" data-report-context-retry="${e(id)}" ${item.context_loading ? 'disabled' : ''}>
                  ${item.context_loading ? '공고 정보 확인 중…' : '공고 정보 다시 불러오기'}
                </button>
              </div>`
            : ''
        }
      </div>
      <div class="saved-report__actions">
        <a
          class="saved-report__open"
          href="#/reports/${e(encodeURIComponent(id))}"
          aria-label="${e(label)} ${status} 보고서 보기">
          보고서 보기 ${icon('arrow', 16)}
        </a>
        <button
          class="saved-report__delete text-button"
          type="button"
          data-report-delete="${e(id)}"
          aria-label="${e(label)} 보고서 삭제"
          ${!canDelete ? 'aria-describedby="reports-delete-help"' : ''}
          ${selectionDisabled || !canDelete ? 'disabled' : ''}>삭제</button>
      </div>
    </li>
  `;
}

export function savedReportsList({
  items = [],
  loading = false,
  error = '',
  nextOffset = null,
  demo = false,
  loaded = false,
  selectedIds = [],
  deleting = false,
  deleteError = '',
  query = '',
  status = '',
} = {}) {
  const hasMore = nextOffset !== null;
  const pending = loading || (!loaded && !error && !items.length);
  const selectionDisabled = pending || deleting;
  const canDeleteReports = items.some((item) => item.can_delete === true);
  const deleteDisabled = !canDeleteReports || selectionDisabled;
  const selected = new Set(selectedIds);
  const selectedCount = items.filter((item) => item.can_delete === true && selected.has(String(item.id))).length;
  const filter = ['completed', 'partial'].includes(status) ? status : '';
  const visible = filterSavedReports(items, query, status);
  const selectable = visible.filter((item) => item.can_delete === true);
  const visibleSelectedCount = selectable.filter(({ id }) => selected.has(String(id))).length;
  const allSelected = selectable.length > 0 && visibleSelectedCount === selectable.length;
  const hiddenSelectedCount = selectedCount - visibleSelectedCount;
  return `
    <div class="saved-reports__content" aria-busy="${Boolean(pending || deleting)}">
      ${demo ? '<p class="saved-reports__note">시연 모드에서는 계정에 저장된 실제 보고서를 불러오지 않습니다.</p>' : ''}
      ${items.some((item) => item.can_delete !== true) ? '<p id="reports-delete-help" class="saved-reports__capability-note">삭제를 지원하는 보고서만 선택해 삭제할 수 있습니다. 삭제 버튼이 비활성화된 보고서는 현재 저장 서버에서 삭제를 지원하지 않습니다.</p>' : ''}
      ${
        items.length
          ? `<div class="saved-reports__filters">
              <div class="saved-reports__search">
                <label for="reports-query">불러온 보고서에서 찾기</label>
                <input id="reports-query" type="search" data-reports-query value="${e(query)}" placeholder="회사, 직무 또는 평가 ID" aria-describedby="reports-filter-help">
              </div>
              <div class="saved-reports__filter-status">
                <label for="reports-status">평가 상태</label>
                <select id="reports-status" data-reports-status aria-describedby="reports-filter-help">
                  <option value="" ${!filter ? 'selected' : ''}>전체 상태</option>
                  <option value="completed" ${filter === 'completed' ? 'selected' : ''}>완료</option>
                  <option value="partial" ${filter === 'partial' ? 'selected' : ''}>완료 · 일부 확인 필요</option>
                </select>
              </div>
              <p id="reports-filter-help" class="saved-reports__filter-help">현재 불러온 ${items.length}개 중 ${visible.length}개 표시 · 아직 불러오지 않은 기록은 검색에 포함되지 않습니다.</p>
            </div>
            <div class="saved-reports__selection-bar">
              <label class="saved-reports__select-all">
                <input
                  type="checkbox"
                  data-reports-select-all
                  aria-checked="${allSelected ? 'true' : visibleSelectedCount ? 'mixed' : 'false'}"
                  ${allSelected ? 'checked' : ''}
                  ${selectionDisabled || !selectable.length ? 'disabled' : ''}>
                <span>현재 목록의 삭제 가능한 보고서 전체 선택</span>
              </label>
              <div class="saved-reports__selection-actions">
                ${selectedCount ? `<span class="saved-reports__selection-count">${selectedCount}개 선택${hiddenSelectedCount ? ` · 현재 목록 밖 ${hiddenSelectedCount}개 포함` : ''}</span>` : ''}
                <button class="button secondary" type="button" data-reports-delete-selected ${deleteDisabled || !selectedCount ? 'disabled' : ''} ${!canDeleteReports ? 'aria-describedby="reports-delete-help"' : ''}>
                  ${deleting ? '삭제 중…' : '선택 삭제'}
                </button>
              </div>
            </div>`
          : ''
      }
      ${visible.length ? `<ul class="saved-reports__rows">${visible.map((item) => savedReportRow(item, { selectedIds: selected, selectionDisabled })).join('')}</ul>` : ''}
      ${items.length && !visible.length ? '<div class="saved-reports__feedback"><p>불러온 보고서 중 검색 조건에 맞는 기록이 없습니다.</p><p class="saved-reports__hint">검색어나 평가 상태를 바꾸거나 다음 기록을 불러와 주세요.</p></div>' : ''}
      ${deleting ? '<p class="saved-reports__loading" role="status">선택한 보고서를 삭제하는 중…</p>' : ''}
      ${deleteError ? `<p class="saved-reports__feedback saved-reports__feedback--error" role="alert">${e(deleteError)}</p>` : ''}
      ${
        error
          ? `
            <div class="saved-reports__feedback saved-reports__feedback--error">
              <p role="alert">저장한 보고서를 불러오지 못했어요. ${e(error)}</p>
              <button class="button secondary" type="button" data-reports-retry ${loading ? 'disabled' : ''}>
                ${loading ? '다시 불러오는 중…' : '다시 불러오기'}
              </button>
            </div>
          `
          : ''
      }
      ${
        !items.length && !pending && !error && !demo
          ? `<div class="saved-reports__feedback">
              <p>${hasMore ? '이 구간에는 완료된 보고서가 없습니다. 다음 기록을 확인해 보세요.' : '아직 저장된 분석 보고서가 없습니다.'}</p>
              ${hasMore ? '' : '<p class="saved-reports__hint">모의지원 분석을 완료하면 이곳에서 다시 열어볼 수 있어요.</p>'}
            </div>`
          : ''
      }
      ${pending && !error ? `<p class="saved-reports__loading" role="status">${items.length ? '다음 보고서를 불러오는 중…' : '저장한 보고서를 불러오는 중…'}</p>` : ''}
      ${
        hasMore && !error
          ? `<div class="saved-reports__more">
              <button class="button secondary" type="button" data-reports-more ${pending ? 'disabled' : ''}>
                ${pending ? '불러오는 중…' : '더 불러오기'}
              </button>
            </div>`
          : ''
      }
    </div>
  `;
}

export function myPage(user, { hasCurrentReport = false, canDeleteReports = false } = {}) {
  const name = typeof user?.name === 'string' ? user.name.trim() : '';
  const email = typeof user?.email === 'string' ? user.email.trim() : '';
  return `
    <div class="my-page">
      <div class="page-heading">
        <div>
          <h1>마이페이지</h1>
          <p>계정과 저장한 보고서를 확인하고, 대시보드에서 실시간 이용 흐름을 살펴보세요.</p>
        </div>
        <div class="my-page__actions">
          <a class="button secondary" href="#/resume">이력서로 가기 ${icon('arrow', 16)}</a>
          ${typeof user?.id === 'string' && user.id.trim() && user.demo !== true ? '<a class="button primary my-page__dashboard-link" href="#/admin">대시보드</a><a class="button secondary my-page__flow-link" href="/?view=flow" data-flow-open>이용 흐름 새 창</a>' : ''}
        </div>
      </div>
      <div class="my-page__body">
        <section class="my-page__account" aria-labelledby="my-account-title">
          <h2 id="my-account-title">로그인 계정</h2>
          ${
            name || email
              ? `<dl class="my-page__identity">
                  ${name ? `<div><dt>이름</dt><dd>${e(name)}</dd></div>` : ''}
                  ${email ? `<div><dt>이메일</dt><dd>${e(email)}</dd></div>` : ''}
                </dl>`
              : '<p class="my-page__account-note">현재 로그인한 계정의 보고서를 확인할 수 있습니다.</p>'
          }
        </section>
        <section id="saved-reports" class="saved-reports" aria-labelledby="saved-reports-title">
          <div class="saved-reports__heading">
            <div>
              <h2 id="saved-reports-title">저장한 분석 보고서</h2>
              <p>분석이 완료되면 보고서가 이 계정에 자동으로 저장됩니다.</p>
            </div>
            ${hasCurrentReport ? '<a class="saved-reports__current" href="#/result">현재 분석 결과로 돌아가기</a>' : ''}
          </div>
          <div id="saved-reports-list" aria-live="polite">${savedReportsList({ loading: true, canDeleteReports })}</div>
        </section>
      </div>
    </div>
  `;
}
