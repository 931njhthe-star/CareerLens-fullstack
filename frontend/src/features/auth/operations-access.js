import { getSession } from '../../shared/api/client.js';

export const isOperationsMember = (session) => Boolean(
  session?.user && session.user.demo !== true &&
  typeof session.user.id === 'string' && session.user.id.trim(),
);

/** Verify membership before importing or mounting any operational data view. */
export async function mountMemberFlow(root, {
  readSession = getSession,
  loadViewer = () => import('../activity-flow/viewer.js'),
  browser = globalThis.window,
} = {}) {
  let dispose;
  let generation = 0;
  let stopped = false;
  let verifying = false;
  let timer;
  let retryTimer;
  let retryCount = 0;
  let locked = false;
  const retryDelays = [1000, 3000, 7000];
  const clearRetry = () => {
    if (retryTimer !== undefined) browser?.clearTimeout?.(retryTimer);
    retryTimer = undefined;
  };
  const stopWatching = () => {
    if (timer !== undefined) browser?.clearInterval?.(timer);
    timer = undefined;
    browser?.removeEventListener?.('focus', verify);
    browser?.removeEventListener?.('pageshow', verify);
  };
  const lock = () => {
    generation += 1;
    locked = true;
    clearRetry();
    stopWatching();
    dispose?.();
    dispose = undefined;
    root.innerHTML = '<main id="main" class="loading-screen"><h1>로그인 후 이용할 수 있습니다.</h1><p>대시보드와 이용 흐름은 가입한 모든 회원이 이용할 수 있습니다. 관리자 권한은 필요하지 않습니다.</p><a class="button primary" href="/#/email">로그인</a><a class="button secondary" href="/#/intro">홈으로 돌아가기</a></main>';
  };
  const startWatching = () => {
    if (timer !== undefined) return;
    browser?.addEventListener?.('focus', verify);
    browser?.addEventListener?.('pageshow', verify);
    timer = browser?.setInterval?.(verify, 60000);
  };
  const reconnect = () => {
    stopWatching();
    clearRetry();
    // Membership is currently unknown. Hide the old view until a fresh /me
    // check succeeds, but do not misrepresent a server restart as a logout.
    dispose?.();
    dispose = undefined;
    const willRetry = retryCount < retryDelays.length && typeof browser?.setTimeout === 'function';
    root.innerHTML = `<main id="main" class="loading-screen"><h1>이용 흐름 연결을 확인하지 못했습니다.</h1><p>${willRetry ? '잠시 후 다시 연결합니다.' : '연결 상태를 확인한 뒤 다시 시도해 주세요.'} 로그인 상태가 확인되면 이용 흐름을 다시 표시합니다.</p><button type="button" class="button primary" data-operations-retry>다시 연결</button><a class="button secondary" href="/#/intro">홈으로 돌아가기</a></main>`;
    if (willRetry) retryTimer = browser.setTimeout(() => {
      retryTimer = undefined;
      // A background observer must finish its bounded recovery rather than
      // consume the only retry while regular visibility checks are suspended.
      return verify(true);
    }, retryDelays[retryCount++]);
  };
  async function verify(force = false) {
    if (stopped || locked || verifying || (force !== true && browser?.document?.hidden)) return;
    const current = generation;
    verifying = true;
    try {
      const session = await readSession();
      if (stopped || current !== generation) return;
      if (!isOperationsMember(session)) { lock(); return; }
      if (!dispose) {
        const { mountFlowViewer } = await loadViewer();
        if (stopped || current !== generation) return;
        dispose = mountFlowViewer(root, { central: false, paired: true, onUnauthorized: lock });
      }
      clearRetry();
      retryCount = 0;
      startWatching();
    } catch (error) {
      if (!stopped && current === generation && error?.name !== 'AbortError') {
        if (error?.status === 401 || error?.status === 403) lock();
        else reconnect();
      }
    } finally { verifying = false; }
  }
  function manualRetry(event) {
    if (!event.target?.closest?.('[data-operations-retry]') || stopped || locked || verifying) return;
    clearRetry();
    retryCount = 0;
    void verify();
  }
  root.addEventListener?.('click', manualRetry);
  ++generation;
  root.innerHTML = '<main id="main" class="loading-screen" role="status">로그인 상태를 확인하는 중…</main>';
  await verify(true);
  return () => {
    stopped = true; generation += 1; stopWatching(); clearRetry(); dispose?.();
    root.removeEventListener?.('click', manualRetry);
  };
}
