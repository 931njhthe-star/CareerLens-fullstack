import { escapeHtml as e, icon } from '../../shared/components/ui.js';

function renderQuestionField(question, index, answers) {
  const inputId = `answer-${index}`;
  const reasonId = `reason-${index}`;
  const answer = e(answers?.[question.id] || '');

  return `
    <div class="question-field">
      <label for="${inputId}">
        <span class="question-index">${index + 1}</span>
        ${e(question.prompt)}
      </label>
      <p
        id="${reasonId}"
        class="input-hint">
        ${e(question.reason)}
      </p>
      <textarea
        id="${inputId}"
        name="${e(question.id)}"
        aria-describedby="${reasonId}"
        rows="4"
        maxlength="8000"
        placeholder="본인이 맡은 역할, 실제로 한 일, 확인 가능한 결과를 적어주세요. 관련 경험이 없다면 비워두어도 괜찮습니다.">${answer}</textarea>
    </div>
  `;
}

export function questionsEditor(draft, questions) {
  const fields = questions
    .map((question, index) => renderQuestionField(question, index, draft.answers))
    .join('');
  const emptyMessage = `
    <p class="input-hint">추가 질문 없이 현재 입력한 내용으로 분석할 수 있습니다.</p>
  `;

  return `
    <form
      id="analysis-form"
      class="editor-panel padded-form">
      ${fields || emptyMessage}
      <div class="form-actions">
        <a
          class="back-link"
          href="#/desired-role">
          희망 직무 수정
        </a>
        <button
          class="button primary"
          type="submit">
          모의지원 결과 확인 ${icon('arrow', 18)}
        </button>
      </div>
    </form>
  `;
}
