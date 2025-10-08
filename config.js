<script>
// ---------- Global App Config ----------
window.APP_CONFIG = window.APP_CONFIG || {};
APP_CONFIG.doctor = {
  name: "Dr. Charan Thier Reddy Gurijala",
  quals: "MBBS, DNB (Paediatrics), MNAMS, PGPN (Boston)",
  regno: "Reg. No: 72140",
  timings: "MON–SAT: 9:00AM–12:00PM & 6:00PM–9:00PM · SUN: 10:00AM–2:00PM"
};  branding: {
    logo: "./assets/logo.png",      // put your PNG here
    banner: "./assets/banner.png"   // put your banner here
  },
  ui: {
    brandColor: "#17B26A",
    // Soft pastels
    pastelBg: "#f7f8fb",
    pastelCard: "#ffffff",
    pastelInk: "#0f172a",
    muted: "#64748b",
    radius: 16
  },
  // Optional remote CouchDB for sync (leave blank to run fully local/offline)
  couchUrl: "", // e.g. "https://USER:PASS@your-host/couch"
  trial: {
    enabled: false,
    days: 3,
    overrideLock: true
  },
  // Build/version for cache busting
  build: "v1.0.0"
};
</script>