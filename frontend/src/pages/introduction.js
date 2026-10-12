import { icon } from '../shared/components/ui.js';

export function introductionPage() {
  return `
    <section class="introduction" aria-labelledby="introduction-title" data-introduction>
      <div class="introduction__topline">
        <span class="introduction__eyebrow">나의 다음 커리어를 보는 시간</span>
        <button type="button" class="button secondary compact" data-intro-skip>
          건너뛰기 ${icon('arrow', 16)}
        </button>
      </div>
      <div class="introduction__body">
        <div class="introduction__visual" aria-hidden="true" data-intro-journey></div>
        <div class="introduction__copy">
          <p class="introduction__wordmark">Career<span>Lens</span></p>
          <h1 id="introduction-title">경험을 살피고,<br />다음 기회를 준비하세요.</h1>
          <p class="introduction__description">이력서와 채용공고를 연결하는 모의 지원</p>
        </div>
      </div>
      <div class="introduction__bottomline">
        <span class="introduction__progress" aria-hidden="true"><span></span></span>
        <p>잠시 후 이력서 화면으로 이동합니다.</p>
      </div>
    </section>
  `;
}
