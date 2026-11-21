window.__ModuleLoader__.load({
  id: 'dsh-ocean-background',
  factory() {
    const FRAME_ID = 'ocean-background-frame';
    const SHELL_STYLE_ID = 'ocean-background-shell';
    const UI_STYLE_ID = 'ocean-background-ui-style';
    const BUTTON_ID = 'ocean-background-button';
    const PANEL_ID = 'ocean-background-panel';
    const MILEAGE_ID = 'ocean-background-mileage';
    const DOCK_ID = 'ocean-background-dock';
    const STORE_KEY = 'ocean-background:settings';
    const KILL_KEY = 'ocean-background:disabled';
    const READY_TIMEOUT = 8000;
    const METERS_PER_NM = 1852;
    const MILEAGE_POLL_MS = 1000;

    const DEFAULTS = {
      enabled: true, strength: 0.72, running: true, quality: 'balanced',
      cameraDistance: 44, cameraHeight: 4.8, cameraPitch: 2.7, cameraXOffset: 0,
    };
    const CAMERA_LIMITS = {
      cameraDistance: { min: 20, max: 100, step: 1 },
      cameraHeight: { min: 2, max: 40, step: 0.1 },
      cameraPitch: { min: -30, max: 60, step: 0.1 },
      cameraXOffset: { min: -8, max: 8, step: 0.1 },
    };

    function cameraValue(key, value) {
      const { min, max, step } = CAMERA_LIMITS[key];
      if (!Number.isFinite(value)) return DEFAULTS[key];
      const clamped = Math.min(max, Math.max(min, value));
      return Number((Math.round(clamped / step) * step).toFixed(1));
    }

    function displayNauticalMiles(meters) {
      return (Math.floor((meters * 100) / METERS_PER_NM + 1e-9) / 100).toFixed(2);
    }

    // Interface copy is a locale table keyed by language tag. messagesFor()
    // accepts any BCP 47 tag, falls back from a region variant to its base
    // language, then to English. Adding a language means adding one entry here.
    const MESSAGES = {
      zh: { open: '海景设置', show: '显示海面', strength: '背景强度', running: '播放', quality: '画质', balanced: '均衡', high: '高', cameraDistance: '摄像机距离', cameraHeight: '摄像机高度', cameraPitch: '摄像机俯仰角', cameraXOffset: '镜头左右偏移', cameraHint: '左右偏移：负值向左，正值向右，上限 8。俯仰角：负值向上，正值向下。', recovering: '海面未就绪，界面保持原样', mileageToday: '今日已航行', mileageFleet: '目前已航行', mileageUnit: '海里' },
      en: { open: 'Ocean settings', show: 'Show ocean', strength: 'Strength', running: 'Playing', quality: 'Quality', balanced: 'Balanced', high: 'High', cameraDistance: 'Camera distance', cameraHeight: 'Camera height', cameraPitch: 'Camera pitch', cameraXOffset: 'Camera horizontal offset', cameraHint: 'Horizontal offset: negative left, positive right; limit 8. Pitch: negative looks up, positive looks down.', recovering: 'Sea not ready, interface untouched', mileageToday: 'Sailed today', mileageFleet: 'Sailed', mileageUnit: 'nm' },
    };
    const FALLBACK_LANGUAGE = 'en';

    function messagesFor(languageTag) {
      const tag = String(languageTag || '').toLowerCase();
      const base = tag.split('-')[0];
      const matched = MESSAGES[tag] ? tag : (MESSAGES[base] ? base : FALLBACK_LANGUAGE);
      return { ...MESSAGES[FALLBACK_LANGUAGE], ...MESSAGES[matched] };
    }

    // Shell styling is the Open Sea Skin recipe, kept as close to the original as
    // this plugin needs. The mechanism is a single one: the theme's own surface
    // tokens are made translucent on #root, so every surface that reads a token
    // becomes see-through at once. No container is targeted by class name, and
    // nothing is forced fully transparent, which is what keeps the text readable.
    //
    // The frame is the one exception. It paints its own fill from --dsw-alias-bg-base
    // and its columns paint again on top, so those get pinned to the same
    // translucent token instead of compounding into a darker centre.
    function shellCss(strength) {
      const light = Math.min(0.95, Math.max(0.35, strength));
      const dark = Math.max(0.40, light - 0.12);
      const a = (value) => Number(value.toFixed(2));
      return `
body {
  background: transparent !important;
}
body #root {
  --dsw-alias-bg-base: rgba(255, 255, 255, ${a(light)}) !important;
  --dsw-alias-bg-layer-1: rgba(255, 255, 255, ${a(light)}) !important;
  --dsw-alias-bg-layer-2: rgba(255, 255, 255, ${a(light)}) !important;
  --dsw-alias-bg-layer-3: rgba(255, 255, 255, ${a(light)}) !important;
  --dsw-alias-bg-module-platform: rgba(245, 246, 247, ${a(light + 0.02)}) !important;
  --dsw-alias-bg-multi-select: rgba(245, 246, 247, ${a(light + 0.02)}) !important;
  --dsw-alias-bg-overlay: rgba(233, 236, 242, .97) !important;
  --dsw-specific-sidebar-fill: rgba(249, 250, 251, ${a(Math.max(0.36, light - 0.04))}) !important;
  --dsw-specific-selector: rgba(245, 246, 247, ${a(light + 0.02)}) !important;
}
body[data-ds-dark-theme] #root {
  --dsw-alias-bg-base: rgba(9, 12, 16, ${a(dark)}) !important;
  --dsw-alias-bg-layer-1: rgba(12, 16, 22, ${a(dark)}) !important;
  --dsw-alias-bg-layer-2: rgba(16, 20, 27, ${a(dark)}) !important;
  --dsw-alias-bg-layer-3: rgba(20, 25, 33, ${a(dark)}) !important;
  --dsw-alias-bg-module-platform: rgba(13, 17, 23, ${a(dark + 0.02)}) !important;
  --dsw-alias-bg-multi-select: rgba(13, 17, 23, ${a(dark + 0.02)}) !important;
  --dsw-alias-bg-overlay: rgba(18, 22, 30, .97) !important;
  --dsw-specific-sidebar-fill: rgba(11, 15, 21, ${a(Math.max(0.35, dark - 0.05))}) !important;
  --dsw-specific-selector: rgba(13, 17, 23, ${a(dark + 0.02)}) !important;
}
/* Official Harness Desktop 0.2.x: sidebar, centre, conversation and docked
   rightbar each paint a surface, and translucent paints compound into a much
   darker centre. Paint the shared frame once from the token, then clear the
   columns so only that one translucent fill remains. */
html:is([data-platform="darwin"], [data-windows-titlebar]) body #root div:has(> [data-shell-overlay]) {
  background: var(--dsw-alias-bg-base) !important;
}
/* The sidebar slot paints its own tint from this token in the Web layout as
   well as the desktop one, so it is cleared at the semantic boundary rather
   than only under the desktop attribute. */
body #root [data-slot="sidebar"] {
  --dsw-specific-sidebar-fill: transparent !important;
}
html:is([data-platform="darwin"], [data-windows-titlebar]) body #root div:has(> [data-shell-overlay]) > :is(:first-child, :nth-child(2), [data-rightbar-col], [data-shell-bottom]),
html:is([data-platform="darwin"], [data-windows-titlebar]) body #root div:has(> [data-shell-overlay]) > :nth-child(2) [data-phase],
html:is([data-platform="darwin"], [data-windows-titlebar]) body #root [data-rightbar-col] [data-dockkit-host="dock"] > [data-dockkit-content] {
  background: transparent !important;
}
html[data-windows-titlebar] body #root div:has(> [data-shell-overlay])::before {
  background: transparent !important;
}
/* Composer, bubbles and code cards keep a solid surface inside the conversation
   slot; settings and other plugin interfaces keep their original fills. */
body [data-slot="main.conversation"] {
  --dsw-specific-input-major: var(--dsw-alias-bg-layer-1) !important;
  --dsw-specific-bubble: var(--dsw-alias-bg-layer-2) !important;
  --dsw-alias-markdown-code-block: var(--dsw-alias-bg-layer-1) !important;
  --dsw-alias-markdown-code-block-banner: var(--dsw-alias-bg-layer-2) !important;
}
/* Dialog cards are body-level portals: keep them opaque so no text sits on the
   sea. The plugin's own panel is excluded and styles itself. */
body :is([data-shortcut-modal="settings"], [role="dialog"], [role="alertdialog"]):not(#${PANEL_ID}) {
  background: rgba(250, 251, 253, .97) !important;
}
body[data-ds-dark-theme] :is([data-shortcut-modal="settings"], [role="dialog"], [role="alertdialog"]):not(#${PANEL_ID}) {
  background: rgba(24, 28, 35, .97) !important;
}
`;
    }

    const UI_CSS = `
#${DOCK_ID} {
  position: fixed; right: 14px; bottom: 12px; z-index: 6000;
  display: flex; align-items: center; gap: 8px;
  pointer-events: none;
}
#${BUTTON_ID} {
  flex: none;
  width: 30px; height: 30px; padding: 0; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: .8; pointer-events: auto;
  border: 1px solid rgba(120, 170, 190, .38);
  background: rgba(16, 40, 50, .55);
  color: #e8f6fb;
  backdrop-filter: blur(8px) saturate(130%);
  transition: opacity .16s ease, background .16s ease, border-color .16s ease;
}
#${BUTTON_ID}:hover, #${BUTTON_ID}:focus-visible {
  opacity: 1; background: rgba(20, 54, 66, .8); border-color: rgba(160, 220, 235, .65);
}
#${BUTTON_ID}[data-on="false"] { color: #c9d6da; border-color: rgba(150, 170, 180, .34); }
#${MILEAGE_ID} {
  flex: none;
  height: 30px; display: flex; align-items: center;
  box-sizing: border-box;
  font: 600 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #082c36; white-space: nowrap;
  text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 4px rgba(255, 255, 255, .95), 0 1px 2px rgba(255, 255, 255, .9);
  pointer-events: none; user-select: none;
}
#${MILEAGE_ID}[hidden] { display: none; }
body[data-ds-dark-theme] #${MILEAGE_ID} {
  color: #f2fafd;
  text-shadow: 0 0 2px rgba(0, 0, 0, .95), 0 0 2px rgba(0, 0, 0, .9), 0 1px 3px rgba(0, 0, 0, .85);
}
#${PANEL_ID} {
  position: fixed; right: 14px; bottom: 50px; z-index: 6001;
  width: 240px; padding: 13px 14px 14px; border-radius: 12px;
  max-height: calc(100dvh - 80px); overflow-y: auto;
  background: rgba(248, 251, 252, .97);
  border: 1px solid rgba(20, 60, 75, .16);
  box-shadow: 0 12px 32px rgba(9, 32, 40, .22);
  font: 12px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #16333d;
}
body[data-ds-dark-theme] #${PANEL_ID} {
  background: rgba(20, 27, 33, .97);
  border-color: rgba(160, 200, 215, .22);
  color: #e2eef2;
}
#${PANEL_ID}[hidden] { display: none; }
#${PANEL_ID} .ob-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 9px 0 0; }
#${PANEL_ID} .ob-row:first-child { margin-top: 0; }
#${PANEL_ID} .ob-title { font-weight: 600; margin: 0 0 6px; }
#${PANEL_ID} .ob-note { margin: 8px 0 0; opacity: .7; font-size: 11px; }
#${PANEL_ID} input[type="range"] { width: 100%; margin: 6px 0 0; }
#${PANEL_ID} select { font: inherit; padding: 2px 6px; border-radius: 6px; }
#${PANEL_ID} label { display: block; }
`;

    function readSettings() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY);
        const saved = raw ? JSON.parse(raw) : {};
        return {
          enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : DEFAULTS.enabled,
          strength: Number.isFinite(saved?.strength) ? Math.min(0.95, Math.max(0.35, saved.strength)) : DEFAULTS.strength,
          running: typeof saved?.running === 'boolean' ? saved.running : DEFAULTS.running,
          quality: saved?.quality === 'high' ? 'high' : 'balanced',
          cameraDistance: cameraValue('cameraDistance', saved?.cameraDistance),
          cameraHeight: cameraValue('cameraHeight', saved?.cameraHeight),
          cameraPitch: cameraValue('cameraPitch', saved?.cameraPitch),
          cameraXOffset: cameraValue('cameraXOffset', saved?.cameraXOffset),
        };
      } catch {
        return { ...DEFAULTS };
      }
    }

    function writeSettings(settings) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(settings));
      } catch {}
    }

    function setStyle(id, css) {
      let node = document.getElementById(id);
      if (!node) {
        node = document.createElement('style');
        node.id = id;
        (document.head || document.documentElement).appendChild(node);
      }
      node.textContent = css;
      return node;
    }

    return {
      inject: ['sessions', 'locale'],
      apply(ctx) {
        try {
          if (window.localStorage.getItem(KILL_KEY) === '1') return;
          if (new URLSearchParams(location.search).get('ocean') === 'off') return;
        } catch {}

        return ctx.effect(() => {
          const state = { settings: readSettings(), sessionId: null, revealed: false, failed: false, disposed: false };
          // Follow the host's own language service. Its `active` id is the
          // authoritative value (e.g. zh-pirate, en, ja); document.lang is only
          // a late mirror of it and can lag behind at mount time.
          const activeLanguage = ctx.locale?.getSnapshot?.().active;
          let text = messagesFor(activeLanguage || document.documentElement.lang || navigator.language);
          let lastMileageData = null;
          let frame = null;
          let readyTimer = 0;

          setStyle(UI_STYLE_ID, UI_CSS);

          const mileageLabel = document.createElement('div');
          mileageLabel.id = MILEAGE_ID;
          mileageLabel.setAttribute('role', 'status');
          mileageLabel.setAttribute('aria-live', 'polite');
          mileageLabel.hidden = true;
          let mileageTimer = 0;
          let mileageGeneration = 0;
          let mileageRequest = null;

          const stopMileage = () => {
            if (mileageTimer !== 0) window.clearTimeout(mileageTimer);
            mileageTimer = 0;
            mileageRequest?.abort();
            mileageRequest = null;
          };

          const showMileage = () => {
            mileageLabel.hidden = !(state.settings.enabled && state.revealed && mileageLabel.textContent !== '');
          };

          const applyMileage = (data) => {
            if (!data || data.ok !== true) return;
            const fleet = data.mode === 'fleet';
            const meters = fleet ? data.fleetMeters : data.todayMeters;
            if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return;
            lastMileageData = data;
            const value = displayNauticalMiles(meters);
            const next = `${fleet ? text.mileageFleet : text.mileageToday} ${value} ${text.mileageUnit}`;
            if (next !== mileageLabel.textContent) mileageLabel.textContent = next;
            showMileage();
          };

          const fetchMileage = () => {
            if (state.disposed || document.hidden || !state.settings.enabled || !state.revealed || mileageRequest) return;
            if (typeof fetch !== 'function') return;
            const generation = mileageGeneration;
            const sessionId = state.sessionId;
            const query = sessionId === null ? '' : `?sessionId=${encodeURIComponent(sessionId)}`;
            const request = new AbortController();
            mileageRequest = request;
            try {
              Promise.resolve(fetch(`/ocean-background/mileage${query}`, { cache: 'no-store', signal: request.signal }))
                .then((response) => (response && response.ok ? response.json() : null))
                .then((data) => {
                  if (state.disposed || !state.settings.enabled || mileageRequest !== request) return;
                  if (generation !== mileageGeneration || sessionId !== state.sessionId) return;
                  applyMileage(data);
                })
                .catch(() => {})
                .finally(() => {
                  if (mileageRequest === request) mileageRequest = null;
                });
            } catch {
              if (mileageRequest === request) mileageRequest = null;
            }
          };

          const scheduleMileage = () => {
            if (state.disposed || document.hidden || !state.settings.enabled || !state.revealed || mileageTimer !== 0) return;
            mileageTimer = window.setTimeout(() => {
              mileageTimer = 0;
              fetchMileage();
              scheduleMileage();
            }, MILEAGE_POLL_MS);
          };

          const post = () => {
            frame?.contentWindow?.postMessage({
              type: 'ocean-settings',
              settings: { ...state.settings, sessionId: state.sessionId, visible: !document.hidden },
            }, location.origin);
          };

          const clearDeadline = () => {
            window.clearTimeout(readyTimer);
            readyTimer = 0;
          };

          const unmountFrame = () => {
            clearDeadline();
            stopMileage();
            frame?.remove();
            frame = null;
            state.revealed = false;
            mileageLabel.hidden = true;
            document.getElementById(SHELL_STYLE_ID)?.remove();
          };

          const armDeadline = () => {
            if (!frame || state.revealed || document.hidden || readyTimer) return;
            const pending = frame;
            readyTimer = window.setTimeout(() => {
              if (state.disposed || frame !== pending || state.revealed) return;
              unmountFrame();
              state.failed = true;
              document.getElementById('ob-note').hidden = false;
              console.warn('[ocean-background] renderer readiness timed out');
            }, READY_TIMEOUT);
          };

          const mountFrame = () => {
            if (frame || state.disposed || !state.settings.enabled || document.hidden) return;
            state.failed = false;
            document.getElementById('ob-note').hidden = true;
            frame = document.createElement('iframe');
            frame.id = FRAME_ID;
            frame.setAttribute('aria-hidden', 'true');
            frame.setAttribute('tabindex', '-1');
            frame.title = 'Ocean background';
            frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:0;pointer-events:none;background:transparent;';
            frame.addEventListener('load', post);
            frame.src = `/ocean-background/?quality=${encodeURIComponent(state.settings.quality)}`;
            const host = document.body || document.documentElement;
            host.insertBefore(frame, host.firstChild);
            armDeadline();
          };

          const onMessage = (event) => {
            if (state.disposed || !frame || event.origin !== location.origin || event.source !== frame.contentWindow) return;
            if (event.data?.type !== 'ocean-ready' || state.revealed) return;
            state.revealed = true;
            clearDeadline();
            if (state.settings.enabled) setStyle(SHELL_STYLE_ID, shellCss(state.settings.strength));
            showMileage();
            fetchMileage();
            scheduleMileage();
          };
          window.addEventListener('message', onMessage);

          const onVisibility = () => {
            if (document.hidden) {
              clearDeadline();
              stopMileage();
            } else {
              if (!state.failed) mountFrame();
              armDeadline();
              fetchMileage();
              scheduleMileage();
            }
            post();
          };
          document.addEventListener('visibilitychange', onVisibility);

          // ---- controls ---------------------------------------------------------
          // Plain DOM with an always-present stylesheet, like the reference plugin.
          // Living in a slot shared the shell stylesheet, so switching the sea off
          // also stripped the button's styling and lost it.
          const button = document.createElement('button');
          button.id = BUTTON_ID;
          button.type = 'button';
          button.title = text.open;
          button.setAttribute('aria-label', text.open);
          button.setAttribute('aria-controls', PANEL_ID);
          button.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">'
            + '<path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>'
            + '<path d="M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>'
            + '<path d="M12 4v5"/><path d="M9.5 6.5 12 4l2.5 2.5"/></svg>';

          const panel = document.createElement('div');
          panel.id = PANEL_ID;
          panel.setAttribute('role', 'dialog');
          panel.setAttribute('aria-label', text.open);
          panel.hidden = true;
          panel.innerHTML = ''
            + `<p class="ob-title" id="ob-title">${text.open}</p>`
            + `<div class="ob-row"><label for="ob-enabled" id="ob-show-label">${text.show}</label><input id="ob-enabled" type="checkbox"></div>`
            + `<div><div class="ob-row"><label for="ob-strength" id="ob-strength-label">${text.strength}</label><output id="ob-strength-out"></output></div>`
            + `<input id="ob-strength" type="range" min="35" max="95" step="1"></div>`
            + `<div class="ob-row"><label for="ob-running" id="ob-running-label">${text.running}</label><input id="ob-running" type="checkbox"></div>`
            + `<div class="ob-row"><label for="ob-quality" id="ob-quality-label">${text.quality}</label><select id="ob-quality">`
            + `<option value="balanced" id="ob-balanced-option">${text.balanced}</option><option value="high" id="ob-high-option">${text.high}</option></select></div>`
            + Object.entries(CAMERA_LIMITS).map(([key, limits]) =>
              `<div><div class="ob-row"><label for="ob-${key}" id="ob-${key}-label">${text[key]}</label><output id="ob-${key}-out" for="ob-${key}"></output></div>`
              + `<input id="ob-${key}" type="range" min="${limits.min}" max="${limits.max}" step="${limits.step}"></div>`
            ).join('')
            + `<p class="ob-note" id="ob-camera-hint">${text.cameraHint}</p>`
            + `<p class="ob-note" id="ob-note" hidden>${text.recovering}</p>`;

          const enabledInput = panel.querySelector('#ob-enabled');
          const strengthInput = panel.querySelector('#ob-strength');
          const strengthOut = panel.querySelector('#ob-strength-out');
          const runningInput = panel.querySelector('#ob-running');
          const qualitySelect = panel.querySelector('#ob-quality');

          const syncControls = () => {
            enabledInput.checked = state.settings.enabled;
            strengthInput.value = String(Math.round(state.settings.strength * 100));
            strengthOut.textContent = Math.round(state.settings.strength * 100) + '%';
            runningInput.checked = state.settings.running;
            qualitySelect.value = state.settings.quality;
            for (const key of Object.keys(CAMERA_LIMITS)) {
              panel.querySelector(`#ob-${key}`).value = String(state.settings[key]);
              panel.querySelector(`#ob-${key}-out`).textContent = state.settings[key].toFixed(CAMERA_LIMITS[key].step === 1 ? 0 : 1)
                + (key === 'cameraPitch' ? '°' : '');
            }
            button.dataset.on = String(state.settings.enabled);
          };

          const setText = (id, value) => {
            const node = panel.querySelector(`#${id}`);
            if (node) node.textContent = value;
          };

          const refreshLanguage = () => {
            const active = ctx.locale?.getSnapshot?.().active;
            text = messagesFor(active || document.documentElement.lang || navigator.language);
            button.title = text.open;
            button.setAttribute('aria-label', text.open);
            panel.setAttribute('aria-label', text.open);
            setText('ob-title', text.open);
            setText('ob-show-label', text.show);
            setText('ob-strength-label', text.strength);
            setText('ob-running-label', text.running);
            setText('ob-quality-label', text.quality);
            setText('ob-balanced-option', text.balanced);
            setText('ob-high-option', text.high);
            for (const key of Object.keys(CAMERA_LIMITS)) setText(`ob-${key}-label`, text[key]);
            setText('ob-camera-hint', text.cameraHint);
            setText('ob-note', text.recovering);
            if (lastMileageData) applyMileage(lastMileageData);
          };

          const stopLocale = typeof ctx.locale?.subscribe === 'function'
            ? ctx.locale.subscribe(refreshLanguage)
            : null;

          const applySettings = (patch) => {
            const qualityChanged = patch.quality !== undefined && patch.quality !== state.settings.quality;
            state.settings = { ...state.settings, ...patch };
            writeSettings(state.settings);
            syncControls();
            if (!state.settings.enabled || qualityChanged) unmountFrame();
            if (!state.settings.enabled) {
              document.getElementById('ob-note').hidden = true;
              stopMileage();
              mileageLabel.hidden = true;
            } else {
              showMileage();
              fetchMileage();
              scheduleMileage();
            }
            mountFrame();
            if (state.revealed) setStyle(SHELL_STYLE_ID, shellCss(state.settings.strength));
            post();
          };

          enabledInput.addEventListener('change', () => applySettings({ enabled: enabledInput.checked }));
          strengthInput.addEventListener('input', () => applySettings({ strength: Number(strengthInput.value) / 100 }));
          runningInput.addEventListener('change', () => applySettings({ running: runningInput.checked }));
          qualitySelect.addEventListener('change', () => applySettings({ quality: qualitySelect.value }));
          for (const key of Object.keys(CAMERA_LIMITS)) {
            const input = panel.querySelector(`#ob-${key}`);
            input.addEventListener('input', () => applySettings({ [key]: cameraValue(key, Number(input.value)) }));
          }

          button.addEventListener('click', () => {
            panel.hidden = !panel.hidden;
            button.setAttribute('aria-expanded', String(!panel.hidden));
          });

          button.setAttribute('aria-expanded', 'false');
          const onKeyDown = (event) => {
            if (event.key !== 'Escape' || panel.hidden) return;
            panel.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            button.focus();
          };
          document.addEventListener('keydown', onKeyDown);
          // One dock owns both controls. A stale node from an interrupted mount
          // would otherwise sit on top of the new pair at the same coordinates.
          for (const id of [DOCK_ID, BUTTON_ID, PANEL_ID, MILEAGE_ID]) {
            document.getElementById(id)?.remove();
          }
          const dock = document.createElement('div');
          dock.id = DOCK_ID;
          dock.appendChild(mileageLabel);
          dock.appendChild(button);
          document.body.appendChild(dock);
          document.body.appendChild(panel);
          syncControls();

          const sessions = ctx.sessions.list;
          let selectionQueued = false;
          const syncSelection = () => {
            if (state.disposed) return;
            // mainView is the Session Controller's explicit reference source.
            const selected = Object.values(sessions.getSnapshot().byId)
              .filter((session) => session.retainedBy?.mainView > 0);
            const sessionId = selected.length === 1 ? selected[0].id : null;
            if (sessionId === state.sessionId) return;
            stopMileage();
            state.sessionId = sessionId;
            mileageGeneration += 1;
            lastMileageData = null;
            mileageLabel.textContent = '';
            showMileage();
            post();
            fetchMileage();
            scheduleMileage();
          };
          const stopSelection = sessions.subscribe(() => {
            if (selectionQueued) return;
            selectionQueued = true;
            queueMicrotask(() => {
              selectionQueued = false;
              syncSelection();
            });
          });
          syncSelection();
          mountFrame();

          return () => {
            state.disposed = true;
            stopSelection();
            stopMileage();
            stopLocale?.();
            window.removeEventListener('message', onMessage);
            document.removeEventListener('visibilitychange', onVisibility);
            document.removeEventListener('keydown', onKeyDown);
            unmountFrame();
            button.remove();
            panel.remove();
            mileageLabel.remove();
            dock.remove();
            document.getElementById(UI_STYLE_ID)?.remove();
          };
        }, 'ocean-background: mount');
      },
    };
  },
});

