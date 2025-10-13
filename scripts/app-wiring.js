// Register SW + Add to Home Screen prompt
(function(){
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js?b='+(window.APP_CONFIG?.build||'1')).catch(console.error);
  }
  let deferred;
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferred = e;
    window.installPWA = () => deferred && deferred.prompt();
    try { window.dispatchEvent(new CustomEvent('pwaReady')); } catch {}
  });
})();