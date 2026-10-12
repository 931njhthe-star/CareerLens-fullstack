import { escapeHtml as e } from '../../shared/components/ui.js';

export function reportGuidance(report) {
  const references = report.reference_guidance || [];
  const coaching = report.ai_coaching;
  if (!report.agent && !references.length && !coaching) return '';
  return `<section class="report-section" id="guidance"><h2>경험을 더 선명하게 쓰는 보완 안내</h2><p class="section-intro">${
    coaching
      ? '입력 내용과 참고 자료를 바탕으로 AI가 제안한 표현입니다. 사실과 맞는지 확인한 뒤 활용하세요.'
      : '이력서의 경험과 근거를 살펴보고, 보완 안내는 프로젝트의 참고 자료에서 찾아 제공합니다.'
  }</p>${
    report.agent?.fallback_used
      ? '<p class="notice info">일부 보완 안내를 생성하지 못해 기본 분석 결과를 표시합니다.</p>'
      : ''
  }${
    coaching
      ? `<div class="coaching-panel"><span class="badge neutral">AI 보완 제안</span><p>${e(coaching.summary)}</p><ul>${(
          coaching.recommendations || []
        )
          .map(
            (item) =>
              `<li><p>${e(item.text)}</p>${
                item.evidence_quote
                  ? `<blockquote>${e(item.evidence_quote)}</blockquote><span class="source-label">입력 내용의 근거 · 사실 확인 후 활용하세요.</span>`
                  : ''
              }</li>`,
          )
          .join('')}</ul></div>`
      : ''
  }${
    references.length
      ? `<div class="reference-guidance"><h3>함께 확인할 참고 자료</h3><p class="small-note">프로젝트의 작성·검증 안내 자료입니다. 채용기업의 공식 평가 기준이나 실제 채용 결과가 아닙니다.</p>${references
          .map(
            (item) =>
              `<article><h4>${e(item.title)}</h4><p>${e(item.text)}</p><span class="source-label">출처 · ${e(item.source)}</span></article>`,
          )
          .join('')}</div>`
      : ''
  }</section>`;
}
