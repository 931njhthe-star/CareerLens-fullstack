const pageFields = {
  resume: ['resume_text'],
  job: ['company', 'role', 'job_text', 'role_id', 'focus'],
  'desired-role': ['role', 'role_id', 'focus'],
};

// Each editor overlays only its own fields. Analysis context always comes from
// the server snapshot that was actually saved and used to generate questions.
export function draftForPage(page, savedDraft, edits) {
  if (page === 'result') return savedDraft;
  if (page === 'questions') {
    return { ...savedDraft, answers: { ...savedDraft.answers, ...edits.answers } };
  }
  const draft = { ...savedDraft };
  for (const field of pageFields[page] || []) {
    if (Object.hasOwn(edits, field)) draft[field] = edits[field];
  }
  if (page === 'job' || page === 'desired-role') {
    draft.career_target = { ...savedDraft.career_target };
    for (const field of ['role_id', 'focus']) {
      if (Object.hasOwn(edits, field)) draft.career_target[field] = edits[field];
    }
    if (page === 'desired-role' && Object.hasOwn(edits, 'role'))
      draft.career_target.label = edits.role;
  }
  return draft;
}

export function remainingEdits(edits, savedFields, previousDraft, nextDraft) {
  const next = { ...edits };
  for (const field of savedFields) delete next[field];
  if (
    previousDraft &&
    nextDraft &&
    ['resume_text', 'company', 'role', 'job_text', 'career_target'].some(
      (field) =>
        JSON.stringify(previousDraft[field] ?? '') !== JSON.stringify(nextDraft[field] ?? ''),
    )
  ) {
    delete next.answers;
  }
  return next;
}
