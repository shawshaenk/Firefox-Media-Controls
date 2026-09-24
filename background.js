"use strict";
(() => {
  // src/background.ts
  var registry = /* @__PURE__ */ new Map();
  var tabsInfo = /* @__PURE__ */ new Map();
  var connectedPopupPorts = /* @__PURE__ */ new Set();
  var lastOrderedTabIds = [];
  var customTabOrder = [];
  var customOrderUrls = [];
  var pinnedTabIds = /* @__PURE__ */ new Set();
  var pinnedUrls = [];
  var openTabIds = /* @__PURE__ */ new Set();
  var playbackCommandQueues = /* @__PURE__ */ new Map();
  var youtubeVideoHistory = /* @__PURE__ */ new Map();
  var youtubeBackTargets = /* @__PURE__ */ new Map();
  function youtubeWatchVideoId(urlStr) {
    try {
      if (!urlStr) return null;
      const url = new URL(urlStr);
      if (!/(^|\.)youtube\.com$/.test(url.hostname) || url.pathname !== "/watch") return null;
      const id = url.searchParams.get("v");
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    } catch (_) {
      return null;
    }
  }
  function recordYouTubeNavigation(tabId, previousUrl, nextUrl) {
    if (!previousUrl || !nextUrl || previousUrl === nextUrl) return;
    const oldId = youtubeWatchVideoId(previousUrl);
    const newId = youtubeWatchVideoId(nextUrl);
    const backTarget = youtubeBackTargets.get(tabId);
    if (backTarget && newId === youtubeWatchVideoId(backTarget)) {
      youtubeBackTargets.delete(tabId);
    } else if (oldId && newId && oldId !== newId) {
      const history = youtubeVideoHistory.get(tabId) || [];
      history.push(previousUrl);
      youtubeVideoHistory.set(tabId, history.slice(-50));
      youtubeBackTargets.delete(tabId);
    } else if (!newId) {
      youtubeVideoHistory.delete(tabId);
      youtubeBackTargets.delete(tabId);
    }
  }
  function getHostname(urlStr) {
    if (!urlStr) return "";
    try {
      const url = new URL(urlStr);
      return url.hostname;
    } catch (_) {
      return "";
    }
  }
  function isYouTubeWatchUrl(urlStr) {
    if (!urlStr) return false;
    try {
      const u = new URL(urlStr);
      if (!u.hostname.includes("youtube.com") && !u.hostname.includes("youtu.be")) return false;
      return u.pathname.includes("/watch") || u.pathname.startsWith("/shorts") || u.pathname.startsWith("/live");
    } catch (_) {
      return false;
    }
  }
  async function persistState() {
    try {
      const serializedRegistry = {};
      for (const [tabId, frameMap] of registry.entries()) {
        serializedRegistry[String(tabId)] = {};
        for (const [frameId, state] of frameMap.entries()) {
          serializedRegistry[String(tabId)][String(frameId)] = state;
        }
      }
      const serializedTabs = {};
      for (const [tabId, info] of tabsInfo.entries()) {
        serializedTabs[String(tabId)] = info;
      }
      await browser.storage.session.set({
        registry: serializedRegistry,
        tabsInfo: serializedTabs,
        lastOrderedTabIds,
        customTabOrder,
        pinnedTabIds: Array.from(pinnedTabIds),
        youtubeVideoHistory: Object.fromEntries(youtubeVideoHistory)
      });
    } catch (err) {
      console.warn("[MediaControls Background] Failed to persist state:", err);
    }
  }
  async function restoreState() {
    try {
      const [data, savedOrder] = await Promise.all([
        browser.storage.session.get([
          "registry",
          "tabsInfo",
          "lastOrderedTabIds",
          "customTabOrder",
          "pinnedTabIds",
          "youtubeVideoHistory"
        ]),
        browser.storage.local.get(["customOrderUrls", "pinnedUrls"])
      ]);
      if (data.registry && typeof data.registry === "object") {
        registry.clear();
        for (const [tabIdStr, frameMapObj] of Object.entries(data.registry)) {
          const tabId = Number(tabIdStr);
          const frameMap = /* @__PURE__ */ new Map();
          for (const [frameIdStr, state] of Object.entries(frameMapObj)) {
            frameMap.set(Number(frameIdStr), state);
          }
          registry.set(tabId, frameMap);
        }
      }
      if (data.tabsInfo && typeof data.tabsInfo === "object") {
        tabsInfo.clear();
        for (const [tabIdStr, info] of Object.entries(data.tabsInfo)) {
          tabsInfo.set(Number(tabIdStr), info);
        }
      }
      if (Array.isArray(data.lastOrderedTabIds)) {
        lastOrderedTabIds = data.lastOrderedTabIds;
      }
      if (Array.isArray(data.customTabOrder)) {
        customTabOrder = data.customTabOrder;
      }
      if (Array.isArray(savedOrder.customOrderUrls)) {
        customOrderUrls = savedOrder.customOrderUrls.filter(
          (url) => typeof url === "string" && url.length > 0
        );
      }
      if (Array.isArray(data.pinnedTabIds)) {
        for (const tabId of data.pinnedTabIds) {
          if (typeof tabId === "number") pinnedTabIds.add(tabId);
        }
      }
      if (data.youtubeVideoHistory && typeof data.youtubeVideoHistory === "object") {
        for (const [tabId, urls] of Object.entries(data.youtubeVideoHistory)) {
          if (Array.isArray(urls)) {
            youtubeVideoHistory.set(Number(tabId), urls.filter(
              (url) => typeof url === "string" && Boolean(youtubeWatchVideoId(url))
            ).slice(-50));
          }
        }
      }
      if (Array.isArray(savedOrder.pinnedUrls)) {
        pinnedUrls = savedOrder.pinnedUrls.filter(
          (url) => typeof url === "string" && url.length > 0
        );
      }
    } catch (err) {
      console.warn("[MediaControls Background] Failed to restore state:", err);
    }
  }
  var RETENTION_MS = 60 * 60 * 1e3;
  function resolveSessions() {
    const now = Date.now();
    const sessionsMap = /* @__PURE__ */ new Map();
    for (const [tabId, frameMap] of registry.entries()) {
      if (openTabIds.size > 0 && !openTabIds.has(tabId)) {
        registry.delete(tabId);
        continue;
      }
      const tab = tabsInfo.get(tabId);
      let chosenFrameId = 0;
      let chosenState = null;
      let bestPlayingMediaSession = null;
      let bestPlayingElement = null;
      let bestPausedMediaSession = null;
      let bestPausedElement = null;
      let bestWebAudio = null;
      for (const [frameId, state] of frameMap.entries()) {
        if (!state) continue;
        if (state.source === "mediasession" && state.playbackState === "playing") {
          if (!bestPlayingMediaSession || state.lastPlayedAt > bestPlayingMediaSession.state.lastPlayedAt) {
            bestPlayingMediaSession = { frameId, state };
          }
        } else if (state.source === "element" && state.playbackState === "playing") {
          if (!bestPlayingElement || state.lastPlayedAt > bestPlayingElement.state.lastPlayedAt) {
            bestPlayingElement = { frameId, state };
          }
        } else if (state.source === "mediasession" && state.playbackState === "paused") {
          if (!bestPausedMediaSession || state.lastPlayedAt > bestPausedMediaSession.state.lastPlayedAt) {
            bestPausedMediaSession = { frameId, state };
          }
        } else if (state.playbackState === "paused") {
          if (!bestPausedElement || state.lastPlayedAt > bestPausedElement.state.lastPlayedAt) {
            bestPausedElement = { frameId, state };
          }
        } else if (state.source === "webaudio") {
          if (!bestWebAudio || state.lastPlayedAt > bestWebAudio.state.lastPlayedAt) {
            bestWebAudio = { frameId, state };
          }
        }
      }
      const candidate = bestPlayingMediaSession || bestPlayingElement || bestPausedMediaSession || bestPausedElement || bestWebAudio;
      if (candidate) {
        chosenFrameId = candidate.frameId;
        chosenState = candidate.state;
        if (chosenState.playbackState === "paused" && now - chosenState.lastPlayedAt > RETENTION_MS) {
          frameMap.delete(chosenFrameId);
          continue;
        }
        const isYt = tab?.url && (tab.url.includes("youtube.com") || tab.url.includes("youtu.be")) || chosenState.metadata?.album === "YouTube";
        if (isYt) {
          const isWatch = isYouTubeWatchUrl(tab?.url);
          const isAudibleOrPlaying = Boolean(tab?.audible) || chosenState.playbackState === "playing";
          if (!isWatch && !isAudibleOrPlaying) {
            frameMap.delete(chosenFrameId);
            continue;
          }
        }
        const history = youtubeVideoHistory.get(tabId);
        const isOrdinaryYouTubeWatch = youtubeWatchVideoId(tab?.url) && !new URL(tab.url).searchParams.has("list");
        const state = isOrdinaryYouTubeWatch ? {
          ...chosenState,
          actions: history?.length ? Array.from(/* @__PURE__ */ new Set([...chosenState.actions, "previoustrack"])) : chosenState.actions.filter((action) => action !== "previoustrack")
        } : chosenState;
        sessionsMap.set(tabId, {
          tabId,
          frameId: chosenFrameId,
          hostname: getHostname(tab?.url),
          favIconUrl: tab?.favIconUrl || "",
          tabTitle: tab?.title || chosenState.metadata?.title || "Audio",
          state,
          audible: Boolean(tab?.audible),
          muted: Boolean(tab?.muted),
          degraded: false,
          pinned: false
        });
      }
    }
    for (const [tabId, tab] of tabsInfo.entries()) {
      if (openTabIds.size > 0 && !openTabIds.has(tabId)) {
        tabsInfo.delete(tabId);
        continue;
      }
      if (tab.audible && !sessionsMap.has(tabId)) {
        sessionsMap.set(tabId, {
          tabId,
          frameId: 0,
          hostname: getHostname(tab.url),
          favIconUrl: tab.favIconUrl || "",
          tabTitle: tab.title || "Audible tab",
          state: null,
          audible: true,
          muted: Boolean(tab.muted),
          degraded: true,
          pinned: false
        });
      }
    }
    const rawList = Array.from(sessionsMap.values());
    const availablePinnedUrls = [...pinnedUrls];
    for (const session of rawList) {
      if (pinnedTabIds.has(session.tabId)) {
        session.pinned = true;
        const urlIndex = availablePinnedUrls.indexOf(tabsInfo.get(session.tabId)?.url || "");
        if (urlIndex >= 0) availablePinnedUrls.splice(urlIndex, 1);
      }
    }
    for (const session of rawList) {
      if (session.pinned) continue;
      const urlIndex = availablePinnedUrls.indexOf(tabsInfo.get(session.tabId)?.url || "");
      if (urlIndex >= 0) {
        session.pinned = true;
        pinnedTabIds.add(session.tabId);
        availablePinnedUrls.splice(urlIndex, 1);
      }
    }
    const pinnedFirst = (ordered) => {
      const result = [
        ...ordered.filter((session) => session.pinned),
        ...ordered.filter((session) => !session.pinned)
      ];
      lastOrderedTabIds = result.map((session) => session.tabId);
      return result;
    };
    if (connectedPopupPorts.size > 0 && lastOrderedTabIds.length > 0) {
      const existingSessions = [];
      const newSessions = [];
      const byId = new Map(rawList.map((s) => [s.tabId, s]));
      for (const tabId of lastOrderedTabIds) {
        const s = byId.get(tabId);
        if (s) {
          existingSessions.push(s);
          byId.delete(tabId);
        }
      }
      for (const s of byId.values()) {
        newSessions.push(s);
      }
      newSessions.sort((a, b) => {
        const timeA = a.state?.lastPlayedAt ?? 0;
        const timeB = b.state?.lastPlayedAt ?? 0;
        return timeB - timeA;
      });
      const combined = [...newSessions, ...existingSessions];
      return pinnedFirst(combined);
    }
    if (customTabOrder.length > 0 || customOrderUrls.length > 0) {
      const existingSessions = [];
      const newSessions = [];
      const byId = new Map(rawList.map((s) => [s.tabId, s]));
      for (const tabId of customTabOrder) {
        const s = byId.get(tabId);
        if (s) {
          existingSessions.push(s);
          byId.delete(tabId);
        }
      }
      for (const url of customOrderUrls) {
        const s = Array.from(byId.values()).find(
          (candidate) => tabsInfo.get(candidate.tabId)?.url === url
        );
        if (s) {
          existingSessions.push(s);
          byId.delete(s.tabId);
        }
      }
      for (const s of byId.values()) {
        newSessions.push(s);
      }
      newSessions.sort((a, b) => {
        const timeA = a.state?.lastPlayedAt ?? 0;
        const timeB = b.state?.lastPlayedAt ?? 0;
        return timeB - timeA;
      });
      const combined = [...newSessions, ...existingSessions];
      return pinnedFirst(combined);
    }
    rawList.sort((a, b) => {
      const timeA = a.state?.lastPlayedAt ?? 0;
      const timeB = b.state?.lastPlayedAt ?? 0;
      return timeB - timeA;
    });
    return pinnedFirst(rawList);
  }
  function updateToolbarAction(sessions) {
    const hasActiveSessions = sessions.length > 0;
    const trackedTabCount = sessions.length;
    const iconPrefix = hasActiveSessions ? "icons/active" : "icons/idle";
    browser.action.setIcon({
      path: {
        "16": `${iconPrefix}-16.png`,
        "32": `${iconPrefix}-32.png`,
        "48": `${iconPrefix}-48.png`
      }
    }).catch(() => {
    });
    browser.action.setBadgeBackgroundColor({ color: "#5F6368" }).catch(() => {
    });
    browser.action.setBadgeText({
      text: trackedTabCount > 0 ? String(trackedTabCount) : ""
    }).catch(() => {
    });
    browser.action.enable().catch(() => {
    });
    browser.action.setTitle({
      title: hasActiveSessions ? "Media controls" : "No media playing"
    }).catch(() => {
    });
  }
  function broadcastSessions() {
    const sessions = resolveSessions();
    updateToolbarAction(sessions);
    const msg = {
      type: "sessions",
      sessions
    };
    for (const port of connectedPopupPorts) {
      try {
        port.postMessage(msg);
      } catch (_) {
        connectedPopupPorts.delete(port);
      }
    }
  }
  async function injectScriptsIntoTab(tabId) {
    try {
      const tab = await browser.tabs.get(tabId);
      if (!tab.url || !tab.url.startsWith("http://") && !tab.url.startsWith("https://")) {
        return;
      }
      await browser.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["page-hook.js"],
        world: "MAIN"
      }).catch(() => {
      });
      await browser.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["relay.js"]
      }).catch(() => {
      });
      browser.tabs.sendMessage(tabId, { type: "query-state" }).catch(() => {
      });
    } catch (_) {
    }
  }
  async function refreshTabsAndInject() {
    try {
      const tabs = await browser.tabs.query({});
      const currentOpenIds = /* @__PURE__ */ new Set();
      for (const tab of tabs) {
        if (typeof tab.id === "number") {
          currentOpenIds.add(tab.id);
        }
      }
      openTabIds = currentOpenIds;
      for (const tabId of Array.from(registry.keys())) {
        if (!currentOpenIds.has(tabId)) {
          registry.delete(tabId);
        }
      }
      for (const tabId of Array.from(tabsInfo.keys())) {
        if (!currentOpenIds.has(tabId)) {
          tabsInfo.delete(tabId);
        }
      }
      lastOrderedTabIds = lastOrderedTabIds.filter((id) => currentOpenIds.has(id));
      customTabOrder = customTabOrder.filter((id) => currentOpenIds.has(id));
      for (const tabId of pinnedTabIds) {
        if (!currentOpenIds.has(tabId)) pinnedTabIds.delete(tabId);
      }
      for (const tab of tabs) {
        if (!tab.id) continue;
        const current = tabsInfo.get(tab.id) || {
          audible: false,
          muted: false,
          title: "",
          favIconUrl: "",
          url: ""
        };
        recordYouTubeNavigation(tab.id, current.url, tab.url);
        tabsInfo.set(tab.id, {
          audible: Boolean(tab.audible),
          muted: Boolean(tab.mutedInfo?.muted),
          title: tab.title || current.title,
          favIconUrl: tab.favIconUrl || current.favIconUrl,
          url: tab.url || current.url
        });
        const hasFrames = registry.has(tab.id) && (registry.get(tab.id)?.size ?? 0) > 0;
        if (tab.audible && !hasFrames) {
          void injectScriptsIntoTab(tab.id);
        }
        browser.tabs.sendMessage(tab.id, { type: "query-state" }).catch(() => {
        });
      }
      void persistState();
      broadcastSessions();
    } catch (err) {
      console.warn("[MediaControls Background] refreshTabsAndInject error:", err);
    }
  }
  var readyPromise = (async () => {
    await restoreState();
    await refreshTabsAndInject();
    const sessions = resolveSessions();
    updateToolbarAction(sessions);
  })();
  browser.runtime.onMessage.addListener(
    async (message, sender) => {
      await readyPromise;
      if (message && message.type === "frame-state") {
        const tabId = sender.tab?.id;
        const frameId = sender.frameId ?? 0;
        if (!tabId) return;
        if (!registry.has(tabId)) {
          registry.set(tabId, /* @__PURE__ */ new Map());
        }
        const frameMap = registry.get(tabId);
        if (message.state === null) {
          frameMap.delete(frameId);
          if (frameMap.size === 0) {
            registry.delete(tabId);
          }
        } else {
          frameMap.set(frameId, message.state);
        }
        if (sender.tab) {
          const current = tabsInfo.get(tabId) || {
            audible: false,
            muted: false,
            title: "",
            favIconUrl: "",
            url: ""
          };
          recordYouTubeNavigation(tabId, current.url, sender.tab.url);
          tabsInfo.set(tabId, {
            ...current,
            audible: sender.tab.audible ?? current.audible,
            muted: sender.tab.mutedInfo?.muted ?? current.muted,
            title: sender.tab.title ?? current.title,
            favIconUrl: sender.tab.favIconUrl ?? current.favIconUrl,
            url: sender.tab.url ?? current.url
          });
        }
        persistState();
        broadcastSessions();
      }
    }
  );
  browser.tabs.onCreated.addListener((tab) => {
    if (typeof tab.id === "number") {
      openTabIds.add(tab.id);
    }
  });
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    await readyPromise;
    openTabIds.add(tabId);
    if (changeInfo.status === "loading" && changeInfo.url) {
      registry.delete(tabId);
    }
    const newUrl = changeInfo.url || tab.url;
    const prevUrl = tabsInfo.get(tabId)?.url;
    recordYouTubeNavigation(tabId, prevUrl, newUrl);
    if (prevUrl && newUrl && prevUrl !== newUrl) {
      try {
        const oldU = new URL(prevUrl);
        const newU = new URL(newUrl);
        if (oldU.pathname !== newU.pathname || oldU.searchParams.get("v") !== newU.searchParams.get("v")) {
          registry.delete(tabId);
        }
      } catch (_) {
        registry.delete(tabId);
      }
    }
    const current = tabsInfo.get(tabId) || {
      audible: false,
      muted: false,
      title: "",
      favIconUrl: "",
      url: ""
    };
    if (pinnedTabIds.has(tabId) && prevUrl && newUrl && prevUrl !== newUrl) {
      const urlIndex = pinnedUrls.indexOf(prevUrl);
      if (urlIndex >= 0) {
        pinnedUrls[urlIndex] = newUrl;
        browser.storage.local.set({ pinnedUrls }).catch(() => {
        });
      }
    }
    const isAudible = changeInfo.audible ?? tab.audible ?? current.audible;
    tabsInfo.set(tabId, {
      audible: isAudible,
      muted: changeInfo.mutedInfo?.muted ?? tab.mutedInfo?.muted ?? current.muted,
      title: changeInfo.title ?? tab.title ?? current.title,
      favIconUrl: changeInfo.favIconUrl ?? tab.favIconUrl ?? current.favIconUrl,
      url: changeInfo.url ?? tab.url ?? current.url
    });
    if (changeInfo.status === "complete" || changeInfo.audible === true || changeInfo.url) {
      const hasFrames = registry.has(tabId) && (registry.get(tabId)?.size ?? 0) > 0;
      if (!hasFrames) {
        void injectScriptsIntoTab(tabId);
      }
      browser.tabs.sendMessage(tabId, { type: "query-state" }).catch(() => {
      });
    }
    persistState();
    broadcastSessions();
  });
  browser.tabs.onRemoved.addListener(async (tabId) => {
    await readyPromise;
    openTabIds.delete(tabId);
    registry.delete(tabId);
    tabsInfo.delete(tabId);
    lastOrderedTabIds = lastOrderedTabIds.filter((id) => id !== tabId);
    customTabOrder = customTabOrder.filter((id) => id !== tabId);
    pinnedTabIds.delete(tabId);
    youtubeVideoHistory.delete(tabId);
    youtubeBackTargets.delete(tabId);
    persistState();
    broadcastSessions();
  });
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === "popup") {
      connectedPopupPorts.add(port);
      void readyPromise.then(() => {
        port.postMessage({ type: "sessions", sessions: resolveSessions() });
        void refreshTabsAndInject();
      }).catch((err) => {
        console.warn("[MediaControls Background] Popup startup failed:", err);
        port.postMessage({ type: "sessions", sessions: resolveSessions() });
      });
      port.onMessage.addListener(async (rawMsg) => {
        await readyPromise;
        const msg = rawMsg;
        if (msg.type === "cmd") {
          if (msg.cmd.action === "previoustrack") {
            const currentUrl = tabsInfo.get(msg.tabId)?.url;
            const history = youtubeVideoHistory.get(msg.tabId);
            if (youtubeWatchVideoId(currentUrl) && !new URL(currentUrl).searchParams.has("list") && history?.length) {
              const target = history[history.length - 1];
              youtubeBackTargets.set(msg.tabId, target);
              try {
                await browser.tabs.update(msg.tabId, { url: target });
                history.pop();
                persistState();
                broadcastSessions();
                return;
              } catch (err) {
                youtubeBackTargets.delete(msg.tabId);
                console.warn("[MediaControls Background] Failed to navigate to previous YouTube video:", err);
              }
            }
          }
          const routeCommand = async () => {
            const frameId = msg.frameId ?? 0;
            const relayMsg = {
              type: "cmd",
              cmd: msg.cmd
            };
            let handled = false;
            try {
              handled = await browser.tabs.sendMessage(msg.tabId, relayMsg, { frameId }) === true;
            } catch (err) {
              if (msg.cmd.action === "play" || msg.cmd.action === "pause") {
                await injectScriptsIntoTab(msg.tabId);
                try {
                  handled = await browser.tabs.sendMessage(msg.tabId, relayMsg, { frameId }) === true;
                } catch (retryErr) {
                  console.warn("[MediaControls Background] Failed to send cmd to frame:", retryErr);
                }
              } else {
                console.warn("[MediaControls Background] Failed to send cmd to frame:", err);
              }
            }
            if (!handled && frameId !== 0 && (msg.cmd.action === "nexttrack" || msg.cmd.action === "previoustrack")) {
              browser.tabs.sendMessage(msg.tabId, relayMsg, { frameId: 0 }).catch(() => {
              });
            }
          };
          if (msg.cmd.action === "play" || msg.cmd.action === "pause") {
            const previous = playbackCommandQueues.get(msg.tabId) || Promise.resolve();
            const queued = previous.catch(() => {
            }).then(routeCommand);
            playbackCommandQueues.set(msg.tabId, queued);
            try {
              await queued;
            } finally {
              if (playbackCommandQueues.get(msg.tabId) === queued) {
                playbackCommandQueues.delete(msg.tabId);
              }
            }
          } else {
            await routeCommand();
          }
        } else if (msg.type === "focus") {
          try {
            await browser.tabs.update(msg.tabId, { active: true });
            const tab = await browser.tabs.get(msg.tabId);
            if (tab.windowId) {
              await browser.windows.update(tab.windowId, { focused: true });
            }
          } catch (err) {
            console.warn("[MediaControls Background] Failed to focus tab:", err);
          }
        } else if (msg.type === "mute") {
          try {
            await browser.tabs.update(msg.tabId, { muted: msg.muted });
          } catch (err) {
            console.warn("[MediaControls Background] Failed to mute tab:", err);
          }
        } else if (msg.type === "reorder") {
          lastOrderedTabIds = msg.tabIds;
          customTabOrder = msg.tabIds;
          customOrderUrls = msg.tabIds.map((tabId) => tabsInfo.get(tabId)?.url || "").filter((url) => url.length > 0);
          try {
            await browser.storage.local.set({ customOrderUrls });
          } catch (err) {
            console.warn("[MediaControls Background] Failed to save card order:", err);
          }
          persistState();
          broadcastSessions();
        } else if (msg.type === "pin") {
          const url = tabsInfo.get(msg.tabId)?.url || "";
          if (msg.pinned) {
            if (!pinnedTabIds.has(msg.tabId)) {
              pinnedTabIds.add(msg.tabId);
              if (url) pinnedUrls.push(url);
            }
          } else {
            pinnedTabIds.delete(msg.tabId);
            const urlIndex = pinnedUrls.indexOf(url);
            if (urlIndex >= 0) pinnedUrls.splice(urlIndex, 1);
          }
          void persistState();
          broadcastSessions();
          try {
            await browser.storage.local.set({ pinnedUrls });
          } catch (err) {
            console.warn("[MediaControls Background] Failed to save pinned cards:", err);
          }
        } else if (msg.type === "request-sessions") {
          await refreshTabsAndInject();
          port.postMessage({
            type: "sessions",
            sessions: resolveSessions()
          });
        }
      });
      port.onDisconnect.addListener(() => {
        connectedPopupPorts.delete(port);
        lastOrderedTabIds = [];
        persistState();
      });
    }
  });
  browser.runtime.onInstalled.addListener(async () => {
    try {
      const tabs = await browser.tabs.query({ url: ["http://*/*", "https://*/*"] });
      for (const tab of tabs) {
        if (tab.id) {
          await injectScriptsIntoTab(tab.id);
        }
      }
      await refreshTabsAndInject();
      broadcastSessions();
    } catch (err) {
      console.warn("[MediaControls Background] Script injection on install failed:", err);
    }
  });
  browser.permissions.onAdded.addListener(async (permissions) => {
    if (!permissions.origins?.includes("<all_urls>")) return;
    try {
      const tabs = await browser.tabs.query({ url: ["http://*/*", "https://*/*"] });
      await Promise.all(tabs.filter((tab) => tab.id !== void 0).map(
        (tab) => injectScriptsIntoTab(tab.id)
      ));
      await refreshTabsAndInject();
      broadcastSessions();
    } catch (err) {
      console.warn("[MediaControls Background] Injection after permission grant failed:", err);
    }
  });
})();
//# sourceMappingURL=background.js.map
