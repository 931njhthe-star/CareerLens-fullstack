import { icon } from '../shared/components/ui.js';
import { resumeEditor } from '../features/resumes/resume.js';
import { desiredRolePage } from './desired-role.js';
import { analysisReport } from '../features/analysis/report.js';
import { resumeExamplesPanel } from '../features/resumes/examples.js';

function renderResumePage(draft) {
  return `
    <div class="page-heading">
      <div>
        <h1>
          지원의 시작은,
          <br class="mobile-break" />
          내 이력서부터.
        </h1>
        <p>이력서를 불러오면 희망 직무를 향한 준비 상태를 확인합니다.</p>
      </div>
      ${
        draft.resume_text
          ? ''
          : `
            <button
              id="example"
              class="button secondary compact"
              type="button">
              예시로 체험하기 ${icon('arrow', 17)}
            </button>
          `
      }
    </div>
    ${resumeExamplesPanel()}
    <div class="editor-layout">
      ${resumeEditor(draft)}
      <aside class="guide-panel">
        <h2>
          모의지원까지,
          <br />
          세 단계로 준비해요.
        </h2>
        <ol class="journey">
          <li class="current">
            <span>1</span>
            <div>
              <strong>이력서 입력</strong>
              <p>Markdown(.md) 이력서를 첨부하거나 본문을 직접 입력해요.</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>채용공고 선택</strong>
              <p>희망 직무를 정하고, 관련 공고를 비교해 선택해요.</p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>모의지원</strong>
              <p>선택한 공고로 보고서를 확인해요.</p>
            </div>
          </li>
        </ol>
        <div class="privacy-note">
          ${icon('lock', 20)}
          <p>
            입력한 이력서와 희망 직무는 연결된 팀 API로 전송됩니다. 저장과 분석은 해당 서비스의
            설정을 따릅니다.
          </p>
        </div>
        <p class="small-note">
          첨부는 10MB 이하의 UTF-8 Markdown(.md) 파일만 지원해요. 불러온 뒤 본문을 확인해 주세요.
        </p>
      </aside>
    </div>
    ${
      draft.resume_text
        ? `
          <div class="reset-form">
            <button
              id="clear-workspace"
              class="text-button"
              type="button">
              입력 내용과 결과 삭제
            </button>
          </div>
        `
        : ''
    }
  `;
}

export function workspacePage(page, draft) {
  switch (page) {
    case 'result':
      return analysisReport(draft);
    case 'job': // Compatibility for callers using the former route.
    case 'desired-role':
      return desiredRolePage(draft);
    default:
      return renderResumePage(draft);
  }
}
