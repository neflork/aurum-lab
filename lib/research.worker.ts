import { research } from './engine';
self.onmessage = (event) => {
  try {
    self.postMessage({
      ok: true,
      result: research(event.data.bars, event.data.config),
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Ошибка исследования.',
    });
  }
};
