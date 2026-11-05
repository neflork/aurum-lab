import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { openResearchDatabase } from './research-database.mjs';
import { createMarketSync, archiveDataset } from './market-sync.mjs';

const port = Number(process.env.AURUM_DB_PORT ?? 8788);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Некорректный AURUM_DB_PORT.');
const filename =
  process.env.AURUM_DB_PATH ??
  fileURLToPath(new URL('../data/aurum.sqlite', import.meta.url));
const database = openResearchDatabase(filename);
const syncMarket = createMarketSync(database);
const send = (res, status, value) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
};
const server = createServer(async (req, res) => {
  // Local service only. Browser requests arrive through the same-origin proxy.
  const host = req.headers.host;
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host))
    return send(res, 403, { error: 'Host not allowed' });
  const origin = req.headers.origin;
  if (origin) {
    try {
      const u = new URL(origin);
      if (
        u.protocol !== 'http:' ||
        !['localhost', '127.0.0.1'].includes(u.hostname)
      )
        return send(res, 403, { error: 'Origin not allowed' });
    } catch {
      return send(res, 403, { error: 'Origin not allowed' });
    }
  }
  try {
    if (req.method === 'GET' && req.url === '/health')
      return send(res, 200, { service: 'aurum-research-database', schema: 2 });
    if (req.method === 'GET' && req.url.startsWith('/market?')) {
      const interval = new URL(req.url, 'http://localhost').searchParams.get(
        'interval',
      );
      if (!['15m', '1h', '4h'].includes(interval))
        return send(res, 400, { error: 'Недопустимый интервал.' });
      return send(res, 200, archiveDataset(database.marketHistory(interval)));
    }
    if (req.method !== 'POST' || req.url !== '/market/sync')
      return send(res, 404, { error: 'Not found' });
    if (req.headers['content-type']?.split(';')[0] !== 'application/json')
      return send(res, 415, { error: 'Expected application/json' });
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16_000_000)
        return send(res, 413, { error: 'Исследование больше 16 МБ.' });
      chunks.push(chunk);
    }
    let value;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(res, 400, { error: 'Некорректный JSON.' });
    }
    if (req.url === '/market/sync') {
      if (!['15m', '1h', '4h'].includes(value?.interval))
        return send(res, 400, { error: 'Недопустимый интервал.' });
      try {
        return send(res, 200, await syncMarket(value.interval));
      } catch (error) {
        return send(res, 503, { error: error.message });
      }
    }
  } catch (error) {
    console.error('Ошибка базы исследований:', error.message);
    send(res, 500, { error: 'База исследований недоступна.' });
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Aurum SQLite: ${filename}`),
);
function stop() {
  server.close(() => {
    database.close();
    process.exit();
  });
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
