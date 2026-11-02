'use strict';

window.shiftFiles = {
  async offlineReady() {
    if (!('serviceWorker' in navigator)) return false;
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const finish = ready => {
        clearTimeout(timeout);
        channel.port1.close();
        resolve(ready === true);
      };
      const timeout = setTimeout(() => finish(false), 30000);
      channel.port1.onmessage = event => finish(event.data?.ready);
      navigator.serviceWorker.ready.then(registration => {
        // A live worker alone does not prove its offline files still exist.
        if (!registration.active) return finish(false);
        registration.active.postMessage({type: 'OFFLINE_STATUS'}, [channel.port2]);
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
    navigator.serviceWorker.register('sw.js').catch(() => {
      // The app remains usable online when storage or service workers are disabled.
    });
  }
});
