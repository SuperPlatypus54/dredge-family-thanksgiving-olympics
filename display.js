import { apiUrl } from './site-config.js';

export function watchScoreboard({ onState, onConnection }) {
  let pending;

  async function fetchState() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(apiUrl('/api/state'), { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Could not reach the scoreboard.');
      onState(await response.json());
      onConnection(true);
    } catch {
      onConnection(false);
    } finally {
      clearTimeout(timeout);
    }
  }

  function refresh() {
    pending ??= fetchState().finally(() => { pending = undefined; });
    return pending;
  }

  setInterval(refresh, 2200);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  return refresh;
}

export function setupFullscreen(button) {
  const root = document.documentElement;
  const enter = root.requestFullscreen ?? root.webkitRequestFullscreen;
  const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
  const available = Boolean(enter && exit && (document.fullscreenEnabled ?? document.webkitFullscreenEnabled));
  if (button) button.hidden = !available;
  if (!available) return;

  const active = () => Boolean(document.fullscreenElement ?? document.webkitFullscreenElement);

  async function toggle() {
    try {
      if (active()) await exit.call(document);
      else await enter.call(root);
    } catch {
      if (button) button.textContent = 'Use browser full screen';
    }
  }

  if (button) {
    const updateLabel = () => {
      button.textContent = active() ? 'Exit full screen' : 'Full screen';
    };
    button.addEventListener('click', toggle);
    document.addEventListener('fullscreenchange', updateLabel);
    document.addEventListener('webkitfullscreenchange', updateLabel);
  }

  document.addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'f' || event.repeat || event.ctrlKey || event.metaKey || event.altKey
      || event.target.closest?.('input, select, textarea, [contenteditable], dialog')) return;
    event.preventDefault();
    toggle();
  });
}
