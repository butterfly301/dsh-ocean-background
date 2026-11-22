// Standalone debug feed. In the embedded product the host-page deck owns the
// only poller and pushes snapshots into the frame. This module exists so the
// renderer can still be opened directly at /ocean-background/?debug=1.

export const DEFAULT_POLL_MS = 1000;

export function createSnapshotFeed({
  sessionId = null,
  intervalMs = DEFAULT_POLL_MS,
  fetchImpl = (...args) => fetch(...args),
  onSnapshot = () => {},
  onError = () => {},
} = {}) {
  let timer = 0;
  let request = null;
  let stopped = false;
  let generation = 0;

  function url() {
    return sessionId === null || sessionId === ''
      ? './snapshot'
      : `./snapshot?sessionId=${encodeURIComponent(sessionId)}`;
  }

  function stopTimer() {
    if (timer !== 0) clearTimeout(timer);
    timer = 0;
  }

  function schedule(delay = intervalMs) {
    if (stopped || timer !== 0) return;
    timer = setTimeout(() => {
      timer = 0;
      poll();
    }, delay);
  }

  function poll() {
    if (stopped) return;
    const mine = ++generation;
    const controller = new AbortController();
    request = controller;
    let pending;
    try {
      pending = Promise.resolve(fetchImpl(url(), { cache: 'no-store', signal: controller.signal }));
    } catch (error) {
      onError(error);
      schedule();
      return;
    }
    pending
      .then((response) => (response && response.ok ? response.json() : null))
      .then((data) => {
        if (stopped || mine !== generation || !data || data.ok === false) return;
        onSnapshot(data);
      })
      .catch((error) => {
        if (!stopped && mine === generation) onError(error);
      })
      .finally(() => {
        if (request === controller) request = null;
        schedule();
      });
  }

  return {
    start() {
      if (stopped) return;
      schedule(0);
    },
    setSession(next) {
      if (next === sessionId) return;
      sessionId = next;
      generation += 1;
      try { request?.abort(); } catch {}
      request = null;
      stopTimer();
      schedule(0);
    },
    stop() {
      stopped = true;
      generation += 1;
      stopTimer();
      try { request?.abort(); } catch {}
      request = null;
    },
  };
}
