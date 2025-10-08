// /scripts/db.js  — resilient DB with IndexedDB (Dexie) + localStorage fallback
(function () {
  const DB = (window.DB = window.DB || {});
  const TODAY = () => new Date().toISOString().slice(0, 10);
  DB.todayISO = TODAY;

  // ---------- LocalStorage SHIM ----------
  const LS_KEY = {
    patients: 'clinic_ls_patients',
    bookings: 'clinic_ls_bookings',
    opd: 'clinic_ls_opd',
    seq: 'clinic_ls_seq', // {pid: number, token_by_date: {YYYY-MM-DD: number}}
  };
  function lsGet(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  function makeShim() {
    const shim = {
      kind: 'ls',
      async ensure() { return true; },
      async findPatientByPID(pid) {
        const arr = lsGet(LS_KEY.patients, []);
        return arr.find(p => p.pid === pid) || null;
      },
      async findPatientByNamePhone(name, phone) {
        const arr = lsGet(LS_KEY.patients, []);
        const p = arr.find(x => x.patientName === name && x.contact === phone);
        return p ? p.pid : null;
      },
      async nextPID() {
        const seq = lsGet(LS_KEY.seq, { pid: 0, token_by_date: {} });
        seq.pid = (seq.pid || 0) + 1; lsSet(LS_KEY.seq, seq);
        return 'P' + String(seq.pid).padStart(5, '0');
      },
      async addOrUpdatePatient(p) {
        let arr = lsGet(LS_KEY.patients, []);
        if (!p.pid) p.pid = await shim.nextPID();
        const i = arr.findIndex(x => x.pid === p.pid);
        if (i >= 0) arr[i] = p; else arr.push(p);
        lsSet(LS_KEY.patients, arr);
        return p.pid;
      },
      async nextToken() {
        const today = TODAY();
        const seq = lsGet(LS_KEY.seq, { pid: 0, token_by_date: {} });
        const tbd = seq.token_by_date || {};
        tbd[today] = (tbd[today] || 0) + 1;
        seq.token_by_date = tbd; lsSet(LS_KEY.seq, seq);
        return tbd[today];
      },
      async addBooking(b) {
        const arr = lsGet(LS_KEY.bookings, []);
        b.id = (arr[arr.length - 1]?.id || 0) + 1;
        arr.push(b); lsSet(LS_KEY.bookings, arr);
        try { localStorage.setItem('bookings_changed', String(Date.now())); } catch {}
        return b.id;
      },
      async listBookingsToday() {
        const today = TODAY();
        const arr = lsGet(LS_KEY.bookings, []).filter(r => r.date === today);
        return arr.sort((a, b) => a.ts - b.ts);
      },
      async getLatestBookingTodayByPID(pid) {
        const today = TODAY();
        const arr = lsGet(LS_KEY.bookings, []).filter(r => r.date === today && r.pid === pid)
          .sort((a, b) => b.ts - a.ts);
        return arr[0] || null;
      },
      async setBookingStatus({ pid, token, status }) {
        const today = TODAY();
        const arr = lsGet(LS_KEY.bookings, []);
        let row = arr.find(r => r.date === today && r.pid === pid && r.token === token);
        if (!row) {
          const cand = arr.filter(r => r.date === today && r.pid === pid).sort((a, b) => b.ts - a.ts);
          row = cand[0];
        }
        if (!row) return false;
        row.status = status; lsSet(LS_KEY.bookings, arr);
        try { localStorage.setItem('bookings_status_changed', String(Date.now())); } catch {}
        return true;
      },
      async addOPD(rec) {
        const arr = lsGet(LS_KEY.opd, []);
        rec.id = (arr[arr.length - 1]?.id || 0) + 1;
        arr.push(rec); lsSet(LS_KEY.opd, arr);
        return rec.id;
      },
      async countOPDByDate(dateISO) {
        const arr = lsGet(LS_KEY.opd, []);
        return arr.filter(r => r.date === dateISO).length;
      },
      async listOPDByDate(dateISO) {
        const arr = lsGet(LS_KEY.opd, []).filter(r => r.date === dateISO)
          .sort((a, b) => b.ts - a.ts);
        return arr;
      },
    };
    return shim;
  }

  // ---------- Dexie/IndexedDB BACKEND ----------
  let back = null;   // chosen backend (dexie or ls)
  async function chooseBackend() {
    if (back) return back;
    // Attempt Dexie
    try {
      if (!window.Dexie || !('indexedDB' in window)) throw new Error('Dexie/IDB not present');
      const db = new Dexie('clinicdb');
      db.version(1).stores({
        patients: 'pid,patientName,contact,dob',
        bookings: '++id,date,ts,pid,token,status',
        opd:      '++id,ts,pid,date'
      });
      await db.open();
      // Wrap Dexie calls into the same interface
      back = {
        kind: 'idb',
        __db: db,
        async ensure(){ return true; },
        async findPatientByPID(pid){ return db.table('patients').get(pid) || null; },
        async findPatientByNamePhone(name, phone){
          return (await db.table('patients').where({patientName:name, contact:phone}).first())?.pid || null;
        },
        async nextPID(){
          const last = (await db.table('patients').orderBy('pid').reverse().first())?.pid || 'P00000';
          const num = parseInt(String(last).replace(/\D/g, ''), 10) || 0;
          return 'P' + String(num + 1).padStart(5, '0');
        },
        async addOrUpdatePatient(p){
          if (!p.pid) p.pid = await back.nextPID();
          await db.table('patients').put(p); return p.pid;
        },
        async nextToken(){
          const today = TODAY();
          const rows = await db.table('bookings').where('date').equals(today).toArray();
          const max = rows.reduce((m, r) => Math.max(m, +r.token || 0), 0);
          return max + 1;
        },
        async addBooking(b){ return db.table('bookings').add(b); },
        async listBookingsToday(){
          const today = TODAY();
          const rows = await db.table('bookings').where('date').equals(today).toArray();
          rows.sort((a, b) => a.ts - b.ts); return rows;
        },
        async getLatestBookingTodayByPID(pid){
          const today = TODAY();
          let rows = await db.table('bookings').where('date').equals(today).and(r => r.pid === pid).toArray();
          rows.sort((a,b)=>b.ts-a.ts); return rows[0] || null;
        },
        async setBookingStatus({pid, token, status}){
          const today = TODAY();
          let row = await db.table('bookings').where('date').equals(today)
            .and(r => r.pid === pid && r.token === token).first();
          if (!row) {
            const rows = await db.table('bookings').where('date').equals(today)
              .and(r => r.pid === pid).toArray();
            rows.sort((a,b)=>b.ts-a.ts); row = rows[0] || null;
          }
          if (!row) return false;
          await db.table('bookings').update(row.id, { status });
          try { localStorage.setItem('bookings_status_changed', String(Date.now())); } catch {}
          return true;
        },
        async addOPD(rec){ return db.table('opd').add(rec); },
        async countOPDByDate(dateISO){ return db.table('opd').where('date').equals(dateISO).count(); },
        async listOPDByDate(dateISO){
          const list = await db.table('opd').where('date').equals(dateISO).toArray();
          list.sort((a,b)=>b.ts-a.ts); return list;
        }
      };
      return back;
    } catch (e) {
      console.warn('[DB] Falling back to localStorage:', e?.message || e);
      back = makeShim();
      return back;
    }
  }

  // ---------- Public API (uniform) ----------
  DB.health = async () => {
    const b = await chooseBackend();
    return { backend: b.kind };
  };

  DB.findPatientByPID = async (pid) => (await chooseBackend()).findPatientByPID(pid);
  DB.findPatientByNamePhone = async (n, p) => (await chooseBackend()).findPatientByNamePhone(n, p);
  DB.addOrUpdatePatient = async (p) => (await chooseBackend()).addOrUpdatePatient(p);
  DB.nextPID = async () => (await chooseBackend()).nextPID();

  DB.nextToken = async (ch) => (await chooseBackend()).nextToken(ch);
  DB.addBooking = async (b) => (await chooseBackend()).addBooking(b);
  DB.listBookingsToday = async () => (await chooseBackend()).listBookingsToday();
  DB.getLatestBookingTodayByPID = async (pid) => (await chooseBackend()).getLatestBookingTodayByPID(pid);
  DB.setBookingStatus = async (args) => (await chooseBackend()).setBookingStatus(args);

  DB.addOPD = async (rec) => (await chooseBackend()).addOPD(rec);
  DB.countOPDByDate = async (d) => (await chooseBackend()).countOPDByDate(d);
  DB.listOPDByDate = async (d) => (await chooseBackend()).listOPDByDate(d);

  DB.enableDiagnostics = (flag) => { try { localStorage.setItem('_diag_enabled', flag ? '1' : '0'); } catch {} };
})();

// --- Live Dexie watcher for new bookings ---
if (typeof window !== 'undefined') {
  const dbNotify = new Dexie('clinicdb');
  dbNotify.version(1).stores({ bookings: '++id,date,token,patientName' });

  let lastCount = 0;
  async function watchBookings() {
    const today = new Date().toISOString().slice(0,10);
    const count = await dbNotify.table('bookings').where('date').equals(today).count();
    if (count > lastCount) {
      const latest = await dbNotify.table('bookings').where('date').equals(today).reverse().limit(1).first();
      const event = new CustomEvent('newBooking', { detail: latest });
      window.dispatchEvent(event);
      lastCount = count;
    } else {
      lastCount = count;
    }
  }
  setInterval(watchBookings, 4000); // check every 4s
}
