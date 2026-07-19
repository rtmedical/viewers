(function registerViewerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  if (['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) {
    return;
  }

  try {
    const publicUrl = new URL(window.PUBLIC_URL || '/', window.location.origin);
    if (publicUrl.origin !== window.location.origin) {
      return;
    }

    publicUrl.search = '';
    publicUrl.hash = '';
    publicUrl.pathname = `${publicUrl.pathname.replace(/\/+$/, '')}/`;
    const scope = publicUrl.pathname;
    const serviceWorkerUrl = new URL('sw.js', publicUrl);

    navigator.serviceWorker.register(serviceWorkerUrl.href, { scope }).catch(error => {
      console.warn('Unable to register the viewer service worker', error);
    });
  } catch (error) {
    console.warn('Unable to resolve the viewer service worker URL', error);
  }
})();
