import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREPARATION_STAGES,
  preparationSnapshot,
  runPreparationStages,
} from '../../src/features/analysis/preparation-state.js';
import { draftForPage, remainingEdits } from '../../src/app/workspace-state.js';

const initial = () => ({
  fingerprint: 'resume-and-role-v1',
  complete: false,
  stages: PREPARATION_STAGES.map(({ id }) => ({ id, status: 'pending', detail: '' })),
});
function finished(input, id) {
  const stages = input.stages.map((stage) =>
    stage.id === id ? { ...stage, status: 'complete', detail: '실제 처리 완료' } : stage,
  );
  return { ...input, stages, complete: stages.every((stage) => stage.status === 'complete') };
}

test('ordered processing exposes running states and only API-completed stages reach 100%', async () => {
  let saved = initial();
  const calls = [],
    snapshots = [];
  await runPreparationStages({
    initial: saved,
    signal: new AbortController().signal,
    request: async (id, fingerprint) => {
      assert.equal(fingerprint, saved.fingerprint);
      calls.push(id);
      assert.equal(snapshots.at(-1).stages.find((stage) => stage.id === id).status, 'running');
      saved = finished(saved, id);
      return { preparation: saved };
    },
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onWorkspace: () => {},
  });
  assert.deepEqual(calls, ['resume', 'role', 'report']);
  assert.equal(snapshots.at(-1).complete, true);
  assert.equal(
    snapshots.slice(0, -1).some((snapshot) => snapshot.complete),
    false,
  );
});

test('failure stops remaining work and retry resumes completed server stages', async () => {
  let saved = initial();
  const snapshots = [],
    calls = [];
  const options = {
    signal: new AbortController().signal,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onWorkspace: () => {},
  };
  await assert.rejects(
    runPreparationStages({
      ...options,
      initial: saved,
      request: async (id) => {
        if (id === 'role') throw new Error('연결 실패');
        saved = finished(saved, id);
        return { preparation: saved };
      },
    }),
    /연결 실패/,
  );
  assert.equal(snapshots.at(-1).stages[1].status, 'error');
  assert.equal(snapshots.at(-1).complete, false);
  await runPreparationStages({
    ...options,
    initial: saved,
    request: async (id) => {
      calls.push(id);
      saved = finished(saved, id);
      return { preparation: saved };
    },
  });
  assert.deepEqual(calls, ['role', 'report']);
});

test('navigation abort never applies an in-flight response or reaches next stage', async () => {
  const abort = new AbortController();
  let applied = 0;
  await assert.rejects(
    runPreparationStages({
      initial: initial(),
      signal: abort.signal,
      request: async (id) => {
        abort.abort();
        return { preparation: finished(initial(), id) };
      },
      onSnapshot: () => {},
      onWorkspace: () => applied++,
    }),
    { name: 'AbortError' },
  );
  assert.equal(applied, 0);
});

test('stale fingerprint or unacknowledged stage cannot complete', async () => {
  for (const response of [
    initial(),
    { ...finished(initial(), 'resume'), fingerprint: 'changed' },
  ]) {
    await assert.rejects(
      runPreparationStages({
        initial: initial(),
        signal: new AbortController().signal,
        request: async () => ({ preparation: response }),
        onSnapshot: () => {},
        onWorkspace: () => assert.fail(),
      }),
      /완료 상태/,
    );
  }
  assert.equal(preparationSnapshot({ complete: true }).complete, false);
});

test('unsaved target stays in its editor and changed target invalidates answer edits', () => {
  const saved = {
    career_target: { role_id: 'backend', focus: 'API' },
    role: '백엔드 개발',
    answers: {},
  };
  const edits = { role_id: 'ai', focus: 'RAG', answers: { old: '이전 질문 답변' } };
  assert.equal(draftForPage('desired-role', saved, edits).career_target.role_id, 'ai');
  assert.equal(draftForPage('result', saved, edits).career_target.role_id, 'backend');
  assert.equal(
    remainingEdits(edits, ['role_id', 'focus'], saved, {
      ...saved,
      career_target: { role_id: 'ai', focus: 'RAG' },
    }).answers,
    undefined,
  );
});
