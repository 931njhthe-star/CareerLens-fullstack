import { FLOW_VIEW_COLUMNS, FLOW_VIEW_NODES, FLOW_NODES, FLOW_SOURCES, LIVE_FLOW_EDGES, normalizeFlowEvent, flowEventLabel, projectFlowNode, projectFlowEdges } from './catalog.js';
import { DEMO_ACTIONS, DEMO_GROUPS, getDemoAction, createDemoPlayback } from './demo.js';
import { mountFlowMotion } from './motion.js';
import { FLOW_RUN_NODES } from './events.js';
import { createLiveFlowSources } from './live-sources.js';
import { createCentralFlowMonitor } from './central-transport.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const glyph = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${{
  lens: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  dashboard: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="11" width="7" height="10" rx="1"/><rect x="3" y="14" width="8" height="7" rx="1"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>',
  wave: '<path d="M2 12h4l3-7 6 14 3-7h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/>',
}[name]}</svg>`;
const timeFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const time = (value) => timeFormatter.format(value);
const duration = (value) => value === null ? '미측정' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
const outcomes = { success: '성공', failure: '실패', blocked: '차단', cancelled: '취소', partial: '부분 완료', empty: '결과 없음', waiting: '확인 대기' };
const THEME_KEY = 'careerlens.flow.theme.v1';
const ACTIVE_STATES = new Set(['pending', 'running', 'queued']);
const CARD_FLASH_MS = 1600;
function readTheme() {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

function pageMarkup(hasStream, central) {
  return `<div class="flow-shell">
    <header class="flow-header">
      <a class="flow-brand" href="/#/resume" target="_blank" rel="noopener" aria-label="CareerLens 새 앱 탭 열기">${glyph('lens')}<span>Career<span>Lens</span></span></a>
      <span class="flow-header-divider"></span><h1>이용 흐름</h1>
      <div class="flow-toolbar"><label class="flow-select-label">관찰 모드<select data-flow-mode aria-label="관찰 모드">${central ? '<option value="live">실시간 · 전체 이용</option><option value="local">이 브라우저만</option>' : `<option value="live" ${hasStream ? '' : 'disabled'}>실시간 · 브라우저 탭</option>`}<option value="demo">시연 · 가상 이벤트</option></select></label>
      <label class="flow-select-label" data-flow-source-label>상세 지도 대상<select data-flow-source aria-label="상세 지도 대상"><option value="auto">최근 이용 자동 추적</option></select></label>
      <div class="flow-theme-switch" role="group" aria-label="화면 밝기"><button type="button" data-flow-theme="light" aria-pressed="false">${glyph('sun')}밝게</button><button type="button" data-flow-theme="dark" aria-pressed="true">${glyph('moon')}어둡게</button></div>
      <button class="flow-icon-button" data-flow-motion aria-label="동작 줄이기" aria-pressed="false">${glyph('wave')}</button>
      <a class="flow-app-link" href="/#/mypage">마이페이지 ${glyph('arrow')}</a></div>
    </header>
    <a class="flow-dashboard-banner" href="/#/admin">
      <span class="flow-dashboard-banner-icon">${glyph('dashboard')}</span>
      <span class="flow-dashboard-banner-copy"><strong>대시보드에서 실행 기록과 평가 결과를 확인하세요</strong><span>모의지원 기록과 평가 결과를 한곳에서 살펴볼 수 있습니다.</span></span>
      <span class="flow-dashboard-banner-action">대시보드 열기 ${glyph('arrow')}</span>
    </a>
    <section class="flow-intro" aria-label="관찰 범위">
      <div><h2>하나의 행동이, 결과가 되기까지.</h2><p>사용자의 시작부터 API, 분석, 보고서까지. 움직이는 연결선으로 흐름을 따라가세요.</p></div>
      <div class="flow-connection"><span class="flow-status-dot"></span><strong data-flow-connection></strong><span data-flow-scope></span></div>
    </section>
    <div class="flow-mode-banner" data-flow-banner role="status"></div>
    <section class="flow-global-panel" data-flow-global hidden aria-label="전체 이용 실시간 기록">
      <header><div><h2>전체 이용 기록</h2><p data-flow-global-summary></p></div><span data-flow-global-health role="status"></span></header>
      <p class="flow-panel-note">모든 관찰 대상의 새 이벤트가 이 목록에 표시됩니다. 항목을 선택하면 아래 지도에 해당 브라우저 또는 분석만 표시합니다. 계정·이력서·보고서 원문은 전송하지 않습니다.</p>
      <div class="flow-global-feed" data-flow-global-feed role="region" aria-label="전체 이용 최근 200개 이벤트" tabindex="0"></div>
      <div class="flow-source-pages"><button type="button" data-flow-source-prev>이전 대상</button><span data-flow-source-page></span><button type="button" data-flow-source-next>다음 대상</button></div>
      <div class="flow-source-pages" data-flow-related></div>
    </section>
    <section class="flow-live-guide" data-flow-live-guide hidden aria-label="실제 연결 구조">
      <div><strong>비회원 · 프론트 서버에서 분석 → 임시 결과 보관</strong><p>이력서·공고를 준비하는 순서는 자유입니다. 분석이 끝난 뒤 결과를 잠그고 인증을 기다립니다.</p></div>
      <div><strong>인증 완료 → 저장된 결과 연결 → 현재 보고서 표시</strong><p>재분석 없이 결과를 엽니다. 회원의 기존 분석은 FastAPI·워커 경로로 구분합니다.</p></div>
      <p class="flow-live-guide-note">전체 이용 기록과 선택한 대상의 지도를 구분해서 봅니다. 대상별 인증·분석 기록은 섞지 않으며, 연결선은 처리 관계이고 실행 증거는 아닙니다. 브라우저 관측과 서버가 기록한 분석은 별도 대상으로 표시합니다.</p>
    </section>
    <section class="flow-simulator" data-flow-simulator aria-label="가상 기능 시연">
      <div class="flow-simulator-heading"><div><h2>경우를 골라 흐름을 시연하세요</h2><p>성공·실패·취소와 저장 위치까지, ${DEMO_ACTIONS.length}가지 경우를 가상으로 재현합니다.</p></div><button class="flow-demo-all" data-flow-action="full">${glyph('play')}전체 성공 흐름</button></div>
      <div class="flow-case-tools"><div class="flow-case-groups" role="group" aria-label="시연 기능 분류">${[{id:'all',label:'전체'}, ...DEMO_GROUPS].map((group) => `<button data-flow-group="${group.id}" aria-pressed="${group.id === 'account'}">${group.label}<span>${group.id === 'all' ? DEMO_ACTIONS.length : DEMO_ACTIONS.filter((action) => action.group === group.id).length}</span></button>`).join('')}</div><input class="flow-case-search" data-flow-search type="search" aria-label="시연 경우 검색" placeholder="경우 검색 · 가입, 취소, 저장…" maxlength="80" autocomplete="off"></div>
      <div class="flow-case-results"><span data-flow-case-count></span><span>버튼으로 재생 · 목록 안에서 스크롤</span></div>
      <div class="flow-action-list" data-flow-action-list></div>
      <div class="flow-case-brief"><h3 data-flow-case-title></h3><p data-flow-case-condition></p><p data-flow-case-route></p></div>
      <div class="flow-demo-status" role="status" aria-live="polite" aria-atomic="true"><strong data-flow-demo-state>시연 대기</strong><span data-flow-demo-message></span></div>
    </section>
    <section class="flow-map-region" aria-label="CareerLens 처리 흐름 지도">
      <div class="flow-map-toolbar"><div class="flow-legend"><span><i class="is-running"></i>진행</span><span><i class="is-complete"></i>완료</span><span><i class="is-failed"></i>실패</span><span><i class="is-uncollected"></i>미수집</span></div>
        <div class="flow-demo-controls" data-flow-demo-controls><button data-flow-play disabled>${glyph('pause')}<span>일시정지</span></button><button data-flow-restart>${glyph('reset')}<span>초기화</span></button></div>
        <span class="flow-map-hint" data-flow-map-hint>단계를 선택해 상세 보기</span></div>
      <div class="flow-map-scroll" tabindex="0" aria-label="흐름 지도, 좁은 화면에서 좌우로 스크롤">
        <div class="flow-board" data-flow-board><canvas data-flow-canvas aria-hidden="true"></canvas>
          <div class="flow-columns">${FLOW_VIEW_COLUMNS.map((column) => `<section class="flow-column flow-color-${column.color}"><header><h3>${column.title}</h3><p>${column.subtitle}</p></header><div class="flow-node-stack">${column.nodes.map(([id, label, description, internal]) => `<button class="flow-node" data-flow-node="${id}" data-state="${internal ? 'uncollected' : 'idle'}" aria-pressed="false"><span class="flow-node-title"><span class="flow-node-light"></span><strong>${label}</strong><span class="flow-node-code">${id.replace('api_', '')}</span></span><span class="flow-node-description">${description}</span><span class="flow-node-bottom"><span data-node-status>${internal ? '미수집' : '이벤트 대기'}</span><span data-node-value>—</span></span><span class="flow-node-track"><span data-node-progress></span></span></button>`).join('')}<p class="flow-column-empty" hidden>이 경우에는 실행하지 않습니다.</p></div></section>`).join('')}</div>
        </div>
      </div>
      <div class="flow-map-footer"><span data-flow-latest>이벤트를 기다리고 있습니다.</span><span data-flow-card-scope>전체 ${FLOW_VIEW_NODES.size}개 · 통합 단계는 카드 선택</span></div>
    </section>
    <div class="flow-instruments">
      <section class="flow-log-panel"><header><h2>이벤트 로그</h2><span><b data-flow-event-count>0</b>개 · 최근 100개</span></header><p class="flow-panel-note" data-flow-log-note></p><div class="flow-log" data-flow-log role="region" aria-label="최근 이벤트 기록" tabindex="0"></div></section>
      <section class="flow-timing-panel"><header><h2 data-flow-chart-title>API 응답 시간</h2><span data-flow-request-count>미측정</span></header><p class="flow-panel-note" data-flow-chart-note></p><div data-flow-chart class="flow-chart"></div></section>
      <section class="flow-detail-panel"><header><h2>단계 상세</h2><span data-flow-detail-state>선택 가능</span></header><div data-flow-detail></div></section>
    </div>
    <footer class="flow-footer"><span>CareerLens · 프로젝트 2</span><span>이 화면은 원문 입력·계정 정보·인증 토큰을 기록하지 않습니다.</span></footer>
  </div>`;
}

export function mountFlowViewer(host, { central = false, paired = true, onUnauthorized = () => {}, request } = {}) {
  document.title = '이용 흐름 · CareerLens';
  document.body.classList.add('flow-mode');
  let theme = readTheme();
  document.body.dataset.flowTheme = theme;
  const requestedStream = new URLSearchParams(location.search).get('stream');
  const stream = /^[a-zA-Z0-9_-]{8,100}$/.test(requestedStream || '') ? requestedStream : null;
  let transportMode = central ? 'central' : 'local';
  const makeSources = () => createLiveFlowSources({ initialStream: stream, now: () => Date.now(), central: transportMode === 'central', paired: paired && transportMode === 'local', limit: transportMode === 'central' ? 5000 : 16 });
  let liveSources = makeSources();
  host.innerHTML = pageMarkup(Boolean(stream), central);
  const $ = (selector) => host.querySelector(selector);
  let mode = central || stream ? 'live' : 'demo';
  let centralState = { state: 'connecting', scope: null, sources: 0, received: 0, gaps: 0 };
  let allEvents = [], sourcePage = 0, centralLastSeen = 0, pendingPin = null;
  let monitor;
  let selectedDemoId = 'analysis_guest';
  let caseGroup = 'analysis';
  let caseSearch = '';
  let events = [];
  const nodeStates = new Map();
  let chosen = 'analysis';
  let sessionMode = 'guest';
  let sessionKnown = false;
  let connectedAt = 0;
  let liveMotionStopped = false;
  let channel;
  let demoTimer;
  let demoLastTick = 0;
  let disposed = false;
  let liveFrame = 0;
  let liveDirty = false;
  const livePulses = new Map();
  const cardFlashes = new Map();
  let cardFlashTimer = 0;
  const renderedCards = new Map();
  let reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion = mountFlowMotion($('[data-flow-board]'), { reducedMotion: reduceMotion, theme });
  const cards = new Map([...host.querySelectorAll('[data-flow-node]')].map((node) => [node.dataset.flowNode, node]));
  const playback = createDemoPlayback({ emit: (event) => {
    if (mode === 'demo' && !disposed) accept(event);
  } });
  const demoAction = () => getDemoAction(selectedDemoId);
  const description = (node) => mode === 'demo' ? (demoAction()?.nodeDescriptions?.[node] || {
    queue: '가상 분석 대기 상태', analysis: '시연용 분석 진행률',
    parse_resume: '예시 이력서 해석 과정', parse_job: '예시 공고 해석 과정',
    validation: '가상 결과 검증 과정', database: '가상 저장 과정',
    report: '가상 보고서 표시 완료', archive: '가상 기록 보관 과정',
  }[node] || FLOW_VIEW_NODES.get(node).description) : FLOW_VIEW_NODES.get(node).description;

  function currentNodeEvent(node) {
    const current = nodeStates.get(node);
    // Parallel requests can share a node (for example, a jobs list and its
    // detail). The latest request finishing does not finish its older sibling.
    // Current states remain authoritative: an explicit reset must not revive
    // an abandoned request that survives only in retained history.
    if (!current || mode !== 'live') return current;
    return events.findLast((event) => event.node === node && event.kind === 'request'
      && ACTIVE_STATES.has(event.state)) || current;
  }

  function cardEvents(id) {
    return FLOW_VIEW_NODES.get(id).members.map(currentNodeEvent).filter(Boolean).sort((a, b) => a.at - b.at);
  }
  function cardEvent(id) {
    const values = cardEvents(id);
    return values.filter((event) => ['pending', 'running', 'queued'].includes(event.state)).at(-1) || values.at(-1);
  }
  const liveFresh = () => transportMode === 'central'
    ? centralState.state === 'connected' && liveSources.snapshot()?.connected !== false
      && Date.now() - (liveSources.snapshot()?.updatedAt || Date.now()) < 120000
      && Boolean(centralLastSeen && Date.now() - centralLastSeen < 12000)
    : Boolean(connectedAt && Date.now() - connectedAt < 12000);
  const authLabel = () => !sessionKnown ? '인증 상태 확인 전' : sessionMode === 'member' ? '회원 확인' : sessionMode === 'demo' ? '시연 계정' : '비회원 확인';
  function stopLiveMotion() {
    livePulses.clear();
    clearCardFlashes();
    renderActivity();
    if (!liveMotionStopped) motion.reset();
    liveMotionStopped = true;
  }
  function pulse(event) {
    const node = projectFlowNode(event.node), from = projectFlowNode(event.from);
    if (!node) return;
    if (from) motion.pulse(node, event.state, { from });
    else motion.pulse(node, event.state);
  }

  // Saved outcomes remain available as text/data-state. Card colour describes
  // current work or a short, newly received event, never historical success.
  function clearCardFlashes() {
    if (cardFlashTimer) window.clearTimeout(cardFlashTimer);
    cardFlashTimer = 0;
    cardFlashes.clear();
  }

  function renderActivity() {
    if (disposed) return;
    const now = Date.now();
    for (const [id, flash] of cardFlashes) if (flash.until <= now) cardFlashes.delete(id);
    for (const [id, card] of cards) {
      const event = cardEvent(id);
      const neutral = card.dataset.state === 'uncollected' ? 'uncollected' : 'idle';
      const activity = mode === 'demo' ? card.dataset.state
        : document.hidden || !liveFresh() ? neutral
        : ACTIVE_STATES.has(event?.state) ? event.state
        : cardFlashes.get(id)?.state || neutral;
      if (card.dataset.activity !== activity) card.dataset.activity = activity;
    }
    if (cardFlashTimer) window.clearTimeout(cardFlashTimer);
    cardFlashTimer = 0;
    if (cardFlashes.size && !document.hidden && mode === 'live') {
      const deadline = Math.min(...[...cardFlashes.values()].map((flash) => flash.until));
      cardFlashTimer = window.setTimeout(() => { cardFlashTimer = 0; renderActivity(); }, Math.max(1, deadline - now));
    }
  }

  function applyTheme(value, persist = false) {
    theme = value === 'light' ? 'light' : 'dark';
    document.body.dataset.flowTheme = theme;
    for (const button of host.querySelectorAll('[data-flow-theme]')) button.setAttribute('aria-pressed', String(button.dataset.flowTheme === theme));
    motion.setTheme(theme);
    if (persist) {
      try { localStorage.setItem(THEME_KEY, theme); }
      catch { /* Appearance still changes when preference storage is unavailable. */ }
    }
  }

  function renderCases() {
    const query = caseSearch.trim().toLocaleLowerCase('ko-KR');
    const filtered = DEMO_ACTIONS.filter((action) => query
      ? `${action.label} ${action.description} ${action.precondition} ${DEMO_GROUPS.find((group) => group.id === action.group)?.label}`.toLocaleLowerCase('ko-KR').includes(query)
      : caseGroup === 'all' || action.group === caseGroup);
    $('[data-flow-case-count]').textContent = `${query ? '검색 결과' : DEMO_GROUPS.find((group) => group.id === caseGroup)?.label || '전체'} · ${filtered.length}가지`;
    for (const button of host.querySelectorAll('[data-flow-group]')) button.setAttribute('aria-pressed', String(!query && button.dataset.flowGroup === caseGroup));
    $('[data-flow-action-list]').innerHTML = filtered.length ? filtered.map((action) => `<button class="flow-action" data-flow-action="${action.id}" aria-pressed="${action.id === selectedDemoId}" aria-label="${esc(action.label)}"><span><strong>${esc(action.label)}</strong><small>${esc(action.description)}</small></span><span class="flow-outcome" data-outcome="${action.outcome}">${outcomes[action.outcome] || '시연'}</span></button>`).join('') : '<p class="flow-case-empty">해당하는 경우가 없습니다. 다른 검색어를 입력해 주세요.</p>';
  }

  function renderScenario() {
    const action = demoAction();
    const projected = [...new Set((action?.nodes || []).map(projectFlowNode))];
    const included = new Set(projected);
    for (const [id, card] of cards) {
      card.hidden = mode === 'demo' ? !included.has(id) : false;
      card.style.order = mode === 'demo' ? String(projected.indexOf(id)) : '';
    }
    for (const column of host.querySelectorAll('.flow-column')) {
      column.querySelector('.flow-column-empty').hidden = Boolean(column.querySelector('[data-flow-node]:not([hidden])'));
    }
    $('[data-flow-case-title]').textContent = action?.label || '경우를 선택해 주세요';
    $('[data-flow-case-condition]').textContent = action ? `시연 조건 · ${action.precondition}` : '';
    $('[data-flow-case-route]').textContent = action ? action.nodes.map((node) => FLOW_NODES.get(node).label).join(' → ') : '';
    motion.setEdges(projectFlowEdges(mode === 'demo' ? action?.edges || [] : LIVE_FLOW_EDGES));
    $('[data-flow-card-scope]').textContent = mode === 'demo' ? `가상 경우의 ${included.size}개 카드 · 세부 이벤트는 카드 선택` : `전체 ${FLOW_VIEW_NODES.size}개 · 통합 단계는 카드 선택`;
  }

  function renderConnection() {
    const demo = mode === 'demo';
    const shared = !demo && transportMode === 'central';
    const fresh = liveFresh();
    if (!demo && !fresh) stopLiveMotion();
    else liveMotionStopped = false;
    $('[data-flow-connection]').textContent = demo ? '가상 이벤트 시연' : fresh ? '이용 탭 연결됨' : '이용 탭 연결 대기';
    const source = liveSources.snapshot();
    const tabs = liveSources.options();
    const connectedTabs = tabs.filter((tab) => tab.connected && Date.now() - tab.connectedAt < 12000).length;
    const sourceSelect = $('[data-flow-source]');
    const sorted = shared ? [...tabs].sort((a, b) => b.updatedAt - a.updatedAt) : tabs;
    sourcePage = Math.min(sourcePage, Math.max(0, Math.ceil(sorted.length / 100) - 1));
    const visibleTabs = shared ? sorted.slice(sourcePage * 100, (sourcePage + 1) * 100) : tabs;
    if (shared && source && !visibleTabs.some((tab) => tab.key === source.key)) visibleTabs.unshift(source);
    const sourceOptions = `<option value="auto">${shared ? '최근 이용 자동 추적' : '최근 이용 탭 자동 추적'}</option>` + visibleTabs.map((tab) => `<option value="${esc(tab.key)}">${esc(tab.label)} · ${tab.mode === 'member' ? '회원' : tab.mode === 'guest' ? '비회원' : '인증 확인 중'}${!tab.connected ? ' · 연결 종료' : ''}</option>`).join('');
    if (sourceSelect.innerHTML !== sourceOptions) sourceSelect.innerHTML = sourceOptions;
    sourceSelect.value = liveSources.selection();
    $('[data-flow-source-label]').hidden = demo;
    $('[data-flow-scope]').textContent = demo ? '실제 요청을 실행하지 않습니다' : fresh ? `${source?.label || '현재 탭'} · ${!sessionKnown ? '인증 확인 중' : sessionMode === 'member' ? '회원' : sessionMode === 'demo' ? '시연 계정' : '비회원'} · 연결된 앱 탭 ${connectedTabs}개` : '같은 브라우저의 앱 탭을 열어 주세요';
    $('.flow-status-dot').dataset.connected = demo || fresh ? 'true' : 'false';
    $('[data-flow-banner]').textContent = demo
      ? '시연 모드입니다. 빛의 이동, 로그, 시간, 진행률은 모두 가상 데이터입니다.'
      : fresh && liveSources.selection() !== 'auto' ? `실시간 관찰 · ${source?.label || '현재 탭'}을 고정해 보고 있습니다. 다른 탭의 동작을 따라가려면 상단에서 최근 이용 탭 자동 추적을 선택해 주세요.`
      : fresh ? '실시간 관찰 · 최근 이용한 앱 탭을 자동으로 따라갑니다. 탭별 인증·분석 기록은 섞지 않으며, 자동 상태 조회는 관찰 탭을 바꾸지 않습니다. 위에서 특정 탭을 고정할 수 있습니다.'
      : source && liveSources.selection() !== 'auto' ? '고정 탭 연결 대기 · 관찰 중인 문서의 응답이 없습니다. 상단에서 현재 앱 탭을 다시 선택하거나 자동 추적으로 전환해 주세요.'
      : '연결 대기 · 같은 브라우저에서 CareerLens 앱을 열어 주세요. 새 탭의 로그인·로그아웃도 자동 추적하며, 탭을 고정했다면 자동 추적으로 전환해 주세요.';
    $('[data-flow-banner]').dataset.mode = mode;
    $('[data-flow-demo-controls]').hidden = !demo;
    $('[data-flow-simulator]').hidden = !demo;
    $('[data-flow-live-guide]').hidden = demo;
    $('[data-flow-log-note]').textContent = demo ? '시연 버튼으로 만든 가상 기록 · 서버 터미널 아님' : '관측한 동작 기록 · 서버 터미널 아님';
    $('[data-flow-chart-title]').textContent = demo ? '가상 API 응답 시간' : 'API 응답 시간';
    $('[data-flow-chart-note]').textContent = demo ? '시연용 예시 요청 시간 · 실제 요청 없음' : '실제 네트워크 요청 왕복만 · 최근 16개 · 분석 전체 시간과 다릅니다';
    $('[data-flow-map-hint]').textContent = demo ? '좁은 화면에서는 진행 단계로 지도가 이동합니다' : '단계를 선택해 상세 보기 · 좌우로 스크롤';
    $('[data-flow-global]').hidden = !shared;
    if (paired && !shared && !demo) {
      $('[data-flow-source-label]').hidden = true;
      $('[data-flow-connection]').textContent = fresh ? '원래 작업 창 연결됨' : '원래 작업 창 연결 대기';
      $('[data-flow-scope]').textContent = '이 관찰 창을 연 작업 창 하나만 표시합니다';
      $('[data-flow-banner]').textContent = fresh
        ? '1:1 관찰 · 연결된 작업 창의 동작만 실시간으로 표시합니다. 다른 창의 로그인·요청은 이 지도에 반영하지 않습니다.'
        : '원래 작업 창의 연결을 기다립니다. 그 창을 닫으면 관찰이 멈추며, 다른 작업 창으로 자동 전환하지 않습니다.';
      $('.flow-live-guide-note').textContent = '작업 창과 관찰 창은 1:1로 연결됩니다. 새 요청이 있을 때만 빛이 흐르며, 이전 완료 기록은 글자로만 남습니다.';
    }
    if (shared) {
      const sharedScope = centralState.scope === 'shared';
      $('[data-flow-connection]').textContent = centralState.state === 'connected' ? sharedScope ? '공용 서버 연결됨' : '단일 서버 연결됨' : '공용 서버 재연결 대기';
      $('[data-flow-scope]').textContent = `${source?.label || '대상 선택 대기'} · 아래 지도는 선택한 대상 한 개${source && Date.now() - source.updatedAt >= 120000 ? ' · 최근 이벤트 없음, 마지막 기록 표시' : ''}`;
      $('[data-flow-banner]').textContent = centralState.state === 'connected'
        ? sharedScope ? '전체 이용 관찰 · 공용 서버로 수집된 브라우저·회원 분석·비회원 분석 이벤트를 조회합니다. 특정 대상을 고정해도 전체 이용 기록은 계속 갱신됩니다.'
          : '단일 서버 관찰 · 공용 Redis 연결이 설정되지 않아 이 API 프로세스가 받은 기록만 보입니다. 여러 서버·워커를 운영하려면 공용 저장소를 설정해야 합니다.'
        : centralState.state === 'resyncing' ? '보관 기간 또는 수집 범위를 벗어난 기록이 있어 현재 상태를 다시 불러옵니다. 누락된 이력은 복구된 것으로 표시하지 않습니다.'
          : '전체 이용 수집 서버에 연결하는 중입니다. 연결되지 않은 동안 전체 요청이 관측되는 것으로 표시하지 않습니다. 브라우저만 관찰하려면 관찰 모드를 변경하세요.';
      const loss = centralState.gaps || liveSources.evicted() || liveSources.dropped();
      $('[data-flow-global-health]').textContent = `${loss ? `기록 공백 ${centralState.gaps}회 · 전송 대기 초과 ${liveSources.dropped()}건 · 범위 밖 대상 ${liveSources.evicted()}개 · ` : ''}${centralState.state === 'connected' ? '약 1초 간격 갱신' : '재연결 중'}`;
      $('[data-flow-global-summary]').textContent = `관찰 대상 ${Math.max(tabs.length, centralState.sources)}개 · 최근 ${allEvents.length}개 이벤트 표시 · 연결 후 수신 이벤트 ${centralState.received}건`;
      $('[data-flow-source-page]').textContent = `지도 대상 목록 ${sourcePage + 1} / ${Math.max(1, Math.ceil(tabs.length / 100))} · 페이지당 100개 · 서버 보관 범위 내 최근 최대 5,000개 대상`;
      $('[data-flow-source-prev]').disabled = sourcePage === 0;
      $('[data-flow-source-next]').disabled = (sourcePage + 1) * 100 >= tabs.length;
      const labels = new Map(tabs.map((tab) => [tab.key, tab.label]));
      const linked = source ? tabs.filter((tab) => tab.relatedPublisher === source.key || tab.key === source.relatedPublisher) : [];
      $('[data-flow-related]').innerHTML = linked.length ? '<span>선택한 대상과 연결된 기록</span>' + linked.slice(-20).map((tab) => `<button type="button" data-flow-pick="${esc(tab.key)}">${esc(tab.label)} 보기</button>`).join('') : '<span>선택한 대상과 연결된 분석 기록이 아직 없습니다.</span>';
      $('[data-flow-global-feed]').innerHTML = allEvents.length ? [...allEvents].reverse().map(({ key, event, receivedAt }) => `<button type="button" class="flow-global-row" data-flow-pick="${esc(key)}"><time>${time(receivedAt)}</time><span>${esc(labels.get(key) || '보관 범위 밖 대상')}</span><span>${esc(FLOW_NODES.get(event.node)?.label || event.node)}</span><span>${esc(flowEventLabel(event))}</span><span>${key.startsWith('browser:') ? '브라우저 관측' : '서버 기록'}</span></button>`).join('') : '<p class="flow-empty-log">수집된 이벤트가 없습니다. 새 이벤트가 들어오면 모든 대상의 기록이 여기에 표시됩니다.</p>';
      $('[data-flow-log-note]').textContent = '선택한 대상의 최근 100개 이벤트 · 전체 이용 기록은 위 목록';
    }
  }

  function renderDetail() {
    const definition = FLOW_VIEW_NODES.get(chosen);
    const event = cardEvent(chosen);
    $('[data-flow-detail-state]').textContent = mode === 'live' && chosen === 'auth' ? authLabel() : event ? flowEventLabel(event, sessionMode) : waitingLabel(definition);
    const guestNotes = {
      guest_store: '프론트 서버가 생성된 결과를 저장한 상태입니다. 인증 전에는 본문·점수를 브라우저로 보내지 않습니다. 기존 백엔드 보고서 DB에 저장한 뜻은 아닙니다.',
      report_lock: '분석·저장이 끝난 보고서를 잠그고 인증을 기다립니다. 이 단계에 도착한 것만으로 보고서 표시가 완료되지는 않습니다.',
      guest_claim: '인증한 계정에 기존 결과를 연결합니다. 계산을 다시 시작하거나 백엔드 보고서 DB로 이관하는 요청이 아닙니다.',
      result_delivery: '인증 성공을 확인한 시점부터 완성된 보고서를 화면에 표시할 때까지 잽니다. 목표는 3초 이내이며, 측정 전에는 달성 여부를 알 수 없습니다. 실패 시간은 표시 완료 시간이 아닙니다.',
      guest_cleanup: '취소·만료·삭제의 확인 상태입니다. 비회원 임시 보관은 첫 첨부 기준 최대 30분입니다. 다른 계정의 보고서를 삭제한 뜻은 아닙니다.',
    };
    const source = event ? event.source === 'backend' && event.execution === 'guest' ? '프론트 서버 응답 · 비회원 분석' : FLOW_SOURCES[event.source] : '기록 없음';
    const timeLabel = event?.node === 'result_delivery' ? '인증 후 표시 시간' : chosen === 'analysis' ? '서버 분석 시간' : event?.kind === 'request' ? '요청 왕복 시간' : '측정 시간';
    $('[data-flow-detail]').innerHTML = `<h3>${definition.label}</h3><p>${description(chosen)}</p><dl><div><dt>최근 세부 단계</dt><dd>${event ? FLOW_NODES.get(event.node).label : '기록 없음'}</dd></div><div><dt>정보 출처</dt><dd>${source}</dd></div><div><dt>최근 이벤트</dt><dd>${event ? time(event.at) : '—'}</dd></div>${event?.method ? `<div><dt>요청 방식</dt><dd>${event.method}</dd></div>` : ''}${event?.criterion ? `<div><dt>최근 평가 항목</dt><dd>${event.criterion}</dd></div>` : ''}<div><dt>${timeLabel}</dt><dd>${event ? duration(event.durationMs) : '미측정'}</dd></div><div><dt>전체 분석 진행률</dt><dd>${event?.progress !== null && event?.progress !== undefined ? `${Math.round(event.progress)}%` : '미제공'}</dd></div></dl><p class="flow-detail-note">${mode === 'demo' ? '가상 시연의 예시 상태·시간입니다. 실제 인증·분석·데이터 저장은 실행하지 않습니다.' : guestNotes[event?.node] || (definition.telemetry ? (chosen.startsWith('domain_') ? '표시된 항목의 최근 상태입니다. 항목 하나의 완료는 영역 전체 완료를 뜻하지 않습니다.' : '서버가 보낸 진행 이벤트와 전체 실행 상태를 표시합니다. 이벤트가 없으면 이전 단계의 완료로 추정하지 않습니다.') : definition.internal ? '이 단계의 개별 이벤트는 제공되지 않습니다. 앞 단계의 완료로 실행을 추정하지 않습니다.' : chosen === 'storage_ack' ? '회원가입·이력서 저장 API의 성공 응답을 확인한 상태입니다. DB 내부 처리 시간은 제공되지 않습니다.' : event?.kind === 'request' ? '네트워크와 서버 응답을 포함한 왕복 시간입니다. 서버 내부 계산 시간과 다를 수 있습니다.' : '이름·이메일·입력 본문을 포함하지 않는 단계 상태입니다.')}</p>`;
    if (definition.members.length > 1) {
      $('[data-flow-detail]').innerHTML += `<h4>통합된 세부 기록</h4><ul class="flow-detail-members">${definition.members.map((node) => {
        const value = currentNodeEvent(node);
        return `<li><strong>${FLOW_NODES.get(node).label}</strong><span>${value ? flowEventLabel(value) : '기록 없음'}${value?.durationMs !== null && value?.durationMs !== undefined ? ` · ${duration(value.durationMs)}` : ''}</span></li>`;
      }).join('')}</ul>`;
    }
    if (mode === 'live' && chosen === 'auth') $('[data-flow-detail]').innerHTML += `<p class="flow-detail-note">현재 인증 상태: ${authLabel()}. 위의 최근 이벤트는 화면 이동·요청 기록이며 현재 로그인 상태와 별도로 표시합니다.</p>`;
    if (chosen === 'report') $('[data-flow-detail]').innerHTML += deliveryDetail();
    for (const [id, card] of cards) card.setAttribute('aria-pressed', String(id === chosen));
  }

  function renderChart() {
    const requests = events.filter((event) => event.kind === 'request' && event.durationMs !== null).slice(-16);
    $('[data-flow-request-count]').textContent = requests.length ? `${requests.length}개 요청` : '미측정';
    if (!requests.length) {
      $('[data-flow-chart]').innerHTML = mode === 'demo'
        ? playback.snapshot().actionId && !demoAction().steps.some((step) => step[5] === 'request')
          ? '<div class="flow-empty-chart"><span>이 경우에는 API 요청이 없습니다.</span><small>브라우저 안에서 처리하거나 요청 전에 중단합니다.</small></div>'
          : '<div class="flow-empty-chart"><span>가상 응답 시간 대기</span><small>시연의 요청이 끝나면 예시 시간이 표시됩니다.</small></div>'
        : '<div class="flow-empty-chart"><span>아직 측정된 요청이 없습니다.</span><small>요청이 끝나면 응답 시간이 표시됩니다.</small></div>';
      return;
    }
    const max = Math.max(1, ...requests.map((event) => event.durationMs));
    const points = requests.map((event, i) => [24 + i * 290 / Math.max(1, requests.length - 1), 114 - event.durationMs / max * 86]);
    const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    $('[data-flow-chart]').innerHTML = `<div class="flow-chart-value"><strong>${duration(requests.at(-1).durationMs)}</strong><span>최근 완료 요청</span></div><svg viewBox="0 0 340 145" role="img" aria-label="최근 ${requests.length}개 API 요청의 왕복 시간. 최댓값 ${esc(duration(max))}"><path class="flow-chart-grid" d="M24 28H316M24 71H316M24 114H316"/><text x="24" y="18">${esc(duration(max))}</text><text x="24" y="136">0 ms</text><text x="284" y="136">최근</text><polyline class="flow-chart-line" points="${line}"/>${points.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="3"><title>${FLOW_NODES.get(requests[i].node).label}: ${duration(requests[i].durationMs)}</title></circle>`).join('')}</svg>`;
  }

  function waitingLabel(definition) {
    if (mode === 'live' && definition.id === 'database') return guestFlowActive() || sessionMode === 'guest' ? '비회원 저장 기록 대기' : '저장 기록 대기';
    if (mode === 'live' && definition.id === 'guest_store') return '프론트 서버 저장 기록 대기';
    if (mode === 'live' && definition.telemetry) return guestFlowActive() || sessionMode === 'guest' ? '비회원 분석 기록 대기' : '회원 워커 기록 대기';
    return mode === 'live' && definition.internal ? definition.telemetry ? '서버 이벤트 대기' : '미수집' : '이벤트 대기';
  }

  function guestFlowActive() {
    return mode === 'demo' ? Boolean(demoAction()?.nodes.includes('api_guest_analysis'))
      : ['analysis', 'guest_store', 'report_lock', 'guest_claim', 'result_delivery', 'api_guest_analysis'].some((node) => {
        const event = nodeStates.get(node);
        return event && (event.execution === 'guest' || node !== 'analysis');
      });
  }

  function deliveryDetail() {
    const delivery = nodeStates.get('result_delivery');
    const report = nodeStates.get('report');
    const delivered = delivery?.state === 'complete' && ['complete', 'partial'].includes(report?.state);
    const measured = delivered && delivery.durationMs !== null;
    const value = delivered ? duration(delivery.durationMs) : delivery?.state === 'failed' ? '결과 표시 실패' : delivery?.state === 'pending' ? '측정 중' : '미측정';
    const goal = measured ? delivery.durationMs <= 3000 ? '3초 이내 표시 확인' : '3초 목표 초과 · 결과 연결·표시 시간 확인 필요' : '목표 3초 이내 · 실제 표시 완료 전에는 판단하지 않습니다';
    return `<div class="flow-detail-timing"><h4>인증 완료 → 보고서 표시</h4><strong>${value}</strong><p>${mode === 'demo' ? '가상 예시 · ' : ''}${goal}</p><p>기존 결과를 연결해 화면에 표시한 시간입니다. 분석 시간과 별도로 측정합니다.</p></div>`;
  }
  function renderEvents() {
    for (const [id, card] of cards) {
      const event = cardEvent(id);
      const definition = FLOW_VIEW_NODES.get(id);
      const verifiedAuth = mode === 'live' && id === 'auth';
      const text = verifiedAuth ? event && event.kind !== 'session' ? `최근 동작 · ${flowEventLabel(event)}` : '관찰 중인 탭에서 확인된 인증 상태' : event && event.node !== id ? FLOW_NODES.get(event.node).label : description(id);
      const state = verifiedAuth ? sessionKnown ? sessionMode === 'member' ? 'member' : sessionMode === 'guest' ? 'guest' : 'ready' : 'idle' : event?.kind === 'navigation' ? 'viewed' : event?.state || (definition.internal && mode === 'live' ? 'uncollected' : 'idle');
      const status = verifiedAuth ? authLabel() : event ? flowEventLabel(event, sessionMode) : waitingLabel(definition);
      const hasProgress = event?.progress !== null && event?.progress !== undefined;
      const value = hasProgress ? `${Math.round(event.progress)}%` : event?.durationMs !== null && event?.durationMs !== undefined ? duration(event.durationMs) : '—';
      const signature = JSON.stringify([text, state, status, value, hasProgress ? event.progress : null]);
      if (renderedCards.get(id) === signature) continue;
      renderedCards.set(id, signature);
      card.querySelector('.flow-node-description').textContent = text;
      card.dataset.state = state;
      card.querySelector('[data-node-status]').textContent = status;
      card.querySelector('[data-node-value]').textContent = value;
      const progress = card.querySelector('[data-node-progress]');
      progress.style.transform = `scaleX(${hasProgress ? event.progress / 100 : 0})`;
      card.classList.toggle('has-progress', hasProgress);
    }
    renderActivity();
    $('[data-flow-event-count]').textContent = events.length;
    $('[data-flow-log]').innerHTML = events.length ? [...events].reverse().slice(0, 100).map((event) => `<div class="flow-log-row" data-state="${event.state}"><time>${time(event.at)}</time><span class="flow-log-node">${FLOW_NODES.get(event.node).label}</span><span>${flowEventLabel(event, sessionMode)}</span><span class="flow-log-duration">${event.durationMs === null ? '—' : duration(event.durationMs)}</span></div>`).join('') : `<p class="flow-empty-log">${mode === 'demo' ? '위의 기능 버튼을 누르면 가상 기록이 쌓입니다.' : '연결된 앱을 사용하면 여기에 기록이 쌓입니다.'}</p>`;
    const last = events.at(-1);
    $('[data-flow-latest]').textContent = last ? `${time(last.at)} · ${FLOW_NODES.get(last.node).label} · ${flowEventLabel(last, sessionMode)}` : '이벤트를 기다리고 있습니다.';
    renderDetail();
    renderChart();
    motion.syncActive?.(mode === 'live' && !liveFresh() ? [] : [...cards.keys()].flatMap((node) => {
      const value = cardEvent(node);
      if (!value || !['pending', 'running', 'queued'].includes(value.state)) return [];
      const from = projectFlowNode(value.from);
      return [{ node, state: value.state, ...(from ? { from } : {}) }];
    }));
  }

  // Keep every bounded metadata update, but commit the view only once per frame.
  // A burst of list requests must not rebuild the 100-row log for every message.
  function scheduleLiveRender() {
    liveDirty = true;
    if (liveFrame || document.hidden || disposed || mode !== 'live') return;
    liveFrame = window.requestAnimationFrame(() => {
      liveFrame = 0;
      if (document.hidden || disposed || mode !== 'live') return;
      liveDirty = false;
      renderConnection();
      renderEvents();
      if (liveFresh()) for (const event of livePulses.values()) pulse(event);
      livePulses.clear();
    });
  }

  function clearLiveRender() {
    if (liveFrame) window.cancelAnimationFrame(liveFrame);
    liveFrame = 0;
    liveDirty = false;
    livePulses.clear();
    clearCardFlashes();
  }

  function accept(value, animate = true) {
    const event = normalizeFlowEvent(value, { demo: mode === 'demo' });
    if (!event) return;
    // Receiving the same event again is state synchronization, not new traffic.
    const previous = events.findIndex((item) => item.id === event.id);
    const retained = previous < 0 ? null : events[previous];
    const current = nodeStates.get(event.node);
    const supersedes = (before) => !before || ((mode === 'live' && transportMode === 'central' || before.at <= event.at)
      && !(before.id === event.id && !['pending', 'running', 'queued'].includes(before.state)
        && ['pending', 'running', 'queued'].includes(event.state)));
    // A delayed pending copy must not undo its own completion in history, reset
    // a newer run, or create fresh traffic after the current state has moved on.
    if (!supersedes(retained)) return;
    const changed = previous < 0 || JSON.stringify(events[previous]) !== JSON.stringify(event);
    const updatesCurrent = supersedes(current);
    if (changed && updatesCurrent && event.node === 'evaluate' && event.state === 'pending') {
      for (const id of FLOW_RUN_NODES) { nodeStates.delete(id); cardFlashes.delete(projectFlowNode(id)); }
      events = events.filter((item) => !(FLOW_RUN_NODES.includes(item.node) && item.kind === 'request' && ACTIVE_STATES.has(item.state)));
    }
    if (updatesCurrent) nodeStates.set(event.node, event);
    if (updatesCurrent && event.node === 'analysis' && ['complete', 'partial', 'failed', 'cancelled'].includes(event.state)) {
      for (const [node, previous] of nodeStates) {
        if (node !== 'analysis' && FLOW_RUN_NODES.includes(node) && previous.kind === 'progress' && ACTIVE_STATES.has(previous.state)) {
          nodeStates.delete(node); cardFlashes.delete(projectFlowNode(node)); livePulses.delete(projectFlowNode(node));
        }
      }
    }
    if (mode === 'live' && event.kind === 'session' && event.sessionMode && updatesCurrent) {
      sessionMode = event.sessionMode;
      sessionKnown = true;
    }
    const retainedIndex = events.findIndex((item) => item.id === event.id);
    if (retainedIndex >= 0) events.splice(retainedIndex, 1);
    events.push(event);
    if (mode !== 'live' || transportMode !== 'central') events.sort((a, b) => a.at - b.at);
    events = events.slice(-100);
    if (animate && changed && updatesCurrent && mode === 'demo') pulse(event);
    else if (animate && changed && updatesCurrent && !document.hidden) {
      const node = projectFlowNode(event.node);
      livePulses.set(node, event);
      if (ACTIVE_STATES.has(event.state)) cardFlashes.delete(node);
      else cardFlashes.set(node, { state: event.state, until: Date.now() + CARD_FLASH_MS });
    }
  }

  function subscribe() {
    if (mode === 'live' && transportMode === 'local') channel?.postMessage({ kind: 'subscribe', stream, ...(paired ? {} : { scope: 'browser' }) });
  }

  function renderDemo() {
    const state = playback.snapshot();
    const action = getDemoAction(state.actionId);
    const last = events.at(-1);
    const status = !action ? '시연 대기' : state.complete ? `${outcomes[action.outcome] || '전체'} 흐름 시연 완료` : state.playing ? '가상 실행 중' : '일시정지';
    $('[data-flow-demo-state]').textContent = status;
    $('[data-flow-demo-state]').dataset.state = state.complete ? action.outcome === 'failure' ? 'failed' : action.outcome === 'blocked' ? 'blocked' : 'complete' : state.playing ? 'running' : 'idle';
    const message = !action ? '버튼을 누르면 이 경우의 경로와 결과를 보여줍니다. 실제 요청은 실행하지 않습니다.'
      : state.complete ? action.completeMessage
      : `${action.label} · ${last ? `${FLOW_NODES.get(last.node).label} · ${flowEventLabel(last)}${last.progress === null ? '' : ` ${Math.round(last.progress)}%`}` : '준비 중'}`;
    // Update only when the step changes, so screen readers do not announce timer ticks.
    if ($('[data-flow-demo-message]').textContent !== message) $('[data-flow-demo-message]').textContent = message;
    for (const button of host.querySelectorAll('[data-flow-action]')) button.setAttribute('aria-pressed', String(button.dataset.flowAction === selectedDemoId));
    $('[data-flow-play]').disabled = !action;
    $('[data-flow-play]').innerHTML = `${glyph(state.playing ? 'pause' : 'play')}<span>${!action ? '재생 대기' : state.playing ? '일시정지' : state.complete ? '다시 재생' : '이어보기'}</span>`;
  }

  function demoTick() {
    if (mode !== 'demo' || document.hidden || disposed) return;
    const now = performance.now();
    const before = playback.snapshot();
    playback.tick(Math.min(400, now - demoLastTick));
    demoLastTick = now;
    const after = playback.snapshot();
    if (after.index !== before.index) { renderEvents(); renderDemo(); followDemoNode(events.at(-1)?.node); }
    if (!after.playing) clearInterval(demoTimer);
  }

  function runDemoTimer() {
    clearInterval(demoTimer);
    demoLastTick = performance.now();
    demoTimer = setInterval(demoTick, 100);
  }

  function followDemoNode(node) {
    const card = cards.get(projectFlowNode(node));
    const scroller = $('.flow-map-scroll');
    if (!card || scroller.scrollWidth <= scroller.clientWidth) return;
    const bounds = scroller.getBoundingClientRect();
    const target = card.getBoundingClientRect();
    if (target.left >= bounds.left && target.right <= bounds.right) return;
    scroller.scrollTo({ left: scroller.scrollLeft + target.left - bounds.left - (scroller.clientWidth - target.width) / 2, behavior: reduceMotion ? 'instant' : 'smooth' });
  }

  function startDemo(id) {
    if (mode !== 'demo' || !getDemoAction(id)) return;
    clearInterval(demoTimer);
    motion.reset();
    events = [];
    nodeStates.clear();
    selectedDemoId = id;
    chosen = projectFlowNode(getDemoAction(id).focusNode);
    renderScenario();
    playback.start(id);
    renderEvents();
    renderDemo();
    followDemoNode(events.at(-1)?.node);
    runDemoTimer();
  }

  function resetDemo() {
    clearInterval(demoTimer);
    playback.reset();
    motion.reset();
    events = [];
    nodeStates.clear();
    renderScenario();
    renderEvents();
    renderDemo();
  }

  function switchMode(next) {
    clearInterval(demoTimer);
    clearLiveRender();
    playback.reset();
    motion.reset();
    mode = next === 'local' ? 'live' : next;
    transportMode = next === 'local' || !central ? 'local' : 'central';
    monitor?.pause();
    liveSources = makeSources();
    allEvents = []; sourcePage = 0; pendingPin = null;
    events = [];
    nodeStates.clear();
    connectedAt = 0;
    sessionKnown = false;
    liveMotionStopped = false;
    $('[data-flow-mode]').value = mode === 'demo' ? 'demo' : transportMode === 'local' && central ? 'local' : 'live';
    chosen = mode === 'demo' ? projectFlowNode(demoAction().focusNode) : 'analysis';
    renderScenario();
    renderConnection();
    renderEvents();
    renderDemo();
    if (mode === 'live') {
      if (transportMode === 'central') monitor?.restart();
      else subscribe();
    }
  }

  function applyLiveSnapshot(snapshot) {
    livePulses.clear();
    clearCardFlashes();
    events = [];
    nodeStates.clear();
    for (const value of snapshot?.events || []) accept(value, false);
    nodeStates.clear();
    for (const value of snapshot?.states || []) nodeStates.set(value.node, value);
    sessionKnown = ['guest', 'member', 'demo'].includes(snapshot?.session?.mode);
    sessionMode = sessionKnown ? snapshot.session.mode : 'guest';
    connectedAt = snapshot?.connected ? snapshot.connectedAt : 0;
  }

  function receive(data, { snapshot = false } = {}) {
      if (disposed || mode !== 'live') return;
      const change = liveSources.receive(data);
      if (!change) return;
      if (pendingPin && change.key === pendingPin) {
        change.snapshot = liveSources.select(pendingPin);
        change.selectedChanged = true; change.selectedUpdated = true;
        pendingPin = null;
      }
      if (transportMode === 'central') {
        // Unchanged heartbeat history may already have aged out of the global
        // 200-row feed. It must not return as new traffic at heartbeat time.
        for (const value of change.historyUpdates) {
          const event = normalizeFlowEvent(value);
          if (!event) continue;
          const previous = allEvents.findIndex((row) => row.key === change.key && row.event.id === event.id);
          const receivedAt = data.kind === 'snapshot' && previous >= 0 ? allEvents[previous].receivedAt
            : Number.isFinite(data.at) && data.at >= 0 ? data.at : Date.now();
          if (previous >= 0) allEvents.splice(previous, 1);
          allEvents.push({ key: change.key, event, receivedAt });
        }
        allEvents.sort((a, b) => a.receivedAt - b.receivedAt);
        allEvents = allEvents.slice(-200);
      }
      if (change.selectedUpdated) {
        if (change.selectedChanged || change.kind === 'snapshot') {
          if (change.selectedChanged) motion.reset();
          applyLiveSnapshot(change.snapshot);
          // Selecting another document restores its own history without replay.
          // Only the actual incoming event may flash once on that new document.
          if (change.event && !snapshot && !document.hidden) {
            const node = projectFlowNode(change.event.node);
            livePulses.set(node, change.event);
            if (!ACTIVE_STATES.has(change.event.state)) cardFlashes.set(node, { state: change.event.state, until: Date.now() + CARD_FLASH_MS });
          }
        } else if (change.event) accept(change.event, !snapshot);
        connectedAt = change.snapshot?.connected ? change.snapshot.connectedAt : 0;
        if (!connectedAt) stopLiveMotion();
      }
      scheduleLiveRender();
  }

  monitor = central ? createCentralFlowMonitor({ request,
    onReset() {
      if (disposed || transportMode !== 'central') return;
      pendingPin = liveSources.selection() !== 'auto' ? liveSources.selection() : pendingPin;
      liveSources.clear(); allEvents = []; events = []; nodeStates.clear();
      motion.reset(); clearLiveRender(); scheduleLiveRender();
    },
    onEnvelope: receive,
    onStatus(status) {
      if (disposed || mode !== 'live' || transportMode !== 'central') return;
      centralState = status;
      if (status.state === 'connected') centralLastSeen = Date.now();
      if (status.state === 'unauthorized') {
        allEvents = []; events = []; nodeStates.clear(); liveSources.clear();
        dispose(); host.innerHTML = ''; onUnauthorized(); return;
      }
      scheduleLiveRender();
    },
  }) : null;
  try {
    channel = new BroadcastChannel('careerlens.flow.v1');
    channel.addEventListener('message', ({ data }) => {
      if (transportMode === 'local') receive(data);
    });
  } catch { /* The view still supports the clearly labelled offline demonstration. */ }

  function onClick(event) {
    const pick = event.target.closest('[data-flow-pick]');
    if (pick) { onSource({ target: { value: pick.dataset.flowPick } }); return; }
    if (event.target.closest('[data-flow-source-prev]')) { sourcePage = Math.max(0, sourcePage - 1); renderConnection(); return; }
    if (event.target.closest('[data-flow-source-next]')) { sourcePage++; renderConnection(); return; }
    const themeButton = event.target.closest('[data-flow-theme]');
    if (themeButton && host.contains(themeButton)) applyTheme(themeButton.dataset.flowTheme, true);
    const card = event.target.closest('[data-flow-node]');
    if (card) { chosen = card.dataset.flowNode; renderDetail(); }
    if (event.target.closest('[data-flow-motion]')) {
      reduceMotion = !reduceMotion;
      motion.setPaused(reduceMotion);
      $('[data-flow-motion]').setAttribute('aria-pressed', String(reduceMotion));
      $('[data-flow-motion]').setAttribute('aria-label', reduceMotion ? '빛의 움직임 켜기' : '동작 줄이기');
    }
    if (mode !== 'demo') return;
    const group = event.target.closest('[data-flow-group]');
    if (group) {
      caseGroup = group.dataset.flowGroup;
      caseSearch = '';
      $('[data-flow-search]').value = '';
      renderCases();
    }
    const action = event.target.closest('[data-flow-action]');
    if (action) startDemo(action.dataset.flowAction);
    if (event.target.closest('[data-flow-restart]')) resetDemo();
    if (event.target.closest('[data-flow-play]')) {
      const state = playback.snapshot();
      if (state.playing) {
        playback.pause();
        clearInterval(demoTimer);
        motion.reset();
      } else if (state.complete) startDemo(state.actionId);
      else if (playback.resume()) runDemoTimer();
      renderDemo();
    }
  }
  function onMode(event) { switchMode(event.target.value === 'local' && central ? 'local' : event.target.value === 'live' && (central || stream) ? 'live' : 'demo'); }
  function onSource(event) {
    if (mode !== 'live' || paired && transportMode === 'local') return;
    const snapshot = liveSources.select(event.target.value);
    if (!snapshot) return;
    motion.reset();
    applyLiveSnapshot(snapshot);
    scheduleLiveRender();
  }
  function onSearch(event) { caseSearch = event.target.value; renderCases(); }
  function onVisibility() {
    demoLastTick = performance.now();
    if (document.hidden) {
      monitor?.pause();
      if (liveFrame) window.cancelAnimationFrame(liveFrame);
      liveFrame = 0;
      livePulses.clear();
      clearCardFlashes();
      renderActivity();
    } else {
      renderActivity();
      if (liveDirty) scheduleLiveRender();
      subscribe();
      if (mode === 'live' && transportMode === 'central') monitor?.start();
    }
  }
  function onBlur() {
    if (mode !== 'live') return;
    livePulses.clear();
    clearCardFlashes();
    motion.reset();
    renderActivity();
  }
  window.addEventListener('blur', onBlur);
  host.addEventListener('click', onClick);
  $('[data-flow-mode]').addEventListener('change', onMode);
  $('[data-flow-source]').addEventListener('change', onSource);
  $('[data-flow-search]').addEventListener('input', onSearch);
  document.addEventListener('visibilitychange', onVisibility);
  const heartbeat = setInterval(() => { if (!document.hidden) { subscribe(); renderConnection(); } }, 4000);
  $('[data-flow-motion]').setAttribute('aria-pressed', String(reduceMotion));
  applyTheme(theme);
  renderCases();
  switchMode(mode);

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearLiveRender();
    clearInterval(heartbeat);
    clearInterval(demoTimer);
    monitor?.dispose();
    channel?.close();
    motion.destroy();
    host.removeEventListener('click', onClick);
    $('[data-flow-mode]')?.removeEventListener('change', onMode);
    $('[data-flow-source]')?.removeEventListener('change', onSource);
    $('[data-flow-search]')?.removeEventListener('input', onSearch);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('blur', onBlur);
  }
  let restoredDispose = null;
  let restoreFromCache = null;
  function onPageHide(event) {
    dispose();
    if (event.persisted) {
      restoreFromCache = () => {
        restoreFromCache = null;
        restoredDispose = mountFlowViewer(host, { central, paired, onUnauthorized, request });
      };
      window.addEventListener('pageshow', restoreFromCache, { once: true });
    }
  }
  window.addEventListener('pagehide', onPageHide);
  return () => {
    dispose();
    if (restoreFromCache) window.removeEventListener('pageshow', restoreFromCache);
    restoreFromCache = null;
    restoredDispose?.();
    restoredDispose = null;
  };
}
