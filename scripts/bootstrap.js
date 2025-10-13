<script>
/* Bootstrap.runAll(): create all DBs + views based on APP_CONFIG.modules */
window.Bootstrap = (function(){
  const cfg = window.APP_CONFIG || {};
  const base = (cfg.couchUrl || '').replace(/\/+$/,'') + (cfg.couchUrl ? '/' : '');
  const pre  = cfg.dbPrefix || 'clinic';
  const modules = cfg.modules || ['patients','bookings','opd'];

  async function couch(path, opts={}){
    const url = base + path.replace(/^\//,'');
    const res = await fetch(url, { ...opts, headers: { 'Content-Type':'application/json', ...(opts.headers||{}) } });
    return { ok: res.ok, status: res.status, json: (res.headers.get('content-type')||'').includes('application/json') ? await res.json() : await res.text() };
  }
  function ddoc(id, views){ return { _id:`_design/${id}`, views, language:'javascript' }; }
  const VIEWS = {
    patients: ddoc('by', {
      by_name:{ map:'function(doc){ if(doc.patientName) emit(doc.patientName, doc); }' },
      by_phone:{ map:'function(doc){ if(doc.contact) emit(doc.contact, doc); }' }
    }),
    bookings: ddoc('by', {
      by_date:{ map:'function(doc){ if(doc.date && doc.ts) emit([doc.date, doc.ts], doc); }' },
      by_pid:{ map:'function(doc){ if(doc.pid && doc.ts) emit([doc.pid, doc.ts], doc); }' }
    }),
    opd: ddoc('by', {
      by_date:{ map:'function(doc){ if(doc.date && doc.ts) emit([doc.date, doc.ts], doc); }' },
      by_pid:{ map:'function(doc){ if(doc.pid && doc.ts) emit([doc.pid, doc.ts], doc); }' }
    })
  };
  function genericAll(){ return ddoc('all',{ all:{ map:'function(doc){ emit(doc._id,1); }' } }); }
  async function upsertDDoc(dbname, doc){
    const get = await couch(`${dbname}/${encodeURIComponent(doc._id)}`);
    if(get.ok && get.json && get.json._rev){ doc._rev = get.json._rev; }
    const put = await couch(`${dbname}/${encodeURIComponent(doc._id)}`, { method:'PUT', body:JSON.stringify(doc) });
    return put.ok;
  }

  async function runAll(){
    if(!base) throw new Error('APP_CONFIG.couchUrl is empty');
    // create dbs
    for(const m of modules){
      const dbn = `${pre}-${m}`;
      const chk = await couch(dbn);
      if(!chk.ok){ await couch(dbn,{method:'PUT'}); }
      const doc = VIEWS[m] || genericAll();
      await upsertDDoc(dbn, doc);
    }
    return true;
  }

  return { runAll };
})();
</script>