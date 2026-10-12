import {
  finishPreparationPresentation,
  waitForPresentationDelay,
  withPresentationSignal,
} from './preparation-transition.js';
import { reportLoadingSnapshot } from './report-state.js';
import { analysisEyePalette, reportTransitionPalette } from '../../shared/design/selected-theme.js';
import { playReportTransition } from '../../shared/motion/report-transition.js';

// A native modal prevents changes while the selected posting is analyzed.
// Explicit cancellation can return to that posting from any starting page.
export function createReportLoading({ draft, onCancel }) {
  const abort = new AbortController();
  const { signal } = abort;
  const dialog = document.createElement('dialog');
  dialog.className = 'report-loading-overlay';
  dialog.setAttribute('aria-labelledby', 'report-loading-title');
  dialog.setAttribute('aria-describedby', 'report-loading-description');
  dialog.setAttribute('tabindex', '-1');
  dialog.innerHTML = `
    <div class="report-loading-content">
      <div class="report-loading-heading">
        <h2 id="report-loading-title">경험을 하나의 보고서로 정리하고 있어요.</h2>
        <p id="report-loading-description">
          ${draft.analysis_mode === 'job_posting' ? '이력서와 선택한 채용공고를 함께 살펴봅니다.' : '이력서와 희망 직무를 함께 살펴봅니다.'}
        </p>
      </div>
      <section class="report-live-progress" aria-label="에이전트 진행 상황">
        <div class="report-live-progress__heading">
          <p data-progress-message role="status" aria-live="polite">진행 정보를 기다리고 있습니다.</p>
          <strong data-progress-percent>--%</strong>
        </div>
        <progress data-progress-bar max="100" aria-label="실제 에이전트 진행률"></progress>
        <ol data-progress-log aria-label="에이전트 진행 로그"></ol>
      </section>
      <div
        class="report-loading-eye"
        data-report-eye>
        <p
          class="report-loading-fallback"
          role="status">
          분석을 준비하고 있습니다.
        </p>
      </div>
      <button
        type="button"
        class="report-loading-return">
        채용공고로 돌아가기
      </button>
    </div>
  `;
  const host = dialog.querySelector('[data-report-eye]');
  const progressMessage = dialog.querySelector('[data-progress-message]');
  const progressPercent = dialog.querySelector('[data-progress-percent]');
  const progressBar = dialog.querySelector('[data-progress-bar]');
  const progressLog = dialog.querySelector('[data-progress-log]');
  const back = dialog.querySelector('button');
  const focused = document.activeElement;
  const scrollOverflow = document.body.style.overflow;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let eye;
  let disposed = false;
  let startedAt;
  let analysisComplete = false;
  let latestProgress;
  let lastEventMessage = '';
  document.body.append(dialog);
  document.body.style.overflow = 'hidden';
  dialog.showModal();
  dialog.focus();

  function dispose({ restoreFocus = true, cancelAnalysis = false } = {}) {
    if (disposed) return;
    disposed = true;
    abort.abort();
    if (cancelAnalysis && !analysisComplete) onCancel?.();
    eye?.dispose();
    dialog.close();
    dialog.remove();
    document.body.style.overflow = scrollOverflow;
    const restore =
      focused?.isConnected && !focused.disabled
        ? focused
        : document.querySelector(
            '#opportunity-apply:not(:disabled), #select-posting:not(:disabled)',
          ) ||
          document.querySelector('#opportunity-detail') ||
          document.querySelector('#main[tabindex]');
    if (restoreFocus) restore?.focus({ preventScroll: true });
  }
  function cancel() {
    if (disposed) return;
    dispose({ cancelAnalysis: true });
  }
  function updateProgress(update) {
    latestProgress = update;
    const run = update?.run;
    const value = run?.progress_percent;
    const validPercent = Number.isFinite(value) && value >= 0 && value <= 100;
    progressPercent.textContent = validPercent ? `${Math.floor(value)}%` : '--%';
    if (validPercent) progressBar.value = value;
    else progressBar.removeAttribute('value');

    const events = Array.isArray(update?.events) ? update.events : [];
    const recentEvents = events.slice(-10);
    for (const event of recentEvents) {
      const item = document.createElement('li');
      item.textContent = event.message || '진행 이벤트';
      if (event.status) item.dataset.status = event.status;
      progressLog.append(item);
    }
    while (progressLog.children.length > 10) progressLog.firstElementChild.remove();
    const latestMessage = recentEvents.at(-1)?.message;
    if (latestMessage) lastEventMessage = latestMessage;
    const stageLabels = {
      parsing: '이력서와 공고를 구조화하고 있습니다.',
      indexing: '이력서 근거 검색을 준비하고 있습니다.',
      evaluation: '12개 직무 항목을 병렬 평가하고 있습니다.',
      criterion: '12개 항목을 병렬 평가하고 있습니다.',
      validation: '전체 평가 결과를 검토하고 있습니다.',
      reporting: '최종 보고서를 저장하고 있습니다.',
    };
    progressMessage.textContent =
      lastEventMessage ||
      (run?.current_stage === 'queued'
        ? '평가 작업을 대기열에 등록했습니다.'
        : stageLabels[run?.current_stage]
          ? stageLabels[run.current_stage]
          : '진행 정보를 기다리고 있습니다.');
    if (eye) eye.update(reportLoadingSnapshot(draft, false, update));
  }
  back.addEventListener('click', cancel, { signal });
  dialog.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      cancel();
    },
    { signal },
  );

  async function run(request) {
    try {
      // Fetch the module while the dimmer enters. API work starts after dimming;
      // eye drawing and the gauge then start together with that work.
      const modulePromise = import('./matching-eye.js').catch(() => null);
      await waitForPresentationDelay(reduced ? 0 : 220, signal);
      signal.throwIfAborted();
      startedAt = performance.now();
      const visual = modulePromise.then((module) => {
        if (signal.aborted || !module) return;
        try {
          eye = module.mountAnalysisEye(
            host,
            reportLoadingSnapshot(draft, false, latestProgress),
            {
              surface: 'overlay',
              purpose: 'report',
              palette: analysisEyePalette,
            },
          );
        } catch {
          host.textContent = '보고서를 작성하고 있습니다.';
        }
      });
      // Module loading cannot block the report request.
      host.setAttribute('aria-busy', 'true');
      progressBar.removeAttribute('value');
      const result = await request(signal, updateProgress);
      signal.throwIfAborted();
      await withPresentationSignal(visual, signal);
      signal.throwIfAborted();
      if (latestProgress?.run?.id) {
        updateProgress({
          run: { ...latestProgress.run, status: 'completed', progress_percent: 100, current_stage: 'completed' },
          events: [],
        });
      } else {
        progressMessage.textContent = '시연용 결과를 준비했습니다. 실제 백엔드 평가 진행률은 아닙니다.';
      }
      eye?.update(reportLoadingSnapshot(draft, true));
      host.setAttribute('aria-busy', 'false');
      if (!eye) host.textContent = '보고서가 완성되었습니다. 결과를 엽니다.';
      await finishPreparationPresentation({ eye, startedAt, signal, fold: false, onComplete() {} });
      analysisComplete = true;
      return result;
    } catch (error) {
      dispose();
      throw error;
    }
  }

  async function reveal({ frame, onReveal = () => {} } = {}) {
    signal.throwIfAborted();
    if (!analysisComplete) throw new Error('분석이 완료된 뒤 보고서를 열 수 있습니다.');
    let revealed = false;
    const revealContent = () => {
      if (revealed || signal.aborted) return;
      revealed = true;
      onReveal();
      dialog.classList.add('is-revealing');
      eye?.dispose();
      eye = undefined;
    };
    // The completed eye remains in the modal top layer while the real result is
    // measured underneath. No screenshot, cloned report or synthetic report is used.
    const source = host.querySelector('.cl-analysis-eye__scene') || host;
    const bounds = dialog.getBoundingClientRect();
    const eyeBounds = source.getBoundingClientRect();
    const frameBounds = frame?.getBoundingClientRect();
    const viewportWidth = dialog.clientWidth || bounds.width;
    const viewportHeight = dialog.clientHeight || bounds.height;
    // Follow the real scroll window without moving or shrinking its outline into
    // a second, invented card. The canvas clips offscreen edges naturally.
    const target = frameBounds && {
      x: frameBounds.left - bounds.left,
      y: frameBounds.top - bounds.top,
      width: frameBounds.width,
      height: frameBounds.height,
    };
    if (
      !target ||
      !Object.values(target).every(Number.isFinite) ||
      target.width <= 0 ||
      target.height <= 0 ||
      target.x >= viewportWidth ||
      target.y >= viewportHeight ||
      target.x + target.width <= 0 ||
      target.y + target.height <= 0
    ) {
      revealContent();
      return;
    }
    dialog.classList.add('is-transferring');
    try {
      await playReportTransition({
        host: dialog,
        fromRect: {
          x: eyeBounds.left - bounds.left,
          y: eyeBounds.top - bounds.top,
          width: eyeBounds.width,
          height: eyeBounds.height,
        },
        toRect: target,
        outline: 'document',
        palette: reportTransitionPalette,
        signal,
        reducedMotion: reduced,
        onReveal: revealContent,
      });
    } catch (error) {
      signal.throwIfAborted();
      // Presentation failure cannot discard an already valid report. Routing and
      // authentication remain owned by the controller, including the guest gate.
      revealContent();
    }
    signal.throwIfAborted();
    revealContent();
  }
  return { run, reveal, dispose, signal };
}
