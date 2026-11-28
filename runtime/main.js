import { createApp } from './app.js';

const params = new URLSearchParams(location.search);
const embedded = window.parent !== window;
if (embedded) document.documentElement.classList.add('embedded');

const app = createApp({ embedded, params });

let resizeQueued = false;
const onResize = () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    app.onResize();
  });
};

window.addEventListener('message', app.onMessage);
window.addEventListener('resize', onResize);
document.addEventListener('visibilitychange', app.onVisibility);
window.addEventListener('pagehide', app.dispose);

app.start();

if (!embedded || params.get('debug') === '1') {
  window.__ocean = app.debugApi;
}
