const EXPIRED_MESSAGE =
  '이메일 인증 링크가 만료되었거나 이미 사용되었습니다. 먼저 가입한 이메일로 로그인을 시도해 주세요. 인증이 완료되지 않았다면 가장 최근 인증 메일을 확인하거나 서비스 담당자에게 새 인증 메일을 요청해 주세요.';

/** Supabase uses an auth fragment, while application routes start with #/. */
export function parseAuthCallback(hash = '') {
  if (!hash || hash.startsWith('#/')) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const recognized = ['error', 'error_code', 'access_token', 'refresh_token'].some((key) =>
    params.has(key),
  );
  if (!recognized) return null;
  if (params.has('error') || params.has('error_code')) {
    return {
      kind: 'error',
      message:
        params.get('error_code') === 'otp_expired'
          ? EXPIRED_MESSAGE
          : '이메일 인증을 완료하지 못했습니다. 먼저 가입한 이메일로 로그인해 보세요. 인증이 완료되지 않았다면 가장 최근 인증 메일을 확인하거나 서비스 담당자에게 문의해 주세요.',
    };
  }
  if (params.get('type') === 'recovery') {
    return {
      kind: 'error',
      message:
        '현재 연결된 서비스는 이 비밀번호 재설정 링크를 처리하지 못합니다. 서비스 관리자에게 비밀번호 재설정을 요청해 주세요.',
    };
  }
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (
    !accessToken ||
    !refreshToken ||
    (params.has('token_type') && params.get('token_type') !== 'bearer')
  ) {
    return {
      kind: 'error',
      message: '이메일 인증 정보가 완전하지 않습니다. 이메일로 다시 로그인해 주세요.',
    };
  }
  return { kind: 'session', accessToken, refreshToken };
}

/** Remove credentials/errors from the address immediately, before any awaited work. */
export function consumeAuthCallback(location, history) {
  const callback = parseAuthCallback(location.hash);
  if (callback) history.replaceState({}, '', `${location.pathname}${location.search}#/email`);
  return callback;
}
