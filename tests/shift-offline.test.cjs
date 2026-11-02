// Run: node --test tests/shift-offline.test.cjs (no dependencies).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const app = readFileSync(new URL('../shift-schedule-duo/app.js', `file://${__filename}`), 'utf8');
const sw = readFileSync(new URL('../shift-schedule-duo/sw.js', `file://${__filename}`), 'utf8');
const scope = 'https://example.test/shift-schedule-duo/';
const workerURL = `${scope}sw.js`;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
class Target extends EventTarget {
  emit(type) { this.dispatchEvent(new Event(type)); }
}
class Worker extends Target {
  constructor(state = 'activated', reply = true) {
    super(); Object.assign(this, {state, reply, scriptURL: workerURL, messages: []});
  }
  postMessage(message, ports) {
    this.messages.push(message);
    if (this.error) throw new Error('postMessage failed');
    if (this.reply !== null) ports[0].peer.onmessage?.({data: {ready: this.reply}});
  }
}
function harness(worker = new Worker()) {
  const reg = Object.assign(new Target(), {scope, active: worker, installing: null, waiting: null});
  const timers = new Map(), channels = [], registrations = [];
  let now = 0, next = 0;
  const container = {register: (...args) => { registrations.push(args); return Promise.resolve(reg); }};
  Object.defineProperty(container, 'ready', {get() { throw new Error('TripGrid ready must never be used'); }});
  const window = Object.assign(new Target(), {location: {origin: 'https://example.test'}});
  const context = vm.createContext({window, navigator: {serviceWorker: container}, URL,
    document: {getElementById: () => null},
    setTimeout: (fn, delay) => { timers.set(++next, {fn, at: now + delay}); return next; },
    clearTimeout: id => timers.delete(id),
    MessageChannel: class {
      constructor() {
        this.port1 = {closed: false, close() { this.closed = true; }};
        this.port2 = {closed: false, close() { this.closed = true; }};
        this.port2.peer = this.port1; channels.push(this);
      }
    }});
  vm.runInContext(app, context);
  return {window, container, reg, timers, channels, registrations,
    ready: () => window.shiftFiles.offlineReady(),
    async tick(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await flush();
    }};
}
test('first check before Flutter registers only the scoped worker; first frame shares it', async () => {
  const h = harness(), result = h.ready();
  h.window.emit('flutter-first-frame');
  assert.equal(await result, true);
  assert.equal(h.registrations.length, 1);
  assert.equal(h.registrations[0][0], workerURL);
  assert.equal(h.registrations[0][1].scope, scope);
  assert.equal(h.timers.size, 0);
  assert.ok(h.channels.every(c => c.port1.closed && c.port2.closed));
});
test('installing -> activating -> activated: no message until activation completes', async () => {
  const w = new Worker('installing'), h = harness(null);
  h.reg.installing = w;
  const result = h.ready(); await flush();
  assert.equal(w.messages.length, 0);
  h.reg.installing = null; h.reg.active = w;
  w.state = 'activating'; w.emit('statechange');
  assert.equal(w.messages.length, 0);
  w.state = 'activated'; w.emit('statechange');
  assert.equal(await result, true);
  assert.equal(w.messages.length, 1);
});
test('updatefound observes a new installing worker', async () => {
  const h = harness(null), result = h.ready(); await flush();
  const w = new Worker('installing'); h.reg.installing = w; h.reg.emit('updatefound');
  h.reg.installing = null; h.reg.active = w; w.state = 'activated'; w.emit('statechange');
  assert.equal(await result, true);
});
test('an update waiting behind existing clients does not replace the active worker', async () => {
  const h = harness(); h.reg.waiting = new Worker('installed');
  assert.equal(await h.ready(), true);
  assert.equal(h.reg.waiting.messages.length, 0);
});
test('reject both an unexpected scope and unexpected worker URL', async () => {
  const h = harness(); h.reg.scope = 'https://example.test/';
  assert.equal(await h.ready(), false);
  assert.equal(h.reg.active.messages.length, 0);
  const j = harness(); j.reg.active.scriptURL = 'https://example.test/sw.js';
  assert.equal(await j.ready(), false);
  assert.equal(j.reg.active.messages.length, 0);
});
test('registration failure returns false and later calls retry', async () => {
  const h = harness(); let attempts = 0;
  h.container.register = () => ++attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(h.reg);
  assert.equal(await h.ready(), false);
  assert.equal(await h.ready(), true);
  assert.equal(attempts, 2);
});
test('failed installation becomes redundant and returns false', async () => {
  const w = new Worker('installing'), h = harness(null); h.reg.installing = w;
  const result = h.ready(); await flush();
  h.reg.installing = null; w.state = 'redundant'; w.emit('statechange');
  assert.equal(await result, false);
  assert.equal(h.timers.size, 0);
});
test('installation timeout removes listeners; late activation sends no message; retry works', async () => {
  const w = new Worker('installing'), h = harness(null); h.reg.installing = w;
  const result = h.ready(); await flush(); await h.tick(30000);
  assert.equal(await result, false);
  h.reg.installing = null; h.reg.active = w; w.state = 'activated'; w.emit('statechange');
  assert.equal(w.messages.length, 0);
  assert.equal(await h.ready(), true);
});
test('registration resolving after deadline cannot start a late query', async () => {
  const h = harness(); let resolve;
  h.container.register = () => new Promise(r => { resolve = r; });
  const result = h.ready(); await h.tick(30000);
  assert.equal(await result, false);
  resolve(h.reg); await flush();
  assert.equal(h.reg.active.messages.length, 0);
});
test('nonresponsive worker times out after 3 seconds and releases message ports', async () => {
  const h = harness(new Worker('activated', null)), result = h.ready(); await flush();
  await h.tick(2999); assert.equal(h.timers.size, 2);
  await h.tick(1); assert.equal(await result, false);
  assert.equal(h.timers.size, 0);
  assert.ok(h.channels[0].port1.closed && h.channels[0].port2.closed);
});
test('the 30-second total deadline includes the response wait', async () => {
  const w = new Worker('installing', null), h = harness(null); h.reg.installing = w;
  const result = h.ready(); await flush(); await h.tick(29000);
  h.reg.active = w; w.state = 'activated'; w.emit('statechange');
  await h.tick(1000); assert.equal(await result, false);
  assert.equal(h.timers.size, 0);
});
test('postMessage exceptions and malformed replies fail safely', async () => {
  const h = harness(); h.reg.active.error = true;
  assert.equal(await h.ready(), false);
  const j = harness(new Worker('activated', 'true'));
  assert.equal(await j.ready(), false);
  assert.equal(j.timers.size, 0);
});
test('unsupported service workers return false', async () => {
  const h = harness(); delete h.container.register;
  // The unsupported path is tested in a new context without serviceWorker.
  const window = Object.assign(new Target(), {location: {origin: 'https://example.test'}});
  vm.runInNewContext(app, {window, navigator: {}, URL});
  assert.equal(await window.shiftFiles.offlineReady(), false);
});
function workerHarness() {
  const handlers = {}, stores = new Map(); let failRead = false, failInstall = false;
  const key = req => typeof req === 'string' ? req : req.url || req.href;
  const caches = {
    async open(name) {
      if (failRead) throw new Error('storage denied');
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async addAll(requests) {
          for (const req of requests) {
            entries.set(key(req), {ok: true});
            if (failInstall) throw new Error('asset download failed');
          }
        },
        async match(req) { return entries.get(key(req)); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  const context = vm.createContext({URL, Request, caches, self: {
    registration: {scope}, clients: {claim: async () => {}},
    addEventListener: (type, handler) => handlers[type] = handler
  }});
  vm.runInContext(sw, context);
  return {stores, caches,
    cacheName: vm.runInContext('CACHE', context),
    files: vm.runInContext('FILES', context),
    set failRead(value) { failRead = value; },
    set failInstall(value) { failInstall = value; },
    async fire(type, props = {}) {
      let work;
      handlers[type]({...props, waitUntil: promise => { work = promise; }});
      await work;
    },
    async status() {
      let result;
      await this.fire('message', {data: {type: 'OFFLINE_STATUS'}, ports: [{postMessage: data => { result = data.ready; }}]});
      return result;
    }
  };
}
test('real worker status verifies every cached asset, including after eviction', async () => {
  const h = workerHarness();
  assert.equal(await h.status(), false);
  await h.fire('install');
  assert.equal(await h.status(), true);
  h.stores.get(h.cacheName).delete(`${scope}main.dart.js`);
  assert.equal(await h.status(), false);
  await h.caches.delete(h.cacheName);
  assert.equal(await h.status(), false);
});
test('storage errors fail closed and failed install removes its partial cache only', async () => {
  const h = workerHarness(); h.failRead = true;
  assert.equal(await h.status(), false);
  h.failRead = false; h.failInstall = true;
  h.stores.set('tripgrid-shell-existing', new Map([['data', 'keep']]));
  await assert.rejects(h.fire('install'), /asset download failed/);
  assert.equal(h.stores.has(h.cacheName), false);
  assert.equal(h.stores.get('tripgrid-shell-existing').get('data'), 'keep');
});
test('activation preserves TripGrid and other scopes; removes only own older cache', async () => {
  const h = workerHarness(); await h.fire('install');
  const ownOld = `shift-schedule:${scope}:old`;
  for (const name of ['tripgrid-shell-existing', 'shift-schedule:https://example.test/other/:old', ownOld]) {
    h.stores.set(name, new Map());
  }
  await h.fire('activate');
  assert.equal(h.stores.has(ownOld), false);
  assert.equal(h.stores.has(h.cacheName), true);
  assert.equal(h.stores.has('tripgrid-shell-existing'), true);
  assert.equal(h.stores.has('shift-schedule:https://example.test/other/:old'), true);
});
test('every precache entry exists in the deployed tree', () => {
  const {existsSync} = require('node:fs');
  for (const file of workerHarness().files) assert.ok(existsSync(new URL(`../shift-schedule-duo/${file}`, `file://${__filename}`)), file);
});
test('concurrent checks share registration but have independent replies and cleanup', async () => {
  const h = harness();
  assert.deepEqual(await Promise.all([h.ready(), h.ready(), h.ready()]), [true, true, true]);
  assert.equal(h.registrations.length, 1);
  assert.equal(h.reg.active.messages.length, 3);
  assert.equal(h.timers.size, 0);
});
test('TripGrid worker ignores OFFLINE_STATUS and leaves shift fetches unhandled', () => {
  const handlers = {};
  const source = readFileSync(new URL('../sw.js', `file://${__filename}`), 'utf8');
  vm.runInNewContext(source, {URL, importScripts() {}, self: {
    registration: {scope: 'https://example.test/'}, location: {origin: 'https://example.test'},
    addEventListener: (type, handler) => handlers[type] = handler
  }});
  handlers.message({data: {type: 'OFFLINE_STATUS'}, ports: [{postMessage() { assert.fail('TripGrid must not reply'); }}]});
  for (const path of ['/shift-schedule-duo', '/shift-schedule-duo/', '/shift-schedule-duo/main.dart.js']) {
    handlers.fetch({request: {method: 'GET', url: `https://example.test${path}`}, respondWith() { assert.fail(path); }});
  }
  // TripGrid's normal navigation still selects its own shell.
  let intercepted = false;
  // A fake cache avoids network while exercising the actual root fetch handler.
  // Supply it in a second context so its asynchronous response can complete.
  const root = {};
  vm.runInNewContext(source, {URL, importScripts() {}, caches: {open: async () => ({match: async () => 'tripgrid-shell'})}, self: {
    registration: {scope: 'https://example.test/'}, location: {origin: 'https://example.test'},
    addEventListener: (type, handler) => root[type] = handler
  }});
  root.fetch({request: {method: 'GET', url: 'https://example.test/', mode: 'navigate', headers: {get: () => 'text/html'}},
    respondWith(result) { intercepted = true; return result; }});
  assert.equal(intercepted, true);
});
test('scoped worker serves cached navigation offline without intercepting TripGrid', async () => {
  const handlers = {}, shell = {body: 'shift-shell'};
  vm.runInNewContext(sw, {URL, Request, caches: {open: async () => ({match: async () => shell})},
    self: {registration: {scope}, addEventListener: (type, handler) => handlers[type] = handler},
    fetch() { assert.fail('cached offline navigation must not fetch'); }});
  let response;
  handlers.fetch({request: {method: 'GET', url: scope, mode: 'navigate'}, respondWith: result => { response = result; }});
  assert.equal(await response, shell);
  handlers.fetch({request: {method: 'GET', url: 'https://example.test/', mode: 'navigate'}, respondWith() { assert.fail('root intercepted'); }});
});
