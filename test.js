// script.js
// Blackhole Pomodoro — full feature script with ultra-minimal PiP (only timer + red indicator)
(function () {
  /* ===========
     DOM refs
     =========== */
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
  const workInput = document.getElementById('workInput');
  const shortInput = document.getElementById('shortInput');
  const longInput = document.getElementById('longInput');
  const sessionsBeforeLongInput = document.getElementById('sessionsBeforeLong');
  const autoStartInput = document.getElementById('autoStart');
  const autoContinueBreakInput = document.getElementById('autoContinueBreak');
  const keepZeroModal = document.getElementById('keepZeroModal');
  const saveSettings = document.getElementById('saveSettings');
  const cancelSettings = document.getElementById('cancelSettings');
  const soundNone = document.getElementById('soundNone');
  const soundDefault = document.getElementById('soundDefault');
  const soundVoice = document.getElementById('soundVoice');

  // phase overlay
  const phaseOverlay = document.getElementById('phaseOverlay');
  const phaseLabelEl = document.getElementById('phaseLabel');

  // floating-related DOM
  const floatingBtn = document.getElementById('floatingBtn');
  const pipCanvas = document.getElementById('pipCanvas');
  const pipVideo = document.getElementById('pipVideo');
  const inpageFloating = document.getElementById('inpageFloating');
  const floatModeEl = document.getElementById('floatMode');
  const floatTimerEl = document.getElementById('floatTimer');
  const floatStartBtn = document.getElementById('floatStart');
  const floatPauseBtn = document.getElementById('floatPause');
  const floatCloseBtn = document.getElementById('floatClose');
  const analyticsBtn = document.getElementById('analyticsBtn');

  /* ===========
     Defaults & state
     =========== */
  const DEFAULTS = {
    work: 25,
    short: 5,
    long: 15,
    leadingZero: true,
    autoStartNext: false,
    autoContinueAfterBreak: false,
    sessionsBeforeLong: 4,
    soundMode: 'default', // 'default' | 'voice' | 'none'
    running: false,
    remaining: null,
    endTime: null,
    currentMode: 'work'
  };

  const LS_KEY = 'bh_pomodoro_settings_v4';
  const HISTORY_KEY = 'bh_pomodoro_history';
  const TIMER_STATE_KEY = 'bh_pomodoro_timer_v4';

  // sound files mapping
  const SOUND_FILES = {
    'default': 'sounds/default-pomodoro.mp3',
    'voice-focus-begin': 'sounds/voice-focus-begin.mp3',
    'voice-focus-ended': 'sounds/voice-focus-ended.mp3',
    'voice-long-break-begin': 'sounds/voice-long-break-begin.mp3',
    'voice-long-break-ended': 'sounds/voice-long-break-ended.mp3',
    'voice-short-break-begin': 'sounds/voice-short-break-begin.mp3',
    'voice-short-break-ended': 'sounds/voice-short-break-ended.mp3'
  };

  // preloaded audio objects
  const audioPool = {};
  for (const [k, p] of Object.entries(SOUND_FILES)) {
    try {
      const a = new Audio(p);
      a.preload = 'auto';
      audioPool[k] = a;
    } catch (e) {
      audioPool[k] = null;
    }
  }

  // PiP size constants
  const PIP_CSS_W = 96;
  const PIP_CSS_H = 43;

  // runtime state
  let settings = loadSettings();
  settings.work = Number(settings.work);
  settings.short = Number(settings.short);
  settings.long = Number(settings.long);

  let totalSeconds = Math.max(0, Number(settings.work)) * 60;
  let remaining = totalSeconds;
  let ticker = null;
  let running = false;
  let lastRendered = '';
  let focusCount = Number(settings._focusCount) || 0;
  let currentPhase = 'work';

  let endTime = null;
  let sessionStartMs = null;
  let lastStartWasAuto = false;

  applySettings(settings);
  loadTimerState(); // NEW: load timer from previous page if exists

  /* ===========
     Storage + Settings
     =========== */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return {
        work: parsed.work !== undefined ? Number(parsed.work) : DEFAULTS.work,
        short: parsed.short !== undefined ? Number(parsed.short) : DEFAULTS.short,
        long: parsed.long !== undefined ? Number(parsed.long) : DEFAULTS.long,
        leadingZero: parsed.leadingZero === false ? false : DEFAULTS.leadingZero,
        autoStartNext: parsed.autoStartNext === true,
        autoContinueAfterBreak: parsed.autoContinueAfterBreak === true,
        sessionsBeforeLong: parsed.sessionsBeforeLong !== undefined ? Number(parsed.sessionsBeforeLong) : DEFAULTS.sessionsBeforeLong,
        soundMode: parsed.soundMode || DEFAULTS.soundMode,
        _focusCount: parsed._focusCount !== undefined ? Number(parsed._focusCount) : 0
      };
    } catch (e) {
      return { ...DEFAULTS };
    }
  }

  function saveSettingsToStorage(s) {
    const stash = { ...s, _focusCount: focusCount };
    localStorage.setItem(LS_KEY, JSON.stringify(stash));
  }

  function applySettings(s) {
    const btnWork = document.getElementById('mode-work');
    const btnShort = document.getElementById('mode-break');
    const btnLong = document.getElementById('mode-long');

    if (btnWork) btnWork.dataset.min = String(s.work);
    if (btnShort) btnShort.dataset.min = String(s.short);
    if (btnLong) btnLong.dataset.min = String(s.long);

    if (keepZeroCheckbox) keepZeroCheckbox.checked = !!s.leadingZero;
    if (soundNone) soundNone.checked = s.soundMode === 'none';
    if (soundDefault) soundDefault.checked = s.soundMode === 'default';
    if (soundVoice) soundVoice.checked = s.soundMode === 'voice';

    const active = modes.find(m => m.classList.contains('active'));
    const selectedMinutes = active ? parseFloat(active.dataset.min) : Number(s.work);
    totalSeconds = Math.max(0, Number(selectedMinutes)) * 60;
    remaining = totalSeconds;

    if (Number.isFinite(s._focusCount)) focusCount = Number(s._focusCount) || 0;
    settings = { ...s };
    saveSettingsToStorage(settings);

    initialRender();
  }

  /* ===========
     Timer state persistence
     =========== */
  function saveTimerState() {
    const state = {
      remaining,
      running,
      endTime,
      currentPhase,
      focusCount,
      lastStartWasAuto,
      totalSeconds
    };
    localStorage.setItem(TIMER_STATE_KEY, JSON.stringify(state));
  }

  function loadTimerState() {
    try {
      const raw = localStorage.getItem(TIMER_STATE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s) {
        remaining = s.remaining ?? totalSeconds;
        running = s.running ?? false;
        endTime = s.endTime ?? null;
        currentPhase = s.currentPhase ?? 'work';
        focusCount = s.focusCount ?? 0;
        lastStartWasAuto = s.lastStartWasAuto ?? false;
        totalSeconds = s.totalSeconds ?? totalSeconds;

        // Restore mode highlight
        const modeId = currentPhase === 'work' ? 'mode-work' : currentPhase === 'short' ? 'mode-break' : 'mode-long';
        setMode(totalSeconds / 60, modeId);

        if (running && endTime) startTimer(false, false); // auto-resume timer
      }
    } catch (e) { /* ignore */ }
  }

  /* ===========
     Sound helpers
     =========== */
  function safePlay(audioEl) {
    try {
      const clone = audioEl.cloneNode();
      clone.preload = 'auto';
      const p = clone.play();
      if (p && p.catch) p.catch(() => { /* ignore autoplay rejection */ });
    } catch (e) { /* ignore */ }
  }

  function playSoundForEvent(eventKey) {
    if (!settings || settings.soundMode === 'none') return;
    if (settings.soundMode === 'default') {
      const a = audioPool['default'];
      if (a) safePlay(a);
      return;
    }
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
      if (a) safePlay(a);
    }
  }

  /* ===========
     Display rendering
     =========== */
  function fmt(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const mm = (keepZeroCheckbox && keepZeroCheckbox.checked) ? String(m).padStart(2, '0') : String(m);
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
    if (!timerEl) return;
    timerEl.innerHTML = '';
    const s = fmt(remaining);
    timerEl.appendChild(buildDigits(s));
    lastRendered = s;
  }

  function nextNumericIndex(digitEls, i) {
    for (let j = i + 1; j < digitEls.length; j++) {
      if (digitEls[j].classList.contains('digit')) return j;
    }
    return -1;
  }

  function updateDisplay() {
    if (!timerEl) return;
    const s = fmt(remaining);
    if (!lastRendered) { initialRender(); return; }

    if (s.length !== lastRendered.length) {
      timerEl.innerHTML = '';
      timerEl.appendChild(buildDigits(s));
      lastRendered = s;
      updateFloatingUI();
      return;
    }

    const digitEls = timerEl.querySelectorAll('.digit, .colon');
    if (digitEls.length !== s.length) {
      timerEl.innerHTML = '';
      timerEl.appendChild(buildDigits(s));
      lastRendered = s;
      updateFloatingUI();
      return;
    }

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const el = digitEls[i];
      if (el.textContent !== ch) {
        el.textContent = ch;
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
    updateFloatingUI();
  }

  /* ===========
     Timer core
     =========== */
  function startTimer(suppressBeginSound = false, isAuto = false) {
    if (running) return;
    running = true;
    currentPhase = currentMode();
    if (startBtn) startBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = false;
    if (resetBtn) resetBtn.disabled = false;

    sessionStartMs = Date.now();
    lastStartWasAuto = !!isAuto;

    if (!suppressBeginSound && settings.soundMode !== 'none') {
      const mode = currentMode();
      if (mode === 'work') playSoundForEvent('focus-begin');
      else if (mode === 'short') playSoundForEvent('short-begin');
      else if (mode === 'long') playSoundForEvent('long-begin');
    }

    endTime = Date.now() + remaining * 1000;
    ticker = setInterval(() => {
      const now = Date.now();
      remaining = Math.max(0, Math.round((endTime - now) / 1000));
      updateDisplay();
      saveTimerState(); // persist state every tick
      if (remaining <= 0) {
        stopTicker();
        performPhaseTransitionThenNext();
      }
    }, 180);
    saveTimerState();
  }

  function stopTicker() {
    running = false;
    if (startBtn) startBtn.disabled = false;
    if (pauseBtn) pauseBtn.disabled = true;
    if (ticker) { clearInterval(ticker); ticker = null; }
    saveTimerState();
  }

  function pauseTimer() { if (!running) return; stopTicker(); saveTimerState(); }
  function resetTimer() { stopTicker(); remaining = totalSeconds; updateDisplay(); focusCount = 0; saveTimerState(); }

  function currentMode() {
    const active = modes.find(m => m.classList.contains('active'));
    if (!active) return 'work';
    if (active.id === 'mode-work') return 'work';
    if (active.id === 'mode-break') return 'short';
    if (active.id === 'mode-long') return 'long';
    return 'work';
  }

  function setMode(minutes, elmOrId) {
    modes.forEach(m => m.classList.remove('active'));
    if (typeof elmOrId === 'string') {
      const el = document.getElementById(elmOrId);
      if (el) el.classList.add('active');
    } else if (elmOrId instanceof Element) {
      elmOrId.classList.add('active');
    }
    const active = modes.find(m => m.classList.contains('active'));
    const mins = active ? parseFloat(active.dataset.min) : Number(minutes);
    totalSeconds = Math.max(0, Number(mins)) * 60;
    remaining = totalSeconds;
    currentPhase = currentMode();
    initialRender();
    saveTimerState();
  }

  /* ===========
     Phase transition animation + sound + next logic
     =========== */
  function performPhaseTransitionThenNext() {
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

    recordCompletedSession(prevMode);

    const prevWasBreak = (prevMode === 'short' || prevMode === 'long');
    const nextWillAutoStart = settings.autoStartNext || (settings.autoContinueAfterBreak && prevWasBreak);

    if (settings.soundMode !== 'none') {
      if (nextWillAutoStart) {
        const nextLabelKey = (nextModeId === 'mode-work') ? 'focus-begin' : (nextModeId === 'mode-break' ? 'short-begin' : 'long-begin');
        playSoundForEvent(nextLabelKey);
      } else {
        const endedKey = (prevMode === 'work') ? 'focus-ended' : (prevMode === 'short' ? 'short-ended' : 'long-ended');
        playSoundForEvent(endedKey);
      }
    }

    const animLabel = (nextModeId === 'mode-work') ? 'FOCUS' : 'BREAK';
    playPhaseAnimation(animLabel).then(() => {
      const nextBtn = document.getElementById(nextModeId);
      if (nextBtn) setMode(Number(nextBtn.dataset.min), nextBtn);
      saveSettingsToStorage(settings);
      saveTimerState();

      if (nextWillAutoStart) {
        startTimer(true, true);
      } else {
        if (startBtn) startBtn.disabled = false;
        if (pauseBtn) pauseBtn.disabled = true;
      }
    });
  }

  function playPhaseAnimation(label) {
    return new Promise((resolve) => {
      const DURATION = 1200;
      if (phaseLabelEl) phaseLabelEl.textContent = label;
      if (phaseOverlay) {
        phaseOverlay.classList.remove('hidden');
        phaseOverlay.classList.add('playing');
        phaseOverlay.setAttribute('aria-hidden', 'false');
        void phaseOverlay.offsetWidth;
        setTimeout(() => {
          phaseOverlay.classList.remove('playing');
          phaseOverlay.classList.add('hidden');
          phaseOverlay.setAttribute('aria-hidden', 'true');
          setTimeout(resolve, 80);
        }, DURATION);
      } else {
        resolve();
      }
    });
  }

  /* ===========
     Wiring & UI actions
     =========== */
  function wire() {
    initialRender();
    if (startBtn) startBtn.addEventListener('click', () => startTimer(false, false));
    if (pauseBtn) pauseBtn.addEventListener('click', pauseTimer);
    if (resetBtn) resetBtn.addEventListener('click', resetTimer);

    modes.forEach(mode => mode.addEventListener('click', () => {
      const minVal = parseFloat(mode.dataset.min);
      const min = Number.isFinite(minVal) ? minVal : DEFAULTS.work;
      setMode(min, mode);
    }));

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); running ? pauseTimer() : startTimer(false, false); }
      else if (e.key.toLowerCase() === 'r') { resetTimer(); focusCount = 0; }
    });

    let resizeTO;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTO);
      resizeTO = setTimeout(() => {
        if (!timerEl) return;
        timerEl.innerHTML = '';
        timerEl.appendChild(buildDigits(fmt(remaining)));
      }, 150);
    });

    if (analyticsBtn) analyticsBtn.addEventListener('click', () => { saveTimerState(); window.location.href = 'analytics.html'; });
  }

  wire();

})();
