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
    soundMode: 'default' // 'default' | 'voice' | 'none'
  };

  const LS_KEY = 'bh_pomodoro_settings_v3';
  const HISTORY_KEY = 'bh_pomodoro_history';

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

  // PiP size constants (CSS pixels) — change these to resize PiP
  // 1 inch ≈ 96 CSS px. Pick values (e.g., 72×34 for very small).
  const PIP_CSS_W = 96; // CSS px width for PiP canvas (change this)
  const PIP_CSS_H = 43; // CSS px height for PiP canvas (change this)

  // runtime state
  let settings = loadSettings();
  // ensure numeric types for decimals/zero
  settings.work = Number(settings.work);
  settings.short = Number(settings.short);
  settings.long = Number(settings.long);

  let totalSeconds = Math.max(0, Number(settings.work)) * 60;
  let remaining = totalSeconds;
  let ticker = null;
  let running = false;
  let lastRendered = '';
  let focusCount = Number(settings._focusCount) || 0;

  // session logging helpers
  let sessionStartMs = null;
  let lastStartWasAuto = false;

  applySettings(settings);

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
    const stash = { ...s, _focus_count: focusCount, _focusCount: focusCount };
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

    if (Number.isFinite(s._focus_count)) focusCount = Number(s._focus_count) || 0;
    if (Number.isFinite(s._focusCount)) focusCount = Number(s._focusCount) || focusCount;

    settings = { ...s };
    saveSettingsToStorage(settings);

    initialRender();
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

        // pull next numeric digit up
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
  let endTime = null;

  function startTimer(suppressBeginSound = false, isAuto = false) {
    if (running) return;
    running = true;
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
      if (remaining <= 0) {
        stopTicker();
        performPhaseTransitionThenNext();
      }
    }, 180);
  }

  function stopTicker() {
    running = false;
    if (startBtn) startBtn.disabled = false;
    if (pauseBtn) pauseBtn.disabled = true;
    if (ticker) { clearInterval(ticker); ticker = null; }
  }

  function pauseTimer() { if (!running) return; stopTicker(); }
  function resetTimer() { stopTicker(); remaining = totalSeconds; updateDisplay(); }

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
    initialRender();
  }

  /* ===========
     Session record (analytics)
     =========== */
  function recordCompletedSession(prevMode) {
    const endMs = Date.now();
    const startMs = sessionStartMs || (endMs - (totalSeconds - remaining) * 1000);
    const durationSec = Math.max(0, Math.round((endMs - startMs) / 1000));

    const entry = {
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      mode: prevMode,
      start: startMs,
      end: endMs,
      durationSec,
      autoStarted: !!lastStartWasAuto,
      date: new Date(endMs).toISOString().slice(0, 10)
    };

    try {
      const raw = localStorage.getItem(HISTORY_KEY) || '[]';
      const arr = JSON.parse(raw);
      arr.push(entry);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
    } catch (e) { /* ignore */ }

    try {
      if (window.logSession && typeof window.logSession === 'function') {
        window.logSession(entry);
      }
    } catch (e) { /* ignore */ }

    sessionStartMs = null;
    lastStartWasAuto = false;
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

    // record completed session
    recordCompletedSession(prevMode);

    // determine auto-start rules
    const prevWasBreak = (prevMode === 'short' || prevMode === 'long');
    const nextWillAutoStart = settings.autoStartNext || (settings.autoContinueAfterBreak && prevWasBreak);

    // Decide which sound to play now:
    // - if nextWillAutoStart: play next's begin sound now (so we can suppress later when starting)
    // - else: play the current ended sound
    if (settings.soundMode !== 'none') {
      if (nextWillAutoStart) {
        const nextLabelKey = (nextModeId === 'mode-work') ? 'focus-begin' : (nextModeId === 'mode-break' ? 'short-begin' : 'long-begin');
        playSoundForEvent(nextLabelKey);
      } else {
        const endedKey = (prevMode === 'work') ? 'focus-ended' : (prevMode === 'short' ? 'short-ended' : 'long-ended');
        playSoundForEvent(endedKey);
      }
    }

    // animate label for next phase
    const animLabel = (nextModeId === 'mode-work') ? 'FOCUS' : 'BREAK';
    playPhaseAnimation(animLabel).then(() => {
      const nextBtn = document.getElementById(nextModeId);
      if (nextBtn) setMode(Number(nextBtn.dataset.min), nextBtn);

      // save settings + focus count
      saveSettingsToStorage(settings);

      // start next if auto
      if (nextWillAutoStart) {
        startTimer(true, true); // suppress begin sound because we already played it
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
     Settings popup handlers
     =========== */
  function openSettings() {
    const s = loadSettings();
    if (workInput) workInput.value = (s.work !== undefined && !Number.isNaN(Number(s.work))) ? Number(s.work) : s.work;
    if (shortInput) shortInput.value = (s.short !== undefined && !Number.isNaN(Number(s.short))) ? Number(s.short) : s.short;
    if (longInput) longInput.value = (s.long !== undefined && !Number.isNaN(Number(s.long))) ? Number(s.long) : s.long;
    if (sessionsBeforeLongInput) sessionsBeforeLongInput.value = s.sessionsBeforeLong !== undefined ? s.sessionsBeforeLong : DEFAULTS.sessionsBeforeLong;
    if (autoStartInput) autoStartInput.checked = !!s.autoStartNext;
    if (autoContinueBreakInput) autoContinueBreakInput.checked = !!s.autoContinueAfterBreak;
    if (keepZeroModal) keepZeroModal.checked = !!s.leadingZero;

    if (s.soundMode === 'none') soundNone.checked = true;
    else if (s.soundMode === 'voice') soundVoice.checked = true;
    else soundDefault.checked = true;

    if (settingsOverlay) {
      settingsOverlay.classList.remove('hidden');
      settingsOverlay.setAttribute('aria-hidden', 'false');
    }
    setTimeout(() => { if (workInput) workInput.focus(); }, 80);
  }

  function closeSettingsOverlay() {
    if (settingsOverlay) {
      settingsOverlay.classList.add('hidden');
      settingsOverlay.setAttribute('aria-hidden', 'true');
    }
    if (settingsBtn) settingsBtn.focus();
  }

  // validate minutes value: allow 0 and up to 2 decimals
  function validMinutesValue(v) {
    if (!Number.isFinite(v)) return false;
    if (v < 0 || v > 999) return false;
    const rounded = Math.round(v * 100);
    return Math.abs(rounded - v * 100) < 0.000001;
  }

  if (saveSettings) {
    saveSettings.addEventListener('click', () => {
      const w = workInput ? Number(workInput.value) : DEFAULTS.work;
      const s = shortInput ? Number(shortInput.value) : DEFAULTS.short;
      const l = longInput ? Number(longInput.value) : DEFAULTS.long;
      const sessionsBeforeLong = sessionsBeforeLongInput ? Number(sessionsBeforeLongInput.value) : DEFAULTS.sessionsBeforeLong;
      const autoStartNext = !!(autoStartInput && autoStartInput.checked);
      const autoContinueAfterBreak = !!(autoContinueBreakInput && autoContinueBreakInput.checked);
      const leading = !!(keepZeroModal && keepZeroModal.checked);
      const chosenSoundMode = soundNone && soundNone.checked ? 'none' : (soundVoice && soundVoice.checked ? 'voice' : 'default');

      if (!validMinutesValue(w)) { if (workInput) focusWarn(workInput); return; }
      if (!validMinutesValue(s)) { if (shortInput) focusWarn(shortInput); return; }
      if (!validMinutesValue(l)) { if (longInput) focusWarn(longInput); return; }
      if (!Number.isFinite(sessionsBeforeLong) || sessionsBeforeLong < 1 || sessionsBeforeLong > 99) { if (sessionsBeforeLongInput) focusWarn(sessionsBeforeLongInput); return; }

      const newSettings = {
        work: Number((Math.round(w * 100) / 100).toFixed(2)),
        short: Number((Math.round(s * 100) / 100).toFixed(2)),
        long: Number((Math.round(l * 100) / 100).toFixed(2)),
        leadingZero: leading,
        autoStartNext: autoStartNext,
        autoContinueAfterBreak: autoContinueAfterBreak,
        sessionsBeforeLong: Math.floor(sessionsBeforeLong),
        soundMode: chosenSoundMode
      };

      settings = { ...newSettings };
      saveSettingsToStorage(settings);
      applySettings(settings);
      focusCount = 0;
      closeSettingsOverlay();
    });
  }

  if (cancelSettings) cancelSettings.addEventListener('click', closeSettingsOverlay);
  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if (closeSettings) closeSettings.addEventListener('click', closeSettingsOverlay);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsOverlay && !settingsOverlay.classList.contains('hidden')) closeSettingsOverlay();
  });

  function focusWarn(el) {
    try {
      el.focus();
      el.animate([{ boxShadow: '0 0 0 6px rgba(155,89,255,0.06)' }, { boxShadow: 'none' }], { duration: 420 });
    } catch (e) { /* ignore */ }
  }

  // mirror top checkbox to modal
  if (keepZeroCheckbox) {
    keepZeroCheckbox.addEventListener('change', () => {
      if (keepZeroModal) keepZeroModal.checked = keepZeroCheckbox.checked;
      updateDisplay();
      settings.leadingZero = !!keepZeroCheckbox.checked;
      saveSettingsToStorage(settings);
    });
  }
  if (keepZeroModal) {
    keepZeroModal.addEventListener('change', () => {
      if (keepZeroCheckbox) keepZeroCheckbox.checked = keepZeroModal.checked;
    });
  }

  /* ===========
     Minimal PiP drawing: only time + red dot indicator
     =========== */

  function ensurePipCanvasPaintable() {
    if (!pipCanvas) return;
    pipCanvas.style.display = 'block';
    pipCanvas.style.position = 'fixed';
    pipCanvas.style.left = '-9999px';
    pipCanvas.style.top = '-9999px';
    pipCanvas.style.width = PIP_CSS_W + 'px';
    pipCanvas.style.height = PIP_CSS_H + 'px';
    pipCanvas.style.opacity = '0';
    pipCanvas.style.pointerEvents = 'none';
  }

  function drawPiPCanvasCompact() {
    if (!pipCanvas) return;
    try {
      ensurePipCanvasPaintable();
      const dpr = window.devicePixelRatio || 1;
      pipCanvas.width = Math.round(PIP_CSS_W * dpr);
      pipCanvas.height = Math.round(PIP_CSS_H * dpr);
      pipCanvas.style.width = PIP_CSS_W + 'px';
      pipCanvas.style.height = PIP_CSS_H + 'px';

      const ctx = pipCanvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pipCanvas.width, pipCanvas.height);
      ctx.scale(dpr, dpr); // draw in CSS px

      const W = PIP_CSS_W;
      const H = PIP_CSS_H;

      // Background: near-black solid (you can change to transparent if you prefer)
      ctx.fillStyle = 'rgba(5,5,7,0.98)';
      ctx.clearRect(0, 0, W, H);

      // Time: centered vertically and horizontally (we keep some right padding for the dot)
      // font size derived from height (adjust multiplier to taste)
      const timeFontSize = Math.max(10, Math.round(H * 0.45)); // tweak multiplier if you want larger/smaller
      ctx.font = `800 ${timeFontSize}px system-ui, Arial`;
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';

      const timeStr = fmt(remaining);
      const measure = ctx.measureText(timeStr);
      // leave small space on right for dot
      const rightPadding = Math.max(6, Math.round(H * 0.12));
      const totalWidthNeeded = measure.width + rightPadding + (running ? Math.max(4, Math.round(H * 0.12)) : 0);
      let timeX = (W - totalWidthNeeded) / 2;
      if (timeX < 6) timeX = 6;

      const timeY = H / 2;
      ctx.fillText(timeStr, timeX, timeY);

      // Red running indicator dot: small circle to right of time
      if (running) {
        const dotR = Math.max(2, Math.round(H * 0.08));
        const dotX = timeX + measure.width + rightPadding;
        const dotY = timeY;
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
        ctx.fillStyle = '#ff4d4d';
        ctx.fill();
        ctx.closePath();
      }

    } catch (e) {
      console.error('drawPiPCanvasCompact error', e);
    }
  }

  // PiP start/stop
  let pipActive = false, pipStream = null, pipRAF = null;
  async function startPiP() {
    if (!pipCanvas || !pipVideo) {
      alert('PiP elements are missing from the page.');
      return;
    }
    if (!('requestPictureInPicture' in HTMLVideoElement.prototype)) {
      alert('Picture-in-Picture is not supported by this browser.');
      return;
    }

    ensurePipCanvasPaintable();
    drawPiPCanvasCompact();

    try {
      pipStream = pipCanvas.captureStream ? pipCanvas.captureStream(15) : null;
      if (!pipStream) {
        alert('canvas.captureStream() not supported in this browser — try the compact popup instead.');
        return;
      }

      pipVideo.muted = true;
      pipVideo.autoplay = true;
      pipVideo.playsInline = true;
      pipVideo.srcObject = pipStream;

      await pipVideo.play();
      await pipVideo.requestPictureInPicture();
      pipActive = true;

      function loop() {
        if (!pipActive) return;
        drawPiPCanvasCompact();
        pipRAF = requestAnimationFrame(loop);
      }
      pipRAF = requestAnimationFrame(loop);

      pipVideo.addEventListener('leavepictureinpicture', stopPiPOnce, { once: true });
    } catch (err) {
      console.error('startPiP error', err);
      alert('Unable to start Picture-in-Picture: ' + (err && err.message ? err.message : err));
    }
  }
  function stopPiPOnce() { stopPiP(); }
  function stopPiP() {
    pipActive = false;
    if (pipRAF) { cancelAnimationFrame(pipRAF); pipRAF = null; }
    try { if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => { }); } catch (e) { }
    try { if (pipVideo) { pipVideo.pause(); pipVideo.srcObject = null; } } catch (e) { }
    try { if (pipStream) { pipStream.getTracks().forEach(t => t.stop()); pipStream = null; } } catch (e) { }
  }

  // compact popup fallback (unchanged)
  let popupRef = null, popupSenderInterval = null;
  function openPopupWindow() {
    const w = 340, h = 78;
    const left = Math.max(0, (screen.width - w) / 2);
    const top = Math.max(0, (screen.height - h) / 6);
    const specs = `width=${w},height=${h},left=${left},top=${top},resizable=yes`;
    const html = `
      <html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pomodoro Floating</title>
      <style>html,body{height:100%;margin:0;background:#050507}canvas{display:block;width:100%;height:100%}</style>
      </head><body>
        <canvas id="c" width="${w}" height="${h}"></canvas>
        <script>
          (function(){
            const canvas = document.getElementById('c');
            const ctx = canvas.getContext('2d');
            function drawDefault() {
              try {
                ctx.clearRect(0,0,canvas.width,canvas.height);
                ctx.fillStyle='#050507';
                ctx.fillRect(0,0,canvas.width,canvas.height);
                ctx.fillStyle='#fff'; ctx.font='600 12px system-ui,Arial'; ctx.textBaseline='middle';
                ctx.fillText('FOCUS', 12, canvas.height/2 - 6);
                ctx.font='900 28px system-ui,Arial';
                const timeStr = '00:00'; const measure = ctx.measureText(timeStr);
                ctx.fillText(timeStr, canvas.width - 12 - measure.width, canvas.height/2 - 6);
              } catch(e){}
            }
            drawDefault();
            window.addEventListener('message', (ev) => {
              try {
                const d = ev.data || {};
                ctx.clearRect(0,0,canvas.width,canvas.height);
                ctx.fillStyle='#050507';
                ctx.fillRect(0,0,canvas.width,canvas.height);
                ctx.fillStyle='#fff'; ctx.font='600 12px system-ui,Arial'; ctx.textBaseline='middle';
                ctx.fillText(d.mode||'FOCUS', 12, canvas.height/2 - 6);
                ctx.font='900 28px system-ui,Arial';
                const timeStr = d.timeStr || '00:00';
                const measure = ctx.measureText(timeStr);
                ctx.fillText(timeStr, canvas.width - 12 - measure.width, canvas.height/2 - 6);
              } catch(e){}
            }, false);
            try { window.opener && window.opener.postMessage({ type:'popup-ready' }, '*'); } catch(e){}
            setInterval(() => { try { window.opener && window.opener.postMessage({ type:'popup-ready' }, '*'); } catch(e){} }, 600);
          })();
        <\/script>
      </body></html>`;
    const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    popupRef = window.open(url, 'pomodoro_floating_popup', specs);
    if (!popupRef) { alert('Popup blocked. Allow popups or use PiP/in-page'); return; }

    if (popupSenderInterval) { clearInterval(popupSenderInterval); popupSenderInterval = null; }
    setTimeout(() => sendPopupUpdate(), 120);
    popupSenderInterval = setInterval(() => {
      if (!popupRef || popupRef.closed) { clearInterval(popupSenderInterval); popupSenderInterval = null; return; }
      sendPopupUpdate();
    }, 500);
  }

  function sendPopupUpdate() {
    if (!popupRef || popupRef.closed) return;
    const payload = { mode: (currentMode() === 'work' ? 'FOCUS' : 'BREAK'), timeStr: fmt(remaining), running };
    try { popupRef.postMessage(payload, '*'); } catch (e) { /* ignore */ }
  }

  // in-page floating show/hide/update
  function showInpageFloating() {
    if (!inpageFloating) return;
    inpageFloating.classList.remove('hidden');
    inpageFloating.setAttribute('aria-hidden', 'false');
    updateFloatingUI();
  }
  function hideInpageFloating() {
    if (!inpageFloating) return;
    inpageFloating.classList.add('hidden');
    inpageFloating.setAttribute('aria-hidden', 'true');
  }
  function updateFloatingUI() {
    if (inpageFloating && !inpageFloating.classList.contains('hidden')) {
      const m = currentMode() === 'work' ? 'FOCUS' : 'BREAK';
      if (floatModeEl) floatModeEl.textContent = m;
      if (floatTimerEl) floatTimerEl.textContent = fmt(remaining);
      if (floatStartBtn) floatStartBtn.disabled = running;
      if (floatPauseBtn) floatPauseBtn.disabled = !running;
    }
    if (pipCanvas && pipActive) drawPiPCanvasCompact();
    if (popupRef && !popupRef.closed) sendPopupUpdate();
  }

  // floating button UI prompt
  if (floatingBtn) {
    floatingBtn.addEventListener('click', () => {
      const choice = prompt('Floating options:\n1 = Picture-in-Picture (tiny)\n2 = Compact popup\n3 = In-page floating bar\n(Enter 1,2,3)');
      if (!choice) return;
      if (choice === '1') startPiP();
      else if (choice === '2') openPopupWindow();
      else if (choice === '3') {
        if (inpageFloating && !inpageFloating.classList.contains('hidden')) hideInpageFloating(); else showInpageFloating();
      } else {
        alert('Unknown choice');
      }
    });
  }

  // in-page floating control wiring
  if (floatStartBtn) floatStartBtn.addEventListener('click', () => startTimer(false, false));
  if (floatPauseBtn) floatPauseBtn.addEventListener('click', () => pauseTimer());
  if (floatCloseBtn) floatCloseBtn.addEventListener('click', () => hideInpageFloating());

  // draggable in-page floating (simple)
  (function makeDraggable() {
    if (!inpageFloating) return;
    const el = inpageFloating;
    const handle = el.querySelector('.float-handle') || el;
    let dragging = false, ox = 0, oy = 0, startX = 0, startY = 0;
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      ox = el.offsetLeft;
      oy = el.offsetTop;
      startX = e.clientX;
      startY = e.clientY;
      handle.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.right = 'auto';
      el.style.left = Math.max(6, ox + dx) + 'px';
      el.style.top = Math.max(6, oy + dy) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; handle.style.cursor = 'grab'; document.body.style.userSelect = ''; });
  })();

  /* ===========
     Wiring & UI actions
     =========== */
  function wire() {
    initialRender();
    if (startBtn) startBtn.addEventListener('click', () => startTimer(false, false));
    if (pauseBtn) pauseBtn.addEventListener('click', pauseTimer);
    if (resetBtn) resetBtn.addEventListener('click', () => { resetTimer(); focusCount = 0; });

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

    if (analyticsBtn) analyticsBtn.addEventListener('click', () => { window.location.href = 'analytics.html'; });

    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (raw && Number.isFinite(raw._focusCount)) focusCount = Number(raw._focusCount);
    } catch (e) { /* ignore */ }
  }

  wire();

  /* ===========
     Cleanup on unload
     =========== */
  window.addEventListener('beforeunload', () => {
    try { stopPiP(); } catch (e) { }
    try { if (popupRef && !popupRef.closed) popupRef.close(); } catch (e) { }
  });

  /* ===========
     Small helper exposure for analytics page
     =========== */
  window.pomodoroFloating = {
    startPiP: startPiP,
    stopPiP: stopPiP,
    openPopupWindow: openPopupWindow,
    showInpageFloating: showInpageFloating,
    hideInpageFloating: hideInpageFloating
  };

})();
