import { escapeHtml as e, icon, renderPostingPhases } from '../shared/components/ui.js';
import {
  catalogPath,
  catalogReturnPath,
  safeSourceUrl,
} from '../features/job-postings/catalog-state.js';

const detailPath = (posting, query) =>
  `#/${catalogPath(`jobs/${encodeURIComponent(posting.id)}`, query)}`;
const resetPath = (query) =>
  `#/${catalogPath('jobs', new URLSearchParams({ return_to: query?.get('return_to') || '' }))}`;
const isExample = (posting) => posting.source_type === 'example' || posting.is_example === true;
const isLocalPosting = (posting) => ['manual', 'mock'].includes(posting.source_type);
const canWritePostings = (user) => user?.demo === true;
const readonlyMessage = '공고 작성·수정·삭제와 관심 공고 저장은 백엔드 연동 준비 중입니다.';
const readonlyNotice = `<p id="jobs-readonly-note" class="catalog-disclaimer">${readonlyMessage}</p>`;
const sourceBadge = (posting) => `
  <span class="badge ${isExample(posting) ? 'neutral' : 'confirmed'}">
    ${isExample(posting) ? '가상 예시' : isLocalPosting(posting) ? '시연용 입력 공고' : '등록 공고'}
  </span>
`;
const skillTags = (skills) => `
  <div class="skill-tags">
    ${(skills || [])
      .map(
        (skill) => `
          <span>${e(skill)}</span>
        `,
      )
      .join('')}
  </div>
`;
const metadata = (posting) => `
  <p class="posting-meta">
    ${[posting.location, posting.employment_type, posting.experience_level].map(e).join(' · ')}
  </p>
`;
const saveButton = (posting, user) => `
  <button
    type="button"
    class="button secondary compact bookmark-button"
    ${canWritePostings(user) ? `data-bookmark="${e(posting.id)}" aria-pressed="${Boolean(posting.is_saved)}"` : 'disabled aria-describedby="jobs-readonly-note"'}
    aria-label="${e(posting.role)} ${canWritePostings(user) && posting.is_saved ? '저장 해제' : '관심 공고 저장'}">
    ${canWritePostings(user) && posting.is_saved ? '시연 저장됨' : '관심 공고 저장'}
  </button>
`;

export function jobsLoading() {
  return `
    <div
      class="catalog-state"
      role="status"
      aria-live="polite">
      <h1>채용공고</h1>
      <p>공고를 불러오는 중…</p>
    </div>
  `;
}

export function jobsError(message, query) {
  return `
    <div class="catalog-state">
      <h1>공고를 불러오지 못했어요.</h1>
      <p role="alert">${e(message)}</p>
      <button
        class="button primary"
        type="button"
        id="retry-jobs">
        다시 시도
      </button>
      <a
        class="back-link"
        href="#/${e(catalogPath('jobs', query))}">
        공고 목록으로
      </a>
    </div>
  `;
}

function renderCatalogFilter(name, label, values, query) {
  return `
    <div class="catalog-filter">
      <label for="filter-${name}">${label}</label>
      <select
        id="filter-${name}"
        name="${name}">
        <option value="">전체</option>
        ${[...new Set([...(values || []), query.get(name)].filter(Boolean))]
          .map(
            (value) => `
              <option
                value="${e(value)}"
                ${query.get(name) === value ? 'selected' : ''}>
                ${e(value)}
              </option>
            `,
          )
          .join('')}
      </select>
    </div>
  `;
}

function renderJobCard(posting, query, user) {
  return `
    <article class="job-card">
      ${sourceBadge(posting)}
      <p class="posting-company">${e(posting.company)}</p>
      <h3><a href="${e(detailPath(posting, query))}">${e(posting.role)}</a></h3>
      ${metadata(posting)}
      ${skillTags(posting.skills)}
      <p class="posting-excerpt">${e(posting.description)}</p>
      <div class="job-card-actions">
        <a
          class="back-link"
          href="${e(detailPath(posting, query))}">
          상세 보기 ${icon('arrow', 16)}
        </a>
        ${saveButton(posting, user)}
      </div>
    </article>
  `;
}

function renderCatalogSearch(filters, query, user) {
  return `
    <form
      id="catalog-search"
      class="catalog-search"
      role="search"
      aria-label="채용공고 검색">
      <div class="catalog-search-row">
        <div class="catalog-search-input">
          <label for="job-search">직무·회사·기술 검색</label>
          <input
            type="search"
            id="job-search"
            name="q"
            maxlength="200"
            value="${e(query.get('q'))}"
            placeholder="예: Python, 데이터 분석" />
        </div>
        <button
          class="button primary"
          type="submit">
          ${icon('lens', 18)} 검색
        </button>
      </div>
      <div class="catalog-filters">
        ${renderCatalogFilter('role_category', '직무 분류', filters.roles, query)}
        ${renderCatalogFilter('location', '지역', filters.locations, query)}
        ${renderCatalogFilter('employment_type', '고용 형태', filters.employment_types, query)}
        ${renderCatalogFilter('experience_level', '경력', filters.experience_levels, query)}
        ${renderCatalogFilter('skill', '기술', filters.skills, query)}
      </div>
      <div class="catalog-search-bottom">
        <label class="catalog-saved-filter">
          <input
            type="checkbox"
            name="saved"
            value="1"
            ${canWritePostings(user) && query.get('saved') === '1' ? 'checked' : ''}
            ${canWritePostings(user) ? '' : 'disabled aria-describedby="jobs-readonly-note"'} />
          ${canWritePostings(user) ? '시연 저장 공고만' : '저장한 공고만 · 연동 준비 중'}
        </label>
        <a
          href="${e(resetPath(query))}"
          class="back-link">
          검색 초기화
        </a>
      </div>
    </form>
  `;
}

function renderCatalogPagination(data, query) {
  const pageLink = (page) => {
    const next = new URLSearchParams(query);
    next.set('page', String(page));
    return `#/jobs?${e(next.toString())}`;
  };
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  return `
    <nav
      class="catalog-pagination"
      aria-label="공고 페이지">
      ${
        data.page > 1
          ? `
            <a
              class="button secondary compact"
              href="${pageLink(data.page - 1)}">
              이전
            </a>
          `
          : `
            <button
              class="button secondary compact"
              disabled>
              이전
            </button>
          `
      }
      <span>${data.page} / ${pages} 페이지</span>
      ${
        data.page < pages
          ? `
            <a
              class="button secondary compact"
              href="${pageLink(data.page + 1)}">
              다음
            </a>
          `
          : `
            <button
              class="button secondary compact"
              disabled>
              다음
            </button>
          `
      }
    </nav>
  `;
}

export function jobListPage(data, query, user) {
  const filters = data.filters || {};
  const returnTo = catalogReturnPath(query.get('return_to'));
  const canWrite = canWritePostings(user);
  const savedOnly = canWrite && query.get('saved') === '1';

  return `
    ${renderPostingPhases('posting')}
    <div class="page-heading catalog-heading">
      <div>
        <h1>직무별 채용공고</h1>
        <p>공고에 기재된 직무로 분류해 관심 있는 일을 찾아보세요.</p>
      </div>
      ${returnTo ? `<a class="button secondary compact" href="#/${e(returnTo)}">공고 선택으로 돌아가기</a>` : ''}
      ${canWrite ? `<a class="button primary compact" href="#/${e(catalogPath('jobs/new', query))}">공고 직접 입력 ${icon('arrow', 17)}</a>` : '<button class="button secondary compact" type="button" disabled aria-describedby="jobs-readonly-note">공고 직접 입력</button>'}
    </div>
    <div class="catalog-content">
      <p class="catalog-disclaimer" ${canWrite ? '' : 'id="jobs-readonly-note"'}>
        ${canWrite ? '시연용 공고와 관심 공고 표시는 이 탭에만 보관되며 실제 계정이나 서버에는 저장되지 않습니다.' : user ? '평가 서버에 등록된 공고를 조회합니다. 실제 모집 여부는 출처에서 확인해 주세요. 모의지원은 기업에 전송되지 않습니다.' : '가상 예시 공고로 로그인 전에 모의지원 분석을 진행합니다. 완성된 결과는 임시 보관되며 로그인·회원가입 후 바로 확인할 수 있습니다.'}
        ${canWrite ? '' : readonlyMessage}
      </p>
      ${renderCatalogSearch(filters, query, user)}
      <div class="catalog-results-heading">
        <h2>
          ${savedOnly ? '시연 저장 공고' : '둘러볼 공고'}
          <span>${Number(data.total).toLocaleString('ko-KR')}개</span>
        </h2>
        <span>직무·지역·경력 선택 후 검색을 눌러주세요.</span>
      </div>
      ${
        data.items.length
          ? `
            <div class="job-grid">${data.items.map((posting) => renderJobCard(posting, query, user)).join('')}</div>
          `
          : `
            <div class="catalog-state empty-results">
              <h3>
                ${
                  savedOnly
                    ? '아직 저장한 공고가 없어요.'
                    : '조건에 맞는 공고가 없어요.'
                }
              </h3>
              <p>
                ${
                  savedOnly
                    ? '마음에 드는 공고의 관심 공고 저장을 눌러보세요.'
                    : '검색어를 줄이거나 필터를 초기화해 보세요.'
                }
              </p>
              <a
                href="${e(resetPath(query))}"
                class="button secondary compact">
                전체 공고 보기
              </a>
            </div>
          `
      }
      ${renderCatalogPagination(data, query)}
    </div>
  `;
}

export function jobDetailPage(posting, user, query) {
  const url = safeSourceUrl(posting.source_url);
  const canWrite = canWritePostings(user);
  const own = canWrite && (posting.is_owner === true || posting.source_type === 'mock');
  return `
    ${renderPostingPhases('posting')}
    <div class="catalog-content job-detail">
      <a
        href="#/${e(catalogPath('jobs', query))}"
        class="back-link">
        ← 공고 목록
      </a>
      <div class="job-detail-heading">
        <div>
          ${sourceBadge(posting)}
          <p class="posting-company">${e(posting.company)}</p>
          <h1>${e(posting.role)}</h1>
          ${metadata(posting)}
      ${skillTags(posting.skills)}
        </div>
        <div class="job-detail-actions">
          ${saveButton(posting, user)}
          <button
            class="button primary workflow-next"
            id="select-posting"
            type="button">
            모의지원 결과 확인 ${icon('arrow', 18)}
          </button>
        </div>
      </div>
      <p class="catalog-disclaimer" ${canWrite ? '' : 'id="jobs-readonly-note"'}>
        ${
          isExample(posting)
            ? '학습과 기능 체험을 위한 가상 공고입니다. 실제 채용 중인 기업의 공고가 아닙니다.'
            : isLocalPosting(posting)
              ? '이 탭에만 보관된 시연용 입력 공고입니다. 실제 계정이나 평가 서버에는 저장되지 않습니다.'
              : '모의지원 분석에 사용하는 등록 공고입니다. 실제 모집 여부는 공고 출처에서 확인해 주세요.'
        }
        ${canWrite ? '관심 공고 표시는 시연용으로 이 탭에만 보관됩니다.' : readonlyMessage}
      </p>
      <section
        class="posting-description"
        aria-labelledby="description-title">
        <h2 id="description-title">주요 업무와 지원 요건</h2>
        <div class="posting-body">${e(posting.description)}</div>
      </section>
      ${
        url
          ? `
            <p class="posting-source">
              <a
                href="${e(url)}"
                target="_blank"
                rel="noopener noreferrer">
                ${isExample(posting) ? '참고한 실제 직무 자료' : '공고 원문 링크'}
                열기 ↗
              </a>
              <span>
                ${
                  isExample(posting)
                    ? '가상 기업의 실제 채용 링크가 아닌 직무 참고 출처입니다. '
                    : ''
                }새
                탭에서 열립니다.
              </span>
            </p>
          `
          : ''
      }
      ${
        own
          ? `
            <div class="posting-owner-actions">
              <a
                href="#/${e(catalogPath(`jobs/${encodeURIComponent(posting.id)}/edit`, query))}"
                class="button secondary compact">
                공고 수정
              </a>
              <button
                type="button"
                id="delete-posting"
                class="text-button">
                내 공고 삭제
              </button>
            </div>
          `
          : ''
      }
    </div>
  `;
}

export function postingEditorPage(draft = {}, id, query, user) {
  if (!canWritePostings(user)) {
    return `<div class="page-heading"><div><h1>${id ? '공고 수정' : '공고 직접 입력'}</h1><p>현재 연결된 서버는 공고 조회를 지원합니다.</p></div></div>
      <div class="catalog-content">
        ${readonlyNotice}
        <a class="button secondary" href="#/${e(catalogPath('jobs', query))}">공고 목록으로 돌아가기</a>
      </div>`;
  }
  const input = (name, label, placeholder, limit = 120) => `
    <div class="field">
      <label for="posting-${name}">${label}</label>
      <input
        id="posting-${name}"
        name="${name}"
        value="${e(draft[name])}"
        maxlength="${limit}"
        placeholder="${placeholder}"
        required />
    </div>
  `;
  return `
    <div class="page-heading">
      <div>
        <h1>${id ? '내 공고 수정' : '공고 직접 입력'}</h1>
        <p>입력한 공고는 시연용으로 이 탭에만 보관됩니다. 실제 계정이나 서버에는 저장되지 않습니다.</p>
      </div>
    </div>
    <div class="catalog-content posting-editor">
      <form
        id="posting-form"
        class="editor-panel padded-form">
        <div class="two-fields">
          ${input('company', '회사명', '예: 내가 관심 있는 회사')}
          ${input('role', '채용 직무', '예: Python 백엔드 개발자')}
        </div>
        <div class="two-fields">
          ${input('location', '지역', '예: 서울, 원격', 80)}
          ${input('employment_type', '고용 형태', '예: 정규직, 인턴', 80)}
        </div>
        ${input('experience_level', '경력', '예: 신입, 경력 1~3년', 80)}
        <div class="field">
          <label for="posting-skills">기술·역량</label>
          <input
            id="posting-skills"
            name="skills"
            maxlength="1040"
            value="${e(Array.isArray(draft.skills) ? draft.skills.join(', ') : draft.skills)}"
            placeholder="Python, SQL, Git"
            aria-describedby="posting-skills-hint" />
          <p
            class="input-hint"
            id="posting-skills-hint">
            쉼표로 구분해 최대 20개, 항목당 50자까지 입력해 주세요.
          </p>
        </div>
        <div class="field">
          <label for="posting-description">채용공고 본문</label>
          <textarea
            id="posting-description"
            name="description"
            rows="13"
            minlength="40"
            maxlength="50000"
            required
            data-count="posting-description-count"
            aria-describedby="posting-description-hint">${e(draft.description)}</textarea>
          <div class="field-meta">
            <span id="posting-description-hint">
              주요 업무·자격 요건·우대 사항을 40자 이상 입력하세요.
            </span>
            <span id="posting-description-count"></span>
          </div>
        </div>
        <div class="field">
          <label for="posting-source_url">
            원문 링크
            <span class="optional-label">선택</span>
          </label>
          <input
            id="posting-source_url"
            name="source_url"
            type="url"
            maxlength="2000"
            value="${e(draft.source_url)}"
            placeholder="https://…"
            aria-describedby="posting-url-hint" />
          <p
            id="posting-url-hint"
            class="input-hint">
            링크는 출처 표시용입니다. 원문을 자동 수집하지 않습니다.
          </p>
        </div>
        <div class="form-actions">
          <a
            href="#/${e(catalogPath(id ? `jobs/${encodeURIComponent(id)}` : 'jobs', query))}"
            class="back-link">
            ${id ? '상세로 돌아가기' : '목록으로 돌아가기'}
          </a>
          <button
            class="button primary"
            type="submit">
            ${id ? '수정 저장' : '내 공고 저장'}
          </button>
        </div>
      </form>
    </div>
  `;
}
