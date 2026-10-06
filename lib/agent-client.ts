export type AgentConnection = {
  state: 'checking' | 'connected' | 'unauthorized' | 'offline';
  account: string | null;
  model: string | null;
  checkedAt: string | null;
  error?: string;
  loginState?: 'idle' | 'pending' | 'completed' | 'failed';
  loginError?: string;
};

export function agentEndpoint(
  path: 'status' | 'analyze' | 'login' | 'logout',
  hostname: string,
) {
  return hostname === 'localhost' || hostname === '127.0.0.1'
    ? `/api/local-codex/${path}`
    : `http://127.0.0.1:8787/${path}`;
}

export async function logoutAgent(hostname: string): Promise<void> {
  const response = await fetch(agentEndpoint('logout', hostname), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error('Не удалось выйти из аккаунта. Попробуйте ещё раз.');
  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('connected' in payload) ||
    payload.connected !== false
  )
    throw new Error('Помощник не подтвердил выход из аккаунта.');
}

export async function startAgentLogin(hostname: string): Promise<string> {
  const response = await fetch(agentEndpoint('login', hostname), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  const payload: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      payload &&
        typeof payload === 'object' &&
        'error' in payload &&
        typeof payload.error === 'string'
        ? payload.error
        : 'Не удалось начать вход.',
    );
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('authUrl' in payload) ||
    typeof payload.authUrl !== 'string'
  )
    throw new Error('Мост вернул некорректный адрес входа.');
  const url = new URL(payload.authUrl);
  if (
    url.protocol !== 'https:' ||
    !['auth.openai.com', 'chatgpt.com'].includes(url.hostname)
  )
    throw new Error('Получен неизвестный адрес входа.');
  return url.href;
}

export async function readAgentConnection(
  hostname: string,
  signal?: AbortSignal,
): Promise<AgentConnection> {
  try {
    const response = await fetch(agentEndpoint('status', hostname), {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
        : AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!response.ok)
      throw new Error(`Мост ответил с кодом ${response.status}.`);
    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('connected' in payload) ||
      typeof payload.connected !== 'boolean'
    ) {
      throw new Error('Мост вернул некорректный статус.');
    }
    const login =
      'login' in payload && payload.login && typeof payload.login === 'object'
        ? (payload.login as { state?: string; error?: string })
        : null;
    return {
      state: payload.connected ? 'connected' : 'unauthorized',
      account:
        'account' in payload && typeof payload.account === 'string'
          ? payload.account
          : null,
      model:
        'model' in payload && typeof payload.model === 'string'
          ? payload.model
          : null,
      checkedAt: new Date().toISOString(),
      loginState: ['idle', 'pending', 'completed', 'failed'].includes(
        login?.state ?? '',
      )
        ? (login?.state as AgentConnection['loginState'])
        : undefined,
      loginError: typeof login?.error === 'string' ? login.error : undefined,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      state: 'offline',
      account: null,
      model: null,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Мост недоступен.',
    };
  }
}
