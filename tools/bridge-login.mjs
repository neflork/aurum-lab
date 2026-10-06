// Only public progress and the authorize URL leave the local bridge.
export function createBridgeLogin(login) {
  let state = 'idle';
  let error = null;
  let starting = null;
  return {
    status: () => ({ state, error }),
    start() {
      if (state === 'pending') return starting;
      state = 'pending';
      error = null;
      starting = new Promise((resolve, reject) => {
        Promise.resolve()
          .then(() =>
            login({
              openBrowser: false,
              onUrl(url) {
                resolve({ authUrl: url });
              },
            }),
          )
          .then(
            () => {
              state = 'completed';
            },
            () => {
              state = 'failed';
              error =
                'Не удалось завершить вход. Попробуйте ещё раз; закройте другие окна входа в Codex.';
              reject(new Error(error));
            },
          );
      });
      return starting;
    },
  };
}
