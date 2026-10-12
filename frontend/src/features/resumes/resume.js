import { escapeHtml as e, icon } from '../../shared/components/ui.js';

export function resumeEditor(draft) {
  return `
    <section
      class="editor-panel"
      aria-labelledby="resume-heading">
      <form
        id="upload-form"
        class="upload-area">
        <div class="upload-icon">${icon('upload', 26)}</div>
        <h2 id="resume-heading">이력서 파일 불러오기</h2>
        <p id="file-hint">Markdown(.md)만 첨부 가능 · UTF-8 텍스트 · 최대 10MB</p>
        <p class="input-hint">경력·프로젝트·기술·학력을 텍스트로 작성해 .md로 저장해 주세요. 업로드 전에 파일 형식과 크기, 본문을 확인합니다.</p>
        <div class="file-controls">
          <input
            id="resume-file"
            name="file"
            type="file"
            accept=".md"
            required
            aria-label="Markdown 이력서 파일 선택"
            aria-describedby="file-hint" />
          <button
            type="submit"
            class="button secondary">
            파일 불러오기
          </button>
        </div>
      </form>
      <form
        id="resume-form"
        class="resume-form">
        <div class="field-heading">
          <label for="resume-text">이력서 본문</label>
          <span>직접 붙여넣어도 좋아요</span>
        </div>
        ${
          draft.filename
            ? `
              <p class="file-caption">${icon('file', 16)} ${e(draft.filename)}</p>
            `
            : ''
        }
        <textarea
          id="resume-text"
          name="resume_text"
          rows="15"
          minlength="40"
          maxlength="50000"
          required
          placeholder="경력, 프로젝트, 기술, 학력 등이 포함된 이력서를 붙여넣으세요.&#10;&#10;예) Python과 FastAPI로 주문 조회 API를 개발했습니다.&#10;쿼리를 개선해 평균 응답 시간을 420ms에서 180ms로 단축했습니다."
          aria-describedby="resume-hint"
          data-count="resume-count">${e(draft.resume_text)}</textarea>
        <div class="field-meta">
          <span id="resume-hint">최소 40자 · 불러온 날짜와 문장이 정확한지 확인해 주세요.</span>
          <span id="resume-count"></span>
        </div>
        <div class="form-actions">
          <span class="quiet">채용공고 단계에서 희망 직무를 고른 뒤 공고를 선택합니다.</span>
          <button
            class="button primary workflow-next"
            type="submit">
            채용공고로 계속 ${icon('arrow', 18)}
          </button>
        </div>
      </form>
    </section>
  `;
}
