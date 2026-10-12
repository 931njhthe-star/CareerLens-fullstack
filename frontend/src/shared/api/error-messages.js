// Only text owned by this application may become an error shown to a user.
// Do not interpolate service messages, response bodies, exception text or error codes.
const MESSAGES = Object.freeze({
  request_failed: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  network_error: '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
  invalid_request: '입력한 내용을 확인한 뒤 다시 시도해 주세요.',
  unauthorized: '로그인이 필요하거나 로그인 시간이 만료되었습니다. 다시 로그인해 주세요.',
  forbidden: '이 요청을 처리할 권한이 없습니다. 로그인한 계정을 확인해 주세요.',
  not_found: '요청한 정보를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 선택해 주세요.',
  request_timeout: '처리가 지연되고 있습니다. 잠시 후 상태를 확인하고 다시 시도해 주세요.',
  conflict: '현재 상태에서는 요청을 완료할 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
  expired: '이용 시간이 만료되었습니다. 필요한 내용을 다시 준비해 주세요.',
  file_too_large: '파일은 10MB 이하로 선택해 주세요.',
  unsupported_file: '지원하는 파일 형식을 확인한 뒤 다시 선택해 주세요.',
  rate_limited: '요청이 많아 잠시 기다려야 합니다. 잠시 후 다시 시도해 주세요.',
  service_unavailable: '서비스를 잠시 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  feature_unavailable: '현재 이 기능을 이용할 수 없습니다. 다른 기능을 이용해 주세요.',
  invalid_response: '처리 결과를 확인하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
  auth_failed: '인증을 완료하지 못했습니다. 입력한 정보를 확인하거나 잠시 후 다시 시도해 주세요.',
  auth_callback_invalid: '인증을 완료하지 못했습니다. 다시 로그인해 주세요.',
  login_required: '이 기능을 이용하려면 로그인해 주세요.',
  password_reset_unavailable: '현재 비밀번호 재설정을 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  file_required: '이력서 파일을 선택해 주세요.',
  invalid_resume: '이력서 파일을 읽지 못했습니다. 내용을 확인하거나 본문 붙여넣기를 이용해 주세요.',
  resume_invalid: '이력서 본문을 확인한 뒤 다시 저장해 주세요.',
  resume_required: '이력서를 먼저 저장한 뒤 다시 시도해 주세요.',
  resume_text_empty: '이력서에서 본문을 찾지 못했습니다. 내용이 있는 파일을 선택해 주세요.',
  backend_posting_required: '이 공고로는 모의지원을 진행할 수 없습니다. 다른 공고를 선택해 주세요.',
  evaluation_failed: '모의지원을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  evaluation_cancelled: '모의지원이 취소되었습니다. 준비한 내용을 확인한 뒤 다시 시작해 주세요.',
  final_report_missing: '보고서를 아직 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.',
  final_report_empty: '보고서를 불러오지 못했습니다. 잠시 후 다시 불러와 주세요.',
  report_unavailable: '이 보고서를 현재 불러올 수 없습니다. 새로운 모의지원을 진행해 주세요.',
  saved_report_missing: '저장한 보고서를 찾을 수 없습니다. 보고서 목록을 새로고침해 주세요.',
  saved_report_incomplete: '아직 완료된 보고서가 없습니다. 잠시 후 다시 확인해 주세요.',
  saved_report_empty: '보고서를 불러오지 못했습니다. 잠시 후 다시 불러와 주세요.',
  guest_missing: '임시 이력서가 만료되었거나 없습니다. 이력서를 다시 첨부해 주세요.',
  guest_expired: '임시 이력서가 만료되었거나 없습니다. 이력서를 다시 첨부해 주세요.',
  career_markdown_unavailable: '채용공고를 불러오지 못했습니다. 잠시 후 다시 불러와 주세요.',
  preparation_unavailable: '사전 분석은 현재 이용할 수 없습니다. 채용공고를 선택해 모의지원을 진행해 주세요.',
});

const CODE_ALIASES = Object.freeze({
  backend_unconfigured: 'service_unavailable',
  backend_unavailable: 'service_unavailable',
  backend_feature_unavailable: 'feature_unavailable',
  missing_access_token: 'auth_failed',
  profile_invalid: 'auth_failed',
  report_offset_invalid: 'invalid_response',
  report_id_invalid: 'not_found',
  report_list_invalid: 'invalid_response',
  report_result_invalid: 'invalid_response',
  report_run_invalid: 'invalid_response',
  jobs_invalid: 'invalid_response',
  job_invalid: 'invalid_response',
});

// Legacy browser validators throw ordinary Error objects. Match entire literals,
// never prefixes or substrings that could admit appended private diagnostics.
const LOCAL_MESSAGES = new Set([
  ...Object.values(MESSAGES),
  '이력서 .md 파일을 먼저 선택해 주세요.',
  'Markdown(.md) 파일만 첨부할 수 있어요. 파일 내용을 Markdown 형식으로 저장해 주세요.',
  '파일 정보를 읽지 못했습니다. 파일을 다시 선택해 주세요.',
  '빈 파일은 첨부할 수 없어요. 이력서 본문을 입력해 주세요.',
  '파일을 읽지 못했습니다. 파일이 열리는지 확인한 뒤 다시 선택해 주세요.',
  'UTF-8로 저장된 .md 파일을 선택해 주세요. 편집기에서 인코딩을 UTF-8로 저장할 수 있어요.',
  '텍스트로 작성한 Markdown(.md) 파일을 선택해 주세요. PDF나 문서 파일의 확장자만 바꾸면 불러올 수 없어요.',
  '이력서 본문이 비어 있어요. 내용을 입력한 .md 파일을 선택해 주세요.',
  '분석할 이력서 파일을 먼저 선택해 주세요.',
  '이력서를 40자 이상 입력해 주세요.',
  '이력서 본문을 입력해 주세요.',
  '시연용 계정은 Markdown 또는 텍스트 파일만 지원합니다.',
]);

export function safeErrorStatus(status) {
  return Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0;
}

function statusCode(status) {
  if (status === 400 || status === 422) return 'invalid_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 408 || status === 504) return 'request_timeout';
  if (status === 409) return 'conflict';
  if (status === 410) return 'expired';
  if (status === 413) return 'file_too_large';
  if (status === 415) return 'unsupported_file';
  if (status === 429) return 'rate_limited';
  if (status === 501) return 'feature_unavailable';
  if (status >= 500) return 'service_unavailable';
  return 'request_failed';
}

export function safeErrorCode(code, status) {
  return typeof code === 'string' && (Object.hasOwn(MESSAGES, code) || Object.hasOwn(CODE_ALIASES, code))
    ? code
    : statusCode(safeErrorStatus(status));
}

export function publicErrorMessage(error, { path = '' } = {}) {
  const status = safeErrorStatus(error?.status);
  // Use the same response for unknown accounts, wrong credentials and duplicate
  // signup attempts. Neither provider wording nor account existence is shown.
  if (/^\/auth\/(?:login|signup|register|forgot-password|reset-password)(?:[/?]|$)/.test(path) &&
      status >= 400 && status < 500 && status !== 429)
    return MESSAGES.auth_failed;
  if (typeof error?.message === 'string' && LOCAL_MESSAGES.has(error.message)) return error.message;
  const code = safeErrorCode(error?.code, status);
  // Older adapter validations sometimes use its feature-unavailable default code.
  if (code === 'backend_feature_unavailable' && status !== 501) return MESSAGES[statusCode(status)];
  return MESSAGES[CODE_ALIASES[code] || code];
}
