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

test('logout clears the session once, resets progress and serializes with login', async () => {
  const flow = createBridgeLogin(async ({ onUrl }) =>
    onUrl('https://auth.openai.com/authorize'),
  );
  await flow.start();
  await new Promise(setImmediate);
  let finish;
  let calls = 0;
  const clear = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const first = flow.logout(clear);
  assert.equal(flow.logout(clear), first);
  await assert.rejects(flow.start(), /Дождитесь/);
  finish();
  await first;
  assert.equal(calls, 1);
  assert.deepEqual(flow.status(), { state: 'idle', error: null });
  await flow.start();
});

test('logout cannot race an unfinished login or claim success if clearing fails', async () => {
  let finish;
  const flow = createBridgeLogin(({ onUrl }) => {
    onUrl('https://auth.openai.com/authorize');
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await flow.start();
  await assert.rejects(
    flow.logout(() => assert.fail('must not clear during login')),
    /Сначала завершите/,
  );
  finish();
  await new Promise(setImmediate);
  await assert.rejects(
    flow.logout(async () => {
      throw new Error('storage failure');
    }),
    /storage failure/,
  );
  assert.equal(flow.status().state, 'completed');
  await flow.logout(async () => {});
  assert.equal(flow.status().state, 'idle');
});
