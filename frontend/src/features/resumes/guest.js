import { escapeHtml as e, icon } from '../../shared/components/ui.js';
import { validateResumeFileMetadata } from './file-preflight.js';

/** Render metadata only. The upload handler owns the File and temporary server session. */
export function guestResumePage(metadata = '') {
  const {
    filename = '',
    resume_attached = false,
    loginBeforeAnalysis = false,
    previewBeforeLogin = false,
    analysisUnavailable = false,
  } = typeof metadata === 'string' ? { filename: metadata } : metadata || {};
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
          <p id="guest-file-hint">Markdown(.md)만 첨부 가능 · UTF-8 텍스트 · 최대 10MB</p>
          <p class="input-hint">경력·프로젝트·기술·학력을 텍스트로 작성해 .md로 저장해 주세요. 업로드 전에 파일 형식과 크기, 본문을 확인합니다.</p>
          <div class="file-controls">
            <input id="guest-resume-file" name="file" type="file" accept=".md" ${resume_attached ? '' : 'required'}
              aria-label="Markdown 이력서 파일 선택" aria-describedby="guest-file-hint guest-file-status" />
          </div>
          <p id="guest-file-status" class="file-caption" role="status">${e(filename ? `${resume_attached ? '첨부 완료 · ' : '선택한 파일 · '}${filename}` : '선택한 파일이 없습니다.')}</p>
        </div>
        <div class="guest-resume__privacy">
          ${icon('lock', 24)}
          <h2>${analysisUnavailable ? '비회원 분석 연결을 확인해 주세요.' : previewBeforeLogin ? '보고서 화면까지 둘러보고, 로그인으로 이어가세요.' : loginBeforeAnalysis ? '준비는 지금, 분석은 로그인 후.' : '분석은 바로, 결과 확인은 로그인 후.'}</h2>
          ${
            analysisUnavailable
              ? '<p>현재 비회원 분석 서비스에 연결할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.</p><p>이력서와 공고는 준비할 수 있지만, 서비스가 연결되기 전에는 분석을 시작하지 않습니다.</p>'
              : previewBeforeLogin
              ? '<p>선택한 공고의 결과 확인을 누르면 눈 모션과 함께 잠긴 보고서 화면이 열립니다. 로그인하거나 회원가입하면 같은 자료로 실제 분석을 이어갑니다.</p><p>이력서 내용과 선택 공고는 이 브라우저 탭에 첨부 후 30분 동안 임시 보관합니다. 새로고침해도 남아 있지만, 다른 기기나 탭으로 옮겨지지는 않습니다.</p>'
              : loginBeforeAnalysis
              ? '<p>파일에서 추출한 이력서 내용은 이 브라우저 탭에 임시 보관합니다. 로그인하면 연결된 서비스에 저장하고 분석을 이어갑니다.</p><p>로그인 전 내용은 첨부 후 30분까지만 사용할 수 있으며, 탭을 닫으면 지워집니다. 원본 파일은 변환 서버에 저장하지 않습니다.</p>'
              : '<p>첨부한 이력서는 서버로 전송해 내용을 추출하고 임시 분석에 사용합니다. 원본 파일은 저장하지 않습니다.</p><p>로그인·회원가입 없이 첨부 후 30분이 지나면 이력서 내용과 분석 결과가 자동 삭제됩니다. 결과 확인 화면에서 직접 파기할 수도 있어요.</p>'
          }
        </div>
        <div class="form-actions guest-resume__actions">
          <span class="quiet">채용공고 단계에서 희망 직무를 고른 뒤 공고를 선택합니다.</span>
          <button type="submit" class="button primary workflow-next">첨부한 이력서로 계속 ${icon('arrow', 18)}</button>
        </div>
        </form>
      </section>
      <aside class="guide-panel">
        <h2>어떤 일을<br />하고 싶으신가요?</h2>
        <p>희망 직무와 관련된 공고를 목록에서 비교해 보세요. 공고를 선택하면 같은 이력서로 공고별 모의지원 보고서를 만들 수 있습니다.</p>
        <p class="small-note">${analysisUnavailable ? '비회원 분석 서비스 연결 후, 로그인 전에 분석을 완료하고 결과를 보관합니다.' : previewBeforeLogin ? '보고서의 점수와 내용은 로그인 후 실제 분석이 끝나면 표시됩니다.' : loginBeforeAnalysis ? '이력서와 희망 직무를 준비한 뒤 로그인하면 실제 모의지원 분석을 진행할 수 있어요.' : '로그인 없이 이력서를 첨부하고 모의지원 분석까지 진행할 수 있어요. 완성된 분석 결과는 로그인 또는 회원가입 후 확인합니다.'}</p>
      </aside>
    </div>`;
}

export function guestFileMetadata(file) {
  if (!file) return '';
  return validateResumeFileMetadata(file);
}
