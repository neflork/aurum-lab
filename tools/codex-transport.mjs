import { defaultStore, getSession, refresh } from 'oauth-codex';
// The installed OAuth client does not forward reasoning options. Keep the
// same authenticated endpoint and token store, with explicit effort control.
export async function requestCodex(
  prompt,
  { model, effort, instructions, signal },
) {
  let tokens = await defaultStore.load();
  if (!tokens) throw new Error('Codex не подключён.');
  if (Date.now() >= tokens.expires_at) {
    await refresh();
    tokens = await defaultStore.load();
  }
  const session = await getSession();
  const post = () =>
    fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      signal,
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        'content-type': 'application/json',
        ...(session?.account.id
          ? { 'chatgpt-account-id': session.account.id }
          : {}),
        'openai-beta': 'responses=experimental',
        originator: 'codex_cli_rs',
      },
      body: JSON.stringify({
        model,
        reasoning: { effort },
        instructions,
        input: [
          { role: 'user', content: [{ type: 'input_text', text: prompt }] },
        ],
        stream: true,
        store: false,
      }),
    });
  let response = await post();
  if (response.status === 401) {
    await refresh();
    tokens = await defaultStore.load();
    response = await post();
  }
  if (!response.ok)
    throw new Error(
      `Codex: ${response.status} ${(await response.text()).slice(0, 500)}`,
    );
  if (!response.body) throw new Error('Пустой поток Codex.');
  const decoder = new TextDecoder();
  let buffer = '',
    text = '',
    completed = false;
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (raw === '[DONE]') continue;
      let event;
      try {
        event = JSON.parse(raw);
      } catch {
        continue;
      }
      if (event.type === 'response.output_text.delta') text += event.delta;
      if (event.type === 'response.completed') completed = true;
      if (
        ['response.failed', 'response.incomplete', 'error'].includes(event.type)
      )
        throw new Error(
          event.response?.error?.message ||
            event.error?.message ||
            'Codex не завершил ответ.',
        );
    }
  }
  if (!completed || !text.trim())
    throw new Error('Codex вернул незавершённый ответ.');
  return text;
}
