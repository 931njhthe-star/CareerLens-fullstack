"""Extract resume text locally, without saving uploads or contacting a service."""

from __future__ import annotations

from io import BytesIO
from pathlib import PurePath
import unicodedata
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_TEXT_CHARS = 50_000
MAX_PDF_PAGES = 50
MAX_DOCX_UNCOMPRESSED_BYTES = 30 * 1024 * 1024
_WORD_DOCUMENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
)


def extract_resume(filename: str, data: bytes) -> str:
    """Return UTF-8-compatible text from a TXT, Markdown, PDF, or DOCX upload.

    Raises ValueError with a user-facing Korean explanation for invalid,
    unsupported, empty, or oversized files. Upload contents stay in memory.
    """
    if not isinstance(filename, str) or not filename:
        raise ValueError("파일 이름을 확인한 뒤 TXT, MD, PDF 또는 DOCX 파일을 올려 주세요.")
    extension = PurePath(filename).suffix.lower()
    if extension not in {".txt", ".md", ".pdf", ".docx"}:
        raise ValueError(
            "TXT, MD, PDF, DOCX 파일만 지원합니다. 다른 형식은 본문 붙여넣기를 이용해 주세요."
        )
    if not isinstance(data, bytes) or not data:
        raise ValueError("파일이 비어 있습니다. 이력서 내용이 있는 파일을 올려 주세요.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError(
            "파일은 10MB 이하만 업로드할 수 있습니다. 용량을 줄이거나 본문 붙여넣기를 이용해 주세요."
        )

    if extension in {".txt", ".md"}:
        text = _read_txt(data)
    elif extension == ".pdf":
        text = _read_pdf(data)
    else:
        text = _read_docx(data)
    return _finish_text(text)


def _finish_text(text: str) -> str:
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError(
            "추출한 본문이 50,000자를 넘습니다. 필요한 경력만 남긴 파일을 올리거나 본문 붙여넣기를 이용해 주세요."
        )
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        raise ValueError(
            "파일에서 본문을 찾지 못했습니다. 내용이 있는 파일을 올리거나 본문 붙여넣기를 이용해 주세요."
        )
    return text


def _read_txt(data: bytes) -> str:
    # Reject common binary formats even when their first bytes can be decoded.
    if data.lstrip().startswith((b"%PDF-", b"PK\x03\x04", b"{\\rtf")) or data.startswith(
        (b"\x89PNG", b"\xff\xd8\xff", b"GIF87a", b"GIF89a", b"\xd0\xcf\x11\xe0", b"MZ", b"\x7fELF")
    ):
        raise ValueError(
            "TXT 확장자와 실제 파일 형식이 다릅니다. 원래 형식의 PDF·DOCX 또는 일반 텍스트 파일을 올려 주세요."
        )
    text = None
    for encoding in ("utf-8-sig", "cp949"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError(
            "텍스트 인코딩을 읽을 수 없습니다. UTF-8 또는 CP949로 저장하거나 본문 붙여넣기를 이용해 주세요."
        )
    disallowed = sum(unicodedata.category(char) == "Cc" and char not in "\n\r\t\f" for char in text)
    if "\x00" in text or disallowed > max(1, len(text) // 100):
        raise ValueError(
            "일반 텍스트가 아닌 바이너리 내용이 발견되었습니다. UTF-8 TXT로 저장하거나 본문 붙여넣기를 이용해 주세요."
        )
    return "".join(
        char for char in text if unicodedata.category(char) != "Cc" or char in "\n\r\t\f"
    )


def _read_pdf(data: bytes) -> str:
    if not data.lstrip().startswith(b"%PDF-"):
        raise ValueError("PDF 확장자와 실제 파일 형식이 다릅니다. 정상적인 PDF를 다시 올려 주세요.")
    from pypdf import PdfReader

    try:
        reader = PdfReader(BytesIO(data), strict=True)
    except Exception as exc:
        raise ValueError(
            "PDF를 읽을 수 없습니다. 파일을 다시 PDF로 저장하거나 본문 붙여넣기를 이용해 주세요."
        ) from exc
    if reader.is_encrypted:
        raise ValueError(
            "암호화된 PDF는 읽을 수 없습니다. 암호를 해제한 사본을 올리거나 본문 붙여넣기를 이용해 주세요."
        )
    try:
        page_count = len(reader.pages)
    except Exception as exc:
        raise ValueError(
            "PDF 페이지를 읽을 수 없습니다. 파일을 다시 저장하거나 본문 붙여넣기를 이용해 주세요."
        ) from exc
    if page_count > MAX_PDF_PAGES:
        raise ValueError("PDF는 50페이지 이하만 지원합니다. 이력서에 필요한 페이지만 남겨 주세요.")
    parts: list[str] = []
    length = 0
    for page in reader.pages:
        try:
            part = page.extract_text() or ""
        except Exception as exc:
            raise ValueError(
                "PDF 본문을 추출할 수 없습니다. 파일을 다시 저장하거나 본문 붙여넣기를 이용해 주세요."
            ) from exc
        length += len(part) + (1 if parts else 0)
        if length > MAX_TEXT_CHARS:
            raise ValueError("추출한 PDF 본문이 50,000자를 넘습니다. 필요한 페이지만 남겨 주세요.")
        parts.append(part)
    text = "\n".join(parts)
    if not text.strip():
        raise ValueError(
            "PDF에서 텍스트를 찾지 못했습니다. 스캔·이미지 PDF라면 별도 OCR로 텍스트를 추출한 후 본문 붙여넣기를 이용해 주세요."
        )
    return text


def _validate_docx(data: bytes) -> None:
    if not data.startswith(b"PK\x03\x04"):
        raise ValueError(
            "DOCX 확장자와 실제 파일 형식이 다릅니다. Word에서 DOCX로 저장한 파일을 올려 주세요."
        )
    try:
        with ZipFile(BytesIO(data)) as archive:
            entries = archive.infolist()
            if (
                len(entries) > 2_000
                or sum(entry.file_size for entry in entries) > MAX_DOCX_UNCOMPRESSED_BYTES
            ):
                raise ValueError(
                    "DOCX 압축 해제 용량이 너무 큽니다(최대 30MB). 이미지와 첨부 자료를 줄이거나 본문 붙여넣기를 이용해 주세요."
                )
            if any(entry.flag_bits & 1 for entry in entries):
                raise ValueError(
                    "암호화된 DOCX는 지원하지 않습니다. 암호를 해제한 사본을 올려 주세요."
                )
            names = [entry.filename for entry in entries]
            if len(names) != len(set(names)):
                raise ValueError(
                    "DOCX 내부 파일 구성이 올바르지 않습니다. Word에서 다시 저장해 주세요."
                )
            if not {"[Content_Types].xml", "word/document.xml"}.issubset(names):
                raise ValueError("올바른 DOCX 문서가 아닙니다. Word에서 DOCX로 다시 저장해 주세요.")
            types_xml = archive.read("[Content_Types].xml")
            if b"<!DOCTYPE" in types_xml.upper() or b"<!ENTITY" in types_xml.upper():
                raise ValueError(
                    "DOCX 내부 문서 정보가 올바르지 않습니다. Word에서 다시 저장해 주세요."
                )
            types = ElementTree.fromstring(types_xml)
            if not any(
                element.attrib.get("PartName") == "/word/document.xml"
                and element.attrib.get("ContentType") == _WORD_DOCUMENT_TYPE
                for element in types
            ):
                raise ValueError(
                    "일반 DOCX 문서만 지원합니다. Word에서 DOCX 형식으로 다시 저장해 주세요."
                )
    except (BadZipFile, KeyError, ElementTree.ParseError, RuntimeError, OSError) as exc:
        raise ValueError(
            "DOCX 파일이 손상되었거나 형식이 올바르지 않습니다. 다시 저장하거나 본문 붙여넣기를 이용해 주세요."
        ) from exc


def _read_docx(data: bytes) -> str:
    _validate_docx(data)
    from docx import Document
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    try:
        document = Document(BytesIO(data))
        parts: list[str] = []
        # Walk the body so that paragraphs and tables retain their relative order.
        for element in document.element.body.iterchildren():
            if element.tag == qn("w:p"):
                parts.append(Paragraph(element, document).text)
            elif element.tag == qn("w:tbl"):
                for row in Table(element, document).rows:
                    cells: list[str] = []
                    seen: set[object] = set()
                    for cell in row.cells:
                        if cell._tc not in seen:
                            cells.append(cell.text)
                            seen.add(cell._tc)
                    parts.append("\t".join(cells))
        return "\n".join(parts)
    except Exception as exc:
        raise ValueError(
            "DOCX 본문을 읽을 수 없습니다. Word에서 다시 저장하거나 본문 붙여넣기를 이용해 주세요."
        ) from exc
