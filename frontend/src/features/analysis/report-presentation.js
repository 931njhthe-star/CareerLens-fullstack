// Display labels only: the saved report and API enum values remain unchanged.
const STATUS_LABELS = Object.freeze({
  completed: '완료',
  complete: '완료',
  succeeded: '완료',
  passed: '검증 통과',
  partial: '일부 확인 필요',
  needs_review: '추가 검토 필요',
  met: '충족',
  not_met: '미충족',
  unknown: '확인 필요',
  not_applicable: '평가 제외',
  failed: '실패',
  pending: '대기 중',
  queued: '대기 중',
  running: '진행 중',
  cancelled: '취소됨',
  canceled: '취소됨',
  hold: '보류',
});

export function backendStatusLabel(value) {
  return Object.hasOwn(STATUS_LABELS, value)
    ? STATUS_LABELS[value]
    : String(value ?? '') || '제공되지 않음';
}

// Round only the displayed text; API values and pyramid geometry keep full precision.
export function displayScore(value, unavailable = '제공되지 않음') {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(Math.round(value))
    : unavailable;
}

const QUESTION_HEADINGS = new Set([
  '다음 대화에서 나올 수 있는 질문',
  '예상 면접 질문',
  '면접 예상 질문',
]);
const STATUS_FIELDS = [
  '지원 자격 상태',
  '평가 상태',
  '검증 상태',
  '지원 자격',
  '백엔드 판정',
  '종합 판정',
  '판정',
  '상태',
  'validation_status',
  'eligibility_status',
  'status',
  'verdict',
].join('|');
const FIELD_VALUE = new RegExp(
  `(^|[\\s·;])((?:\\*\\*|__)?(?:${STATUS_FIELDS})(?:\\*\\*|__)?\\s*[:：]\\s*(?:\\*\\*|__)?)([a-z_]+)((?:\\*\\*|__)?)(?=\\s*(?:$|[.;·。!?]))`,
  'g',
);

function localizeCell(cell) {
  // An entire value can be emphasized or styled as an enum; prose is never rewritten.
  return cell.replace(
    /^(\s*)(?:(\*\*|__|`)([a-z_]+)\2|([a-z_]+))(\s*)$/,
    (raw, before, style, wrapped, plain, after) => {
      const value = wrapped || plain;
      return Object.hasOwn(STATUS_LABELS, value)
        ? `${before}${style || ''}${STATUS_LABELS[value]}${style || ''}${after}`
        : raw;
    },
  );
}

function localizeFields(line) {
  // Do not interpret links, URLs or inline code as status fields.
  const protectedParts = [];
  const protectedLine = line.replace(
    /(`+)[^`]*\1|\[[^\]\n]*\]\([^\n)]*\)|https?:\/\/[^\s<>]+/g,
    (part) => {
      protectedParts.push(part);
      return `\u0000${protectedParts.length - 1}\u0000`;
    },
  );
  return protectedLine
    .replace(FIELD_VALUE, (raw, boundary, field, value, style) =>
      Object.hasOwn(STATUS_LABELS, value)
        ? `${boundary}${field}${STATUS_LABELS[value]}${style}`
        : raw,
    )
    .replace(/\u0000(\d+)\u0000/g, (_, index) => protectedParts[Number(index)] ?? '');
}

export function displayReportSummary(raw) {
  const text = String(raw ?? '');
  return localizeFields(localizeCell(text));
}

function scoreCell(cell) {
  return cell.replace(
    /^(\s*)(\*\*|__)?(\d+(?:\.\d+)?)(\2)(점)?(\s*)$/,
    (_, before, style = '', number, _close, unit = '', after) =>
      `${before}${style}${displayScore(Number(number))}${style}${unit}${after}`,
  );
}

function localizeTableRow(line, scoreColumns = []) {
  // Keep escaped pipes and all original spacing intact.
  let cell = '';
  let output = '';
  let escaped = false;
  let column = 0;
  const format = () =>
    scoreColumns.includes(column) ? scoreCell(localizeCell(cell)) : localizeCell(cell);
  for (const character of line) {
    if (character === '|' && !escaped) {
      output += `${format()}|`;
      column += 1;
      cell = '';
    } else {
      cell += character;
    }
    escaped = character === '\\' && !escaped;
  }
  return output + format();
}

function questionHeading(title) {
  const normalized = title
    .replace(/\s+#+\s*$/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^(\*\*|__)(.*?)\1$/, '$2')
    .trim();
  return QUESTION_HEADINGS.has(normalized);
}

export function displayReportMarkdown(raw) {
  const text = String(raw ?? '');
  const lines = text.split(/\r?\n/);
  const output = [];
  let fence = null;
  let hiddenHeadingLevel = 0;
  let table = false;
  let scoreColumns = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (!hiddenHeadingLevel) output.push(line);
      if (fence.test(line)) fence = null;
      continue;
    }
    const openingFence = /^\s*(`{3,}|~{3,})[^`~]*$/.exec(line);
    if (openingFence) {
      fence = new RegExp(`^\\s*${openingFence[1][0]}{${openingFence[1].length},}\\s*$`);
      if (!hiddenHeadingLevel) output.push(line);
      table = false;
      continue;
    }
    const heading = /^ {0,3}(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      if (hiddenHeadingLevel && heading[1].length <= hiddenHeadingLevel) hiddenHeadingLevel = 0;
      if (!hiddenHeadingLevel && questionHeading(heading[2]))
        hiddenHeadingLevel = heading[1].length;
      table = false;
    }
    if (hiddenHeadingLevel) continue;
    // Internal evaluation identifiers are not report content. Keep quoted/code evidence intact.
    if (/^\s*(?:[-*+]\s+)?(?:\*\*|__)?평가\s*ID(?:\*\*|__)?\s*[:：]/i.test(line)) continue;
    if (
      line.includes('|') &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] || '')
    ) {
      table = true;
      scoreColumns = line
        .split('|')
        .flatMap((cell, column) =>
          /^(?:평가 )?점수$/.test(cell.replace(/\*\*|__/g, '').trim()) ? [column] : [],
        );
    } else if (!line.trim() || !line.includes('|')) {
      table = false;
      scoreColumns = [];
    }
    output.push(
      table
        ? localizeTableRow(line, scoreColumns)
        : localizeFields(line).replace(
            /^(\s*[-*+]\s+종합 매칭 점수:\s*)(.+)$/,
            (_, prefix, value) => prefix + scoreCell(value),
          ),
    );
  }
  return output.join(text.includes('\r\n') ? '\r\n' : '\n');
}
