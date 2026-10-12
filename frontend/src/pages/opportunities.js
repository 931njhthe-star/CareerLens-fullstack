import { escapeHtml as e, icon } from '../shared/components/ui.js';
import { renderMarkdown } from '../shared/components/markdown.js';

export function opportunitiesPage() {
  return `
    <div class="page-heading opportunities-heading"><div>
      <h1>어떤 공고에 지원해 볼까요?</h1>
      <p>희망 직무와 관련된 공고를 비교하고, 모의지원할 공고를 선택하세요.</p>
    </div><a class="back-link" href="#/desired-role">희망 직무 수정</a></div>
    <section class="opportunities" aria-label="희망 직무별 채용공고">
      <aside class="opportunities__sidebar" aria-label="채용공고 목록">
        <div class="opportunities__list-heading"><h2 id="opportunity-role">채용공고</h2><p id="opportunity-count" role="status">목록을 불러오는 중…</p></div>
        <div id="opportunity-list" class="opportunities__list" aria-busy="true"></div>
        <nav id="opportunity-pagination" class="opportunities__pagination" aria-label="공고 페이지"></nav>
      </aside>
      <article id="opportunity-detail" class="opportunities__detail" aria-label="선택한 채용공고 상세" tabindex="-1" aria-busy="true">
        <div class="opportunities__empty"><h2>공고를 준비하고 있어요.</h2><p>목록을 불러온 뒤 상세 내용을 표시합니다.</p></div>
      </article>
    </section>`;
}

export function opportunityList(items, selected) {
  return items
    .map(
      (item) => `
    <button type="button" class="opportunity-row" data-posting-id="${e(item.id)}"
      aria-current="${item.id === selected ? 'true' : 'false'}">
      <span class="opportunity-row__company">${e(item.company)}${item.source_type === 'example' ? '<span class="opportunity-example">가상 공고</span>' : item.source_type === 'backend' ? '<span class="opportunity-example">백엔드 등록</span>' : ''}</span>
      <strong>${e(item.role)}</strong>
      <span class="opportunity-row__meta">${e(item.location)} · ${e(item.experience_level)}</span>
      <span class="opportunity-row__skills">${e((item.skills || []).slice(0, 3).join(' · '))}</span>
    </button>`,
    )
    .join('');
}

export function opportunityDetail(posting, user) {
  const demoAccount = user?.demo === true;
  const backendEvaluation = posting.source_type === 'backend' && !demoAccount;
  const actionCopy = !user
    ? '비회원은 화면 체험용 예시만 볼 수 있습니다. 실제 에이전트 평가는 실제 백엔드 계정과 백엔드에 저장된 이력서가 필요합니다.'
    : demoAccount
    ? '시연 계정은 화면 체험용입니다. 실제 에이전트 평가에는 실제 백엔드 계정과 백엔드에 저장된 이력서가 필요합니다.'
    : backendEvaluation
      ? '백엔드에 저장된 이력서와 이 공고 원문으로 에이전트 평가를 실행합니다.'
      : '이 공고는 백엔드에 등록되지 않아 실제 에이전트 평가에 사용할 수 없습니다. 다음 결과는 화면 체험용 예시입니다.';
  return `
    <div class="opportunity-detail__header">
      <p class="opportunity-detail__company">${e(posting.company)} ${posting.source_type === 'example' ? '<span class="badge neutral">가상 공고</span>' : posting.source_type === 'backend' ? '<span class="badge confirmed">백엔드 등록 공고</span>' : ''}</p>
      <h2>${e(posting.role)}</h2>
      <dl class="opportunity-detail__facts">
        <div><dt>근무지</dt><dd>${e(posting.location)}</dd></div>
        <div><dt>경력</dt><dd>${e(posting.experience_level)}</dd></div>
        <div><dt>고용 형태</dt><dd>${e(posting.employment_type)}</dd></div>
      </dl>
      <div class="opportunity-detail__skills">${(posting.skills || []).map((skill) => `<span class="badge neutral">${e(skill)}</span>`).join('')}</div>
    </div>
    <section class="opportunity-detail__body"><h3>${posting.source_markdown ? '공고 원문' : '담당 업무와 지원 요건'}</h3><div class="opportunity-description">${posting.source_markdown ? renderMarkdown(posting.source_markdown) : e(posting.description)}</div></section>
    <footer class="opportunity-detail__actions">
      <p>${e(actionCopy)}</p>
      <button id="opportunity-apply" class="button primary workflow-next" type="button">${backendEvaluation ? '에이전트 평가 결과 확인' : '시연 결과 확인'} ${icon('arrow', 18)}</button>
    </footer>`;
}
