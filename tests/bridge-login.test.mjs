import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeLogin } from '../tools/bridge-login.mjs';

test('repeated clicks reuse one login and expose progress without tokens', async () => {
  let finish;
  let calls = 0;
  const flow = createBridgeLogin(({ onUrl, openBrowser }) => {
    calls++;
    assert.equal(openBrowser, false);
    onUrl('https://auth.openai.com/authorize?state=test');
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = flow.start();
  assert.equal(flow.start(), first);
  assert.deepEqual(await first, {
    authUrl: 'https://auth.openai.com/authorize?state=test',
  });
  assert.equal(calls, 1);
  assert.equal(flow.status().state, 'pending');
  finish({ access_token: 'must-not-be-exposed' });
  await new Promise(setImmediate);
  assert.deepEqual(flow.status(), { state: 'completed', error: null });
});

test('failures before and after URL delivery settle and allow another attempt', async () => {
  let calls = 0;
  let fail;
  const flow = createBridgeLogin(({ onUrl }) => {
    if (++calls === 1) throw new Error('private details');
    onUrl('https://auth.openai.com/authorize');
    return new Promise((_resolve, reject) => {
      fail = reject;
    });
  });
  await assert.rejects(flow.start(), /Не удалось завершить вход/);
  assert.equal(flow.status().state, 'failed');
  assert.ok(!flow.status().error.includes('private details'));
  await flow.start();
  fail(new Error('timeout'));
  await new Promise(setImmediate);
  assert.equal(flow.status().state, 'failed');
  await flow.start();
  assert.equal(calls, 3);
});
