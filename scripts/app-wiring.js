// app-wiring.js v1.1 — universal Scanner + QR glue for all pages
// Requires: /scripts/barcode.js (v8.4.6) and /scripts/qrcode.min.js (v1.1)

(function () {
  const $ = (s, r=document) => r.querySelector(s);

  // --- Scanner: event delegation ---
  // Works for ANY element with [data-scan] attribute.
  // It fills the input given by [data-scan-target] (CSS selector or #id).
  // If no target is provided, it tries the nearest text/number/search input in the same row/form.
  document.addEventListener('click', function (ev) {
    const el = ev.target.closest('[data-scan]');
    if (!el) return;
    ev.preventDefault(); // stop form submissions
    if (!window.BarcodeAPI) { alert('Scanner not loaded'); return; }

    // Resolve target input
    let sel = el.getAttribute('data-scan-target') || '';
    let inp = sel ? document.querySelector(sel) : null;
    if (!inp) {
      // heuristic: first input next to button, else first input in same form/section
      const row = el.closest('.row, .field, .input-group, .form-row, .controls') || el.parentElement;
      inp = row ? row.querySelector('input[type="text"],input[type="search"],input[type="number"]') : null;
      if (!inp) {
        const form = el.closest('form') || document;
        inp = form.querySelector('input[type="text"],input[type="search"],input[type="number"]');
      }
    }
    if (!inp) { alert('Scan target input not found'); return; }

    // Open camera and fill
    window.BarcodeAPI.open(code => {
      try {
        inp.value = code;
        inp.dispatchEvent(new Event('input', {bubbles:true}));
        inp.dispatchEvent(new Event('change',{bubbles:true}));
        if (typeof window.onScanFilled === 'function') window.onScanFilled({button:el, input:inp, value:code});
      } catch {}
    });
  });

  // Backwards-compat: also bind common IDs if they exist (no attributes needed)
  const pairs = [
    ['#scanInv',    '#invBarcode'],
    ['#scanSales',  '#salesBarcode'],
    ['#scanPurch',  '#purchBarcode'],
    ['#scanReturn', '#returnBarcode'],
    ['#scanBtn',    '#scanInput']
  ];
  pairs.forEach(([bSel, iSel])=>{
    const btn = $(bSel), inp = $(iSel);
    if (!btn || !inp) return;
    btn.setAttribute('data-scan',''); btn.setAttribute('data-scan-target', iSel);
  });

  // --- QR helpers (optional; same API as tests.html) ---
  async function ensureQR(){ try{ if (window.QRCreate) return true; await window.QRReady; }catch{} return !!window.QRCreate; }
  async function makeQR(container, text, size=176){
    if (!await ensureQR()) throw new Error('QR library missing');
    container.innerHTML=''; const holder=document.createElement('div'); container.appendChild(holder);
    window.QRCreate(holder, String(text||''), size);
    // return a canvas for print/download even if engine outputs SVG
    const cvs = holder.querySelector('canvas'); if (cvs) return cvs;
    const svg = holder.querySelector('svg'); if (!svg) return null;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image(); const url='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(xml)));
    return new Promise(res=>{ img.onload=()=>{ const c=document.createElement('canvas');
      c.width=svg.viewBox.baseVal.width||svg.width.baseVal.value||size;
      c.height=svg.viewBox.baseVal.height||svg.height.baseVal.value||size;
      c.getContext('2d').drawImage(img,0,0,c.width,c.height); res(c); }; img.src=url; });
  }
  async function attachPidQR(inputSel, boxSel, size=176){
    const inp=$(inputSel), box=$(boxSel); if(!inp||!box) return false;
    const render=async()=>{ try{ await makeQR(box, inp.value, size); }catch(e){ console.warn('PID QR', e.message); } };
    inp.addEventListener('input',render); inp.addEventListener('change',render); render(); return true;
  }
  window.AppQR = { makeQR, attachPidQR };
  window.AppQRPrint = function (canvas){ if(!canvas) return; const w=window.open('','_blank'); w.document.write(`<img src="${canvas.toDataURL('image/png')}">`); w.document.close(); w.print(); };

  // Auto-attach PIDs if these elements exist on a page
  attachPidQR('#pid',     '#pidQR');     // bookings
  attachPidQR('#opdPid',  '#opdPidQR');  // opd
  attachPidQR('#posPid',  '#posPidQR');  // sales POS
})();