"use strict";
(() => {
  // src/page-hook.ts
  (() => {
    if (window.__mcx_hook_installed) {
      try {
        window.postMessage({ __mcx: "down", type: "query-state" }, "*");
      } catch (_) {
      }
      return;
    }
    window.__mcx_hook_installed = true;
    const MEDIA_EVENTS = [
      "play",
      "playing",
      "seeking",
      "pause",
      "ended",
      "seeked",
      "ratechange",
      "durationchange",
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "canplaythrough",
      "emptied",
      "volumechange",
      "waiting"
    ];
    const handlers = {};
    let sessionMetadata = null;
    let sessionPlaybackState = "none";
    let sessionPositionState = null;
    let hasEverPlayedMediaSession = false;
    const trackedElements = /* @__PURE__ */ new Set();
    const trackedAudioContexts = /* @__PURE__ */ new Set();
    const suspendedByUs = /* @__PURE__ */ new WeakSet();
    const elementsPlayedWithAudio = /* @__PURE__ */ new WeakSet();
    const waitingForData = /* @__PURE__ */ new WeakSet();
    const pausedByUs = /* @__PURE__ */ new Set();
    let lastPausedElement = null;
    let lastPausedTime = 0;
    let lastPlayedAtEpoch = Date.now();
    let activePrimaryElement = null;
    let activeAudioContext = null;
    let currentFrameState = null;
    let evalTimer = null;
    let bufferingPollTimer = null;
    let lastKnownHref = typeof window !== "undefined" && window.location ? window.location.href : "";
    let pendingColdPlayUntil = 0;
    let ytPlayGeneration = 0;
    let lastPlaybackCommand = null;
    let lastPlaybackCommandAt = 0;
    let spotifyPlaybackGeneration = 0;
    let autoplayBlocked = false;
    let hasConfirmedPlayback = false;
    let hadTrustedGesture = false;
    function isAutoplayDenied(el) {
      try {
        const getPolicy = navigator.getAutoplayPolicy;
        if (!getPolicy) return null;
        return getPolicy.call(navigator, el || "mediaelement") !== "allowed";
      } catch (_) {
        return null;
      }
    }
    function setAutoplayBlocked(blocked) {
      if (autoplayBlocked === blocked) return;
      autoplayBlocked = blocked;
      scheduleEvaluation();
    }
    function isInlinePreviewElement(el) {
      try {
        if (!el || !(el instanceof HTMLMediaElement)) return true;
        if (el.closest(
          ".inline-preview-player, #inline-preview-player, ytd-video-preview, [data-layer='preview'], ytd-thumbnail, .ytd-thumbnail"
        )) {
          return true;
        }
        const className = typeof el.className === "string" ? el.className.toLowerCase() : "";
        const id = typeof el.id === "string" ? el.id.toLowerCase() : "";
        if (className.includes("preview") || id.includes("preview")) {
          return true;
        }
        return false;
      } catch (_) {
        return false;
      }
    }
    function getYouTubeVideoId() {
      try {
        if (typeof window === "undefined" || !window.location) return null;
        const host = window.location.hostname.toLowerCase();
        if (!host.includes("youtube.com") && !host.includes("youtu.be")) return null;
        const path = window.location.pathname.toLowerCase();
        if (path.includes("/watch")) {
          return new URL(window.location.href).searchParams.get("v") || null;
        }
        if (path.startsWith("/shorts/")) {
          const parts = window.location.pathname.split("/");
          return parts[2] || null;
        }
        if (path.startsWith("/live/")) {
          const parts = window.location.pathname.split("/");
          return parts[2] || null;
        }
        return null;
      } catch (_) {
        return null;
      }
    }
    function doesArtworkMatchYouTubeVideo(meta, videoId) {
      if (!meta || !videoId) return false;
      if (!meta.artwork || meta.artwork.length === 0) return true;
      return meta.artwork.some((art) => art && typeof art.src === "string" && art.src.includes(videoId));
    }
    function isWatchOrPlayerPage() {
      if (typeof window === "undefined" || !window.location) return false;
      try {
        const loc = window.location;
        const host = loc.hostname.toLowerCase();
        const path = loc.pathname.toLowerCase();
        if (host.includes("youtube.com") || host.includes("youtu.be")) {
          return Boolean(getYouTubeVideoId());
        }
        if (host.includes("spotify.com") || host.includes("soundcloud.com") || host.includes("twitch.tv") || host.includes("vimeo.com") || host.includes("dailymotion.com") || host.includes("bandcamp.com") || host.includes("music.apple.com") || host.includes("deezer.com") || host.includes("tidal.com")) {
          return true;
        }
        if (/\.(mp4|webm|mp3|ogg|wav|m4a|flac|aac)(\?.*)?$/i.test(path)) {
          return true;
        }
        return false;
      } catch (_) {
        return false;
      }
    }
    function getYouTubeMetadata() {
      try {
        if (typeof window === "undefined" || !window.location) return null;
        const host = window.location.hostname.toLowerCase();
        if (!host.includes("youtube.com") && !host.includes("youtu.be")) return null;
        let title = "";
        let artist = "";
        const urlVideoId = getYouTubeVideoId() || "";
        let videoId = urlVideoId;
        const yt = document.getElementById("movie_player");
        if (yt && typeof yt.getVideoData === "function") {
          const data = yt.getVideoData();
          if (data && (!urlVideoId || data.video_id === urlVideoId)) {
            if (data.title) title = data.title;
            if (data.author) artist = data.author;
            if (data.video_id) videoId = data.video_id;
          }
        }
        if (!title) {
          const titleEl = document.querySelector(
            "h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string, ytd-watch-metadata #title, #container h1.title"
          );
          if (titleEl && titleEl.textContent) {
            title = titleEl.textContent.trim();
          }
        }
        if (!title && document.title) {
          title = document.title.replace(/ - YouTube$/, "").trim();
          if (title === "YouTube") title = "";
        }
        if (!artist) {
          const channelEl = document.querySelector(
            "#owner #channel-name a, ytd-channel-name a, #channel-name yt-formatted-string, #upload-info #channel-name"
          );
          if (channelEl && channelEl.textContent) {
            artist = channelEl.textContent.trim();
          }
        }
        const artwork = [];
        if (videoId) {
          artwork.push({
            src: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            sizes: "480x360",
            type: "image/jpeg"
          });
        }
        if (title) {
          return {
            title,
            artist,
            album: "YouTube",
            artwork
          };
        }
      } catch (_) {
      }
      return null;
    }
    function simulateClick(el) {
      try {
        el.click();
      } catch (_) {
      }
    }
    function isPlayStateButton(btn) {
      const label = (btn.getAttribute("aria-label") || btn.getAttribute("title") || btn.getAttribute("data-title-no-tooltip") || "").toLowerCase();
      if (label.includes("pause")) return false;
      if (label.includes("play")) return true;
      return true;
    }
    function isPauseStateButton(btn) {
      const label = (btn.getAttribute("aria-label") || btn.getAttribute("title") || btn.getAttribute("data-title-no-tooltip") || "").toLowerCase();
      if (label.includes("play") && !label.includes("pause")) return false;
      if (label.includes("pause")) return true;
      return true;
    }
    function resetSessionState() {
      sessionMetadata = null;
      sessionPlaybackState = "none";
      sessionPositionState = null;
      hasEverPlayedMediaSession = false;
      lastPausedElement = null;
      activePrimaryElement = null;
      currentFrameState = null;
      autoplayBlocked = false;
      hasConfirmedPlayback = false;
      hadTrustedGesture = false;
    }
    function handleLocationChange() {
      if (typeof window === "undefined" || !window.location) return;
      const currentHref = window.location.href;
      if (currentHref === lastKnownHref) return;
      const oldHref = lastKnownHref;
      lastKnownHref = currentHref;
      try {
        const oldUrl = new URL(oldHref);
        const newUrl = new URL(currentHref);
        const isYouTube = newUrl.hostname.includes("youtube.com") || newUrl.hostname.includes("youtu.be");
        if (isYouTube) {
          const getVid = (u) => {
            if (u.pathname.includes("/watch")) return u.searchParams.get("v") || "";
            if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || "";
            if (u.pathname.startsWith("/live/")) return u.pathname.split("/")[2] || "";
            return "";
          };
          const oldVid = getVid(oldUrl);
          const newVid = getVid(newUrl);
          const wasWatch = Boolean(oldVid);
          const isWatch = Boolean(newVid);
          if (wasWatch && !isWatch || oldVid && newVid && oldVid !== newVid || !wasWatch && !isWatch || wasWatch && oldUrl.pathname !== newUrl.pathname) {
            resetSessionState();
            postState(null);
            scheduleEvaluation();
            return;
          }
        } else {
          if (oldUrl.pathname !== newUrl.pathname) {
            const elements = pruneAndGetElements().filter((el) => !isInlinePreviewElement(el));
            const isPlaying = elements.some((el) => !el.paused && !el.ended);
            if (!isPlaying) {
              resetSessionState();
              postState(null);
              scheduleEvaluation();
              return;
            }
          }
        }
      } catch (_) {
      }
      scheduleEvaluation();
    }
    try {
      const origPushState = history.pushState;
      history.pushState = function(...args) {
        const res = origPushState.apply(this, args);
        handleLocationChange();
        return res;
      };
    } catch (_) {
    }
    try {
      const origReplaceState = history.replaceState;
      history.replaceState = function(...args) {
        const res = origReplaceState.apply(this, args);
        handleLocationChange();
        return res;
      };
    } catch (_) {
    }
    window.addEventListener("popstate", handleLocationChange, true);
    window.addEventListener("hashchange", handleLocationChange, true);
    const onYtNavigate = () => {
      handleLocationChange();
      [100, 300, 600, 1200, 2500].forEach((delay) => {
        setTimeout(scheduleEvaluation, delay);
      });
    };
    window.addEventListener("yt-navigate-finish", onYtNavigate, true);
    document.addEventListener("yt-navigate-finish", onYtNavigate, true);
    function findAllMediaElements(root = document) {
      const list = [];
      try {
        const direct = root.querySelectorAll("audio, video");
        for (let i = 0; i < direct.length; i++) {
          if (!isInlinePreviewElement(direct[i])) {
            list.push(direct[i]);
          }
        }
        const all = root.querySelectorAll("*");
        for (let i = 0; i < all.length; i++) {
          if (all[i].shadowRoot) {
            list.push(...findAllMediaElements(all[i].shadowRoot));
          }
        }
      } catch (_) {
      }
      return list;
    }
    function pruneAndGetElements() {
      const list = [];
      for (const ref of trackedElements) {
        const el = ref.deref();
        if (!el) {
          trackedElements.delete(ref);
        } else if (!isInlinePreviewElement(el)) {
          list.push(el);
        }
      }
      try {
        const domElements = findAllMediaElements(document);
        for (let i = 0; i < domElements.length; i++) {
          if (!isInlinePreviewElement(domElements[i])) {
            registerElement(domElements[i]);
            if (!list.includes(domElements[i])) {
              list.push(domElements[i]);
            }
          }
        }
      } catch (_) {
      }
      return list;
    }
    function pruneAndGetAudioContexts() {
      const list = [];
      for (const ref of trackedAudioContexts) {
        const ctx = ref.deref();
        if (!ctx || ctx.state === "closed") {
          trackedAudioContexts.delete(ref);
        } else {
          list.push(ctx);
        }
      }
      return list;
    }
    function registerElement(el) {
      if (!el || !(el instanceof HTMLMediaElement)) return;
      if (isInlinePreviewElement(el)) return;
      for (const ref of trackedElements) {
        if (ref.deref() === el) return;
      }
      trackedElements.add(new WeakRef(el));
    }
    function extractMetadata(meta) {
      if (!meta) return null;
      try {
        const artworkList = [];
        if (meta.artwork) {
          for (const art of Array.from(meta.artwork)) {
            if (art && typeof art.src === "string") {
              artworkList.push({
                src: art.src,
                sizes: art.sizes,
                type: art.type
              });
            }
          }
        }
        return {
          title: meta.title || "",
          artist: meta.artist || "",
          album: meta.album || "",
          artwork: artworkList
        };
      } catch (_) {
        return null;
      }
    }
    function hasValidMetadata(m) {
      if (!m) return false;
      return Boolean(m.title.trim() || m.artist.trim() || m.artwork && m.artwork.length > 0);
    }
    function scheduleEvaluation() {
      handleLocationChange();
      if (evalTimer !== null) {
        clearTimeout(evalTimer);
      }
      evalTimer = window.setTimeout(() => {
        evalTimer = null;
        handleLocationChange();
        evaluatePrimaryMedia();
      }, 50);
    }
    function postState(state) {
      currentFrameState = state;
      if (state?.buffering) {
        if (bufferingPollTimer === null) {
          bufferingPollTimer = window.setTimeout(() => {
            bufferingPollTimer = null;
            scheduleEvaluation();
          }, 300);
        }
      } else if (bufferingPollTimer !== null) {
        clearTimeout(bufferingPollTimer);
        bufferingPollTimer = null;
      }
      const msg = {
        __mcx: "up",
        state
      };
      try {
        window.postMessage(msg, "*");
      } catch (_) {
      }
    }
    function isElementSeekable(el) {
      return isFinite(el.duration) && el.duration > 0;
    }
    function availableTrackActions() {
      const actions = [];
      if (isTrackActionAvailable("previoustrack")) {
        actions.push("previoustrack");
      }
      if (isTrackActionAvailable("nexttrack")) {
        actions.push("nexttrack");
      }
      return actions;
    }
    function evaluatePrimaryMedia() {
      const elements = pruneAndGetElements().filter((el) => !isInlinePreviewElement(el));
      const audioContexts = pruneAndGetAudioContexts();
      const isYouTube = typeof window !== "undefined" && window.location && (window.location.hostname.includes("youtube.com") || window.location.hostname.includes("youtu.be"));
      const playingElements = elements.filter(
        (el) => !el.paused && !el.ended
      );
      const audiblePlaying = playingElements.filter(
        (el) => !el.muted && el.volume > 0
      );
      const ytVideoId = isYouTube ? getYouTubeVideoId() : null;
      const ytMedia = audiblePlaying[0] || playingElements[0] || activePrimaryElement || elements[0];
      let ytPlayerBuffering = false;
      if (isYouTube) {
        try {
          ytPlayerBuffering = getYtPlayer()?.getPlayerState?.() === 3;
        } catch (_) {
        }
      }
      const buffering = Boolean(
        isYouTube && ytVideoId && !autoplayBlocked && (hasConfirmedPlayback || hadTrustedGesture) && (ytPlayerBuffering || ytMedia && !ytMedia.ended && (ytMedia.seeking || waitingForData.has(ytMedia)))
      );
      if (isYouTube && !ytVideoId && audiblePlaying.length === 0) {
        resetSessionState();
        postState(null);
        return;
      }
      if (isYouTube && ytVideoId && sessionMetadata && !doesArtworkMatchYouTubeVideo(sessionMetadata, ytVideoId)) {
        sessionMetadata = null;
      }
      let currentNavMeta = sessionMetadata;
      let currentPlaybackState = sessionPlaybackState;
      if (isYouTube) {
        const ytMeta = getYouTubeMetadata();
        if (ytMeta) {
          if (!currentNavMeta || !doesArtworkMatchYouTubeVideo(currentNavMeta, ytVideoId)) {
            currentNavMeta = ytMeta;
          } else {
            currentNavMeta = {
              title: ytMeta.title || currentNavMeta.title,
              artist: ytMeta.artist || currentNavMeta.artist,
              album: currentNavMeta.album || "YouTube",
              artwork: currentNavMeta.artwork?.length ? currentNavMeta.artwork : ytMeta.artwork || []
            };
          }
        }
      } else {
        if (!currentNavMeta && typeof navigator !== "undefined" && navigator.mediaSession?.metadata) {
          if (playingElements.length > 0 || audiblePlaying.length > 0 || hasEverPlayedMediaSession) {
            const extracted = extractMetadata(navigator.mediaSession.metadata);
            if (hasValidMetadata(extracted)) {
              currentNavMeta = extracted;
            }
          }
        }
        if (currentPlaybackState === "none" && typeof navigator !== "undefined" && navigator.mediaSession?.playbackState) {
          if (playingElements.length > 0 || audiblePlaying.length > 0) {
            currentPlaybackState = navigator.mediaSession.playbackState;
          }
        }
      }
      const isPlayerPage = isWatchOrPlayerPage();
      if (!hasConfirmedPlayback && (isPlayerPage || elements.length > 0) && isAutoplayDenied(activePrimaryElement || elements[0] || null) === true) {
        autoplayBlocked = true;
      }
      if (!hasValidMetadata(currentNavMeta) && isPlayerPage && elements.length > 0) {
        const firstEl = elements[0];
        const poster = firstEl instanceof HTMLVideoElement ? firstEl.poster : "";
        const title = document.title || "Media";
        currentNavMeta = {
          title,
          artist: "",
          album: "",
          artwork: poster ? [{ src: poster }] : []
        };
      }
      if (isYouTube && ytVideoId && !hasValidMetadata(currentNavMeta)) {
        let fallbackTitle = "";
        try {
          fallbackTitle = (document.title || "").replace(/ - YouTube$/, "").trim();
          if (fallbackTitle === "YouTube") fallbackTitle = "";
        } catch (_) {
          fallbackTitle = "";
        }
        currentNavMeta = {
          title: fallbackTitle || "YouTube video",
          artist: "",
          album: "YouTube",
          artwork: [
            {
              src: `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`,
              sizes: "480x360",
              type: "image/jpeg"
            }
          ]
        };
      }
      const hasMediaMeta = hasValidMetadata(currentNavMeta);
      const canShowPaused = hasEverPlayedMediaSession || isPlayerPage;
      const realPlaybackActive = isYouTube ? isYtPlaying() && (hadTrustedGesture || audiblePlaying.some((el) => el.currentTime > 0.1)) : playingElements.some((el) => el.currentTime > 0.1 && (hadTrustedGesture || !el.muted && el.volume > 0));
      if (autoplayBlocked && realPlaybackActive) {
        autoplayBlocked = false;
        hasConfirmedPlayback = true;
        hasEverPlayedMediaSession = true;
      }
      const mediaSessionPlaying = !autoplayBlocked && (audiblePlaying.length > 0 || playingElements.length > 0 && hasEverPlayedMediaSession || sessionPlaybackState !== "paused" && currentPlaybackState === "playing" && (playingElements.length > 0 || isPlayerPage));
      const mediaSessionPaused = canShowPaused && !mediaSessionPlaying && (currentPlaybackState === "paused" || sessionPlaybackState === "paused" || autoplayBlocked || playingElements.length === 0 || !audiblePlaying.length);
      if (hasMediaMeta && (mediaSessionPlaying || mediaSessionPaused)) {
        if (mediaSessionPlaying) {
          hasEverPlayedMediaSession = true;
          lastPlayedAtEpoch = Date.now();
        }
        const primaryEl = audiblePlaying[0] || playingElements[0] || elements.find((el) => elementsPlayedWithAudio.has(el)) || (canShowPaused ? elements[0] : null) || null;
        activePrimaryElement = primaryEl;
        activeAudioContext = null;
        const pState = mediaSessionPlaying ? "playing" : "paused";
        let position = null;
        if (sessionPositionState && typeof sessionPositionState.duration === "number" && sessionPositionState.duration > 0) {
          position = {
            ...sessionPositionState,
            playbackRate: mediaSessionPlaying ? sessionPositionState.playbackRate || 1 : 0,
            updatedAt: Date.now()
          };
        } else if (primaryEl) {
          let dur = isFinite(primaryEl.duration) ? primaryEl.duration : 0;
          let pos = primaryEl.currentTime || 0;
          if ((!dur || isNaN(dur)) && isYouTube) {
            try {
              const yt = document.getElementById("movie_player");
              const ytData = yt?.getVideoData?.();
              if (!ytVideoId || !ytData || ytData.video_id === ytVideoId) {
                if (typeof yt?.getDuration === "function") {
                  const ytDur = yt.getDuration();
                  if (typeof ytDur === "number" && isFinite(ytDur) && ytDur > 0) {
                    dur = ytDur;
                  }
                }
                if (typeof yt?.getCurrentTime === "function") {
                  const ytPos = yt.getCurrentTime();
                  if (typeof ytPos === "number" && isFinite(ytPos)) {
                    pos = ytPos;
                  }
                }
              }
            } catch (_) {
            }
          }
          position = {
            duration: dur,
            position: pos,
            playbackRate: mediaSessionPlaying ? primaryEl.playbackRate || 1 : 0,
            updatedAt: Date.now()
          };
        } else if (isYouTube) {
          try {
            const yt = document.getElementById("movie_player");
            const ytData = yt?.getVideoData?.();
            if (!ytVideoId || !ytData || ytData.video_id === ytVideoId) {
              if (typeof yt?.getDuration === "function") {
                const ytDur = yt.getDuration();
                const ytPos = yt.getCurrentTime?.() ?? 0;
                if (typeof ytDur === "number" && isFinite(ytDur) && ytDur > 0) {
                  position = {
                    duration: ytDur,
                    position: ytPos,
                    playbackRate: mediaSessionPlaying ? 1 : 0,
                    updatedAt: Date.now()
                  };
                }
              }
            }
          } catch (_) {
          }
        } else if (currentFrameState?.position) {
          position = {
            ...currentFrameState.position,
            playbackRate: 0,
            updatedAt: Date.now()
          };
        }
        const isLive = Boolean(
          position && (position.duration === Infinity || !isFinite(position.duration))
        );
        const isSeekable = Boolean(
          !isLive && (position && position.duration > 0 || primaryEl && isElementSeekable(primaryEl) || handlers["seekto"] || currentFrameState?.seekable)
        );
        const actionsSet = new Set(Object.keys(handlers));
        actionsSet.delete("previoustrack");
        actionsSet.delete("nexttrack");
        actionsSet.add("play");
        actionsSet.add("pause");
        for (const action of availableTrackActions()) actionsSet.add(action);
        if (isSeekable) {
          actionsSet.add("seekto");
          actionsSet.add("seekbackward");
          actionsSet.add("seekforward");
        }
        postState({
          source: "mediasession",
          metadata: currentNavMeta,
          playbackState: pState,
          position,
          actions: Array.from(actionsSet),
          isLive,
          seekable: isSeekable,
          volume: getPrimaryVolumeState(),
          lastPlayedAt: lastPlayedAtEpoch,
          playBlocked: autoplayBlocked,
          buffering
        });
        return;
      }
      const audiblePlayingSorted = audiblePlaying.slice().sort((a, b) => {
        const durA = isFinite(a.duration) ? a.duration : 0;
        const durB = isFinite(b.duration) ? b.duration : 0;
        return durB - durA;
      });
      const candidatePlaying = !autoplayBlocked || realPlaybackActive ? audiblePlayingSorted[0] || (hasEverPlayedMediaSession ? playingElements[0] : null) || null : null;
      if (candidatePlaying) {
        activePrimaryElement = candidatePlaying;
        activeAudioContext = null;
        lastPlayedAtEpoch = Date.now();
        const seekable = isElementSeekable(candidatePlaying);
        const isLive = candidatePlaying.duration === Infinity || !isFinite(candidatePlaying.duration) && !isNaN(candidatePlaying.duration);
        const actions = ["play", "pause", ...availableTrackActions()];
        if (seekable) {
          actions.push("seekto", "seekbackward", "seekforward");
        }
        postState({
          source: "element",
          metadata: currentNavMeta && hasValidMetadata(currentNavMeta) ? currentNavMeta : {
            title: document.title || "Media",
            artist: "",
            album: "",
            artwork: []
          },
          playbackState: "playing",
          position: isNaN(candidatePlaying.duration) ? null : {
            duration: candidatePlaying.duration,
            position: candidatePlaying.currentTime || 0,
            playbackRate: candidatePlaying.playbackRate || 1,
            updatedAt: Date.now()
          },
          actions,
          isLive,
          seekable,
          volume: getPrimaryVolumeState(),
          lastPlayedAt: lastPlayedAtEpoch,
          playBlocked: false,
          buffering
        });
        return;
      }
      const candidatePaused = lastPausedElement?.deref() || (activePrimaryElement?.paused && !activePrimaryElement.ended ? activePrimaryElement : null) || (autoplayBlocked ? elements[0] : null);
      const pausedEl = candidatePaused && (elementsPlayedWithAudio.has(candidatePaused) || candidatePaused.currentTime > 0.5 && !candidatePaused.muted || autoplayBlocked) ? candidatePaused : null;
      if (pausedEl && elements.includes(pausedEl) && !pausedEl.ended) {
        activePrimaryElement = pausedEl;
        activeAudioContext = null;
        const seekable = isElementSeekable(pausedEl);
        const isLive = pausedEl.duration === Infinity || !isFinite(pausedEl.duration) && !isNaN(pausedEl.duration);
        const actions = ["play", "pause", ...availableTrackActions()];
        if (seekable) {
          actions.push("seekto", "seekbackward", "seekforward");
        }
        postState({
          source: "element",
          metadata: currentNavMeta && hasValidMetadata(currentNavMeta) ? currentNavMeta : {
            title: document.title || "Media",
            artist: "",
            album: "",
            artwork: []
          },
          playbackState: "paused",
          position: isNaN(pausedEl.duration) ? null : {
            duration: pausedEl.duration,
            position: pausedEl.currentTime || 0,
            playbackRate: 0,
            updatedAt: Date.now()
          },
          actions,
          isLive,
          seekable,
          volume: getPrimaryVolumeState(),
          lastPlayedAt: lastPlayedAtEpoch,
          playBlocked: autoplayBlocked,
          buffering
        });
        return;
      }
      const activeCtx = audioContexts.find(
        (ctx) => ctx.state === "running" || ctx.state === "suspended" && suspendedByUs.has(ctx)
      );
      if (activeCtx) {
        activePrimaryElement = null;
        activeAudioContext = activeCtx;
        const isPlaying = activeCtx.state === "running";
        if (isPlaying) {
          lastPlayedAtEpoch = Date.now();
        }
        postState({
          source: "webaudio",
          metadata: {
            title: document.title || "Web Audio",
            artist: "",
            album: "",
            artwork: []
          },
          playbackState: isPlaying ? "playing" : "paused",
          position: null,
          actions: ["play", "pause", ...availableTrackActions()],
          isLive: true,
          seekable: false,
          volume: null,
          lastPlayedAt: lastPlayedAtEpoch,
          playBlocked: autoplayBlocked
        });
        return;
      }
      if (hasEverPlayedMediaSession && currentFrameState && currentFrameState.playbackState !== "none" && (!isYouTube || ytVideoId && doesArtworkMatchYouTubeVideo(currentFrameState.metadata, ytVideoId))) {
        if (activePrimaryElement && !elements.includes(activePrimaryElement)) {
          activePrimaryElement = null;
        }
        const previous = currentFrameState;
        postState({
          ...previous,
          playbackState: "paused",
          playBlocked: autoplayBlocked,
          buffering: false,
          position: previous.position ? {
            ...previous.position,
            playbackRate: 0,
            updatedAt: Date.now()
          } : null,
          volume: getPrimaryVolumeState() ?? previous.volume ?? null,
          actions: Array.from(/* @__PURE__ */ new Set([
            ...Object.keys(handlers).filter(
              (action) => action !== "previoustrack" && action !== "nexttrack"
            ),
            ...availableTrackActions(),
            "play",
            "pause",
            ...previous.seekable ? ["seekto", "seekbackward", "seekforward"] : []
          ]))
        });
        return;
      }
      activePrimaryElement = null;
      activeAudioContext = null;
      postState(null);
    }
    const NEXT_SELECTORS = [
      ".ytp-next-button",
      "button[data-testid='control-button-skip-forward']",
      "button.playControls__next",
      "tp-yt-paper-icon-button.next-button",
      "button.next-button",
      ".next-button",
      "[data-testid='next-button']",
      "button[data-a-target='player-next-button']",
      "button[aria-label*='Next track' i]",
      "[role='button'][aria-label*='Next track' i]",
      "button[aria-label*='Next video' i]",
      "[role='button'][aria-label*='Next video' i]",
      "button[aria-label*='Next' i]",
      "[role='button'][aria-label*='Next' i]",
      "button[title*='Next' i]",
      "[role='button'][title*='Next' i]",
      "button[aria-label*='Suivant' i]",
      "button[aria-label*='Siguiente' i]",
      "button.next"
    ];
    const PREV_SELECTORS = [
      ".ytp-prev-button",
      "button[data-testid='control-button-skip-back']",
      "button.playControls__prev",
      "tp-yt-paper-icon-button.previous-button",
      "button.previous-button",
      ".prev-button",
      "[data-testid='previous-button']",
      "button[data-a-target='player-prev-button']",
      "button[aria-label*='Previous track' i]",
      "[role='button'][aria-label*='Previous track' i]",
      "button[aria-label*='Previous video' i]",
      "[role='button'][aria-label*='Previous video' i]",
      "button[aria-label*='Previous' i]",
      "[role='button'][aria-label*='Previous' i]",
      "button[title*='Previous' i]",
      "[role='button'][title*='Previous' i]",
      "button[aria-label*='Pr\xE9c\xE9dent' i]",
      "button[aria-label*='Anterior' i]",
      "button.prev"
    ];
    const PLAY_SELECTORS = [
      ".ytp-large-play-button",
      "button.ytp-large-play-button",
      ".ytp-cued-thumbnail-overlay button",
      ".ytp-play-button",
      "button.ytp-play-button",
      "#play-pause-button",
      "button#play-pause-button",
      "button[data-testid='control-button-playpause']",
      "button[data-testid='play-button']",
      "button[data-a-target='player-play-pause-button']",
      "button.playControls__play",
      "button[aria-label*='Play' i]",
      "[role='button'][aria-label*='Play' i]",
      "button[title*='Play' i]",
      "[role='button'][title*='Play' i]",
      ".play-button",
      "button.play"
    ];
    const PAUSE_SELECTORS = [
      ".ytp-play-button",
      "button.ytp-play-button",
      "#play-pause-button",
      "button#play-pause-button",
      "button[data-testid='control-button-playpause']",
      "button[data-testid='pause-button']",
      "button[data-a-target='player-play-pause-button']",
      "button.playControls__play",
      "button[aria-label*='Pause' i]",
      "[role='button'][aria-label*='Pause' i]",
      "button[title*='Pause' i]",
      "[role='button'][title*='Pause' i]",
      ".pause-button",
      "button.pause"
    ];
    const TRACK_CONTROL_SELECTOR = [
      ...NEXT_SELECTORS.slice(0, 8),
      ...PREV_SELECTORS.slice(0, 8)
    ].join(", ");
    function isTrackButtonDisabled(button) {
      try {
        return button.matches(":disabled") || button.getAttribute("aria-disabled") === "true" || button.getAttribute("data-disabled") === "true" || button.classList.contains("disabled") || button.classList.contains("is-disabled") || button.classList.contains("ytp-disabled");
      } catch (_) {
        return false;
      }
    }
    function isTrackButtonUsable(button) {
      try {
        if (!button.isConnected || isTrackButtonDisabled(button) || button.closest("[hidden], [inert]")) return false;
        const style = window.getComputedStyle(button);
        return style.display !== "none" && style.visibility !== "hidden" && button.getClientRects().length > 0;
      } catch (_) {
        return false;
      }
    }
    function getTrackButtonStatus(selectors) {
      for (const selector of selectors) {
        try {
          const buttons = document.querySelectorAll(selector);
          if (buttons.length > 0) {
            const candidates = Array.from(buttons);
            return {
              found: true,
              button: candidates.find(isTrackButtonUsable) || null,
              disabled: candidates.every(isTrackButtonDisabled)
            };
          }
        } catch (_) {
        }
      }
      for (const selector of selectors) {
        const button = findButtonInShadowRoots(selector, document);
        if (button) {
          return { found: true, button: isTrackButtonUsable(button) ? button : null, disabled: isTrackButtonDisabled(button) };
        }
      }
      return { found: false, button: null, disabled: false };
    }
    function isTrackActionAvailable(action) {
      if (action === "nexttrack" && getYouTubeSuggestedNextVideoId()) return true;
      const playlist = getYouTubePlaylistPosition();
      if (action === "previoustrack" && playlist && playlist.index === 0) {
        return false;
      }
      if (playlist && (action === "previoustrack" ? playlist.index > 0 : playlist.index < playlist.length - 1)) {
        return true;
      }
      const selectors = action === "previoustrack" ? PREV_SELECTORS : NEXT_SELECTORS;
      const control = getTrackButtonStatus(selectors);
      if (action === "previoustrack" && getYouTubeVideoId()) {
        return Boolean(control.button);
      }
      return Boolean(control.button || !control.disabled && handlers[action]);
    }
    function getYouTubeSuggestedNextVideoId() {
      try {
        const currentId = getYouTubeVideoId();
        if (!currentId || window.location.pathname !== "/watch") return null;
        const idFromHref = (href) => {
          if (!href) return null;
          const url = new URL(href, window.location.href);
          const id = url.searchParams.get("v");
          return /(^|\.)youtube\.com$/.test(url.hostname) && url.pathname === "/watch" && id && /^[\w-]{11}$/.test(id) && id !== currentId ? id : null;
        };
        const data = window.ytInitialData;
        const dataCurrentId = data?.currentVideoEndpoint?.watchEndpoint?.videoId;
        const nextHref = document.querySelector("a.ytp-next-button[href]")?.href;
        const linkId = idFromHref(nextHref ?? null);
        if (linkId) return linkId;
        if (!dataCurrentId || dataCurrentId === currentId) {
          const sets = data?.contents?.twoColumnWatchNextResults?.autoplay?.autoplay?.sets;
          if (Array.isArray(sets)) {
            for (const set of sets) {
              const nextId = set?.autoplayVideo?.watchEndpoint?.videoId;
              if (typeof nextId === "string" && /^[\w-]{11}$/.test(nextId) && nextId !== currentId) {
                return nextId;
              }
            }
          }
        }
        const recommendations = document.querySelectorAll(
          "#secondary a[href*='/watch?'], #related a[href*='/watch?']"
        );
        for (const link of recommendations) {
          const id = idFromHref(link.getAttribute("href"));
          if (id) return id;
        }
        return null;
      } catch (_) {
        return null;
      }
    }
    function getYouTubePlaylistPosition() {
      try {
        const host = window.location.hostname;
        if (!host.includes("youtube.com") && !host.includes("youtu.be")) return null;
        if (!new URL(window.location.href).searchParams.has("list")) return null;
        const player = getYtPlayer();
        const list = player?.getPlaylist?.();
        const index = player?.getPlaylistIndex?.();
        if (Array.isArray(list) && list.length > 0 && Number.isInteger(index) && index >= 0 && index < list.length) {
          return { index, length: list.length };
        }
      } catch (_) {
      }
      return null;
    }
    function findButtonInShadowRoots(selector, root) {
      try {
        const all = root.querySelectorAll("*");
        for (let i = 0; i < all.length; i++) {
          const child = all[i];
          if (child.shadowRoot) {
            const match = child.shadowRoot.querySelector(selector);
            if (match) {
              const disabled = match.disabled || match.getAttribute("aria-disabled") === "true";
              if (!disabled) return match;
            }
            const deepMatch = findButtonInShadowRoots(selector, child.shadowRoot);
            if (deepMatch) return deepMatch;
          }
        }
      } catch (_) {
      }
      return null;
    }
    function findClickableButton(selectors) {
      try {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const disabled = el.disabled || el.getAttribute("aria-disabled") === "true";
            if (!disabled) {
              return el;
            }
          }
        }
        for (const sel of selectors) {
          const el = findButtonInShadowRoots(sel, document);
          if (el) return el;
        }
      } catch (_) {
      }
      return null;
    }
    function playNextTrack() {
      const control = getTrackButtonStatus(NEXT_SELECTORS);
      const playlist = getYouTubePlaylistPosition();
      if (playlist && playlist.index < playlist.length - 1) {
        try {
          const player = getYtPlayer();
          if (typeof player?.nextVideo === "function") {
            player.nextVideo();
            return true;
          }
        } catch (_) {
        }
      }
      const suggestedId = getYouTubeSuggestedNextVideoId();
      if (suggestedId) {
        const currentId = getYouTubeVideoId();
        if (control.button) control.button.click();
        window.setTimeout(() => {
          if (getYouTubeVideoId() === currentId) {
            window.location.assign(`/watch?v=${suggestedId}`);
          }
        }, control.button ? 600 : 0);
        return true;
      }
      if (control.disabled) return false;
      if (window.location.hostname.includes("youtube.com") && control.button) {
        control.button.click();
        return true;
      }
      if (handlers["nexttrack"]) {
        try {
          handlers["nexttrack"].call(navigator.mediaSession, { action: "nexttrack" });
          return true;
        } catch (err) {
          console.warn("[MediaControls] MediaSession nexttrack handler threw:", err);
        }
      }
      if (control.button) {
        control.button.click();
        return true;
      }
      return false;
    }
    function playPreviousTrack() {
      const control = getTrackButtonStatus(PREV_SELECTORS);
      const playlist = getYouTubePlaylistPosition();
      if (playlist?.index === 0) return false;
      if (playlist && playlist.index > 0) {
        try {
          const player = getYtPlayer();
          if (typeof player?.previousVideo === "function") {
            player.previousVideo();
            return true;
          }
        } catch (_) {
        }
      }
      if (control.disabled) return false;
      if (window.location.hostname.includes("youtube.com") && control.button) {
        control.button.click();
        return true;
      }
      if (handlers["previoustrack"]) {
        try {
          handlers["previoustrack"].call(navigator.mediaSession, { action: "previoustrack" });
          return true;
        } catch (err) {
          console.warn("[MediaControls] MediaSession previoustrack handler threw:", err);
        }
      }
      if (control.button) {
        control.button.click();
        return true;
      }
      return false;
    }
    function getYtPlayer() {
      try {
        const yt = document.getElementById("movie_player");
        return yt || null;
      } catch (_) {
        return null;
      }
    }
    function isYtPlaying() {
      try {
        const yt = getYtPlayer();
        if (yt && typeof yt.getPlayerState === "function") {
          try {
            return yt.getPlayerState() === 1;
          } catch (_) {
          }
        }
      } catch (_) {
      }
      try {
        const els = pruneAndGetElements().filter((el2) => !isInlinePreviewElement(el2));
        const el = activePrimaryElement || els[0];
        if (el && !el.paused && !el.ended) {
          if (autoplayBlocked) {
            return el.currentTime > 0.1 || !el.muted && el.volume > 0 && elementsPlayedWithAudio.has(el);
          }
          return true;
        }
      } catch (_) {
      }
      return false;
    }
    function clampVolume01(value) {
      if (typeof value !== "number" || !isFinite(value)) return null;
      if (value <= 0) return 0;
      if (value >= 1) return 1;
      return value;
    }
    function isYouTubeHost() {
      try {
        const host = window.location?.hostname?.toLowerCase() || "";
        return host.includes("youtube.com") || host.includes("youtu.be");
      } catch (_) {
        return false;
      }
    }
    function getPrimaryElementForVolume() {
      try {
        if (activePrimaryElement && activePrimaryElement.isConnected && !isInlinePreviewElement(activePrimaryElement)) {
          return activePrimaryElement;
        }
        const els = pruneAndGetElements().filter((el) => !isInlinePreviewElement(el));
        return activePrimaryElement && !isInlinePreviewElement(activePrimaryElement) ? activePrimaryElement : els[0] || null;
      } catch (_) {
        return activePrimaryElement || null;
      }
    }
    function getPrimaryVolumeState() {
      try {
        const el = getPrimaryElementForVolume();
        if (isYouTubeHost()) {
          try {
            const yt = getYtPlayer();
            if (yt && typeof yt.getVolume === "function") {
              const raw = yt.getVolume();
              if (typeof raw === "number" && isFinite(raw)) {
                const level = clampVolume01(raw / 100);
                if (level !== null) {
                  let mediaMuted = false;
                  try {
                    if (typeof yt.isMuted === "function") {
                      mediaMuted = Boolean(yt.isMuted());
                    } else if (el) {
                      mediaMuted = Boolean(el.muted);
                    }
                  } catch (_) {
                    mediaMuted = el ? Boolean(el.muted) : false;
                  }
                  return { level, mediaMuted };
                }
              }
            }
          } catch (_) {
          }
        }
        if (el) {
          try {
            const rawLevel = el.volume;
            const level = clampVolume01(rawLevel);
            if (level === null) return null;
            return { level, mediaMuted: Boolean(el.muted) };
          } catch (_) {
            return null;
          }
        }
      } catch (_) {
      }
      return null;
    }
    function setPrimaryVolumeLevel(level01) {
      const level = clampVolume01(level01);
      if (level === null) return false;
      let handled = false;
      if (isYouTubeHost()) {
        try {
          const yt = getYtPlayer();
          if (yt && typeof yt.setVolume === "function") {
            yt.setVolume(Math.round(level * 100));
            handled = true;
          }
        } catch (_) {
        }
      }
      try {
        const el = getPrimaryElementForVolume();
        if (el) {
          el.volume = level;
          handled = true;
        }
      } catch (_) {
      }
      return handled;
    }
    function tryPlayElement(el) {
      let p;
      try {
        p = el.play();
      } catch (err) {
        if (err?.name === "NotAllowedError" && !hasConfirmedPlayback) setAutoplayBlocked(true);
        return false;
      }
      p?.catch((err) => {
        if (err?.name === "NotAllowedError" && !hasConfirmedPlayback) setAutoplayBlocked(true);
      });
      return true;
    }
    function spotifyPlaybackButton() {
      if (window.location.hostname !== "open.spotify.com" || window.top !== window) return null;
      const button = document.querySelector('button[data-testid="control-button-playpause"]');
      if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return null;
      const label = (button.getAttribute("aria-label") || "").toLowerCase();
      if (/\bpause\b/.test(label) && !/\bplay\b/.test(label)) return { button, action: "pause" };
      if (/\bplay\b/.test(label) && !/\bpause\b/.test(label)) return { button, action: "play" };
      return null;
    }
    function controlSpotifyPlayback(action, followsOpposite) {
      const control = spotifyPlaybackButton();
      if (!control) return false;
      if (control.action === action) {
        try {
          control.button.click();
        } catch (_) {
          return false;
        }
      } else {
        const generation = spotifyPlaybackGeneration;
        let checks = 0;
        const reconcile = () => {
          if (generation !== spotifyPlaybackGeneration) return;
          const current = spotifyPlaybackButton();
          if (current?.action === action) {
            try {
              current.button.click();
            } catch (_) {
            }
            return;
          }
          if (++checks < 16) window.setTimeout(reconcile, 80);
        };
        window.setTimeout(reconcile, followsOpposite ? 40 : 80);
      }
      return true;
    }
    function pausePlayingElements() {
      let pausedAny = false;
      for (const el of pruneAndGetElements()) {
        if (isInlinePreviewElement(el) || el.paused || el.ended) continue;
        try {
          el.pause();
          if (el.paused) {
            pausedByUs.add(new WeakRef(el));
            pausedAny = true;
          }
        } catch (_) {
        }
      }
      return pausedAny;
    }
    function resumeElementsPausedByUs() {
      let resumedAny = false;
      for (const ref of pausedByUs) {
        pausedByUs.delete(ref);
        const el = ref.deref();
        if (!el || el.ended || !el.paused || isInlinePreviewElement(el)) continue;
        resumedAny = tryPlayElement(el) || resumedAny;
      }
      return resumedAny;
    }
    function playYouTubeOnce(preferElement = false, forcePlay = false) {
      const el = activePrimaryElement || pruneAndGetElements().find((candidate) => !isInlinePreviewElement(candidate)) || document.querySelector("video, audio");
      if (el && !isInlinePreviewElement(el)) {
        registerElement(el);
        if (!forcePlay && !el.paused && !el.ended) return true;
        if (preferElement && tryPlayElement(el)) return true;
      }
      const yt = getYtPlayer();
      if (yt && typeof yt.playVideo === "function") {
        try {
          yt.playVideo();
          return true;
        } catch (_) {
        }
      }
      if (el && !isInlinePreviewElement(el)) {
        if (tryPlayElement(el)) return true;
      }
      const button = findClickableButton(PLAY_SELECTORS);
      if (button && isPlayStateButton(button)) {
        simulateClick(button);
        return true;
      }
      return false;
    }
    function runYouTubePlayLoop(gen, attempt) {
      if (gen !== ytPlayGeneration || autoplayBlocked) return;
      if (isYtPlaying()) {
        hasConfirmedPlayback = true;
        setAutoplayBlocked(false);
        pendingColdPlayUntil = 0;
        scheduleEvaluation();
        return;
      }
      if (Date.now() > pendingColdPlayUntil) {
        scheduleEvaluation();
        return;
      }
      if (attempt >= 12) {
        pendingColdPlayUntil = 0;
        scheduleEvaluation();
        return;
      }
      playYouTubeOnce(attempt > 0);
      window.setTimeout(() => runYouTubePlayLoop(gen, attempt + 1), 450);
      if (attempt % 3 === 0) scheduleEvaluation();
    }
    function tryColdYouTubePlayOnce() {
      if (autoplayBlocked) return false;
      return playYouTubeOnce();
    }
    function executeCommand(cmd) {
      const state = currentFrameState;
      const isYouTube = typeof window !== "undefined" && window.location && (window.location.hostname.includes("youtube.com") || window.location.hostname.includes("youtu.be"));
      const isSpotifyTopFrame = window.location.hostname === "open.spotify.com" && window.top === window;
      const isPanoptoViewer = /\.panopto\.com$/i.test(window.location.hostname) && /\/panopto\/pages\/(?:viewer|embed)\.aspx$/i.test(window.location.pathname);
      if (cmd.action === "nexttrack") {
        const handled = playNextTrack();
        scheduleEvaluation();
        setTimeout(scheduleEvaluation, 300);
        setTimeout(scheduleEvaluation, 1e3);
        return handled;
      }
      if (cmd.action === "previoustrack") {
        const handled = playPreviousTrack();
        scheduleEvaluation();
        setTimeout(scheduleEvaluation, 300);
        setTimeout(scheduleEvaluation, 1e3);
        return handled;
      }
      if (cmd.action === "play") {
        const followsRecentPause = lastPlaybackCommand === "pause" && Date.now() - lastPlaybackCommandAt < 1e3;
        spotifyPlaybackGeneration++;
        lastPlaybackCommand = "play";
        lastPlaybackCommandAt = Date.now();
        const candidate = activePrimaryElement || pruneAndGetElements().find((el2) => !isInlinePreviewElement(el2)) || null;
        if (!hasConfirmedPlayback && !isSpotifyTopFrame && (autoplayBlocked || isAutoplayDenied(candidate) === true)) {
          setAutoplayBlocked(true);
          evaluatePrimaryMedia();
          return false;
        }
        ytPlayGeneration++;
        const gen = ytPlayGeneration;
        let handled = false;
        const elements = pruneAndGetElements().filter((el2) => !isInlinePreviewElement(el2));
        const el = activePrimaryElement || elements[0] || (() => {
          try {
            const direct = document.querySelector("video, audio");
            if (direct && !isInlinePreviewElement(direct)) {
              registerElement(direct);
              return direct;
            }
          } catch (_) {
          }
          return null;
        })();
        if (isYouTube) {
          handled = playYouTubeOnce(false, followsRecentPause);
          if (handled && el) {
            window.setTimeout(() => {
              if (gen === ytPlayGeneration && !autoplayBlocked && !isYtPlaying() && el.paused) {
                tryPlayElement(el);
                scheduleEvaluation();
              }
            }, followsRecentPause ? 100 : 400);
          }
        } else if (isSpotifyTopFrame) {
          handled = controlSpotifyPlayback("play", followsRecentPause);
        } else if (isPanoptoViewer) {
          const button = findClickableButton(PLAY_SELECTORS);
          if (button && isPlayStateButton(button)) {
            simulateClick(button);
            handled = true;
          }
        }
        if (!handled && state?.source === "webaudio" && activeAudioContext) {
          try {
            activeAudioContext.resume().catch(() => {
            });
            suspendedByUs.delete(activeAudioContext);
            handled = true;
          } catch (_) {
          }
        }
        if (!handled && handlers["play"]) {
          try {
            handlers["play"].call(navigator.mediaSession, { action: "play" });
            handled = true;
          } catch (err) {
            console.warn("[MediaControls] MediaSession play handler threw:", err);
          }
        }
        if (!handled) handled = resumeElementsPausedByUs();
        if (!handled && el) handled = !el.paused && !el.ended ? true : tryPlayElement(el);
        if (!handled) {
          const button = findClickableButton(PLAY_SELECTORS);
          if (button && isPlayStateButton(button)) {
            simulateClick(button);
            handled = true;
          }
        }
        if (handled && !isYouTube && !isSpotifyTopFrame) {
          window.setTimeout(() => {
            if (gen !== ytPlayGeneration || autoplayBlocked) return;
            const anyPlaying = pruneAndGetElements().some((candidate2) => !isInlinePreviewElement(candidate2) && !candidate2.paused && !candidate2.ended);
            const resumed = resumeElementsPausedByUs();
            if (!anyPlaying && !resumed && el?.paused) {
              tryPlayElement(el);
            }
            if (resumed || !anyPlaying) {
              scheduleEvaluation();
            }
          }, 200);
        }
        scheduleEvaluation();
        setTimeout(scheduleEvaluation, 100);
        setTimeout(scheduleEvaluation, 300);
        setTimeout(scheduleEvaluation, 700);
        setTimeout(scheduleEvaluation, 1200);
        setTimeout(scheduleEvaluation, 2e3);
        if (isYouTube && !hasConfirmedPlayback && !isYtPlaying()) {
          try {
            const vid = getYouTubeVideoId();
            if (vid) {
              pendingColdPlayUntil = Date.now() + 8e3;
              window.setTimeout(() => runYouTubePlayLoop(gen, 0), 350);
            }
          } catch (_) {
          }
        }
        return handled;
      }
      if (cmd.action === "pause") {
        const followsRecentPlay = lastPlaybackCommand === "play" && Date.now() - lastPlaybackCommandAt < 1e3;
        spotifyPlaybackGeneration++;
        lastPlaybackCommand = "pause";
        lastPlaybackCommandAt = Date.now();
        ytPlayGeneration++;
        const gen = ytPlayGeneration;
        pendingColdPlayUntil = 0;
        let handled = false;
        const elements = pruneAndGetElements().filter((el2) => !isInlinePreviewElement(el2));
        const el = activePrimaryElement || elements[0];
        if (isYouTube) {
          try {
            const yt = getYtPlayer();
            if (yt && typeof yt.pauseVideo === "function") {
              yt.pauseVideo();
              handled = true;
              if (el) {
                const gen2 = ytPlayGeneration;
                window.setTimeout(() => {
                  if (gen2 === ytPlayGeneration && !el.paused) {
                    try {
                      el.pause();
                    } catch (_) {
                    }
                    scheduleEvaluation();
                  }
                }, 400);
              }
            }
          } catch (_) {
          }
        }
        if (!handled && isSpotifyTopFrame) {
          handled = controlSpotifyPlayback("pause", followsRecentPlay);
        }
        if (!handled && isPanoptoViewer) {
          const button = findClickableButton(PAUSE_SELECTORS);
          if (button && isPauseStateButton(button)) {
            simulateClick(button);
            handled = true;
          }
        }
        if (!handled && state?.source === "webaudio" && activeAudioContext) {
          try {
            activeAudioContext.suspend().catch(() => {
            });
            suspendedByUs.add(activeAudioContext);
            handled = true;
          } catch (_) {
          }
        }
        if (!handled && handlers["pause"]) {
          try {
            handlers["pause"].call(navigator.mediaSession, { action: "pause" });
            handled = true;
          } catch (err) {
            console.warn("[MediaControls] MediaSession pause handler threw:", err);
          }
        }
        if (!handled) handled = pausePlayingElements();
        if (!handled) {
          const button = findClickableButton(PAUSE_SELECTORS);
          if (button && isPauseStateButton(button)) {
            simulateClick(button);
            handled = true;
          }
        }
        if (handled && !isYouTube && !isSpotifyTopFrame && elements.length > 0) {
          for (const delay of [180, 500]) {
            window.setTimeout(() => {
              if (gen !== ytPlayGeneration) return;
              if (pausePlayingElements()) scheduleEvaluation();
            }, delay);
          }
        }
        scheduleEvaluation();
        setTimeout(scheduleEvaluation, 100);
        setTimeout(scheduleEvaluation, 300);
        setTimeout(scheduleEvaluation, 700);
        return handled;
      }
      if (cmd.action === "seekto") {
        let handled = false;
        const seekTime = cmd.seekTime ?? 0;
        if (isYouTube) {
          try {
            const yt = document.getElementById("movie_player");
            if (yt && typeof yt.seekTo === "function") {
              yt.seekTo(seekTime, true);
              handled = true;
            }
          } catch (_) {
          }
        }
        const handler = handlers["seekto"];
        if (handler) {
          try {
            handler({ action: "seekto", seekTime, fastSeek: false });
            handled = true;
          } catch (_) {
          }
        }
        const elements = pruneAndGetElements().filter((el2) => !isInlinePreviewElement(el2));
        const el = activePrimaryElement || elements[0];
        if (el) {
          try {
            const maxDur = isFinite(el.duration) ? el.duration : seekTime;
            el.currentTime = Math.max(0, Math.min(seekTime, maxDur));
            handled = true;
          } catch (_) {
          }
        }
        scheduleEvaluation();
        return handled;
      }
      if (cmd.action === "seekbackward" || cmd.action === "seekforward") {
        const offset = cmd.offset ?? 10;
        let handled = false;
        const handler = handlers[cmd.action];
        if (handler) {
          try {
            handler({ action: cmd.action, seekOffset: offset });
            handled = true;
          } catch (_) {
          }
        }
        const elements = pruneAndGetElements().filter((el2) => !isInlinePreviewElement(el2));
        const el = activePrimaryElement || elements[0];
        if (el) {
          try {
            const delta = cmd.action === "seekforward" ? offset : -offset;
            const maxDur = isFinite(el.duration) ? el.duration : (el.currentTime || 0) + delta;
            el.currentTime = Math.max(0, Math.min(maxDur, (el.currentTime || 0) + delta));
            handled = true;
          } catch (_) {
          }
        }
        scheduleEvaluation();
        return handled;
      }
      if (cmd.action === "setvolume") {
        const level = clampVolume01(cmd.volume);
        if (level === null) return false;
        const handled = setPrimaryVolumeLevel(level);
        scheduleEvaluation();
        setTimeout(scheduleEvaluation, 150);
        return handled;
      }
      return false;
    }
    if (typeof MediaSession !== "undefined") {
      try {
        const origSetActionHandler = MediaSession.prototype.setActionHandler;
        MediaSession.prototype.setActionHandler = function(action, handler) {
          try {
            if (handler) {
              handlers[action] = handler;
            } else {
              delete handlers[action];
            }
            scheduleEvaluation();
          } catch (_) {
          }
          return origSetActionHandler.call(this, action, handler);
        };
      } catch (_) {
      }
      try {
        const origSetPositionState = MediaSession.prototype.setPositionState;
        if (origSetPositionState) {
          MediaSession.prototype.setPositionState = function(stateDict) {
            try {
              if (stateDict && typeof stateDict.duration === "number") {
                sessionPositionState = {
                  duration: stateDict.duration,
                  playbackRate: stateDict.playbackRate ?? 1,
                  position: stateDict.position ?? 0,
                  updatedAt: Date.now()
                };
              } else {
                sessionPositionState = null;
              }
              scheduleEvaluation();
            } catch (_) {
            }
            return origSetPositionState.call(this, stateDict);
          };
        }
      } catch (_) {
      }
      try {
        const metadataDesc = Object.getOwnPropertyDescriptor(
          MediaSession.prototype,
          "metadata"
        );
        if (metadataDesc && metadataDesc.set) {
          const origMetaSet = metadataDesc.set;
          Object.defineProperty(MediaSession.prototype, "metadata", {
            get() {
              return metadataDesc.get?.call(this);
            },
            set(val) {
              try {
                sessionMetadata = extractMetadata(val);
                scheduleEvaluation();
              } catch (_) {
              }
              return origMetaSet.call(this, val);
            },
            configurable: true,
            enumerable: true
          });
        }
      } catch (_) {
      }
      try {
        const playbackDesc = Object.getOwnPropertyDescriptor(
          MediaSession.prototype,
          "playbackState"
        );
        if (playbackDesc && playbackDesc.set) {
          const origPlaybackSet = playbackDesc.set;
          Object.defineProperty(MediaSession.prototype, "playbackState", {
            get() {
              return playbackDesc.get?.call(this);
            },
            set(val) {
              try {
                sessionPlaybackState = val;
                if (val === "playing") {
                  hasEverPlayedMediaSession = true;
                }
                scheduleEvaluation();
              } catch (_) {
              }
              return origPlaybackSet.call(this, val);
            },
            configurable: true,
            enumerable: true
          });
        }
      } catch (_) {
      }
      if (typeof MediaMetadata !== "undefined") {
        const props = ["title", "artist", "album", "artwork"];
        for (const prop of props) {
          try {
            const desc = Object.getOwnPropertyDescriptor(MediaMetadata.prototype, prop);
            if (desc && desc.set) {
              const origSet = desc.set;
              Object.defineProperty(MediaMetadata.prototype, prop, {
                ...desc,
                set(v) {
                  try {
                    scheduleEvaluation();
                  } catch (_) {
                  }
                  return origSet.call(this, v);
                }
              });
            }
          } catch (_) {
          }
        }
      }
    }
    try {
      const origPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() {
        try {
          registerElement(this);
          scheduleEvaluation();
        } catch (_) {
        }
        return origPlay.call(this);
      };
    } catch (_) {
    }
    const handleMediaEvent = (e) => {
      const target = e.target;
      if (target && target instanceof HTMLMediaElement) {
        if (isInlinePreviewElement(target)) return;
        registerElement(target);
        const hasAudio = !target.muted && target.volume > 0;
        if (e.type === "waiting" && !target.paused) {
          waitingForData.add(target);
        } else if (e.type === "playing" || e.type === "canplay" || e.type === "canplaythrough" || e.type === "pause" || e.type === "ended" || e.type === "emptied" || e.type === "seeked" && target.readyState >= 3) {
          waitingForData.delete(target);
        }
        if (e.type === "playing") {
          pendingColdPlayUntil = 0;
          if (hasAudio || hadTrustedGesture) {
            hasConfirmedPlayback = true;
            autoplayBlocked = false;
          }
          if (hasAudio) {
            elementsPlayedWithAudio.add(target);
          }
          hasEverPlayedMediaSession = true;
          sessionPlaybackState = "playing";
        } else if (e.type === "play") {
          if (!autoplayBlocked) {
            if (hasAudio) {
              elementsPlayedWithAudio.add(target);
            }
            sessionPlaybackState = "playing";
          }
        } else if (e.type === "pause") {
          if (currentFrameState && activePrimaryElement === target) {
            sessionPlaybackState = "paused";
          }
          if (elementsPlayedWithAudio.has(target) || hasAudio && target.currentTime > 0.5) {
            elementsPlayedWithAudio.add(target);
            lastPausedElement = new WeakRef(target);
            lastPausedTime = Date.now();
          }
        } else if (e.type === "emptied") {
          if (lastPausedElement?.deref() === target) {
            lastPausedElement = null;
          }
        }
        scheduleEvaluation();
      }
    };
    for (const ev of MEDIA_EVENTS) {
      document.addEventListener(ev, handleMediaEvent, true);
      window.addEventListener(ev, handleMediaEvent, true);
    }
    const handleUserGesture = (e) => {
      try {
        if (e.isTrusted === false) return;
      } catch (_) {
      }
      hadTrustedGesture = true;
    };
    document.addEventListener("pointerdown", handleUserGesture, true);
    window.addEventListener("pointerdown", handleUserGesture, true);
    document.addEventListener("click", handleUserGesture, true);
    window.addEventListener("click", handleUserGesture, true);
    document.addEventListener("keydown", handleUserGesture, true);
    window.addEventListener("keydown", handleUserGesture, true);
    const handleTimeUpdate = (e) => {
      const target = e.target;
      if (target && target instanceof HTMLMediaElement) {
        if (isInlinePreviewElement(target)) return;
        registerElement(target);
        if (target.currentTime > 0.1 && !target.paused && (hadTrustedGesture || !target.muted && target.volume > 0)) {
          if (autoplayBlocked) {
            autoplayBlocked = false;
          }
          hasConfirmedPlayback = true;
          hasEverPlayedMediaSession = true;
          sessionPlaybackState = "playing";
        }
        if (!target.muted && target.volume > 0 && !target.paused) {
          elementsPlayedWithAudio.add(target);
        }
        if (!currentFrameState || currentFrameState.playbackState !== "playing") {
          scheduleEvaluation();
        }
      }
    };
    document.addEventListener("timeupdate", handleTimeUpdate, { capture: true, passive: true });
    window.addEventListener("timeupdate", handleTimeUpdate, { capture: true, passive: true });
    try {
      const origAttachShadow = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(init) {
        const root = origAttachShadow.call(this, init);
        try {
          for (const ev of MEDIA_EVENTS) {
            root.addEventListener(ev, handleMediaEvent, true);
          }
          root.addEventListener("timeupdate", handleTimeUpdate, { capture: true, passive: true });
        } catch (_) {
        }
        return root;
      };
    } catch (_) {
    }
    function setupMutationObserver() {
      try {
        const observer = new MutationObserver((mutations) => {
          let hasNewMedia = false;
          let trackControlsChanged = false;
          for (const m of mutations) {
            if (m.type === "attributes") {
              if (m.target instanceof Element && m.target.matches(TRACK_CONTROL_SELECTOR)) {
                trackControlsChanged = true;
              }
              continue;
            }
            for (let i = 0; i < m.addedNodes.length; i++) {
              const node = m.addedNodes[i];
              if (node instanceof HTMLMediaElement) {
                registerElement(node);
                hasNewMedia = true;
              } else if (node instanceof Element) {
                if (node.matches(TRACK_CONTROL_SELECTOR) || node.querySelector(TRACK_CONTROL_SELECTOR)) {
                  trackControlsChanged = true;
                }
                const children = findAllMediaElements(node);
                for (const child of children) {
                  registerElement(child);
                  hasNewMedia = true;
                }
              }
            }
          }
          if (hasNewMedia) {
            try {
              if (Date.now() < pendingColdPlayUntil) {
                tryColdYouTubePlayOnce();
              }
            } catch (_) {
            }
          }
          if (hasNewMedia || trackControlsChanged) scheduleEvaluation();
        });
        const root = document.documentElement || document;
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["disabled", "aria-disabled", "data-disabled", "hidden", "class", "style"]
        });
      } catch (_) {
      }
    }
    setupMutationObserver();
    function setupTitleObserver() {
      try {
        let lastTitle = document.title || "";
        const checkTitle = () => {
          try {
            const t = document.title || "";
            if (t !== lastTitle) {
              lastTitle = t;
              scheduleEvaluation();
            }
          } catch (_) {
          }
        };
        const titleEl = document.querySelector("title");
        if (titleEl) {
          new MutationObserver(checkTitle).observe(titleEl, {
            childList: true,
            characterData: true,
            subtree: true
          });
        }
        const head = document.head || document.documentElement;
        if (head) {
          new MutationObserver(() => checkTitle()).observe(head, {
            childList: true,
            subtree: true,
            characterData: true
          });
        }
      } catch (_) {
      }
    }
    setupTitleObserver();
    function hookAudioContext(ContextCtor) {
      if (!ContextCtor) return ContextCtor;
      const Original = ContextCtor;
      const Proxied = function(...args) {
        const ctx = new Original(...args);
        try {
          trackedAudioContexts.add(new WeakRef(ctx));
          ctx.addEventListener("statechange", () => {
            scheduleEvaluation();
          });
          scheduleEvaluation();
        } catch (_) {
        }
        return ctx;
      };
      Proxied.prototype = Original.prototype;
      return Proxied;
    }
    if (typeof AudioContext !== "undefined") {
      window.AudioContext = hookAudioContext(window.AudioContext);
    }
    if (typeof window.webkitAudioContext !== "undefined") {
      window.webkitAudioContext = hookAudioContext(window.webkitAudioContext);
    }
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (data && data.__mcx === "down") {
        if (data.type === "query-state") {
          evaluatePrimaryMedia();
          try {
            const host = window.location?.hostname || "";
            if (host.includes("youtube.com") || host.includes("youtu.be")) {
              setTimeout(scheduleEvaluation, 400);
              setTimeout(scheduleEvaluation, 1200);
            }
          } catch (_) {
          }
        } else if (data.cmd) {
          const handled = executeCommand(data.cmd);
          if (typeof data.id === "number") {
            window.postMessage({ __mcx: "command-result", id: data.id, handled }, "*");
          }
        }
      }
    });
    window.addEventListener("pagehide", () => {
      postState(null);
    });
    window.addEventListener("pageshow", () => {
      scheduleEvaluation();
    });
    const runDelayedScans = () => {
      [100, 300, 600, 1200, 2500, 5e3, 1e4].forEach((delay) => {
        setTimeout(scheduleEvaluation, delay);
      });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        scheduleEvaluation();
        runDelayedScans();
      });
    } else {
      runDelayedScans();
    }
    window.addEventListener("load", () => {
      scheduleEvaluation();
      runDelayedScans();
    });
    scheduleEvaluation();
  })();
})();
//# sourceMappingURL=page-hook.js.map
