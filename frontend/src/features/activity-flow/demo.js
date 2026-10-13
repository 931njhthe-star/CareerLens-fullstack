// These are fictional case scripts, never service calls or observed server work.
// Preconditions are supplied by each script; no account, file, or report is read.
export const DEMO_GROUPS = Object.freeze([
  { id: 'account', label: '회원가입·계정' },
  { id: 'resume', label: '이력서·저장' },
  { id: 'jobs', label: '직무·채용공고' },
  { id: 'analysis', label: '분석·예외 처리' },
  { id: 'reports', label: '저장 보고서' },
  { id: 'dashboard', label: '운영 대시보드' },
].map(Object.freeze));

// [time, node, state, progress?, duration?, kind?, explicit source node?]
const step = (at, node, state, from) => [at, node, state, null, null, 'action', from];
const request = (at, node, state, duration = null, from) => [at, node, state, null, duration, 'request', from];
const progress = (at, state, value, from) => [at, 'analysis', state, value, null, 'progress', from];

function define(id, group, label, outcome, precondition, description, completeMessage, steps, focusNode = steps[0][1]) {
  return { id, group, label, outcome, precondition, description, completeMessage, focusNode, steps };
}

function analysisStart() {
  return [
    step(0, 'input_check', 'complete'),
    request(350, 'api_evaluation', 'pending'), request(850, 'api_evaluation', 'complete', 500),
    step(1100, 'queue', 'queued'), step(1600, 'queue', 'cleared'),
    step(1800, 'parse_resume', 'running', 'queue'), step(1950, 'parse_job', 'running', 'queue'),
    step(2450, 'parse_resume', 'complete', 'queue'), step(2650, 'parse_job', 'complete', 'queue'),
    progress(2900, 'running', 22, 'parse_resume'), progress(3150, 'running', 32, 'parse_job'),
  ];
}

function analysisSuccess({ partial = false, reportFailure = false } = {}) {
  return [
    ...analysisStart(), progress(3900, 'running', 48), progress(4850, 'running', 71),
    step(5500, 'validation', 'running'), step(6200, 'validation', partial ? 'partial' : 'complete'),
    progress(6500, partial ? 'partial' : 'complete', 100),
    step(6850, 'database', 'running'), step(7450, 'database', 'complete'),
    request(7750, 'api_report', 'pending'),
    request(8270, 'api_report', reportFailure ? 'failed' : 'complete', 520),
    ...(reportFailure
      ? [step(8600, 'notice', 'failed')]
      : [step(8600, 'report', partial ? 'partial' : 'complete'), step(9050, 'archive', 'complete', 'database')]),
  ];
}

function guestAnalysis({ auth = 'login', lockedOnly = false, slow = false, claimFailure = false } = {}) {
  const result = [
    step(0, 'evaluate', 'pending'), step(150, 'input_check', 'complete'),
    request(300, 'api_guest_service', 'pending'), request(500, 'api_guest_service', 'complete', 200),
    request(650, 'api_guest_analysis', 'pending'), request(1000, 'api_guest_analysis', 'complete', 350),
    step(1200, 'queue', 'queued'), step(1500, 'queue', 'cleared'),
    step(1700, 'parse_resume', 'running'), step(2200, 'parse_resume', 'complete'),
    step(2350, 'parse_job', 'running'), step(2850, 'parse_job', 'complete'),
    step(3000, 'indexing', 'running'), step(3450, 'indexing', 'complete'),
    progress(3650, 'running', 35), progress(4300, 'running', 70),
    step(4600, 'validation', 'running'), step(5050, 'validation', 'complete'),
    step(5200, 'scoring', 'running'), step(5500, 'scoring', 'complete'),
    [5650, 'analysis', 'complete', 100, 62_000, 'progress'],
    step(5800, 'guest_store', 'running'), step(6100, 'guest_store', 'complete'),
    step(6300, 'report_lock', 'waiting'), step(6450, 'evaluate', 'waiting'),
  ];
  if (lockedOnly) return result;
  const api = auth === 'signup' ? 'api_signup' : 'api_auth';
  const action = auth === 'signup' ? 'signup' : 'auth';
  result.push(step(6800, action, 'pending'), request(7050, api, 'pending'), request(7650, api, 'complete', 600),
    step(7800, action, 'complete'), step(7950, 'auth', 'member'), step(7950, 'result_delivery', 'pending'),
    step(8050, 'guest_claim', 'pending'), request(8200, 'api_guest_claim', 'pending'));
  const elapsed = slow ? 3400 : 900;
  const end = 7950 + elapsed;
  result.push(request(end - 100, 'api_guest_claim', claimFailure ? 'failed' : 'complete', end - 8300));
  if (claimFailure) result.push(step(end, 'guest_claim', 'failed'), step(end + 50, 'result_delivery', 'failed'), step(end + 100, 'notice', 'failed'));
  else result.push(step(end - 75, 'guest_claim', 'complete'), step(end - 50, 'report_lock', 'complete'),
    step(end, 'report', 'complete'), [end, 'result_delivery', 'complete', null, elapsed, 'action'], step(end + 100, 'evaluate', 'complete'));
  return result;
}

export const DEMO_ACTIONS = [
  // Account creation writes a profile; login and logout only change the session.
  define('signup', 'account', '회원가입 성공', 'success', '가입 가능한 예시 정보와 즉시 로그인 응답을 가정합니다.',
    '입력 확인 → 가입 요청 → 회원 정보 저장 → 로그인', '예시 회원 정보 저장과 가상 로그인이 완료되었습니다.', [
      step(0, 'signup', 'pending'), step(250, 'input_check', 'complete'), request(500, 'api_signup', 'pending'),
      step(850, 'database', 'running'), step(1400, 'database', 'complete'),
      request(1650, 'api_signup', 'complete', 1150, 'database'), step(1850, 'signup', 'complete'),
      step(2050, 'local_data', 'complete'), step(2300, 'auth', 'member'),
    ]),
  define('signup_confirmation', 'account', '회원가입 · 이메일 확인 필요', 'waiting', '회원 정보는 생성되지만 로그인 토큰이 아직 없는 응답을 가정합니다.',
    '가입 요청 → 회원 정보 저장 → 이메일 확인 대기', '예시 회원 정보가 저장되었습니다. 이메일 확인 대기 상태이며 로그인되지는 않았습니다.', [
      step(0, 'signup', 'pending'), step(250, 'input_check', 'complete'), request(500, 'api_signup', 'pending'),
      step(850, 'database', 'running'), step(1400, 'database', 'complete'),
      request(1650, 'api_signup', 'complete', 1150, 'database'), step(1900, 'signup', 'waiting'), step(2200, 'notice', 'waiting'),
    ]),
  define('email_confirmation_success', 'account', '이메일 인증 후 돌아오기', 'success', '계정은 이미 생성됐고 유효한 이메일 인증 링크로 앱에 돌아온 예시입니다.',
    '돌아온 인증 정보 검증 → 세션 보관 → 로그인', '가상 이메일 인증 정보를 확인하고 로그인했습니다. 기존 회원 정보를 다시 생성하거나 저장하지 않았습니다.', [
      step(0, 'auth', 'pending'), request(350, 'api_auth', 'pending'), request(1100, 'api_auth', 'complete', 750),
      step(1450, 'local_data', 'complete'), step(1800, 'auth', 'member'),
    ]),
  define('email_confirmation_failed', 'account', '만료·사용된 인증 링크', 'blocked', '이미 사용했거나 만료된 이메일 인증 링크로 앱에 돌아온 예시입니다.',
    '돌아온 링크의 오류 확인 → 로그인 안내 · 요청 없음', '가상 인증 링크의 오류를 확인해 요청 전에 중단했습니다. 새 세션을 보관하거나 기존 브라우저 세션을 비우지 않았습니다.', [
      step(0, 'auth', 'pending'), step(350, 'input_check', 'failed'),
      step(750, 'auth', 'blocked'), step(1100, 'notice', 'blocked'),
    ]),
  define('signup_invalid', 'account', '회원가입 입력 오류', 'blocked', '이름·이메일 형식·비밀번호 길이 중 가입 입력 조건을 충족하지 않은 예시입니다.',
    '입력 검사에서 중단 · 가입 요청과 저장 없음', '입력 오류 안내까지만 시연했습니다. 회원 정보 저장 단계에는 도달하지 않았습니다.', [
      step(0, 'signup', 'pending'), step(350, 'input_check', 'failed'), step(700, 'signup', 'blocked'), step(1100, 'notice', 'blocked'),
    ]),
  define('signup_failed', 'account', '회원가입 요청 실패', 'failure', '가입 요청이 거절되어 회원 정보를 저장하지 못한 예시입니다.',
    '가입 요청 실패 → 재시도 안내', '가상 가입 요청이 실패했습니다. 저장 완료나 로그인 완료로 표시하지 않습니다.', [
      step(0, 'signup', 'pending'), step(250, 'input_check', 'complete'), request(500, 'api_signup', 'pending'),
      request(1450, 'api_signup', 'failed', 950), step(1750, 'signup', 'failed'), step(2100, 'notice', 'failed'),
    ]),
  define('login', 'account', '로그인 성공', 'success', '올바른 예시 로그인 정보가 준비되어 있다고 가정합니다.',
    '인증 요청 → 브라우저 세션 보관 → 로그인', '가상 로그인이 완료되었습니다. 새 회원 정보를 저장하는 경로는 사용하지 않았습니다.', [
      step(0, 'auth', 'pending'), request(300, 'api_auth', 'pending'),
      request(1050, 'api_auth', 'complete', 750), step(1300, 'local_data', 'complete'), step(1600, 'auth', 'member'),
    ]),
  define('login_failed', 'account', '로그인 실패', 'failure', '예시 인증 정보가 일치하지 않는 응답을 가정합니다.',
    '인증 거절 → 로그인 실패 안내', '가상 로그인이 실패했습니다. 로그인 상태나 회원 정보 저장은 발생하지 않았습니다.', [
      step(0, 'auth', 'pending'), request(300, 'api_auth', 'pending'), request(1100, 'api_auth', 'failed', 800),
      step(1400, 'auth', 'failed'), step(1750, 'notice', 'failed'),
    ]),
  define('logout', 'account', '로그아웃', 'success', '가상 회원 세션이 있는 상태에서 시작합니다.',
    '브라우저 세션 비움 → 비회원으로 전환', '가상 세션을 비웠습니다. 회원 계정이나 저장 보고서를 삭제하는 동작은 아닙니다.', [
      step(0, 'logout', 'pending'), step(450, 'local_data', 'cleared'), step(850, 'session', 'guest'),
      step(1150, 'auth', 'logout'), step(1450, 'logout', 'complete'),
    ]),
  define('session_refresh', 'account', '세션 갱신 성공', 'success', '갱신 가능한 예시 세션이 만료될 시점을 가정합니다.',
    '보고서 요청 인증 만료 → 세션 갱신 → 원래 요청 재시도', '가상 세션을 갱신한 뒤 처음의 보고서 목록 요청을 다시 완료했습니다.', [
      step(0, 'history', 'pending'), request(250, 'api_report', 'pending'), request(850, 'api_report', 'failed', 600),
      step(1100, 'session', 'pending'), request(1400, 'api_session', 'pending'), request(2200, 'api_session', 'complete', 800),
      step(2450, 'local_data', 'complete'), step(2750, 'session', 'member'), request(3000, 'api_report', 'pending'),
      step(3300, 'database_read', 'complete'), request(3700, 'api_report', 'complete', 700, 'database_read'), step(4000, 'history', 'complete'),
    ]),
  define('session_expired', 'account', '세션 갱신 실패', 'failure', '갱신 토큰도 더 이상 사용할 수 없는 예시입니다.',
    '세션 갱신 실패 → 세션 비움 → 다시 로그인 안내', '가상 세션이 만료되었습니다. 다시 로그인해야 하는 경로를 표시합니다.', [
      step(0, 'session', 'pending'), request(300, 'api_session', 'pending'), request(1100, 'api_session', 'failed', 800),
      step(1400, 'local_data', 'cleared'), step(1700, 'session', 'expired'), step(2050, 'notice', 'blocked'),
    ]),

  // Guest preparation stays in browser storage; only member saves reach storage.
  define('resume', 'resume', '회원 이력서 첨부', 'success', '로그인한 회원과 올바른 예시 이력서 파일을 가정합니다.',
    '파일 검사·변환 → 이력서 요청 → 서버 저장', '예시 회원 이력서가 가상 서버 저장까지 완료되었습니다.', [
      step(0, 'resume', 'pending'), step(300, 'input_check', 'complete'), request(550, 'api_convert', 'pending'),
      request(1200, 'api_convert', 'complete', 650), request(1500, 'api_resume', 'pending'),
      step(1800, 'database', 'running'), step(2400, 'database', 'complete'),
      request(2650, 'api_resume', 'complete', 1150, 'database'), step(2950, 'resume', 'complete'),
    ]),
  define('resume_guest', 'resume', '비회원 이력서 첨부', 'success', '로그인하지 않은 상태와 올바른 예시 이력서 파일을 가정합니다.',
    '파일 검사·변환 → 브라우저 임시 보관 · 서버 저장 없음', '예시 이력서가 브라우저 임시 보관으로만 준비되었습니다. 실제 서비스의 임시 보관 기한은 첫 유효 첨부 후 30분입니다.', [
      step(0, 'resume', 'pending'), step(350, 'input_check', 'complete'), request(650, 'api_convert', 'pending'),
      request(1300, 'api_convert', 'complete', 650), step(1600, 'local_data', 'running'),
      step(2100, 'local_data', 'complete'), step(2450, 'resume', 'complete'),
    ]),
  define('resume_edit', 'resume', '회원 이력서 수정·저장', 'success', '회원이 기존 이력서의 내용을 수정한 상태를 가정합니다.',
    '내용 검사 → 새 이력서 버전 저장', '수정한 예시 이력서가 새 버전으로 가상 저장되었습니다.', [
      step(0, 'resume', 'pending'), step(350, 'input_check', 'complete'), request(650, 'api_resume', 'pending'),
      step(1000, 'database', 'running'), step(1650, 'database', 'complete'),
      request(1900, 'api_resume', 'complete', 1250, 'database'), step(2250, 'resume', 'complete'),
    ]),
  define('resume_invalid', 'resume', '이력서 파일·내용 오류', 'blocked', '지원하지 않는 파일 또는 비어 있는 이력서 본문을 가정합니다.',
    '파일·내용 검사에서 중단 · 저장 없음', '첨부·내용 오류 안내까지만 시연했습니다. 서버 요청이나 임시 저장은 발생하지 않았습니다.', [
      step(0, 'resume', 'pending'), step(450, 'input_check', 'failed'), step(800, 'resume', 'blocked'), step(1150, 'notice', 'blocked'),
    ]),
  define('resume_failed', 'resume', '이력서 저장 실패', 'failure', '이력서 파일 변환을 마친 뒤 회원 저장 요청이 실패하는 응답을 가정합니다.',
    '이력서 요청 실패 → 저장 실패 안내', '예시 이력서 저장 요청이 실패했습니다. 저장 완료로 표시하지 않습니다.', [
      step(0, 'resume', 'pending'), step(300, 'input_check', 'complete'), request(600, 'api_resume', 'pending'),
      request(1500, 'api_resume', 'failed', 900), step(1850, 'resume', 'failed'), step(2200, 'notice', 'failed'),
    ]),
  define('resume_conversion_failed', 'resume', '이력서 파일 변환 실패', 'failure', '파일 형식 검사는 통과했지만 내용을 변환하지 못하는 예시입니다.',
    '파일 변환 요청 실패 → 재첨부 안내 · 저장 없음', '예시 파일을 변환하지 못했습니다. 회원 저장과 비회원 임시 보관 단계에 도달하지 않았습니다.', [
      step(0, 'resume', 'pending'), step(350, 'input_check', 'complete'), request(650, 'api_convert', 'pending'),
      request(1450, 'api_convert', 'failed', 800), step(1800, 'resume', 'failed'), step(2150, 'notice', 'failed'),
    ]),
  define('resume_expired', 'resume', '비회원 임시 보관 만료', 'blocked', '예시 비회원 이력서의 30분 임시 보관 기한이 지난 상태를 가정합니다.',
    '보관 기한 만료 → 임시 자료 비움 → 재첨부 안내', '가상 임시 자료의 만료와 재첨부 안내를 표시했습니다. 회원 저장 자료는 삭제하지 않습니다.', [
      step(0, 'resume', 'pending'), step(350, 'local_data', 'expired'), step(750, 'local_data', 'cleared'),
      step(1100, 'resume', 'expired'), step(1450, 'notice', 'blocked'),
    ]),
  define('resume_transfer', 'resume', '로그인 후 임시 이력서 저장', 'success', '로그인을 마쳤고 아직 유효한 비회원 임시 이력서가 있다고 가정합니다.',
    '유효한 임시 자료 → 회원 이력서 저장 → 임시 자료 비움', '예시 임시 이력서가 회원 자료로 가상 저장된 뒤 임시 보관이 비워졌습니다.', [
      step(0, 'auth', 'member'), step(300, 'local_data', 'ready'), request(650, 'api_resume', 'pending'),
      step(1000, 'database', 'running'), step(1550, 'database', 'complete'),
      request(1800, 'api_resume', 'complete', 1150, 'database'), step(2050, 'local_data', 'cleared'), step(2350, 'resume', 'complete'),
    ]),
  define('resume_transfer_expired', 'resume', '로그인 후 임시 이력서 만료', 'blocked', '로그인은 성공했지만 비회원 임시 이력서의 기한이 지난 상태를 가정합니다.',
    '로그인 확인 → 임시 자료 만료 → 재첨부 안내', '로그인은 유지되지만 만료된 예시 이력서는 회원 자료로 저장할 수 없습니다.', [
      step(0, 'auth', 'member'), step(350, 'local_data', 'expired'), step(700, 'local_data', 'cleared'),
      step(1000, 'resume', 'blocked'), step(1350, 'notice', 'blocked'),
    ]),
  define('resume_reset', 'resume', '회원 작업공간 초기화', 'success', '현재 회원 이력서가 선택된 작업공간을 초기화하는 예시입니다.',
    '현재 이력서 삭제 요청 → 저장 자료·작업 상태 비움', '현재 예시 이력서와 작업 상태를 가상으로 비웠습니다. 계정 탈퇴나 저장 보고서 삭제는 아닙니다.', [
      step(0, 'resume', 'pending'), request(350, 'api_resume', 'pending'), step(700, 'database', 'running'),
      step(1300, 'database', 'cleared'), request(1550, 'api_resume', 'complete', 1200, 'database'),
      step(1800, 'local_data', 'cleared'), step(2100, 'resume', 'cleared'),
    ]),

  // Roles, selected postings, custom postings and bookmarks use browser state.
  define('role', 'jobs', '희망 직무 선택·공고 조회', 'success', '선택 가능한 예시 직무와 해당 직무의 공고가 있다고 가정합니다.',
    '직무 선택 보관 → 공고 목록 조회', '예시 직무 선택이 브라우저에 보관되고 공고 목록이 표시되었습니다.', [
      step(0, 'role', 'pending'), step(350, 'local_data', 'complete'), step(650, 'role', 'complete'),
      request(950, 'api_jobs', 'pending'), step(1250, 'database_read', 'running'), step(1650, 'database_read', 'complete'),
      request(1900, 'api_jobs', 'complete', 950, 'database_read'), step(2200, 'posting', 'ready'),
    ]),
  define('posting', 'jobs', '채용공고 상세·선택', 'success', '목록에서 선택한 예시 서버 공고가 있다고 가정합니다.',
    '공고 상세 조회 → 선택 내용 보관', '예시 공고 상세를 확인하고 선택한 공고를 브라우저에 보관했습니다.', [
      step(0, 'posting', 'pending'), request(350, 'api_jobs', 'pending'),
      step(700, 'database_read', 'running'), step(1200, 'database_read', 'complete'),
      request(1450, 'api_jobs', 'complete', 1100, 'database_read'), step(1750, 'local_data', 'complete'), step(2050, 'posting', 'complete'),
    ]),
  define('postings_empty', 'jobs', '공고 검색 결과 없음', 'empty', '예시 검색·필터 조건과 일치하는 공고가 없는 응답을 가정합니다.',
    '공고 조회 성공 → 빈 검색 결과 안내', '가상 조회는 성공했지만 조건에 맞는 공고가 없습니다.', [
      step(0, 'posting', 'pending'), request(350, 'api_jobs', 'pending'), step(700, 'database_read', 'empty'),
      request(1150, 'api_jobs', 'complete', 800, 'database_read'), step(1450, 'posting', 'empty'), step(1750, 'notice', 'empty'),
    ]),
  define('postings_failed', 'jobs', '공고 목록 조회 실패', 'failure', '공고 목록 요청이 실패하는 응답을 가정합니다.',
    '목록 조회 실패 → 재시도 안내', '가상 공고 목록을 불러오지 못했습니다. 빈 검색 결과와는 구분됩니다.', [
      step(0, 'posting', 'pending'), request(350, 'api_jobs', 'pending'), request(1250, 'api_jobs', 'failed', 900),
      step(1600, 'posting', 'failed'), step(1950, 'notice', 'failed'),
    ]),
  define('posting_missing', 'jobs', '공고 상세 조회 실패', 'failure', '선택한 예시 공고가 없거나 상세 조회를 완료할 수 없는 응답을 가정합니다.',
    '상세 조회 실패 → 공고 다시 선택 안내', '예시 공고 상세 조회가 실패하여 선택 완료나 분석으로 넘어가지 않았습니다.', [
      step(0, 'posting', 'pending'), request(350, 'api_jobs', 'pending'), request(1200, 'api_jobs', 'failed', 850),
      step(1550, 'posting', 'failed'), step(1900, 'notice', 'blocked'),
    ]),
  define('bookmark', 'jobs', '공고 북마크 저장', 'success', '앱의 시연 계정에서만 제공되는 관심 저장입니다. 실제 회원 기능은 연동 준비 중입니다.',
    '시연 계정의 북마크 선택 → 브라우저에 보관', '시연 계정의 예시 북마크가 브라우저 보관 경로에 저장되었습니다. 서버 데이터 저장은 사용하지 않습니다.', [
      step(0, 'posting', 'pending'), step(450, 'local_data', 'running'), step(950, 'local_data', 'complete'), step(1300, 'posting', 'complete'),
    ]),
  define('bookmark_remove', 'jobs', '공고 북마크 해제', 'success', '앱의 시연 계정에서만 제공되는 관심 해제입니다. 실제 회원 기능은 연동 준비 중입니다.',
    '시연 계정의 북마크 해제 → 브라우저 보관 항목 제거', '시연 계정의 예시 북마크만 해제했습니다. 공고 원문을 삭제하는 동작은 아닙니다.', [
      step(0, 'posting', 'pending'), step(500, 'local_data', 'cleared'), step(950, 'posting', 'complete'),
    ]),
  define('posting_create', 'jobs', '직접 입력 공고 만들기', 'success', '앱의 시연 계정에서만 제공되는 공고 작성입니다. 실제 회원 기능은 연동 준비 중입니다.',
    '시연 계정의 입력 검사 → 브라우저에 공고 보관', '시연 계정의 예시 직접 입력 공고를 브라우저에만 보관했습니다. 실제 서버 분석 대상 공고로 등록되지는 않습니다.', [
      step(0, 'posting', 'pending'), step(350, 'input_check', 'complete'), step(750, 'local_data', 'running'),
      step(1250, 'local_data', 'complete'), step(1650, 'posting', 'complete'),
    ]),
  define('posting_edit', 'jobs', '직접 입력 공고 수정', 'success', '앱의 시연 계정에서만 제공되는 공고 수정입니다. 실제 회원 기능은 연동 준비 중입니다.',
    '시연 계정의 입력 검사 → 브라우저 보관 내용 수정', '시연 계정의 예시 직접 입력 공고의 브라우저 보관 내용만 변경했습니다.', [
      step(0, 'posting', 'pending'), step(350, 'input_check', 'complete'), step(750, 'local_data', 'running'),
      step(1250, 'local_data', 'complete'), step(1650, 'posting', 'complete'),
    ]),
  define('posting_delete', 'jobs', '직접 입력 공고 삭제', 'success', '앱의 시연 계정에서만 제공되는 공고 삭제입니다. 실제 회원 기능은 연동 준비 중입니다.',
    '시연 계정의 브라우저 보관 공고 제거 → 목록 갱신', '시연 계정의 예시 직접 입력 공고를 브라우저 보관에서 제거했습니다. 서버 공고는 삭제하지 않습니다.', [
      step(0, 'posting', 'pending'), step(500, 'local_data', 'cleared'), step(950, 'posting', 'cleared'), step(1300, 'notice', 'complete'),
    ]),
  define('posting_write_blocked', 'jobs', '회원 공고 작성·관심 저장 제한', 'blocked', '앱의 시연 계정이 아닌 실제 회원 상태를 가정합니다. 공고 작성·관심 저장은 연동 준비 중입니다.',
    '기능 제공 여부 확인 → 연동 준비 안내 · 요청과 저장 없음', '실제 회원에게 아직 제공하지 않는 공고 작성·관심 저장 안내까지만 시연했습니다.', [
      step(0, 'posting', 'pending'), step(350, 'input_check', 'blocked'),
      step(750, 'posting', 'blocked'), step(1100, 'notice', 'blocked'),
    ]),

  // All analysis branches are fixed scripts: none submits or polls an evaluation.
  define('report', 'analysis', '분석 성공·보고서 결과 확인', 'success', '로그인한 회원, 유효한 이력서, 실제 서버 공고를 가정합니다.',
    '분석 → 결과 저장 → 보고서 조회·표시', '가상 분석과 저장을 마친 뒤 보고서 조회 응답까지 확인하여 표시했습니다.', analysisSuccess(), 'analysis'),
  define('analysis_guest', 'analysis', '비회원 분석 완료 → 로그인 후 즉시 보기', 'success', '비회원 입력과 서버가 검증한 예시 공고를 가정합니다. 모든 분석·시간은 가상입니다.',
    '로그인 전 계산·프론트 서버 저장 → 잠금 → 로그인 → 기존 결과 표시', '가상 분석 결과를 인증 전에 저장하고, 로그인 후 재분석 없이 표시했습니다. 표시 시간은 설명용 예시입니다.', guestAnalysis(), 'guest_store'),
  define('guest_signup', 'analysis', '비회원 분석 완료 → 가입 후 즉시 보기', 'success', '보고서를 준비한 뒤 즉시 인증되는 가입 응답을 가정합니다. 이메일 확인 대기는 별도 경우입니다.',
    '계산·프론트 서버 저장 → 가입 → 기존 결과 연결·표시', '가상 가입 인증 후 보관된 결과를 표시했습니다. 추가 분석 요청은 없습니다.', guestAnalysis({ auth: 'signup' }), 'result_delivery'),
  define('guest_locked', 'analysis', '비회원 분석 완료 · 인증 대기', 'waiting', '분석이 완료되어 프론트 서버에 결과가 저장된 뒤 인증을 아직 하지 않은 가상 예시입니다.',
    '계산 완료 → 결과 저장 → 잠금·인증 대기', '가상 결과를 저장하고 인증을 기다립니다. 보고서 표시 완료와 구분합니다.', guestAnalysis({ lockedOnly: true }), 'report_lock'),
  define('guest_signup_waiting', 'analysis', '비회원 결과 보관 · 이메일 인증 대기', 'waiting', '완료된 결과의 임시 보관 기한이 남아 있고 가입 후 이메일 확인이 필요한 가상 예시입니다.',
    '완료 결과 보관 → 가입 성공 → 이메일 인증 대기', '가상 가입은 완료됐지만 인증 전이므로 결과를 연결하지 않았습니다. 임시 보관 기한은 연장되지 않습니다.', [
      ...guestAnalysis({ lockedOnly: true }), step(6800, 'signup', 'pending'), request(7100, 'api_signup', 'pending'),
      request(7800, 'api_signup', 'complete', 700), step(8000, 'signup', 'waiting'), step(8200, 'notice', 'waiting'),
    ], 'report_lock'),
  define('guest_claim_slow', 'analysis', '인증 후 결과 표시 · 3초 목표 초과', 'success', '계산은 끝났지만 결과 연결 응답과 화면 표시에 가상으로 3.4초가 걸리는 예시입니다.',
    '저장 결과 연결 → 3초 초과 기록 → 보고서 표시', '가상 결과는 표시됐지만 3초 목표를 초과했습니다. 분석 시간과 결과 전달 시간을 따로 확인합니다.', guestAnalysis({ slow: true }), 'result_delivery'),
  define('guest_claim_failed', 'analysis', '인증 후 결과 연결 실패', 'failure', '로그인 전 계산·저장은 성공했으나 인증 후 결과 연결 요청이 실패한 가상 예시입니다.',
    '인증 성공 → 결과 연결 실패 · 재분석 없음', '가상 결과 연결이 실패하여 보고서 표시 완료로 넘어가지 않았습니다. 보관 기한 내 연결을 다시 시도합니다.', guestAnalysis({ claimFailure: true }), 'guest_claim'),
  define('guest_expired', 'analysis', '비회원 임시 결과 만료', 'blocked', '계산 완료 후 첫 첨부 기준 최대 30분의 임시 보관 기한이 지난 상태를 가정합니다.',
    '완료 결과 보관 → 만료 확인 → 입력·결과 정리', '가상 임시 결과가 만료되어 새 입력·분석이 필요합니다. 인증만으로 만료 결과를 복원하지 않습니다.', [
      ...guestAnalysis({ lockedOnly: true }), request(6800, 'api_guest_analysis', 'pending'), request(7150, 'api_guest_analysis', 'failed', 350),
      step(7400, 'guest_cleanup', 'expired'), step(7550, 'local_data', 'cleared'), step(7700, 'report_lock', 'expired'), step(7950, 'notice', 'expired'),
    ], 'guest_cleanup'),
  define('guest_cancelled', 'analysis', '비회원 진행 중 취소·임시 자료 정리', 'cancelled', '비회원 분석 도중 취소하고 서버가 취소를 확인한 가상 예시입니다.',
    '실제 분석 경로 → 취소 확인 → 임시 자료 정리', '가상 분석을 취소하고 임시 자료를 정리했습니다. 완료된 결과를 만들지 않았습니다.', [
      ...guestAnalysis({ lockedOnly: true }).filter(([at]) => at <= 4300), step(4550, 'cancel', 'pending'),
      request(4800, 'api_cancel', 'pending'), request(5200, 'api_cancel', 'complete', 400),
      progress(5400, 'cancelled', null), step(5550, 'guest_cleanup', 'complete'), step(5700, 'cancel', 'complete'), step(5900, 'evaluate', 'cancelled'),
    ], 'guest_cleanup'),
  define('guest_service_recovery', 'analysis', '비회원 서비스 연결 오류 후 복구', 'success', '분석 전 연결 확인은 실패하지만 다시 시도할 때 서비스가 복구되는 가상 예시입니다.',
    '연결 실패 안내 → 연결 재확인 → 로그인 전 계산·저장', '가상 연결을 복구한 뒤 분석하고 결과를 보관했습니다. 연결 실패를 분석 완료로 표시하지 않습니다.', [
      request(0, 'api_guest_service', 'pending'), request(400, 'api_guest_service', 'failed', 400), step(650, 'notice', 'failed'),
      ...guestAnalysis({ lockedOnly: true }).map(([at, ...values]) => [at + 1200, ...values]), step(7800, 'notice', 'complete'),
    ], 'api_guest_service'),
  define('guest_posting_first', 'analysis', '공고 먼저 선택 → 이력서 첨부 → 분석', 'success', '비회원이 희망 직무·공고를 먼저 고른 뒤 이력서 페이지에서 첨부하는 가상 예시입니다.',
    '직무·공고 선택 보관 → 이력서 첨부 → 선택한 공고로 분석', '가상 공고 선택을 유지한 채 이력서를 준비하고, 로그인 전에 분석·저장을 완료했습니다.', [
      step(0, 'role', 'complete'), step(250, 'posting', 'complete'), step(450, 'local_data', 'complete'), step(650, 'resume', 'pending'),
      step(950, 'input_check', 'complete'), step(1150, 'local_data', 'complete'), step(1350, 'resume', 'complete'),
      ...guestAnalysis().map(([at, ...values]) => [at + 1700, ...values]),
    ], 'resume'),
  define('analysis_no_resume', 'analysis', '이력서 없이 분석 시도', 'blocked', '로그인은 했지만 유효한 이력서가 없는 상태를 가정합니다.',
    '필수 이력서 확인 → 첨부 안내 · 분석 요청 없음', '이력서가 없어 가상 분석 요청을 시작하지 않았습니다.', [
      step(0, 'analysis', 'pending'), step(350, 'input_check', 'blocked'), step(700, 'resume', 'empty'),
      step(1000, 'analysis', 'blocked'), step(1350, 'notice', 'blocked'),
    ]),
  define('analysis_no_posting', 'analysis', '공고 없이 분석 시도', 'blocked', '로그인과 이력서는 준비됐지만 공고를 선택하지 않은 상태입니다.',
    '선택 공고 확인 → 공고 선택 안내 · 분석 요청 없음', '선택한 공고가 없어 가상 분석 요청을 시작하지 않았습니다.', [
      step(0, 'analysis', 'pending'), step(350, 'input_check', 'blocked'), step(700, 'posting', 'empty'),
      step(1000, 'analysis', 'blocked'), step(1350, 'notice', 'blocked'),
    ]),
  define('analysis_local_posting', 'analysis', '회원 · 서버 미등록 공고 분석 시도', 'blocked', '회원 분석에서 서버 공고 대신 브라우저의 직접 입력 공고를 선택한 상태입니다. 비회원의 서버 검증 예시 공고와는 다릅니다.',
    '분석 대상 검사 → 서버 공고 선택 안내', '가상 분석 대상 검사가 중단되었습니다. 현재 실제 분석에는 서버 공고가 필요합니다.', [
      step(0, 'analysis', 'pending'), step(350, 'input_check', 'blocked'), step(700, 'posting', 'blocked'),
      step(1000, 'analysis', 'blocked'), step(1400, 'notice', 'blocked'),
    ]),
  define('analysis_start_failed', 'analysis', '분석 시작 요청 실패', 'failure', '입력은 준비됐지만 평가 생성 요청을 완료하지 못한 응답을 가정합니다.',
    '분석 요청 실패 → 재시도 안내', '가상 분석 생성 요청이 실패하여 대기열·분석·보고서 표시로 넘어가지 않았습니다.', [
      step(0, 'input_check', 'complete'), request(350, 'api_evaluation', 'pending'),
      request(1250, 'api_evaluation', 'failed', 900), step(1600, 'analysis', 'failed'), step(1950, 'notice', 'failed'),
    ], 'analysis'),
  define('analysis_failed', 'analysis', '분석 진행 중 실패', 'failure', '분석을 시작했지만 진행 중 실패 상태를 받은 예시입니다.',
    '분석 진행 → 실패 안내 · 결과 저장과 보고서 표시 없음', '가상 분석이 실패했습니다. 성공한 보고서나 저장 완료를 만들지 않았습니다.', [
      ...analysisStart(), progress(4000, 'running', 48), progress(4900, 'failed', null), step(5300, 'notice', 'failed'),
    ], 'analysis'),
  define('analysis_cancelled', 'analysis', '진행 중 분석 취소', 'cancelled', '분석이 진행 중일 때 취소를 누르고 취소 응답을 받은 예시입니다.',
    '취소 요청 → 취소 확인 · 결과 저장과 보고서 표시 없음', '가상 분석 취소를 확인했습니다. 취소된 실행에서 보고서를 생성하지 않습니다.', [
      ...analysisStart(), step(3700, 'cancel', 'pending'), request(4000, 'api_cancel', 'pending'),
      request(4650, 'api_cancel', 'complete', 650), progress(4900, 'cancelled', null), step(5200, 'cancel', 'complete'),
      step(5500, 'notice', 'cancelled'),
    ], 'analysis'),
  define('analysis_timeout', 'analysis', '분석 응답 대기 시간 초과', 'failure', '브라우저가 정해진 시간 안에 최종 분석 상태를 확인하지 못한 예시입니다.',
    '응답 확인 시간 초과 → 상태 확인 안내', '가상 대기 시간이 초과되었습니다. 서버 분석의 성공이나 취소가 확인된 것으로 표시하지 않습니다.', [
      ...analysisStart(), progress(4000, 'running', 48), request(4500, 'api_evaluation', 'pending', null, 'analysis'),
      request(5400, 'api_evaluation', 'failed', 900), progress(5750, 'waiting', null), step(6100, 'notice', 'failed'),
    ], 'analysis'),
  define('analysis_partial', 'analysis', '분석 부분 완료', 'partial', '분석은 끝났지만 일부 평가 항목을 확인할 수 없는 응답을 가정합니다.',
    '부분 완료 → 결과 저장 → 확인 필요 보고서 표시', '가상 부분 완료 보고서를 표시했습니다. 누락된 항목을 임의의 점수로 채우지 않습니다.', analysisSuccess({ partial: true }), 'analysis'),

  // Reading saved reports never starts a new evaluation or writes a report.
  define('report_history', 'reports', '저장 보고서 목록 보기', 'success', '로그인한 회원에게 저장된 예시 보고서가 있다고 가정합니다.',
    '목록 요청 → 저장 자료 조회 → 보고서 목록', '저장한 예시 보고서 목록을 조회했습니다. 새 분석이나 데이터 저장은 없습니다.', [
      step(0, 'history', 'pending'), request(350, 'api_report', 'pending'), step(700, 'database_read', 'running'),
      step(1200, 'database_read', 'complete'), request(1450, 'api_report', 'complete', 1100, 'database_read'), step(1800, 'history', 'complete'),
    ]),
  define('report_saved', 'reports', '저장 보고서 다시 열기', 'success', '목록에서 완료된 예시 보고서를 선택한 상태를 가정합니다.',
    '기존 평가·보고서 조회 → 보고서 표시 · 새 분석 없음', '기존 예시 보고서를 다시 표시했습니다. 분석을 재실행하거나 다시 저장하지 않았습니다.', [
      step(0, 'history', 'pending'), request(350, 'api_report', 'pending'), step(700, 'database_read', 'running'),
      step(1250, 'database_read', 'complete'), request(1500, 'api_report', 'complete', 1150, 'database_read'),
      step(1750, 'history', 'complete'), step(2100, 'report', 'complete', 'api_report'),
    ], 'report'),
  define('report_empty', 'reports', '저장 보고서 없음', 'empty', '로그인한 회원의 저장 보고서 목록이 비어 있는 응답을 가정합니다.',
    '목록 조회 성공 → 저장된 보고서 없음', '가상 목록 조회는 성공했지만 저장 보고서가 없습니다.', [
      step(0, 'history', 'pending'), request(350, 'api_report', 'pending'), step(750, 'database_read', 'empty'),
      request(1200, 'api_report', 'complete', 850, 'database_read'), step(1500, 'history', 'empty'), step(1850, 'notice', 'empty'),
    ]),
  define('report_inaccessible', 'reports', '저장 보고서 접근 불가', 'failure', '보고서가 없거나 현재 계정의 접근이 허용되지 않는 응답을 가정합니다.',
    '보고서 조회 거절 → 목록으로 돌아가기 안내', '예시 저장 보고서에 접근할 수 없어 본문을 표시하지 않았습니다.', [
      step(0, 'history', 'pending'), request(350, 'api_report', 'pending'), request(1250, 'api_report', 'failed', 900),
      step(1550, 'history', 'failed'), step(1900, 'notice', 'blocked'),
    ]),
  define('report_not_ready', 'reports', '저장 보고서 아직 미완료', 'blocked', '선택한 평가의 보고서 작성이 완료되지 않은 응답을 가정합니다.',
    '작성 상태 조회 → 미완료 안내 · 본문 표시 없음', '예시 보고서가 아직 완료되지 않아 표시하지 않았습니다. 새 분석도 시작하지 않습니다.', [
      step(0, 'history', 'pending'), request(350, 'api_report', 'pending'), step(750, 'database_read', 'complete'),
      request(1200, 'api_report', 'failed', 850, 'database_read'), step(1500, 'history', 'waiting'), step(1850, 'notice', 'waiting'),
    ]),
  define('report_session_expired', 'reports', '보고서 조회 중 세션 만료', 'blocked', '회원 전용 보고서 조회에서 인증 만료 응답을 받은 예시입니다.',
    '보고서 조회 거절 → 세션 비움 → 로그인 안내', '가상 세션이 만료되어 저장 보고서를 표시하지 않았습니다.', [
      step(0, 'history', 'pending'), request(350, 'api_report', 'pending'), request(1200, 'api_report', 'failed', 850),
      step(1500, 'local_data', 'cleared'), step(1800, 'session', 'expired'), step(2050, 'history', 'blocked'), step(2350, 'notice', 'blocked'),
    ]),
  define('report_fetch_failed', 'reports', '분석 완료 후 보고서 조회 실패', 'failure', '분석과 결과 저장은 끝났지만 최종 보고서 요청이 실패하는 예시입니다.',
    '분석 100%·저장 완료 → 보고서 조회 실패', '가상 분석 결과는 저장됐지만 보고서 응답을 받지 못해 표시 완료로 넘어가지 않았습니다.', analysisSuccess({ reportFailure: true }), 'api_report'),

  // Every verified member can read operational metadata; no admin role is required.
  define('dashboard', 'dashboard', '운영 대시보드·기간 조회', 'success', '로그인한 회원이 선택 기간의 예시 운영 기록을 조회합니다. 관리자 지정은 필요하지 않습니다.',
    '대시보드 요청 → 운영 자료 조회 → 집계·그래프 표시', '선택 기간의 예시 운영 기록과 집계를 표시했습니다. 실제 운영 자료는 읽지 않았습니다.', [
      step(0, 'dashboard', 'pending'), request(350, 'api_dashboard', 'pending'), step(750, 'database_read', 'running'),
      step(1250, 'database_read', 'complete'), request(1500, 'api_dashboard', 'complete', 1150, 'database_read'), step(1850, 'dashboard', 'complete'),
    ]),
  define('dashboard_empty', 'dashboard', '운영 기록 없음', 'empty', '로그인한 회원이 조회한 기간에 예시 운영 기록이 없는 응답을 가정합니다.',
    '조회 성공 → 기록 없음 안내', '가상 조회는 성공했지만 선택 기간에 운영 기록이 없습니다.', [
      step(0, 'dashboard', 'pending'), request(350, 'api_dashboard', 'pending'), step(750, 'database_read', 'empty'),
      request(1200, 'api_dashboard', 'complete', 850, 'database_read'), step(1500, 'dashboard', 'empty'), step(1850, 'notice', 'empty'),
    ]),
  define('dashboard_failed', 'dashboard', '운영 기록 조회 실패', 'failure', '로그인한 회원의 운영 기록 요청이 실패하는 예시 응답을 가정합니다.',
    '조회 실패 → 미수집 안내·재시도', '가상 운영 기록 조회가 실패했습니다. 미수집 지표를 0으로 만들지 않습니다.', [
      step(0, 'dashboard', 'pending'), request(350, 'api_dashboard', 'pending'), request(1250, 'api_dashboard', 'failed', 900),
      step(1600, 'dashboard', 'failed'), step(1950, 'notice', 'failed'),
    ]),
  define('dashboard_filter', 'dashboard', '운영 상태 필터·실행 상세', 'success', '조회된 예시 운영 기록이 이미 화면에 준비된 상태입니다.',
    '불러온 자료의 상태 필터·실행 상세 표시', '기존 예시 자료에서 필터와 실행 상세를 바꿨습니다. 추가 서버 요청이나 저장은 없습니다.', [
      step(0, 'dashboard', 'pending'), step(450, 'local_data', 'ready'), step(1000, 'dashboard', 'complete'),
    ]),
];

function joinSteps(ids) {
  const result = [step(0, 'visit', 'complete')];
  let offset = 450;
  for (const id of ids) {
    const action = DEMO_ACTIONS.find((candidate) => candidate.id === id);
    result.push(...action.steps.map(([at, ...values]) => [at + offset, ...values]));
    offset += action.steps.at(-1)[0] + 450;
  }
  return result;
}

const fullAction = define('full', 'analysis', '전체 성공 흐름 재생', 'success',
  '비회원이 이력서·직무·공고를 준비하고 실제 계산 경로를 거친 뒤 로그인하는 가상 예시입니다.',
  '비회원 준비 → 분석·프론트 서버 결과 보관 → 로그인 → 기존 보고서',
  '로그인 전 계산·저장부터 인증 후 즉시 결과 표시까지 가상 시연을 마쳤습니다. 시간은 모두 예시입니다.',
  joinSteps(['resume_guest', 'role', 'posting', 'analysis_guest']), 'visit');

function describeNodes(action) {
  const descriptions = {
    database: '가상 결과·자료 저장', database_read: '기존 서버 자료를 가상 조회',
    local_data: '가상 브라우저 임시 자료·선택', input_check: '가상 입력 조건 확인',
    guest_store: '가상 프론트 서버 결과 저장', report_lock: '가상 잠금·인증 대기',
    guest_claim: '기존 가상 결과를 인증 계정에 연결', result_delivery: '가상 인증 후 결과 표시 시간',
    guest_cleanup: '가상 비회원 임시 자료 정리',
  };
  if (action.group === 'account') {
    descriptions.database = '예시 회원 프로필 저장';
    descriptions.local_data = '예시 인증 세션 보관·비움';
  } else if (action.group === 'resume') {
    descriptions.database = action.id === 'resume_reset' ? '현재 예시 이력서 삭제' : '예시 회원 이력서 저장';
    descriptions.local_data = '예시 임시 이력서 보관·비움';
  } else if (action.group === 'jobs') {
    descriptions.local_data = '예시 직무·공고·북마크 보관';
    descriptions.database_read = '예시 채용공고 조회';
  } else if (action.group === 'reports') {
    descriptions.database_read = '기존 예시 평가·보고서 조회';
  } else if (action.group === 'dashboard') {
    descriptions.database_read = '예시 운영 기록 조회';
    descriptions.local_data = '이미 불러온 예시 화면 자료';
  }
  if (['report', 'analysis_partial', 'report_fetch_failed'].includes(action.id)) {
    descriptions.database = '가상 분석 결과·보고서 저장';
  }
  if (action.id === 'full') descriptions.database = '가상 회원·이력서·분석 결과 저장';
  return Object.freeze(descriptions);
}

function incomingNode(steps, index) {
  const node = steps[index][1];
  const explicit = steps[index][6];
  const previous = index > 0 ? steps[index - 1][1] : null;
  const from = typeof explicit === 'string' ? explicit : previous;
  return from && from !== node ? from : null;
}

for (const action of [...DEMO_ACTIONS, fullAction]) {
  const seenEdges = new Set();
  action.nodeDescriptions = describeNodes(action);
  action.nodes = Object.freeze([...new Set(action.steps.map((entry) => entry[1]))]);
  action.edges = Object.freeze(action.steps.flatMap((entry, index) => {
    const from = incomingNode(action.steps, index);
    const key = `${from}:${entry[1]}`;
    if (!from || seenEdges.has(key)) return [];
    seenEdges.add(key);
    return [Object.freeze([from, entry[1]])];
  }));
  for (const entry of action.steps) Object.freeze(entry);
  Object.freeze(action.steps);
  Object.freeze(action);
}
Object.freeze(DEMO_ACTIONS);

export function getDemoAction(id) {
  return id === 'full' ? fullAction : DEMO_ACTIONS.find((action) => action.id === id) ?? null;
}

let nextPlaybackId = 0;

// The viewer owns its timer. This runner only emits fictional metadata, with no
// API, authentication, browser storage, or DOM access.
export function createDemoPlayback({ emit, onFinish = () => {}, now = () => Date.now() }) {
  const playbackId = ++nextPlaybackId;
  let run = 0;
  let action = null;
  let index = 0;
  let elapsed = 0;
  let startedAt = 0;
  let playing = false;
  let complete = false;

  function snapshot() {
    return { actionId: action?.id ?? null, index, elapsed, playing, complete };
  }

  function flush() {
    const activeRun = run;
    while (playing && index < action.steps.length && action.steps[index][0] <= elapsed) {
      const eventIndex = index++;
      const [offset, node, state, progress = null, durationMs = null, kind = 'action'] = action.steps[eventIndex];
      const from = incomingNode(action.steps, eventIndex);
      emit({
        id: `demo-${playbackId}-${activeRun}-${eventIndex}`, source: 'demo',
        node, state, progress, durationMs, kind, at: startedAt + offset,
        ...(action.nodes.includes('api_guest_analysis') ? { execution: 'guest' } : {}),
        ...(from ? { from } : {}),
      });
      if (run !== activeRun) return;
    }
    if (playing && index === action.steps.length) {
      playing = false;
      complete = true;
      onFinish(action);
    }
  }

  return {
    start(id) {
      const next = getDemoAction(id);
      if (!next) return false;
      run += 1;
      action = next;
      index = 0;
      elapsed = 0;
      startedAt = now();
      complete = false;
      playing = true;
      flush();
      return true;
    },
    tick(deltaMs) {
      if (!playing || !Number.isFinite(deltaMs) || deltaMs < 0) return;
      elapsed = Math.min(elapsed + deltaMs, action.steps.at(-1)[0]);
      flush();
    },
    pause() {
      const changed = playing;
      playing = false;
      return changed;
    },
    resume() {
      if (!action || complete || playing) return false;
      playing = true;
      return true;
    },
    reset() {
      run += 1;
      action = null;
      index = 0;
      elapsed = 0;
      playing = false;
      complete = false;
    },
    snapshot,
  };
}
