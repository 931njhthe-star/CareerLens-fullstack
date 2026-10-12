import { finishPreparationPresentation, withPresentationSignal } from './preparation-transition.js';
import { reportTransitionPalette } from '../../shared/design/selected-theme.js';
import { playReportTransition } from '../../shared/motion/report-transition.js';

// A native modal prevents changes while the selected posting is analyzed.
// Explicit cancellation can return to that posting from any starting page.
export function createReportLoading({ draft, onCancel, demo = false, preview = false, ready = false }) {
  const illustrative = demo === true;
  const abort = new AbortController();
  const { signal } = abort;
  const dialog = document.createElement('dialog');
  dialog.className = 'report-loading-overlay';
  dialog.setAttribute('aria-labelledby', 'report-loading-title');
  dialog.setAttribute('aria-describedby', 'report-loading-description');
  dialog.setAttribute('tabindex', '-1');
  dialog.innerHTML = `
    <div class="report-loading-content">
      <div
        class="report-loading-eye"
        role="progressbar"
        aria-label="${ready ? '저장된 보고서 열기' : preview ? '보고서 확인 화면 준비' : '보고서 분석 진행'}"
        aria-valuemin="0"
        aria-valuemax="100"
        data-report-eye>
        <p
          class="report-loading-fallback"
          role="status">
          ${ready ? '저장된 보고서를 열고 있습니다.' : preview ? '보고서 확인 화면을 준비하고 있습니다.' : '분석을 준비하고 있습니다.'}
        </p>
      </div>
      <p class="report-loading-percent" data-loading-percent aria-hidden="true">${illustrative ? '0%' : '확인 중'}</p>
      <div class="report-loading-heading">
        <h2 id="report-loading-title">${ready ? '완성된 보고서를 열고 있어요.' : preview ? '결과를 확인할 화면을 준비하고 있어요.' : '경험을 하나의 보고서로 정리하고 있어요.'}</h2>
        <p id="report-loading-description">
          ${ready ? '로그인 전에 완료된 분석 결과를 불러왔습니다.' : preview ? '첨부한 이력서와 선택한 공고를 이어서 사용할 수 있도록 보관합니다.' : draft.analysis_mode === 'job_posting' ? '이력서와 선택한 채용공고를 함께 살펴봅니다.' : '이력서와 희망 직무를 함께 살펴봅니다.'}
        </p>
        <p class="report-loading-progress-note">${ready ? '추가 분석 없이 저장된 결과를 표시합니다.' : preview ? '잠긴 보고서 화면으로 이동합니다. 실제 분석은 로그인 후 이어집니다.' : illustrative ? '시연용 진행률이며, 실제 분석 진행률이 아닙니다.' : '분석 서버가 보내는 작업 진행률입니다. 항목별 평가 점수나 합격 가능성이 아닙니다.'}</p>
        <p data-evaluation-status role="status" aria-live="polite"></p>
      </div>
      <button
        type="button"
        class="report-loading-return">
        채용공고로 돌아가기
      </button>
    </div>
  `;
  const host = dialog.querySelector('[data-report-eye]');
  const percentage = dialog.querySelector('[data-loading-percent]');
  const evaluationStatus = dialog.querySelector('[data-evaluation-status]');
  const back = dialog.querySelector('button');
  const focused = document.activeElement;
  const scrollOverflow = document.body.style.overflow;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let eye;
  let disposed = false;
  let startedAt;
  let requestSucceeded = false;
  let analysisComplete = false;
  function showProgress(value, description) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) {
      host.setAttribute('aria-valuenow', String(value));
      host.setAttribute('aria-valuetext', `${String(value)}% · ${description}`);
      percentage.textContent = `${String(value)}%`;
    } else {
      host.removeAttribute('aria-valuenow');
      host.setAttribute('aria-valuetext', ready ? '저장된 보고서를 열고 있습니다.' : preview ? '보고서 확인 화면을 준비하고 있습니다.' : '분석 서버의 진행률을 확인하고 있습니다.');
      percentage.textContent = ready ? '완료' : preview ? '준비 중' : '확인 중';
    }
  }
  showProgress(illustrative ? 0 : null, '시연용 진행률');
  document.body.append(dialog);
  document.body.style.overflow = 'hidden';
  dialog.showModal();
  dialog.focus();

  function dispose({ restoreFocus = true, cancelAnalysis = false } = {}) {
    if (disposed) return;
    disposed = true;
    abort.abort();
    if (cancelAnalysis && !requestSucceeded) onCancel?.();
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
    const succeeded = requestSucceeded;
    dispose({ cancelAnalysis: true });
    if (succeeded) onCancel?.();
  }
  function updateProgress(update) {
    if (signal.aborted || requestSucceeded || preview || ready) return;
    const percent = update?.run?.progress_percent;
    if (!illustrative) showProgress(percent, '분석 서버 작업 진행률');
    const labels = {
      queued: '분석 순서를 기다리고 있어요.',
      parsing: '이력서와 공고 내용을 확인하고 있어요.',
      indexing: '경험과 연결되는 근거를 찾고 있어요.',
      evaluation: '항목별 경험과 역량을 살펴보고 있어요.',
      criterion: '항목별 경험과 역량을 살펴보고 있어요.',
      validation: '평가 근거를 다시 확인하고 있어요.',
      reporting: '분석 내용을 보고서로 정리하고 있어요.',
      completed: '분석을 마쳤어요. 보고서를 확인하고 있어요.',
    };
    evaluationStatus.textContent =
      !illustrative && percent === 100
        ? '분석 진행률이 100%입니다. 보고서를 확인하고 있어요.'
        : labels[update?.run?.current_stage] || '분석을 진행하고 있어요.';
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
      signal.throwIfAborted();
      startedAt = performance.now();
      // The pupil grows from nothing as the page clears to white. Graphics loading
      // and drawing never hold up the actual analysis request.
      const visual = import('./live-eye-motion.js')
        .catch(() => null)
        .then((module) => {
          if (signal.aborted || !module) return;
          try {
            eye = module.mountLiveAnalysisEye(host, {
              ready,
              onProgress(value) {
                if (signal.aborted || !illustrative || preview || ready) return;
                const percent = Math.min(
                  requestSucceeded ? 100 : 99,
                  Math.max(0, Math.round(value)),
                );
                showProgress(percent, '시연용 진행률');
              },
            });
          } catch {
            // Keep a readable fallback if graphics are unavailable.
            if (!eye) host.textContent = preview ? '보고서 확인 화면을 준비하고 있습니다.' : '보고서를 작성하고 있습니다.';
          }
        });
      // Module loading cannot block the report request.
      host.setAttribute('aria-busy', 'true');
      const result = await request(signal, updateProgress);
      signal.throwIfAborted();
      requestSucceeded = true;
      await withPresentationSignal(visual, signal);
      signal.throwIfAborted();
      eye?.complete();
      if (!eye) host.textContent = preview ? '잠긴 보고서 화면을 엽니다.' : '보고서가 완성되었습니다. 결과를 엽니다.';
      await finishPreparationPresentation({
        eye: eye && { finish: () => eye.whenSettled() },
        // The actual guest analysis already honored the loading minimum. On
        // unlock only the existing eye's finishing/reveal animation is needed.
        startedAt: ready ? startedAt - 4000 : startedAt,
        signal,
        fold: false,
        onComplete() {},
      });
      if (preview) {
        host.removeAttribute('aria-valuenow');
        host.setAttribute('aria-valuetext', '보고서 확인 화면 준비 완료. 로그인 후 실제 분석을 이어갑니다.');
        percentage.textContent = '준비됨';
      } else showProgress(100, illustrative ? '시연 완료' : '보고서 분석 완료');
      evaluationStatus.textContent = preview ? '로그인 후 실제 분석을 이어갈 수 있어요.' : '보고서가 준비됐어요.';
      host.setAttribute('aria-busy', 'false');
      analysisComplete = true;
      return result;
    } catch (error) {
      const failure = signal.aborted ? signal.reason || error : error;
      dispose();
      throw failure;
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
    const source = eye?.scene || eye?.element || host;
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
