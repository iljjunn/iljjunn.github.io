"use strict";

// Coordinates are relative to the safe-area host, in CSS pixels, not hardware pixels.
window.shiftViewport = {
  read() {
    const segments = window.viewport?.segments;
    if (!segments || segments.length !== 2) return [];
    const host = document.getElementById('flutter-host').getBoundingClientRect();
    const [a, b] = [...segments].sort((a, b) => a.top - b.top || a.left - b.left);
    let x, y, width, height;
    if (a.right <= b.left && a.top === b.top && a.bottom === b.bottom) {
      x = a.right - host.left; y = 0;
      width = b.left - a.right; height = host.height;
      if (x <= 0 || x + width >= host.width) return [];
    } else if (a.bottom <= b.top && a.left === b.left && a.right === b.right) {
      x = 0; y = a.bottom - host.top;
      width = host.width; height = b.top - a.bottom;
      if (y <= 0 || y + height >= host.height) return [];
    } else {
      return [];
    }
    return [x, y, width, height];
  },
  listen(callback) {
    window.addEventListener('resize', callback);
    navigator.devicePosture?.addEventListener('change', callback);
  },
  unlisten(callback) {
    window.removeEventListener('resize', callback);
    navigator.devicePosture?.removeEventListener('change', callback);
  }
};

// Opt-in local diagnostics; never reads or exports schedule data.
window.shiftViewport.report = function (values) {
  if (window.shiftViewportDiagnostics) {
    window.shiftViewportDiagnostics.flutter = Array.from(values);
    window.dispatchEvent(new Event('shift-viewport-metrics'));
  }
};
if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('viewportDiagnostics') === '1') {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.append(probe);
  const percent = document.createElement('div');
  percent.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:100%;height:0';
  const vw = percent.cloneNode(); vw.style.width = '100vw';
  const dvw = percent.cloneNode(); dvw.style.width = '100dvw';
  document.body.append(percent, vw, dvw);
  const panel = document.createElement('details');
  panel.open = true;
  panel.style.cssText = 'position:fixed;z-index:2147483647;left:max(12px,env(safe-area-inset-left,0px));top:max(12px,env(safe-area-inset-top,0px));max-width:calc(100% - 24px);width:460px;max-height:80%;overflow:auto;background:#fff;color:#111;border:1px solid #888;border-radius:8px;padding:8px;box-sizing:border-box;font:12px/1.4 monospace';
  const title = document.createElement('summary'); title.textContent = '화면 진단 (눌러 접기)';
  const output = document.createElement('pre'); output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0';
  panel.append(title, output); document.body.append(panel);
  let revision = 0;
  const state = window.shiftViewportDiagnostics = {flutter: null, snapshot: null};
  const rect = el => { const r = el?.getBoundingClientRect(); return r ? {x:r.x,y:r.y,width:r.width,height:r.height} : null; };
  function update() {
    const css = getComputedStyle(probe);
    state.snapshot = {
      revision: ++revision,
      statusBar: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content,
      standalone: matchMedia('(display-mode: standalone)').matches,
      navigatorStandalone: navigator.standalone === true,
      inner: [innerWidth, innerHeight], outer: [outerWidth, outerHeight],
      screen: [screen.width, screen.height],
      document: [document.documentElement.clientWidth, document.documentElement.clientHeight],
      visual: visualViewport ? [visualViewport.width, visualViewport.height, visualViewport.offsetLeft, visualViewport.offsetTop, visualViewport.scale] : null,
      cssWidths: {'100%':rect(percent).width,'100vw':rect(vw).width,'100dvw':rect(dvw).width},
      safeTRBL: [css.paddingTop,css.paddingRight,css.paddingBottom,css.paddingLeft],
      host: rect(document.getElementById('flutter-host')),
      flutterSizePaddingTRBLViewInsetsTRBL: state.flutter,
    };
    output.textContent = Object.entries(state.snapshot).map(([key, value]) => key + ': ' + JSON.stringify(value)).join('\n');
  }
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  window.addEventListener('shift-viewport-metrics', update);
  window.addEventListener('pageshow', update);
  visualViewport?.addEventListener('resize', update);
  visualViewport?.addEventListener('scroll', update);
  navigator.devicePosture?.addEventListener('change', update);
  matchMedia('(display-mode: standalone)').addEventListener('change', update);
  new ResizeObserver(update).observe(document.getElementById('flutter-host'));
  update();
}
