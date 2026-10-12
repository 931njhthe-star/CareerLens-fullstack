import { escapeHtml as e, icon } from '../../shared/components/ui.js';
import { renderMarkdown } from '../../shared/components/markdown.js';
import { reportGuidance } from './guidance.js';
import { pyramidAxes, pyramidPreview } from './status-radar-data.js';
import { DEMO_SCORE_NOTICE } from './demo-score-data.js';
import { opportunityPath } from '../job-postings/opportunity-state.js';

const STATUS_LABEL = {
  confirmed: '근거 확인',
  partial: '추가 확인',
  missing: '근거 부족',
};

function weightLabel(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${Number((value * 100).toFixed(1))}%`
    : '미정';
}

function evaluationMarkup(report) {
  const axes = pyramidAxes(report);
  return `<div class="evaluation-grid" data-four-axis-evaluation>
    ${axes
      .map(
        (
          axis,
          index,
        ) => `<section class="evaluation-axis" aria-labelledby="evaluation-${e(axis.id)}">
      <div class="evaluation-axis__heading">
        <h3 id="evaluation-${e(axis.id)}"><span>${index + 1}</span>${e(axis.label)}</h3>
      </div>
      <ol class="evaluation-criteria">
        ${axis.subcriteria
          .map(
            (criterion) => `<li class="evaluation-criterion">
          <div class="evaluation-criterion__heading"><h4>${e(criterion.label)}</h4><span class="evaluation-criterion__weight">예정 비중 ${e(weightLabel(criterion.weight))}</span></div>
        </li>`,
          )
          .join('')}
      </ol>
    </section>`,
      )
      .join('')}
  </div>`;
}

function evaluationMethodology() {
  return `<p>예정 평가 방식은 각 축에 속한 세부 항목 3개의 가중 기하평균입니다.</p>
    <p class="evaluation-formula">축 점수 = 100 × ∏ (세부 점수 ÷ 100)<sup>적용 비중</sup></p>
    <p>현재 표시된 네 점수는 화면과 움직임을 확인하기 위해 무작위로 만든 시연 값입니다. 위 공식이나 본인의 이력서 내용으로 계산하지 않았으며 실제 역량 평가가 아닙니다.</p>`;
}

function evidenceMarkup(matches) {
  return matches
    .map(
      (match) => `
        <div class="evidence-row">
          <div>
            <span
              class="badge ${Object.hasOwn(STATUS_LABEL, match.status) ? match.status : 'partial'}">
              ${STATUS_LABEL[match.status] || '추가 확인'}
            </span>
            <h3>${e(match.requirement)}</h3>
          </div>
          <div>
            ${
              match.evidence_items?.length
                ? match.evidence_items
                    .map(
                      (item) => `
                      <div class="evidence-excerpt">
                        <blockquote>${e(item.excerpt)}</blockquote>
                        <span class="source-label">출처 · ${e(item.source_label)}</span>
                      </div>
                    `,
                    )
                    .join('')
                : '<p class="missing-copy">현재 입력 내용에서 연결되는 근거를 찾지 못했습니다.</p>'
            }
          </div>
        </div>
      `,
    )
    .join('');
}

function statusRadarPanel(report) {
  const preview = pyramidPreview(report);
  return `
    <figure
      class="report-status-panel"
      aria-labelledby="status-radar-title">
      <div class="report-eye-heading">
        <h3 id="status-radar-title">4개 평가축 시연</h3>
        <span class="matching-threshold">각 꼭짓점 100점</span>
      </div>
      <div
        class="status-radar-host"
        data-status-radar>
        <p
          class="matching-eye-loading"
          role="status">
          평가 요소를 입체적으로 그리는 중…
        </p>
      </div>
      <figcaption>
        <span class="pyramid-legend">
          <span><i class="pyramid-key pyramid-key--current"></i>기본 도형</span>
          ${preview ? '<span><i class="pyramid-key pyramid-key--projected"></i>변화 예시</span>' : ''}
        </span>
        <strong class="evaluation-demo-notice">${DEMO_SCORE_NOTICE}</strong>
        <span>본인의 이력서나 실제 역량을 평가한 점수가 아닙니다.</span>
        ${
          preview
            ? `
          <div class="pyramid-preview-actions">
            <button class="pyramid-preview-button" type="button" data-preview-improvement aria-pressed="false">
              점수 변화 시연 보기
            </button>
            <a class="pyramid-assumptions-link" href="#/result" data-section="priorities">점수 변화 시연 안내</a>
          </div>
        `
            : ''
        }
      </figcaption>
    </figure>
  `;
}

function improvementPreviewMarkup(report) {
  const preview = pyramidPreview(report);
  if (!preview) return '';
  return `
    <div class="improvement-preview" data-improvement-note>
      <div class="improvement-preview__heading">
        <h3>점수 변화 시연</h3>
        <p>파란 도형이 하늘색 변화 예시로 부드럽게 바뀌는 모습을 확인하세요.</p>
      </div>
      <p>${e(preview.notice)}</p>
      <div class="improvement-preview__actions">
        <button class="button secondary compact" type="button" data-preview-improvement aria-pressed="false">
          점수 변화 시연 보기
        </button>
        <button class="text-button" type="button" data-section="report-graphics">피라미드로 이동</button>
      </div>
    </div>
  `;
}

export function analysisReport(draft) {
  const report = draft.report;
  if (report.source === 'backend') {
    const hasMarkdown = typeof report.backend_report_text === 'string' && report.backend_report_text.trim();
    const partial = report.status === 'partial';
    return `
      <div class="result-toolbar">
        <div>
          <span class="completion">${icon('check', 17)} ${partial ? '에이전트 평가 부분 완료' : '에이전트 평가 완료'}</span>
          <span class="result-date">${e(draft.created_at || '')}${draft.created_at ? ' KST' : ''}</span>
        </div>
        <div>
          ${draft.selected_posting_id ? `<a class="button secondary compact" href="#/${e(opportunityPath(draft.career_target || { role_id: 'custom', label: draft.role }))}">다른 공고 선택</a>` : ''}
        </div>
      </div>
      <article class="backend-final-report resume-score-card" tabindex="0" aria-label="에이전트 최종 보고서">
        <header class="backend-final-report__header">
          <p class="eyebrow">CareerLens · 실제 백엔드 에이전트 보고서</p>
          <h1>${e(draft.role || '채용공고 평가')}</h1>
          <p>${e(draft.company || '')} · 저장된 이력서와 백엔드 등록 공고 기준</p>
        </header>
        ${partial ? '<p class="backend-final-report__notice" role="status">일부 평가가 보류 또는 부분 완료되었습니다. 점수와 판정 상태는 아래 백엔드 최종 보고서의 내용을 따릅니다.</p>' : ''}
        <section class="backend-final-report__content markdown-content" aria-label="에이전트 최종 보고서">
          ${
            hasMarkdown
              ? renderMarkdown(report.backend_report_text)
              : '<p class="backend-final-report__notice" role="alert">백엔드 최종 보고서 본문을 불러오지 못했습니다. 이전 평가 결과일 수 있으니 평가를 다시 실행해 주세요.</p>'
          }
        </section>
      </article>`;
  }
  const desiredRole = draft.analysis_mode === 'desired_role';
  const contextLabel = desiredRole ? '희망 직무' : draft.company;
  const matches = report.matches || [];
  const scoreComponents = Object.values(report.score_components || {});
  const sections = [
    ['overview', '핵심 요약'],
    ['readiness', '예정 평가 항목'],
    ['evidence', desiredRole ? '직무별 근거' : '공고별 근거'],
    ['priorities', '우선 보완 사항'],
    ['interview', '예상 면접 질문'],
  ];

  return `
    <div class="result-toolbar">
      <div>
        <span class="completion">${icon('check', 17)} 분석 완료</span>
        <span class="result-date">
          ${e(draft.created_at || '')}${draft.created_at ? ' KST' : ''}
        </span>
      </div>
      <div>
        ${draft.selected_posting_id ? `<a class="button secondary compact" href="#/${e(opportunityPath(draft.career_target || { role_id: 'custom', label: draft.role }))}">다른 공고로 모의지원</a>` : ''}
        <button
          type="button"
          class="button secondary compact"
          data-section="report-graphics">
          그래픽 보기
        </button>
      </div>
    </div>
    <div class="result-layout result-layout--studio">
      <nav class="report-section-nav" aria-label="보고서 목차">
        ${sections
          .map(
            ([id, label]) => `
              <a
                href="#/result"
                data-section="${id}">
                ${label}
              </a>
            `,
          )
          .join('')}
        <div class="report-section-nav__context">
          <a href="#/desired-role">희망 직무 수정</a>
        </div>
      </nav>
      <article
        data-resume-score-card="true"
        data-report-frame
        class="resume-score-card"
        tabindex="0"
        aria-label="모의지원 분석 결과">
        ${
          report.demo
            ? '<p class="notice info" role="note">시연용 mock 결과입니다. 실제 백엔드 분석이나 평가 점수가 아닙니다.</p>'
            : report.source === 'backend'
              ? `<section class="report-section backend-score-summary" aria-label="백엔드 실제 평가 점수"><h2>백엔드 평가 결과</h2><p class="section-intro">아래 점수는 연결된 백엔드가 저장된 이력서와 채용공고를 평가한 결과입니다. 별도의 4축 그래픽은 화면 시연용이며 실제 점수가 아닙니다.</p><dl class="backend-score-grid">${scoreComponents
                  .map(
                    (item) => `<div><dt>${e(item.label)}</dt><dd>${item.score === null ? '보류' : `${e(Number(item.score).toFixed(1))}점`}</dd></div>`,
                  )
                  .join('')}</dl>${report.backend_report_text ? `<details class="backend-report-text"><summary>백엔드 보고서 원문</summary><pre>${e(report.backend_report_text)}</pre></details>` : ''}</section>`
              : ''
        }
        <header
          class="report-hero report-hero-with-radar report-studio-opening"
          id="overview">
          <div
            class="report-visual-region"
            id="report-graphics"
            data-report-reveal="graphic"
            role="region"
            aria-label="항목별 평가 그래픽">
            <div class="report-visual-pair report-visual-single">${statusRadarPanel(report)}</div>
          </div>
          <div class="report-hero-copy" data-report-reveal="heading">
            <div class="report-position">
              <span class="company-initial large">
                ${desiredRole ? icon('briefcase', 32) : e(draft.company?.slice(0, 1))}
              </span>
              <div>
                <p>${e(contextLabel)}</p>
                <h1>${e(draft.role)}</h1>
              </div>
            </div>
            <h2 class="report-studio-title">다음 기회로<br>이어지는 경험.</h2>
            <h3>핵심 요약</h3>
            <p class="report-summary">${e(report.summary)}</p>
            <p class="report-studio-caption">선택한 ${desiredRole ? '희망 직무' : '공고'}를 기준으로 연결된 경험과 보완할 근거를 정리했습니다.</p>
          </div>
        </header>
        <div class="report-body">
          <section
            class="report-section readiness-section"
            data-report-reveal="details"
            id="readiness">
            <h2>예정 평가 항목</h2>
            <p class="section-intro">각 축의 세부 항목과 예정 비중입니다. 현재 시연 점수는 이 비중으로 계산한 값이 아닙니다.</p>
            ${evaluationMarkup(report)}
          </section>
          <section
            class="report-section"
            data-report-reveal="details"
            id="evidence">
            <div class="section-heading">
              <h2>
                ${desiredRole ? '희망 직무에 활용할 수 있는 근거' : '공고 요건과 연결되는 근거'}
              </h2>
              <span class="badge neutral">${matches.length}개 항목</span>
            </div>
            <p class="section-intro">
              표현이 같아도 경험이 충분하다는 뜻은 아닙니다. 인용된 내용을 직접 확인하세요.
            </p>
            <div class="evidence-list">${evidenceMarkup(matches)}</div>
          </section>
          <section class="report-section" data-report-reveal="details">
            <div class="findings-grid">
              <div>
                <h2>잘 드러난 강점</h2>
                <ul class="findings strengths">
                  ${(report.strengths || [])
                    .map(
                      (item) => `
                        <li>
                          ${icon('check', 17)}
                          <span>${e(item)}</span>
                        </li>
                      `,
                    )
                    .join('')}
                </ul>
              </div>
              <div>
                <h2>더 필요한 근거</h2>
                <ul class="findings gaps">
                  ${(report.gaps || [])
                    .map(
                      (item) => `
                        <li>
                          <span class="gap-dot"></span>
                          <span>${e(item)}</span>
                        </li>
                      `,
                    )
                    .join('')}
                </ul>
              </div>
            </div>
          </section>
          <section
            class="report-section"
            data-report-reveal="details"
            id="priorities">
            <h2>지원 전, 이것부터 보완하세요.</h2>
            ${improvementPreviewMarkup(report)}
            <div class="priority-list">
              ${(report.priorities || [])
                .map(
                  (priority, index) => `
                    <div class="priority">
                      <span>${index + 1}</span>
                      <div>
                        <h3>${e(priority.title)}</h3>
                        <p>${e(priority.detail)}</p>
                      </div>
                    </div>
                  `,
                )
                .join('')}
            </div>
          </section>
          <section
            class="report-section"
            data-report-reveal="details"
            id="interview">
            <h2>다음 대화에서 나올 수 있는 질문</h2>
            <ol class="interview-list">
              ${(report.questions || [])
                .map(
                  (question) => `
                    <li>${e(question)}</li>
                  `,
                )
                .join('')}
            </ol>
          </section>
          ${reportGuidance(report)}
          <details class="methodology">
            <summary>예정 평가 방식과 시연 점수 안내</summary>
            ${evaluationMethodology()}
          </details>
        </div>
      </article>
    </div>
  `;
}
