import { escapeHtml as e, icon } from '../../shared/components/ui.js';

export function roleChoicesMarkup(items, selected = '') {
  return `
    <option
      value=""
      disabled
      ${selected ? '' : 'selected'}>
      희망 직무를 선택하세요
    </option>
    ${items
      .map(
        (item) => `
          <option
            value="${e(item.id)}"
            data-description="${e(item.description)}"
            ${item.id === selected ? 'selected' : ''}>
            ${e(item.label)}
          </option>
        `,
      )
      .join('')}
  `;
}

export function jobEditor(draft) {
  const target = draft.career_target || {};
  const custom = target.role_id === 'custom';
  return `
    <form
      id="job-form"
      class="editor-panel padded-form career-target-form">
      <div
        class="field"
        id="career-role-options">
        <label for="career-role">희망 직무</label>
        <p
          id="career-role-hint"
          class="input-hint">
          앞으로 하고 싶은 일을 선택해 주세요. 다음 화면에서 관련 채용공고를 살펴볼 수 있습니다.
        </p>
        <select
          id="career-role"
          name="role_id"
          required
          disabled
          aria-describedby="career-role-hint career-role-description">
          <option value="">직무 목록을 불러오는 중…</option>
        </select>
        <p
          id="career-role-description"
          class="career-role-description"
          aria-live="polite"></p>
      </div>
      <div
        class="field"
        id="custom-role-field"
        ${custom ? '' : 'hidden'}>
        <label for="role">희망 직무 직접 입력</label>
        <input
          id="role"
          name="role"
          maxlength="120"
          ${custom ? 'required' : ''}
          value="${e(target.label || draft.role || '')}"
          placeholder="예: 의료 서비스 기획자"
          autocomplete="off" />
      </div>
      <div class="field">
        <label for="career-focus">
          특히 살펴보고 싶은 부분
          <span class="optional-label">선택</span>
        </label>
        <p
          id="career-focus-hint"
          class="input-hint">
          관심 있는 업무나 이력서에서 점검하고 싶은 경험을 적어주세요.
        </p>
        <textarea
          id="career-focus"
          name="focus"
          rows="5"
          maxlength="1000"
          aria-describedby="career-focus-hint"
          placeholder="예: 데이터 분석 경험이 서비스 기획 업무에 어떻게 도움이 될지 알고 싶어요.">${e(target.focus || '')}</textarea>
      </div>
      <div class="career-target-next">
        <span>${icon('lens', 21)}</span>
        <p>
          희망 직무에 관련된 공고를 목록과 상세 화면으로 확인합니다. 원하는 공고를 선택하면 그
          공고의 요구사항을 기준으로 모의지원합니다.
        </p>
      </div>
      <div class="form-actions">
        <a
          class="back-link"
          href="#/resume">
          이력서 수정
        </a>
        <button
          id="prepare-submit"
          class="button primary workflow-next"
          type="submit"
          disabled>
          관련 채용공고 보기 ${icon('arrow', 18)}
        </button>
      </div>
    </form>
  `;
}
