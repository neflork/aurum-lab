import { createServer } from 'node:http';
import { createClient, getSession, login } from 'oauth-codex';

const port = Number(process.env.AURUM_AI_PORT ?? 8787);
const origin = process.env.AURUM_AI_ORIGIN ?? '*';

const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin,
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
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (req.url === '/status' && req.method === 'GET') {
      const session = await getSession();
      return json(res, 200, {
        connected: Boolean(session),
        account: session?.account.email ?? null,
      });
    }
    if (req.url !== '/analyze' || req.method !== 'POST')
      return json(res, 404, { error: 'Not found' });
    const session = await getSession();
    if (!session)
      return json(res, 401, {
        error: 'Codex OAuth не подключён. Запусти npm run ai:login.',
      });
    try {
      const { prompt } = await readBody(req);
      if (
        typeof prompt !== 'string' ||
        prompt.length < 20 ||
        prompt.length > 50000
      )
        return json(res, 400, { error: 'Некорректный prompt.' });
      const text = await createClient().respond(prompt, {
        model: process.env.AURUM_AI_MODEL ?? 'gpt-5-codex',
        instructions:
          'Ты аналитик рынка для учебного проекта. Не выдавай финансовую рекомендацию и не придумывай данные. Верни только JSON без markdown по схеме: {"bias":"up|down|range","biasLabel":"вверх|вниз|нейтрально","dayOpen":number,"dayLabel":string,"flow":"buying|selling|balanced","flowLabel":string,"smtLabel":string,"confidence":number,"scenario":string,"reasons":string[],"commentary":string}. Если настоящего order flow или второго инструмента нет, явно назови вывод proxy.',
      });
      return json(res, 200, { text });
    } catch (error) {
      return json(res, 502, {
        error: error instanceof Error ? error.message : 'Codex не ответил.',
      });
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('Aurum AI bridge: http://127.0.0.1:' + port);
    console.log('Для OAuth в другом окне выполни: npm run ai:login');
  });
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
