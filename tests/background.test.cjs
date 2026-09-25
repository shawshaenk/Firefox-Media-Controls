const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const extensionId = 'media-controls@example.com';
const extensionURL = 'moz-extension://test/popup.html';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function report(browser, message, sender) {
  await browser.runtime.onMessage.listeners[0](message, { ...sender, id: extensionId });
  await delay(110);
}
const { buildSync } = require('esbuild');

const code = buildSync({
  entryPoints: ['src/background.ts'], bundle: true, write: false,
  format: 'iife', platform: 'browser', target: 'firefox128'
}).outputFiles[0].text;

function event() {
  const listeners = [];
  return { listeners, addListener: (fn) => listeners.push(fn) };
}

async function start(tabs = [], localData = {}) {
  const sent = [];
  const browser = {
    storage: {
      session: { get: async () => ({}), set: async () => {} },
      local: {
        get: async () => structuredClone(localData),
        set: async (data) => Object.assign(localData, structuredClone(data)),
        remove: async (keys) => keys.forEach((key) => delete localData[key])
      }
    },
    action: Object.fromEntries(['setIcon', 'enable', 'setPopup', 'setTitle', 'setBadgeText', 'setBadgeBackgroundColor', 'setBadgeTextColor'].map(
      (key) => [key, async () => {}]
    )),
    tabs: {
      query: async () => tabs,
      get: async (id) => tabs.find((tab) => tab.id === id),
      sendMessage: async (...args) => { sent.push(args); },
      onUpdated: event(), onRemoved: event(), onCreated: event()
      // Deliberately no onReplaced: Firefox does not implement this API.
    },
    runtime: { id: extensionId, getURL: (path) => `moz-extension://test/${path}`, onMessage: event(), onConnect: event(), onInstalled: event() },
    permissions: { onAdded: event() },
    scripting: { executeScript: async () => [] }
  };
  vm.runInNewContext(code, { browser, console, URL, crypto: webcrypto, TextEncoder, performance, setTimeout, clearTimeout });
  const messages = [];
  const port = {
    name: 'popup', sender: { id: extensionId, url: extensionURL }, onMessage: event(), onDisconnect: event(),
    postMessage: (message) => messages.push(message)
  };
  assert.equal(browser.runtime.onConnect.listeners.length, 1);
  browser.runtime.onConnect.listeners[0](port);
  await port.onMessage.listeners[0]({ type: 'request-sessions' });
  return { browser, port, messages, sent };
}

test('Firefox startup connects the popup and sends an empty session list', async () => {
  const { messages } = await start();
  assert.ok(messages.length > 0);
  assert.equal(messages.at(-1).type, 'sessions');
  assert.equal(messages.at(-1).sessions.length, 0);
});

test('audible YouTube tab appears, then upgrades to controllable frame state', async () => {
  const tab = { id: 7, audible: true, title: 'YouTube video', url: 'https://www.youtube.com/watch?v=example' };
  const { browser, port, messages, sent } = await start([tab]);
  assert.equal(messages.at(-1).sessions[0].degraded, true);
  const state = {
    source: 'element', metadata: null, playbackState: 'playing',
    position: null, actions: ['play', 'pause'], isLive: false,
    seekable: false, lastPlayedAt: Date.now()
  };
  await report(browser,
    { type: 'frame-state', state }, { tab, frameId: 3 }
  );
  const session = messages.at(-1).sessions[0];
  assert.equal(session.degraded, false);
  assert.equal(session.frameId, 3);
  await port.onMessage.listeners[0]({
    type: 'cmd', tabId: 7, frameId: 3, cmd: { action: 'pause' }
  });
  const routed = sent.at(-1);
  assert.equal(routed[0], 7);
  assert.equal(routed[1].cmd.action, 'pause');
  assert.equal(routed[2].frameId, 3);
  await browser.tabs.onRemoved.listeners[0](7);
  assert.equal(messages.at(-1).sessions.length, 0);
});

test('same-video YouTube tabs each keep their own card (no dedup)', async () => {
  const tab1 = { id: 1, audible: false, title: 'Video A', url: 'https://www.youtube.com/watch?v=vid123' };
  const tab2 = { id: 2, audible: true, title: 'Video A', url: 'https://www.youtube.com/watch?v=vid123' };
  const tab3 = { id: 3, audible: false, title: 'Video B', url: 'https://www.youtube.com/watch?v=vid456' };
  const { browser, messages } = await start([tab1, tab2, tab3]);

  // Tab 1 reports paused at 0:00 for vid123
  await report(browser,
    {
      type: 'frame-state',
      state: {
        source: 'mediasession',
        metadata: { title: 'Godlike Civilization', artist: 'Kurzgesagt', album: 'YouTube', artwork: [] },
        playbackState: 'paused',
        position: { duration: 600, position: 0, playbackRate: 0, updatedAt: Date.now() },
        actions: ['play', 'pause'], isLive: false, seekable: true, lastPlayedAt: Date.now() - 5000
      }
    },
    { tab: tab1, frameId: 0 }
  );

  // Tab 2 reports playing at 25s for vid123
  await report(browser,
    {
      type: 'frame-state',
      state: {
        source: 'mediasession',
        metadata: { title: 'Godlike Civilization', artist: 'Kurzgesagt', album: 'YouTube', artwork: [] },
        playbackState: 'playing',
        position: { duration: 600, position: 25, playbackRate: 1, updatedAt: Date.now() },
        actions: ['play', 'pause'], isLive: false, seekable: true, lastPlayedAt: Date.now()
      }
    },
    { tab: tab2, frameId: 0 }
  );

  // Tab 3 reports paused at 0:00 for distinct video vid456
  await report(browser,
    {
      type: 'frame-state',
      state: {
        source: 'mediasession',
        metadata: { title: 'Fern Video', artist: 'fern', album: 'YouTube', artwork: [] },
        playbackState: 'paused',
        position: { duration: 800, position: 0, playbackRate: 0, updatedAt: Date.now() },
        actions: ['play', 'pause'], isLive: false, seekable: true, lastPlayedAt: Date.now() - 1000
      }
    },
    { tab: tab3, frameId: 0 }
  );

  const lastSessions = messages.at(-1).sessions;
  // Every open tab keeps its own card, even for the same video.
  assert.equal(lastSessions.length, 3);
  const tabIds = lastSessions.map((s) => s.tabId);
  assert.ok(tabIds.includes(1), 'Tab 1 (paused vid123) must be included');
  assert.ok(tabIds.includes(2), 'Tab 2 (playing vid123) must be included');
  assert.ok(tabIds.includes(3), 'Tab 3 (distinct video) must be included');
});

test('playBlocked flag is preserved on session state for autoplay-blocked tabs', async () => {
  const tab = { id: 10, audible: false, title: 'Blocked Video', url: 'https://www.youtube.com/watch?v=blocked123' };
  const { browser, messages } = await start([tab]);

  await report(browser,
    {
      type: 'frame-state',
      state: {
        source: 'mediasession',
        metadata: { title: 'Blocked Video', artist: 'Creator', album: 'YouTube', artwork: [] },
        playbackState: 'paused',
        position: { duration: 300, position: 0, playbackRate: 0, updatedAt: Date.now() },
        actions: ['play', 'pause'],
        isLive: false,
        seekable: true,
        lastPlayedAt: Date.now(),
        playBlocked: true
      }
    },
    { tab, frameId: 0 }
  );

  const session = messages.at(-1).sessions.find((s) => s.tabId === 10);
  assert.ok(session, 'Session must exist');
  assert.equal(session.state?.playBlocked, true, 'playBlocked must be true on session state');
});


test('migrates full URLs and preserves distinct query URLs and pinned order across restarts', async () => {
  const a = 'https://example.com/player?token=secret-a';
  const b = 'https://example.com/player?token=secret-b';
  const local = { customOrderUrls: [b, a], pinnedUrls: [a, b], pinnedOrderMigrated: true };
  const { port, messages } = await start([
    { id: 1, audible: true, url: a }, { id: 2, audible: true, url: b }
  ], local);
  assert.deepEqual(Array.from(messages.at(-1).sessions, (s) => s.tabId), [1, 2]);
  await port.onMessage.listeners[0]({ type: 'reorder', tabIds: [2, 1] });
  assert.equal(local.customOrderUrls, undefined);
  assert.equal(local.pinnedUrls, undefined);
  assert.ok(!JSON.stringify(local).includes('secret-'));
  assert.notEqual(local.customOrderKeys[0], local.customOrderKeys[1]);
  const restarted = await start([
    { id: 30, audible: true, url: a }, { id: 40, audible: true, url: b }
  ], local);
  assert.deepEqual(Array.from(restarted.messages.at(-1).sessions, (s) => s.tabId), [40, 30]);
  assert.ok(restarted.messages.at(-1).sessions.every((s) => s.pinned));
});

test('content script cannot impersonate a popup or control a different tab through state messages', async () => {
  const { browser, messages } = await start([{ id: 1, audible: true, url: 'https://example.com/' }]);
  const hostilePort = {
    name: 'popup', sender: { id: extensionId, url: 'https://example.com/', tab: { id: 1 } },
    onMessage: event(), onDisconnect: event(), postMessage: () => assert.fail('data leaked to page port')
  };
  browser.runtime.onConnect.listeners[0](hostilePort);
  assert.equal(hostilePort.onMessage.listeners.length, 0);
  const before = messages.length;
  await browser.runtime.onMessage.listeners[0]({ type: 'frame-state', state: {} }, { id: 'other', tab: { id: 99 } });
  assert.equal(messages.length, before);
});

test('rapid pause/play commands stay immediate and ordered, and seek/volume/track commands remain routable', async () => {
  const { browser, port } = await start([{ id: 1, audible: true, url: 'https://example.com/player' }]);
  const actions = [];
  browser.tabs.sendMessage = async (tab, message, options) => {
    assert.equal(tab, 1);
    assert.equal(options.frameId, 4);
    actions.push(message.cmd.action);
    if (message.cmd.action === 'pause') await delay(20);
    return true;
  };
  const send = (cmd) => port.onMessage.listeners[0]({ type: 'cmd', tabId: 1, frameId: 4, cmd });
  await Promise.all([send({ action: 'pause' }), send({ action: 'play' })]);
  for (const cmd of [
    { action: 'seekto', seekTime: 125 }, { action: 'setvolume', volume: 0.4 },
    { action: 'seekbackward' }, { action: 'seekforward' },
    { action: 'nexttrack' }, { action: 'previoustrack' }
  ]) await send(cmd);
  assert.deepEqual(actions, ['pause', 'play', 'seekto', 'setvolume', 'seekbackward', 'seekforward', 'nexttrack', 'previoustrack']);
});

test('pin follows navigation and restores after a restart without storing the new URL', async () => {
  const oldURL = 'https://example.com/media?token=old-secret';
  const newURL = 'https://example.com/media?token=new-secret';
  const local = {};
  const { browser, port } = await start([{ id: 3, audible: true, url: oldURL }], local);
  await port.onMessage.listeners[0]({ type: 'pin', tabId: 3, pinned: true });
  const oldKey = local.pinnedKeys[0];
  await browser.tabs.onUpdated.listeners[0](3, { url: newURL }, { id: 3, audible: true, url: newURL });
  assert.notEqual(local.pinnedKeys[0], oldKey);
  assert.ok(!JSON.stringify(local).includes('secret'));
  const restarted = await start([{ id: 90, audible: true, url: newURL }], local);
  assert.equal(restarted.messages.at(-1).sessions[0].pinned, true);
});
