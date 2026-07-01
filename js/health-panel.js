/**
 * health-panel.js — Thanzi Health Sync UI
 *
 * Renders #health-panel (a .dash-panel, same pattern as #diary-panel /
 * #settings-panel). Opened from Diary settings, alongside Nutrient Targets.
 *
 * Depends on: ThanziHealth (health.js)
 */
const ThanziHealthPanel = (() => {
  'use strict';

  let _nativeStatus = { available: false, connected: false };
  let _preview = null; // last parsed file, awaiting confirm

  function _fmtCount(n, label) {
    return `${n} ${label}${n === 1 ? '' : 's'}`;
  }

  async function _refreshNativeStatus() {
    _nativeStatus = await ThanziHealth.nativeStatus();
  }

  function _renderSyncLog() {
    const log = ThanziHealth.getSyncLog();
    if (!log.length) {
      return `<div class="hp-log-empty">No syncs yet.</div>`;
    }
    return log.slice(0, 6).map(entry => {
      const when = new Date(entry.at);
      const label = when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' · ' + when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return `
      <div class="hp-log-row">
        <span class="hp-log-icon">${entry.type === 'native' ? '🔗' : '📄'}</span>
        <div class="hp-log-text">
          <div class="hp-log-summary">${entry.summary}</div>
          <div class="hp-log-when">${label}</div>
        </div>
      </div>`;
    }).join('');
  }

  function _renderNativeCard() {
    if (!_nativeStatus.available) {
      return `
      <div class="st-card">
        <div class="st-card-header">
          <span class="st-card-icon">🔗</span>
          <span class="st-card-title">Health Connect</span>
        </div>
        <div class="hp-native-unavailable">
          <p>Direct sync with Health Connect (and Samsung Health, Google Fit,
          and other apps that feed into it) requires the Thanzi app, not the
          web version.</p>
          <p class="hp-native-sub">Until then, use manual import below —
          export your data from Samsung Health or Health Connect and upload
          it here.</p>
        </div>
      </div>`;
    }

    return `
    <div class="st-card">
      <div class="st-card-header">
        <span class="st-card-icon">🔗</span>
        <span class="st-card-title">Health Connect</span>
      </div>
      <div class="st-row">
        <div class="st-row-left">
          <span class="st-row-icon">${_nativeStatus.connected ? '✅' : '⚪'}</span>
          <span>${_nativeStatus.connected ? 'Connected' : 'Not connected'}</span>
        </div>
        <button class="hp-connect-btn" id="hp-native-connect-btn">
          ${_nativeStatus.connected ? 'Sync now' : 'Connect'}
        </button>
      </div>
    </div>`;
  }

  function _renderPreview() {
    if (!_preview) return '';
    const p = _preview;
    const totalSteps = p.steps.reduce((s, r) => s + r.count, 0);
    const totalCal = p.calories.reduce((s, r) => s + r.kcal, 0) + p.exercise.reduce((s, r) => s + r.calories, 0);

    return `
    <div class="hp-preview">
      <div class="hp-preview-title">Ready to import</div>
      <div class="hp-preview-stats">
        ${p.steps.length ? `<span class="hp-preview-chip">${totalSteps.toLocaleString()} steps</span>` : ''}
        ${p.exercise.length ? `<span class="hp-preview-chip">${_fmtCount(p.exercise.length, 'workout')}</span>` : ''}
        ${totalCal ? `<span class="hp-preview-chip">${totalCal} kcal burned</span>` : ''}
        ${p.weight.length ? `<span class="hp-preview-chip">${_fmtCount(p.weight.length, 'weigh-in')}</span>` : ''}
      </div>
      ${!p.steps.length && !p.exercise.length && !p.weight.length && !p.calories.length
        ? `<p class="hp-preview-empty">No recognizable records found in this file. Double-check it's a Samsung Health / Health Connect / Google Fit export.</p>`
        : ''}
      <div class="hp-preview-actions">
        <button class="hp-btn hp-btn--ghost" id="hp-discard-btn">Discard</button>
        <button class="hp-btn hp-btn--primary" id="hp-confirm-btn" ${(!p.steps.length && !p.exercise.length && !p.weight.length && !p.calories.length) ? 'disabled' : ''}>
          Import
        </button>
      </div>
    </div>`;
  }

  function _render() {
    const panel = document.getElementById('health-panel');
    if (!panel) return;

    panel.innerHTML = `
      <div class="st-page-header hp-page-header">
        <button class="nt-back-btn" id="hp-back-btn" aria-label="Back to Diary">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div>
          <div class="st-page-title">Health Sync</div>
          <div class="st-page-sub">Bring in steps, workouts, and weigh-ins from other apps</div>
        </div>
      </div>

      ${_renderNativeCard()}

      <div class="st-card">
        <div class="st-card-header">
          <span class="st-card-icon">📄</span>
          <span class="st-card-title">Manual Import</span>
        </div>
        <div class="hp-import-body">
          <p class="hp-import-hint">
            Export your data from <strong>Samsung Health</strong>
            (Settings → Download personal data) or
            <strong>Health Connect</strong> (App permissions → your data →
            Export), then upload the file here. CSV and JSON are both supported.
          </p>
          <input type="file" id="hp-file-input" accept=".csv,.json,text/csv,application/json" style="display:none">
          <button class="hp-btn hp-btn--primary" id="hp-choose-file-btn">Choose file</button>
          <div id="hp-file-name" class="hp-file-name"></div>
          <p id="hp-import-error" class="hp-import-error"></p>
          <div id="hp-preview-wrap">${_renderPreview()}</div>
        </div>
      </div>

      <div class="st-card">
        <div class="st-card-header">
          <span class="st-card-icon">🕒</span>
          <span class="st-card-title">Recent Syncs</span>
        </div>
        <div class="hp-log">${_renderSyncLog()}</div>
      </div>
    `;

    _bindEvents();
  }

  function _bindEvents() {
    document.getElementById('hp-back-btn')?.addEventListener('click', () => {
      if (typeof ThanziDiary !== 'undefined' && ThanziDiary.closeHealthSync) {
        ThanziDiary.closeHealthSync();
      }
    });

    const fileInput = document.getElementById('hp-file-input');
    const chooseBtn = document.getElementById('hp-choose-file-btn');
    const errorEl = document.getElementById('hp-import-error');

    if (chooseBtn) chooseBtn.addEventListener('click', () => fileInput.click());

    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        errorEl.textContent = '';
        document.getElementById('hp-file-name').textContent = file.name;
        try {
          _preview = await ThanziHealth.parseFile(file);
          document.getElementById('hp-preview-wrap').innerHTML = _renderPreview();
          _bindPreviewEvents();
        } catch (e) {
          errorEl.textContent = 'Could not read that file. Make sure it\u2019s a valid CSV or JSON export.';
          console.error('ThanziHealthPanel: parse error', e);
        }
      });
    }

    const nativeBtn = document.getElementById('hp-native-connect-btn');
    if (nativeBtn) {
      nativeBtn.addEventListener('click', async () => {
        nativeBtn.disabled = true;
        nativeBtn.textContent = _nativeStatus.connected ? 'Syncing…' : 'Connecting…';
        try {
          if (!_nativeStatus.connected) {
            await ThanziHealth.nativeConnect();
            await _refreshNativeStatus();
          } else {
            await ThanziHealth.nativeSyncToday();
          }
          _render();
        } catch (e) {
          nativeBtn.disabled = false;
          nativeBtn.textContent = _nativeStatus.connected ? 'Sync now' : 'Connect';
          console.error('ThanziHealthPanel: native error', e);
        }
      });
    }

    _bindPreviewEvents();
  }

  function _bindPreviewEvents() {
    document.getElementById('hp-discard-btn')?.addEventListener('click', () => {
      ThanziHealth.discardPreview();
      _preview = null;
      document.getElementById('hp-preview-wrap').innerHTML = '';
      document.getElementById('hp-file-name').textContent = '';
    });

    document.getElementById('hp-confirm-btn')?.addEventListener('click', () => {
      const result = ThanziHealth.confirmImport();
      _preview = null;
      const wrap = document.getElementById('hp-preview-wrap');
      if (result.ok) {
        wrap.innerHTML = `<div class="hp-import-success">✓ Imported ${result.count} record${result.count === 1 ? '' : 's'}.</div>`;
        document.getElementById('hp-file-name').textContent = '';
        document.getElementById('hp-file-input').value = '';
        // Refresh Diary if it's the visible panel so new exercise/weight shows immediately
        if (typeof ThanziDiary !== 'undefined') ThanziDiary.refresh();
        setTimeout(() => { document.getElementById('hp-log').parentElement; _render(); }, 1200);
      } else {
        wrap.innerHTML = `<p class="hp-import-error">${result.reason}</p>`;
      }
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async function refresh() {
    await _refreshNativeStatus();
    _render();
  }

  function open() {
    document.querySelectorAll('.dash-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById('health-panel');
    if (panel) panel.style.display = 'block';
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    refresh();
  }

  return { open, refresh };

})();
