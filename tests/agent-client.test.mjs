import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentEndpoint,
  readAgentConnection,
  startAgentLogin,
  logoutAgent,
} from '../lib/agent-client.ts';

test('logout requires confirmed success and uses the protected JSON endpoint', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/local-codex/logout');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    return Response.json({ connected: false });
  });
  await logoutAgent('localhost');
  globalThis.fetch = async () => Response.json({ connected: true });
  await assert.rejects(logoutAgent('localhost'), /не подтвердил/);
  globalThis.fetch = async () => new Response('', { status: 503 });
  await assert.rejects(logoutAgent('localhost'), /Не удалось выйти/);
});

test('agent endpoints use the dev proxy locally and loopback on a hosted site', () => {
  assert.equal(agentEndpoint('status', 'localhost'), '/api/local-codex/status');
  assert.equal(
    agentEndpoint('analyze', '127.0.0.1'),
    '/api/local-codex/analyze',
  );
  assert.equal(
    agentEndpoint('status', 'aurum.example'),
    'http://127.0.0.1:8787/status',
  );
});

test('connection status distinguishes OAuth, missing login, malformed responses and network errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      connected: true,
      account: 'test@example.com',
      model: 'test-model',
    }),
  );
  const connected = await readAgentConnection('localhost');
  assert.equal(connected.state, 'connected');
  assert.equal(connected.model, 'test-model');
  assert.equal(connected.account, 'test@example.com');
  assert.ok(connected.checkedAt);
  globalThis.fetch = async () => Response.json({ connected: false });
  assert.equal((await readAgentConnection('localhost')).state, 'unauthorized');
  globalThis.fetch = async () => Response.json({ connected: 'yes' });
  assert.equal((await readAgentConnection('localhost')).state, 'offline');
  globalThis.fetch = async () => new Response('', { status: 503 });
  assert.equal((await readAgentConnection('localhost')).state, 'offline');
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  assert.equal((await readAgentConnection('localhost')).state, 'offline');
});

test('unmount cancellation does not become an offline status', async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    options.signal.throwIfAborted();
  });
  await assert.rejects(readAgentConnection('localhost', controller.signal), {
    name: 'AbortError',
  });
});

test('login uses a JSON POST and accepts only official HTTPS login URLs', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/local-codex/login');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    return Response.json({
      authUrl: 'https://auth.openai.com/authorize?state=test',
    });
  });
  assert.equal(
    await startAgentLogin('localhost'),
    'https://auth.openai.com/authorize?state=test',
  );
  for (const authUrl of [
    'http://auth.openai.com/authorize',
    'https://auth.openai.com.evil.example',
    'javascript:alert(1)',
  ]) {
    globalThis.fetch = async () => Response.json({ authUrl });
    await assert.rejects(startAgentLogin('localhost'), /неизвестный адрес/);
  }
  globalThis.fetch = async () =>
    Response.json({ error: 'Вход недоступен.' }, { status: 503 });
  await assert.rejects(startAgentLogin('localhost'), /Вход недоступен/);
});
