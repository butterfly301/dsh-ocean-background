import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS,
  createFoldState,
  foldSessionFacts,
  statusOfFacts,
  sumBuckets,
} from '../host/session-facts.js';

function sessionOf(events, extra = {}) {
  return {
    id: 's-1',
    inheritedEventCount: 0,
    seq: events.length,
    eventAt: (index) => events[index],
    ...extra,
  };
}

const attempt = (usage, turn = 1, step = 1) => ({
  type: 'assistant/attempt',
  data: { turn, step, stream: [{ type: 'chunk', chunk: { type: 'usage', usage } }] },
});

const message = (usage, turn = 1, step = 1) => ({
  type: 'assistant/message',
  data: { turn, step, usage },
});

const usage = (input, output = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

test('usage folds incrementally without double counting a step', () => {
  const state = createFoldState();
  const events = [];
  const session = sessionOf(events);

  events.push(attempt(usage(10, 5)));
  session.seq = events.length;
  foldSessionFacts(state, session);
  assert.equal(sumBuckets(state.buckets), 15);

  events.push(message(usage(10, 5)));
  session.seq = events.length;
  foldSessionFacts(state, session);
  assert.equal(sumBuckets(state.buckets), 15);
  assert.equal(state.foldedThrough, 1);

  events.push(attempt(usage(20, 7), 1, 2));
  session.seq = events.length;
  foldSessionFacts(state, session);
  assert.equal(sumBuckets(state.buckets), 42);
});

test('the first user message timestamp is recorded once', () => {
  const state = createFoldState();
  const events = [
    { type: 'user/message', surfaceOp: 'append', time: 111, data: { role: 'user', source: { kind: 'system' } } },
    { type: 'user/message', surfaceOp: 'append', time: 222, data: { role: 'user', source: { kind: 'user' } } },
    { type: 'user/message', surfaceOp: 'append', time: 333, data: { role: 'user', source: { kind: 'user' } } },
  ];
  const stateAfter = foldSessionFacts(state, sessionOf(events));
  assert.equal(stateAfter.firstUserAt, 222);
});

test('turn state drives the agent status', () => {
  const state = createFoldState();
  const events = [{ type: 'turn/start', data: {} }];
  const session = sessionOf(events);
  foldSessionFacts(state, session);
  assert.equal(statusOfFacts(state, 'interactive'), STATUS.working);

  events.push({ type: 'turn/end', data: { reason: { kind: 'completed' } } });
  session.seq = events.length;
  foldSessionFacts(state, session);
  assert.equal(statusOfFacts(state, 'interactive'), STATUS.waiting);
  assert.equal(statusOfFacts(state, 'one-shot'), STATUS.completed);

  events.push({ type: 'turn/start', data: {} });
  events.push({ type: 'turn/end', data: { reason: { kind: 'aborted' } } });
  session.seq = events.length;
  foldSessionFacts(state, session);
  assert.equal(statusOfFacts(state, 'interactive'), STATUS.cancelled);

  events.push({ type: 'turn/start', data: {} });
  events.push({ type: 'turn/end', data: { reason: { kind: 'error' } } });
  session.seq = events.length;
  foldSessionFacts(state, session);
  assert.equal(statusOfFacts(state, 'interactive'), STATUS.failed);
});

test('a truncated session is refolded from the inherited baseline', () => {
  const state = createFoldState();
  const events = [attempt(usage(10), 1, 1), attempt(usage(10), 1, 2)];
  const session = sessionOf(events);
  foldSessionFacts(state, session);
  assert.equal(sumBuckets(state.buckets), 20);

  session.inheritedEventCount = 2;
  session.seq = 3;
  events.push(attempt(usage(5), 1, 3));
  foldSessionFacts(state, session);
  assert.equal(sumBuckets(state.buckets), 5);
});
