// Cloudflare Turnstile in the browser: loads the widget on first use and hands
// out tokens. Most visitors never see it; it only shows a checkbox when
// Cloudflare isn't sure.

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widget: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')));
    script.onerror = () => reject(new Error('turnstile failed to load'));
    document.head.append(script);
  });
}

export function turnstileTokens(container: HTMLElement, siteKey: string) {
  let widget: Promise<{ api: TurnstileApi; id: string }> | null = null;
  let token = '';
  // True while the widget is working on a token nobody has used yet.
  let solving = false;
  let waiting: ((token: string) => void)[] = [];

  function start() {
    if (!widget) solving = true;
    widget ??= loadScript().then((api) => ({
      api,
      id: api.render(container, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        callback: (t: string) => {
          token = t;
          solving = false;
          const ready = waiting;
          waiting = [];
          ready.forEach((resolve) => resolve(t));
        },
        'expired-callback': () => {
          token = '';
        },
        'error-callback': () => {
          solving = false;
        },
      }),
    }));
    return widget;
  }

  return {
    // Starts the check early, so a token is usually ready by the first question.
    warm() {
      start().catch(() => {});
    },
    // Each token is single-use, so it is handed out once and forgotten.
    async token(fresh: boolean): Promise<string> {
      const { api, id } = await start();
      // A used or expired token needs a new check; one already on the way
      // is waited for instead of restarted.
      if (fresh || (!token && !solving)) {
        token = '';
        solving = true;
        api.reset(id);
      }
      // A blocked script or a stuck check fails the question instead of
      // leaving it spinning.
      const ready =
        token ||
        (await new Promise<string>((resolve, reject) => {
          waiting.push(resolve);
          setTimeout(() => reject(new Error('turnstile timed out')), 30_000);
        }));
      token = '';
      return ready;
    },
  };
}
