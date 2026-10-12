import { api, getSession, setSession, startDemoSession } from '../../shared/api/client.js';
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
    ${renderDemoLoginButton()}
    <p class="auth-switch">
      처음 방문하셨나요?
      <a href="#/signup">이메일로 회원가입</a>
    </p>
  `;
}

function renderDemoLoginButton() {
  return `
    <div class="auth-demo-login">
      <p>백엔드 인증 없이 화면을 체험할 수 있습니다. 입력·결과는 현재 탭에만 저장됩니다.</p>
      <button class="button secondary" type="button" data-demo-login>
        시연용 계정으로 로그인
      </button>
    </div>
  `;
}

function renderCredentialsForm(page) {
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
        page === 'email'
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
    ${page === 'email' ? renderDemoLoginButton() : ''}
    <a
      class="auth-back"
      href="#/login">
      다른 방법으로 계속하기
    </a>
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

function renderAuthForm(page, session) {
  switch (page) {
    case 'login':
      return renderSocialLogin(session);
    case 'email':
    case 'signup':
      return renderCredentialsForm(page);
    case 'forgot':
      return renderForgotPassword(session);
    default:
      return renderResetPassword(page);
  }
}

export function renderAuth(page, session, draft = {}) {
  const [title, description] = screens[page] || screens.login;
  const form = renderAuthForm(page, session);
  return `
    <div class="auth-page">
      <header class="auth-topbar">
        <a
          class="brand"
          href="#/intro">
          <span class="brand-symbol">${icon('lens', 23)}</span>
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
            <h1 id="auth-title">${title}</h1>
            <p class="auth-description">${description}</p>
            <div
              id="auth-notices"
              aria-live="polite"></div>
            ${form}
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

export function bindAuth({ onSession, resetToken, navigate }) {
  document.querySelector?.('[data-demo-login]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      startDemoSession();
      const session = await getSession();
      setSession(session);
      await onSession(session);
    } catch (error) {
      button.disabled = false;
      notice(error.message, 'error', document.getElementById('auth-notices'));
    }
  });
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
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const action = form.dataset.action;
    const body = Object.fromEntries(new FormData(form));
    if (action === 'reset-password') body.token = resetToken;
    await pending(form, '처리하는 중…', async () => {
      try {
        const result = await api(`/auth/${action}`, { method: 'POST', body });
        if (['login', 'register'].includes(action)) {
          setSession(result);
          await onSession(await getSession());
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
            result.message || '입력하신 이메일이 가입되어 있다면 재설정 안내가 준비됩니다.',
            'success',
            document.getElementById('auth-notices'),
          );
        }
      } catch (error) {
        notice(error.message, 'error', document.getElementById('auth-notices'));
      }
    });
  });
}
