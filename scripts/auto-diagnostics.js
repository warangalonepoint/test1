<script>
/* /scripts/auto-diagnostics.js  —  lightweight popup diagnostics (v1.0) */
(function(){
  const css = `
  .oasDiag{position:fixed;right:14px;bottom:14px;z-index:99999;font:12px/1.35 system-ui;
    color:#0f172a;background:#0b1220; border:1px solid #111827; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.35);
    min-width:260px; max-width:340px; overflow:hidden}
  .oasDiag h4{margin:0;padding:8px 10px;background:#111827;color:#e5e7eb;font-weight:800;font-size:12px;display:flex;justify-content:space-between;align-items:center}
  .oasDiag .b{display:flex;gap:6px;padding:8px 10px;background:#0b1220}
  .oasDiag .btn{cursor:pointer;border:1px solid #334155;background:#0b1220;color:#e5e7eb;border-radius:8px;padding:6px 10px;font-weight:700}
  .oasDiag .btn.primary{background:#16a34a;border-color:#16a34a;color:#04110a}
  .oasDiag .btn.warn{background:#ef4444;border-color:#ef4444;color:#2a0b0b}
  .oasDiag .list{padding:8px 10px;background:#0b1220;max-height:42vh;overflow:auto}
  .oasDiag .row{display:flex;justify-content:space-between;gap:12px;margin:6px 0}
  .oasDiag .k{color:#cbd5e1}
  .ok{color:#22c55e} .bad{color:#ef4444} .warnc{color:#f59e0b}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const box = document.createElement('div');
  box.className='oasDiag';
  box.innerHTML = `
    <h4>Seed + Diagnostics <span style="opacity:.7">v1.0</span></h4>
    <div class="b">
      <button class="btn" data-act="run">Run</button>
      <button class="btn" data-act="clear">Clear</button>
      <button class="btn" data-act="toggle">Hide</button>
      <button class="btn warn" data-act="repair">Repair DB</button>
    </div>
    <div class="list" id="oasDiagList"></div>
  `;
  document.body.appendChild(box);
  const list = box.querySelector('#oasDiagList');

  const line = (k, v, cls='ok') =>
    `<div class="row"><div class="k">${k}</div><div class="${cls}">${v}</div></div>`;

  function log(k,v,ok=true, warn=false){
    list.insertAdjacentHTML('beforeend', line(k,v, ok ? 'ok' : (warn?'warnc':'bad')));
  }
  function clr(){ list.innerHTML=''; }

  async function pingDB(){
    try{
      // Prefer our unified API if present
      if (window.DB && typeof DB.debugPing==='function'){
        const r = await DB.debugPing();
        log('DB tables', r.tables.join(', '));
        log('Patients', r.countPatients);
        log('Bookings', r.countBookings);
        return true;
      }
      // Fallback: try open Dexie directly
      if (window.Dexie){
        const db = new Dexie('clinicdb'); await db.open().catch(()=>{});
        const tables = db.tables?.map(t=>t.name) || [];
        log('DB tables', tables.length?tables.join(', '):'(none)', !!tables.length);
        db.close && db.close();
        return !!tables.length;
      }
      log('Dexie', 'not loaded', false); return false;
    }catch(e){ log('DB error', e.message||String(e), false); return false; }
  }

  async function storageInfo(){
    try{
      if(!navigator.storage || !navigator.storage.estimate){ log('Storage API','not supported', false); return; }
      const {quota=0, usage=0} = await navigator.storage.estimate();
      const pct = quota? Math.round(usage*100/quota): 0;
      log('Storage used', `${(usage/1048576).toFixed(1)}MB / ${(quota/1048576).toFixed(1)}MB (${pct}%)`, pct<85, pct>=85);
    }catch(e){ log('Storage check', 'failed', false); }
  }

  async function swInfo(){
    try{
      if(!('serviceWorker' in navigator)){ log('Service Worker','not supported', false); return; }
      const regs = await navigator.serviceWorker.getRegistrations();
      log('Service Worker', regs.length? 'registered':'not registered', !!regs.length);
    }catch(e){ log('Service Worker','error', false); }
  }

  async function scannerQRInfo(){
    log('BarcodeAPI', (window.BarcodeAPI?'present':'missing'), !!window.BarcodeAPI);
    log('BarcodeDetector', ('BarcodeDetector' in window ? 'Yes':'No'), ('BarcodeDetector' in window));
    log('QRCode (lib)', (window.QRCode?'present':'missing'), !!window.QRCode);
  }

  async function runAll(){
    clr();
    await pingDB();
    await storageInfo();
    await swInfo();
    await scannerQRInfo();
  }

  box.addEventListener('click', async (e)=>{
    const act = e.target?.dataset?.act; if(!act) return;
    if(act==='run') runAll();
    if(act==='clear') clr();
    if(act==='toggle') box.style.display = (box.style.display==='none'?'':'none');
    if(act==='repair'){
      if(!confirm('This will wipe local DB and reload. Continue?')) return;
      try{
        if (window.Dexie) await Dexie.delete('clinicdb');
        localStorage.clear();
      }catch(e){}
      location.reload();
    }
  });

  // Auto-run shortly after load
  setTimeout(runAll, 800);
})();
</script>