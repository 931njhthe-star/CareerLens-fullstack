export const analysisStyles = `
  .cl-analysis-eye {
    --eye-gold: var(--eye-highlight, #e8ca89);
    --eye-ink: var(--eye-background, #080908);
    color: var(--eye-text, #f0eee3);
    background: var(--eye-ink);
    font-family: inherit;
    overflow: hidden;
    container-type: inline-size;
  }
  .cl-analysis-eye[data-surface="overlay"] {
    background: transparent;
    overflow: visible;
  }
  .cl-analysis-eye[data-surface="overlay"] .cl-analysis-eye__summary {
    border-top: 0;
    justify-content: center;
    color: var(--eye-text, #ecefe4);
  }
  .cl-analysis-eye[data-surface="overlay"] .cl-analysis-eye__panel {
    background: var(--eye-panel, #0b0e0be8);
  }
  .cl-analysis-eye *, .cl-analysis-eye *::before, .cl-analysis-eye *::after {
    box-sizing: border-box;
  }
  .cl-analysis-eye ::selection {
    background: var(--eye-highlight, #b59858);
    color: var(--eye-background, #080908);
  }
  .cl-analysis-eye__scene {
    position: relative;
    height: clamp(400px, 42vw, 510px);
    isolation: isolate;
  }
  .cl-analysis-eye__visual {
    position: absolute;
    inset: 0;
  }
  .cl-analysis-eye__canvas, .cl-analysis-eye__fallback {
    display: block;
    width: 100%;
    height: 100%;
  }
  .cl-analysis-eye__entrance {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .cl-analysis-eye__leaders {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .cl-analysis-eye__leader-track {
    fill: none;
    stroke: var(--eye-outline, #af9967);
    stroke-opacity: .72;
    stroke-width: .75;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    vector-effect: non-scaling-stroke;
  }
  .cl-analysis-eye__anchor {
    fill: var(--eye-highlight, #ead6a1);
  }
  .cl-analysis-eye__panels {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .cl-analysis-eye__panel {
    position: absolute;
    width: clamp(180px, 21%, 228px);
    min-height: 110px;
    padding: 16px 17px 14px;
    border: 1px solid var(--eye-panel-border, #b9a27152);
    border-radius: 8px;
    background: var(--eye-panel, #0d100df0);
    opacity: 0;
    transform-origin: center;
    will-change: opacity, transform, filter;
  }
  .cl-analysis-eye__panel[data-corner="top-left"] {
    left: 2.5%;
    top: 8%;
  }
  .cl-analysis-eye__panel[data-corner="bottom-left"] {
    left: 4.5%;
    bottom: 8%;
  }
  .cl-analysis-eye__panel[data-corner="top-right"] {
    right: 3.5%;
    top: 8%;
  }
  .cl-analysis-eye__panel[data-corner="bottom-right"] {
    right: 2.5%;
    bottom: 8%;
  }
  .cl-analysis-eye__panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .cl-analysis-eye[data-purpose="report"] .cl-analysis-eye__panel-header {
    display: block;
    margin-bottom: 7px;
  }
  .cl-analysis-eye[data-purpose="report"] .cl-analysis-eye__label {
    font-size: 14px;
    line-height: 1.5;
  }
  .cl-analysis-eye[data-purpose="report"] .cl-analysis-eye__state {
    display: block;
    margin-top: 3px;
  }
  .cl-analysis-eye__label {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.5;
    word-break: keep-all;
    overflow-wrap: break-word;
  }
  .cl-analysis-eye__state {
    flex-shrink: 0;
    color: var(--eye-highlight, #e1c795);
    font-size: 11px;
    line-height: 1.5;
  }
  .cl-analysis-eye__detail {
    min-height: 3em;
    margin: 0;
    color: var(--eye-text, #d2d3c4);
    font-size: 12px;
    line-height: 1.7;
    word-break: keep-all;
    overflow-wrap: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .cl-analysis-eye__measure {
    height: 1px;
    margin-top: 12px;
    background: var(--eye-divider, #393c30);
    overflow: hidden;
  }
  .cl-analysis-eye__measure-fill {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--eye-gold);
    transform-origin: left;
  }
  .cl-analysis-eye__summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin: 0;
    padding: 18px 28px 20px;
    border-top: 1px solid var(--eye-divider, #292d24);
    font-size: 13px;
    line-height: 1.5;
    color: var(--eye-text, #d3d7c8);
  }
  .cl-analysis-eye__summary strong {
    min-width: 4ch;
    color: var(--eye-gold);
    font-weight: 500;
    font-size: 15px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .cl-analysis-eye__note {
    margin: -8px 20px 0;
    padding-bottom: 14px;
    color: var(--eye-text, #c2c9b8);
    font-size: 11px;
    line-height: 1.6;
    text-align: center;
    word-break: keep-all;
    overflow-wrap: anywhere;
  }
  .cl-analysis-eye__sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  @container (min-width: 700px) and (max-width: 900px) {
    .cl-analysis-eye__panel {
      width: 174px;
      padding: 12px;
    }
    .cl-analysis-eye__panel-header {
      display: block;
      margin-bottom: 5px;
    }
    .cl-analysis-eye__state {
      display: none;
    }
    .cl-analysis-eye__scene {
      height: 440px;
    }
  }
  @container (max-width: 699px) {
    .cl-analysis-eye__scene {
      height: 380px;
    }
    .cl-analysis-eye__visual {
      bottom: 120px;
    }
    .cl-analysis-eye__panels {
      inset: 255px 0 0;
    }
    .cl-analysis-eye__panel, .cl-analysis-eye__panel:nth-child(n) {
      top: 0;
      bottom: auto;
      width: min(250px, calc(100% - 40px));
      min-height: 102px;
      padding: 12px 14px;
    }
    .cl-analysis-eye__panel[data-corner="top-left"] {
      left: 20px;
      right: auto;
    }
    .cl-analysis-eye__panel[data-corner="bottom-left"] {
      left: auto;
      right: 20px;
    }
    .cl-analysis-eye__panel:nth-child(2) {
      display: none;
    }
    .cl-analysis-eye[data-purpose="report"] .cl-analysis-eye__scene {
      height: 410px;
    }
    .cl-analysis-eye[data-purpose="report"] .cl-analysis-eye__visual {
      bottom: 160px;
    }
    .cl-analysis-eye[data-purpose="report"] .cl-analysis-eye__panels {
      inset: 262px 0 0;
    }
    .cl-analysis-eye[data-purpose="report"] .cl-analysis-eye__panel {
      width: calc((100% - 36px) / 2);
      min-height: 123px;
      padding: 10px 11px;
    }
    .cl-analysis-eye[data-purpose="report"] .cl-analysis-eye__panel:nth-child(1) {
      left: 12px;
      right: auto;
    }
    .cl-analysis-eye[data-purpose="report"] .cl-analysis-eye__panel:nth-child(2) {
      display: block;
      left: auto;
      right: 12px;
    }
    .cl-analysis-eye[data-purpose="report"] .cl-analysis-eye__panel[hidden] {
      display: none;
    }
    .cl-analysis-eye[data-purpose="report"] .cl-analysis-eye__detail {
      line-height: 1.5;
      -webkit-line-clamp: 2;
    }
    .cl-analysis-eye__label {
      font-size: 14px;
    }
    .cl-analysis-eye__detail {
      min-height: 0;
      -webkit-line-clamp: 2;
    }
    .cl-analysis-eye__summary {
      padding: 15px 20px;
      gap: 12px;
      font-size: 12px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cl-analysis-eye__panel {
      will-change: auto;
    }
  }
`;
