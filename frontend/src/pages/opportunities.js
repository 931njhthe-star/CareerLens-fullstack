import { escapeHtml as e, icon, renderPostingPhases } from '../shared/components/ui.js';

const isExample = (posting) => posting.source_type === 'example' || posting.is_example === true;

export function opportunitiesPage() {
  return `
    ${renderPostingPhases('posting')}
    <div class="page-heading opportunities-heading"><div>
      <h1>어떤 공고에 지원해 볼까요?</h1>
      <p>희망 직무와 관련된 공고를 비교하고, 모의지원할 공고를 선택하세요.</p>
    </div><a class="back-link" href="#/desired-role">희망 직무 수정</a></div>
    <section id="opportunities-panel" class="opportunities" aria-label="희망 직무별 채용공고">
      <aside class="opportunities__sidebar" aria-label="채용공고 목록">
        <div id="opportunity-list-heading" class="opportunities__list-heading">
          <h2 id="opportunity-role">채용공고</h2>
          <div class="opportunity-scope">
            <label for="opportunity-scope">공고 표시 범위</label>
            <select id="opportunity-scope" aria-describedby="opportunity-count">
              <option value="category">같은 분류의 공고</option>
              <option value="exact">선택한 직무만</option>
              <option value="all">전체 공고</option>
            </select>
          </div>
          <p id="opportunity-count" role="status">목록을 불러오는 중…</p>
          <a id="opportunity-catalog" class="back-link" href="#/jobs">전체 직무별 공고 보기</a>
          <div id="opportunity-list-status" role="status" hidden></div>
        </div>
        <div id="opportunity-list" class="opportunities__list" aria-busy="true"></div>
        <nav id="opportunity-pagination" class="opportunities__pagination" aria-label="공고 페이지"></nav>
      </aside>
      <article id="opportunity-detail" class="opportunities__detail" aria-label="선택한 채용공고 상세" tabindex="-1" aria-busy="true">
        <div class="opportunities__empty"><h2>공고를 준비하고 있어요.</h2><p>목록을 불러온 뒤 상세 내용을 표시합니다.</p></div>
      </article>
    </section>`;
}

export function opportunityCountLabel(result, route) {
  const count = `${result.total.toLocaleString('ko-KR')}개 공고`;
  if (route.scope === 'all') return `전체 ${count}`;
  if (route.scope === 'category' && result.role_scope === 'all')
    return `전체 ${count} · 분류 정보가 없어 전체 표시`;
  const total = Number.isInteger(result.available_total)
    ? `전체 ${result.available_total.toLocaleString('ko-KR')}개 중 `
    : '';
  if (route.scope === 'category' && result.role_category)
    return `${total}${count} · ${result.role_category} 분류`;
  const basis = route.role_id === 'custom' ? '입력 직무 기준' : '선택한 직무명만';
  const fallback = route.scope === 'category' ? ' · 분류 정보 없음' : '';
  return `${total}${count} · ${basis}${fallback}`;
}

export function opportunityList(items, selected) {
  return items
    .map(
      (item) => `
    <button type="button" class="opportunity-row" data-posting-id="${e(item.id)}"
      aria-current="${item.id === selected ? 'true' : 'false'}">
      <span class="opportunity-row__company">${e(item.company)}${isExample(item) ? '<span class="opportunity-example">가상 공고</span>' : ''}</span>
      <strong>${e(item.role)}</strong>
      <span class="opportunity-row__meta">${e(item.location)} · ${e(item.experience_level)}</span>
      <span class="opportunity-row__skills">${e((item.skills || []).slice(0, 3).join(' · '))}</span>
    </button>`,
    )
    .join('');
}

export function opportunityDetail(posting, user) {
  return `
    <div class="opportunity-detail__header">
      <p class="opportunity-detail__company">${e(posting.company)} ${isExample(posting) ? '<span class="badge neutral">가상 공고</span>' : ''}</p>
      <h2>${e(posting.role)}</h2>
      <dl class="opportunity-detail__facts">
        <div><dt>근무지</dt><dd>${e(posting.location)}</dd></div>
        <div><dt>경력</dt><dd>${e(posting.experience_level)}</dd></div>
        <div><dt>고용 형태</dt><dd>${e(posting.employment_type)}</dd></div>
      </dl>
      <div class="opportunity-detail__skills">${(posting.skills || []).map((skill) => `<span class="badge neutral">${e(skill)}</span>`).join('')}</div>
    </div>
    <section class="opportunity-detail__body"><h3>담당 업무와 지원 요건</h3><div class="opportunity-description">${e(posting.description)}</div></section>
    <footer class="opportunity-detail__actions">
      <p>${user ? '저장한 이력서를 이 공고의 요구사항과 비교해 모의지원 결과를 확인합니다.' : '로그인·회원가입 후 이 공고로 모의지원 결과를 확인할 수 있어요.'}</p>
      <button id="opportunity-apply" class="button primary workflow-next" type="button">모의지원 결과 확인 ${icon('arrow', 18)}</button>
    </footer>`;
}
