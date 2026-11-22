import { createApp } from './app.js';

const params = new URLSearchParams(location.search);
const embedded = window.parent !== window;
if (embedded) document.documentElement.classList.add('embedded');

const app = createApp({ embedded, params });

window.addEventListener('message', app.onMessage);
window.addEventListener('resize', app.onResize);
document.addEventListener('visibilitychange', app.onVisibility);
window.addEventListener('pagehide', app.dispose);

app.start();

if (!embedded || params.get('debug') === '1') {
  window.__ocean = app.debugApi;
}
