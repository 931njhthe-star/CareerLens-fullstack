import { api, getSession, setSession } from '../../shared/api/client.js';
import { publicErrorMessage } from '../../shared/api/error-messages.js';
import { beginFlowEvent, finishFlowEvent, recordFlowEvent } from '../activity-flow/events.js';
import {
  escapeHtml as e,
  icon,
  notice,
  pending,
  renderPrimaryNav,
} from '../../shared/components/ui.js';

const screens = {
  login: [
    '커리어의 다음 장을 열어보세요.',
    '내 이력서와 희망 직무를 살펴보고, 지원 전 준비를 시작하세요.',
  ],
  email: ['이메일로 로그인', '다시 만나 반가워요. 이어서 준비해 볼까요?'],
  signup: ['나만의 워크스페이스 만들기', '이메일 계정으로 이력서와 분석 결과를 관리하세요.'],
  forgot: ['비밀번호를 잊으셨나요?', '가입한 이메일을 입력하면 재설정 안내를 보내드려요.'],
  reset: ['새 비밀번호 설정', '새로 사용할 비밀번호를 입력해 주세요.'],
};

function renderEmailField() {
  return `
    <div class="field">
      <label for="auth-email">이메일</label>
      <input
        id="auth-email"
        type="email"
        name="email"
        autocomplete="email"
        maxlength="254"
        required
        placeholder="name@example.com" />
    </div>
  `;
}

function renderPasswordField(page) {
  return `
    <div class="field">
      <label for="auth-password">비밀번호</label>
      <div class="password-wrap">
        <input
          id="auth-password"
          name="password"
          type="password"
          autocomplete="${page === 'email' ? 'current-password' : 'new-password'}"
          ${page === 'email' ? '' : 'minlength="8" aria-describedby="password-hint"'}
          maxlength="128"
          required />
        <button
          type="button"
          id="toggle-password"
          aria-controls="auth-password"
          aria-pressed="false">
          표시
        </button>
      </div>
      ${
        page === 'email'
          ? ''
          : `
            <p
              class="input-hint"
              id="password-hint">
              8자 이상, 128자 이하로 입력해 주세요.
            </p>
          `
      }
    </div>
  `;
}

function renderProviderButton(provider) {
  return `
    <button
      class="button provider"
      type="button"
      data-provider="${e(provider.id)}"
      ${provider.enabled ? '' : 'disabled aria-describedby="provider-hint"'}>
      <span
        class="provider-mark ${e(provider.id)}"
        aria-hidden="true">
        ${{ google: 'G', github: 'GH', linkedin: 'in' }[provider.id]}
      </span>
      ${e(provider.name)}로 계속하기${
        provider.enabled
          ? ''
          : `
            <small>설정 필요</small>
          `
      }
    </button>
  `;
}

function renderSocialLogin(session) {
  const providers = ['google', 'github', 'linkedin'].map(
    (id) =>
      session.providers?.find((p) => p.id === id) || {
        id,
        name: { google: 'Google', github: 'GitHub', linkedin: 'LinkedIn' }[id],
        enabled: false,
      },
  );
  return `
    <div class="social-buttons">${providers.map(renderProviderButton).join('')}</div>
    <p
      id="provider-hint"
      class="provider-hint">
      소셜 로그인은 서비스 키를 연결하면 사용할 수 있어요.
    </p>
    <div class="auth-divider"><span>또는</span></div>
    <a
      class="button auth-primary"
      href="#/email">
      ${icon('mail', 18)} 이메일로 계속하기
    </a>
    <p class="auth-switch">
      처음 방문하셨나요?
      <a href="#/signup">이메일로 회원가입</a>
    </p>
  `;
}

function renderCredentialsForm(page, session, showAlternativeMethods = true) {
  const emailField = renderEmailField();
  const passwordField = renderPasswordField(page);
  return `
    <form
      id="auth-form"
      data-action="${page === 'email' ? 'login' : 'register'}">
      ${
        page === 'signup'
          ? `
            <div class="field">
              <label for="auth-name">이름</label>
              <input
                id="auth-name"
                name="name"
                autocomplete="name"
                maxlength="80"
                required
                placeholder="이름을 입력해 주세요" />
            </div>
          `
          : ''
      }
      ${emailField}
      ${passwordField}
      ${
        page === 'email' && session.capabilities?.password_reset !== false
          ? `
            <div class="forgot-link">
              <a href="#/forgot">비밀번호를 잊으셨나요?</a>
            </div>
          `
          : ''
      }
      <button
        type="submit"
        class="button auth-primary">
        ${page === 'email' ? '로그인' : '회원가입'}
      </button>
    </form>
    <p class="auth-switch">
      ${
        page === 'email'
          ? '계정이 없으신가요? <a href="#/signup">이메일로 회원가입</a>'
          : '이미 계정이 있으신가요? <a href="#/email">로그인</a>'
      }
    </p>
    ${showAlternativeMethods ? `<a
      class="auth-back"
      href="#/login">
      다른 방법으로 계속하기
    </a>` : ''}
  `;
}

function renderForgotPassword(session) {
  const emailField = renderEmailField();
  return `
    <form
      id="auth-form"
      data-action="forgot-password">
      ${emailField}
      <button
        type="submit"
        class="button auth-primary">
        재설정 안내 받기
      </button>
    </form>
    ${
      session.mail_mode === 'local'
        ? `
          <p class="local-mail-hint">
            개발용 메일 모드입니다. 재설정 안내는 연결된 백엔드 서버의 메일 저장 위치에서 확인해
            주세요.
          </p>
        `
        : ''
    }
    <a
      class="auth-back"
      href="#/email">
      로그인으로 돌아가기
    </a>
  `;
}

function renderResetPassword(page) {
  const passwordField = renderPasswordField(page);
  return `
    <form
      id="auth-form"
      data-action="reset-password">
      ${passwordField}
      <button
        type="submit"
        class="button auth-primary">
        비밀번호 변경
      </button>
    </form>
    <a
      class="auth-back"
      href="#/email">
      로그인으로 돌아가기
    </a>
  `;
}

function renderAuthForm(page, session, showAlternativeMethods = true) {
  if (['forgot', 'reset'].includes(page) && session.capabilities?.password_reset === false)
    return '<p>현재 서비스에서는 비밀번호 재설정을 지원하지 않습니다. 계정 관리자에게 문의해 주세요.</p><a class="button" href="#/email">로그인으로 돌아가기</a>';
  switch (page) {
    case 'login':
      return session.backend_adapter
        ? renderCredentialsForm('email', session, showAlternativeMethods)
        : renderSocialLogin(session);
    case 'email':
    case 'signup':
      return renderCredentialsForm(page, session, showAlternativeMethods);
    case 'forgot':
      return renderForgotPassword(session);
    default:
      return renderResetPassword(page);
  }
}

/** The same credential controls can also live inside the protected report gate. */
export function renderAuthPanel(page, session = {}, { embedded = true } = {}) {
  const [title, description] = screens[page] || screens.login;
  return `
    <h1 id="auth-title">${title}</h1>
    <p class="auth-description">${description}</p>
    <div id="auth-notices" aria-live="polite"></div>
    ${renderAuthForm(page, session, !(embedded && session.backend_adapter))}
    ${page === 'signup' ? `
      <div id="auth-confirmation" class="auth-confirmation" hidden>
        <p>가장 최근에 받은 인증 메일의 링크를 한 번만 열어 주세요. 인증 후 이 창으로 돌아와 로그인하면 첨부한 이력서를 이어서 사용할 수 있어요.</p>
        <p>메일이 없거나 링크가 만료되었다면 서비스 담당자에게 새 인증 메일을 요청해 주세요.</p>
        <a class="button auth-primary" href="#/email">이메일로 로그인</a>
      </div>` : ''}
  `;
}

export function renderAuth(page, session, draft = {}) {
  return `
    <div class="auth-page">
      <header class="auth-topbar">
        <a
          class="brand"
          href="#/intro"
          aria-label="CareerLens 홈">
          <img class="brand-symbol" src="/public/brand-eye.svg" width="34" height="34" alt="" aria-hidden="true">
          Career<b>Lens</b>
        </a>
        ${renderPrimaryNav(page, draft)}
      </header>
      <main
        id="main"
        class="auth-main"
        tabindex="-1">
        <section
          class="auth-card"
          aria-labelledby="auth-title">
          <div class="auth-form-panel">
            <span class="eyebrow">YOUR NEXT CHAPTER</span>
            ${renderAuthPanel(page, session, { embedded: false })}
          </div>
          <aside class="auth-preview">
            <span class="preview-label">가능성을 발견하는 순간</span>
            <h2>
              경험은 더 선명하게,
              <br />
              지원은 더 자신 있게.
            </h2>
            <p>나의 경험과 연결되는 기회를 찾아보세요.</p>
            <div
              class="fictional-jobs"
              aria-label="가상 채용공고 화면 예시">
              <div class="fictional-job">
                <span class="job-mark">S</span>
                <div>
                  <strong>Python 백엔드 개발자</strong>
                  <p>샘플테크 · 서울</p>
                  <span>내 경험과 연결되는 공고</span>
                </div>
              </div>
              <div class="fictional-job">
                <span class="job-mark peach">O</span>
                <div>
                  <strong>데이터 분석가</strong>
                  <p>오빗스튜디오 · 원격</p>
                  <span>새로운 가능성 탐색하기</span>
                </div>
              </div>
              <div class="fictional-job">
                <span class="job-mark mint">N</span>
                <div>
                  <strong>프론트엔드 개발자</strong>
                  <p>넥스트랩 · 경기</p>
                  <span>지원 전 준비도 점검</span>
                </div>
              </div>
            </div>
            <span class="preview-caption">화면 속 회사와 채용공고는 가상 예시입니다.</span>
          </aside>
        </section>
        <p class="auth-education">
          CareerLens 교육용 프로젝트입니다. 리플레쉬와 제휴한 서비스가 아닙니다.
        </p>
      </main>
    </div>
  `;
}

export function bindAuth({ onSession, resetToken, navigate, demo = false }) {
  const source = demo ? 'demo' : 'observed';
  document.querySelectorAll('[data-provider]').forEach((button) =>
    button.addEventListener('click', () => {
      location.assign(`/api/v1/auth/oauth/${encodeURIComponent(button.dataset.provider)}`);
    }),
  );
  document.getElementById('toggle-password')?.addEventListener('click', (event) => {
    const input = document.getElementById('auth-password');
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    event.currentTarget.setAttribute('aria-pressed', String(visible));
    event.currentTarget.textContent = visible ? '숨김' : '표시';
  });
  const form = document.getElementById('auth-form');
  form?.addEventListener('invalid', () => {
    recordFlowEvent('input_check', { state: 'blocked', source });
  }, true);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const action = form.dataset.action;
    const body = Object.fromEntries(new FormData(form));
    if (action === 'reset-password') body.token = resetToken;
    await pending(form, '처리하는 중…', async () => {
      recordFlowEvent('input_check', { source });
      const signupObservation = action === 'register'
        ? beginFlowEvent('signup', { source }) : null;
      // Confirmed login is emitted by the app's flowSession after getSession.
      // This start marker has no inflight handle, so a navigation cannot leak one.
      if (action === 'login') recordFlowEvent('auth', { state: 'pending', source });
      let authenticated = false;
      let deliveryObservation;
      try {
        const result = await api(`/auth/${action}`, { method: 'POST', body });
        if (
          action === 'register' &&
          (result.email_confirmation_required === true ||
            (Object.hasOwn(result, 'access_token') && !result.access_token))
        ) {
          finishFlowEvent(signupObservation, { state: 'waiting' });
          recordFlowEvent('notice', { state: 'waiting', source });
          notice(
            '이메일 인증을 기다리고 있습니다. 이미 인증한 계정이면 바로 로그인해 주세요.',
            'info',
            document.getElementById('auth-notices'),
          );
          const confirmation = document.getElementById('auth-confirmation');
          if (confirmation) confirmation.hidden = false;
          return;
        }
        if (action === 'register') finishFlowEvent(signupObservation);
        if (['login', 'register'].includes(action)) {
          // Measure only a stored guest-result unlock, starting at successful
          // authentication response and including session verification and claim.
          if (document.querySelector?.('[data-report-gate]:not([data-report-preview])'))
            deliveryObservation = beginFlowEvent('result_delivery', { source, execution: 'guest' });
          setSession(result);
          const nextSession = await getSession();
          authenticated = Boolean(nextSession.user);
          await onSession(nextSession, { deliveryObservation });
        } else if (action === 'reset-password') {
          history.replaceState({}, '', location.pathname + location.hash);
          await onSession(await getSession());
          setTimeout(
            () =>
              notice(
                '비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요.',
                'success',
                document.getElementById('auth-notices'),
              ),
            0,
          );
        } else {
          notice(
            '입력하신 이메일이 가입되어 있다면 재설정 안내가 준비됩니다.',
            'success',
            document.getElementById('auth-notices'),
          );
        }
      } catch (error) {
        finishFlowEvent(deliveryObservation, { state: 'failed' });
        finishFlowEvent(signupObservation, { state: 'failed' });
        if (authenticated && ['login', 'register'].includes(action)) {
          recordFlowEvent('notice', { state: 'degraded', source });
          navigate?.('resume');
          setTimeout(
            () =>
              notice(
                '로그인되었습니다. 일부 계정 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.',
                'info',
              ),
            0,
          );
          return;
        }
        if (action === 'login' && !authenticated)
          recordFlowEvent('auth', { state: 'failed', source });
        recordFlowEvent('notice', { state: 'failed', source });
        notice(
          publicErrorMessage(error, { path: `/auth/${action}` }) +
            (action === 'register' ? ' 이미 인증한 계정이라면 이메일로 로그인해 주세요.' : ''),
          'error',
          document.getElementById('auth-notices'),
        );
        if (action === 'register') {
          const confirmation = document.getElementById('auth-confirmation');
          if (confirmation) confirmation.hidden = false;
        }
      }
    });
  });
}
