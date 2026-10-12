import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, shell } from '../../src/shared/components/ui.js';
import { workspacePage } from '../../src/pages/workspace.js';
import { renderAuth } from '../../src/features/auth/auth.js';

const payload = '<img src=x onerror="alert(1)">';
const draft = {
  resume_text: payload,
  filename: payload,
  company: payload,
  role: payload,
  job_text: payload,
  answers: { experience: payload },
  created_at: payload,
  report: {
    score: 50,
    verdict: payload,
    summary: payload,
    criteria: [{ label: payload, score: 12, max_score: 20, detail: payload }],
    recruiter_email: { subject: payload, body: payload },
    matches: [
      {
        status: 'confirmed',
        requirement: payload,
        evidence_items: [{ excerpt: payload, source_label: payload }],
      },
    ],
    strengths: [payload],
    gaps: [payload],
    priorities: [{ title: payload, detail: payload }],
    questions: [payload],
    methodology: payload,
  },
};

test('all workspace views keep uploaded/user/report content as text', () => {
  for (const page of ['resume', 'desired-role', 'result']) {
    const markup = workspacePage(page, draft, [
      { id: 'experience', prompt: payload, reason: payload },
    ]);
    assert.ok(!markup.includes(payload), `${page} contains raw HTML`);
    assert.ok(markup.includes(escapeHtml(payload)), `${page} drops escaped content`);
  }
  const result = workspacePage('result', draft, []);
  assert.ok(result.includes('data-resume-score-card="true"'));
  assert.ok(result.includes('출처 ·'));
});

test('account and provider labels are escaped', () => {
  assert.ok(!shell('', { user: { name: payload }, draft }).includes(payload));
  const auth = renderAuth('login', { providers: [{ id: 'google', name: payload, enabled: true }] });
  assert.ok(!auth.includes(payload));
  assert.ok(auth.includes(escapeHtml(payload)));
});

test('unconfigured OAuth buttons explain disabled state', () => {
  const auth = renderAuth('login', { providers: [] });
  assert.equal((auth.match(/disabled aria-describedby="provider-hint"/g) || []).length, 3);
  assert.ok(auth.includes('이메일로 계속하기'));
});
