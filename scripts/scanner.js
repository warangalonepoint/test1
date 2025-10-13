/* /scripts/scanner.js
 * Tiny camera barcode scanner with graceful fallback
 * Works with buttons that have:
 *   data-scan
 *   data-scan-target="#selector-of-input"
 */
(function () {
  const hasDetector = 'BarcodeDetector' in window;
  let detector = null, stream = null, anim = 0;

  // ---------- UI overlay ----------
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;display:none;z-index:99999;
    background:rgba(0,0,0,.6);align-items:center;justify-content:center;
  `;
  overlay.innerHTML = `
    <div id="scanSheet" style="
      background:#0b1020;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.4);
      width:min(96vw,680px);padding:14px;color:#e5e7eb;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <strong style="font:600 15px system-ui">Scan a barcode</strong>
        <button id="scanClose" style="border:none;background:#fff;color:#111;border-radius:999px;padding:6px 10px;font-weight:700;cursor:pointer">Close</button>
      </div>
      <video id="scanVideo" playsinline autoplay muted style="width:100%;border-radius:10px;background:#000;max-height:56vh;object-fit:cover"></video>
      <div style="font-size:12px;opacity:.8">Tip: Aim camera at the code. It will auto-capture.</div>
    </div>
  `;
  document.body.appendChild(overlay);
  const $ = s => overlay.querySelector(s);
  const video = $('#scanVideo');
  $('#scanClose').onclick = stop;

  // ---------- core ----------
  async function start(targetSel) {
    // Fallback path if camera / detector isn’t available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const val = prompt('Camera not available. Type or scan with USB scanner:');
      if (val && targetSel) fillTarget(targetSel, val);
      return;
    }

    overlay.style.display = 'flex';

    // Prepare detector if supported
    if (hasDetector && !detector) {
      try { detector = new window.BarcodeDetector({ formats: ['code_128','ean_13','ean_8','upc_a','upc_e','qr_code'] }); }
      catch { /* ignore, will fallback to prompt below on failure */ }
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      await video.play();
      scanLoop(targetSel);
    } catch (e) {
      // Permission blocked or https not used -> prompt fallback
      stop();
      const val = prompt('Camera permission blocked. Type barcode value:');
      if (val && targetSel) fillTarget(targetSel, val);
    }
  }

  function stop() {
    cancelAnimationFrame(anim);
    if (video) video.pause();
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    overlay.style.display = 'none';
  }

  async function scanLoop(targetSel) {
    if (!detector) {
      // No detector support -> allow USB scanner to type into focused element
      // Nothing else to do here; keep video preview for aiming reference
      return;
    }
    const tick = async () => {
      if (!video || video.readyState < 2) { anim = requestAnimationFrame(tick); return; }
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length) {
          const txt = (codes[0].rawValue || '').trim();
          if (txt) {
            fillTarget(targetSel, txt);
            stop();
            return;
          }
        }
      } catch (err) { /* continue trying */ }
      anim = requestAnimationFrame(tick);
    };
    anim = requestAnimationFrame(tick);
  }

  function fillTarget(sel, val) {
    if (!sel) return;
    const el = document.querySelector(sel);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.focus();
  }

  // ---------- wire up buttons with [data-scan] ----------
  function bindButtons() {
    document.querySelectorAll('[data-scan]').forEach(btn => {
      if (btn.__scanBound) return;
      btn.__scanBound = true;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetSel = btn.getAttribute('data-scan-target') || 'input:focus';
        start(targetSel);
      });
    });
  }

  // Initial bind + on DOM changes
  bindButtons();
  const mo = new MutationObserver(bindButtons);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Expose a minimal API if you ever need to call programmatically
  window.BarcodeScanner = { open: start, close: stop, supported: hasDetector };
})();