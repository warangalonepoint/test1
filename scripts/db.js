/* OneStop AI Clinic DB Layer
   PouchDB (sync) → Dexie → localStorage
   Public API kept stable for your pages:
   - todayISO()
   - findPatientByPID(pid)
   - findPatientByNamePhone(name, phone)  -> returns PID or null
   - addOrUpdatePatient(patientObj)       -> returns PID
   - nextPID()                            -> "P00001"++ (no duplicates)
   - nextToken(channel?)                  -> daily incremental (1..n)
   - addBooking(bookingObj)
   - listBookingsToday()
   - getLatestBookingTodayByPID(pid)
   - setBookingStatus({pid,token,status})
   - addOPD(opdObj)
   - countOPDByDate(YYYY-MM-DD)
   - listOPDByDate(YYYY-MM-DD)
   - health()                             -> {backend, prefix, pouch:true/false, couch:url or ""}
*/

(function () {
  const DB = (window.DB = window.DB || {});
  const TODAY = () => new Date().toISOString().slice(0, 10);
  DB.todayISO = TODAY;

  // ---- config helpers (from window.APP_CONFIG loaded by ./config/config.js) ----
  const CFG = () => (window.APP_CONFIG || {});
  const prefix = () => (CFG().dbPrefix || "clinic");
  const couchUrl = () => {
    const base = (CFG().couchUrl || "").trim();
    if (!base) return "";
    return base.replace(/\/+$/, "") + "/";
  };

  // ---- utilities ----
  const safeJSON = (k, d) => {
    try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; }
  };
  const setJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  // ---- LS fallback ----
  const LS_KEY = {
    patients: "clinic_ls_patients",
    bookings: "clinic_ls_bookings",
    opd: "clinic_ls_opd",
    seq: "clinic_ls_seq" // { pid:number, token_by_date:{YYYY-MM-DD:number} }
  };
  function makeLS() {
    const shim = {
      kind: "ls",
      async ensure(){ return true; },

      async findPatientByPID(pid){
        return safeJSON(LS_KEY.patients,[]).find(p=>p.pid===pid) || null;
      },
      async findPatientByNamePhone(name,phone){
        const p = safeJSON(LS_KEY.patients,[]).find(x=>x.patientName===name && x.contact===phone);
        return p ? p.pid : null;
      },

      async nextPID(){
        const seq = safeJSON(LS_KEY.seq,{pid:0, token_by_date:{}});
        seq.pid = (seq.pid || 0) + 1;
        setJSON(LS_KEY.seq, seq);
        return "P" + String(seq.pid).padStart(5,"0");
      },

      async addOrUpdatePatient(p){
        let a = safeJSON(LS_KEY.patients,[]);
        if (!p.pid) p.pid = await shim.nextPID();
        const i = a.findIndex(x=>x.pid===p.pid);
        if (i>=0) a[i] = {...a[i], ...p}; else a.push(p);
        setJSON(LS_KEY.patients,a);
        return p.pid;
      },

      async nextToken(){
        const t = TODAY();
        const seq = safeJSON(LS_KEY.seq,{pid:0, token_by_date:{}});
        const m = seq.token_by_date || {};
        m[t] = (m[t] || 0) + 1;
        seq.token_by_date = m;
        setJSON(LS_KEY.seq, seq);
        return m[t];
      },

      async addBooking(b){
        const a = safeJSON(LS_KEY.bookings,[]);
        b.id = (a[a.length-1]?.id || 0) + 1;
        a.push(b);
        setJSON(LS_KEY.bookings,a);
        try { localStorage.setItem("bookings_changed", String(Date.now())); } catch {}
        return b.id;
      },

      async listBookingsToday(){
        const t = TODAY();
        return safeJSON(LS_KEY.bookings,[]).filter(r=>r.date===t).sort((a,b)=>a.ts-b.ts);
      },

      async getLatestBookingTodayByPID(pid){
        const t=TODAY();
        const arr = safeJSON(LS_KEY.bookings,[]).filter(r=>r.date===t && r.pid===pid).sort((a,b)=>b.ts-a.ts);
        return arr[0] || null;
      },

      async setBookingStatus({pid,token,status}){
        const t=TODAY();
        const a=safeJSON(LS_KEY.bookings,[]);
        let row=a.find(r=>r.date===t && r.pid===pid && r.token===token);
        if(!row){
          const cand=a.filter(r=>r.date===t && r.pid===pid).sort((a,b)=>b.ts-a.ts);
          row=cand[0];
        }
        if(!row) return false;
        row.status=status;
        setJSON(LS_KEY.bookings,a);
        try { localStorage.setItem("bookings_status_changed", String(Date.now())); } catch {}
        return true;
      },

      async addOPD(rec){
        const a=safeJSON(LS_KEY.opd,[]);
        rec.id=(a[a.length-1]?.id||0)+1;
        a.push(rec);
        setJSON(LS_KEY.opd,a);
        return rec.id;
      },
      async countOPDByDate(d){
        return safeJSON(LS_KEY.opd,[]).filter(r=>r.date===d).length;
      },
      async listOPDByDate(d){
        return safeJSON(LS_KEY.opd,[]).filter(r=>r.date===d).sort((a,b)=>b.ts-a.ts);
      }
    };
    return shim;
  }

  // ---- Dexie backend ----
  async function makeDexie(){
    if (!window.Dexie || !("indexedDB" in window)) throw new Error("Dexie/IDB not present");
    const db = new Dexie("clinicdb");
    db.version(1).stores({
      patients: "pid,patientName,contact,dob",
      bookings: "++id,date,ts,pid,token,status",
      opd: "++id,ts,pid,date"
    });
    await db.open();

    return {
      kind: "idb", __db: db,
      async ensure(){ return true; },

      async findPatientByPID(pid){ return db.table("patients").get(pid) || null; },
      async findPatientByNamePhone(name,phone){
        return (await db.table("patients").where({patientName:name,contact:phone}).first())?.pid || null;
      },

      async nextPID(){
        const last = (await db.table("patients").orderBy("pid").reverse().first())?.pid || "P00000";
        const num = parseInt(String(last).replace(/\D/g,""),10) || 0;
        return "P" + String(num+1).padStart(5,"0");
      },

      async addOrUpdatePatient(p){
        if(!p.pid) p.pid = await this.nextPID();
        await db.table("patients").put(p);
        return p.pid;
      },

      async nextToken(){
        const t = TODAY();
        const rows = await db.table("bookings").where("date").equals(t).toArray();
        const max = rows.reduce((m,r)=>Math.max(m, +r.token||0), 0);
        return max + 1;
      },

      async addBooking(b){ return db.table("bookings").add(b); },

      async listBookingsToday(){
        const t = TODAY();
        const rows = await db.table("bookings").where("date").equals(t).toArray();
        rows.sort((a,b)=>a.ts-b.ts);
        return rows;
      },

      async getLatestBookingTodayByPID(pid){
        const t=TODAY();
        let rows = await db.table("bookings").where("date").equals(t).and(r=>r.pid===pid).toArray();
        rows.sort((a,b)=>b.ts-a.ts);
        return rows[0] || null;
      },

      async setBookingStatus({pid,token,status}){
        const t=TODAY();
        let row = await db.table("bookings").where("date").equals(t).and(r=>r.pid===pid && r.token===token).first();
        if(!row){
          const rows = await db.table("bookings").where("date").equals(t).and(r=>r.pid===pid).toArray();
          rows.sort((a,b)=>b.ts-a.ts);
          row = rows[0] || null;
        }
        if(!row) return false;
        await db.table("bookings").update(row.id, {status});
        try { localStorage.setItem("bookings_status_changed", String(Date.now())); } catch {}
        return true;
      },

      async addOPD(rec){ return db.table("opd").add(rec); },
      async countOPDByDate(d){ return db.table("opd").where("date").equals(d).count(); },
      async listOPDByDate(d){
        const list = await db.table("opd").where("date").equals(d).toArray();
        list.sort((a,b)=>b.ts-a.ts);
        return list;
      }
    };
  }

  // ---- PouchDB backend (with live sync) ----
  function injectPouch(){
    if (window.PouchDB) return Promise.resolve();
    return new Promise(res=>{
      const s=document.createElement("script");
      s.src="https://cdn.jsdelivr.net/npm/pouchdb@8.0.1/dist/pouchdb.min.js";
      s.onload=res; s.onerror=res;
      document.head.appendChild(s);
    });
  }

  async function makePouch(){
    await injectPouch();
    if(!window.PouchDB) throw new Error("PouchDB not available");

    const mods = [
      "patients","bookings","opd",
      // keep extras for future (pharmacy/lab) — harmless if unused
      "inventory","purchases","returns","sales","gst","pharmacy",
      "lab-tests","lab-orders","lab-reports","lab-records"
    ];

    const local = {};
    const remote = {};
    const pre = prefix();
    const base = couchUrl(); // "" if not configured

    mods.forEach(m => { local[m] = new PouchDB(`${pre}-${m}`); });

    if (base) {
      mods.forEach(m => {
        remote[m] = new PouchDB(`${base}${pre}-${m}`);
        local[m]
          .sync(remote[m], { live:true, retry:true })
          .on("error", e => console.warn("[sync]", m, e?.message||e));
      });
    }

    // helpers
    async function nextPID(){
      // IDs are "P00001" style — calculate max across docs
      const all = await local.patients.allDocs({ include_docs:false });
      const max = all.rows
        .map(r=>r.id)
        .filter(id=>/^P\d{5}$/.test(id))
        .reduce((m,id)=>Math.max(m, parseInt(id.slice(1),10)||0), 0);
      return "P" + String(max+1).padStart(5,"0");
    }

    return {
      kind: base ? "pouch-sync" : "pouch-local",
      __local: local, __remote: remote, __prefix: pre,
      async ensure(){ return true; },

      async findPatientByPID(pid){
        try { const doc = await local.patients.get(pid); return doc || null; }
        catch { return null; }
      },
      async findPatientByNamePhone(name, phone){
        const all = (await local.patients.allDocs({ include_docs:true })).rows.map(r=>r.doc);
        const hit = all.find(d => d.patientName===name && d.contact===phone);
        return hit ? (hit.pid || hit._id) : null;
      },

      nextPID,

      async addOrUpdatePatient(p){
        if(!p.pid) p.pid = await nextPID();
        try{
          const old = await local.patients.get(p.pid).catch(()=>null);
          const doc = old ? { ...old, ...p, _id:p.pid } : { ...p, _id:p.pid };
          await local.patients.put(doc);
        }catch(e){ console.warn("[patients.put]", e?.message||e); }
        return p.pid;
      },

      async nextToken(){
        const t=TODAY();
        const q = await local.bookings.allDocs({ include_docs:true });
        const rows = q.rows.map(x=>x.doc).filter(r=>r.date===t);
        const max = rows.reduce((m,r)=>Math.max(m, +r.token||0), 0);
        return max + 1;
      },

      async addBooking(b){
        const id = b?._id || (Date.now()+"-"+(Math.random()*1e6|0));
        const putDoc = { ...(b||{}), _id: id };
        try { await local.bookings.put(putDoc); }
        catch(e){
          // first-run race; wait & retry once
          await new Promise(r=>setTimeout(r, 900));
          await local.bookings.put(putDoc);
        }
        try { localStorage.setItem("bookings_changed", String(Date.now())); } catch {}
        return putDoc._id;
      },

      async listBookingsToday(){
        const t=TODAY();
        const q=await local.bookings.allDocs({ include_docs:true });
        return q.rows.map(x=>x.doc).filter(r=>r.date===t).sort((a,b)=>a.ts-b.ts);
      },

      async getLatestBookingTodayByPID(pid){
        const t=TODAY();
        const q=await local.bookings.allDocs({ include_docs:true });
        const rows = q.rows.map(x=>x.doc).filter(r=>r.date===t && r.pid===pid).sort((a,b)=>b.ts-a.ts);
        return rows[0] || null;
      },

      async setBookingStatus({pid,token,status}){
        const t=TODAY();
        const q=await local.bookings.allDocs({ include_docs:true });
        const rows=q.rows.map(x=>x.doc).filter(r=>r.date===t && r.pid===pid);
        const row = rows.find(r=>r.token===token) || rows.sort((a,b)=>b.ts-a.ts)[0];
        if(!row) return false;
        await local.bookings.put({ ...row, status, _id:row._id, _rev:row._rev });
        try { localStorage.setItem("bookings_status_changed", String(Date.now())); } catch {}
        return true;
      },

      async addOPD(rec){
        const id = rec?._id || (Date.now()+"-"+(Math.random()*1e6|0));
        await local.opd.put({ ...(rec||{}), _id:id });
        return id;
      },
      async countOPDByDate(d){
        const q=await local.opd.allDocs({ include_docs:true });
        return q.rows.map(x=>x.doc).filter(r=>r.date===d).length;
      },
      async listOPDByDate(d){
        const q=await local.opd.allDocs({ include_docs:true });
        return q.rows.map(x=>x.doc).filter(r=>r.date===d).sort((a,b)=>b.ts-a.ts);
      }
    };
  }

  // ---- choose backend (prefers Pouch, then Dexie, then LS) ----
  let back = null;
  async function chooseBackend(){
    if (back) return back;
    try {
      back = await makePouch();    // works offline; syncs if couchUrl set
    } catch (e) {
      console.warn("[DB] Pouch unavailable:", e?.message||e);
      try {
        back = await makeDexie();
      } catch (e2) {
        console.warn("[DB] Dexie unavailable, fallback LS:", e2?.message||e2);
        back = makeLS();
      }
    }
    try { window.dispatchEvent(new CustomEvent("db-ready",{detail:{backend:back.kind}})); } catch {}
    return back;
  }

  // ---- Public API (bound to chosen backend) ----
  DB.health = async () => {
    const b = await chooseBackend();
    return {
      backend: b.kind,
      prefix: b.__prefix || prefix(),
      pouch: !!b.__local,
      couch: couchUrl()
    };
  };

  DB.findPatientByPID           = async (pid)=>(await chooseBackend()).findPatientByPID(pid);
  DB.findPatientByNamePhone     = async (n,p)=>(await chooseBackend()).findPatientByNamePhone(n,p);
  DB.addOrUpdatePatient         = async (p)=>(await chooseBackend()).addOrUpdatePatient(p);
  DB.nextPID                    = async ()=>(await chooseBackend()).nextPID();

  DB.nextToken                  = async (ch)=>(await chooseBackend()).nextToken(ch);
  DB.addBooking                 = async (b)=>(await chooseBackend()).addBooking(b);
  DB.listBookingsToday          = async ()=>(await chooseBackend()).listBookingsToday();
  DB.getLatestBookingTodayByPID = async (pid)=>(await chooseBackend()).getLatestBookingTodayByPID(pid);
  DB.setBookingStatus           = async (args)=>(await chooseBackend()).setBookingStatus(args);

  DB.addOPD                     = async (rec)=>(await chooseBackend()).addOPD(rec);
  DB.countOPDByDate             = async (d)=>(await chooseBackend()).countOPDByDate(d);
  DB.listOPDByDate              = async (d)=>(await chooseBackend()).listOPDByDate(d);

  // toggle minimal diagnostics (kept)
  DB.enableDiagnostics = (flag)=>{ try{ localStorage.setItem("_diag_enabled", flag ? "1":"0"); }catch{} };
})();