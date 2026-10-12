import { escapeHtml as e, icon } from '../shared/components/ui.js';
import { jobEditor } from '../features/job-postings/job.js';

export function desiredRolePage(draft) {
  return `
    <div class="page-heading" data-page="desired-role">
      <div>
        <h1>희망하는 직무를 선택해 주세요.</h1>
        <p>내 경험을 바탕으로, 앞으로 하고 싶은 일을 준비합니다.</p>
      </div>
    </div>
    <div class="editor-layout">
      ${jobEditor(draft)}
      <aside class="guide-panel">
        <div class="aside-icon">${icon('briefcase', 27)}</div>
        <h2>
          어떤 일을
          <br />
          하고 싶으신가요?
        </h2>
        <p>
          관심 있는 직무를 고르거나 직접 입력할 수 있어요. 이력서에 담긴 경험과 더 설명하면 좋은
          부분을 공고의 요구사항과 함께 살펴봅니다.
        </p>
        <div class="attached-resume">
          ${icon('check', 18)}
          <div>
            <strong>${draft.guest ? (draft.resume_attached ? '분석할 이력서가 첨부되었어요' : '분석 전 이력서를 첨부해 주세요') : '이력서 준비 완료'}</strong>
            <p>
              ${e(draft.filename || (draft.guest ? '선택한 파일이 없습니다.' : '직접 입력한 이력서'))}
              <br />
              ${draft.guest ? '비회원도 분석까지 진행할 수 있어요. 결과 열람은 로그인 후 가능합니다.' : `${(draft.resume_text?.length || 0).toLocaleString('ko-KR')}자`}
            </p>
          </div>
        </div>
        <p class="small-note">
          직무 선택은 언제든 바꿀 수 있어요. 변경한 내용에 맞춰 모의지원을 다시 준비합니다.
        </p>
      </aside>
    </div>
  `;
}
