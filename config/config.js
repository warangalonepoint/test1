// ========== OneStop AI · Dr. Charan Child Clinic Configuration ==========

(function(){
  // Keep existing object if present
  window.APP_CONFIG = window.APP_CONFIG || {};
  const C = window.APP_CONFIG;

  // ---------- Clinic / Doctor & Branding ----------
  C.clinicName = C.clinicName || "Dr. Charan Child Clinic";

  C.doctor = C.doctor || {
    name: "Dr. Charan Theja Reddy Gurijala",
    quals: "MBBS, DNB (Paediatrics), MNAMS, PGPN (Boston)",
    designation: "Consultant Paediatrician",
    regno: "Reg. No: 72140",
    timings: "MON–SAT: 9:00 AM – 12:00 PM & 6:00 PM – 9:00 PM · SUN: 10:00 AM – 2:00 PM"
  };

  C.branding = C.branding || {
    logo: "./assets/logo.png",
    banner: "./assets/banner.png",
    brand: "Onestop AI Clinic System"
  };

  // ---------- UI Theme ----------
  C.ui = C.ui || {
    brandColor: "#17B26A",
    pastelBg: "#f7f8fb",
    pastelCard: "#ffffff",
    pastelInk: "#0f172a",
    muted: "#64748b",
    radius: 16
  };

  // ---------- Network / APIs ----------
  // Keep for legacy code that expects this key
  C.apiBaseUrl = C.apiBaseUrl || ""; // set if/when you expose an HTTP API

  // ---------- CouchDB Connection ----------
  (function ensureCouch(){
    // WARNING: creds in frontend = visible to everyone on the LAN.
    // Fine for lab/LAN, not for public internet.
    const fallback = "http://admin:Vamshi@266@192.168.29.211:5984/";
    C.couchUrl = (C.couchUrl || fallback).replace(/\/+$/,'') + "/";
  })();

  // DB prefix for all modules
  C.dbPrefix = C.dbPrefix || "clinic";

  // ---------- Build Info ----------
  C.build   = C.build   || "v1.0.1";
  C.release = C.release || "2025-10-12";
  C.author  = C.author  || "Onestop AI Services · Warangal";

  // ---------- Default PINs ----------
  C.pins = C.pins || {
    dashboard: "1111",
    supervisor: "2222",
    frontoffice: "3333"
  };

  // ---------- App Modules ----------
  C.modules = C.modules || [
    "patients",
    "bookings",
    "opd",
    "inventory",
    "purchases",
    "returns",
    "sales",
    "gst",
    "pharmacy",
    "lab-tests",
    "lab-orders",
    "lab-reports",
    "lab-records"
  ];

  // ---------- Notes ----------
  C.notes = C.notes || {
    sync: "Uses CouchDB ↔ PouchDB live replication",
    access: "All devices on same Wi-Fi can live-sync with 192.168.29.211:5984",
    hint: "Offline-first; data auto-uploads when connection resumes."
  };

  // ---------- Health Helper ----------
  C.pingCouch = async function(timeoutMs=4000){
    const base = (C.couchUrl||"").replace(/\/+$/,'');
    const tryUrls = [`${base}/_up`, `${base}/`];
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), timeoutMs);
    try{
      for(const u of tryUrls){
        try{
          const r = await fetch(u,{signal:ctrl.signal, cache:"no-store"});
          if (r.ok) { clearTimeout(t); return {ok:true, status:r.status, url:u}; }
        }catch(_){/* next */}
      }
      clearTimeout(t);
      return { ok:false, error:"Couch not reachable" };
    }catch(e){
      return { ok:false, error:String(e) };
    }
  };

  // ---------- Virtual /config/doctor-config.json ----------
  // Works under subpaths (/onestop-demo/...), and with ?v=123 query.
  (function patchFetchForDoctorJSON(){
    if (window.__doctorJsonPatched) return;
    window.__doctorJsonPatched = true;

    const origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (!origFetch) return;

    const toJSON = () => ({
      clinicName: C.clinicName,
      doctorName: C.doctor?.name || "",
      degrees: C.doctor?.quals || "",
      designation: C.doctor?.designation || "",
      regNo: C.doctor?.regno || "",
      timings: C.doctor?.timings || "",
      brand: C.branding?.brand || "",
      logo: C.branding?.logo || "",
      banner: C.branding?.banner || ""
    });

    window.fetch = async function(resource, init){
      try{
        const u = (typeof resource === "string") ? new URL(resource, location.href)
                 : (resource?.url ? new URL(resource.url, location.href) : null);
        if (u) {
          const normalized = u.pathname.replace(/\/+$/,'');
          if (normalized.endsWith("/config/doctor-config.json")) {
            const body = JSON.stringify(toJSON());
            return new Response(body, {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          }
        }
      }catch{ /* fall through */ }
      return origFetch(resource, init);
    };
  })();

  // Don’t freeze: other modules may add keys later (e.g., runtime URLs)
  // try { Object.freeze(C); } catch {}

  window.APP_CONFIG = C; // legacy alias
})();