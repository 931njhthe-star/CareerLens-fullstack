/** Browser checks only. The backend remains responsible for validating and storing resumes. */
export const RESUME_MAX_BYTES = 10 * 1024 * 1024;

export function validateResumeFileMetadata(file) {
  if (!file?.name) throw new Error('이력서 .md 파일을 먼저 선택해 주세요.');
  if (!/\.md$/i.test(file.name))
    throw new Error('Markdown(.md) 파일만 첨부할 수 있어요. 파일 내용을 Markdown 형식으로 저장해 주세요.');
  if (!Number.isFinite(file.size) || file.size < 0)
    throw new Error('파일 정보를 읽지 못했습니다. 파일을 다시 선택해 주세요.');
  if (file.size > RESUME_MAX_BYTES) throw new Error('파일은 10MB 이하로 선택해 주세요.');
  if (file.size === 0) throw new Error('빈 파일은 첨부할 수 없어요. 이력서 본문을 입력해 주세요.');
  return file.name;
}

/** Read locally before sending any upload request; MIME is unreliable for .md on Windows. */
export async function validateResumeFile(file) {
  validateResumeFileMetadata(file);
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error('파일을 읽지 못했습니다. 파일이 열리는지 확인한 뒤 다시 선택해 주세요.');
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('UTF-8로 저장된 .md 파일을 선택해 주세요. 편집기에서 인코딩을 UTF-8로 저장할 수 있어요.');
  }
  if (/^[\s\uFEFF]*%PDF-|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text))
    throw new Error('텍스트로 작성한 Markdown(.md) 파일을 선택해 주세요. PDF나 문서 파일의 확장자만 바꾸면 불러올 수 없어요.');
  if (!text.trim()) throw new Error('이력서 본문이 비어 있어요. 내용을 입력한 .md 파일을 선택해 주세요.');
  return { filename: file.name, text };
}
