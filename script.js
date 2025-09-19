// Blackhole Pomodoro — with sound selection (none / default / voice)
// Sounds expected in "sounds/" folder with these names (no extension here):
// "default-pomodoro",
// "voice-focus-begin", "voice-focus-ended",
// "voice-long-break-begin", "voice-long-break-ended",
// "voice-short-break-begin", "voice-short-break-ended"

(() => {
  // DOM
  const timerEl = document.getElementById('timer');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const modes = Array.from(document.querySelectorAll('.mode'));
  const keepZeroCheckbox = document.getElementById('keepZero');

  // settings UI
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const closeSettings = document.getElementById('closeSettings');
  const settingsForm = document.getElementById('settingsForm');
  const workInput = document.getElementById('workInput');
  const shortInput = document.getElementById('shortInput');
  const longInput = document.getElementById('longInput');
  const sessionsBeforeLongInput = document.getElementById('sessionsBeforeLong');
  const autoStartInput = document.getElementById('autoStart');
  const autoContinueBreakInput = document.getElementById('autoContinueBreak');
  const keepZeroModal = document.getElementById('keepZeroModal');
  const saveSettings = document.getElementById('saveSettings');
  const cancelSettings = document.getElementById('cancelSettings');
  // sound radios
  const soundNone = document.getElementById('soundNone');
  const soundDefault = document.getElementById('soundDefault');
  const soundVoice = document.getElementById('soundVoice');

  // phase overlay
  const phaseOverlay = document.getElementById('phaseOverlay');
  const phaseLabelEl = document.getElementById('phaseLabel');

  // defaults and state
  const DEFAULTS = {
    work: 25,
    short: 5,
    long: 15,
    leadingZero: true,
    autoStartNext: false,
    autoContinueAfterBreak: false,
    sessionsBeforeLong: 4,
    // soundMode: "default" | "voice" | "none"
    soundMode: 'default'
  };

  const LS_KEY = 'bh_pomodoro_settings_v3';

  // sound mapping and preloaded Audio objects
  const SOUND_FILES = {
    'default': 'sounds/default-pomodoro.mp3',
    'voice-focus-begin': 'sounds/voice-focus-begin.mp3',
    'voice-focus-ended': 'sounds/voice-focus-ended.mp3',
    'voice-long-break-begin': 'sounds/voice-long-break-begin.mp3',
    'voice-long-break-ended': 'sounds/voice-long-break-ended.mp3',
    'voice-short-break-begin': 'sounds/voice-short-break-begin.mp3',
    'voice-short-break-ended': 'sounds/voice-short-break-ended.mp3'
  };

  // Preload audio objects (but do not autoplay). Keep them in audioPool.
  const audioPool = {};
  for (const [key, path] of Object.entries(SOUND_FILES)) {
    try {
      const a = new Audio(path);
      a.preload = 'auto';
      audioPool[key] = a;
    } catch (e) {
      audioPool[key] = null;
    }
  }

  // load settings and state
  let settings = loadSettings();
  let totalSeconds = settings.work * 60;
  let remaining = totalSeconds;
  let ticker = null;
  let running = false;
  let lastRendered = '';
  let focusCount = settings._focusCount || 0; // restore if present

  applySettings(settings);

  // ---- storage helpers ----
  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return {
        work: Number(parsed.work) || DEFAULTS.work,
        short: Number(parsed.short) || DEFAULTS.short,
        long: Number(parsed.long) || DEFAULTS.long,
        leadingZero: parsed.leadingZero === false ? false : true,
        autoStartNext: !!parsed.autoStartNext,
        autoContinueAfterBreak: !!parsed.autoContinueAfterBreak,
        sessionsBeforeLong: Number(parsed.sessionsBeforeLong) || DEFAULTS.sessionsBeforeLong,
        soundMode: parsed.soundMode || DEFAULTS.soundMode,
        _focusCount: Number(parsed._focusCount) || 0
      };
    } catch (e) {
      return { ...DEFAULTS };
    }
  }

  function saveSettingsToStorage(s) {
    // store focusCount as well
    const stash = { ...s, _focusCount: focusCount };
    localStorage.setItem(LS_KEY, JSON.stringify(stash));
  }

  // ---- apply settings to UI and state ----
  function applySettings(s) {
    // update mode buttons data-min
    const btnWork = document.getElementById('mode-work');
    const btnShort = document.getElementById('mode-break');
    const btnLong = document.getElementById('mode-long');

    btnWork.dataset.min = String(s.work);
    btnShort.dataset.min = String(s.short);
    btnLong.dataset.min = String(s.long);

    // leading zero top checkbox
    keepZeroCheckbox.checked = !!s.leadingZero;

    // sound radio reflect
    if (soundNone) soundNone.checked = s.soundMode === 'none';
    if (soundDefault) soundDefault.checked = s.soundMode === 'default';
    if (soundVoice) soundVoice.checked = s.soundMode === 'voice';

    // ensure totalSeconds updated according to current active mode
    const active = modes.find(m => m.classList.contains('active'));
    const selectedMinutes = active ? Number(active.dataset.min) : s.work;
    totalSeconds = Math.max(1, Number(selectedMinutes)) * 60;
    remaining = totalSeconds;

    // restore focusCount if present
    if (Number.isFinite(s._focusCount)) focusCount = Number(s._focusCount) || 0;

    // persist current settings object
    settings = { ...s };
    saveSettingsToStorage(settings);

    // re-render
    initialRender();
  }

  // ---- sound helper ----
  // eventKey: 'focus-begin'|'focus-ended'|'short-begin'|'short-ended'|'long-begin'|'long-ended'
  function playSoundForEvent(eventKey) {
    if (!settings || settings.soundMode === 'none') return;
    // default sound uses one file for all events
    if (settings.soundMode === 'default') {
      const a = audioPool['default'];
      if (a) { safePlay(a); }
      return;
    }
    // voice mode: map eventKey to file id
    if (settings.soundMode === 'voice') {
      const map = {
        'focus-begin': 'voice-focus-begin',
        'focus-ended': 'voice-focus-ended',
        'short-begin': 'voice-short-break-begin',
        'short-ended': 'voice-short-break-ended',
        'long-begin': 'voice-long-break-begin',
        'long-ended': 'voice-long-break-ended'
      };
      const key = map[eventKey];
      if (!key) return;
      const a = audioPool[key];
      if (a) { safePlay(a); }
    }
  }

  // Play an Audio element safely (handle promise rejection)
  function safePlay(audioEl) {
    try {
      // clone node to allow overlapping plays for same sound in quick succession
      const clone = audioEl.cloneNode();
      clone.preload = 'auto';
      const p = clone.play();
      if (p && p.catch) p.catch(() => { /* ignore play rejection (autoplay policy) */ });
    } catch (e) {
      // ignore
    }
  }

  // ---- display ----
  function fmt(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const mm = keepZeroCheckbox.checked ? String(m).padStart(2, '0') : String(m);
    const ss = String(s).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function buildDigits(str) {
    const frag = document.createDocumentFragment();
    const wrapper = document.createElement('div');
    wrapper.className = 'digits';
    for (let ch of str) {
      if (ch === ':') {
        const col = document.createElement('span');
        col.className = 'colon';
        col.textContent = ':';
        wrapper.appendChild(col);
      } else {
        const d = document.createElement('span');
        d.className = 'digit';
        d.textContent = ch;
        wrapper.appendChild(d);
      }
    }
    frag.appendChild(wrapper);
    return frag;
  }

  function initialRender() {
    timerEl.innerHTML = '';
    const s = fmt(remaining);
    timerEl.appendChild(buildDigits(s));
    lastRendered = s;
  }

  // find next numeric index (skip colons)
  function nextNumericIndex(digitEls, i) {
    for (let j = i + 1; j < digitEls.length; j++) {
      if (digitEls[j].classList.contains('digit')) return j;
    }
    return -1;
  }

  // update display with stretch and pull-up
  function updateDisplay() {
    const s = fmt(remaining);
    if (!lastRendered) { initialRender(); return; }

    if (s.length !== lastRendered.length) {
      timerEl.innerHTML = '';
      timerEl.appendChild(buildDigits(s));
      lastRendered = s;
      return;
    }

    const digitEls = timerEl.querySelectorAll('.digit, .colon');
    if (digitEls.length !== s.length) {
      timerEl.innerHTML = '';
      timerEl.appendChild(buildDigits(s));
      lastRendered = s;
      return;
    }

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const el = digitEls[i];
      if (el.textContent !== ch) {
        el.textContent = ch;
        // trigger animation
        el.classList.remove('stretch');
        void el.offsetWidth;
        el.classList.add('stretch');

        const nxtIdx = nextNumericIndex(digitEls, i);
        if (nxtIdx !== -1) {
          const nextEl = digitEls[nxtIdx];
          nextEl.classList.remove('pull-up');
          void nextEl.offsetWidth;
          nextEl.classList.add('pull-up');
          setTimeout(() => nextEl.classList.remove('pull-up'), 800);
        }
        setTimeout(() => el.classList.remove('stretch'), 800);
      }
    }
    lastRendered = s;
  }

  // ---- timer logic ----
  let endTime = null;

  // startTimer: accepts suppressBeginSound (default false)
  function startTimer(suppressBeginSound = false) {
    if (running) return;
    running = true;
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    resetBtn.disabled = false;

    // Play begin sound only if not suppressed
    if (!suppressBeginSound) {
      const mode = currentMode(); // 'work'|'short'|'long'
      if (settings.soundMode !== 'none') {
        if (mode === 'work') playSoundForEvent('focus-begin');
        else if (mode === 'short') playSoundForEvent('short-begin');
        else if (mode === 'long') playSoundForEvent('long-begin');
      }
    }

    endTime = Date.now() + remaining * 1000;
    ticker = setInterval(() => {
      const now = Date.now();
      remaining = Math.max(0, Math.round((endTime - now) / 1000));
      updateDisplay();
      if (remaining <= 0) {
        stopTicker();
        performPhaseTransitionThenNext();
      }
    }, 180);
  }

  function stopTicker() {
    running = false;
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    if (ticker) { clearInterval(ticker); ticker = null; }
  }

  function pauseTimer() { if (!running) return; stopTicker(); }
  function resetTimer() {
    stopTicker();
    remaining = totalSeconds;
    updateDisplay();
  }

  // determine current mode string ('work'|'short'|'long') from active button
  function currentMode() {
    const active = modes.find(m => m.classList.contains('active'));
    if (!active) return 'work';
    if (active.id === 'mode-work') return 'work';
    if (active.id === 'mode-break') return 'short';
    if (active.id === 'mode-long') return 'long';
    return 'work';
  }

  // set mode by minutes and element (or by id)
  function setMode(minutes, elmOrId) {
    modes.forEach(m => m.classList.remove('active'));
    if (typeof elmOrId === 'string') {
      const el = document.getElementById(elmOrId);
      if (el) el.classList.add('active');
    } else if (elmOrId instanceof Element) {
      elmOrId.classList.add('active');
    }

    const active = modes.find(m => m.classList.contains('active'));
    const mins = active ? Number(active.dataset.min) : Number(minutes);
    totalSeconds = Math.max(1, Number(mins)) * 60;
    remaining = totalSeconds;
    initialRender();
  }

  // ---- Phase transition animation + sound + next session handling ----
  function performPhaseTransitionThenNext() {
    // compute next mode first (but we'll apply it after animation)
    const prevMode = currentMode(); // 'work'|'short'|'long'
    let nextModeId = 'mode-work';
    if (prevMode === 'work') {
      focusCount += 1;
      if (focusCount % settings.sessionsBeforeLong === 0) nextModeId = 'mode-long';
      else nextModeId = 'mode-break';
    } else {
      nextModeId = 'mode-work';
      if (prevMode === 'long') focusCount = 0;
    }

    // decide whether next will auto-start (affects which sound to play)
    const prevWasBreak = (prevMode === 'short' || prevMode === 'long');
    const nextWillAutoStart = settings.autoStartNext || (settings.autoContinueAfterBreak && prevWasBreak);

    // decide which sound to play now:
    // if nextWillAutoStart -> play next-begin sound (before animation)
    // else -> play current ended sound
    if (settings.soundMode !== 'none') {
      if (nextWillAutoStart) {
        // pick next begin
        const nextLabelKey = (nextModeId === 'mode-work') ? 'focus-begin' : (nextModeId === 'mode-break' ? 'short-begin' : 'long-begin');
        playSoundForEvent(nextLabelKey);
      } else {
        // play ended sound for previous
        const endedKey = (prevMode === 'work') ? 'focus-ended' : (prevMode === 'short' ? 'short-ended' : 'long-ended');
        playSoundForEvent(endedKey);
      }
    }

    // label to show in animation: the next session label
    const animLabel = (nextModeId === 'mode-work') ? 'FOCUS' : 'BREAK';

    // play animation, then switch mode, then auto-start if settings demand
    playPhaseAnimation(animLabel).then(() => {
      // switch UI to next mode
      const nextBtn = document.getElementById(nextModeId);
      if (nextBtn) setMode(Number(nextBtn.dataset.min), nextBtn);

      // save settings+focusCount
      saveSettingsToStorage(settings);

      // decide whether we should auto-start the next session
      if (nextWillAutoStart) {
        // suppress begin sound here because it was already played above
        startTimer(true);
      } else {
        // remain stopped; ensure start/pause buttons correct
        startBtn.disabled = false;
        pauseBtn.disabled = true;
      }
    });
  }

  // Play the overlay animation and return a Promise that resolves when animation ends
  function playPhaseAnimation(label) {
    return new Promise((resolve) => {
      const DURATION = 1200; // match CSS animation duration (ms)

      // prepare overlay
      phaseLabelEl.textContent = label;
      phaseOverlay.classList.remove('hidden');
      phaseOverlay.classList.add('playing');
      phaseOverlay.setAttribute('aria-hidden', 'false');

      // make sure reflow so animations start reliably
      void phaseOverlay.offsetWidth;

      // after DURATION, hide overlay and resolve
      setTimeout(() => {
        phaseOverlay.classList.remove('playing');
        phaseOverlay.classList.add('hidden');
        phaseOverlay.setAttribute('aria-hidden', 'true');
        // small delay to ensure CSS cleared
        setTimeout(resolve, 80);
      }, DURATION);
    });
  }

  // ---- Settings popup logic ----
  function openSettings() {
    const s = loadSettings();
    // populate form
    workInput.value = s.work;
    shortInput.value = s.short;
    longInput.value = s.long;
    sessionsBeforeLongInput.value = s.sessionsBeforeLong || DEFAULTS.sessionsBeforeLong;
    autoStartInput.checked = !!s.autoStartNext;
    autoContinueBreakInput.checked = !!s.autoContinueAfterBreak;
    keepZeroModal.checked = !!s.leadingZero;

    // sound radios
    if (s.soundMode === 'none') soundNone.checked = true;
    else if (s.soundMode === 'voice') soundVoice.checked = true;
    else soundDefault.checked = true;

    settingsOverlay.classList.remove('hidden');
    settingsOverlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => workInput.focus(), 80);
  }

  function closeSettingsOverlay() {
    settingsOverlay.classList.add('hidden');
    settingsOverlay.setAttribute('aria-hidden', 'true');
    settingsBtn.focus();
  }

  // clicks
  settingsOverlay.addEventListener('click', (ev) => {
    if (ev.target === settingsOverlay) closeSettingsOverlay();
  });
  settingsBtn.addEventListener('click', openSettings);
  closeSettings.addEventListener('click', closeSettingsOverlay);
  cancelSettings.addEventListener('click', closeSettingsOverlay);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !settingsOverlay.classList.contains('hidden')) closeSettingsOverlay();
  });

  // save settings
  saveSettings.addEventListener('click', () => {
    const w = Number(workInput.value);
    const s = Number(shortInput.value);
    const l = Number(longInput.value);
    const sessionsBeforeLong = Number(sessionsBeforeLongInput.value) || DEFAULTS.sessionsBeforeLong;
    const autoStartNext = !!autoStartInput.checked;
    const autoContinueAfterBreak = !!autoContinueBreakInput.checked;
    const leading = !!keepZeroModal.checked;

    // sound mode from radios
    const chosenSoundMode = soundNone && soundNone.checked ? 'none' : (soundVoice && soundVoice.checked ? 'voice' : 'default');

    if (!Number.isFinite(w) || w < 1 || w > 999) return focusWarn(workInput);
    if (!Number.isFinite(s) || s < 1 || s > 999) return focusWarn(shortInput);
    if (!Number.isFinite(l) || l < 1 || l > 999) return focusWarn(longInput);
    if (!Number.isFinite(sessionsBeforeLong) || sessionsBeforeLong < 1 || sessionsBeforeLong > 99) return focusWarn(sessionsBeforeLongInput);

    const newSettings = {
      work: Math.floor(w),
      short: Math.floor(s),
      long: Math.floor(l),
      leadingZero: leading,
      autoStartNext: autoStartNext,
      autoContinueAfterBreak: autoContinueAfterBreak,
      sessionsBeforeLong: Math.floor(sessionsBeforeLong),
      soundMode: chosenSoundMode
    };

    // save and apply
    settings = { ...newSettings };
    saveSettingsToStorage(settings);
    applySettings(settings);
    // reset focusCount now that settings changed
    focusCount = 0;
    closeSettingsOverlay();
  });

  function focusWarn(el) {
    el.focus();
    el.animate([{ boxShadow: '0 0 0 6px rgba(155,89,255,0.06)' }, { boxShadow: 'none' }], { duration: 420 });
  }

  // mirror top checkbox to settings when changed
  keepZeroCheckbox.addEventListener('change', () => {
    if (keepZeroModal) keepZeroModal.checked = keepZeroCheckbox.checked;
    updateDisplay();
    settings.leadingZero = !!keepZeroCheckbox.checked;
    saveSettingsToStorage(settings);
  });

  keepZeroModal.addEventListener('change', () => {
    keepZeroCheckbox.checked = keepZeroModal.checked;
  });

  // ---- wire controls ----
  function wire() {
    initialRender();
    startBtn.addEventListener('click', () => startTimer(false)); // manual start should play begin sound
    pauseBtn.addEventListener('click', pauseTimer);
    resetBtn.addEventListener('click', () => { resetTimer(); focusCount = 0; });

    modes.forEach(mode => {
      mode.addEventListener('click', () => {
        const min = parseInt(mode.dataset.min, 10) || 25;
        setMode(min, mode);
      });
    });

    // keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); running ? pauseTimer() : startTimer(false); }
      else if (e.key.toLowerCase() === 'r') { resetTimer(); focusCount = 0; }
    });

    // responsive rebuild
    let resizeTO;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTO);
      resizeTO = setTimeout(() => {
        timerEl.innerHTML = '';
        timerEl.appendChild(buildDigits(fmt(remaining)));
      }, 150);
    });

    // restore persisted focus count (optional)
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (raw && Number.isFinite(raw._focusCount)) focusCount = Number(raw._focusCount);
    } catch (e) { /* ignore */ }
  }

  wire();
})();
