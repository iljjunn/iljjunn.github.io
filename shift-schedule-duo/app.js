'use strict';

// Never use ServiceWorkerContainer.ready: it can already be resolved to TripGrid.
const shiftScope = new URL('/shift-schedule-duo/', window.location.origin).href;
const shiftWorkerURL = new URL('sw.js', shiftScope).href;
let shiftRegistration;

function registerShiftWorker() {
  if (!shiftRegistration) {
    shiftRegistration = navigator.serviceWorker.register(shiftWorkerURL, {scope: shiftScope})
      .catch(error => {
        shiftRegistration = null; // Allow a later status check to retry a failed registration.
        throw error;
      });
  }
  return shiftRegistration;
}

window.shiftFiles = {
  async offlineReady() {
    if (!('serviceWorker' in navigator)) return false;
    return new Promise(resolve => {
      let done = false;
      let registration;
      let channel;
      let responseTimeout;
      let checking = false;
      const workers = new Set();
      const finish = ready => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        clearTimeout(responseTimeout);
        registration?.removeEventListener('updatefound', check);
        for (const worker of workers) worker.removeEventListener('statechange', check);
        channel?.port1.close();
        channel?.port2.close();
        resolve(ready === true);
      };
      const check = () => {
        if (done || checking) return;
        for (const worker of [registration.installing, registration.waiting, registration.active]) {
          if (worker && !workers.has(worker)) {
            workers.add(worker);
            worker.addEventListener('statechange', check);
          }
        }
        const worker = registration.active;
        if (workers.size && [...workers].every(candidate => candidate.state === 'redundant')) {
          return finish(false);
        }
        // active may still be activating. Wait for install and activate waitUntil work.
        if (worker?.state !== 'activated') return;
        if (worker.scriptURL !== shiftWorkerURL) return finish(false);
        checking = true;
        try {
          channel = new MessageChannel();
          responseTimeout = setTimeout(() => finish(false), 3000);
          channel.port1.onmessage = event => finish(event.data?.ready);
          channel.port1.onmessageerror = () => finish(false);
          // Query the exact registration, even if the page's controller is still TripGrid.
          worker.postMessage({type: 'OFFLINE_STATUS'}, [channel.port2]);
        } catch (_) { finish(false); }
      };
      // One bound covers registration, installation, activation and the status reply.
      const timeout = setTimeout(() => finish(false), 30000);
      registerShiftWorker().then(result => {
        if (done) return;
        if (result.scope !== shiftScope) return finish(false);
        registration = result;
        registration.addEventListener('updatefound', check);
        check();
      }).catch(() => finish(false));
    });
  },
  download(name, text) {
    const url = URL.createObjectURL(new Blob([text], {type: 'application/json;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  pickBackup() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.hidden = true;
      document.body.append(input);
      input.addEventListener('cancel', () => { input.remove(); resolve(null); }, {once: true});
      input.addEventListener('change', async () => {
        const file = input.files[0];
        input.remove();
        if (!file) return resolve(null);
        if (file.size > 10 * 1024 * 1024) return reject(new Error('10MB 이하의 백업 파일을 선택하세요.'));
        try { resolve(await file.text()); } catch (error) { reject(error); }
      }, {once: true});
      input.click();
    });
  }
};

window.addEventListener('flutter-first-frame', () => {
  document.getElementById('loading')?.remove();
  if ('serviceWorker' in navigator) {
    registerShiftWorker().catch(() => {
      // The app remains usable online when storage or service workers are disabled.
    });
  }
});
