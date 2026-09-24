import type {
  Action,
  Command,
  FrameState,
  MediaMetadataState,
  PositionState,
  VolumeState,
  McxDownMessage,
  McxUpMessage
} from "./shared/protocol";

(() => {
  if ((window as any).__mcx_hook_installed) {
    try {
      window.postMessage({ __mcx: "down", type: "query-state" } as McxDownMessage, "*");
    } catch (_) {}
    return;
  }
  (window as any).__mcx_hook_installed = true;

  const MEDIA_EVENTS = [
    "play",
    "playing",
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
  ] as const;

  // Tracked state
  const handlers: Partial<Record<Action, (details: any) => void>> = {};
  let sessionMetadata: MediaMetadataState | null = null;
  let sessionPlaybackState: "playing" | "paused" | "none" = "none";
  let sessionPositionState: PositionState | null = null;
  let hasEverPlayedMediaSession = false;

  const trackedElements = new Set<WeakRef<HTMLMediaElement>>();
  const trackedAudioContexts = new Set<WeakRef<AudioContext>>();
  const suspendedByUs = new WeakSet<AudioContext>();
  const elementsPlayedWithAudio = new WeakSet<HTMLMediaElement>();

  let lastPausedElement: WeakRef<HTMLMediaElement> | null = null;
  let lastPausedTime = 0;
  let lastPlayedAtEpoch = Date.now();

  let activePrimaryElement: HTMLMediaElement | null = null;
  let activeAudioContext: AudioContext | null = null;
  let currentFrameState: FrameState | null = null;

  let evalTimer: number | null = null;
  let lastKnownHref = typeof window !== "undefined" && window.location ? window.location.href : "";
  // Cold-play intent: popup asked for play while the YouTube player was still
  // cueing (autoplay off, fresh tab). Retry briefly as the player appears.
  let pendingColdPlayUntil = 0;
  // Generation guard so a later command cancels a pending cold-play retry.
  let ytPlayGeneration = 0;
  let lastPlaybackCommand: "play" | "pause" | null = null;
  let lastPlaybackCommandAt = 0;
  // True once the browser's autoplay policy has rejected programmatic play
  // (NotAllowedError on both audible and muted attempts, or an exhausted
  // YouTube retry loop). Cleared on real playback or real user interaction.
  let autoplayBlocked = false;
  let hasConfirmedPlayback = false;
  let hadTrustedGesture = false;

  function isAutoplayDenied(el: HTMLMediaElement | null): boolean | null {
    try {
      const getPolicy = (navigator as Navigator & {
        getAutoplayPolicy?: (target: HTMLMediaElement | "mediaelement") => string;
      }).getAutoplayPolicy;
      if (!getPolicy) return null;
      return getPolicy.call(navigator, el || "mediaelement") !== "allowed";
    } catch (_) {
      return null;
    }
  }

  function setAutoplayBlocked(blocked: boolean) {
    if (autoplayBlocked === blocked) return;
    autoplayBlocked = blocked;
    scheduleEvaluation();
  }

  function isInlinePreviewElement(el: HTMLMediaElement): boolean {
    try {
      if (!el || !(el instanceof HTMLMediaElement)) return true;

      // Specifically filter YouTube preview player and thumbnail containers
      if (
        el.closest(
          ".inline-preview-player, #inline-preview-player, ytd-video-preview, [data-layer='preview'], ytd-thumbnail, .ytd-thumbnail"
        )
      ) {
        return true;
      }

      // Filter elements with preview classes or attributes
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

  function getYouTubeVideoId(): string | null {
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

  function doesArtworkMatchYouTubeVideo(meta: MediaMetadataState | null, videoId: string | null): boolean {
    if (!meta || !videoId) return false;
    if (!meta.artwork || meta.artwork.length === 0) return true;
    return meta.artwork.some((art) => art && typeof art.src === "string" && art.src.includes(videoId));
  }

  function isWatchOrPlayerPage(): boolean {
    if (typeof window === "undefined" || !window.location) return false;
    try {
      const loc = window.location;
      const host = loc.hostname.toLowerCase();
      const path = loc.pathname.toLowerCase();

      // YouTube: only dedicated watch, shorts, or live pages with a valid video ID
      if (host.includes("youtube.com") || host.includes("youtu.be")) {
        return Boolean(getYouTubeVideoId());
      }

      // Dedicated audio/video platforms
      if (
        host.includes("spotify.com") ||
        host.includes("soundcloud.com") ||
        host.includes("twitch.tv") ||
        host.includes("vimeo.com") ||
        host.includes("dailymotion.com") ||
        host.includes("bandcamp.com") ||
        host.includes("music.apple.com") ||
        host.includes("deezer.com") ||
        host.includes("tidal.com")
      ) {
        return true;
      }

      // Direct media files
      if (/\.(mp4|webm|mp3|ogg|wav|m4a|flac|aac)(\?.*)?$/i.test(path)) {
        return true;
      }

      return false;
    } catch (_) {
      return false;
    }
  }

  function getYouTubeMetadata(): MediaMetadataState | null {
    try {
      if (typeof window === "undefined" || !window.location) return null;
      const host = window.location.hostname.toLowerCase();
      if (!host.includes("youtube.com") && !host.includes("youtu.be")) return null;

      let title = "";
      let artist = "";
      const urlVideoId = getYouTubeVideoId() || "";
      let videoId = urlVideoId;

      // 1. Try movie_player API - ONLY if its video_id matches the current URL video ID!
      const yt = document.getElementById("movie_player") as any;
      if (yt && typeof yt.getVideoData === "function") {
        const data = yt.getVideoData();
        if (data && (!urlVideoId || data.video_id === urlVideoId)) {
          if (data.title) title = data.title;
          if (data.author) artist = data.author;
          if (data.video_id) videoId = data.video_id;
        }
      }

      // 2. Try DOM elements
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

      const artwork: { src: string; sizes?: string; type?: string }[] = [];
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
    } catch (_) {}
    return null;
  }

  function simulateClick(el: HTMLElement) {
    try {
      el.click();
    } catch (_) {}
  }

  function isPlayStateButton(btn: HTMLElement): boolean {
    const label = (
      btn.getAttribute("aria-label") ||
      btn.getAttribute("title") ||
      btn.getAttribute("data-title-no-tooltip") ||
      ""
    ).toLowerCase();
    if (label.includes("pause")) return false;
    if (label.includes("play")) return true;
    return true;
  }

  function isPauseStateButton(btn: HTMLElement): boolean {
    const label = (
      btn.getAttribute("aria-label") ||
      btn.getAttribute("title") ||
      btn.getAttribute("data-title-no-tooltip") ||
      ""
    ).toLowerCase();
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
        const getVid = (u: URL) => {
          if (u.pathname.includes("/watch")) return u.searchParams.get("v") || "";
          if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || "";
          if (u.pathname.startsWith("/live/")) return u.pathname.split("/")[2] || "";
          return "";
        };
        const oldVid = getVid(oldUrl);
        const newVid = getVid(newUrl);
        const wasWatch = Boolean(oldVid);
        const isWatch = Boolean(newVid);

        // If navigated from watch to non-watch, or changed video ID:
        if (
          (wasWatch && !isWatch) ||
          (oldVid && newVid && oldVid !== newVid) ||
          (!wasWatch && !isWatch) ||
          (wasWatch && oldUrl.pathname !== newUrl.pathname)
        ) {
          resetSessionState();
          postState(null);
          scheduleEvaluation();
          return;
        }
      } else {
        // Other SPAs: if path changed and nothing is actively playing
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
    } catch (_) {}

    scheduleEvaluation();
  }

  try {
    const origPushState = history.pushState;
    history.pushState = function (...args: any[]) {
      const res = (origPushState as any).apply(this, args);
      handleLocationChange();
      return res;
    };
  } catch (_) {}

  try {
    const origReplaceState = history.replaceState;
    history.replaceState = function (...args: any[]) {
      const res = (origReplaceState as any).apply(this, args);
      handleLocationChange();
      return res;
    };
  } catch (_) {}

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

  function findAllMediaElements(root: Document | Element | ShadowRoot = document): HTMLMediaElement[] {
    const list: HTMLMediaElement[] = [];
    try {
      const direct = root.querySelectorAll<HTMLMediaElement>("audio, video");
      for (let i = 0; i < direct.length; i++) {
        if (!isInlinePreviewElement(direct[i])) {
          list.push(direct[i]);
        }
      }
      const all = root.querySelectorAll("*");
      for (let i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) {
          list.push(...findAllMediaElements(all[i].shadowRoot!));
        }
      }
    } catch (_) {}
    return list;
  }

  function pruneAndGetElements(): HTMLMediaElement[] {
    const list: HTMLMediaElement[] = [];
    for (const ref of trackedElements) {
      const el = ref.deref();
      if (!el) {
        trackedElements.delete(ref);
      } else if (!isInlinePreviewElement(el)) {
        list.push(el);
      }
    }

    // Also pick up any DOM / Shadow DOM elements not yet tracked
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
    } catch (_) {}

    return list;
  }

  function pruneAndGetAudioContexts(): AudioContext[] {
    const list: AudioContext[] = [];
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

  function registerElement(el: HTMLMediaElement) {
    if (!el || !(el instanceof HTMLMediaElement)) return;
    if (isInlinePreviewElement(el)) return;
    for (const ref of trackedElements) {
      if (ref.deref() === el) return;
    }
    trackedElements.add(new WeakRef(el));
  }

  function extractMetadata(meta: MediaMetadata | null): MediaMetadataState | null {
    if (!meta) return null;
    try {
      const artworkList: { src: string; sizes?: string; type?: string }[] = [];
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

  function hasValidMetadata(m: MediaMetadataState | null): m is MediaMetadataState {
    if (!m) return false;
    return Boolean(m.title.trim() || m.artist.trim() || (m.artwork && m.artwork.length > 0));
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

  function postState(state: FrameState | null) {
    currentFrameState = state;
    const msg: McxUpMessage = {
      __mcx: "up",
      state
    };
    try {
      window.postMessage(msg, "*");
    } catch (_) {}
  }

  function isElementSeekable(el: HTMLMediaElement): boolean {
    return isFinite(el.duration) && el.duration > 0;
  }

  function availableTrackActions(): Action[] {
    const actions: Action[] = [];
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

    const isYouTube =
      typeof window !== "undefined" &&
      window.location &&
      (window.location.hostname.includes("youtube.com") || window.location.hostname.includes("youtu.be"));

    // Classify elements - do not require readyState >= 1 as buffering / MSE videos can be readyState 0
    const playingElements = elements.filter(
      (el) => !el.paused && !el.ended
    );
    const audiblePlaying = playingElements.filter(
      (el) => !el.muted && el.volume > 0
    );

    const ytVideoId = isYouTube ? getYouTubeVideoId() : null;

    // RULE 1 (YouTube Non-Watch Pages):
    // On YouTube non-watch pages (Home, Search, Subscriptions, Channel feeds, etc.),
    // NEVER emit a media card unless an element is actively playing audible audio!
    if (isYouTube && !ytVideoId && audiblePlaying.length === 0) {
      resetSessionState();
      postState(null);
      return;
    }

    // On YouTube watch pages, validate that sessionMetadata actually belongs to this video
    if (isYouTube && ytVideoId && sessionMetadata && !doesArtworkMatchYouTubeVideo(sessionMetadata, ytVideoId)) {
      sessionMetadata = null;
    }

    let currentNavMeta: MediaMetadataState | null = sessionMetadata;
    let currentPlaybackState = sessionPlaybackState;

    if (isYouTube) {
      const ytMeta = getYouTubeMetadata();
      if (ytMeta) {
        if (!currentNavMeta || !doesArtworkMatchYouTubeVideo(currentNavMeta, ytVideoId)) {
          currentNavMeta = ytMeta;
        } else {
          // If sessionMetadata has artwork for this video, keep artwork, but guarantee title/artist are fresh
          currentNavMeta = {
            title: ytMeta.title || currentNavMeta.title,
            artist: ytMeta.artist || currentNavMeta.artist,
            album: currentNavMeta.album || "YouTube",
            artwork: currentNavMeta.artwork?.length ? currentNavMeta.artwork : (ytMeta.artwork || [])
          };
        }
      }
      // On YouTube, NEVER read navigator.mediaSession directly to prevent inheriting
      // another same-origin tab's MediaSession from Gecko's shared MediaSession service!
    } else {
      // Non-YouTube sites:
      // Only query global navigator.mediaSession as fallback if this tab actually
      // has active media elements, to avoid inheriting another same-origin tab's
      // MediaSession from Gecko's shared MediaSession service.
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
    if (!hasConfirmedPlayback && (isPlayerPage || elements.length > 0) &&
        isAutoplayDenied(activePrimaryElement || elements[0] || null) === true) {
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

    // Cold-start fallback: YouTube watch/shorts/live pages must be controllable
    // even before the user ever presses play (autoplay off) and even before the
    // <video> element or full title has loaded. Synthesize minimal metadata from
    // the video ID so Rule 1 below emits a paused card with a working play action.
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

    // Rule 1: Media Session (playing or paused)
    const hasMediaMeta = hasValidMetadata(currentNavMeta);
    const canShowPaused = hasEverPlayedMediaSession || isPlayerPage;

    // Check if real playback is confirmed active right now
    const realPlaybackActive = isYouTube
      ? isYtPlaying() && (hadTrustedGesture || audiblePlaying.some((el) => el.currentTime > 0.1))
      : playingElements.some((el) =>
          el.currentTime > 0.1 && (hadTrustedGesture || (!el.muted && el.volume > 0)));

    if (autoplayBlocked && realPlaybackActive) {
      autoplayBlocked = false;
      hasConfirmedPlayback = true;
      hasEverPlayedMediaSession = true;
    }

    const mediaSessionPlaying =
      !autoplayBlocked &&
      (audiblePlaying.length > 0 ||
       (playingElements.length > 0 && hasEverPlayedMediaSession) ||
       (sessionPlaybackState !== "paused" && currentPlaybackState === "playing" && (playingElements.length > 0 || isPlayerPage)));
    const mediaSessionPaused =
      canShowPaused &&
      !mediaSessionPlaying &&
      (currentPlaybackState === "paused" ||
       sessionPlaybackState === "paused" ||
       autoplayBlocked ||
       playingElements.length === 0 ||
       !audiblePlaying.length);

    if (hasMediaMeta && (mediaSessionPlaying || mediaSessionPaused)) {
      if (mediaSessionPlaying) {
        hasEverPlayedMediaSession = true;
        lastPlayedAtEpoch = Date.now();
      }

      // Find representative element if any
      const primaryEl =
        audiblePlaying[0] ||
        playingElements[0] ||
        elements.find((el) => elementsPlayedWithAudio.has(el)) ||
        (canShowPaused ? elements[0] : null) ||
        null;

      activePrimaryElement = primaryEl;
      activeAudioContext = null;

      const pState: "playing" | "paused" | "none" = mediaSessionPlaying ? "playing" : "paused";

      // Determine position
      let position: PositionState | null = null;
      if (
        sessionPositionState &&
        typeof sessionPositionState.duration === "number" &&
        sessionPositionState.duration > 0
      ) {
        position = {
          ...sessionPositionState,
          playbackRate: mediaSessionPlaying ? (sessionPositionState.playbackRate || 1) : 0,
          updatedAt: Date.now()
        };
      } else if (primaryEl) {
        let dur = isFinite(primaryEl.duration) ? primaryEl.duration : 0;
        let pos = primaryEl.currentTime || 0;
        if ((!dur || isNaN(dur)) && isYouTube) {
          try {
            const yt = document.getElementById("movie_player") as any;
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
          } catch (_) {}
        }
        position = {
          duration: dur,
          position: pos,
          playbackRate: mediaSessionPlaying ? (primaryEl.playbackRate || 1) : 0,
          updatedAt: Date.now()
        };
      } else if (isYouTube) {
        try {
          const yt = document.getElementById("movie_player") as any;
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
        } catch (_) {}
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
        !isLive &&
          ((position && position.duration > 0) ||
            (primaryEl && isElementSeekable(primaryEl)) ||
            handlers["seekto"] ||
            currentFrameState?.seekable)
      );

      // Actions: registered handlers ∪ emulatable
      const actionsSet = new Set<Action>(Object.keys(handlers) as Action[]);
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
        playBlocked: autoplayBlocked
      });
      return;
    }

    // Rule 2: Element that is playing, unmuted, volume > 0; ties -> longest duration
    const audiblePlayingSorted = audiblePlaying
      .slice()
      .sort((a, b) => {
        const durA = isFinite(a.duration) ? a.duration : 0;
        const durB = isFinite(b.duration) ? b.duration : 0;
        return durB - durA;
      });

    const candidatePlaying =
      (!autoplayBlocked || realPlaybackActive)
        ? (audiblePlayingSorted[0] || (hasEverPlayedMediaSession ? playingElements[0] : null) || null)
        : null;

    if (candidatePlaying) {
      activePrimaryElement = candidatePlaying;
      activeAudioContext = null;
      lastPlayedAtEpoch = Date.now();

      const seekable = isElementSeekable(candidatePlaying);
      const isLive =
        candidatePlaying.duration === Infinity ||
        (!isFinite(candidatePlaying.duration) && !isNaN(candidatePlaying.duration));

      const actions: Action[] = ["play", "pause", ...availableTrackActions()];
      if (seekable) {
        actions.push("seekto", "seekbackward", "seekforward");
      }

      postState({
        source: "element",
        metadata: currentNavMeta && hasValidMetadata(currentNavMeta)
          ? currentNavMeta
          : {
              title: document.title || "Media",
              artist: "",
              album: "",
              artwork: []
            },
        playbackState: "playing",
        position: isNaN(candidatePlaying.duration)
          ? null
          : {
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
        playBlocked: false
      });
      return;
    }

    // Rule 3: Most recently paused element (keep until emptied/removed/ended)
    const candidatePaused =
      lastPausedElement?.deref() ||
      (activePrimaryElement?.paused && !activePrimaryElement.ended ? activePrimaryElement : null) ||
      (autoplayBlocked ? elements[0] : null);
    const pausedEl =
      candidatePaused &&
      (elementsPlayedWithAudio.has(candidatePaused) || (candidatePaused.currentTime > 0.5 && !candidatePaused.muted) || autoplayBlocked)
        ? candidatePaused
        : null;

    if (pausedEl && elements.includes(pausedEl) && !pausedEl.ended) {
      activePrimaryElement = pausedEl;
      activeAudioContext = null;

      const seekable = isElementSeekable(pausedEl);
      const isLive =
        pausedEl.duration === Infinity ||
        (!isFinite(pausedEl.duration) && !isNaN(pausedEl.duration));

      const actions: Action[] = ["play", "pause", ...availableTrackActions()];
      if (seekable) {
        actions.push("seekto", "seekbackward", "seekforward");
      }

      postState({
        source: "element",
        metadata: currentNavMeta && hasValidMetadata(currentNavMeta)
          ? currentNavMeta
          : {
              title: document.title || "Media",
              artist: "",
              album: "",
              artwork: []
            },
        playbackState: "paused",
        position: isNaN(pausedEl.duration)
          ? null
          : {
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
        playBlocked: autoplayBlocked
      });
      return;
    }

    // Rule 4: Running or suspended-by-us AudioContext
    const activeCtx = audioContexts.find(
      (ctx) =>
        ctx.state === "running" ||
        (ctx.state === "suspended" && suspendedByUs.has(ctx))
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

    // Some players (including Spotify) replace or clear their media element on
    // pause. Preserve the last playable card until navigation or the page clears it.
    if (
      hasEverPlayedMediaSession &&
      currentFrameState &&
      currentFrameState.playbackState !== "none" &&
      (!isYouTube || (ytVideoId && doesArtworkMatchYouTubeVideo(currentFrameState.metadata, ytVideoId)))
    ) {
      if (activePrimaryElement && !elements.includes(activePrimaryElement)) {
        activePrimaryElement = null;
      }
      const previous = currentFrameState;
      postState({
        ...previous,
        playbackState: "paused",
        playBlocked: autoplayBlocked,
        position: previous.position ? {
          ...previous.position,
          playbackRate: 0,
          updatedAt: Date.now()
        } : null,
        volume: getPrimaryVolumeState() ?? previous.volume ?? null,
        actions: Array.from(new Set<Action>([
          ...(Object.keys(handlers) as Action[]).filter(
            (action) => action !== "previoustrack" && action !== "nexttrack"
          ),
          ...availableTrackActions(),
          "play", "pause",
          ...(previous.seekable ? ["seekto", "seekbackward", "seekforward"] as Action[] : [])
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
    "button[aria-label*='Précédent' i]",
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

  function isTrackButtonDisabled(button: HTMLElement): boolean {
    try {
      return button.matches(":disabled") ||
        button.getAttribute("aria-disabled") === "true" ||
        button.getAttribute("data-disabled") === "true" ||
        button.classList.contains("disabled") ||
        button.classList.contains("is-disabled") ||
        button.classList.contains("ytp-disabled");
    } catch (_) {
      return false;
    }
  }

  function isTrackButtonUsable(button: HTMLElement): boolean {
    try {
      // Player chrome can disable pointer events while it fades out, but an
      // enabled transport button can still be activated by click(). Keep
      // display/visibility checks so a genuinely absent Previous stays off.
      if (!button.isConnected || isTrackButtonDisabled(button) ||
          button.closest("[hidden], [inert]")) return false;
      const style = window.getComputedStyle(button);
      return style.display !== "none" &&
        style.visibility !== "hidden" &&
        button.getClientRects().length > 0;
    } catch (_) {
      return false;
    }
  }

  function getTrackButtonStatus(selectors: string[]): {
    found: boolean;
    button: HTMLElement | null;
    disabled: boolean;
  } {
    // The first matching selector is the player's own transport control.
    // If it is disabled, a later generic "Next" button elsewhere on the page
    // must not make the track action appear available.
    for (const selector of selectors) {
      try {
        const buttons = document.querySelectorAll<HTMLElement>(selector);
        if (buttons.length > 0) {
          const candidates = Array.from(buttons);
          return {
            found: true,
            button: candidates.find(isTrackButtonUsable) || null,
            disabled: candidates.every(isTrackButtonDisabled)
          };
        }
      } catch (_) {}
    }
    for (const selector of selectors) {
      const button = findButtonInShadowRoots(selector, document);
      if (button) {
        return { found: true, button: isTrackButtonUsable(button) ? button : null, disabled: isTrackButtonDisabled(button) };
      }
    }
    return { found: false, button: null, disabled: false };
  }

  function isTrackActionAvailable(action: "previoustrack" | "nexttrack"): boolean {
    if (action === "nexttrack" && getYouTubeSuggestedNextVideoId()) return true;
    const playlist = getYouTubePlaylistPosition();
    if (action === "previoustrack" && playlist && playlist.index === 0) {
      return false;
    }
    if (playlist && (action === "previoustrack"
      ? playlist.index > 0
      : playlist.index < playlist.length - 1)) {
      return true;
    }
    const selectors = action === "previoustrack" ? PREV_SELECTORS : NEXT_SELECTORS;
    const control = getTrackButtonStatus(selectors);
    if (action === "previoustrack" && getYouTubeVideoId()) {
      // A watch page can register a Previous handler even when it would only
      // restart the current video. Require its enabled transport button.
      return Boolean(control.button);
    }
    return Boolean(control.button || (!control.disabled && handlers[action]));
  }

  function getYouTubeSuggestedNextVideoId(): string | null {
    try {
      const currentId = getYouTubeVideoId();
      if (!currentId || window.location.pathname !== "/watch") return null;
      const idFromHref = (href: string | null): string | null => {
        if (!href) return null;
        const url = new URL(href, window.location.href);
        const id = url.searchParams.get("v");
        return /(^|\.)youtube\.com$/.test(url.hostname) && url.pathname === "/watch" &&
          id && /^[\w-]{11}$/.test(id) && id !== currentId ? id : null;
      };
      const data = (window as any).ytInitialData;
      const dataCurrentId = data?.currentVideoEndpoint?.watchEndpoint?.videoId;
      const nextHref = document.querySelector<HTMLAnchorElement>("a.ytp-next-button[href]")?.href;
      const linkId = idFromHref(nextHref ?? null);
      if (linkId) return linkId;
      // ytInitialData may still describe the previous video after YouTube's
      // in-page navigation. Ignore that copy and inspect current DOM links.
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
      const recommendations = document.querySelectorAll<HTMLAnchorElement>(
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

  function getYouTubePlaylistPosition(): { index: number; length: number } | null {
    try {
      const host = window.location.hostname;
      if (!host.includes("youtube.com") && !host.includes("youtu.be")) return null;
      // Without an explicit playlist, the page may still have a usable Next
      // recommendation; the player's own button is authoritative there.
      if (!new URL(window.location.href).searchParams.has("list")) return null;
      const player = getYtPlayer();
      const list = player?.getPlaylist?.();
      const index = player?.getPlaylistIndex?.();
      if (Array.isArray(list) && list.length > 0 &&
          Number.isInteger(index) && index >= 0 && index < list.length) {
        return { index, length: list.length };
      }
    } catch (_) {}
    return null;
  }

  function findButtonInShadowRoots(selector: string, root: Document | Element | ShadowRoot): HTMLElement | null {
    try {
      const all = root.querySelectorAll("*");
      for (let i = 0; i < all.length; i++) {
        const child = all[i];
        if (child.shadowRoot) {
          const match = child.shadowRoot.querySelector<HTMLElement>(selector);
          if (match) {
            const disabled =
              (match as HTMLButtonElement).disabled ||
              match.getAttribute("aria-disabled") === "true";
            if (!disabled) return match;
          }
          const deepMatch = findButtonInShadowRoots(selector, child.shadowRoot);
          if (deepMatch) return deepMatch;
        }
      }
    } catch (_) {}
    return null;
  }

  function findClickableButton(selectors: string[]): HTMLElement | null {
    try {
      for (const sel of selectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) {
          const disabled =
            (el as HTMLButtonElement).disabled ||
            el.getAttribute("aria-disabled") === "true";
          if (!disabled) {
            return el;
          }
        }
      }

      // If not found in main document, check shadow roots
      for (const sel of selectors) {
        const el = findButtonInShadowRoots(sel, document);
        if (el) return el;
      }
    } catch (_) {}
    return null;
  }

  function playNextTrack(): boolean {
    const control = getTrackButtonStatus(NEXT_SELECTORS);
    const playlist = getYouTubePlaylistPosition();
    if (playlist && playlist.index < playlist.length - 1) {
      try {
        const player = getYtPlayer();
        if (typeof player?.nextVideo === "function") {
          player.nextVideo();
          return true;
        }
      } catch (_) {}
    }
    const suggestedId = getYouTubeSuggestedNextVideoId();
    if (suggestedId) {
      const currentId = getYouTubeVideoId();
      // Prefer YouTube's own control so its navigation and playback behavior
      // are preserved. Its click may silently do nothing, so verify the route.
      if (control.button) control.button.click();
      window.setTimeout(() => {
        if (getYouTubeVideoId() === currentId) {
          window.location.assign(`/watch?v=${suggestedId}`);
        }
      }, control.button ? 600 : 0);
      return true;
    }
    if (control.disabled) return false;
    // For ordinary watch pages, this button advances to YouTube's suggested
    // next video even though no explicit playlist is attached to the URL.
    if (window.location.hostname.includes("youtube.com") && control.button) {
      control.button.click();
      return true;
    }
    // 1. Try MediaSession handler if registered
    if (handlers["nexttrack"]) {
      try {
        handlers["nexttrack"].call(navigator.mediaSession, { action: "nexttrack" });
        return true;
      } catch (err) {
        console.warn("[MediaControls] MediaSession nexttrack handler threw:", err);
      }
    }

    // 2. Try the page's enabled next button
    if (control.button) {
      control.button.click();
      return true;
    }
    return false;
  }

  function playPreviousTrack(): boolean {
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
      } catch (_) {}
    }
    if (control.disabled) return false;
    if (window.location.hostname.includes("youtube.com") && control.button) {
      control.button.click();
      return true;
    }
    // 1. Try MediaSession handler if registered
    if (handlers["previoustrack"]) {
      try {
        handlers["previoustrack"].call(navigator.mediaSession, { action: "previoustrack" });
        return true;
      } catch (err) {
        console.warn("[MediaControls] MediaSession previoustrack handler threw:", err);
      }
    }

    // 2. Try the page's enabled previous button
    if (control.button) {
      control.button.click();
      return true;
    }
    return false;
  }

  function getYtPlayer(): any | null {
    try {
      const yt = document.getElementById("movie_player") as any;
      return yt || null;
    } catch (_) {
      return null;
    }
  }

  function isYtPlaying(): boolean {
    try {
      const yt = getYtPlayer();
      if (yt && typeof yt.getPlayerState === "function") {
        try {
          return yt.getPlayerState() === 1;
        } catch (_) {}
      }
    } catch (_) {}
    try {
      const els = pruneAndGetElements().filter((el) => !isInlinePreviewElement(el));
      const el = activePrimaryElement || els[0];
      if (el && !el.paused && !el.ended) {
        if (autoplayBlocked) {
          return (el.currentTime > 0.1) || (!el.muted && el.volume > 0 && elementsPlayedWithAudio.has(el));
        }
        return true;
      }
    } catch (_) {}
    return false;
  }

  function clampVolume01(value: unknown): number | null {
    if (typeof value !== "number" || !isFinite(value)) return null;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }

  function isYouTubeHost(): boolean {
    try {
      const host = window.location?.hostname?.toLowerCase() || "";
      return host.includes("youtube.com") || host.includes("youtu.be");
    } catch (_) {
      return false;
    }
  }

  function getPrimaryElementForVolume(): HTMLMediaElement | null {
    try {
      if (activePrimaryElement && activePrimaryElement.isConnected &&
          !isInlinePreviewElement(activePrimaryElement)) {
        return activePrimaryElement;
      }
      const els = pruneAndGetElements().filter((el) => !isInlinePreviewElement(el));
      return activePrimaryElement && !isInlinePreviewElement(activePrimaryElement)
        ? activePrimaryElement
        : els[0] || null;
    } catch (_) {
      return activePrimaryElement || null;
    }
  }

  function getPrimaryVolumeState(): VolumeState | null {
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
                // Keep the site volume UI in sync by trusting the player API
                // when it reports a usable value.
                return { level, mediaMuted };
              }
            }
          }
        } catch (_) {}
      }
      if (el) {
        try {
          const rawLevel = (el as HTMLMediaElement).volume;
          const level = clampVolume01(rawLevel);
          if (level === null) return null;
          return { level, mediaMuted: Boolean((el as HTMLMediaElement).muted) };
        } catch (_) {
          return null;
        }
      }
    } catch (_) {}
    return null;
  }

  function setPrimaryVolumeLevel(level01: number): boolean {
    const level = clampVolume01(level01);
    if (level === null) return false;
    let handled = false;
    // Never touch unrelated media elements: only the primary element for
    // this card, plus the YouTube player API which drives that same player.
    if (isYouTubeHost()) {
      try {
        const yt = getYtPlayer();
        if (yt && typeof yt.setVolume === "function") {
          yt.setVolume(Math.round(level * 100));
          handled = true;
        }
      } catch (_) {}
    }
    try {
      const el = getPrimaryElementForVolume();
      if (el) {
        el.volume = level;
        handled = true;
      }
    } catch (_) {}
    return handled;
  }

  function tryPlayElement(el: HTMLMediaElement): boolean {
    let p: Promise<void> | undefined;
    try {
      p = el.play();
    } catch (err: any) {
      if (err?.name === "NotAllowedError" && !hasConfirmedPlayback) setAutoplayBlocked(true);
      return false;
    }
    p?.catch((err: any) => {
      if (err?.name === "NotAllowedError" && !hasConfirmedPlayback) setAutoplayBlocked(true);
    });
    return true;
  }

  function playYouTubeOnce(preferElement = false, forcePlay = false): boolean {
    const el = activePrimaryElement ||
      pruneAndGetElements().find((candidate) => !isInlinePreviewElement(candidate)) ||
      document.querySelector<HTMLMediaElement>("video, audio");
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
      } catch (_) {}
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

  function runYouTubePlayLoop(gen: number, attempt: number) {
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
    // A player can expose playVideo() before it is ready to act on it. After
    // the first retry, attempt the media element instead of repeating a no-op.
    playYouTubeOnce(attempt > 0);
    window.setTimeout(() => runYouTubePlayLoop(gen, attempt + 1), 450);
    if (attempt % 3 === 0) scheduleEvaluation();
  }

  function tryColdYouTubePlayOnce(): boolean {
    if (autoplayBlocked) return false;
    return playYouTubeOnce();
  }

  function executeCommand(cmd: Command): boolean {
    const state = currentFrameState;

    const isYouTube =
      typeof window !== "undefined" &&
      window.location &&
      (window.location.hostname.includes("youtube.com") ||
        window.location.hostname.includes("youtu.be"));

    if (cmd.action === "nexttrack") {
      const handled = playNextTrack();
      scheduleEvaluation();
      setTimeout(scheduleEvaluation, 300);
      setTimeout(scheduleEvaluation, 1000);
      return handled;
    }

    if (cmd.action === "previoustrack") {
      const handled = playPreviousTrack();
      scheduleEvaluation();
      setTimeout(scheduleEvaluation, 300);
      setTimeout(scheduleEvaluation, 1000);
      return handled;
    }

    if (cmd.action === "play") {
      const followsRecentPause = lastPlaybackCommand === "pause" &&
        Date.now() - lastPlaybackCommandAt < 1000;
      lastPlaybackCommand = "play";
      lastPlaybackCommandAt = Date.now();
      const candidate = activePrimaryElement ||
        pruneAndGetElements().find((el) => !isInlinePreviewElement(el)) || null;
      if (!hasConfirmedPlayback &&
          (autoplayBlocked || isAutoplayDenied(candidate) === true)) {
        setAutoplayBlocked(true);
        evaluatePrimaryMedia();
        return false;
      }
      // New press supersedes any in-flight retry loop from an earlier press.
      ytPlayGeneration++;
      const gen = ytPlayGeneration;
      let handled = false;

      // Resolve target element once (cold pages may insert it late; the loop
      // below re-queries on every retry).
      const elements = pruneAndGetElements().filter((el) => !isInlinePreviewElement(el));
      const el =
        activePrimaryElement ||
        elements[0] ||
        ((): HTMLMediaElement | null => {
          // Cold-start fallback: prune may have run before the player inserted
          // its element. Query once more directly so first-play can succeed.
          try {
            const direct = document.querySelector<HTMLMediaElement>("video, audio");
            if (direct && !isInlinePreviewElement(direct)) {
              registerElement(direct);
              return direct;
            }
          } catch (_) {}
          return null;
        })();

      // Choose one path per press. YouTube controls and many site buttons are
      // toggles; clicking one after playVideo() can pause the video again.
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
      } else if (state?.source === "webaudio" && activeAudioContext) {
        try {
          activeAudioContext.resume().catch(() => {});
          suspendedByUs.delete(activeAudioContext);
          handled = true;
        } catch (_) {}
      } else if (!followsRecentPause && el && !el.paused && !el.ended) {
        handled = true;
      } else if (handlers["play"]) {
        try {
          handlers["play"].call(navigator.mediaSession, { action: "play" });
          handled = true;
        } catch (err) {
          console.warn("[MediaControls] MediaSession play handler threw:", err);
        }
      }
      if (!handled && el) handled = tryPlayElement(el);
      if (!handled) {
        const button = findClickableButton(PLAY_SELECTORS);
        if (button && isPlayStateButton(button)) {
          simulateClick(button);
          handled = true;
        }
      }

      scheduleEvaluation();
      setTimeout(scheduleEvaluation, 100);
      setTimeout(scheduleEvaluation, 300);
      setTimeout(scheduleEvaluation, 700);
      setTimeout(scheduleEvaluation, 1200);
      setTimeout(scheduleEvaluation, 2000);

      // A page with permission may still be cueing its player; retry briefly.
      if (isYouTube && !hasConfirmedPlayback && !isYtPlaying()) {
        try {
          const vid = getYouTubeVideoId();
          if (vid) {
            pendingColdPlayUntil = Date.now() + 8000;
            window.setTimeout(() => runYouTubePlayLoop(gen, 0), 350);
          }
        } catch (_) {}
      }

      return handled;
    }

    if (cmd.action === "pause") {
      lastPlaybackCommand = "pause";
      lastPlaybackCommandAt = Date.now();
      sessionPlaybackState = "paused";
      // A pause cancels any pending cold-play retries.
      ytPlayGeneration++;
      pendingColdPlayUntil = 0;
      let handled = false;

      const elements = pruneAndGetElements().filter((el) => !isInlinePreviewElement(el));
      const el = activePrimaryElement || elements[0];

      // Use one control path here too. A second toggle click can resume a
      // video that pauseVideo() or a Media Session handler just paused.
      if (isYouTube) {
        try {
          const yt = getYtPlayer();
          if (yt && typeof yt.pauseVideo === "function") {
            yt.pauseVideo();
            handled = true;
            if (el) {
              const gen = ytPlayGeneration;
              window.setTimeout(() => {
                if (gen === ytPlayGeneration && !el.paused) {
                  try { el.pause(); } catch (_) {}
                  scheduleEvaluation();
                }
              }, 400);
            }
          }
        } catch (_) {}
      }
      if (!handled && state?.source === "webaudio" && activeAudioContext) {
        try {
          activeAudioContext.suspend().catch(() => {});
          suspendedByUs.add(activeAudioContext);
          handled = true;
        } catch (_) {}
      }
      if (!handled && handlers["pause"]) {
        try {
          handlers["pause"].call(navigator.mediaSession, { action: "pause" });
          handled = true;
        } catch (err) {
          console.warn("[MediaControls] MediaSession pause handler threw:", err);
        }
      }

      if (!handled && el) {
        try {
          el.pause();
          handled = true;
        } catch (_) {}
      }
      if (!handled) {
        const button = findClickableButton(PAUSE_SELECTORS);
        if (button && isPauseStateButton(button)) {
          simulateClick(button);
          handled = true;
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
          const yt = document.getElementById("movie_player") as any;
          if (yt && typeof yt.seekTo === "function") {
            yt.seekTo(seekTime, true);
            handled = true;
          }
        } catch (_) {}
      }

      const handler = handlers["seekto"];
      if (handler) {
        try {
          handler({ action: "seekto", seekTime, fastSeek: false });
          handled = true;
        } catch (_) {}
      }

      const elements = pruneAndGetElements().filter((el) => !isInlinePreviewElement(el));
      const el = activePrimaryElement || elements[0];
      if (el) {
        try {
          const maxDur = isFinite(el.duration) ? el.duration : seekTime;
          el.currentTime = Math.max(0, Math.min(seekTime, maxDur));
          handled = true;
        } catch (_) {}
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
        } catch (_) {}
      }

      const elements = pruneAndGetElements().filter((el) => !isInlinePreviewElement(el));
      const el = activePrimaryElement || elements[0];
      if (el) {
        try {
          const delta = cmd.action === "seekforward" ? offset : -offset;
          const maxDur = isFinite(el.duration) ? el.duration : (el.currentTime || 0) + delta;
          el.currentTime = Math.max(0, Math.min(maxDur, (el.currentTime || 0) + delta));
          handled = true;
        } catch (_) {}
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

  // Hook MediaSession
  if (typeof MediaSession !== "undefined") {
    try {
      const origSetActionHandler = MediaSession.prototype.setActionHandler;
      MediaSession.prototype.setActionHandler = function (action: string, handler: any) {
        try {
          if (handler) {
            handlers[action as Action] = handler;
          } else {
            delete handlers[action as Action];
          }
          scheduleEvaluation();
        } catch (_) {}
        return origSetActionHandler.call(this, action as MediaSessionAction, handler);
      };
    } catch (_) {}

    try {
      const origSetPositionState = MediaSession.prototype.setPositionState;
      if (origSetPositionState) {
        MediaSession.prototype.setPositionState = function (stateDict?: MediaPositionState) {
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
          } catch (_) {}
          return origSetPositionState.call(this, stateDict);
        };
      }
    } catch (_) {}

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
          set(val: MediaMetadata | null) {
            try {
              sessionMetadata = extractMetadata(val);
              scheduleEvaluation();
            } catch (_) {}
            return origMetaSet.call(this, val);
          },
          configurable: true,
          enumerable: true
        });
      }
    } catch (_) {}

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
          set(val: MediaSessionPlaybackState) {
            try {
              sessionPlaybackState = val;
              if (val === "playing") {
                hasEverPlayedMediaSession = true;
              }
              scheduleEvaluation();
            } catch (_) {}
            return origPlaybackSet.call(this, val);
          },
          configurable: true,
          enumerable: true
        });
      }
    } catch (_) {}

    // Hook in-place mutations on MediaMetadata properties if available
    if (typeof MediaMetadata !== "undefined") {
      const props = ["title", "artist", "album", "artwork"] as const;
      for (const prop of props) {
        try {
          const desc = Object.getOwnPropertyDescriptor(MediaMetadata.prototype, prop);
          if (desc && desc.set) {
            const origSet = desc.set;
            Object.defineProperty(MediaMetadata.prototype, prop, {
              ...desc,
              set(v: any) {
                try {
                  scheduleEvaluation();
                } catch (_) {}
                return origSet.call(this, v);
              }
            });
          }
        } catch (_) {}
      }
    }
  }

  // Hook HTMLMediaElement.prototype.play
  try {
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      try {
        registerElement(this);
        scheduleEvaluation();
      } catch (_) {}
      return origPlay.call(this);
    };
  } catch (_) {}

  // Capture listeners on document and window
  const handleMediaEvent = (e: Event) => {
    const target = e.target;
    if (target && target instanceof HTMLMediaElement) {
      if (isInlinePreviewElement(target)) return;
      registerElement(target);

      const hasAudio = !target.muted && target.volume > 0;
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
        if (elementsPlayedWithAudio.has(target) || (hasAudio && target.currentTime > 0.5)) {
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

  // A trusted gesture alone does not prove playback. Unlock after the media
  // actually begins, including manually started muted video.
  const handleUserGesture = (e: Event) => {
    try {
      if (e.isTrusted === false) return;
    } catch (_) {}
    hadTrustedGesture = true;
  };
  document.addEventListener("pointerdown", handleUserGesture, true);
  window.addEventListener("pointerdown", handleUserGesture, true);
  document.addEventListener("click", handleUserGesture, true);
  window.addEventListener("click", handleUserGesture, true);
  document.addEventListener("keydown", handleUserGesture, true);
  window.addEventListener("keydown", handleUserGesture, true);

  // Handle timeupdate to capture ongoing playback transitions
  const handleTimeUpdate = (e: Event) => {
    const target = e.target;
    if (target && target instanceof HTMLMediaElement) {
      if (isInlinePreviewElement(target)) return;
      registerElement(target);
      if (target.currentTime > 0.1 && !target.paused &&
          (hadTrustedGesture || (!target.muted && target.volume > 0))) {
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

  // Hook attachShadow to capture events inside shadow DOM
  try {
    const origAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      const root = origAttachShadow.call(this, init);
      try {
        for (const ev of MEDIA_EVENTS) {
          root.addEventListener(ev, handleMediaEvent, true);
        }
        root.addEventListener("timeupdate", handleTimeUpdate, { capture: true, passive: true });
      } catch (_) {}
      return root;
    };
  } catch (_) {}

  // MutationObserver to detect dynamically added media elements (e.g. YouTube SPAs)
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
              if (node.matches(TRACK_CONTROL_SELECTOR) ||
                  node.querySelector(TRACK_CONTROL_SELECTOR)) {
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
          // If the popup asked for play while the player was still cueing,
          // the element just appeared — retry now.
          try {
            if (Date.now() < pendingColdPlayUntil) {
              tryColdYouTubePlayOnce();
            }
          } catch (_) {}
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
    } catch (_) {}
  }
  setupMutationObserver();

  // YouTube loads its title/player asynchronously (often after our early scans).
  // Re-evaluate when <title> changes so a cold card upgrades from
  // "YouTube video" to the real title without requiring manual playback.
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
        } catch (_) {}
      };
      const titleEl = document.querySelector("title");
      if (titleEl) {
        new MutationObserver(checkTitle).observe(titleEl, {
          childList: true,
          characterData: true,
          subtree: true
        });
      }
      // Fallback: head mutations (YouTube swaps title nodes on SPA navigation)
      const head = document.head || document.documentElement;
      if (head) {
        new MutationObserver(() => checkTitle()).observe(head, {
          childList: true,
          subtree: true,
          characterData: true
        });
      }
    } catch (_) {}
  }
  setupTitleObserver();

  // Hook Web Audio
  function hookAudioContext(ContextCtor: any) {
    if (!ContextCtor) return ContextCtor;
    const Original = ContextCtor;
    const Proxied = function (this: AudioContext, ...args: any[]) {
      const ctx = new Original(...args);
      try {
        trackedAudioContexts.add(new WeakRef(ctx));
        ctx.addEventListener("statechange", () => {
          scheduleEvaluation();
        });
        scheduleEvaluation();
      } catch (_) {}
      return ctx;
    };
    Proxied.prototype = Original.prototype;
    return Proxied;
  }

  if (typeof AudioContext !== "undefined") {
    (window as any).AudioContext = hookAudioContext(window.AudioContext);
  }
  if (typeof (window as any).webkitAudioContext !== "undefined") {
    (window as any).webkitAudioContext = hookAudioContext((window as any).webkitAudioContext);
  }

  // Listen for commands / queries from isolated world relay
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as McxDownMessage;
    if (data && data.__mcx === "down") {
      if (data.type === "query-state") {
        evaluatePrimaryMedia();
        // Cold YouTube pages may still be cueing the player when the popup
        // asks. Re-check shortly after so the card appears with real
        // title/duration instead of staying empty until manual playback.
        try {
          const host = window.location?.hostname || "";
          if (host.includes("youtube.com") || host.includes("youtu.be")) {
            setTimeout(scheduleEvaluation, 400);
            setTimeout(scheduleEvaluation, 1200);
          }
        } catch (_) {}
      } else if (data.cmd) {
        const handled = executeCommand(data.cmd);
        if (typeof data.id === "number") {
          window.postMessage({ __mcx: "command-result", id: data.id, handled } as McxUpMessage, "*");
        }
      }
    }
  });

  // Page lifecycle events
  window.addEventListener("pagehide", () => {
    postState(null);
  });
  window.addEventListener("pageshow", () => {
    scheduleEvaluation();
  });

  const runDelayedScans = () => {
    // Extended tail (5s/10s) covers YouTube's late player/title load when
    // autoplay is off and no media events fire to trigger re-evaluation.
    [100, 300, 600, 1200, 2500, 5000, 10000].forEach((delay) => {
      setTimeout(scheduleEvaluation, delay);
    });
  };

  // Initial scan & evaluation
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
