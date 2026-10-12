import { escapeHtml as e, icon } from '../../shared/components/ui.js';

/** Render metadata only. The upload handler owns the File and temporary server session. */
export function guestResumePage(metadata = '') {
  const { filename = '', resume_attached = false } =
    typeof metadata === 'string' ? { filename: metadata } : metadata || {};
  return `
    <div class="page-heading"><div>
      <h1>지원의 시작은,<br class="mobile-break" />내 이력서부터.</h1>
      <p>이력서를 첨부하고, 나에게 맞는 채용공고로 모의지원을 시작하세요.</p>
    </div></div>
    <div class="editor-layout">
      <section class="editor-panel guest-resume" aria-labelledby="guest-resume-title">
        <form id="guest-upload-form">
        <div class="upload-area">
          <div class="upload-icon">${icon('upload', 26)}</div>
          <h2 id="guest-resume-title">이력서 첨부</h2>
          <p id="guest-file-hint">Markdown, PDF, DOCX, TXT · 최대 10MB · 비로그인 체험용</p>
          <div class="file-controls">
            <input id="guest-resume-file" name="file" type="file" accept=".md,.pdf,.docx,.txt" ${resume_attached ? '' : 'required'}
              aria-label="이력서 파일 선택" aria-describedby="guest-file-hint guest-file-status" />
          </div>
          <p id="guest-file-status" class="file-caption" role="status">${e(filename ? `${resume_attached ? '첨부 완료 · ' : '선택한 파일 · '}${filename}` : '선택한 파일이 없습니다.')}</p>
        </div>
        <div class="guest-resume__privacy">
          ${icon('lock', 24)}
          <h2>분석은 바로, 결과 확인은 로그인 후.</h2>
          <p>비로그인 보고서는 예시 데이터로 만드는 시연용 결과이며, 첨부한 파일의 내용을 분석하지 않습니다. 파일은 백엔드로 전송하지 않고 이 브라우저 탭에서만 임시로 다룹니다.</p>
          <p>체험 데이터는 이 탭에만 보관되며 30분 동안 유효합니다. 결과 확인 화면에서 직접 파기할 수도 있어요.</p>
        </div>
        <div class="form-actions guest-resume__actions">
          <span class="quiet">다음 단계에서 희망 직무를 선택합니다.</span>
          <button type="submit" class="button primary workflow-next">첨부한 이력서로 계속 ${icon('arrow', 18)}</button>
        </div>
        </form>
      </section>
      <aside class="guide-panel">
        <h2>어떤 일을<br />하고 싶으신가요?</h2>
        <p>희망 직무와 관련된 공고를 목록에서 비교해 보세요. 공고를 선택하면 같은 이력서로 공고별 모의지원 보고서를 만들 수 있습니다.</p>
        <p class="small-note">로그인 없이 화면 흐름을 체험할 수 있어요. 실제 백엔드 평가는 계정으로 로그인한 뒤 등록된 이력서와 공고로 진행합니다.</p>
      </aside>
    </div>`;
}

export function guestFileMetadata(file) {
  if (!file) return '';
  if (file.size > 10 * 1024 * 1024) throw new Error('파일은 10MB 이하로 선택해 주세요.');
  if (!/\.(md|pdf|docx|txt)$/i.test(file.name))
    throw new Error('Markdown, PDF, DOCX, TXT 파일을 선택해 주세요.');
  return file.name;
}
