(() => {
  let deferredPrompt = null;
  const prompt = document.getElementById('installPrompt');
  const install = document.getElementById('installBtn');
  const close = document.getElementById('installClose');
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (prompt && !localStorage.getItem('cratto_install_dismissed')) prompt.hidden = false;
  });
  install?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (prompt) prompt.hidden = true;
  });
  close?.addEventListener('click', () => {
    localStorage.setItem('cratto_install_dismissed', '1');
    if (prompt) prompt.hidden = true;
  });
})();
