import type {
  Command,
  FrameState,
  Session,
  PopupToBgMessage,
  BgToPopupMessage,
  RelayToBgMessage,
  BgToRelayMessage
} from "./shared/protocol";

interface TabInfo {
  audible: boolean;
  muted: boolean;
  title: string;
  favIconUrl: string;
  url: string;
}

// In-memory caches mirrored to browser.storage.session
const registry = new Map<number, Map<number, FrameState>>();
const tabsInfo = new Map<number, TabInfo>();

let connectedPopupPorts = new Set<browser.runtime.Port>();
let lastOrderedTabIds: number[] = [];
let customTabOrder: number[] = [];
let openTabIds = new Set<number>();

function getHostname(urlStr?: string): string {
  if (!urlStr) return "";
  try {
    const url = new URL(urlStr);
    return url.hostname;
  } catch (_) {
    return "";
  }
}

function isYouTubeWatchUrl(urlStr?: string): boolean {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    if (!u.hostname.includes("youtube.com") && !u.hostname.includes("youtu.be")) return false;
    return u.pathname.includes("/watch") || u.pathname.startsWith("/shorts") || u.pathname.startsWith("/live");
  } catch (_) {
    return false;
  }
}

// Persistence helpers
async function persistState() {
  try {
    const serializedRegistry: Record<string, Record<string, FrameState>> = {};
    for (const [tabId, frameMap] of registry.entries()) {
      serializedRegistry[String(tabId)] = {};
      for (const [frameId, state] of frameMap.entries()) {
        serializedRegistry[String(tabId)][String(frameId)] = state;
      }
    }

    const serializedTabs: Record<string, TabInfo> = {};
    for (const [tabId, info] of tabsInfo.entries()) {
      serializedTabs[String(tabId)] = info;
    }

    await browser.storage.session.set({
      registry: serializedRegistry,
      tabsInfo: serializedTabs,
      lastOrderedTabIds,
      customTabOrder
    });
  } catch (err) {
    console.warn("[MediaControls Background] Failed to persist state:", err);
  }
}

async function restoreState() {
  try {
    const data = await browser.storage.session.get([
      "registry",
      "tabsInfo",
      "lastOrderedTabIds",
      "customTabOrder"
    ]);

    if (data.registry && typeof data.registry === "object") {
      registry.clear();
      for (const [tabIdStr, frameMapObj] of Object.entries(data.registry as Record<string, any>)) {
        const tabId = Number(tabIdStr);
        const frameMap = new Map<number, FrameState>();
        for (const [frameIdStr, state] of Object.entries(frameMapObj as Record<string, any>)) {
          frameMap.set(Number(frameIdStr), state as FrameState);
        }
        registry.set(tabId, frameMap);
      }
    }

    if (data.tabsInfo && typeof data.tabsInfo === "object") {
      tabsInfo.clear();
      for (const [tabIdStr, info] of Object.entries(data.tabsInfo as Record<string, any>)) {
        tabsInfo.set(Number(tabIdStr), info as TabInfo);
      }
    }

    if (Array.isArray(data.lastOrderedTabIds)) {
      lastOrderedTabIds = data.lastOrderedTabIds;
    }

    if (Array.isArray(data.customTabOrder)) {
      customTabOrder = data.customTabOrder;
    }
  } catch (err) {
    console.warn("[MediaControls Background] Failed to restore state:", err);
  }
}

const RETENTION_MS = 60 * 60 * 1000; // 60 minutes

function resolveSessions(): Session[] {
  const now = Date.now();
  const sessionsMap = new Map<number, Session>();

  // 1. Resolve tabs with reported frame state
  for (const [tabId, frameMap] of registry.entries()) {
    if (openTabIds.size > 0 && !openTabIds.has(tabId)) {
      registry.delete(tabId);
      continue;
    }
    const tab = tabsInfo.get(tabId);
    let chosenFrameId = 0;
    let chosenState: FrameState | null = null;

    // Priorities:
    // 1. Playing MediaSession
    // 2. Playing element
    // 3. Most recently paused
    // 4. WebAudio
    let bestPlayingMediaSession: { frameId: number; state: FrameState } | null = null;
    let bestPlayingElement: { frameId: number; state: FrameState } | null = null;
    let bestPausedMediaSession: { frameId: number; state: FrameState } | null = null;
    let bestPausedElement: { frameId: number; state: FrameState } | null = null;
    let bestWebAudio: { frameId: number; state: FrameState } | null = null;

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

    const candidate =
      bestPlayingMediaSession ||
      bestPlayingElement ||
      bestPausedMediaSession ||
      bestPausedElement ||
      bestWebAudio;

    if (candidate) {
      chosenFrameId = candidate.frameId;
      chosenState = candidate.state;

      // Retention check: if paused, retain up to 60 mins
      if (
        chosenState.playbackState === "paused" &&
        now - chosenState.lastPlayedAt > RETENTION_MS
      ) {
        // Expired
        frameMap.delete(chosenFrameId);
        continue;
      }

      const isYt =
        (tab?.url && (tab.url.includes("youtube.com") || tab.url.includes("youtu.be"))) ||
        chosenState.metadata?.album === "YouTube";

      if (isYt) {
        const isWatch = isYouTubeWatchUrl(tab?.url);
        const isAudibleOrPlaying = Boolean(tab?.audible) || chosenState.playbackState === "playing";
        if (!isWatch && !isAudibleOrPlaying) {
          // Drop non-watch YouTube tabs that are not actively playing
          frameMap.delete(chosenFrameId);
          continue;
        }
      }

      sessionsMap.set(tabId, {
        tabId,
        frameId: chosenFrameId,
        hostname: getHostname(tab?.url),
        favIconUrl: tab?.favIconUrl || "",
        tabTitle: tab?.title || chosenState.metadata?.title || "Audio",
        state: chosenState,
        audible: Boolean(tab?.audible),
        muted: Boolean(tab?.muted),
        degraded: false
      });
    }
  }

  // 2. Check for degraded sessions (audible tab with no controllable state)
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
        degraded: true
      });
    }
  }

  // NOTE: intentionally no dedup of same-video YouTube tabs. Each open tab
  // reports its own frame state and gets its own card so the user can control
  // every tab independently.
  const rawList = Array.from(sessionsMap.values());

  // Stable ordering while popup is connected
  if (connectedPopupPorts.size > 0 && lastOrderedTabIds.length > 0) {
    const existingSessions: Session[] = [];
    const newSessions: Session[] = [];

    // Map existing sessions in preserved order
    const byId = new Map(rawList.map((s) => [s.tabId, s]));
    for (const tabId of lastOrderedTabIds) {
      const s = byId.get(tabId);
      if (s) {
        existingSessions.push(s);
        byId.delete(tabId);
      }
    }

    // Remaining are new sessions -> sort by lastPlayedAt descending and prepend
    for (const s of byId.values()) {
      newSessions.push(s);
    }
    newSessions.sort((a, b) => {
      const timeA = a.state?.lastPlayedAt ?? 0;
      const timeB = b.state?.lastPlayedAt ?? 0;
      return timeB - timeA;
    });

    const combined = [...newSessions, ...existingSessions];
    lastOrderedTabIds = combined.map((s) => s.tabId);
    return combined;
  }

  // Preserve user custom drag-and-drop order if available
  if (customTabOrder.length > 0) {
    const existingSessions: Session[] = [];
    const newSessions: Session[] = [];

    const byId = new Map(rawList.map((s) => [s.tabId, s]));
    for (const tabId of customTabOrder) {
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
    lastOrderedTabIds = combined.map((s) => s.tabId);
    return combined;
  }

  // Otherwise, sort all by lastPlayedAt descending
  rawList.sort((a, b) => {
    const timeA = a.state?.lastPlayedAt ?? 0;
    const timeB = b.state?.lastPlayedAt ?? 0;
    return timeB - timeA;
  });

  lastOrderedTabIds = rawList.map((s) => s.tabId);
  return rawList;
}

function updateToolbarAction(sessions: Session[]) {
  const hasActiveSessions = sessions.length > 0;
  // resolveSessions emits exactly one card per tracked tab, including paused
  // and degraded cards. Keep the badge identical to the popup card count.
  const trackedTabCount = sessions.length;
  const iconPrefix = hasActiveSessions ? "icons/active" : "icons/idle";
  browser.action.setIcon({
    path: {
      "16": `${iconPrefix}-16.png`,
      "32": `${iconPrefix}-32.png`,
      "48": `${iconPrefix}-48.png`
    }
  }).catch(() => {});

  browser.action.setBadgeBackgroundColor({ color: "#5F6368" }).catch(() => {});
  browser.action.setBadgeText({
    text: trackedTabCount > 0 ? String(trackedTabCount) : ""
  }).catch(() => {});

  // Keep the popup reachable for the empty state and the host-permission prompt.
  // An idle icon communicates state without making the extension inaccessible.
  browser.action.enable().catch(() => {});
  // The popup is fixed in manifest.json; media updates only change its icon.
  browser.action.setTitle({
    title: hasActiveSessions ? "Media controls" : "No media playing"
  }).catch(() => {});
}

function broadcastSessions() {
  const sessions = resolveSessions();
  updateToolbarAction(sessions);

  const msg: BgToPopupMessage = {
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

// Inject content scripts into a tab if supported
async function injectScriptsIntoTab(tabId: number) {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
      return;
    }

    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["page-hook.js"],
      world: "MAIN" as any
    }).catch(() => {});

    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["relay.js"]
    }).catch(() => {});
    browser.tabs.sendMessage(tabId, { type: "query-state" } as BgToRelayMessage).catch(() => {});
  } catch (_) {}
}

// Sync tab information and query active media
async function refreshTabsAndInject() {
  try {
    const tabs = await browser.tabs.query({});
    const currentOpenIds = new Set<number>();
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        currentOpenIds.add(tab.id);
      }
    }
    openTabIds = currentOpenIds;

    // Prune stale tabs from registry and tabsInfo
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

    for (const tab of tabs) {
      if (!tab.id) continue;

      const current = tabsInfo.get(tab.id) || {
        audible: false,
        muted: false,
        title: "",
        favIconUrl: "",
        url: ""
      };

      tabsInfo.set(tab.id, {
        audible: Boolean(tab.audible),
        muted: Boolean(tab.mutedInfo?.muted),
        title: tab.title || current.title,
        favIconUrl: tab.favIconUrl || current.favIconUrl,
        url: tab.url || current.url
      });

      // If tab is audible or might have media, inject scripts if no frame state exists
      const hasFrames = registry.has(tab.id) && (registry.get(tab.id)?.size ?? 0) > 0;
      if (tab.audible && !hasFrames) {
        void injectScriptsIntoTab(tab.id);
      }

      // Ping tab for fresh media state
      browser.tabs
        .sendMessage(tab.id, { type: "query-state" } as BgToRelayMessage)
        .catch(() => {});
    }
    void persistState();
    broadcastSessions();
  } catch (err) {
    console.warn("[MediaControls Background] refreshTabsAndInject error:", err);
  }
}

// Ready promise to ensure background state is restored before processing events
const readyPromise = (async () => {
  await restoreState();
  await refreshTabsAndInject();
  const sessions = resolveSessions();
  updateToolbarAction(sessions);
})();

// Listen for messages from content script relay
browser.runtime.onMessage.addListener(
  async (message: any, sender: browser.runtime.MessageSender) => {
    await readyPromise;
    if (message && message.type === "frame-state") {
      const tabId = sender.tab?.id;
      const frameId = sender.frameId ?? 0;
      if (!tabId) return;

      if (!registry.has(tabId)) {
        registry.set(tabId, new Map());
      }
      const frameMap = registry.get(tabId)!;

      if (message.state === null) {
        frameMap.delete(frameId);
        if (frameMap.size === 0) {
          registry.delete(tabId);
        }
      } else {
        frameMap.set(frameId, message.state as FrameState);
      }

      if (sender.tab) {
        const current = tabsInfo.get(tabId) || {
          audible: false,
          muted: false,
          title: "",
          favIconUrl: "",
          url: ""
        };
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

// Tab event listeners
browser.tabs.onCreated.addListener((tab) => {
  if (typeof tab.id === "number") {
    openTabIds.add(tab.id);
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await readyPromise;
  openTabIds.add(tabId);

  // If top-level navigation, clear tab's frames
  if (changeInfo.status === "loading" && changeInfo.url) {
    registry.delete(tabId);
  }

  // Also clear tab frames on SPA navigations (when URL changes without full page reload)
  const newUrl = changeInfo.url || tab.url;
  const prevUrl = tabsInfo.get(tabId)?.url;
  if (prevUrl && newUrl && prevUrl !== newUrl) {
    try {
      const oldU = new URL(prevUrl);
      const newU = new URL(newUrl);
      // If pathname or video param changed, invalidate old frames so old media state cannot linger
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

  const isAudible = changeInfo.audible ?? tab.audible ?? current.audible;
  tabsInfo.set(tabId, {
    audible: isAudible,
    muted:
      changeInfo.mutedInfo?.muted ??
      tab.mutedInfo?.muted ??
      current.muted,
    title: changeInfo.title ?? tab.title ?? current.title,
    favIconUrl: changeInfo.favIconUrl ?? tab.favIconUrl ?? current.favIconUrl,
    url: changeInfo.url ?? tab.url ?? current.url
  });

  // If tab finished loading, changed URL, or became audible, inject and query
  if (changeInfo.status === "complete" || changeInfo.audible === true || changeInfo.url) {
    const hasFrames = registry.has(tabId) && (registry.get(tabId)?.size ?? 0) > 0;
    if (!hasFrames) {
      void injectScriptsIntoTab(tabId);
    }
    browser.tabs
      .sendMessage(tabId, { type: "query-state" } as BgToRelayMessage)
      .catch(() => {});
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
  persistState();
  broadcastSessions();
});

// Firefox does not expose tabs.onReplaced. Tab lifecycle is handled by
// onUpdated/onRemoved above; registering onReplaced would abort startup here.

// Port connection for popup
browser.runtime.onConnect.addListener((port) => {
  if (port.name === "popup") {
    connectedPopupPorts.add(port);
    // Register handlers synchronously so the event page retains the port while
    // storage and tab enumeration finish on a cold start.
    void readyPromise.then(() => {
      port.postMessage({ type: "sessions", sessions: resolveSessions() } as BgToPopupMessage);
      void refreshTabsAndInject();
    }).catch((err) => {
      console.warn("[MediaControls Background] Popup startup failed:", err);
      port.postMessage({ type: "sessions", sessions: resolveSessions() } as BgToPopupMessage);
    });

    port.onMessage.addListener(async (rawMsg: any) => {
      await readyPromise;
      const msg = rawMsg as PopupToBgMessage;
      if (msg.type === "cmd") {
        const frameId = msg.frameId ?? 0;
        const relayMsg: BgToRelayMessage = {
          type: "cmd",
          cmd: msg.cmd
        };
        let handled = false;
        try {
          handled = await browser.tabs.sendMessage(msg.tabId, relayMsg, { frameId }) === true;
        } catch (err) {
          console.warn("[MediaControls Background] Failed to send cmd to frame:", err);
        }
        // Embedded media may report from an iframe while its player buttons
        // live in the top-level page.
        if (!handled && frameId !== 0 &&
            (msg.cmd.action === "nexttrack" || msg.cmd.action === "previoustrack")) {
          browser.tabs.sendMessage(msg.tabId, relayMsg, { frameId: 0 }).catch(() => {});
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
        persistState();
        broadcastSessions();
      } else if (msg.type === "request-sessions") {
        await refreshTabsAndInject();
        port.postMessage({
          type: "sessions",
          sessions: resolveSessions()
        } as BgToPopupMessage);
      }
    });

    port.onDisconnect.addListener(() => {
      connectedPopupPorts.delete(port);
      // Clean up stable ordering on popup close
      lastOrderedTabIds = [];
      persistState();
    });
  }
});

// Script injection on install or update
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

// Firefox can grant MV3 host access after installation. Inject into tabs that
// were already open as soon as access is granted, including paused media tabs.
browser.permissions.onAdded.addListener(async (permissions) => {
  if (!permissions.origins?.includes("<all_urls>")) return;
  try {
    const tabs = await browser.tabs.query({ url: ["http://*/*", "https://*/*"] });
    await Promise.all(tabs.filter((tab) => tab.id !== undefined).map((tab) =>
      injectScriptsIntoTab(tab.id!)
    ));
    await refreshTabsAndInject();
    broadcastSessions();
  } catch (err) {
    console.warn("[MediaControls Background] Injection after permission grant failed:", err);
  }
});
