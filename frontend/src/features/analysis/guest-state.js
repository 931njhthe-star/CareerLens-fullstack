import { opportunityPath } from '../job-postings/opportunity-state.js';

// Guest responses carry completion metadata, never the report or resume body.
// Keep an allowlist here as well so a server regression cannot reach the renderer.
export function guestWorkspace(result = {}) {
  const source = result.draft || {};
  return {
    draft: {
      guest: true,
      resume_attached: source.resume_attached === true,
      filename: source.filename || '',
      company: source.company || '',
      role: source.role || '',
      analysis_mode: source.analysis_mode || 'job_posting',
      career_target: source.career_target || null,
      selected_posting_id: source.selected_posting_id || null,
      report_locked: result.completed === true && result.report_locked === true,
      expires_at: result.expires_at || null,
    },
    questions: Array.isArray(result.questions) ? result.questions : [],
  };
}

export async function requestGuestReport({ answers, signal, request }) {
  signal.throwIfAborted();
  const result = await request('/guest/analysis', {
    method: 'POST',
    body: { answers },
    signal,
  });
  signal.throwIfAborted();
  if (result?.completed !== true || result?.report_locked !== true)
    throw new Error('분석 완료를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return guestWorkspace(result);
}

export function practiceDestination(draft = {}) {
  if (draft.report || draft.report_locked) return 'result';
  if (draft.selected_posting_id) return `jobs/${encodeURIComponent(draft.selected_posting_id)}`;
  if (draft.career_target?.role_id) return opportunityPath(draft.career_target);
  return draft.resume_text || draft.resume_attached ? 'desired-role' : 'resume';
}
