import {
  STUDY_DURATION,
  STUDY_STAGES,
  drawFixedAnchorFrame,
  loadStudyArtwork,
  mountFixedAnchorStudy,
} from './fixed-anchor-study.js';

// This review page drives only a deterministic canvas study; it never imports the API client.
const canvas = document.getElementById('motion-study');
const titleOverlay = document.getElementById('scene-title');
const sceneTag = document.getElementById('scene-tag');
const playButton = document.getElementById('play-motion');
const restartButton = document.getElementById('restart-motion');
const timeline = document.getElementById('motion-timeline');
const clock = document.getElementById('motion-clock');
const guides = document.getElementById('show-guides');
const status = document.getElementById('preview-status');
const stageButtonsHost = document.getElementById('stage-buttons');
const framesHost = document.getElementById('storyboard-frames');
const workflow = [...document.querySelectorAll('[data-workflow]')];
const stageButtons = [];
const frameCanvases = [];
const twoDigits = (value) => String(value).padStart(2, '0');
let controller;
let currentFrame;
let selectedStage = '';
let disposed = false;
let shuffleCount = 0;
let savedFrame;

timeline.max = String(STUDY_DURATION);

function titleOpacity(time) {
  return Math.max(0, Math.min(1, (4 - time) / 0.8));
}

function updateFrame(frame) {
  currentFrame = frame;
  timeline.value = String(frame.time);
  timeline.setAttribute('aria-valuetext', `${frame.time.toFixed(1)}초, ${frame.stage.title}`);
  clock.textContent = `${frame.time.toFixed(1).padStart(4, '0')} / ${STUDY_DURATION.toFixed(1)}`;
  playButton.textContent = frame.playing ? '일시정지' : '재생';
  playButton.setAttribute('aria-label', frame.playing ? '모션 일시정지' : '모션 재생');
  titleOverlay.style.opacity = String(titleOpacity(frame.time));
  titleOverlay.style.left = `${frame.geometry.offsetX + 50 * frame.geometry.scale}px`;
  titleOverlay.style.top = `${frame.geometry.offsetY + 55 * frame.geometry.scale}px`;
  titleOverlay.style.fontSize = `${34 * frame.geometry.scale}px`;
  const workflowIndex = frame.time < 4 ? 0 : frame.time < 7.7 ? 1 : frame.time < 12 ? 2 : 3;
  workflow.forEach((item, index) => {
    item.classList.toggle('is-active', index === workflowIndex);
    if (index === workflowIndex) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
  sceneTag.textContent =
    frame.loading.percent === 100
      ? '분석 완료 · 시연'
      : frame.time < 1.3
        ? '이력서 첨부 전'
        : frame.time < 4
          ? '이력서 첨부'
          : frame.time < 7.7
            ? '희망 직무 선택'
            : frame.time < 12
              ? '채용공고 · 결과 확인 전'
              : '모의지원 분석 · 시연';

  if (selectedStage === frame.stage.id) return;
  selectedStage = frame.stage.id;
  const index = STUDY_STAGES.findIndex((stage) => stage.id === selectedStage);
  document.getElementById('stage-index').textContent =
    `${twoDigits(index + 1)} / ${twoDigits(STUDY_STAGES.length)}`;
  document.getElementById('stage-title').textContent = frame.stage.title;
  document.getElementById('stage-description').textContent = frame.stage.description;
  stageButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.stage === selectedStage));
  });
}

function inspectStage(stage, announce = false) {
  if (disposed) return;
  controller.pause();
  controller.seek(stage.time);
  // The same viewport-fixed canvas stays visible; inspecting a card must not move the page.
  if (announce) status.textContent = `${stage.title} 장면을 화면 위의 고정된 영역에 표시합니다.`;
}

function drawSceneImage(target, stage, seed, withGuides) {
  const ctx = target.getContext('2d');
  drawFixedAnchorFrame(ctx, target.width, target.height, {
    time: stage.time,
    seed,
    guides: withGuides,
  });
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.restore();
  ctx.save();
  ctx.scale(target.width / 1200, target.height / 620);
  ctx.fillStyle = '#122d55';
  ctx.globalAlpha = titleOpacity(stage.time);
  ctx.font = '750 34px Pretendard, "Noto Sans KR", sans-serif';
  ctx.fillText('지원의 시작은, 내 이력서부터.', 50, 86);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#e3ebf8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(50, 531);
  ctx.lineTo(1150, 531);
  ctx.stroke();
  ctx.fillStyle = '#2459ee';
  ctx.font = '600 15px Pretendard, sans-serif';
  ctx.fillText(stage.label, 50, 564);
  ctx.fillStyle = '#173255';
  ctx.font = '600 20px Pretendard, sans-serif';
  ctx.fillText(stage.title, 255, 565);
  ctx.fillStyle = '#6b7d98';
  ctx.font = '400 14px Pretendard, sans-serif';
  ctx.fillText(stage.description, 255, 591);
  ctx.restore();
}

function refreshImages() {
  const frame = controller?.snapshot() || { seed: 7, guides: false };
  frameCanvases.forEach(({ target, stage }) => {
    drawSceneImage(target, stage, frame.seed, frame.guides);
  });
}

async function downloadImage(stage) {
  try {
    await loadStudyArtwork();
  } catch {
    status.textContent = '눈 이미지를 불러오지 못했어요. 새로고침한 뒤 다시 저장해 주세요.';
    return;
  }
  const target = document.createElement('canvas');
  target.width = 2400;
  target.height = 1240;
  const frame = controller.snapshot();
  drawSceneImage(target, stage, frame.seed, frame.guides);
  target.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `CareerLens-motion-${stage.id}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `${stage.title} 장면을 PNG 이미지로 저장했습니다.`;
  }, 'image/png');
}

// Deterministic export used by the frame downloads and review tooling.
export async function exportStudyFrame(stageId, options = {}) {
  await loadStudyArtwork();
  const stage = STUDY_STAGES.find((item) => item.id === stageId);
  if (!stage) throw new Error('Unknown motion study stage.');
  const scale = Math.max(1, Math.min(4, Number(options.scale) || 2));
  const target = document.createElement('canvas');
  target.width = Math.round(1200 * scale);
  target.height = Math.round(620 * scale);
  const frame = controller.snapshot();
  drawSceneImage(target, stage, options.seed ?? frame.seed, options.guides ?? frame.guides);
  return target.toDataURL('image/png');
}

for (const [index, stage] of STUDY_STAGES.entries()) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.stage = stage.id;
  button.setAttribute('aria-pressed', String(index === 0));
  const number = document.createElement('span');
  number.textContent = twoDigits(index + 1);
  button.append(number, document.createTextNode(stage.label.replace(/^\d+\s*[·.]\s*/, '')));
  button.addEventListener('click', () => inspectStage(stage));
  stageButtons.push(button);
  stageButtonsHost.append(button);

  const card = document.createElement('article');
  card.className = 'motion-preview__frame';
  const image = document.createElement('div');
  image.className = 'motion-preview__frame-image';
  const target = document.createElement('canvas');
  target.width = 1200;
  target.height = 620;
  target.setAttribute('role', 'img');
  target.setAttribute('aria-label', `${stage.title}. ${stage.description}`);
  target.dataset.frame = stage.id;
  image.append(target);
  const text = document.createElement('div');
  text.className = 'motion-preview__frame-text';
  const cardNumber = document.createElement('span');
  cardNumber.className = 'motion-preview__frame-number';
  cardNumber.textContent = twoDigits(index + 1);
  const copy = document.createElement('div');
  const heading = document.createElement('h3');
  heading.textContent = stage.title;
  const description = document.createElement('p');
  description.textContent = stage.description;
  const actions = document.createElement('div');
  actions.className = 'motion-preview__frame-actions';
  const inspect = document.createElement('button');
  inspect.type = 'button';
  inspect.textContent = '이 장면 크게 보기';
  inspect.setAttribute('aria-label', `${stage.title} 장면 크게 보기`);
  inspect.addEventListener('click', () => inspectStage(stage, true));
  const download = document.createElement('button');
  download.type = 'button';
  download.textContent = 'PNG 저장 ↓';
  download.setAttribute('aria-label', `${stage.title} PNG 저장`);
  download.addEventListener('click', () => downloadImage(stage));
  actions.append(inspect, download);
  copy.append(heading, description, actions);
  text.append(cardNumber, copy);
  card.append(image, text);
  framesHost.append(card);
  frameCanvases.push({ target, stage });
}

controller = mountFixedAnchorStudy(canvas, { onFrame: updateFrame });
const requestedStage = STUDY_STAGES.find(
  (stage) => stage.id === new URLSearchParams(location.search).get('stage'),
);
if (requestedStage) controller.seek(requestedStage.time);
refreshImages();
loadStudyArtwork()
  .then(() => {
    if (!disposed) refreshImages();
  })
  .catch(() => {
    if (!disposed) status.textContent = '눈 이미지를 불러오지 못했어요. 새로고침해 주세요.';
  });

playButton.addEventListener('click', () => {
  if (currentFrame.playing) controller.pause();
  else controller.play();
});
restartButton.addEventListener('click', () => controller.restart());
timeline.addEventListener('input', () => {
  const time = Number(timeline.value);
  controller.pause();
  controller.seek(time);
});
guides.addEventListener('change', () => {
  controller.setGuides(guides.checked);
  refreshImages();
});
document.getElementById('shuffle-elements').addEventListener('click', () => {
  shuffleCount += 1;
  controller.shuffle();
  refreshImages();
  status.textContent = '곡선 끝에 표시할 평가 요소 다섯 개를 다시 선택했습니다.';
});
document.getElementById('preview-analysis').addEventListener('click', () => {
  controller.seek(12);
  controller.play();
  status.textContent =
    '링이 제자리에서 가속하고 눈 윤곽이 그려집니다. 동공의 퍼센트와 회전은 시연용 로딩입니다.';
});

window.addEventListener('pagehide', () => {
  savedFrame = controller.snapshot();
  disposed = true;
  controller.dispose();
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  disposed = false;
  controller = mountFixedAnchorStudy(canvas, { onFrame: updateFrame });
  for (let index = 0; index < shuffleCount; index += 1) controller.shuffle();
  controller.setGuides(savedFrame?.guides ?? false);
  controller.seek(savedFrame?.time ?? 0);
  if (savedFrame?.playing) controller.play();
  refreshImages();
});
