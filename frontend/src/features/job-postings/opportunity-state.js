const opportunityScopes = new Set(['category', 'exact', 'all']);
const validScope = (scope) => (opportunityScopes.has(scope) ? scope : 'category');

export function opportunityRoute(hash) {
  if (!/^#\/opportunities(?:\?|$)/.test(hash)) return null;
  const params = new URLSearchParams(hash.split('?')[1] || '');
  return {
    role_id: params.get('role_id') || '',
    label: (params.get('label') || '').slice(0, 120),
    scope: validScope(params.get('scope')),
    page: Math.max(1, Math.min(1000000, Number.parseInt(params.get('page'), 10) || 1)),
    selected: params.get('selected') || '',
  };
}

export function opportunityPath(target, page = 1, selected = '') {
  const params = new URLSearchParams({
    role_id: target.role_id || '',
    label: target.label || '',
    scope: validScope(target.scope),
    page: String(page),
  });
  if (selected) params.set('selected', selected);
  return `opportunities?${params}`;
}

export function opportunityQuery(route) {
  const params = new URLSearchParams({
    role_id: route.role_id,
    role_scope: validScope(route.scope),
    page: String(route.page),
    page_size: '20',
  });
  if (route.role_id === 'custom') params.set('role', route.label);
  return `/job-postings?${params}`;
}
