import hashlib
import re
import tiktoken


def digest(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def chunks(text: str, maximum: int = 600, overlap: int = 80) -> list[dict]:
    if maximum <= overlap or overlap < 0: raise ValueError('Invalid chunk sizes')
    enc = tiktoken.get_encoding('cl100k_base')
    lines = text.splitlines(keepends=True)
    groups, section, first, buffer = [], '본문', 1, []
    for number, line in enumerate(lines, 1):
        if re.match(r'^#{1,6}\s', line):
            if buffer: groups.append((section, first, ''.join(buffer)))
            section, first, buffer = line.strip(), number, []
        buffer.append(line)
    if buffer: groups.append((section, first, ''.join(buffer)))
    output = []
    for section, first, content in groups:
        # Split only at Unicode character boundaries. Every quote stays a substring of source.
        cursor = 0
        while cursor < len(content):
            lo, hi = cursor + 1, len(content)
            while lo < hi:
                mid = (lo + hi + 1) // 2
                if len(enc.encode(content[cursor:mid])) <= maximum: lo = mid
                else: hi = mid - 1
            end = lo
            output.append({'chunk_index': len(output), 'section': section, 'content': content[cursor:end],
                           'metadata': {'line_start': first + content[:cursor].count('\n'), 'line_end': first + content[:end].count('\n'), 'char_start_in_section': cursor}, 'source_hash': digest(text)})
            if end == len(content): break
            next_cursor = end
            while next_cursor > cursor + 1 and len(enc.encode(content[next_cursor - 1:end])) <= overlap:
                next_cursor -= 1
            cursor = max(cursor + 1, next_cursor)
    return output


def lexical_search(rows: list[dict], query: str, limit: int = 5) -> list[dict]:
    terms = set(re.findall(r'[\w가-힣]+', query.lower()))
    ranked = sorted(rows, key=lambda r: sum(t in r['content'].lower() for t in terms), reverse=True)
    return ranked[:limit]
