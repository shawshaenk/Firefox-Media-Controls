// Installed independently of the playback hook so extension updates can repair
// buffering detection in tabs that still contain an older playback hook.
export function installBufferingObserver() {
  const key = "__mcx_buffering_observer_v1";
  const page = window as Window & { [key: string]: any };
  if (typeof page[key] === "function") {
    page[key]();
    return;
  }

  const elements = new Set<WeakRef<HTMLMediaElement>>();
  const observed = new WeakSet<HTMLMediaElement>();
  const waiting = new WeakSet<HTMLMediaElement>();
  const roots = new WeakSet<Document | ShadowRoot>();
  const events = ["play", "playing", "waiting", "seeking", "seeked", "pause",
    "ended", "emptied", "canplay", "canplaythrough", "error"];
  let latest: HTMLMediaElement | null = null;
  let lastSent: boolean | undefined;
  let timer: number | null = null;
  let hidden = false;

  function track(el: HTMLMediaElement) {
    if (observed.has(el)) return;
    observed.add(el);
    elements.add(new WeakRef(el));
    for (const name of events) el.addEventListener(name, onMediaEvent);
  }

  function discover(root: Document | ShadowRoot) {
    for (const el of root.querySelectorAll<HTMLMediaElement>("audio,video")) track(el);
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) watchRoot(el.shadowRoot);
    }
  }

  function watchRoot(root: Document | ShadowRoot) {
    if (roots.has(root)) return;
    roots.add(root);
    for (const name of events) root.addEventListener(name, onMediaEvent, true);
    discover(root);
  }

  function onMediaEvent(event: Event) {
    const el = event.target;
    if (!(el instanceof HTMLMediaElement)) return;
    track(el);
    if (event.type === "waiting") waiting.add(el);
    if (["playing", "pause", "ended", "emptied", "canplay", "canplaythrough", "error"].includes(event.type) ||
        (event.type === "seeked" && el.readyState >= 3)) waiting.delete(el);
    if (["play", "playing", "waiting", "seeking"].includes(event.type)) latest = el;
    publish();
  }

  function publish(force = false) {
    if (hidden) return;
    const candidates: HTMLMediaElement[] = [];
    for (const ref of elements) {
      const el = ref.deref();
      if (!el) { elements.delete(ref); continue; }
      if (el.closest(".inline-preview-player, #inline-preview-player, ytd-video-preview, ytd-thumbnail")) continue;
      candidates.push(el);
    }
    const playing = candidates.filter(el => !el.paused && !el.ended);
    const audible = playing.filter(el => !el.muted && el.volume > 0);
    if (!navigator.mediaSession?.metadata) {
      audible.sort((a, b) => (Number.isFinite(b.duration) ? b.duration : 0) -
        (Number.isFinite(a.duration) ? a.duration : 0));
    }
    const primary = audible[0] || playing[0] ||
      (latest && candidates.includes(latest) ? latest : candidates[0]);
    let buffering = Boolean(primary && !primary.ended && !primary.error &&
      (primary.seeking || waiting.has(primary) || (!primary.paused && primary.readyState < 3)));
    // The player can buffer while its underlying element is temporarily paused,
    // and its state change does not always dispatch a media element event.
    if (location.hostname === "www.youtube.com" || location.hostname === "music.youtube.com" || location.hostname === "youtube.com") {
      try {
        const player = document.getElementById("movie_player") as HTMLElement & { getPlayerState?: () => number };
        buffering ||= player?.getPlayerState?.() === 3;
      } catch (_) {}
    }
    if (force || buffering !== lastSent) {
      lastSent = buffering;
      window.postMessage({ __mcx: "buffering-state", buffering }, "*");
    }
    if (timer === null && (candidates.length || document.getElementById("movie_player"))) {
      timer = window.setTimeout(() => { timer = null; publish(); }, 200);
    }
  }

  // Detached Audio objects and closed shadow roots never reach document listeners.
  try {
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      try { track(this); } catch (_) {}
      return originalPlay.call(this);
    };
  } catch (_) {}
  try {
    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      const root = originalAttachShadow.call(this, init);
      try { watchRoot(root); } catch (_) {}
      return root;
    };
  } catch (_) {}
  page[key] = () => publish(true);
  watchRoot(document);
  // Discovery is debounced; polling examines tracked elements, not the whole DOM.
  let scanTimer: number | null = null;
  new MutationObserver(() => {
    if (scanTimer !== null) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = null;
      discover(document);
      publish();
    }, 100);
  }).observe(document, { childList: true, subtree: true });
  window.addEventListener("message", event => {
    if (event.source === window && event.data?.__mcx === "down" && event.data.type === "query-state") publish(true);
  });
  window.addEventListener("pagehide", () => {
    hidden = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  });
  window.addEventListener("pageshow", () => { hidden = false; discover(document); publish(true); });
  publish(true);
}
