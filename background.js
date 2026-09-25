"use strict";
(() => {
  // src/shared/validation.ts
  var ALLOWED_ACTIONS = /* @__PURE__ */ new Set([
    "play",
    "pause",
    "previoustrack",
    "nexttrack",
    "seekbackward",
    "seekforward",
    "seekto",
    "setvolume",
    "stop"
  ]);
  function sanitizeString(str, maxLen = 300) {
    if (typeof str !== "string") return "";
    return str.slice(0, maxLen);
  }
  function safeImageUrl(value) {
    if (typeof value !== "string" || value.length > 32768) return null;
    const src = value.trim();
    if (/^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)(?:;|,)/i.test(src)) return src;
    if (src.length > 8192) return null;
    try {
      const url = new URL(src);
      if (url.protocol !== "https:" && url.protocol !== "http:" || url.username || url.password) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }
  function sanitizeArtwork(list) {
    if (!Array.isArray(list)) return [];
    const valid = [];
    for (const item of list.slice(0, 8)) {
      const src = safeImageUrl(item?.src);
      if (src) valid.push({ src, sizes: sanitizeString(item.sizes, 50), type: sanitizeString(item.type, 50) });
    }
    return valid;
  }
  function sanitizeMetadata(meta) {
    if (!meta || typeof meta !== "object") return null;
    return {
      title: sanitizeString(meta.title, 300),
      artist: sanitizeString(meta.artist, 300),
      album: sanitizeString(meta.album, 300),
      artwork: sanitizeArtwork(meta.artwork)
    };
  }
  function sanitizePosition(pos) {
    if (!pos || typeof pos !== "object") return null;
    const duration = pos.duration === Infinity ? Infinity : typeof pos.duration === "number" && isFinite(pos.duration) ? Math.max(0, pos.duration) : NaN;
    if (isNaN(duration)) return null;
    const position = typeof pos.position === "number" && isFinite(pos.position) ? Math.max(0, pos.position) : 0;
    const playbackRate = typeof pos.playbackRate === "number" && isFinite(pos.playbackRate) && pos.playbackRate > 0 ? pos.playbackRate : 1;
    const updatedAt = typeof pos.updatedAt === "number" && isFinite(pos.updatedAt) ? pos.updatedAt : Date.now();
    return {
      duration,
      position,
      playbackRate,
      updatedAt
    };
  }
  function sanitizeVolume(vol) {
    if (!vol || typeof vol !== "object") return null;
    if (typeof vol.level !== "number" || !isFinite(vol.level)) return null;
    const level = Math.min(1, Math.max(0, vol.level));
    return {
      level,
      mediaMuted: vol.mediaMuted === true
    };
  }
  function sanitizeFrameState(state) {
    if (!state || typeof state !== "object") return null;
    const source = state.source === "mediasession" || state.source === "element" || state.source === "webaudio" ? state.source : null;
    if (!source) return null;
    const playbackState = state.playbackState === "playing" || state.playbackState === "paused" || state.playbackState === "none" ? state.playbackState : "none";
    const actions = [];
    if (Array.isArray(state.actions)) {
      for (const a of state.actions.slice(0, 32)) {
        if (ALLOWED_ACTIONS.has(a) && !actions.includes(a)) {
          actions.push(a);
        }
      }
    }
    const isLive = Boolean(state.isLive);
    const seekable = Boolean(state.seekable);
    const lastPlayedAt = typeof state.lastPlayedAt === "number" && isFinite(state.lastPlayedAt) ? Math.min(Date.now(), Math.max(0, state.lastPlayedAt)) : Date.now();
    const playBlocked = state.playBlocked === true;
    return {
      source,
      metadata: sanitizeMetadata(state.metadata),
      playbackState,
      position: sanitizePosition(state.position),
      actions,
      isLive,
      seekable,
      volume: sanitizeVolume(state.volume),
      lastPlayedAt,
      playBlocked
    };
  }
  function sanitizeCommand(cmd) {
    if (!cmd || typeof cmd !== "object" || typeof cmd.action !== "string") return null;
    if (!ALLOWED_ACTIONS.has(cmd.action)) return null;
    const sanitized = { action: cmd.action };
    if (typeof cmd.seekTime === "number" && isFinite(cmd.seekTime)) {
      sanitized.seekTime = Math.max(0, cmd.seekTime);
    }
    if (typeof cmd.offset === "number" && isFinite(cmd.offset)) {
      sanitized.offset = cmd.offset;
    }
    if (cmd.action === "setvolume") {
      if (typeof cmd.volume !== "number" || !isFinite(cmd.volume)) return null;
      sanitized.volume = Math.min(1, Math.max(0, cmd.volume));
    } else if (typeof cmd.volume === "number" && isFinite(cmd.volume)) {
      sanitized.volume = Math.min(1, Math.max(0, cmd.volume));
    }
    return sanitized;
  }

  // src/shared/order-keys.ts
  var keyPromise;
  async function installationKey() {
    const stored = await browser.storage.local.get("orderKeySecret");
    let secret = stored.orderKeySecret;
    if (!Array.isArray(secret) || secret.length !== 32 || !secret.every((n) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 255)) {
      secret = Array.from(crypto.getRandomValues(new Uint8Array(32)));
      await browser.storage.local.set({ orderKeySecret: secret });
    }
    return crypto.subtle.importKey(
      "raw",
      new Uint8Array(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
  }
  async function orderKey(url) {
    keyPromise ??= installationKey().catch((error) => {
      keyPromise = void 0;
      throw error;
    });
    const signature = await crypto.subtle.sign("HMAC", await keyPromise, new TextEncoder().encode(url));
    return "hmac:" + Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // src/background.ts
  var registry = /* @__PURE__ */ new Map();
  var tabsInfo = /* @__PURE__ */ new Map();
  var connectedPopupPorts = /* @__PURE__ */ new Set();
  var lastOrderedTabIds = [];
  var customTabOrder = [];
  var customOrderKeys = [];
  var pinnedTabIds = /* @__PURE__ */ new Set();
  var pinnedTabOrder = [];
  var pinnedKeys = [];
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
  function isYouTubeVideoWatchUrl(urlStr) {
    try {
      if (!urlStr) return false;
      const url = new URL(urlStr);
      return /^(www\.|m\.)?youtube\.com$/.test(url.hostname) && url.pathname === "/watch" && Boolean(youtubeWatchVideoId(urlStr));
    } catch (_) {
      return false;
    }
  }
  function advanceYouTubeVideoInPage() {
    const currentUrl = new URL(window.location.href);
    const currentId = currentUrl.searchParams.get("v");
    if (currentUrl.pathname !== "/watch" || !currentId) return false;
    const validId = (id) => typeof id === "string" && /^[\w-]{11}$/.test(id) && id !== currentId;
    const idFromHref = (href) => {
      if (!href) return null;
      try {
        const url = new URL(href, currentUrl);
        const id = url.searchParams.get("v");
        return /(^|\.)youtube\.com$/.test(url.hostname) && url.pathname === "/watch" && validId(id) ? id : null;
      } catch (_) {
        return null;
      }
    };
    const player = document.getElementById("movie_player");
    let nextId = null;
    let playlistNextId = null;
    try {
      const playlist = player?.getPlaylist?.();
      const index = player?.getPlaylistIndex?.();
      if (currentUrl.searchParams.has("list") && Array.isArray(playlist) && Number.isInteger(index) && index >= 0) {
        const candidate = playlist[index + 1];
        if (validId(candidate)) {
          nextId = candidate;
          playlistNextId = candidate;
        }
      }
    } catch (_) {
    }
    const nextButton = document.querySelector(".ytp-next-button");
    nextId ||= idFromHref(nextButton?.getAttribute("href"));
    const data = window.ytInitialData;
    const dataCurrentId = data?.currentVideoEndpoint?.watchEndpoint?.videoId;
    if (!nextId && (!dataCurrentId || dataCurrentId === currentId)) {
      const sets = data?.contents?.twoColumnWatchNextResults?.autoplay?.autoplay?.sets;
      if (Array.isArray(sets)) {
        for (const set of sets) {
          const candidate = set?.autoplayVideo?.watchEndpoint?.videoId;
          if (validId(candidate)) {
            nextId = candidate;
            break;
          }
        }
      }
    }
    if (!nextId) {
      const recommendations = document.querySelectorAll(
        "#secondary a[href*='/watch?'], #related a[href*='/watch?'], ytd-watch-next-secondary-results-renderer a[href*='/watch?']"
      );
      for (const link of recommendations) {
        nextId = idFromHref(link.getAttribute("href"));
        if (nextId) break;
      }
    }
    let attemptedPlayerControl = false;
    if (playlistNextId && typeof player?.nextVideo === "function") {
      try {
        player.nextVideo();
        attemptedPlayerControl = true;
      } catch (_) {
      }
    } else if (nextButton?.isConnected && !nextButton.matches(":disabled, [aria-disabled='true'], .ytp-disabled")) {
      try {
        nextButton.click();
        attemptedPlayerControl = true;
      } catch (_) {
      }
    }
    if (nextId) {
      const navigateIfStillCurrent = () => {
        const urlId = new URL(window.location.href).searchParams.get("v");
        const playerId = document.getElementById("movie_player")?.getVideoData?.()?.video_id;
        if (urlId === currentId && (!playerId || playerId === currentId)) {
          const target = new URL(currentUrl.href);
          target.searchParams.set("v", nextId);
          if (!target.searchParams.has("list")) {
            target.search = `?v=${nextId}`;
          }
          window.location.assign(target.href);
        }
      };
      if (attemptedPlayerControl) {
        window.setTimeout(navigateIfStillCurrent, 650);
      } else {
        navigateIfStillCurrent();
      }
      return true;
    }
    return Boolean(nextButton?.isConnected && !nextButton.matches(":disabled, [aria-disabled='true'], .ytp-disabled"));
  }
  async function readYouTubeChaptersInPage() {
    const url = new URL(window.location.href);
    const videoId = url.searchParams.get("v") || "";
    if (url.pathname !== "/watch" || !/^[\w-]{11}$/.test(videoId)) {
      return { videoId: "", chapters: [], status: "error" };
    }
    const textOf = (value) => {
      if (typeof value === "string") return value.trim();
      if (typeof value?.simpleText === "string") return value.simpleText.trim();
      if (Array.isArray(value?.runs)) {
        return value.runs.map((run) => run?.text || "").join("").trim();
      }
      return "";
    };
    const normalize = (rows) => {
      const seen = /* @__PURE__ */ new Set();
      return rows.map((row) => ({
        title: textOf(row.title).slice(0, 200),
        startTime: Number(row.startTime)
      })).filter((row) => {
        if (!row.title || !Number.isFinite(row.startTime) || row.startTime < 0 || row.startTime > 7 * 24 * 3600 || seen.has(row.startTime)) return false;
        seen.add(row.startTime);
        return true;
      }).sort((a, b) => a.startTime - b.startTime).slice(0, 200);
    };
    const fromData = (data) => {
      if (data?.currentVideoEndpoint?.watchEndpoint?.videoId !== videoId) return [];
      const markers = data?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap;
      if (Array.isArray(markers)) {
        for (const marker of markers) {
          const chapters = marker?.value?.chapters;
          if (Array.isArray(chapters) && chapters.length > 0) {
            const rows = normalize(chapters.map((chapter) => ({
              title: chapter?.chapterRenderer?.title,
              startTime: Number(chapter?.chapterRenderer?.timeRangeStartMillis) / 1e3
            })));
            if (rows.length > 0) return rows;
          }
        }
      }
      const panels = data?.engagementPanels;
      if (Array.isArray(panels)) {
        for (const panel of panels) {
          const contents = panel?.engagementPanelSectionListRenderer?.content?.macroMarkersListRenderer?.contents;
          if (!Array.isArray(contents)) continue;
          const rows = normalize(contents.map((item) => ({
            title: item?.macroMarkersListItemRenderer?.title,
            startTime: item?.macroMarkersListItemRenderer?.onTap?.watchEndpoint?.startTimeSeconds
          })));
          if (rows.length > 0) return rows;
        }
      }
      return [];
    };
    const current = fromData(window.ytInitialData);
    if (current.length > 0) return { videoId, chapters: current, status: "available" };
    const domItems = document.querySelectorAll("ytd-macro-markers-list-item-renderer");
    if (domItems.length > 0) {
      const domRows = normalize(Array.from(domItems, (item) => {
        const data = item.data?.macroMarkersListItemRenderer || item.data;
        const endpoint = data?.onTap?.watchEndpoint;
        return {
          title: endpoint?.videoId === videoId ? data?.title : "",
          startTime: endpoint?.startTimeSeconds
        };
      }));
      if (domRows.length > 0) return { videoId, chapters: domRows, status: "available" };
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7e3);
    try {
      const response = await fetch(url.href, {
        credentials: "include",
        signal: controller.signal
      });
      if (!response.ok) return { videoId, chapters: [], status: "error" };
      const html = await response.text();
      const marker = "var ytInitialData = ";
      const index = html.indexOf(marker);
      if (index < 0) return { videoId, chapters: [], status: "error" };
      const start = html.indexOf("{", index + marker.length);
      if (start < 0) return { videoId, chapters: [], status: "error" };
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (let i = start; i < html.length; i++) {
        const char = html[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') {
          quoted = true;
        } else if (char === "{") {
          depth++;
        } else if (char === "}" && --depth === 0) {
          let data;
          try {
            data = JSON.parse(html.slice(start, i + 1));
          } catch (_) {
            return { videoId, chapters: [], status: "error" };
          }
          if (data?.currentVideoEndpoint?.watchEndpoint?.videoId !== videoId) {
            return { videoId, chapters: [], status: "error" };
          }
          const rows = fromData(data);
          return rows.length > 0 ? { videoId, chapters: rows, status: "available" } : { videoId, chapters: [], status: "none" };
        }
      }
      return { videoId, chapters: [], status: "error" };
    } catch (_) {
      return { videoId, chapters: [], status: "error" };
    } finally {
      window.clearTimeout(timeout);
    }
  }
  var chapterCache = /* @__PURE__ */ new Map();
  var chapterInflight = /* @__PURE__ */ new Map();
  var chapterAttempts = /* @__PURE__ */ new Map();
  var chapterRetryDelays = [3e3, 1e4, 3e4];
  var tabChapterVideo = /* @__PURE__ */ new Map();
  function validateChapters(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(
      (chapter) => typeof chapter?.title === "string" && chapter.title.trim().length > 0 && chapter.title.length <= 200 && typeof chapter.startTime === "number" && Number.isFinite(chapter.startTime) && chapter.startTime >= 0 && chapter.startTime <= 7 * 24 * 3600
    ).slice(0, 200);
  }
  function chapterVideoStillWanted(videoId) {
    for (const info of tabsInfo.values()) {
      if (youtubeWatchVideoId(info.url) === videoId) return true;
    }
    return false;
  }
  function chapterStateFor(videoId) {
    if (!videoId) return null;
    const cached = chapterCache.get(videoId);
    return cached ? { videoId, status: cached.status } : null;
  }
  async function lookupYouTubeChapters(tabId, videoId) {
    try {
      let targetTabId = null;
      if (youtubeWatchVideoId(tabsInfo.get(tabId)?.url) === videoId) {
        targetTabId = tabId;
      } else {
        for (const [id, info] of tabsInfo.entries()) {
          if (youtubeWatchVideoId(info.url) === videoId) {
            targetTabId = id;
            break;
          }
        }
      }
      if (targetTabId === null) return;
      const tab = await browser.tabs.get(targetTabId).catch(() => null);
      if (!tab || !isYouTubeVideoWatchUrl(tab.url) || youtubeWatchVideoId(tab.url) !== videoId) {
        return;
      }
      const result = await browser.scripting.executeScript({
        target: { tabId: targetTabId, frameIds: [0] },
        world: "MAIN",
        func: readYouTubeChaptersInPage
      });
      const page = result[0]?.result;
      if (page?.videoId !== videoId || page.status !== "available" && page.status !== "none") {
        throw new Error("chapter lookup failed");
      }
      if (page.status === "available") {
        const chapters = validateChapters(page.chapters);
        if (chapters.length === 0) throw new Error("chapter lookup failed");
        if (chapterCache.size >= 100) {
          const oldest = chapterCache.keys().next();
          if (!oldest.done) chapterCache.delete(oldest.value);
        }
        chapterCache.set(videoId, { status: "available", chapters });
      } else {
        if (chapterCache.size >= 100) {
          const oldest = chapterCache.keys().next();
          if (!oldest.done) chapterCache.delete(oldest.value);
        }
        chapterCache.set(videoId, { status: "none", chapters: [] });
      }
      chapterAttempts.delete(videoId);
      broadcastSessions();
    } catch (err) {
      const attempt = chapterAttempts.get(videoId) || 0;
      if (attempt < chapterRetryDelays.length && chapterVideoStillWanted(videoId)) {
        chapterAttempts.set(videoId, attempt + 1);
        const retryTab = tabId;
        const retryVideo = videoId;
        setTimeout(() => {
          chapterInflight.delete(retryVideo);
          if (!chapterCache.has(retryVideo) && chapterVideoStillWanted(retryVideo)) {
            void ensureYouTubeChapters(retryTab, retryVideo);
          } else {
            chapterAttempts.delete(retryVideo);
          }
        }, chapterRetryDelays[attempt]);
      } else {
        chapterAttempts.delete(videoId);
      }
    }
  }
  function ensureYouTubeChapters(tabId, videoId) {
    if (!videoId || chapterCache.has(videoId)) return null;
    const running = chapterInflight.get(videoId);
    if (running) return running;
    const task = lookupYouTubeChapters(tabId, videoId).finally(() => {
      if (chapterInflight.get(videoId) === task) chapterInflight.delete(videoId);
    });
    chapterInflight.set(videoId, task);
    return task;
  }
  function noteYouTubeVideo(tabId, urlStr) {
    const videoId = youtubeWatchVideoId(urlStr);
    if (!videoId) return;
    if (tabChapterVideo.get(tabId) === videoId) return;
    tabChapterVideo.set(tabId, videoId);
    void ensureYouTubeChapters(tabId, videoId);
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
  var urlOrderKeys = /* @__PURE__ */ new Map();
  function knownOrderKey(url) {
    return url ? urlOrderKeys.get(url) || "" : "";
  }
  async function rememberOrderKey(url) {
    if (!url) return "";
    const existing = urlOrderKeys.get(url);
    if (existing) return existing;
    const key = await orderKey(url);
    urlOrderKeys.set(url, key);
    return key;
  }
  async function updatePinnedUrl(tabId, previousUrl, nextUrl) {
    const [previousKey, nextKey] = await Promise.all([
      rememberOrderKey(previousUrl),
      rememberOrderKey(nextUrl)
    ]);
    if (!pinnedTabIds.has(tabId) || !previousKey || !nextKey || previousKey === nextKey) return;
    const index = pinnedKeys.indexOf(previousKey);
    if (index >= 0) {
      pinnedKeys[index] = nextKey;
      void browser.storage.local.set({ pinnedKeys }).catch(() => {
      });
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
        pinnedTabOrder,
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
          "pinnedTabOrder",
          "youtubeVideoHistory"
        ]),
        browser.storage.local.get(["customOrderKeys", "pinnedKeys", "customOrderUrls", "pinnedUrls", "pinnedOrderMigrated"])
      ]);
      for (const [current, legacy] of [["customOrderKeys", "customOrderUrls"], ["pinnedKeys", "pinnedUrls"]]) {
        if (!Array.isArray(savedOrder[current]) && Array.isArray(savedOrder[legacy])) {
          savedOrder[current] = await Promise.all(savedOrder[legacy].filter((url) => typeof url === "string" && url.length > 0).map((url) => rememberOrderKey(url)));
        }
      }
      if (data.registry && typeof data.registry === "object") {
        registry.clear();
        for (const [tabIdStr, frameMapObj] of Object.entries(data.registry)) {
          const tabId = Number(tabIdStr);
          const frameMap = /* @__PURE__ */ new Map();
          for (const [frameIdStr, state] of Object.entries(frameMapObj)) {
            const cleanState = sanitizeFrameState(state);
            if (cleanState) frameMap.set(Number(frameIdStr), cleanState);
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
      if (Array.isArray(savedOrder.customOrderKeys)) {
        customOrderKeys = savedOrder.customOrderKeys.filter(
          (url) => typeof url === "string" && url.length > 0
        );
      }
      if (Array.isArray(data.pinnedTabIds)) {
        for (const tabId of data.pinnedTabIds) {
          if (typeof tabId === "number") pinnedTabIds.add(tabId);
        }
      }
      if (Array.isArray(data.pinnedTabOrder)) {
        pinnedTabOrder = data.pinnedTabOrder.filter(
          (tabId) => typeof tabId === "number" && pinnedTabIds.has(tabId)
        );
      } else {
        pinnedTabOrder = customTabOrder.filter((tabId) => pinnedTabIds.has(tabId));
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
      if (Array.isArray(savedOrder.pinnedKeys)) {
        pinnedKeys = savedOrder.pinnedKeys.filter(
          (url) => typeof url === "string" && url.length > 0
        );
        if (savedOrder.pinnedOrderMigrated !== true && customOrderKeys.length > 0) {
          const remaining = [...pinnedKeys];
          const ordered = [];
          for (const url of customOrderKeys) {
            const index = remaining.indexOf(url);
            if (index >= 0) ordered.push(...remaining.splice(index, 1));
          }
          pinnedKeys = [...ordered, ...remaining];
          await browser.storage.local.set({ pinnedKeys, pinnedOrderMigrated: true });
        }
      }
      await browser.storage.local.set({ customOrderKeys, pinnedKeys, pinnedOrderMigrated: true });
      await browser.storage.local.remove(["customOrderUrls", "pinnedUrls"]);
    } catch (err) {
      console.warn("[MediaControls Background] Failed to restore state:", err);
    }
  }
  function resolveSessions() {
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
        const sessionState = isYouTubeVideoWatchUrl(tab?.url) && !state.actions.includes("nexttrack") ? { ...state, actions: [...state.actions, "nexttrack"] } : state;
        sessionsMap.set(tabId, {
          tabId,
          frameId: chosenFrameId,
          hostname: getHostname(tab?.url),
          favIconUrl: tab?.favIconUrl || "",
          tabTitle: tab?.title || chosenState.metadata?.title || "Audio",
          state: sessionState,
          audible: Boolean(tab?.audible),
          muted: Boolean(tab?.muted),
          degraded: false,
          pinned: false,
          youtubeVideoId: isYouTubeVideoWatchUrl(tab?.url) ? youtubeWatchVideoId(tab?.url) || void 0 : void 0,
          chapterState: chapterStateFor(
            isYouTubeVideoWatchUrl(tab?.url) ? youtubeWatchVideoId(tab?.url) || void 0 : void 0
          )
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
          pinned: false,
          chapterState: null
        });
      }
    }
    const rawList = Array.from(sessionsMap.values());
    const availablePinnedKeys = [...pinnedKeys];
    for (const session of rawList) {
      if (pinnedTabIds.has(session.tabId)) {
        session.pinned = true;
        const urlIndex = availablePinnedKeys.indexOf(knownOrderKey(tabsInfo.get(session.tabId)?.url));
        if (urlIndex >= 0) availablePinnedKeys.splice(urlIndex, 1);
      }
    }
    for (const session of rawList) {
      if (session.pinned) continue;
      const urlIndex = availablePinnedKeys.indexOf(knownOrderKey(tabsInfo.get(session.tabId)?.url));
      if (urlIndex >= 0) {
        session.pinned = true;
        pinnedTabIds.add(session.tabId);
        availablePinnedKeys.splice(urlIndex, 1);
      }
    }
    const pinnedFirst = (ordered) => {
      const pinned = ordered.filter((session) => session.pinned);
      const remaining = new Map(pinned.map((session) => [session.tabId, session]));
      const orderedPinned = [];
      for (const url of pinnedKeys) {
        const candidates = Array.from(remaining.values()).filter(
          (candidate) => knownOrderKey(tabsInfo.get(candidate.tabId)?.url) === url
        );
        const session = pinnedTabOrder.map((tabId) => remaining.get(tabId)).find((candidate) => candidate && knownOrderKey(tabsInfo.get(candidate.tabId)?.url) === url) || candidates[0];
        if (session) {
          orderedPinned.push(session);
          remaining.delete(session.tabId);
        }
      }
      for (const tabId of pinnedTabOrder) {
        const session = remaining.get(tabId);
        if (session) {
          orderedPinned.push(session);
          remaining.delete(tabId);
        }
      }
      const result = [
        ...orderedPinned,
        ...remaining.values(),
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
    if (customTabOrder.length > 0 || customOrderKeys.length > 0) {
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
      for (const url of customOrderKeys) {
        const s = Array.from(byId.values()).find(
          (candidate) => knownOrderKey(tabsInfo.get(candidate.tabId)?.url) === url
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
        "48": `${iconPrefix}-48.png`,
        "64": `${iconPrefix}-64.png`,
        "128": `${iconPrefix}-128.png`
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
      pinnedTabOrder = pinnedTabOrder.filter((id) => currentOpenIds.has(id));
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
        await updatePinnedUrl(tab.id, current.url, tab.url);
        tabsInfo.set(tab.id, {
          audible: Boolean(tab.audible),
          muted: Boolean(tab.mutedInfo?.muted),
          title: tab.title || current.title,
          favIconUrl: tab.favIconUrl || current.favIconUrl,
          url: tab.url || current.url
        });
        noteYouTubeVideo(tab.id, tab.url || current.url);
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
  var frameUpdateTimer = null;
  var lastFrameUpdate = -Infinity;
  function scheduleFrameUpdates() {
    if (frameUpdateTimer !== null) return;
    const flush = () => {
      frameUpdateTimer = null;
      lastFrameUpdate = performance.now();
      void persistState();
      broadcastSessions();
    };
    const wait = Math.max(0, 100 - (performance.now() - lastFrameUpdate));
    if (wait === 0) flush();
    else frameUpdateTimer = setTimeout(flush, wait);
  }
  browser.runtime.onMessage.addListener(
    async (message, sender) => {
      await readyPromise;
      if (message && message.type === "frame-state") {
        const tabId = sender.tab?.id;
        const frameId = sender.frameId ?? 0;
        if (!tabId || sender.id !== browser.runtime.id) return;
        const state = sanitizeFrameState(message.state);
        if (message.state !== null && state === null) return;
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
          frameMap.set(frameId, state);
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
          await updatePinnedUrl(tabId, current.url, sender.tab.url);
          tabsInfo.set(tabId, {
            ...current,
            audible: sender.tab.audible ?? current.audible,
            muted: sender.tab.mutedInfo?.muted ?? current.muted,
            title: sender.tab.title ?? current.title,
            favIconUrl: sender.tab.favIconUrl ?? current.favIconUrl,
            url: sender.tab.url ?? current.url
          });
          noteYouTubeVideo(tabId, sender.tab.url ?? current.url);
        }
        scheduleFrameUpdates();
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
    await updatePinnedUrl(tabId, prevUrl, newUrl);
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
    const isAudible = changeInfo.audible ?? tab.audible ?? current.audible;
    tabsInfo.set(tabId, {
      audible: isAudible,
      muted: changeInfo.mutedInfo?.muted ?? tab.mutedInfo?.muted ?? current.muted,
      title: changeInfo.title ?? tab.title ?? current.title,
      favIconUrl: changeInfo.favIconUrl ?? tab.favIconUrl ?? current.favIconUrl,
      url: changeInfo.url ?? tab.url ?? current.url
    });
    noteYouTubeVideo(tabId, changeInfo.url ?? tab.url ?? current.url);
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
    pinnedTabOrder = pinnedTabOrder.filter((id) => id !== tabId);
    youtubeVideoHistory.delete(tabId);
    youtubeBackTargets.delete(tabId);
    tabChapterVideo.delete(tabId);
    persistState();
    broadcastSessions();
  });
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === "popup" && port.sender?.id === browser.runtime.id && port.sender.url?.split(/[?#]/, 1)[0] === browser.runtime.getURL("popup.html")) {
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
        if (!rawMsg || typeof rawMsg !== "object") return;
        const msg = rawMsg;
        if ("tabId" in msg && (!Number.isInteger(msg.tabId) || msg.tabId < 0)) return;
        if (msg.type === "reorder" && (!Array.isArray(msg.tabIds) || msg.tabIds.length > openTabIds.size || new Set(msg.tabIds).size !== msg.tabIds.length || !msg.tabIds.every((id) => Number.isInteger(id) && openTabIds.has(id)))) return;
        if (msg.type === "mute" && typeof msg.muted !== "boolean") return;
        if (msg.type === "pin" && typeof msg.pinned !== "boolean") return;
        if (msg.type === "cmd") {
          const cmd = sanitizeCommand(msg.cmd);
          if (!cmd || msg.frameId !== void 0 && (!Number.isInteger(msg.frameId) || msg.frameId < 0)) return;
          msg.cmd = cmd;
          if (msg.cmd.action === "nexttrack") {
            try {
              const tab = await browser.tabs.get(msg.tabId);
              if (isYouTubeVideoWatchUrl(tab.url)) {
                const result = await browser.scripting.executeScript({
                  target: { tabId: msg.tabId, frameIds: [0] },
                  world: "MAIN",
                  func: advanceYouTubeVideoInPage
                });
                if (result[0]?.result === true) return;
              }
            } catch (err) {
              console.warn("[MediaControls Background] YouTube Next command failed:", err);
            }
          }
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
            let preferredFrameId = frameId;
            if (msg.cmd.action === "play" || msg.cmd.action === "pause") {
              try {
                const url = new URL(tabsInfo.get(msg.tabId)?.url || "");
                if (url.hostname === "open.spotify.com") preferredFrameId = 0;
              } catch (_) {
              }
            }
            const relayMsg = {
              type: "cmd",
              cmd: msg.cmd
            };
            let handled = false;
            try {
              handled = await browser.tabs.sendMessage(msg.tabId, relayMsg, { frameId: preferredFrameId }) === true;
            } catch (err) {
              if (msg.cmd.action === "play" || msg.cmd.action === "pause") {
                await injectScriptsIntoTab(msg.tabId);
                try {
                  handled = await browser.tabs.sendMessage(msg.tabId, relayMsg, { frameId: preferredFrameId }) === true;
                } catch (retryErr) {
                  console.warn("[MediaControls Background] Failed to send cmd to frame:", retryErr);
                }
              } else {
                console.warn("[MediaControls Background] Failed to send cmd to frame:", err);
              }
            }
            if (!handled && preferredFrameId !== frameId) {
              try {
                handled = await browser.tabs.sendMessage(msg.tabId, relayMsg, { frameId }) === true;
              } catch (_) {
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
          pinnedTabOrder = msg.tabIds.filter((tabId) => pinnedTabIds.has(tabId));
          const reorderedPinnedKeys = pinnedTabOrder.map((tabId) => knownOrderKey(tabsInfo.get(tabId)?.url)).filter((url) => url.length > 0);
          const absentPinnedKeys = [...pinnedKeys];
          for (const url of reorderedPinnedKeys) {
            const index = absentPinnedKeys.indexOf(url);
            if (index >= 0) absentPinnedKeys.splice(index, 1);
          }
          pinnedKeys = [...reorderedPinnedKeys, ...absentPinnedKeys];
          customOrderKeys = msg.tabIds.map((tabId) => knownOrderKey(tabsInfo.get(tabId)?.url)).filter((url) => url.length > 0);
          try {
            await browser.storage.local.set({ customOrderKeys, pinnedKeys, pinnedOrderMigrated: true });
          } catch (err) {
            console.warn("[MediaControls Background] Failed to save card order:", err);
          }
          await persistState();
          broadcastSessions();
        } else if (msg.type === "pin") {
          const url = knownOrderKey(tabsInfo.get(msg.tabId)?.url);
          if (msg.pinned) {
            if (!pinnedTabIds.has(msg.tabId)) {
              pinnedTabIds.add(msg.tabId);
              pinnedTabOrder.push(msg.tabId);
              if (url) pinnedKeys.push(url);
            }
          } else {
            pinnedTabIds.delete(msg.tabId);
            pinnedTabOrder = pinnedTabOrder.filter((id) => id !== msg.tabId);
            const urlIndex = pinnedKeys.indexOf(url);
            if (urlIndex >= 0) pinnedKeys.splice(urlIndex, 1);
          }
          try {
            await browser.storage.local.set({ pinnedKeys, pinnedOrderMigrated: true });
          } catch (err) {
            console.warn("[MediaControls Background] Failed to save pinned cards:", err);
          }
          await persistState();
          broadcastSessions();
        } else if (msg.type === "chapters-request") {
          const currentUrl = tabsInfo.get(msg.tabId)?.url;
          let videoId = youtubeWatchVideoId(currentUrl) || "";
          let chapters = [];
          let status = "error";
          try {
            const tab = await browser.tabs.get(msg.tabId);
            if (isYouTubeVideoWatchUrl(tab.url)) {
              videoId = youtubeWatchVideoId(tab.url) || "";
              const cached = chapterCache.get(videoId);
              if (cached) {
                status = cached.status;
                chapters = cached.status === "available" ? [...cached.chapters] : [];
              } else {
                chapterAttempts.delete(videoId);
                await ensureYouTubeChapters(msg.tabId, videoId);
                const fresh = chapterCache.get(videoId);
                if (fresh) {
                  status = fresh.status;
                  chapters = fresh.status === "available" ? [...fresh.chapters] : [];
                }
              }
            }
          } catch (err) {
            console.warn("[MediaControls Background] Could not read YouTube chapters:", err);
            status = "error";
          }
          try {
            port.postMessage({ type: "chapters", tabId: msg.tabId, videoId, chapters, status });
          } catch (_) {
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
        void browser.storage.session.set({ lastOrderedTabIds: [] }).catch(() => {
        });
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
