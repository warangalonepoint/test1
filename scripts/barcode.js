// barcode.js v8.4.6 — unified camera scanner (QR + 1D) with Quagga2 fallback
// Exposes: window.BarcodeAPI.open((code)=>{...})

(function () {
  if (window.BarcodeAPI) return;

  function createModal(html) {
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:999999;display:flex;align-items:center;justify-content:center";
    host.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:12px;max-width:92vw">
        ${html}
        <div style="text-align:right;margin-top:8px">
          <button id="scanClose" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer">Close</button>
        </div>
      </div>`;
    document.body.appendChild(host);
    host.querySelector("#scanClose").onclick = () => {
      try {
        const vids = host.querySelectorAll("video");
        vids.forEach(v => v.srcObject && v.srcObject.getTracks().forEach(t => t.stop()));
      } catch {}
      try { window.Quagga && window.Quagga.stop(); } catch {}
      host.remove();
    };
    return host;
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("Failed "+src));
      document.head.appendChild(s);
    });
  }

  async function openWithBarcodeDetector(onCode) {
    const formats = ["code_128","ean_13","upc_a","upc_e","qr_code"];
    const bd = new window.BarcodeDetector({ formats });
    const ui = createModal(
      `<video id="cam" autoplay playsinline style="width:520px;max-width:90vw;border-radius:8px;background:#000"></video>`
    );
    const v = ui.querySelector("#cam");
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    v.srcObject = stream;

    const c = document.createElement("canvas");
    const g = c.getContext("2d");

    let alive = true;
    const loop = async () => {
      if (!document.body.contains(ui)) { alive = false; return; }
      if (v.readyState >= 2) {
        c.width = v.videoWidth; c.height = v.videoHeight; g.drawImage(v, 0, 0);
        try {
          const res = await bd.detect(c);
          if (res && res[0] && res[0].rawValue) onCode(res[0].rawValue);
        } catch {}
      }
      alive && requestAnimationFrame(loop);
    };
    loop();
  }

  async function openWithQuagga(onCode) {
    if (!window.Quagga) {
      await loadScript("https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.min.js");
    }
    const ui = createModal(`<div id="qwrap" style="width:520px;max-width:90vw"></div>`);
    const target = ui.querySelector("#qwrap");
    return new Promise((resolve, reject) => {
      window.Quagga.init(
        {
          inputStream: { type: "LiveStream", target, constraints: { facingMode: "environment" } },
          decoder: { readers: ["code_128_reader", "ean_reader", "upc_reader", "upc_e_reader"] },
          locate: true
        },
        (err) => {
          if (err) { alert("Camera init failed"); ui.remove(); return reject(err); }
          window.Quagga.start();
          window.Quagga.onDetected(res => {
            const code = res && res.codeResult && res.codeResult.code;
            if (code) onCode(code);
          });
          resolve();
        }
      );
    });
  }

  window.BarcodeAPI = {
    async open(onCode) {
      try {
        if ("BarcodeDetector" in window) return await openWithBarcodeDetector(onCode);
      } catch {}
      return openWithQuagga(onCode); // 1D fallback
    }
  };
})();