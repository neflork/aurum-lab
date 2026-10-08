import { createServer } from 'node:http';
import { createClient, getSession, login, logout } from 'oauth-codex';
import { createBridgeLogin } from './bridge-login.mjs';

const port = Number(process.env.AURUM_AI_PORT ?? 8787);
const allowedOrigins = new Set([
  'https://aurum-strategy-lab.subhashrajput35538.chatgpt.site',
  ...(process.env.AURUM_AI_ORIGIN ?? '').split(',').filter(Boolean),
]);
const isAllowedOrigin = (origin) => {
  if (!origin) return true; // Local CLI access.
  if (allowedOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    return (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname)
    );
  } catch {
    return false;
  }
};
const model = process.env.AURUM_AI_MODEL ?? 'gpt-5.5';

const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};

const run = async () => {
  if (process.argv[2] === 'login') {
    const session = await login();
    console.log(
      'Codex подключён: ' + (session.account.email ?? 'аккаунт без email'),
    );
    return;
  }
  if (process.argv[2] === 'status') {
    const session = await getSession();
    console.log(
      session ? 'connected ' + (session.account.email ?? '') : 'not connected',
    );
    return;
  }

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin))
      return json(res, 403, { error: 'Origin not allowed' });
    if (origin) res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('access-control-allow-private-network', 'true');
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (req.url === '/health' && req.method === 'GET')
      return json(res, 200, { service: 'aurum-codex-bridge' });
    if (
      req.method === 'POST' &&
      req.headers['content-type']?.split(';')[0] !== 'application/json'
    )
      return json(res, 415, { error: 'Expected application/json' });
    if (req.url === '/login' && req.method === 'POST') {
      try {
        return json(res, 200, await browserLogin.start());
      } catch (error) {
        return json(res, 503, {
          error: error instanceof Error ? error.message : 'Вход недоступен.',
        });
      }
    }
    if (req.url === '/logout' && req.method === 'POST') {
      try {
        await browserLogin.logout(logout);
        return json(res, 200, { connected: false });
      } catch {
        return json(res, 503, {
          error:
            'Не удалось выйти. Завершите текущий вход и повторите попытку.',
        });
      }
    }
    if (req.url === '/status' && req.method === 'GET') {
      try {
        const session = await getSession();
        return json(res, 200, {
          connected: Boolean(session),
          account: session?.account.email ?? null,
          model,
          login: browserLogin.status(),
        });
      } catch (error) {
        return json(res, 503, {
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось проверить OAuth.',
        });
      }
    }
    if (req.url !== '/analyze' || req.method !== 'POST')
      return json(res, 404, { error: 'Not found' });
    const session = await getSession();
    if (!session)
      return json(res, 401, {
        error:
          'Codex не подключён. Нажмите «Войти через ChatGPT» в карточке агента.',
      });
    try {
      const { prompt } = await readBody(req);
      if (
        typeof prompt !== 'string' ||
        prompt.length < 20 ||
        prompt.length > 50000
      )
        return json(res, 400, { error: 'Некорректный prompt.' });
      const client = createClient();
      const chunks = [];
      for await (const chunk of client.stream(prompt, {
        // The legacy gpt-5-codex slug is rejected for ChatGPT OAuth sessions.
        // Keep this configurable so the bridge can follow the currently
        // supported Codex model without changing the frontend.
        model,
        instructions:
          'Ты аналитик рынка для учебного проекта. Не выдавай финансовую рекомендацию и не придумывай данные. Верни только JSON без markdown по схеме: {"bias":"up|down|range","biasLabel":"вверх|вниз|нейтрально","dayOpen":number,"dayLabel":string,"flow":"buying|selling|balanced","flowLabel":string,"smtLabel":string,"confidence":number,"scenario":string,"reasons":string[],"commentary":string}. confidence — субъективная уверенность анализа по шкале от 0 до 1 (например, 0.62), не вероятность прибыльной сделки. Если настоящего order flow или второго инструмента нет, явно назови вывод proxy.',
      }))
        chunks.push(chunk);
      const text = chunks.join('');
      return json(res, 200, { text });
    } catch (error) {
      return json(res, 502, {
        error: error instanceof Error ? error.message : 'Codex не ответил.',
      });
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('Aurum AI bridge: http://127.0.0.1:' + port);
    console.log('Для входа нажмите «Войти через ChatGPT» на сайте.');
  });
};

const browserLogin = createBridgeLogin(login);

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
