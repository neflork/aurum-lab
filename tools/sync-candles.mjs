const port = process.env.AURUM_DB_PORT ?? 8788;
for (const interval of ['15m', '1h', '4h']) {
  const response = await fetch(`http://127.0.0.1:${port}/market/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ interval }),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || result.archive?.stale) {
    console.error(`${interval}: ${result.error ?? result.archive?.warning}`);
    process.exitCode = 1;
    continue;
  }
  console.log(
    `${interval}: в архиве ${result.archive.total}, добавлено ${result.archive.added}, исправлено ${result.archive.corrected}, для анализа ${result.bars.length}`,
  );
}
