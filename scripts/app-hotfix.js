/* app-hotfix.js — compatibility shim for pages using window.DB and queues */
/* Safe to include multiple times; only defines missing pieces. */

(function(){
  // ---- Dexie open with superset schema (non-destructive upgrade) ----
  async function openDB(){
    if (!window.Dexie) throw new Error('Dexie missing');
    const db = new Dexie('clinicdb');
    db.version(3).stores({
      patients: 'pid,patientName,contact,dob',
      bookings: '++id,date,ts,pid,token,status,channel',
      opd:      '++id,ts,pid,date',
      meta:     '&key,value'
    });
    await db.open();
    return db;
  }

  function todayISO(){ return new Date().toISOString().slice(0,10); }

  // ---- Ensure window.DB with methods used by pages (only if missing) ----
  if (!window.DB) window.DB = {};

  // nextPID
  if (!window.DB.nextPID) {
    window.DB.nextPID = async function(){
      const db = await openDB();
      const row = await db.table('meta').get('pid_counter');
      let n = row ? (+row.value||0) : 0;
      n += 1;
      await db.table('meta').put({key:'pid_counter', value:String(n)});
      const pid = 'P' + String(n).padStart(5,'0');
      db.close();
      return pid;
    };
  }

  // nextToken (resets daily per channel set)
  if (!window.DB.nextToken) {
    window.DB.nextToken = async function(channel){
      const db = await openDB();
      const key = 'token_'+(channel||'Walk');
      const dayKey = 'token_day';
      const day = (await db.table('meta').get(dayKey))?.value || '';
      const today = todayISO();
      if (day !== today){
        // reset all tokens
        const keys = (await db.table('meta').toArray()).map(r=>r.key).filter(k=>k.startsWith('token_'));
        await Promise.all(keys.map(k=>db.table('meta').delete(k)));
        await db.table('meta').put({key:dayKey, value:today});
      }
      const cur = +(await db.table('meta').get(key))?.value || 0;
      const next = cur + 1;
      await db.table('meta').put({key, value:String(next)});
      db.close();
      return next;
    };
  }

  // todayISO
  if (!window.DB.todayISO) window.DB.todayISO = todayISO;

  // addOrUpdatePatient (by name+phone permanence), find helpers
  if (!window.DB.addOrUpdatePatient) {
    window.DB.addOrUpdatePatient = async function(p){
      const db = await openDB();
      const hit = await db.table('patients').where({patientName:p.patientName, contact:p.contact}).first();
      if (hit) {
        const merged = {...hit, ...p, pid: hit.pid}; // preserve PID
        await db.table('patients').put(merged);
      } else {
        await db.table('patients').put(p);
      }
      db.close();
    };
  }
  if (!window.DB.findPatientByPID) {
    window.DB.findPatientByPID = async function(pid){
      const db = await openDB();
      const p = await db.table('patients').get(pid) || await db.table('patients').where('pid').equals(pid).first();
      db.close();
      return p || null;
    };
  }
  if (!window.DB.findPatientByNamePhone) {
    window.DB.findPatientByNamePhone = async function(name, phone){
      const db = await openDB();
      const p = await db.table('patients').where({patientName:name, contact:phone}).first();
      db.close();
      return p?.pid || null;
    };
  }

  // bookings helpers
  if (!window.DB.addBooking) {
    window.DB.addBooking = async function(b){
      const db = await openDB();
      await db.table('bookings').add(b);
      db.close();
    };
  }
  if (!window.DB.listBookingsToday) {
    window.DB.listBookingsToday = async function(){
      const db = await openDB();
      const rows = await db.table('bookings').where('date').equals(todayISO()).sortBy('ts');
      db.close();
      return rows;
    };
  }
  if (!window.DB.updateBookingStatus) {
    window.DB.updateBookingStatus = async function(pid, status){
      const db = await openDB();
      const rows = await db.table('bookings').where({date:todayISO(), pid}).toArray();
      for (const r of rows){ await db.table('bookings').update(r.id, {status}); }
      db.close();
    };
  }

  // OPD helpers
  if (!window.DB.addOPD) {
    window.DB.addOPD = async function(rec){
      const db = await openDB();
      await db.table('opd').add(rec);
      db.close();
    };
  }
  if (!window.DB.listOPDByDate) {
    window.DB.listOPDByDate = async function(dateStr){
      const db = await openDB();
      const rows = await db.table('opd').where('date').equals(dateStr||todayISO()).reverse().sortBy('ts');
      db.close();
      return rows;
    };
  }

  // ---- Rx / Lab queue glue (localStorage) : ensure arrays exist ----
  function _ensureLSArray(key){ try{
    const v = localStorage.getItem(key);
    if (!v) localStorage.setItem(key, '[]');
    else JSON.parse(v);
  }catch{ localStorage.setItem(key, '[]'); } }
  _ensureLSArray('pharma_rx_queue');
  _ensureLSArray('lab_orders_queue');

  // ---- Sales page helper: allow POS to consume Rx orders programmatically ----
  if (!window.PHARMACY_addFromRx) {
    // generic bridge: tries to add by simulating the simple UI on sales.html
    window.PHARMACY_addFromRx = function(order){
      const nameInput = document.querySelector('#pname');
      const qtyInput  = document.querySelector('#pqty');
      const addBtnFn  = (window.addItem||window.addSaleItem||window.addByBarcode||null);
      (order.items||[]).forEach(it=>{
        if (nameInput && qtyInput){
          nameInput.value = it.name;
          qtyInput.value  = String(it.qty||1);
          if (typeof window.addItem === 'function') window.addItem();
          // fallback: try barcode route with NAME (will FEFO by name in your sales.html)
          else if (typeof window.addByBarcode === 'function') window.addByBarcode(it.name);
        }
      });
    };
  }

  // ---- Lab page helper: expose a simple reader (optional) ----
  if (!window.LAB_readQueue) {
    window.LAB_readQueue = function(){
      try{ return JSON.parse(localStorage.getItem('lab_orders_queue')||'[]'); }catch{ return []; }
    };
  }

  // ---- Small console breadcrumb to verify shim loaded ----
  try{
    console.debug('[app-hotfix] shim active',
      { hasDB: !!window.DB, methods: Object.keys(window.DB||{}) });
  }catch{}
})();