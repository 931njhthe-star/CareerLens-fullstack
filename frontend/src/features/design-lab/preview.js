// Fictional, fixed content for the design lab. No workspace or API data enters this preview.
const axes = [
  ['이력서 완성도', '경험의 맥락이 명료해요', '프로젝트의 목적과 맡은 역할이 연결되어 있습니다.'],
  [
    '직무 적합도',
    '백엔드 경험이 드러나요',
    'API 설계와 데이터 처리 경험이 희망 직무와 이어집니다.',
  ],
  [
    '지원 자격 충족도',
    '핵심 기술을 확인했어요',
    '가상 공고의 Java·Spring 요구 사항과 연결되는 경험입니다.',
  ],
  [
    '실무 경쟁력',
    '개선 과정을 보완해 보세요',
    '문제를 발견한 과정과 검증 방법을 덧붙이면 좋습니다.',
  ],
];

export const previewLayoutNotes = {
  focus: '요약과 피라미드를 나란히 두고, 평가축과 근거를 아래로 읽는 균형형',
  editorial: '문장 중심의 넓은 본문과 좁은 시각 자료 여백으로 구성한 리포트형',
  compass: '피라미드를 중심으로 네 평가축을 둘러 배치한 탐색형',
  stacked: '시각 요약부터 근거까지 한 방향으로 내려 읽는 문서형',
  briefing: '지원자와 평가축을 왼쪽에 고정된 지면처럼 묶은 브리핑형',
  studio: '큰 피라미드와 핵심 문장을 먼저 보여 주는 시각 중심형',
};

function identity(title = '김하늘님의 가능성을\n읽었습니다.') {
  return `<header class="preview-identity" data-reveal>
    <h2>${title.split('\n').join('<br>')}</h2>
    <p class="preview-person">김하늘 <span>가상 인물</span><i aria-hidden="true"></i>백엔드 개발</p>
    <p class="preview-context">가상 공고 · 라이트웨이브 플랫폼 개발팀</p>
  </header>`;
}

function summary({ heading = '경험의 연결이 강점입니다.', compact = false } = {}) {
  return `<section class="preview-summary${compact ? ' preview-summary--compact' : ''}" data-reveal>
    <h3>${heading}</h3>
    <p>서비스를 만드는 경험에서 한 걸음 더 나아가, 데이터의 흐름과 운영 과정까지 고민한 흔적이 보여요.</p>
    ${compact ? '' : '<p>API 설계와 오류 처리 경험은 분명한 강점입니다. 성능을 개선한 이유와 검증 과정을 보태면, 문제를 해결하는 방식이 더 선명해집니다.</p>'}
  </section>`;
}

function pyramid() {
  return `<figure class="preview-pyramid" data-reveal>
    <div class="preview-figure-heading"><h3>네 방향으로 읽는 가능성</h3><span>형태 시연</span></div>
    <div class="preview-pyramid-host" data-pyramid-host aria-label="네 평가축 피라미드 디자인 미리보기"></div>
    <figcaption>도형은 디자인 확인용 예시이며 실제 평가 결과가 아닙니다.</figcaption>
  </figure>`;
}

function axisItems(items = axes) {
  return items
    .map(
      ([name, finding, description]) => `<div class="preview-axis">
    <h4>${name}</h4><strong>${finding}</strong><p>${description}</p>
  </div>`,
    )
    .join('');
}

function evaluation(className = '') {
  return `<section class="preview-evaluation ${className}" data-reveal aria-label="네 가지 평가 관점">
    ${axisItems()}
  </section>`;
}

function strengths() {
  return `<section class="preview-strengths" data-reveal>
    <h3>잘 드러난 강점</h3>
    <ul><li><strong>기능을 넘어 흐름을 설계해요.</strong><p>회원 인증부터 주문 처리까지, 서비스의 연결을 설명했습니다.</p></li>
    <li><strong>협업의 맥락을 담았어요.</strong><p>API 명세와 코드 리뷰를 통해 팀과 합의한 과정을 적었습니다.</p></li></ul>
  </section>`;
}

function evidence() {
  return `<section class="preview-evidence" data-reveal>
    <div class="preview-section-heading"><h3>이력서에서 찾은 연결</h3><span>가상 이력서 발췌</span></div>
    <div class="preview-evidence-row"><div><h4>API 설계와 구현</h4><span>직무 경험</span></div><blockquote>“Spring 기반 주문 API를 설계하고, 공통 예외 처리와 API 명세를 정리했습니다.”<cite>프로젝트 · 작은 상점</cite></blockquote></div>
    <div class="preview-evidence-row"><div><h4>데이터 접근 개선</h4><span>문제 해결</span></div><blockquote>“조회 흐름을 추적해 중복 쿼리를 찾고, 인덱스 적용 전후의 실행 계획을 비교했습니다.”<cite>프로젝트 · 작은 상점</cite></blockquote></div>
  </section>`;
}

function nextStep() {
  return `<section class="preview-next" data-reveal>
    <h3>다음 문장에 담아 보세요.</h3>
    <p>어떤 상황에서 문제가 생겼나요? 해결 방법을 선택한 이유와 결과를 확인한 과정을 함께 적어 보세요.</p>
    <div class="preview-writing-example"><span>작성 방향 예시</span><p>문제를 발견한 계기 → 선택한 해결 방법 → 검증한 결과</p></div>
  </section>`;
}

const compositions = {
  focus: () =>
    `${identity()}<div class="preview-focus-lead"><div>${summary()}${strengths()}</div>${pyramid()}</div>${evaluation('preview-axis-strip')}${evidence()}${nextStep()}`,
  editorial: () =>
    `<div class="preview-editorial"><div class="preview-editorial-body">${identity('경험을 읽고,\n다음을 그립니다.')}${summary()}${evidence()}${nextStep()}</div><aside class="preview-editorial-margin" aria-label="시각 요약과 평가 관점">${pyramid()}${evaluation('preview-axis-vertical')}${strengths()}</aside></div>`,
  compass: () =>
    `${identity('가능성의 방향을\n함께 살펴보세요.')}<div class="preview-compass"><section class="preview-compass-axes" aria-label="이력서와 직무" data-reveal>${axisItems(axes.slice(0, 2))}</section>${pyramid()}<section class="preview-compass-axes" aria-label="지원 자격과 실무" data-reveal>${axisItems(axes.slice(2))}</section></div><div class="preview-two-column">${summary({ compact: true })}${strengths()}</div>${evidence()}${nextStep()}`,
  stacked: () =>
    `<div class="preview-document-opening"><div>${identity('김하늘님의\n모의지원 보고서')}${summary({ compact: true })}</div>${pyramid()}</div>${evaluation('preview-axis-table')}${strengths()}${evidence()}${nextStep()}`,
  briefing: () =>
    `<div class="preview-briefing"><aside class="preview-briefing-rail" aria-label="지원자 및 평가 관점">${identity('김하늘')}<p class="preview-rail-note">경험에서 발견한 가능성을<br>네 가지 관점으로 정리했어요.</p>${evaluation('preview-axis-vertical')}</aside><div class="preview-briefing-main"><header class="preview-briefing-title" data-reveal><h2>모의지원 보고서</h2><p>지금의 강점과 다음 준비를 한눈에.</p></header><div class="preview-briefing-overview">${summary({ compact: true })}${pyramid()}</div>${strengths()}${evidence()}${nextStep()}</div></div>`,
  studio: () =>
    `<div class="preview-studio-opening">${pyramid()}<div>${identity('다음 기회로\n이어지는 경험.')}${summary({ compact: true })}<p class="preview-studio-note" data-reveal>김하늘님의 가상 이력서를 바탕으로<br>연결된 경험과 보완할 표현을 정리했습니다.</p></div></div>${evaluation('preview-axis-strip')}<div class="preview-studio-bottom">${strengths()}${nextStep()}</div>${evidence()}`,
};

export function renderPreview({ layout = 'focus' } = {}) {
  const selected = Object.hasOwn(compositions, layout) ? layout : 'focus';
  return `<div class="preview-site preview-site--${selected}">
    <div class="preview-site-nav">
      <span class="preview-brand"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12c4-7 14-7 18 0-4 7-14 7-18 0Z"/><circle cx="12" cy="12" r="3"/></svg>CareerLens<span class="preview-brand-dot" aria-hidden="true"></span></span>
      <div class="preview-nav-labels" aria-label="사이트 메뉴 디자인 예시"><span>소개</span><span>이력서</span><span>희망 직무</span><span>채용공고</span><span class="is-current">모의 지원</span></div>
      <span class="preview-member">김하늘</span>
    </div>
    <div class="preview-workflow" aria-label="지원 진행 단계 디자인 예시"><span>이력서</span><i aria-hidden="true"></i><span>희망 직무</span><i aria-hidden="true"></i><span>채용 공고</span><i aria-hidden="true"></i><strong>모의지원</strong></div>
    <div class="preview-page">
      <article class="preview-report" data-report-frame tabindex="0" aria-label="디자인 비교용 가상 모의지원 보고서, 내부 스크롤 가능">
        <div class="preview-report-content">${compositions[selected]()}
          <footer class="preview-report-footer"><span>CareerLens</span><span>디자인 비교용 가상 보고서</span></footer>
        </div>
      </article>
    </div>
  </div>`;
}
