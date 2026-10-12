from app.retrieval.indexing.markdown import chunks


def test_korean_chunks_preserve_source_and_line_metadata():
    text = '# 프로젝트\n' + ('한글 상태 관리 구현 경험입니다.\n' * 200) + '\n## 결과\n21건 중 19건 일치\n'
    rows = chunks(text, maximum=100, overlap=15)
    assert len(rows) > 2
    assert all(r['content'] in text and r['metadata']['line_start'] >= 1 for r in rows)
    assert rows[-1]['section'] == '## 결과'
