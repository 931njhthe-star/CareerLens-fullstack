import { opportunityRoute, opportunityPath } from './opportunity-state.js';

const fields = ['company', 'role', 'job_text'];

export function postingDraft(posting) {
  return { company: posting.company, role: posting.role, job_text: posting.description };
}

// Catalog selection only prepares the job editor; saving remains an explicit action.
export function selectionNeedsConfirmation(savedDraft, edits, posting) {
  const next = postingDraft(posting);
  return fields.some((field) => {
    const current = Object.hasOwn(edits, field) ? edits[field] : savedDraft[field];
    return Boolean(current?.trim()) && current !== next[field];
  });
}

export function withPostingSelection(edits, posting) {
  return { ...edits, ...postingDraft(posting) };
}

export function catalogRoute(hash) {
  const [path, query = ''] = hash.replace(/^#\//, '').split('?');
  if (path === 'jobs') return { kind: 'list', query: new URLSearchParams(query) };
  const context = catalogQuery(new URLSearchParams(query));
  const navigation = context.has('return_to') ? { query: context } : {};
  if (path === 'jobs/new') return { kind: 'new', ...navigation };
  const match = /^jobs\/([^/]+)(\/edit)?$/.exec(path);
  if (!match) return null;
  try {
    return { kind: match[2] ? 'edit' : 'detail', id: decodeURIComponent(match[1]), ...navigation };
  } catch {
    return null;
  }
}

// Return destinations are local workflow state, never arbitrary URLs.
export function catalogReturnPath(value) {
  if (
    typeof value !== 'string' ||
    !/^opportunities\?[^?#]*$/.test(value) ||
    /[\u0000-\u001f\u007f\\]/.test(value)
  )
    return '';
  const route = opportunityRoute(`#/${value}`);
  return route?.role_id.trim() ? opportunityPath(route, route.page, route.selected) : '';
}

export function catalogPath(path, input) {
  if (!catalogReturnPath(input?.get('return_to'))) return path;
  return `${path}?${catalogQuery(input)}`;
}

export function catalogQuery(input) {
  const query = new URLSearchParams();
  for (const name of [
    'q',
    'role_category',
    'location',
    'employment_type',
    'experience_level',
    'skill',
  ]) {
    const value = String(input.get(name) || '').trim();
    if (value) query.set(name, value);
  }
  if (input.get('saved') === '1') query.set('saved', '1');
  const page = Number(input.get('page'));
  query.set('page', String(Number.isInteger(page) && page > 0 ? page : 1));
  query.set('page_size', '12');
  const returnTo = catalogReturnPath(input.get('return_to'));
  if (returnTo) query.set('return_to', returnTo);
  return query;
}

export function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}

export function postingPayload(form) {
  return {
    ...Object.fromEntries(form),
    skills: [
      ...new Set(
        String(form.get('skills') || '')
          .split(',')
          .map((skill) => skill.trim())
          .filter(Boolean),
      ),
    ],
  };
}
