import { escapeHtml as e, icon } from '../../shared/components/ui.js';
import { publicErrorMessage } from '../../shared/api/error-messages.js';
import { renderAuthPanel } from './auth.js';

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
export function reportGatePage({ expires_at, analysis_pending, preview_ready } = {}, { authPage, session = {} } = {}) {
  const preview = analysis_pending === true || preview_ready === true;
  const auth = ['email', 'login', 'signup', 'forgot', 'reset'].includes(authPage) ? authPage : null;
  return `
    <section class="report-gate" data-report-gate${preview ? ' data-report-preview' : ''}>
      <div class="report-gate__skeleton" aria-hidden="true" inert>
        <article class="report-gate__paper" data-report-frame>
          <div class="report-gate__skeleton-heading"></div>
          <div class="report-gate__skeleton-line"></div>
          <div class="report-gate__skeleton-columns">
            <div class="report-gate__empty-graphic" data-empty-pyramid>
              <svg viewBox="0 0 360 280" focusable="false" aria-hidden="true">
                <path class="report-gate__pyramid-outline" d="M180 30 40 196 302 214Z M180 30 195 135 40 196 M195 135 302 214" />
              </svg>
            </div>
            <div class="report-gate__skeleton-copy">
              <span></span><span></span><span></span><span></span>
            </div>
          </div>
          <div class="report-gate__skeleton-rule"></div>
          <div class="report-gate__skeleton-copy">
            <span></span><span></span><span></span><span></span>
          </div>
        </article>
      </div>
      <div class="report-gate__shade">
        <div class="report-gate__dialog${auth ? ' report-gate__dialog--auth' : ''}" role="dialog" aria-modal="true"
          aria-labelledby="${auth ? 'auth-title' : 'report-gate-title'}" aria-describedby="report-gate-description report-gate-retention" tabindex="-1">
          ${auth ? `<button type="button" class="report-gate__back" data-report-gate-back>${icon('arrow', 16)} 안내로 돌아가기</button>
            <div class="auth-form-panel report-gate__auth-panel">${renderAuthPanel(auth, session)}</div>` : `
            <div class="report-gate__lock">${icon('lock', 28)}</div>
            <h1 id="report-gate-title">${preview ? '로그인하고<br />모의지원 결과를 확인하세요' : '분석이 완료되었어요'}</h1>`}
          <p id="report-gate-description" class="report-gate__description">${preview
            ? '첨부한 이력서와 선택한 공고를 준비해 두었어요. 로그인하거나 회원가입하면 실제 분석을 시작합니다.'
            : '이력서와 공고 분석을 마치고 완성된 보고서를 임시 저장했어요. 로그인·회원가입 후 추가 분석 없이 바로 확인할 수 있습니다.'}</p>
          ${!auth ? `<p class="report-gate__duration">${preview
            ? '뒤의 화면은 보고서 형태를 보여주는 빈 화면입니다. 아직 분석이나 점수 산정은 진행하지 않았습니다.'
            : '로그인하면 이번 이력서와 보고서가 계정의 현재 작업 내용으로 연결됩니다. 기존 작업 내용은 이번 분석으로 바뀝니다.'}</p>` : ''}
          <p id="report-gate-retention" class="report-gate__retention">${preview
            ? '첨부한 자료는 이 브라우저 탭에 임시 보관됩니다. 이력서를 처음 첨부한 뒤 30분이 지나면 삭제됩니다.'
            : '로그인·회원가입 없이 임시 보관 시간이 지나면 첨부한 이력서와 분석 결과가 자동 삭제됩니다.'}</p>
          ${preview ? '' : '<p class="report-gate__duration">임시 보관 시간은 이력서를 첨부한 시점부터 30분입니다.</p>'}
          ${expiryMarkup(expires_at)}
          <p id="report-gate-error" class="report-gate__error" role="alert" hidden></p>
          ${auth ? '' : `<div class="report-gate__actions">
            <button type="button" class="button primary" data-report-gate-login>${preview ? '로그인하고 분석 시작' : '로그인하고 결과 보기'}</button>
            <button type="button" class="button secondary" data-report-gate-signup>${preview ? '회원가입하고 분석 시작' : '회원가입하고 결과 보기'}</button>
          </div>`}
          <button type="button" class="report-gate__discard" data-report-gate-discard>${preview ? '첨부한 자료 삭제하고 나가기' : '이력서와 결과 파기하기'}</button>
        </div>
      </div>
    </section>`;
}

/** Keep the report gate modal until routing or an explicit discard removes it. */
export function bindReportGate({ onLogin, onSignup, onDiscard, onBack, root = document } = {}) {
  const gate = root.querySelector('[data-report-gate]');
  if (!gate) return () => {};
  const doc = gate.ownerDocument;
  const dialog = gate.querySelector('[role="dialog"]');
  const login = gate.querySelector('[data-report-gate-login]');
  const signup = gate.querySelector('[data-report-gate-signup]');
  const discard = gate.querySelector('[data-report-gate-discard]');
  const back = gate.querySelector('[data-report-gate-back]');
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
      // Returning to the gate never discards the prepared input.
      if (back && !back.disabled) back.click();
      else focusDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
      .filter((element) => !element.disabled && element.type !== 'hidden' && element.tabIndex !== -1
        && !element.closest('[hidden], [inert]'));
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
    [back, onBack],
  ].filter(([button]) => button);
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
        errorMessage.textContent = publicErrorMessage(error);
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
