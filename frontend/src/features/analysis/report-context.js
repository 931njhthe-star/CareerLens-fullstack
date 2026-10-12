// The backend's saved Markdown contains the evaluated posting snapshot. Do not
// use a browser's current selection to identify an older evaluation.
export function extractReportJobContext(markdown = '') {
  const context = { title: '', company: '', source: 'report' };
  let fence = null;
  for (const line of String(markdown).split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (new RegExp(`^\\s*${fence.character}{${fence.length},}\\s*$`).test(line))
        fence = null;
      continue;
    }
    if (fence) continue;
    if (/^\s*#{2,6}\s/.test(line)) break;
    const entry = /^\s*[-*]\s+(채용공고|기업)\s*:\s*(.*?)\s*$/.exec(line);
    if (!entry) continue;
    const key = entry[1] === '채용공고' ? 'title' : 'company';
    if (!context[key]) context[key] = entry[2].replace(/^\*\*(.*?)\*\*$/, '$1').trim();
  }
  return context;
}

export function reportJobContext(report = {}) {
  const saved = report.job_context;
  const parsed = extractReportJobContext(report.backend_report_text);
  return {
    title:
      typeof saved?.title === 'string' && saved.title.trim() ? saved.title.trim() : parsed.title,
    company:
      typeof saved?.company === 'string' && saved.company.trim()
        ? saved.company.trim()
        : parsed.company,
    source: 'report',
  };
}
