import { escapeHtml as e, icon } from '../../shared/components/ui.js';

function expiryMarkup(expiresAt) {
  if (typeof expiresAt !== 'string' || !expiresAt.trim()) return '';
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) return '';
  const label = new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return `<p class="report-gate__expiry">자동 삭제 예정 · <time datetime="${e(date.toISOString())}">${e(label)}</time> <span>(기기 시간 기준)</span></p>`;
}

/** This page deliberately accepts no report data, including scores or excerpts. */
export function reportGatePage({ expires_at, demo = false } = {}) {
  const title = demo ? '시연용 결과가 준비됐어요' : '분석이 완료되었어요';
  const description = demo
    ? e(
        '이 결과는 예시 데이터로 만든 화면 시연용이며 실제 이력서와 공고를 평가하지 않습니다. 실제 백엔드 평가 결과는 계정으로 로그인한 뒤 확인할 수 있습니다.',
      )
    : '내 이력서와 공고를 함께 살펴본 분석 결과가 준비되어 있어요.<br />로그인하거나 회원가입하면 결과를 확인할 수 있습니다.';
  const accountCopy = demo
    ? '로그인 후 Markdown 또는 텍스트 이력서를 계정에 저장할 수 있습니다. 시연용 결과는 실제 평가에 포함되지 않습니다.'
    : '로그인하면 이번 이력서와 보고서가 계정의 현재 작업 내용으로 연결됩니다. 기존 작업 내용은 이번 분석으로 바뀝니다.';
  const retentionCopy = demo
    ? '체험 데이터는 이 브라우저 탭의 임시 저장소에만 보관되며 30분 동안 유효합니다.'
    : '로그인·회원가입 없이 임시 보관 시간이 지나면 첨부한 이력서와 분석 결과가 자동 삭제됩니다.';
  return `
    <section class="report-gate" data-report-gate>
      <div class="report-gate__skeleton" aria-hidden="true" inert>
        <div class="report-gate__skeleton-heading"></div>
        <div class="report-gate__skeleton-line"></div>
        <div class="report-gate__skeleton-columns">
          <div class="report-gate__skeleton-block"></div>
          <div class="report-gate__skeleton-copy">
            <span></span><span></span><span></span><span></span>
          </div>
        </div>
        <div class="report-gate__skeleton-rule"></div>
        <div class="report-gate__skeleton-copy">
          <span></span><span></span><span></span><span></span>
        </div>
      </div>
      <div class="report-gate__shade">
        <div class="report-gate__dialog" role="dialog" aria-modal="true"
          aria-labelledby="report-gate-title" aria-describedby="report-gate-description report-gate-retention" tabindex="-1">
          <div class="report-gate__lock">${icon('lock', 28)}</div>
          <h1 id="report-gate-title">${e(title)}</h1>
          <p id="report-gate-description" class="report-gate__description">${description}</p>
          <p class="report-gate__duration">${e(accountCopy)}</p>
          <p id="report-gate-retention" class="report-gate__retention">${e(retentionCopy)}</p>
          <p class="report-gate__duration">임시 보관 시간은 이력서를 첨부한 시점부터 30분입니다.</p>
          ${expiryMarkup(expires_at)}
          <p id="report-gate-error" class="report-gate__error" role="alert" hidden></p>
          <div class="report-gate__actions">
            <button type="button" class="button primary" data-report-gate-login>로그인하고 결과 보기</button>
            <button type="button" class="button secondary" data-report-gate-signup>회원가입하고 결과 보기</button>
          </div>
          <button type="button" class="report-gate__discard" data-report-gate-discard>이력서와 결과 파기하기</button>
        </div>
      </div>
    </section>`;
}

/** Keep the report gate modal until routing or an explicit discard removes it. */
export function bindReportGate({ onLogin, onSignup, onDiscard, root = document } = {}) {
  const gate = root.querySelector('[data-report-gate]');
  if (!gate) return () => {};
  const doc = gate.ownerDocument;
  const dialog = gate.querySelector('[role="dialog"]');
  const login = gate.querySelector('[data-report-gate-login]');
  const signup = gate.querySelector('[data-report-gate-signup]');
  const discard = gate.querySelector('[data-report-gate-discard]');
  const errorMessage = gate.querySelector('#report-gate-error');
  const previousFocus = doc.activeElement;
  const previousOverflow = doc.body.style.overflow;
  const background = [];

  // Hide siblings at every level, so the surrounding shell is inaccessible too.
  for (let branch = gate; branch.parentElement; branch = branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch) continue;
      background.push({
        element: sibling,
        inert: sibling.getAttribute('inert'),
        hidden: sibling.getAttribute('aria-hidden'),
      });
      sibling.setAttribute('inert', '');
      sibling.setAttribute('aria-hidden', 'true');
    }
    if (branch.parentElement === doc.body) break;
  }
  doc.body.style.overflow = 'hidden';

  const focusDialog = () => dialog.focus({ preventScroll: true });
  const keepFocus = (event) => {
    if (!dialog.contains(event.target)) focusDialog();
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Escape offers a way out without destroying the user's work implicitly.
      (discard.disabled ? dialog : discard).focus({ preventScroll: true });
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = [login, signup, discard].filter((button) => !button.disabled);
    const first = buttons[0];
    const last = buttons.at(-1);
    if (!first) {
      event.preventDefault();
      focusDialog();
    } else if (
      event.shiftKey &&
      (doc.activeElement === first || !buttons.includes(doc.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (doc.activeElement === last || !buttons.includes(doc.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  };
  let busy = false;
  const actions = [
    [login, onLogin],
    [signup, onSignup],
    [discard, onDiscard],
  ];
  const listeners = actions.map(([button, callback]) => {
    const listener = async () => {
      if (busy) return;
      busy = true;
      errorMessage.hidden = true;
      errorMessage.textContent = '';
      const disabled = actions.map(([control]) => control.disabled);
      actions.forEach(([control]) => {
        control.disabled = true;
      });
      dialog.setAttribute('aria-busy', 'true');
      try {
        await callback?.();
      } catch (error) {
        errorMessage.textContent =
          error?.message || '요청을 처리하지 못했어요. 다시 시도해 주세요.';
        errorMessage.hidden = false;
      } finally {
        actions.forEach(([control], index) => {
          control.disabled = disabled[index];
        });
        dialog.removeAttribute('aria-busy');
        busy = false;
      }
    };
    button.addEventListener('click', listener);
    return [button, listener];
  });
  const capture = { capture: true };
  doc.addEventListener('keydown', onKeydown, capture);
  doc.addEventListener('focusin', keepFocus, capture);
  focusDialog();

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    doc.removeEventListener('keydown', onKeydown, capture);
    doc.removeEventListener('focusin', keepFocus, capture);
    listeners.forEach(([button, listener]) => button.removeEventListener('click', listener));
    background.forEach(({ element, inert, hidden }) => {
      if (inert === null) element.removeAttribute('inert');
      else element.setAttribute('inert', inert);
      if (hidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', hidden);
    });
    doc.body.style.overflow = previousOverflow;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
}
