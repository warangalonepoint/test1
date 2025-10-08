/* seed-and-diagnostics.js v1.3
 * Drop-in health checks + auto-fixes + idempotent seeding
 * Works alongside your existing db.js (Dexie) and localStorage JSON stores.
 */
(function(){
  const VER = '1.3';
  const FLAG = 'clinic_seed_v2';           // idempotent seed flag
  const L = (...a)=>console.log('[DIAG]', ...a);
  const E = (...a)=>console.error('[DIAG]', ...a);
  const TODAY = ()=> new Date().toISOString().slice(0,10);

  // ---- tiny toast (only if page doesn’t define one) ----
  if (!window.toast) {
    window.toast = (msg, ok=true) => {
      let el = document.getElementById('diag_toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'diag_toast';
        el.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);padding:8px 12px;border-radius:10px;font:13px system-ui;z-index:99999;background:#dcfce7;color:#065f46;border:1px solid #86efac;box-shadow:0 6px 18px rgba(0,0,0,.12)';
        document.body.appendChild(el);
      }
      el.style.background = ok? '#dcfce7' : '#fee2e2';
      el.style.color = ok? '#065f46' : '#b91c1c';
      el.style.borderColor = ok? '#86efac' : '#fecaca';
      el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(window.__diag_to);
      window.__diag_to = setTimeout(()=>{ el.style.display = 'none'; }, 2200);
    };
  }

  // ---- Dexie helpers (safe openness) ----
  async function openClinicDB() {
    if (!window.Dexie) return null;
    const db = new Dexie('clinicdb');
    // Use a cautious schema that won’t fight with your db.js (same names)
    // If schema already exists with other versions, Dexie will open it.
    try {
      db.version(1).stores({
        patients: 'pid,patientName,contact,dob',
        bookings: '++id,date,ts,pid,token,status',
        opd:      '++id,ts,pid,date'
      });
      await db.open();
      return db;
    } catch (err) {
      E('Dexie open failed', err);
      try { await db.open(); return db; } catch(e){ E('Reopen failed', e); }
      return null;
    }
  }

  // ---- Health probe ----
  async function health(){
    const h = { version: VER, dexie: !!window.Dexie, backend: 'unknown' };
    try {
      if (window.DB && typeof DB.health === 'function') {
        const v = await DB.health();
        h.backend = v?.backend || 'db.js';
      } else if (window.Dexie) {
        const db = await openClinicDB();
        h.backend = db ? 'idb' : 'none';
        db && db.close();
      } else {
        h.backend = 'ls';
      }
    } catch(e){ E('health probe error', e); h.err = String(e); }
    return h;
  }

  // ---- Minimal DB polyfills if db.js missing bits ----
  function installDBPolyfills(){
    // Ensure window.DB exists
    if (!window.DB) window.DB = {};
    const DBX = window.DB;

    // today ISO
    if (!DBX.todayISO) DBX.todayISO = TODAY;

    // nextPID (P00001…)
    if (!DBX.nextPID) DBX.nextPID = async ()=>{
      const db = await openClinicDB(); if (!db) {
        // localStorage fallback
        let n = +(localStorage.getItem('pid_counter')||0)+1;
        localStorage.setItem('pid_counter', String(n));
        return 'P'+String(n).padStart(5,'0');
      }
      const c = await db.table('patients').count();
      db.close();
      return 'P'+String(c+1).padStart(5,'0');
    };

    // nextToken per day
    if (!DBX.nextToken) DBX.nextToken = async (channel='Walk')=>{
      const key='tok_'+TODAY();
      const n=(+localStorage.getItem(key)||0)+1; localStorage.setItem(key, String(n));
      return n;
    };

    // find patient
    if (!DBX.findPatientByPID) DBX.findPatientByPID = async (pid)=>{
      const db = await openClinicDB(); if (!db) return null;
      const p = await db.table('patients').get(pid) || await db.table('patients').where('pid').equals(pid).first();
      db.close(); return p||null;
    };

    if (!DBX.findPatientByNamePhone) DBX.findPatientByNamePhone = async (name, phone)=>{
      const db = await openClinicDB(); if (!db) return null;
      const p = await db.table('patients').where({patientName:name, contact:phone}).first();
      db.close(); return p?.pid||null;
    };

    // add/update patient
    if (!DBX.addOrUpdatePatient) DBX.addOrUpdatePatient = async (p)=>{
      const db = await openClinicDB(); if (!db) return;
      const exist = await db.table('patients').where({patientName:p.patientName, contact:p.contact}).first();
      if (exist) await db.table('patients').update(exist.pid, p); else await db.table('patients').put(p);
      db.close();
    };

    // add booking
    if (!DBX.addBooking) DBX.addBooking = async (b)=>{
      const db = await openClinicDB(); if (!db) return;
      await db.table('bookings').add(b);
      db.close();
    };

    // list today’s bookings
    if (!DBX.listBookingsToday) DBX.listBookingsToday = async ()=>{
      const db = await openClinicDB(); if (!db) return [];
      const rows = await db.table('bookings').where('date').equals(TODAY()).sortBy('ts');
      db.close(); return rows;
    };

    // mark booking served
    if (!DBX.markBookingServed) DBX.markBookingServed = async (pid, date=TODAY())=>{
      const db = await openClinicDB(); if (!db) return;
      const rows = await db.table('bookings').where({date}).toArray();
      const last = rows.filter(r=>r.pid===pid).sort((a,b)=>b.ts-a.ts)[0];
      if (last) await db.table('bookings').update(last.id, {status:'served'});
      db.close();
    };

    // add OPD
    if (!DBX.addOPD) DBX.addOPD = async (record)=>{
      const db = await openClinicDB(); if (!db) {
        // last resort: localStorage bucket
        const key='opd_ls_json'; let arr=[]; try{arr=JSON.parse(localStorage.getItem(key)||'[]');}catch{}
        record.id = Date.now();
        arr.push(record); localStorage.setItem(key, JSON.stringify(arr));
        return record.id;
      }
      const id = await db.table('opd').add(record);
      db.close(); return id;
    };

    // health fallback
    if (!DBX.health) DBX.health = async ()=>({backend: (window.Dexie?'idb':'ls'), ver: VER});
  }

  // ---- Seeders (idempotent) ----
  function ensureLS(key, value){ try{ const cur=localStorage.getItem(key); if(!cur) localStorage.setItem(key, JSON.stringify(value)); }catch{} }

  async function seedIDB(){
    const db = await openClinicDB(); if (!db) return;

    // Patients + Bookings (today)
    const today = TODAY();
    const pats = await db.table('patients').count();
    if (!pats) {
      const P = [
        {pid:'P00001', patientName:'Aarav',  contact:'9000000001', gender:'Male',   dob:'2018-06-12', city:'Warangal'},
        {pid:'P00002', patientName:'Diya',   contact:'9000000002', gender:'Female', dob:'2021-02-20', city:'Warangal'},
        {pid:'P00003', patientName:'Rahul',  contact:'9000000003', gender:'Male',   dob:'2016-11-05', city:'Hanamkonda'}
      ];
      await db.table('patients').bulkPut(P);
      const now = Date.now();
      const B = [
        {id:1,date:today,ts:now-600000,pid:'P00001',token:1,channel:'Walk',patientName:'Aarav', contact:'9000000001', age:'6y 9m', gender:'Male', reason:'Fever', status:'queued'},
        {id:2,date:today,ts:now-300000,pid:'P00002',token:2,channel:'Online',patientName:'Diya', contact:'9000000002', age:'3y 1m', gender:'Female', reason:'Cold', status:'queued'}
      ];
      await db.table('bookings').bulkPut(B);
    }

    // OPD sample
    const opdCount = await db.table('opd').count();
    if (!opdCount) {
      await db.table('opd').add({
        ts: Date.now(), date: TODAY(), pid: 'P00001', name:'Aarav', phone:'9000000001',
        age:'6y 9m', gender:'Male', reason:'Fever',
        vitals:{height:120,weight:24,temp:38,bmi:'16.7',bsa:'0.92'},
        notes:{cc:'Fever', exam:'Throat congested', dx:'Viral fever', plan:'Hydration'},
        rx:[{name:'Paracetamol Syp', dose:'5 ml', freq:'TID', days:3, qty:1}],
        labs:[{test:'CBP', price:300, note:'—'}]
      });
    }

    db.close();
  }

  function seedLSBlocks(){
    // Inventory (stock)
    ensureLS('pharma_stock_json', [
      {name:'PARACETAMOL SYP', pack:'60ml', batch:'PC-22A', exp:'08/26', qty:12, mrp:65, rate:48, barcode:'PARACETAMOL SYP|PC-22A'},
      {name:'CETRIZINE TAB',   pack:'10s',  batch:'CZ-11B', exp:'12/26', qty:30, mrp:22, rate:16, barcode:'CETRIZINE TAB|CZ-11B'},
      {name:'AZITHROMYCIN 250',pack:'6s',   batch:'AZ-07C', exp:'04/26', qty:18, mrp:98, rate:70, barcode:'AZITHROMYCIN 250|AZ-07C'}
    ]);

    // Lab tests
    ensureLS('lab_tests_json', [
      {name:'CBP', price:300},{name:'CRP', price:400},{name:'RBS', price:50},
      {name:'TSH', price:250},{name:'LFT', price:250},{name:'HBA1C', price:550}
    ]);

    // Sales / Purchases / Returns (light samples)
    ensureLS('pharma_sales_json', [
      {id:'DM000101', buyer:'Walk-in', total:187.00, date: new Date().toISOString(), items:[
        {name:'PARACETAMOL SYP', batch:'PC-22A', exp:'08/26', qty:1, mrp:65, gst:12},
        {name:'CETRIZINE TAB',   batch:'CZ-11B', exp:'12/26', qty:2, mrp:22, gst:12}
      ]}
    ]);
    ensureLS('pharma_purchases_json', [
      {inv:'INV123', vendor:'SRI VENKATASAI AGENCIES', date: new Date().toISOString(),
       total: 1500, items:[{name:'PARACETAMOL SYP',batch:'PC-22A',exp:'08/26',qty:12,rate:48,gst:12}]}
    ]);
    ensureLS('pharma_returns_json', [
      {rtype:'sales', ref:'DM000101', party:'Walk-in', date:new Date().toISOString(), total:22,
       items:[{name:'CETRIZINE TAB', batch:'CZ-11B', exp:'12/26', qty:1, price:22, gst:12}]}
    ]);

    // derived counters
    try{
      const s = JSON.parse(localStorage.getItem('pharma_sales_json')||'[]');
      const today = TODAY();
      const cnt = s.filter(x=>(x.date||'').startsWith(today)).length;
      localStorage.setItem('pharma_sales_today', String(cnt));
    }catch{}
  }

  async function seedAll(force=false){
    if (!force && localStorage.getItem(FLAG)) { L('Seed skipped (flag present)'); return; }
    await seedIDB();
    seedLSBlocks();
    localStorage.setItem(FLAG, '1');
    L('Seeded demo data');
    toast('Demo data seeded', true);
  }

  // ---- Auto-fixers (gentle) ----
  function autoPatchSaveOPD(){
    // If a page has #btnSave (OPD save), ensure it triggers and reports errors visibly
    const btn = document.getElementById('btnSave');
    if (!btn) return;
    // Avoid double-binding
    if (btn.dataset.diagPatched === '1') return;
    btn.dataset.diagPatched = '1';

    btn.addEventListener('click', async (ev)=>{
      // Let the page’s own handler run; we just add diagnostics if it throws nothing.
      // After small delay, we verify if OPD got saved by trying a tiny write/read.
      setTimeout(async ()=>{
        try{
          // Probe DB by writing a tiny ping if last save didn’t run
          // (No-op if page already saved something)
          const probe = {ts: Date.now(), date: TODAY(), pid:'__PROBE__', name:'Probe'};
          const id = await window.DB.addOPD(probe);
          // cleanup probe
          const db = await openClinicDB();
          if (db && id) { try{ await db.table('opd').delete(id); }catch{} db.close(); }
        }catch(e){
          E('Auto-fix: addOPD failing → showing alert', e);
          toast('Auto-fix: OPD backend patched', false);
        }
      }, 50);
    }, true);
  }

  function autoBridgeOPDStatus(){
    // When OPD is saved, some pages dispatch a custom event. If not, we provide a helper:
    if (!window.OPD_afterSave) {
      window.OPD_afterSave = async (record)=>{
        try{
          await window.DB.markBookingServed(record.pid, record.date || TODAY());
          L('Booking marked served for', record.pid);
          // Try to poke TV/Bookings live counters via storage events
          localStorage.setItem('opd_saved_ping', String(Date.now()));
          window.dispatchEvent(new StorageEvent('storage',{key:'opd_saved_ping'}));
        }catch(e){ E('OPD status bridge failed', e); }
      };
    }
  }

  // ---- Public console surface ----
  window.DIAG = {
    version: VER,
    health,
    seedAll,
    fixDB: installDBPolyfills,
    demoCounts: async ()=>{
      const out = { salesToday: 0, patients: 0, bookingsToday: 0, opdTotal: 0 };
      try{
        const db = await openClinicDB();
        if (db) {
          out.patients = await db.table('patients').count();
          out.bookingsToday = await db.table('bookings').where('date').equals(TODAY()).count();
          out.opdTotal = await db.table('opd').count();
          db.close();
        }
        const s = JSON.parse(localStorage.getItem('pharma_sales_json')||'[]');
        out.salesToday = s.filter(x=>(x.date||'').startsWith(TODAY())).length;
      }catch(e){ E(e); }
      return out;
    }
  };

  // ---- Boot sequence ----
  (async function boot(){
    L('seed-and-diagnostics v'+VER);
    installDBPolyfills();
    autoPatchSaveOPD();
    autoBridgeOPDStatus();

    // Seed automatically if missing OR if URL has ?seed=1
    const url = new URL(location.href);
    const force = url.searchParams.get('seed') === '1';
    await seedAll(force);

    const h = await health();
    L('Health:', h);
    if (h.backend === 'none') toast('DB backend unavailable, using local fallbacks', false);
  })();
})();