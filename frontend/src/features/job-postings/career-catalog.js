function markdownField(markdown, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*-\\s+\\*\\*${escaped}:\\*\\*\\s*(.*?)\\s*$`, 'm').exec(markdown);
  return match?.[1]?.trim() || '';
}

function markdownSection(markdown, name) {
  const lines = markdown.split(/\r?\n/);
  let active = false;
  const result = [];
  for (const line of lines) {
    const heading = /^###\s+\d+\.\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (active) break;
      active = heading[1] === name;
      continue;
    }
    if (!active) continue;
    const item = line
      .replace(/^\s*-\s*/, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .trim();
    if (item) result.push(item);
  }
  return result;
}

function postingDescription(markdown) {
  const sections = [];
  const companyIntro = markdownField(markdown, '회사 또는 고객사 소개');
  const roleIntro = markdownField(markdown, '직무 소개');
  if (companyIntro) sections.push(`회사 소개\n${companyIntro}`);
  if (roleIntro) sections.push(`직무 소개\n${roleIntro}`);
  for (const [section, label] of [
    ['담당업무', '담당 업무'],
    ['자격요건', '자격 요건'],
    ['우대사항', '우대 사항'],
  ]) {
    const items = markdownSection(markdown, section);
    if (items.length) sections.push(`${label}\n${items.map((item) => `- ${item}`).join('\n')}`);
  }
  return sections.join('\n\n');
}

export function parseCareerCatalog(items) {
  if (!Array.isArray(items)) throw new Error('직무 Markdown 목록 형식이 올바르지 않습니다.');
  const rolesByLabel = new Map();
  const postings = items.map((item) => {
    if (!item?.id || typeof item.content !== 'string')
      throw new Error('직무 Markdown 파일 내용이 올바르지 않습니다.');
    const company = markdownField(item.content, '회사명');
    const title = markdownField(item.content, '공고명');
    const role = markdownField(item.content, '직무명').replace(/\s+/g, ' ').trim();
    const roleCategory = typeof item.role_category === 'string' ? item.role_category.trim() : '';
    if (!company || !title || !role)
      throw new Error(`${item.filename || item.id + '.md'}에서 필수 공고 항목을 찾지 못했습니다.`);

    rolesByLabel.set(
      role,
      rolesByLabel.get(role) || {
        id: `role-${item.id}`,
        label: role,
        role_category: roleCategory,
        description: markdownField(item.content, '직무 소개'),
      },
    );
    return {
      id: `backup-${item.id}`,
      company,
      role,
      role_category: roleCategory,
      title,
      location: markdownField(item.content, '근무지') || '근무지 협의',
      employment_type: markdownField(item.content, '고용형태') || '정보 없음',
      experience_level: markdownField(item.content, '경력') || '경력 요건 미정',
      skills: [],
      description: postingDescription(item.content),
      source_markdown: item.content,
      source_name: 'local_markdown',
      source_external_id: item.filename || `${item.id}.md`,
      source_type: 'example',
      is_example: true,
      is_saved: false,
    };
  });

  return {
    roles: [
      ...rolesByLabel.values(),
      {
        id: 'custom',
        label: '직접 입력',
        description: '희망 직무를 직접 입력합니다.',
      },
    ],
    postings,
  };
}
