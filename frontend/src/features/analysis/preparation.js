import { api } from '../../shared/api/client.js';
import { preparationSnapshot, runPreparationStages } from './preparation-state.js';

export function bindPreparation({ draft, onWorkspace, onComplete, onError }) {
  const host = document.querySelector('[data-preparation-status]');
  const message = document.getElementById('preparation-message');
  const retry = document.getElementById('preparation-retry');
  const abort = new AbortController();
  const { signal } = abort;
  let navigated = false;
  let running = false;
  let prepared = draft.preparation || {};

  const complete = () => {
    if (signal.aborted || navigated) return;
    navigated = true;
    onComplete();
  };

  const showSnapshot = (snapshot) => {
    if (signal.aborted) return;
    host.replaceChildren(
      ...snapshot.stages.map((stage) => {
        const row = document.createElement('li');
        const labels = {
          pending: '대기',
          running: '확인 중',
          complete: '완료',
          error: '확인 필요',
        };
        row.dataset.status = stage.status;
        row.textContent = `${stage.label} · ${labels[stage.status]}${stage.detail ? ` — ${stage.detail}` : ''}`;
        return row;
      }),
    );
  };

  async function run() {
    if (running || signal.aborted) return;
    running = true;
    retry.hidden = true;
    message.textContent = '이력서와 희망 직무를 확인하고, 경험을 보완할 질문을 준비합니다.';
    host.setAttribute('aria-busy', 'true');
    try {
      prepared = await runPreparationStages({
        initial: prepared,
        signal,
        request: (stage, fingerprint, requestSignal) =>
          api('/preparation', {
            method: 'POST',
            body: { stage, fingerprint },
            signal: requestSignal,
          }),
        onSnapshot: showSnapshot,
        onWorkspace: (result) => {
          prepared = result.preparation || result.draft.preparation;
          onWorkspace(result);
        },
      });
      showSnapshot(preparationSnapshot(prepared));
      message.textContent = '질문이 준비되었습니다. 답변 화면으로 이어갑니다.';
      complete();
    } catch (error) {
      if (signal.aborted) return;
      message.textContent =
        '분석을 마치지 못했습니다. 입력 내용은 유지되며, 완료하지 못한 단계부터 다시 시도합니다.';
      retry.hidden = false;
      if (error.status === 409) {
        retry.hidden = true;
        message.textContent =
          '다른 화면에서 입력 내용이 변경되었습니다. 희망 직무 수정으로 돌아가 다시 시작해 주세요.';
      }
      onError(error);
    } finally {
      running = false;
      if (!signal.aborted) host.setAttribute('aria-busy', 'false');
    }
  }

  retry.addEventListener('click', run, { signal });
  showSnapshot(preparationSnapshot(prepared));
  run();
  return () => abort.abort();
}
