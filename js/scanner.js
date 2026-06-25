/**
 * scanner.js — Thanzi Barcode Scanner Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Supports:
 *  - Live camera scan  (BarcodeDetector API → ZXing fallback)
 *  - Gallery scan      (file picker → BarcodeDetector → ZXing fallback)
 *
 * Usage:
 *   ThanziScanner.open(barcode => { console.log(barcode); });
 *
 * Author: Edison Taimu — Thanzi
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ThanziScanner = (() => {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  const _s = {
    onScan:      null,   // callback(barcodeString)
    stream:      null,   // MediaStream
    scanFrame:   null,   // requestAnimationFrame id
    detector:    null,   // BarcodeDetector instance
    zxing:       null,   // ZXing reader instance
    useZXing:    false,  // true when BarcodeDetector unavailable
    scanning:    false,
  };

  const BARCODE_FORMATS = ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code','itf','data_matrix'];

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _el(id) { return document.getElementById(id); }

  function _show(id) { const e = _el(id); if (e) e.style.display = 'block'; }
  function _hide(id) { const e = _el(id); if (e) e.style.display = 'none';  }

  function _status(msg, isError = false) {
    const el = _el('scanner-status');
    if (!el) return;
    el.textContent  = msg;
    el.style.color  = isError ? '#e74c3c' : '#aaa';
    el.style.display = msg ? 'block' : 'none';
  }

  // ── BarcodeDetector check ─────────────────────────────────────────────────
  function _hasBarcodeDetector() {
    return ('BarcodeDetector' in window);
  }

  async function _getDetector() {
    if (_s.detector) return _s.detector;
    try {
      _s.detector = new BarcodeDetector({ formats: BARCODE_FORMATS });
    } catch {
      // Some browsers support BarcodeDetector but not all formats
      _s.detector = new BarcodeDetector();
    }
    return _s.detector;
  }

  // ── ZXing loader (dynamic — only loads if needed) ─────────────────────────
  async function _loadZXing() {
    if (_s.zxing) return _s.zxing;
    if (window.ZXing) { _s.zxing = new ZXing.BrowserMultiFormatReader(); return _s.zxing; }

    return new Promise((resolve, reject) => {
      const script  = document.createElement('script');
      script.src    = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js';
      script.onload = () => {
        _s.zxing = new ZXing.BrowserMultiFormatReader();
        resolve(_s.zxing);
      };
      script.onerror = () => reject(new Error('ZXing failed to load'));
      document.head.appendChild(script);
    });
  }

  // ── Camera scanning ───────────────────────────────────────────────────────

  async function _startCamera() {
    _show('scanner-camera-view');
    _hide('scanner-choice');
    _status('Starting camera…');

    try {
      _s.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      const video = _el('scanner-video');
      video.srcObject = _s.stream;
      await video.play();
      _status('');

      if (_hasBarcodeDetector()) {
        _scanWithDetector(video);
      } else {
        _status('Loading scanner…');
        try {
          const reader = await _loadZXing();
          _s.useZXing  = true;
          _status('');
          reader.decodeFromVideoElement(video, (result, err) => {
            if (result) { _onDetected(result.getText()); }
          });
        } catch {
          _status('Scanner not supported on this browser.', true);
        }
      }

    } catch (err) {
      if (err.name === 'NotAllowedError') {
        _status('Camera permission denied. Use Gallery instead.', true);
      } else {
        _status('Could not access camera.', true);
      }
    }
  }

  async function _scanWithDetector(video) {
    if (!_s.scanning) return;
    try {
      const detector = await _getDetector();
      const codes    = await detector.detect(video);
      if (codes.length > 0) {
        _onDetected(codes[0].rawValue);
        return;
      }
    } catch { /* frame not ready yet */ }
    _s.scanFrame = requestAnimationFrame(() => _scanWithDetector(video));
  }

  function _stopCamera() {
    _s.scanning = false;
    if (_s.scanFrame) { cancelAnimationFrame(_s.scanFrame); _s.scanFrame = null; }
    if (_s.stream)    { _s.stream.getTracks().forEach(t => t.stop()); _s.stream = null; }
    if (_s.zxing && _s.useZXing) { try { _s.zxing.reset(); } catch {} }
    const video = _el('scanner-video');
    if (video) { video.srcObject = null; }
  }

  // ── Gallery scanning ──────────────────────────────────────────────────────

  function _openGallery() {
    const input = _el('scanner-file-input');
    input.value = '';
    input.click();
  }

  async function _onGalleryFile(file) {
    if (!file) return;
    _show('scanner-camera-view');
    _hide('scanner-choice');
    _status('Reading image…');

    // Show a preview of the image in the video element area
    const previewUrl = URL.createObjectURL(file);
    const preview    = _el('scanner-preview-img');
    if (preview) { preview.src = previewUrl; preview.style.display = 'block'; }
    _el('scanner-video').style.display = 'none';

    try {
      if (_hasBarcodeDetector()) {
        const bitmap   = await createImageBitmap(file);
        const detector = await _getDetector();
        const codes    = await detector.detect(bitmap);
        bitmap.close();

        if (codes.length > 0) {
          _onDetected(codes[0].rawValue);
        } else {
          _status('No barcode found in image. Try a clearer photo.', true);
        }
      } else {
        const reader = await _loadZXing();
        const result = await reader.decodeFromImageUrl(previewUrl);
        _onDetected(result.getText());
      }
    } catch (err) {
      if (err.name === 'NotFoundException' || err.message?.includes('No MultiFormat')) {
        _status('No barcode found in image. Try a clearer photo.', true);
      } else {
        _status('Could not read image.', true);
      }
    } finally {
      URL.revokeObjectURL(previewUrl);
    }
  }

  // ── On barcode detected ───────────────────────────────────────────────────

  function _onDetected(value) {
    if (!value) return;
    _stopCamera();
    close();

    if (typeof _s.onScan === 'function') {
      _s.onScan(value.trim());
    }
  }

  // ── Modal open / close ────────────────────────────────────────────────────

  function open(onScan) {
    _s.onScan   = onScan;
    _s.scanning = true;
    _s.useZXing = false;

    // Reset modal state
    _show('scanner-choice');
    _hide('scanner-camera-view');
    _status('');

    const video = _el('scanner-video');
    if (video) video.style.display = 'block';
    const preview = _el('scanner-preview-img');
    if (preview) { preview.style.display = 'none'; preview.src = ''; }

    _show('scanner-modal');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    _stopCamera();
    _hide('scanner-modal');
    document.body.style.overflow = '';

    // Reset to choice screen for next time
    _show('scanner-choice');
    _hide('scanner-camera-view');
    _status('');

    const video = _el('scanner-video');
    if (video) video.style.display = 'block';
    const preview = _el('scanner-preview-img');
    if (preview) { preview.style.display = 'none'; preview.src = ''; }
  }

  // ── Bind modal events (call once on DOMContentLoaded) ────────────────────

  function init() {
    _el('scanner-close-btn')?.addEventListener('click', close);
    _el('scanner-back-btn')?.addEventListener('click', () => {
      _stopCamera();
      _show('scanner-choice');
      _hide('scanner-camera-view');
      _status('');
      const video = _el('scanner-video');
      if (video) video.style.display = 'block';
      const preview = _el('scanner-preview-img');
      if (preview) { preview.style.display = 'none'; preview.src = ''; }
    });

    _el('scanner-camera-btn')?.addEventListener('click', _startCamera);
    _el('scanner-gallery-btn')?.addEventListener('click', _openGallery);

    // File input change
    _el('scanner-file-input')?.addEventListener('change', (e) => {
      _onGalleryFile(e.target.files[0]);
    });

    // Close on backdrop tap
    _el('scanner-modal')?.addEventListener('click', (e) => {
      if (e.target === _el('scanner-modal')) close();
    });
  }

  return { open, close, init };

})();
