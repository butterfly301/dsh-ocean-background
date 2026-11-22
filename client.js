window.__ModuleLoader__.load({
  id: 'dsh-ocean-background',
  factory() {
    const BASE = '/ocean-background';
    const FRAME_ID = 'ocean-background-frame';
    const SHELL_STYLE_ID = 'ocean-background-shell';
    const UI_STYLE_ID = 'ocean-background-ui-style';
    const BUTTON_ID = 'ocean-background-button';
    const PANEL_ID = 'ocean-background-panel';
    const MILEAGE_ID = 'ocean-background-mileage';
    const DOCK_ID = 'ocean-background-dock';
    const STORE_KEY = 'ocean-background:settings';
    const KILL_KEY = 'ocean-background:disabled';
    const UI_NS = 'ocean-background-ui';
    const READY_TIMEOUT = 8000;
    const SNAPSHOT_MS = 1000;
    const PERSIST_MS = 250;
    const METERS_PER_NM = 1852;


    const FALLBACK_TEXT = {
      open: 'Ocean settings',
      show: 'Show ocean',
      strength: 'Strength',
      running: 'Playing',
      quality: 'Quality',
      balanced: 'Balanced',
      high: 'High',
      cameraDistance: 'Camera distance',
      cameraHeight: 'Camera height',
      cameraPitch: 'Camera pitch',
      cameraXOffset: 'Camera horizontal offset',
      cameraHint: 'Horizontal offset: negative left, positive right; limit 8. Pitch: negative looks up, positive looks down.',
      recovering: 'Sea not ready, interface untouched',
      mileageToday: 'Sailed today',
      mileageFleet: 'Sailed',
      mileageUnit: 'nm',
    };



    const SKIN_VARS = [
      '--ob-light',
      '--ob-light-hi',
      '--ob-light-lo',
      '--ob-dark',
      '--ob-dark-hi',
      '--ob-dark-lo',
    ];

    function displayNauticalMiles(meters) {
      return (Math.floor((meters * 100) / METERS_PER_NM + 1e-9) / 100).toFixed(2);
    }

    function ensureStylesheet(id, href) {
      let node = document.getElementById(id);
      if (!node) {
        node = document.createElement('link');
        node.id = id;
        node.rel = 'stylesheet';
        node.href = href;
        (document.head || document.documentElement).appendChild(node);
      }
      return node;
    }

    function createSkin(root) {
      function apply(strength) {
        const light = Math.min(0.95, Math.max(0.35, strength));
        const dark = Math.max(0.40, light - 0.12);
        const alpha = (value) => String(Number(value.toFixed(2)));
        root.style.setProperty('--ob-light', alpha(light));
        root.style.setProperty('--ob-light-hi', alpha(light + 0.02));
        root.style.setProperty('--ob-light-lo', alpha(Math.max(0.36, light - 0.04)));
        root.style.setProperty('--ob-dark', alpha(dark));
        root.style.setProperty('--ob-dark-hi', alpha(dark + 0.02));
        root.style.setProperty('--ob-dark-lo', alpha(Math.max(0.35, dark - 0.05)));
        ensureStylesheet(SHELL_STYLE_ID, `${BASE}/deck-shell.css`).disabled = false;
      }
      function remove() {
        const node = document.getElementById(SHELL_STYLE_ID);
        if (node) node.disabled = true;
        for (const name of SKIN_VARS) root.style.removeProperty(name);
      }
      return { apply, remove };
    }

    function createSettingsStore(contract) {
      const { normalizeSettings, SETTINGS_SCHEMA } = contract;
      let current = read();
      let timer = 0;
      const listeners = new Set();

      function read() {
        try {
          const raw = window.localStorage.getItem(STORE_KEY);
          if (raw) return normalizeSettings(JSON.parse(raw));
        } catch {}
        return normalizeSettings({});
      }

      function persist() {
        try {
          window.localStorage.setItem(STORE_KEY, JSON.stringify(current));
        } catch {}
      }

      function schedulePersist() {
        if (timer !== 0) return;
        timer = window.setTimeout(() => {
          timer = 0;
          persist();
        }, PERSIST_MS);
      }

      function set(patch) {
        const next = normalizeSettings({ ...current, ...patch });
        let changed = false;
        for (const key of Object.keys(SETTINGS_SCHEMA.fields)) {
          if (next[key] !== current[key]) {
            changed = true;
            break;
          }
        }
        current = next;
        if (!changed) return false;
        schedulePersist();
        for (const listener of listeners) listener(current, patch);
        return true;
      }

      return {
        get current() { return current; },
        set,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        flush() {
          if (timer !== 0) {
            window.clearTimeout(timer);
            timer = 0;
          }
          persist();
        },
      };
    }

    function createLocaleLoader(ctx, fallback) {
      let text = { ...fallback };
      let generation = 0;
      const listeners = new Set();
      const disposers = new Map();

      function activeTag() {
        const snapshot = typeof ctx.locale?.getSnapshot === 'function' ? ctx.locale.getSnapshot() : null;
        return snapshot?.active || document.documentElement.lang || navigator.language || 'en';
      }

      function emit() {
        for (const listener of listeners) listener(text);
      }

      function load() {
        const tag = String(activeTag());
        const mine = ++generation;
        fetch(`${BASE}/locale/${encodeURIComponent(tag)}.json`, { cache: 'no-store' })
          .then((response) => (response && response.ok ? response.json() : null))
          .then((payload) => {
            if (mine !== generation) return;
            const ui = payload && typeof payload.ui === 'object' ? payload.ui : null;
            if (!ui) return;
            text = { ...fallback, ...ui };
            const lang = typeof payload.lang === 'string' && payload.lang !== '' ? payload.lang : tag;
            if (typeof ctx.locale?.register === 'function' && !disposers.has(lang)) {
              try {
                disposers.set(lang, ctx.locale.register(UI_NS, lang, ui));
              } catch {}
            }
            emit();
          })
          .catch(() => {});
      }

      return {
        get text() { return text; },
        load,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        dispose() {
          for (const dispose of disposers.values()) {
            try { dispose?.(); } catch {}
          }
          disposers.clear();
          listeners.clear();
        },
      };
    }

    function createPanel({ contract, settings, getText }) {
      const { SETTINGS_SCHEMA } = contract;
      const { order, fields } = SETTINGS_SCHEMA;
      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.setAttribute('role', 'dialog');
      panel.hidden = true;

      const controls = new Map();
      const title = document.createElement('p');
      title.className = 'ob-title';
      title.dataset.obText = 'open';
      panel.appendChild(title);

      for (const key of order) {
        const spec = fields[key];
        const row = document.createElement('div');
        row.className = 'ob-row';
        const inputId = `ob-${key}`;
        const label = document.createElement('label');
        label.htmlFor = inputId;
        label.dataset.obText = spec.label;
        row.appendChild(label);

        let input;
        let output = null;
        if (spec.control === 'checkbox') {
          input = document.createElement('input');
          input.type = 'checkbox';
          input.id = inputId;
          row.appendChild(input);
        } else if (spec.control === 'select') {
          input = document.createElement('select');
          input.id = inputId;
          for (const value of spec.values) {
            const option = document.createElement('option');
            option.value = value;
            option.dataset.obOption = spec.optionLabels?.[value] ?? value;
            input.appendChild(option);
          }
          row.appendChild(input);
        } else {
          output = document.createElement('output');
          output.id = `${inputId}-out`;
          output.htmlFor = inputId;
          row.appendChild(output);
        }

        if (spec.control === 'percent') {
          const block = document.createElement('div');
          block.appendChild(row);
          input = document.createElement('input');
          input.type = 'range';
          input.id = inputId;
          input.min = String(Math.round(spec.min * 100));
          input.max = String(Math.round(spec.max * 100));
          input.step = String(Math.round(spec.step * 100));
          block.appendChild(input);
          panel.appendChild(block);
        } else {
          panel.appendChild(row);
          if (spec.control === 'range') {
            input = document.createElement('input');
            input.type = 'range';
            input.id = inputId;
            input.min = String(spec.min);
            input.max = String(spec.max);
            input.step = String(spec.step);
            panel.appendChild(input);
          }
        }

        input.addEventListener(spec.type === 'number' ? 'input' : 'change', () => {
          if (spec.type === 'boolean') {
            settings.set({ [key]: input.checked });
          } else if (spec.control === 'percent') {
            settings.set({ [key]: Number(input.value) / 100 });
          } else if (spec.type === 'number') {
            settings.set({ [key]: Number(input.value) });
          } else {
            settings.set({ [key]: input.value });
          }
        });
        controls.set(key, { spec, input, output });
      }

      const hint = document.createElement('p');
      hint.className = 'ob-note';
      hint.dataset.obText = 'cameraHint';
      panel.appendChild(hint);

      const note = document.createElement('p');
      note.className = 'ob-note';
      note.dataset.obText = 'recovering';
      note.hidden = true;
      panel.appendChild(note);

      function sync() {
        const current = settings.current;
        for (const [key, { spec, input, output }] of controls) {
          const value = current[key];
          if (spec.type === 'boolean') {
            input.checked = value;
          } else if (spec.control === 'percent') {
            const percent = Math.round(value * 100);
            if (input.value !== String(percent)) input.value = String(percent);
            output.textContent = `${percent}%`;
          } else if (spec.type === 'number') {
            if (input.value !== String(value)) input.value = String(value);
            output.textContent = `${value.toFixed(spec.decimals)}${spec.unit ?? ''}`;
          } else {
            input.value = value;
          }
        }
      }

      function refreshText() {
        const text = getText();
        panel.setAttribute('aria-label', text.open);
        for (const node of panel.querySelectorAll('[data-ob-text]')) {
          const key = node.dataset.obText;
          if (key && typeof text[key] === 'string') node.textContent = text[key];
        }
        for (const option of panel.querySelectorAll('[data-ob-option]')) {
          const key = option.dataset.obOption;
          if (key && typeof text[key] === 'string') option.textContent = text[key];
        }
      }

      return {
        element: panel,
        sync,
        refreshText,
        setNoteVisible(visible) { note.hidden = !visible; },
      };
    }

    function createMileageLabel() {
      const label = document.createElement('div');
      label.id = MILEAGE_ID;
      label.setAttribute('role', 'status');
      label.setAttribute('aria-live', 'polite');
      label.hidden = true;
      let last = null;
      return {
        element: label,
        set(data) {
          if (!data || data.ok !== true) return;
          last = data;
        },
        render(text, visible) {
          if (!last) {
            label.hidden = true;
            return;
          }
          const fleet = last.mode === 'fleet';
          const meters = fleet ? last.fleetMeters : last.todayMeters;
          if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) {
            label.hidden = true;
            return;
          }
          const value = displayNauticalMiles(meters);
          const next = `${fleet ? text.mileageFleet : text.mileageToday} ${value} ${text.mileageUnit}`;
          if (label.textContent !== next) label.textContent = next;
          label.hidden = !(visible && next !== '');
        },
        clear() {
          last = null;
          label.textContent = '';
          label.hidden = true;
        },
        hide() {
          label.hidden = true;
        },
        hasData() {
          return last !== null;
        },
      };
    }

    function createFrameHost({ contract, onReady, onError, onLoad = () => {} }) {
      let element = null;
      let ready = false;
      let deadline = 0;

      function post(payload) {
        try {
          element?.contentWindow?.postMessage(payload, location.origin);
        } catch {}
      }

      function clearDeadline() {
        if (deadline !== 0) window.clearTimeout(deadline);
        deadline = 0;
      }

      function arm() {
        if (!element || ready || document.hidden || deadline !== 0) return;
        const pending = element;
        deadline = window.setTimeout(() => {
          deadline = 0;
          if (element !== pending || ready) return;
          unmount();
          onError('timeout');
        }, READY_TIMEOUT);
      }

      function mount() {
        if (element || document.hidden) return;
        ready = false;
        element = document.createElement('iframe');
        element.id = FRAME_ID;
        element.setAttribute('aria-hidden', 'true');
        element.setAttribute('tabindex', '-1');
        element.title = 'Ocean background';
        element.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:0;pointer-events:none;background:transparent;';
        element.addEventListener('load', () => {
          onLoad();
          arm();
        });
        element.src = `${BASE}/?debug=0`;
        const host = document.body || document.documentElement;
        host.insertBefore(element, host.firstChild);
        arm();
      }

      function unmount() {
        clearDeadline();
        element?.remove();
        element = null;
        ready = false;
      }

      function markReady() {
        ready = true;
        clearDeadline();
      }

      function setVisible(visible) {
        if (element) element.style.visibility = visible ? '' : 'hidden';
      }

      return {
        mount,
        unmount,
        post,
        arm,
        clearDeadline,
        markReady,
        setVisible,
        get element() { return element; },
        get source() { return element?.contentWindow ?? null; },
        get ready() { return ready; },
        get mounted() { return element !== null; },
      };
    }

    function createDeck(ctx, contract) {
      const { MESSAGE, SETTINGS_SCHEMA, readMessage, settingsMessage, snapshotMessage } = contract;
      const root = document.documentElement;
      const state = {
        disposed: false,
        revealed: false,
        selectedSessionId: null,
        lastSnapshot: null,
        pollTimer: 0,
        pollRequest: null,
        pollGeneration: 0,
      };

      ensureStylesheet(UI_STYLE_ID, `${BASE}/deck-ui.css`);
      for (const id of [DOCK_ID, BUTTON_ID, PANEL_ID, MILEAGE_ID]) {
        document.getElementById(id)?.remove();
      }

      const settings = createSettingsStore(contract);
      const locale = createLocaleLoader(ctx, FALLBACK_TEXT);
      const skin = createSkin(root);
      const mileage = createMileageLabel();
      const text = () => locale.text;

      let frame = null;
      let panel = null;

      const button = document.createElement('button');
      button.id = BUTTON_ID;
      button.type = 'button';
      button.setAttribute('aria-controls', PANEL_ID);
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">'
        + '<path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>'
        + '<path d="M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>'
        + '<path d="M12 4v5"/><path d="M9.5 6.5 12 4l2.5 2.5"/></svg>';

      const dock = document.createElement('div');
      dock.id = DOCK_ID;

      panel = createPanel({ contract, settings, getText: text });
      frame = createFrameHost({
        contract,
        onLoad: () => postSettings(),
        onReady: () => {
          state.revealed = true;
          applySkin();
          renderMileage();
        },
        onError: (stage) => {
          if (stage === 'timeout') console.warn('[ocean-background] renderer readiness timed out');
          state.revealed = false;
          skin.remove();
          mileage.hide();
          panel.setNoteVisible(true);
        },
      });

      function applySkin() {
        if (state.revealed && settings.current.enabled) skin.apply(settings.current.strength);
        else skin.remove();
      }

      function renderMileage() {
        const visible = state.revealed && settings.current.enabled && mileage.hasData();
        mileage.render(text(), visible);
      }

      function refreshText() {
        const copy = text();
        button.title = copy.open;
        button.setAttribute('aria-label', copy.open);
        panel.refreshText();
        renderMileage();
      }

      function postSettings() {
        if (!frame.mounted) return;
        frame.post(settingsMessage(settings.current, state.selectedSessionId));
      }

      function stopPoll() {
        if (state.pollTimer !== 0) window.clearTimeout(state.pollTimer);
        state.pollTimer = 0;
        state.pollGeneration += 1;
        try { state.pollRequest?.abort(); } catch {}
        state.pollRequest = null;
      }

      function schedulePoll() {
        if (state.disposed || document.hidden || !settings.current.enabled || state.pollTimer !== 0) return;
        state.pollTimer = window.setTimeout(() => {
          state.pollTimer = 0;
          poll();
        }, SNAPSHOT_MS);
      }

      function poll() {
        if (state.disposed || document.hidden || !settings.current.enabled) return;
        const mine = ++state.pollGeneration;
        const sessionId = state.selectedSessionId;
        const query = sessionId === null ? '' : `?sessionId=${encodeURIComponent(sessionId)}`;
        const controller = new AbortController();
        state.pollRequest = controller;
        let pending;
        try {
          pending = Promise.resolve(fetch(`${BASE}/snapshot${query}`, { cache: 'no-store', signal: controller.signal }));
        } catch {
          schedulePoll();
          return;
        }
        pending
          .then((response) => (response && response.ok ? response.json() : null))
          .then((data) => {
            if (state.disposed || mine !== state.pollGeneration) return;
            if (!data || data.ok === false) return;
            state.lastSnapshot = data;
            frame.post(snapshotMessage(data));
            mileage.set(data.mileage);
            renderMileage();
          })
          .catch(() => {})
          .finally(() => {
            if (state.pollRequest === controller) state.pollRequest = null;
            schedulePoll();
          });
      }

      function restartPoll() {
        stopPoll();
        poll();
      }

      function onFrameMessage(event) {
        if (state.disposed || event.origin !== location.origin || event.source !== frame.source) return;
        const payload = readMessage(event.data);
        if (!payload) return;
        if (payload.type === MESSAGE.ready) {
          frame.markReady();
          panel.setNoteVisible(false);
          state.revealed = true;
          applySkin();
          postSettings();
          if (state.lastSnapshot) frame.post(snapshotMessage(state.lastSnapshot));
          renderMileage();
          return;
        }
        if (payload.type === MESSAGE.error) {
          console.warn('[ocean-background] renderer error', payload.stage, payload.message);
          state.revealed = false;
          skin.remove();
          mileage.hide();
          panel.setNoteVisible(true);
        }
      }

      const sessions = ctx.sessions.list;
      function currentSessionId() {
        const selected = Object.values(sessions.getSnapshot().byId)
          .filter((session) => session.retainedBy?.mainView > 0);
        return selected.length === 1 ? selected[0].id : null;
      }

      let selectionQueued = false;
      const stopSelection = sessions.subscribe(() => {
        if (selectionQueued) return;
        selectionQueued = true;
        queueMicrotask(() => {
          selectionQueued = false;
          if (state.disposed) return;
          const next = currentSessionId();
          if (next === state.selectedSessionId) return;
          state.selectedSessionId = next;
          state.lastSnapshot = null;
          mileage.clear();
          postSettings();
          restartPoll();
        });
      });

      let wasEnabled = settings.current.enabled;
      const onSettingsChange = () => {
        applySkin();
        panel.sync();
        button.dataset.on = String(settings.current.enabled);
        frame.setVisible(settings.current.enabled);
        if (settings.current.enabled) {
          if (!wasEnabled) restartPoll();
          if (!frame.mounted) {
            frame.mount();
            frame.arm();
          }
          renderMileage();
        } else {
          stopPoll();
          mileage.hide();
        }
        wasEnabled = settings.current.enabled;
        postSettings();
      };
      const stopSettings = settings.subscribe(onSettingsChange);

      const onLocaleChange = () => {
        locale.load();
        refreshText();
      };
      const stopLocale = typeof ctx.locale?.subscribe === 'function'
        ? ctx.locale.subscribe(onLocaleChange)
        : null;
      const stopLocaleText = locale.subscribe(refreshText);

      const onButtonClick = () => {
        panel.element.hidden = !panel.element.hidden;
        button.setAttribute('aria-expanded', String(!panel.element.hidden));
      };
      const closePanel = () => {
        if (panel.element.hidden) return;
        panel.element.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      };
      const onKeyDown = (event) => {
        if (event.key !== 'Escape' || panel.element.hidden) return;
        closePanel();
        button.focus();
      };
      const onPointerDown = (event) => {
        if (panel.element.hidden) return;
        const target = event.target;
        if (target instanceof Node && (panel.element.contains(target) || button.contains(target))) return;
        closePanel();
      };

      const onVisibility = () => {
        if (document.hidden) {
          frame.clearDeadline();
          stopPoll();
        } else {
          frame.mount();
          frame.arm();
          restartPoll();
        }
      };

      function startPolling() {
        poll();
      }

      button.addEventListener('click', onButtonClick);
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('pointerdown', onPointerDown);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('message', onFrameMessage);

      dock.appendChild(mileage.element);
      dock.appendChild(button);
      const host = document.body || document.documentElement;
      host.appendChild(dock);
      host.appendChild(panel.element);

      state.selectedSessionId = currentSessionId();
      locale.load();
      panel.refreshText();
      panel.sync();
      button.title = text().open;
      button.setAttribute('aria-label', text().open);
      button.dataset.on = String(settings.current.enabled);
      frame.mount();
      frame.setVisible(settings.current.enabled);
      applySkin();
      startPolling();

      return function teardown() {
        state.disposed = true;
        stopSettings();
        stopLocale?.();
        stopLocaleText();
        stopSelection();
        stopPoll();
        window.removeEventListener('message', onFrameMessage);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('pointerdown', onPointerDown);
        document.removeEventListener('visibilitychange', onVisibility);
        button.removeEventListener('click', onButtonClick);
        settings.flush();
        locale.dispose();
        frame.unmount();
        skin.remove();
        button.remove();
        panel.element.remove();
        mileage.element.remove();
        dock.remove();
        document.getElementById(UI_STYLE_ID)?.remove();
        document.getElementById(SHELL_STYLE_ID)?.remove();
      };
    }

    function loadContract() {
      return import(`${BASE}/protocol.js`);
    }

    return {
      inject: ['sessions', 'locale'],
      apply(ctx) {
        return ctx.effect(() => {
          let disposed = false;
          let teardown = null;
          try {
            if (window.localStorage.getItem(KILL_KEY) === '1') return undefined;
            if (new URLSearchParams(location.search).get('ocean') === 'off') return undefined;
          } catch {}

          loadContract()
            .then((contract) => {
              if (disposed) return;
              teardown = createDeck(ctx, contract);
            })
            .catch((error) => {
              console.warn('[ocean-background] contract unavailable', error);
            });

          return () => {
            disposed = true;
            try { teardown?.(); } catch {}
            teardown = null;
          };
        }, 'ocean-background: mount');
      },
    };
  },
});
