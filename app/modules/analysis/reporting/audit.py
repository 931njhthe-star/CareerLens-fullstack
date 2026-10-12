import json
from pathlib import Path
from uuid import UUID


def render_execution_report(run_id: str, calls: list[dict], stage_timings: list[dict]) -> str:
    lines = [
        '# 평가 실행 기록',
        '',
        f'- 평가 run ID: `{UUID(run_id)}`',
        f'- LLM 호출 수: {len(calls)}',
        f'- 계측 단계 수: {len(stage_timings)}',
        '',
        '이 문서는 서버가 실제 사용자 요청을 처리하며 수집한 내부 운영 기록입니다. 프롬프트와 이력서·공고 원문은 포함하지 않습니다. 모델 응답에는 근거 인용이 포함될 수 있으므로 접근을 제한하세요.',
        '',
        '## 단계별 소요 시간',
        '',
        '| 단계 | 기준 | 시도 | 상태 | 소요 시간(ms) | 오류 유형 |',
        '|---|---|---:|---|---:|---|',
    ]
    for timing in stage_timings:
        error_type = timing.get('details', {}).get('error_type', '—')
        lines.append(
            f"| {timing['stage']} | {timing.get('criterion_code') or '—'} "
            f"| {timing.get('attempt_number', 1)} | {timing['status']} "
            f"| {timing['duration_ms']} | {error_type} |"
        )
    lines.extend([
        '',
        '## LLM 호출 기록',
        '',
        '| # | 단계 | 항목 | 스키마 | 결과 | 소요 시간(ms) | 토큰(입력/출력) |',
        '|---:|---|---|---|---|---:|---:|',
    ])
    for index, call in enumerate(calls, 1):
        context = call['context']
        usage = call.get('usage', {})
        token_count = f"{usage.get('input_tokens', '—')}/{usage.get('output_tokens', '—')}"
        status = '성공' if call['success'] else f"실패 ({call['error_type']})"
        lines.append(
            f"| {index} | {context.get('phase', '—')} | {context.get('criterion_code') or context.get('document_kind', '—')} "
            f"| {call['schema']} | {status} | {call['duration_ms']} | {token_count} |"
        )
        lines.extend(['', f"### 호출 {index}: {context.get('phase', '단계 미상')}", '',
                      f"- 요청 SHA-256: `{call['request_hash']}`",
                      f"- 모델: `{call['model']}`"])
        if call['success']:
            lines.extend(['', '```json', json.dumps(call['response_json'], ensure_ascii=False, indent=2), '```'])
        else:
            lines.append(f"- 오류 유형: `{call['error_type']}`")
    return '\n'.join(lines) + '\n'


def write_report(report_dir: Path, run_id: str, report: str) -> Path:
    filename = f'{UUID(run_id)}.md'
    report_dir.mkdir(parents=True, exist_ok=True)
    path = report_dir / filename
    path.write_text(report, encoding='utf-8', newline='\n')
    return path
