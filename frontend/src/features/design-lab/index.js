import { groups, defaults, selectionFromSearch } from './presets.js';
import { renderPreview } from './preview.js';
import { playReportTransition } from './transition.js';
import { mountAnalysisEye, ScorePyramidRenderer } from '../analysis/matching-eye.js';
import { waitForPresentationDelay } from '../analysis/preparation-transition.js';

const app = document.getElementById('design-lab');
const state = selectionFromSearch(location.search);
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const categoryNames = {
  theme: '전체 색감',
  layout: '페이지 배치',
  eye: '눈 모션',
  pyramid: '유리 피라미드',
  effect: '전환 · 테두리 빛',
};
let category = 'theme';
let run;
let eye;
let disposePyramid;
let showProjected = false;
const selected = (key) => groups[key].find((item) => item.id === state[key]);

app.innerHTML = `
  <header class="lab-header">
    <a class="lab-brand" href="/">Career<span>Lens</span></a>
    <span class="lab-header-label">디자인 비교실</span>
    <a class="lab-app-link" href="/" target="_blank" rel="noopener">기존 프로그램 열기 ↗</a>
  </header>
  <main class="lab-main">
    <div class="lab-intro">
      <div><h1>분석의 끝을, 새로운 장면으로.</h1><p>흰색과 파랑. 눈에서 빛으로, 빛에서 보고서로 이어지는 시안을 골라보세요.</p></div>
      <p class="lab-demo-note">가상 데이터로 보는 디자인 시안<br>선택 내용은 본 프로그램에 적용되지 않습니다.</p>
    </div>
    <div class="lab-workbench">
      <aside class="lab-inspector" aria-label="시안 선택">
        <div class="lab-categories" role="tablist" aria-label="비교 항목">
          ${Object.entries(groups)
            .map(
              ([key, values]) =>
                `<button role="tab" id="tab-${key}" aria-controls="lab-options" aria-selected="${key === category}" tabindex="${key === category ? '0' : '-1'}" data-category="${key}">${categoryNames[key]} <span>${values.length}</span></button>`,
            )
            .join('')}
        </div>
        <section id="lab-options" role="tabpanel" aria-labelledby="tab-theme"></section>
        <div class="lab-combination"><h2>현재 조합</h2><dl id="combination-list"></dl><button type="button" class="lab-text-button" id="copy-combination">조합 링크 복사</button><p class="lab-small" id="copy-feedback" role="status"></p></div>
        <button type="button" class="lab-reset" id="reset-presets">처음 조합으로</button>
      </aside>
      <section id="preview" class="lab-preview" aria-label="움직이는 디자인 미리보기" tabindex="-1">
        <div class="lab-toolbar">
          <div><strong id="preview-title"></strong><span id="preview-subtitle"></span></div>
          <div class="lab-play-controls">
            <button type="button" id="play-full" class="lab-primary">전체 흐름 재생 <span aria-hidden="true">▶</span></button>
            <button type="button" id="play-transition">전환만 재생</button>
            <button type="button" id="show-report">보고서 보기</button>
          </div>
        </div>
        <div class="lab-status-line"><p id="play-status" role="status">색감과 배치를 골라보세요.</p><span>전체 흐름 · 분석 시연 최소 4초</span></div>
        <div class="lab-stage" data-phase="report" data-layout="focus">
          <div data-preview-content></div>
          <div class="lab-eye-overlay" hidden aria-label="눈 모션 시안">
            <div class="lab-eye-copy"><h2>경험을 하나의 보고서로.</h2><p>이력서와 채용공고를 살펴보는 모션 시안입니다.</p></div>
            <div class="lab-eye-host"></div>
          </div>
        </div>
        <div class="lab-under-preview">
          <button type="button" id="morph-pyramid" aria-pressed="false">피라미드 변화 시연</button>
          <span>마우스 이동 · 시점 조절 / 휠 · 확대·축소</span>
          <p>가상 이력서와 공고 · 실제 분석·예측 결과가 아닙니다.</p>
        </div>
      </section>
    </div>
    <footer class="lab-footer">색감 6안 · 배치 6안 · 눈 5안 · 피라미드 5안 · 전환과 테두리 빛 5안. 마음에 드는 조합의 이름이나 링크를 알려주세요.</footer>
  </main>`;

const stage = app.querySelector('.lab-stage');
const previewContent = app.querySelector('[data-preview-content]');
const overlay = app.querySelector('.lab-eye-overlay');
const eyeHost = app.querySelector('.lab-eye-host');
const status = app.querySelector('#play-status');

function miniLayout(id) {
  const blocks = {
    focus: [
      [6, 6, 34, 32],
      [44, 6, 26, 32],
      [6, 42, 64, 12],
    ],
    editorial: [
      [10, 6, 56, 12],
      [10, 22, 34, 32],
      [48, 22, 18, 20],
    ],
    compass: [
      [6, 6, 14, 48],
      [24, 6, 46, 16],
      [24, 26, 26, 28],
      [54, 26, 16, 28],
    ],
    stacked: [
      [6, 6, 64, 12],
      [6, 22, 64, 14],
      [6, 40, 64, 14],
    ],
    briefing: [
      [6, 6, 64, 10],
      [6, 20, 19, 34],
      [29, 20, 19, 34],
      [52, 20, 18, 34],
    ],
    studio: [
      [6, 6, 64, 8],
      [20, 18, 36, 24],
      [6, 46, 30, 8],
      [40, 46, 30, 8],
    ],
  };
  return `<svg viewBox="0 0 76 60" aria-hidden="true">${blocks[id].map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>`).join('')}</svg>`;
}

function optionArt(item) {
  if (category === 'layout') return `<span class="lab-layout-art">${miniLayout(item.id)}</span>`;
  const colors =
    category === 'theme'
      ? [item.colors[1], item.colors[5], item.colors[7]]
      : category === 'eye'
        ? [item.background, item.fiber, item.highlight]
        : category === 'pyramid'
          ? [item.background, item.base, item.projected]
          : [item.primary, item.secondary, item.glow];
  return `<span class="lab-swatch" aria-hidden="true">${colors.map((color) => `<i style="background:${color}"></i>`).join('')}</span>`;
}

function renderOptions() {
  const panel = app.querySelector('#lab-options');
  panel.setAttribute('aria-labelledby', `tab-${category}`);
  panel.innerHTML = `<h2>${categoryNames[category]} <span>${groups[category].length}가지</span></h2><p class="lab-option-hint">${category === 'theme' ? '전체 색감을 고르면 어울리는 눈·피라미드·빛도 함께 바뀝니다.' : category === 'eye' ? '고르면 선택한 색으로 눈 모션이 재생됩니다.' : category === 'effect' ? '입자·곡선·보고서 테두리 빛을 함께 비교하세요.' : '선택한 항목만 바꾸어 현재 조합과 비교하세요.'}</p><div class="lab-option-grid">${groups[category].map((item, index) => `<button type="button" class="lab-option" data-option="${item.id}" aria-pressed="${state[category] === item.id}">${optionArt(item)}<span class="lab-option-name">${index + 1}. ${item.name}</span><span class="lab-option-note">${item.note}</span></button>`).join('')}</div>`;
  panel
    .querySelectorAll('[data-option]')
    .forEach((button) =>
      button.addEventListener('click', () => choose(category, button.dataset.option)),
    );
}

function writeSelection() {
  const params = new URLSearchParams(state);
  history.replaceState({}, '', `${location.pathname}?${params}`);
  app.querySelector('#combination-list').innerHTML = Object.keys(groups)
    .map((key) => `<div><dt>${categoryNames[key]}</dt><dd>${selected(key).name}</dd></div>`)
    .join('');
  app.querySelector('#preview-title').textContent =
    `${selected('theme').name} · ${selected('layout').name}`;
  app.querySelector('#preview-subtitle').textContent = selected('layout').note;
}

function setColors() {
  const keys = ['bg', 'surface', 'tint', 'ink', 'muted', 'primary', 'line', 'accent'];
  selected('theme').colors.forEach((color, index) =>
    stage.style.setProperty(`--site-${keys[index]}`, color),
  );
  for (const key of ['primary', 'secondary', 'glow'])
    stage.style.setProperty(`--effect-${key}`, selected('effect')[key]);
  overlay.style.background = selected('eye').background;
  overlay.style.color = selected('eye').text;
}

function stopPlayback() {
  run?.abort();
  run = null;
  eye?.dispose();
  eye = null;
  overlay.hidden = true;
  overlay.classList.remove('is-releasing');
  previewContent.inert = false;
  previewContent.removeAttribute('aria-hidden');
  stage.dataset.phase = 'report';
}

function showReport() {
  stopPlayback();
  status.textContent = '보고서 시안 · 숫자 비교 없이 형태와 색상으로 확인하세요.';
}

function renderReport() {
  stopPlayback();
  disposePyramid?.();
  setColors();
  stage.dataset.layout = state.layout;
  previewContent.innerHTML = renderPreview({ layout: state.layout });
  previewContent
    .querySelectorAll('[data-reveal]')
    .forEach((element, index) => element.style.setProperty('--reveal-index', index));
  showProjected = false;
  app.querySelector('#morph-pyramid').textContent = '피라미드 변화 시연';
  app.querySelector('#morph-pyramid').setAttribute('aria-pressed', 'false');
  disposePyramid = mountPyramid(
    previewContent.querySelector('[data-pyramid-host]'),
    selected('pyramid'),
  );
  writeSelection();
}

function choose(key, id) {
  state[key] = id;
  if (key === 'theme') {
    const theme = selected('theme');
    Object.assign(state, { eye: theme.eye, pyramid: theme.pyramid, effect: theme.effect });
  }
  renderReport();
  renderOptions();
  if (key === 'eye') play('eye');
  else if (key === 'effect') play('transition');
  else showReport();
}

function snapshot(complete = false, step = 0) {
  return {
    complete,
    stages: ['resume', 'role', 'report'].map((id, index) => ({
      id,
      label: ['이력서 확인', '공고 기준 분석', '보고서 구성'][index],
      status: complete || index < step ? 'complete' : index === step ? 'running' : 'pending',
      detail: [
        '경험과 성과를 살펴보는 시안',
        '직무의 요구사항을 비교하는 시안',
        '요약과 평가 요소를 배치하는 시안',
      ][index],
    })),
  };
}

function localRect(element) {
  const bounds = stage.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - bounds.left,
    y: rect.top - bounds.top,
    width: rect.width,
    height: rect.height,
  };
}

async function play(kind = 'full') {
  stopPlayback();
  const controller = new AbortController();
  run = controller;
  const { signal } = controller;
  stage.dataset.phase = 'eye';
  previewContent.inert = true;
  previewContent.setAttribute('aria-hidden', 'true');
  overlay.hidden = false;
  setColors();
  stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  status.textContent =
    kind === 'transition'
      ? '완료된 눈 → 입자·곡선 → 보고서 형성 → 테두리 빛'
      : '눈이 그려지고, 미세한 선이 바깥으로 자라납니다. 가상 분석 시연입니다.';
  eye = mountAnalysisEye(eyeHost, snapshot(kind === 'transition'), {
    surface: 'overlay',
    purpose: 'report',
    palette: selected('eye'),
  });
  try {
    if (kind !== 'transition') {
      for (let step = 0; step < 3; step++) {
        eye.update(snapshot(false, step));
        await waitForPresentationDelay([1400, 1300, 1300][step], signal);
      }
      eye.update(snapshot(true));
      await waitForPresentationDelay(reduce.matches ? 0 : 340, signal);
    } else await waitForPresentationDelay(reduce.matches ? 0 : 240, signal);
    if (kind === 'eye') {
      status.textContent =
        '눈 색상 시안 · 분석 완료 모습. 다른 색을 고르거나 전체 흐름을 재생하세요.';
      return;
    }
    const fromRect = localRect(eyeHost);
    const frame = previewContent.querySelector('[data-report-frame]');
    const toRect = localRect(frame);
    overlay.classList.add('is-releasing');
    status.textContent = `${selected('effect').name} · 빛이 모여 보고서를 만듭니다.`;
    await playReportTransition({
      host: stage,
      fromRect,
      toRect,
      palette: selected('effect'),
      signal,
      reducedMotion: reduce.matches,
      onReveal() {
        if (signal.aborted) return;
        overlay.hidden = true;
        eye?.dispose();
        eye = null;
        previewContent.inert = false;
        previewContent.removeAttribute('aria-hidden');
        stage.dataset.phase = 'enter';
      },
    });
    signal.throwIfAborted();
    await waitForPresentationDelay(reduce.matches ? 0 : 800, signal);
    stage.dataset.phase = 'report';
    status.textContent = '보고서 형성 완료 · 테두리 빛은 잦아들고 내용을 읽을 수 있습니다.';
  } catch (error) {
    if (error.name !== 'AbortError' && !signal.aborted) {
      showReport();
      status.textContent =
        '모션을 표시하지 못해 보고서 시안을 열었습니다. 다른 시안을 선택하거나 다시 재생해 주세요.';
    }
  } finally {
    if (run === controller && kind !== 'eye') run = null;
  }
}

function mountPyramid(host, palette) {
  const names = ['이력서 완성도', '직무 적합도', '지원 자격 충족도', '실무 경쟁력'];
  host.classList.add('lab-pyramid');
  host.style.background = palette.background;
  host.style.color = ['cobalt', 'ink'].includes(palette.id) ? '#edf6ff' : '#23476a';
  host.setAttribute('role', 'img');
  host.setAttribute(
    'aria-label',
    '유리 피라미드 색상 시안. 네 꼭짓점은 이력서 완성도, 직무 적합도, 지원 자격 충족도, 실무 경쟁력입니다.',
  );
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);
  const labels = names.map((name) => {
    const label = document.createElement('span');
    label.className = 'lab-pyramid-label';
    label.textContent = name;
    label.setAttribute('aria-hidden', 'true');
    host.append(label);
    return label;
  });
  let renderer;
  try {
    renderer = new ScorePyramidRenderer(canvas, palette);
  } catch {
    host.replaceChildren();
    const fallback = document.createElement('p');
    fallback.className = 'lab-pyramid-fallback';
    fallback.textContent = '3D를 사용할 수 없는 환경입니다. ' + names.join(' · ');
    host.append(fallback);
    return () => {};
  }
  const controller = new AbortController();
  const { signal } = controller;
  let raf = 0,
    last = 0,
    mix = 0,
    yaw = -0.6,
    pointerX = 0,
    pointerY = 0,
    zoom = 1,
    visible = true;
  let width = 300,
    height = 300;
  let labelWidths = labels.map(() => 90);
  function draw(now) {
    raf = 0;
    if (document.hidden || !visible || signal.aborted) return;
    const dt = last ? Math.min(0.04, (now - last) / 1000) : 0;
    last = now;
    if (!reduce.matches) yaw += dt * 0.12;
    const target = showProjected ? 1 : 0;
    mix = reduce.matches ? target : mix + (target - mix) * (1 - Math.exp(-dt * 3.2));
    const scores = [72, 83, 68, 78].map(
      (value, index) => value + ([86, 91, 85, 87][index] - value) * mix,
    );
    const positions = renderer.render(scores, mix, yaw + pointerX, 0.08 + pointerY, zoom);
    const placed = [];
    positions.forEach((point, index) => {
      const label = labels[index],
        labelWidth = labelWidths[index];
      const x = Math.max(
        6,
        Math.min(width - labelWidth - 6, point.x + (point.x < width / 2 ? -labelWidth - 8 : 8)),
      );
      let y = Math.max(5, Math.min(height - 26, point.y - 10));
      for (const box of placed)
        if (Math.abs(box.y - y) < 24 && x < box.x + box.w + 5 && x + labelWidth > box.x - 5)
          y = Math.min(height - 24, y + 26);
      placed.push({ x, y, w: labelWidth });
      label.style.transform = `translate(${x}px,${y}px)`;
    });
    if (!reduce.matches) raf = requestAnimationFrame(draw);
  }
  function wake() {
    if (!raf && !document.hidden && visible && !signal.aborted) {
      last = 0;
      raf = requestAnimationFrame(draw);
    }
  }
  const resize = new ResizeObserver(([entry]) => {
    width = entry.contentRect.width;
    height = entry.contentRect.height;
    labelWidths = labels.map((label) => label.offsetWidth || 90);
    renderer.resize(width, height);
    wake();
  });
  resize.observe(host);
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
    else {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  visibility.observe(host);
  host.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'touch') return;
      const r = host.getBoundingClientRect();
      pointerX = ((event.clientX - r.left) / r.width - 0.5) * 1.1;
      pointerY = ((event.clientY - r.top) / r.height - 0.5) * 0.4;
      wake();
    },
    { signal },
  );
  host.addEventListener(
    'pointerleave',
    () => {
      pointerX = 0;
      pointerY = 0;
      wake();
    },
    { signal },
  );
  host.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) return;
      const next = Math.max(0.86, Math.min(1.12, zoom - event.deltaY * 0.0005));
      if (next !== zoom) {
        event.preventDefault();
        zoom = next;
        wake();
      }
    },
    { signal, passive: false },
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else wake();
    },
    { signal },
  );
  reduce.addEventListener('change', wake, { signal });
  app.querySelector('#morph-pyramid').addEventListener('click', wake, { signal });
  wake();
  return () => {
    controller.abort();
    cancelAnimationFrame(raf);
    resize.disconnect();
    visibility.disconnect();
    renderer.dispose();
  };
}

app.querySelectorAll('[data-category]').forEach((button) => {
  button.addEventListener('click', () => {
    category = button.dataset.category;
    app.querySelectorAll('[data-category]').forEach((tab) => {
      const active = tab === button;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    renderOptions();
  });
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    const tabs = [...app.querySelectorAll('[data-category]')],
      index = tabs.indexOf(button);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + tabs.length) %
            tabs.length;
    tabs[next].click();
    tabs[next].focus();
  });
});
app.querySelector('#play-full').addEventListener('click', () => play('full'));
app.querySelector('#play-transition').addEventListener('click', () => play('transition'));
app.querySelector('#show-report').addEventListener('click', showReport);
app.querySelector('#morph-pyramid').addEventListener('click', () => {
  showReport();
  showProjected = !showProjected;
  const button = app.querySelector('#morph-pyramid');
  button.setAttribute('aria-pressed', String(showProjected));
  button.textContent = showProjected ? '기본 도형으로 돌아가기' : '피라미드 변화 시연';
});
app.querySelector('#reset-presets').addEventListener('click', () => {
  Object.assign(state, defaults);
  renderReport();
  renderOptions();
  showReport();
});
app.querySelector('#copy-combination').addEventListener('click', async () => {
  const feedback = app.querySelector('#copy-feedback');
  try {
    await navigator.clipboard.writeText(location.href);
    feedback.textContent = '현재 조합의 링크를 복사했습니다.';
  } catch {
    feedback.textContent = '주소창의 링크를 복사하면 이 조합으로 다시 열 수 있습니다.';
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && run) {
    showReport();
    status.textContent = '다른 탭으로 이동해 재생을 멈췄습니다. 다시 재생할 수 있습니다.';
  }
});
window.addEventListener('pagehide', () => {
  stopPlayback();
  disposePyramid?.();
});
renderReport();
renderOptions();
showReport();
