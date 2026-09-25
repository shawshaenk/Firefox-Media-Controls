const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
function bundle(entry, format = 'iife') {
  return buildSync({ entryPoints: [entry], bundle: true, write: false, format, platform: 'browser' }).outputFiles[0].text;
}
const validation = { exports: {} };
vm.runInNewContext(bundle('src/shared/validation.ts', 'cjs'), { module: validation, URL, Date });
const { sanitizeFrameState, safeImageUrl } = validation.exports;
const state = (playbackState = 'playing') => ({
  source: 'element', playbackState, metadata: null, position: null,
  actions: ['play', 'pause'], lastPlayedAt: Date.now(), volume: { level: 0.5, mediaMuted: false }
});

test('hostile arrays and image URLs are bounded; valid media capabilities survive', () => {
  const raw = state();
  raw.actions = ['seekto', 'nexttrack', 'previoustrack', 'setvolume', 'not-an-action'];
  raw.metadata = { title: 'x'.repeat(5000), artwork: Array(100000).fill({ src: 'https://cdn.example.com/cover.png' }) };
  const result = sanitizeFrameState(raw);
  assert.equal(result.metadata.artwork.length, 8);
  assert.equal(result.metadata.title.length, 300);
  assert.deepEqual(Array.from(result.actions), ['seekto', 'nexttrack', 'previoustrack', 'setvolume']);
  assert.equal(result.volume.level, 0.5);
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:password@example.com/a', 'https://example.com/' + 'x'.repeat(9000)]) {
    assert.equal(safeImageUrl(url), null);
  }
  assert.equal(safeImageUrl('http://localhost/cover.png'), 'http://localhost/cover.png');
  assert.equal(safeImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
});

test('floods are coalesced and the final paused state arrives; command replies bypass throttling', async () => {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const listeners = new Map();
  const sent = [];
  const down = [];
  let onCommand;
  const window = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    postMessage: (message) => down.push(message),
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, at: now + ms }); return timerId; }
  };
  const browser = { runtime: {
    sendMessage: async (message) => sent.push(message),
    onMessage: { addListener: (fn) => { onCommand = fn; } }
  } };
  const clearTimeout = (id) => timers.delete(id);
  vm.runInNewContext(bundle('src/relay.ts'), { window, browser, URL, performance: { now: () => now }, clearTimeout });
  const send = (data) => listeners.get('message')({ source: window, data });
  send({ __mcx: 'up', state: state() });
  for (let i = 0; i < 10000; i++) send({ __mcx: 'up', state: state() });
  send({ __mcx: 'up', state: state('paused') });
  assert.equal(sent.length, 1);
  const command = onCommand({ type: 'cmd', cmd: { action: 'play' } });
  send({ __mcx: 'command-result', id: down.at(-1).id, handled: true });
  assert.equal(await command, true);
  now = 100;
  for (const [id, timer] of timers) {
    if (timer.at <= now) { timers.delete(id); timer.fn(); }
  }
  assert.equal(sent.length, 2);
  assert.equal(sent[1].state.playbackState, 'paused');
  now = 200;
  send({ __mcx: 'up', state: { invalid: true } });
  assert.equal(sent.length, 2, 'invalid reports must not remove media');
  send({ __mcx: 'up', state: null });
  assert.equal(sent.at(-1).state, null);
});

test('buffering observer overrides legacy frame reports and recovers without a new media report', () => {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const listeners = new Map();
  const sent = [];
  const window = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    postMessage: () => {},
    setTimeout: (fn, ms) => { timers.set(++nextId, { fn, at: now + ms }); return nextId; }
  };
  const browser = { runtime: { sendMessage: async message => sent.push(message), onMessage: { addListener: () => {} } } };
  vm.runInNewContext(bundle('src/relay.ts'), {
    window, browser, URL, performance: { now: () => now }, clearTimeout: id => timers.delete(id)
  });
  const send = data => listeners.get('message')({ source: window, data });
  const tick = () => {
    now += 100;
    for (const [id, timer] of timers) {
      if (timer.at <= now) { timers.delete(id); timer.fn(); }
    }
  };
  send({ __mcx: 'up', state: { ...state(), buffering: false } });
  send({ __mcx: 'buffering-state', buffering: true });
  assert.equal(sent.at(-1).state.buffering, true);
  // An older hook left in an open tab keeps sending its obsolete false flag.
  send({ __mcx: 'up', state: { ...state(), buffering: false } });
  tick();
  assert.equal(sent.at(-1).state.buffering, true);
  send({ __mcx: 'buffering-state', buffering: 'false' });
  tick();
  assert.equal(sent.at(-1).state.buffering, true, 'invalid signals must be ignored');
  send({ __mcx: 'buffering-state', buffering: false });
  tick();
  assert.equal(sent.at(-1).state.buffering, false);
  send({ __mcx: 'up', state: null });
  tick();
  send({ __mcx: 'buffering-state', buffering: true });
  tick();
  assert.equal(sent.at(-1).state, null, 'observer must not resurrect a removed card');
});
