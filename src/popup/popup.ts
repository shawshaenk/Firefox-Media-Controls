import { safeImageUrl } from "../shared/validation";
import type {
  Action,
  Command,
  FrameState,
  MediaArtwork,
  Session,
  YouTubeChapter,
  PopupToBgMessage,
  BgToPopupMessage
} from "../shared/protocol";
import { setIcon, createIcon } from "./icons";

interface CardDom {
  cardEl: HTMLElement;
  topRowEl: HTMLElement;
  artworkContainer: HTMLElement;
  artworkImg: HTMLImageElement | null;
  textColEl: HTMLElement;
  sourceFavicon: HTMLImageElement;
  sourceHostname: HTMLElement;
  titleEl: HTMLElement;
  artistEl: HTMLElement;
  playBtn: HTMLButtonElement;
  bottomRowEl: HTMLElement;
  prevBtn: HTMLButtonElement;
  rewBtn: HTMLButtonElement;
  sliderContainer: HTMLElement;
  activeTrack: HTMLElement;
  inactiveTrack: HTMLElement;
  thumb: HTMLElement;
  fwdBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  dragHandle: HTMLElement;
  pinBtn: HTMLButtonElement;
  chapterBtn: HTMLButtonElement;
  chapterSection: HTMLElement;
  chapterList: HTMLElement;
  chapterVideoId: string | null;
  chapters: YouTubeChapter[];
  chaptersOpen: boolean;
  activeChapterIndex: number;
  volumeBtn: HTMLButtonElement;
  volumeSection: HTMLElement;
  volumeMuteBtn: HTMLButtonElement;
  volumeSlider: HTMLInputElement;
  volumeLabel: HTMLElement;
  volumeUnavailable: HTMLElement;
  volumeOpen: boolean;
  volumeDragging: boolean;
  dragVolume: number | null;
  pendingVolume: {
    level: number;
    expiresAt: number;
  } | null;
  lastVolumeSentAt: number;
  volumeThrottleTimer: number | null;

  // State tracking
  session: Session;
  isDragging: boolean;
  dragPct: number;
  lastInterpolatedPos: number;
  pendingPlayback: {
    state: "playing" | "paused";
    expiresAt: number;
    confirmedAt: number | null;
    settleMs: number;
  } | null;
  pendingSeek: {
    position: number;
    updatedAt: number;
    duration: number;
    playbackRate: number;
    expiresAt: number;
  } | null;
}

let port: browser.runtime.Port | null = null;
let currentSessions: Session[] = [];
const renderedCards = new Map<number, CardDom>();
let hasHostPermissions = true;
let isDevOverlayActive = false;

let isReorderingCards = false;
let suppressCardClick = false;
let pendingSessionsUpdate: Session[] | null = null;
let preferredCardOrder: number[] | null = null;

const cardsContainer = document.getElementById("cards-container") as HTMLElement;

async function showAudibleFallback() {
  if (!hasHostPermissions || currentSessions.length > 0) return;
  try {
    const tabs = await browser.tabs.query({ audible: true });
    if (currentSessions.length > 0 || tabs.length === 0) return;
    const sessions: Session[] = tabs.filter((tab) => tab.id !== undefined).map((tab) => {
      let hostname = "";
      try { hostname = new URL(tab.url || "").hostname; } catch (_) {}
      return {
        tabId: tab.id!, frameId: 0, hostname,
        favIconUrl: tab.favIconUrl || "", tabTitle: tab.title || "Audible tab",
        state: null, audible: true, muted: Boolean(tab.mutedInfo?.muted), degraded: true,
        pinned: false, chapterState: null
      };
    });
    if (sessions.length > 0) updateSessionsView(sessions);
  } catch (err) {
    console.warn("[MediaControls Popup] Could not inspect audible tabs:", err);
  }
}

function formatTime(sec: number): string {
  if (isNaN(sec) || !isFinite(sec) || sec < 0) return "0:00";
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (h > 0) {
    const minutes = m % 60;
    return `${h}:${minutes < 10 ? "0" : ""}${minutes}:${s < 10 ? "0" : ""}${s}`;
  }
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function parseSize(sizeStr?: string): number {
  if (!sizeStr) return 0;
  const match = sizeStr.match(/(\d+)x(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 0;
}

function chooseBestArtwork(artworks?: MediaArtwork[]): string | null {
  if (!artworks || artworks.length === 0) return null;
  // Sort descending by parsed resolution
  const sorted = [...artworks].sort((a, b) => parseSize(b.sizes) - parseSize(a.sizes));
  // Prefer artwork >= 96px
  const preferred = sorted.find((a) => parseSize(a.sizes) >= 96);
  return (preferred || sorted[0])?.src || null;
}

function sendCommand(tabId: number, frameId: number, cmd: Command) {
  if (port) {
    port.postMessage({
      type: "cmd",
      tabId,
      frameId,
      cmd
    } as PopupToBgMessage);
  }
}

function isSessionPlaying(session: Session): boolean {
  if (session.state?.playbackState === "playing") return true;
  if (session.state?.playbackState === "paused") return false;
  return session.audible;
}

function sendFocus(tabId: number) {
  if (port) {
    port.postMessage({
      type: "focus",
      tabId
    } as PopupToBgMessage);
  }
}

function sendMute(tabId: number, muted: boolean) {
  if (port) {
    port.postMessage({
      type: "mute",
      tabId,
      muted
    } as PopupToBgMessage);
  }
}

function renderPermissionsMissing() {
  cardsContainer.replaceChildren();
  renderedCards.clear();
  const card = document.createElement("div");
  card.className = "permission-card";

  const text = document.createElement("div");
  text.className = "permission-text";
  text.textContent =
    "Media Controls requires permission to access tabs in order to control playback.";

  const btn = document.createElement("button");
  btn.className = "grant-btn";
  btn.textContent = "Grant access";
  btn.addEventListener("click", async () => {
    try {
      const granted = await browser.permissions.request({
        origins: ["<all_urls>"]
      });
      if (granted) {
        hasHostPermissions = true;
        if (port) {
          port.postMessage({ type: "request-sessions" } as PopupToBgMessage);
        }
        updateSessionsView(currentSessions);
      }
    } catch (err) {
      console.error("Failed to request permissions:", err);
    }
  });

  card.appendChild(text);
  card.appendChild(btn);
  cardsContainer.appendChild(card);
}

function renderEmptyState() {
  cardsContainer.replaceChildren();
  renderedCards.clear();

  const emptyCard = document.createElement("div");
  emptyCard.className = "empty-card";

  const emptyText = document.createElement("div");
  emptyText.className = "empty-text";
  emptyText.textContent = "No media is playing";

  emptyCard.appendChild(emptyText);
  cardsContainer.appendChild(emptyCard);
}

function commitCardOrder() {
  const currentCardEls = Array.from(cardsContainer.querySelectorAll<HTMLElement>(".media-card"));
  const newTabIds: number[] = [];
  for (const el of currentCardEls) {
    const tid = Number(el.dataset.tabId);
    if (tid) newTabIds.push(tid);
  }

  // Update local currentSessions array in matching order
  const byId = new Map(currentSessions.map((s) => [s.tabId, s]));
  const reordered: Session[] = [];
  for (const tid of newTabIds) {
    const s = byId.get(tid);
    if (s) {
      reordered.push(s);
      byId.delete(tid);
    }
  }
  for (const s of byId.values()) {
    reordered.push(s);
  }
  currentSessions = [
    ...reordered.filter((session) => session.pinned),
    ...reordered.filter((session) => !session.pinned)
  ];
  preferredCardOrder = currentSessions.map((session) => session.tabId);

  if (port) {
    port.postMessage({
      type: "reorder",
      tabIds: currentSessions.map((session) => session.tabId)
    } as PopupToBgMessage);
  }
}

function moveCardByStep(cardEl: HTMLElement, step: number) {
  const allCards = Array.from(cardsContainer.querySelectorAll<HTMLElement>(".media-card"));
  const idx = allCards.indexOf(cardEl);
  if (idx === -1) return;
  const targetIdx = idx + step;
  if (targetIdx < 0 || targetIdx >= allCards.length) return;
  if (renderedCards.get(Number(allCards[targetIdx].dataset.tabId))?.session.pinned !==
      renderedCards.get(Number(cardEl.dataset.tabId))?.session.pinned) return;

  const refNode = allCards[targetIdx > idx ? targetIdx + 1 : targetIdx];
  cardsContainer.insertBefore(cardEl, refNode || null);

  commitCardOrder();
  cardEl.focus();
}

let activeDragSession: {
  dragHandle: HTMLElement;
  cardEl: HTMLElement;
  tabId: number;
  startY: number;
  initialIndex: number;
  cardHeight: number;
  cards: HTMLElement[];
  cardCenters: number[];
  minIndex: number;
  maxIndex: number;
  hasMovedPastThreshold: boolean;
  pointerId: number;
} | null = null;

function dragTargetIndex(session: NonNullable<typeof activeDragSession>, deltaY: number): number {
  const center = session.cardCenters[session.initialIndex] + deltaY;
  const top = center - session.cardHeight / 2;
  const bottom = center + session.cardHeight / 2;
  let target = session.initialIndex;
  if (deltaY > 0) {
    for (let i = session.initialIndex + 1; i <= session.maxIndex; i++) {
      if (bottom >= session.cardCenters[i]) target = i;
    }
  } else {
    for (let i = session.initialIndex - 1; i >= session.minIndex; i--) {
      if (top <= session.cardCenters[i]) target = i;
    }
  }
  return target;
}

function setupCardDrag(dragHandle: HTMLElement, cardEl: HTMLElement, tabId: number) {
  dragHandle.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    const allCards = Array.from(cardsContainer.querySelectorAll<HTMLElement>(".media-card"));
    if (allCards.length < 2) return;

    const initialIndex = allCards.indexOf(cardEl);
    if (initialIndex === -1) return;

    const rect = cardEl.getBoundingClientRect();
    const pinned = renderedCards.get(tabId)?.session.pinned;
    const sameGroupIndices = allCards.flatMap((card, index) =>
      renderedCards.get(Number(card.dataset.tabId))?.session.pinned === pinned ? [index] : []
    );
    if (sameGroupIndices.length < 2) return;

    activeDragSession = {
      dragHandle,
      cardEl,
      tabId,
      startY: e.clientY,
      initialIndex,
      cardHeight: rect.height,
      cards: allCards,
      cardCenters: allCards.map((card) => {
        const bounds = card.getBoundingClientRect();
        return bounds.top + bounds.height / 2;
      }),
      minIndex: sameGroupIndices[0] ?? initialIndex,
      maxIndex: sameGroupIndices[sameGroupIndices.length - 1] ?? initialIndex,
      hasMovedPastThreshold: false,
      pointerId: e.pointerId
    };

    // Freeze incoming session ordering from pointerdown through release. A
    // background push during the first few pixels must not move the handle.
    isReorderingCards = true;
    dragHandle.setPointerCapture(e.pointerId);
  });

  dragHandle.addEventListener("pointermove", (e: PointerEvent) => {
    if (!activeDragSession || activeDragSession.pointerId !== e.pointerId) return;

    const deltaY = e.clientY - activeDragSession.startY;
    if (!activeDragSession.hasMovedPastThreshold) {
      if (Math.abs(deltaY) > 3) {
        activeDragSession.hasMovedPastThreshold = true;
        cardEl.classList.add("is-dragging");
        dragHandle.classList.add("is-dragging");
        cardsContainer.classList.add("is-reordering");
        document.body.style.cursor = "grabbing";
      } else {
        return;
      }
    }

    e.preventDefault();

    cardEl.style.transform = `translateY(${deltaY}px) scale(1.02)`;

    if (e.clientY < 40) {
      document.body.scrollTop -= 6;
    } else if (e.clientY > window.innerHeight - 40) {
      document.body.scrollTop += 6;
    }

    const GAP = 8;
    const slotHeight = activeDragSession.cardHeight + GAP;
    const targetIndex = dragTargetIndex(activeDragSession, deltaY);

    for (let k = 0; k < activeDragSession.cards.length; k++) {
      if (k === activeDragSession.initialIndex) continue;
      const otherCard = activeDragSession.cards[k];
      let shift = 0;
      if (activeDragSession.initialIndex < targetIndex) {
        if (k > activeDragSession.initialIndex && k <= targetIndex) {
          shift = -slotHeight;
        }
      } else if (activeDragSession.initialIndex > targetIndex) {
        if (k >= targetIndex && k < activeDragSession.initialIndex) {
          shift = slotHeight;
        }
      }
      otherCard.style.transform = shift ? `translateY(${shift}px)` : "";
    }
  });

  const endDrag = (e: PointerEvent) => {
    if (!activeDragSession || activeDragSession.pointerId !== e.pointerId) return;

    const session = activeDragSession;
    activeDragSession = null;
    try {
      dragHandle.releasePointerCapture(e.pointerId);
    } catch (_) {}
    document.body.style.cursor = "";
    cardsContainer.classList.remove("is-reordering");
    cardEl.classList.remove("is-dragging");
    dragHandle.classList.remove("is-dragging");

    const deltaY = e.clientY - session.startY;
    const didDrop = session.hasMovedPastThreshold && e.type === "pointerup";
    const targetIndex = didDrop ? dragTargetIndex(session, deltaY) : session.initialIndex;

    for (const c of session.cards) {
      c.style.transform = "";
    }

    if (didDrop && targetIndex !== session.initialIndex) {
      const currentChildren = Array.from(cardsContainer.children);
      const refNode = currentChildren[targetIndex > session.initialIndex ? targetIndex + 1 : targetIndex];
      cardsContainer.insertBefore(session.cardEl, refNode || null);
    }

    const pending = pendingSessionsUpdate;
    pendingSessionsUpdate = null;
    if (pending) currentSessions = pending;
    if (didDrop && targetIndex !== session.initialIndex &&
        currentSessions.some((item) => item.tabId === session.tabId)) {
      commitCardOrder();
    }
    isReorderingCards = false;
    if (pending || (didDrop && targetIndex !== session.initialIndex)) {
      updateSessionsView(currentSessions);
    }
  };

  dragHandle.addEventListener("pointerup", endDrag);
  dragHandle.addEventListener("pointercancel", endDrag);
}

function createCardDom(session: Session): CardDom {
  const cardEl = document.createElement("div");
  cardEl.className = "media-card";
  cardEl.setAttribute("tabindex", "0");
  cardEl.setAttribute("role", "article");
  cardEl.dataset.tabId = String(session.tabId);

  // Clicking anywhere on the card (except buttons, slider, or drag handle) focuses the tab
  cardEl.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("input") ||
      target.closest(".slider-container") ||
      target.closest(".chapter-section") ||
      target.closest(".volume-section") ||
      target.closest(".card-toolbar") ||
      target.closest(".card-drag-handle")
    ) {
      return;
    }
    sendFocus(cardDom.session.tabId);
  });

  cardEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target === cardEl) {
      sendFocus(cardDom.session.tabId);
    } else if ((e.altKey || e.ctrlKey) && e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveCardByStep(cardEl, -1);
    } else if ((e.altKey || e.ctrlKey) && e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveCardByStep(cardEl, 1);
    }
  });

  // Drag Handle (dots grid in top right)
  const dragHandle = document.createElement("div");
  dragHandle.className = "card-drag-handle";
  dragHandle.setAttribute("role", "button");
  dragHandle.setAttribute("tabindex", "0");
  dragHandle.setAttribute("aria-label", "Drag to reorder");
  dragHandle.setAttribute("title", "Drag to reorder");
  setIcon(dragHandle, "drag_indicator");

  dragHandle.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  dragHandle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveCardByStep(cardEl, -1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveCardByStep(cardEl, 1);
    }
  });

  setupCardDrag(dragHandle, cardEl, session.tabId);

  const chapterBtn = document.createElement("button");
  chapterBtn.className = "card-chapters-btn";
  chapterBtn.type = "button";
  chapterBtn.setAttribute("aria-label", "Show video chapters");
  chapterBtn.setAttribute("aria-expanded", "false");
  chapterBtn.title = "Show video chapters";
  setIcon(chapterBtn, "expand_more");
  chapterBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const videoId = cardDom.session.youtubeVideoId;
    if (!videoId || cardDom.session.degraded) return;
    // A video the background confirmed to have no chapters never opens.
    const chapterState = cardDom.session.chapterState;
    if (chapterState && chapterState.videoId === videoId && chapterState.status === "none") return;
    const willOpen = !cardDom.chaptersOpen;
    setChaptersOpen(cardDom, willOpen);
    if (willOpen) {
      setVolumeOpen(cardDom, false);
      if (cardDom.chapterVideoId !== videoId) {
        showChapterMessage(cardDom, "Loading chapters…");
      }
      port?.postMessage({ type: "chapters-request", tabId: cardDom.session.tabId } as PopupToBgMessage);
    }
  });

  const volumeBtn = document.createElement("button");
  volumeBtn.className = "card-volume-btn";
  volumeBtn.type = "button";
  volumeBtn.setAttribute("aria-label", "Show volume controls");
  volumeBtn.setAttribute("aria-expanded", "false");
  volumeBtn.title = "Show volume controls";
  setIcon(volumeBtn, "volume_up");
  volumeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = !cardDom.volumeOpen;
    setVolumeOpen(cardDom, willOpen);
    if (willOpen) {
      setChaptersOpen(cardDom, false);
    }
  });

  const pinBtn = document.createElement("button");
  pinBtn.className = "card-pin-btn";
  pinBtn.type = "button";
  setIcon(pinBtn, "push_pin");
  pinBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const pinned = !cardDom.session.pinned;
    const updated = currentSessions.map((item) =>
      item.tabId === cardDom.session.tabId ? { ...item, pinned } : item
    );
    const updatedOrder = [
      ...updated.filter((item) => item.pinned),
      ...updated.filter((item) => !item.pinned)
    ];
    preferredCardOrder = updatedOrder.map((item) => item.tabId);
    updateSessionsView(updatedOrder);
    port?.postMessage({ type: "pin", tabId: cardDom.session.tabId, pinned } as PopupToBgMessage);
  });

  // Top Row
  const topRowEl = document.createElement("div");
  topRowEl.className = "card-top-row";

  // Artwork
  const artworkContainer = document.createElement("div");
  artworkContainer.className = "artwork-container";

  // Text Column
  const textColEl = document.createElement("div");
  textColEl.className = "text-column";

  const sourceRow = document.createElement("div");
  sourceRow.className = "source-row";

  const sourceFavicon = document.createElement("img");
  sourceFavicon.className = "source-favicon";
  sourceFavicon.alt = "";
  sourceFavicon.referrerPolicy = "no-referrer";

  const sourceHostname = document.createElement("span");
  sourceHostname.className = "source-hostname";

  sourceRow.appendChild(sourceFavicon);
  sourceRow.appendChild(sourceHostname);

  const titleEl = document.createElement("div");
  titleEl.className = "track-title";

  const artistEl = document.createElement("div");
  artistEl.className = "track-artist";

  textColEl.appendChild(sourceRow);
  textColEl.appendChild(titleEl);
  textColEl.appendChild(artistEl);

  // Play / Pause / Mute button
  const playBtn = document.createElement("button");
  playBtn.className = "play-btn";
  playBtn.setAttribute("type", "button");
  playBtn.setAttribute("aria-label", "Play or Pause");
  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (cardDom.playBtn.disabled) return;
    const current = cardDom.session;
    if (current.degraded) {
      sendMute(current.tabId, !current.muted);
    } else {
      // Follow the state shown by the button so a quick Pause then Play sends
      // both commands, even before the page reports the pause transition.
      const isPlaying = cardDom.pendingPlayback
        ? cardDom.pendingPlayback.state === "playing"
        : isSessionPlaying(current);
      const requestedState = isPlaying ? "paused" : "playing";
      sendCommand(current.tabId, current.frameId, {
        action: isPlaying ? "pause" : "play"
      });
      const isSpotify = current.hostname === "open.spotify.com";
      const pending: NonNullable<CardDom["pendingPlayback"]> = {
        state: requestedState,
        // Spotify can report the old state after its control has already
        // reacted. Keep the clicked icon until its new state stays settled.
        expiresAt: Date.now() + (isSpotify ? 2500 : 900),
        confirmedAt: null,
        settleMs: isSpotify ? 500 : 0
      };
      cardDom.pendingPlayback = pending;
      updatePlayButton(cardDom);
      window.setTimeout(() => reconcilePendingPlayback(cardDom, pending), 100);
    }
  });

  topRowEl.appendChild(artworkContainer);
  topRowEl.appendChild(textColEl);
  topRowEl.appendChild(playBtn);

  // Bottom Row
  const bottomRowEl = document.createElement("div");
  bottomRowEl.className = "card-bottom-row";

  const prevBtn = document.createElement("button");
  prevBtn.className = "ctrl-btn prev-btn";
  prevBtn.setAttribute("type", "button");
  prevBtn.setAttribute("aria-label", "Previous track");
  setIcon(prevBtn, "skip_previous");
  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (cardDom.prevBtn.disabled) return;
    sendCommand(cardDom.session.tabId, cardDom.session.frameId, {
      action: "previoustrack"
    });
  });

  const rewBtn = document.createElement("button");
  rewBtn.className = "ctrl-btn rew-btn";
  rewBtn.setAttribute("type", "button");
  rewBtn.setAttribute("aria-label", "Seek backward 10 seconds");
  setIcon(rewBtn, "replay_10");
  rewBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (cardDom.rewBtn.disabled) return;
    sendCommand(cardDom.session.tabId, cardDom.session.frameId, {
      action: "seekbackward",
      offset: 10
    });
  });

  // Slider
  const sliderContainer = document.createElement("div");
  sliderContainer.className = "slider-container";
  sliderContainer.setAttribute("role", "slider");
  sliderContainer.setAttribute("tabindex", "0");
  sliderContainer.setAttribute("aria-label", "Seek slider");
  sliderContainer.setAttribute("aria-valuemin", "0");

  const activeTrack = document.createElement("div");
  activeTrack.className = "slider-active-track";

  const inactiveTrack = document.createElement("div");
  inactiveTrack.className = "slider-inactive-track";

  const thumb = document.createElement("div");
  thumb.className = "slider-thumb";

  sliderContainer.appendChild(activeTrack);
  sliderContainer.appendChild(inactiveTrack);
  sliderContainer.appendChild(thumb);

  // Pointer drag handling on slider
  const updateSliderFromPointer = (e: PointerEvent) => {
    const rect = sliderContainer.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const pct = rect.width > 0 ? x / rect.width : 0;
    cardDom.dragPct = pct;

    const dur = cardDom.session.state?.position?.duration || 0;
    applySliderPosition(cardDom, pct * dur, dur);
  };

  sliderContainer.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    sliderContainer.setPointerCapture(e.pointerId);
    cardDom.isDragging = true;
    updateSliderFromPointer(e);
  });

  sliderContainer.addEventListener("pointermove", (e) => {
    if (cardDom.isDragging) {
      e.stopPropagation();
      updateSliderFromPointer(e);
    }
  });

  const commitSeek = (e: PointerEvent) => {
    if (cardDom.isDragging) {
      e.stopPropagation();
      e.preventDefault();
      cardDom.isDragging = false;
      const dur = cardDom.session.state?.position?.duration || 0;
      const targetTime = cardDom.dragPct * dur;
      commitSeekPosition(cardDom, targetTime, dur);
    }
  };

  sliderContainer.addEventListener("pointerup", commitSeek);
  sliderContainer.addEventListener("pointercancel", commitSeek);

  // Prevent click and mouse events from bubbling and causing card focus
  sliderContainer.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  sliderContainer.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });
  sliderContainer.addEventListener("mouseup", (e) => {
    e.stopPropagation();
  });

  // Keyboard navigation on slider
  sliderContainer.addEventListener("keydown", (e) => {
    const pos = cardDom.session.state?.position;
    if (!pos || !pos.duration || pos.duration <= 0) return;
    const dur = pos.duration;
    let current = cardDom.lastInterpolatedPos;
    let step = 0;

    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      step = -5;
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      step = 5;
    } else if (e.key === "PageDown") {
      step = -10;
    } else if (e.key === "PageUp") {
      step = 10;
    } else if (e.key === "Home") {
      step = -current;
    } else if (e.key === "End") {
      step = dur - current;
    }

    if (step !== 0) {
      e.preventDefault();
      e.stopPropagation();
      const target = Math.max(0, Math.min(current + step, dur));
      commitSeekPosition(cardDom, target, dur);
    }
  });

  const fwdBtn = document.createElement("button");
  fwdBtn.className = "ctrl-btn fwd-btn";
  fwdBtn.setAttribute("type", "button");
  fwdBtn.setAttribute("aria-label", "Seek forward 10 seconds");
  setIcon(fwdBtn, "forward_10");
  fwdBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (cardDom.fwdBtn.disabled) return;
    sendCommand(cardDom.session.tabId, cardDom.session.frameId, {
      action: "seekforward",
      offset: 10
    });
  });

  const nextBtn = document.createElement("button");
  nextBtn.className = "ctrl-btn next-btn";
  nextBtn.setAttribute("type", "button");
  nextBtn.setAttribute("aria-label", "Next track");
  setIcon(nextBtn, "skip_next");
  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (cardDom.nextBtn.disabled) return;
    sendCommand(cardDom.session.tabId, cardDom.session.frameId, {
      action: "nexttrack"
    });
  });

  bottomRowEl.appendChild(prevBtn);
  bottomRowEl.appendChild(rewBtn);
  bottomRowEl.appendChild(sliderContainer);
  bottomRowEl.appendChild(fwdBtn);
  bottomRowEl.appendChild(nextBtn);

  // Prevent any clicks or drags in control row from focusing the tab
  bottomRowEl.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  bottomRowEl.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });
  bottomRowEl.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });

  const chapterSection = document.createElement("section");
  chapterSection.className = "chapter-section";
  chapterSection.hidden = true;
  chapterSection.id = `chapters-${session.tabId}`;
  chapterBtn.setAttribute("aria-controls", chapterSection.id);

  const chapterHeading = document.createElement("div");
  chapterHeading.className = "chapter-heading";
  chapterHeading.textContent = "Chapters";

  const chapterList = document.createElement("div");
  chapterList.className = "chapter-list";
  chapterList.setAttribute("role", "group");
  chapterList.setAttribute("aria-label", "Video chapters");
  chapterSection.appendChild(chapterHeading);
  chapterSection.appendChild(chapterList);

  const volumeSection = document.createElement("section");
  volumeSection.className = "volume-section";
  volumeSection.hidden = true;
  volumeSection.id = `volume-${session.tabId}`;
  volumeSection.setAttribute("aria-label", "Volume controls");
  volumeBtn.setAttribute("aria-controls", volumeSection.id);

  const volumeMuteBtn = document.createElement("button");
  volumeMuteBtn.className = "volume-mute-btn";
  volumeMuteBtn.type = "button";
  volumeMuteBtn.setAttribute("aria-label", "Mute tab");
  volumeMuteBtn.title = "Mute tab";
  setIcon(volumeMuteBtn, "volume_up");
  volumeMuteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    sendMute(cardDom.session.tabId, !cardDom.session.muted);
  });

  const volumeSlider = document.createElement("input");
  volumeSlider.className = "volume-slider";
  volumeSlider.type = "range";
  volumeSlider.min = "0";
  volumeSlider.max = "100";
  volumeSlider.step = "1";
  volumeSlider.value = "100";
  volumeSlider.style.setProperty("--volume-pct", "100%");
  volumeSlider.setAttribute("aria-valuemin", "0");
  volumeSlider.setAttribute("aria-valuemax", "100");

  const volumeLabel = document.createElement("span");
  volumeLabel.className = "volume-label";
  volumeLabel.textContent = "100%";

  const volumeUnavailable = document.createElement("div");
  volumeUnavailable.className = "volume-unavailable";
  volumeUnavailable.textContent = "Volume unavailable for this player";
  volumeUnavailable.hidden = true;

  volumeSection.appendChild(volumeMuteBtn);
  volumeSection.appendChild(volumeSlider);
  volumeSection.appendChild(volumeLabel);
  volumeSection.appendChild(volumeUnavailable);

  // Clicking or dragging inside the volume row must not focus the tab.
  volumeSection.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  volumeSection.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });
  volumeSection.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });
  volumeSection.addEventListener("pointerup", (e) => {
    e.stopPropagation();
  });

  volumeSlider.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    cardDom.volumeDragging = true;
  });

  volumeSlider.addEventListener("input", () => {
    const pct = Math.max(0, Math.min(100, Number(volumeSlider.value) || 0));
    const level = pct / 100;
    cardDom.dragVolume = level;
    cardDom.volumeDragging = true;
    paintVolumeSlider(volumeSlider, volumeLabel, pct);
    const now = Date.now();
    if (now - cardDom.lastVolumeSentAt >= 80) {
      cardDom.lastVolumeSentAt = now;
      sendVolumeLevel(cardDom, level);
    } else if (cardDom.volumeThrottleTimer === null) {
      cardDom.volumeThrottleTimer = window.setTimeout(() => {
        cardDom.volumeThrottleTimer = null;
        const pending = cardDom.dragVolume;
        if (pending === null) return;
        cardDom.lastVolumeSentAt = Date.now();
        sendVolumeLevel(cardDom, pending);
      }, 80);
    }
  });

  const commitVolumeSlider = () => {
    if (cardDom.volumeThrottleTimer !== null) {
      window.clearTimeout(cardDom.volumeThrottleTimer);
      cardDom.volumeThrottleTimer = null;
    }
    const pct = Math.max(0, Math.min(100, Number(volumeSlider.value) || 0));
    const level = pct / 100;
    cardDom.lastVolumeSentAt = Date.now();
    sendVolumeLevel(cardDom, level);
    cardDom.pendingVolume = { level, expiresAt: Date.now() + 2000 };
    cardDom.dragVolume = null;
    cardDom.volumeDragging = false;
    paintVolumeSlider(volumeSlider, volumeLabel, pct);
  };
  volumeSlider.addEventListener("change", (e) => {
    e.stopPropagation();
    commitVolumeSlider();
  });
  volumeSlider.addEventListener("pointerup", (e) => {
    e.stopPropagation();
  });
  volumeSlider.addEventListener("pointercancel", (e) => {
    e.stopPropagation();
    cardDom.volumeDragging = false;
    cardDom.dragVolume = null;
  });
  volumeSlider.addEventListener("blur", () => {
    cardDom.volumeDragging = false;
    if (cardDom.dragVolume !== null && cardDom.pendingVolume === null) {
      cardDom.dragVolume = null;
    }
  });
  volumeSlider.addEventListener("keydown", (e) => {
    // Let the native range input handle arrows/page/home/end, but keep the
    // card from interpreting them as reorder shortcuts.
    e.stopPropagation();
  });
  volumeSlider.addEventListener("keyup", (e) => {
    e.stopPropagation();
  });

  const cardToolbar = document.createElement("div");
  cardToolbar.className = "card-toolbar";
  cardToolbar.append(chapterBtn, volumeBtn, pinBtn, dragHandle);
  cardEl.appendChild(cardToolbar);
  cardEl.appendChild(topRowEl);
  cardEl.appendChild(bottomRowEl);
  cardEl.appendChild(volumeSection);
  cardEl.appendChild(chapterSection);

  const cardDom: CardDom = {
    cardEl,
    topRowEl,
    artworkContainer,
    artworkImg: null,
    textColEl,
    sourceFavicon,
    sourceHostname,
    titleEl,
    artistEl,
    playBtn,
    bottomRowEl,
    prevBtn,
    rewBtn,
    sliderContainer,
    activeTrack,
    inactiveTrack,
    thumb,
    fwdBtn,
    nextBtn,
    dragHandle,
    pinBtn,
    chapterBtn,
    chapterSection,
    chapterList,
    chapterVideoId: null,
    chapters: [],
    chaptersOpen: false,
    activeChapterIndex: -1,
    volumeBtn,
    volumeSection,
    volumeMuteBtn,
    volumeSlider,
    volumeLabel,
    volumeUnavailable,
    volumeOpen: false,
    volumeDragging: false,
    dragVolume: null,
    pendingVolume: null,
    lastVolumeSentAt: 0,
    volumeThrottleTimer: null,
    session,
    isDragging: false,
    dragPct: 0,
    lastInterpolatedPos: 0,
    pendingPlayback: null,
    pendingSeek: null
  };

  return cardDom;
}

function sendVolumeLevel(card: CardDom, level: number) {
  const clamped = Math.min(1, Math.max(0, level));
  if (!Number.isFinite(clamped)) return;
  sendCommand(card.session.tabId, card.session.frameId, {
    action: "setvolume",
    volume: clamped
  });
}

function paintVolumeSlider(slider: HTMLInputElement, label: HTMLElement, pct: number) {
  const rounded = Math.round(Math.max(0, Math.min(100, pct)));
  slider.value = String(rounded);
  slider.setAttribute("aria-valuenow", String(rounded));
  slider.setAttribute("aria-valuetext", `${rounded} percent`);
  slider.style.setProperty("--volume-pct", `${rounded}%`);
  label.textContent = `${rounded}%`;
}

function setVolumeOpen(card: CardDom, open: boolean) {
  card.volumeOpen = open;
  card.volumeSection.hidden = !open;
  card.volumeBtn.classList.toggle("is-open", open);
  card.volumeBtn.setAttribute("aria-expanded", String(open));
  card.volumeBtn.setAttribute("aria-label", open ? "Hide volume controls" : "Show volume controls");
  card.volumeBtn.title = open ? "Hide volume controls" : "Show volume controls";
}

function updateVolumeUI(card: CardDom) {
  const session = card.session;
  const muted = Boolean(session.muted);
  setIcon(card.volumeMuteBtn, muted ? "volume_off" : "volume_up");
  card.volumeMuteBtn.setAttribute("aria-label", muted ? "Unmute tab" : "Mute tab");
  card.volumeMuteBtn.title = muted ? "Unmute tab" : "Mute tab";

  const title = session.state?.metadata?.title || session.tabTitle || session.hostname || "this tab";
  card.volumeSlider.setAttribute("aria-label", `Volume for ${title}`);
  card.volumeMuteBtn.setAttribute("aria-label", muted ? `Unmute tab for ${title}` : `Mute tab for ${title}`);

  const vol = session.state?.volume ?? null;
  if (!vol) {
    card.volumeSlider.style.display = "none";
    card.volumeLabel.style.display = "none";
    card.volumeUnavailable.hidden = false;
    card.volumeSlider.disabled = true;
    return;
  }
  card.volumeSlider.disabled = false;
  card.volumeSlider.style.display = "";
  card.volumeLabel.style.display = "";
  card.volumeUnavailable.hidden = true;

  const now = Date.now();
  if (card.pendingVolume && now >= card.pendingVolume.expiresAt) {
    card.pendingVolume = null;
  }
  // Preserve the locally dragged value until the page reports the new level.
  if (card.volumeDragging && card.dragVolume !== null) {
    return;
  }
  if (card.pendingVolume) {
    if (Math.abs(vol.level - card.pendingVolume.level) <= 0.02) {
      card.pendingVolume = null;
    } else {
      paintVolumeSlider(card.volumeSlider, card.volumeLabel, card.pendingVolume.level * 100);
      return;
    }
  }
  // Do not make the thumb jump backward while the user has focus on the slider;
  // the pending/drag guards above already cover the active interaction.
  paintVolumeSlider(card.volumeSlider, card.volumeLabel, Math.min(1, Math.max(0, vol.level)) * 100);
}

function setChaptersOpen(card: CardDom, open: boolean) {
  card.chaptersOpen = open;
  card.chapterSection.hidden = !open;
  card.chapterBtn.classList.toggle("is-open", open);
  card.chapterBtn.setAttribute("aria-expanded", String(open));
  updateChaptersButton(card);
  if (open) scrollToActiveChapter(card);
}

// Sets the chapter button label, tooltip, and disabled appearance from the
// chapter state the background attached to the card's session. Uses
// aria-disabled (not the native disabled attribute) so the button keeps its
// hover tooltip and keyboard focus while refusing to open.
function updateChaptersButton(card: CardDom) {
  const btn = card.chapterBtn;
  const videoId = card.session.youtubeVideoId ?? null;
  const chapterState = card.session.chapterState;
  if (
    videoId && chapterState && chapterState.videoId === videoId &&
    chapterState.status === "none"
  ) {
    btn.classList.add("is-disabled");
    btn.setAttribute("aria-disabled", "true");
    btn.setAttribute("aria-label", "This video has no chapters");
    btn.title = "This video has no chapters";
  } else {
    btn.classList.remove("is-disabled");
    btn.removeAttribute("aria-disabled");
    btn.setAttribute("aria-label", card.chaptersOpen ? "Hide video chapters" : "Show video chapters");
    btn.title = card.chaptersOpen ? "Hide video chapters" : "Show video chapters";
  }
}

// Stores a chapter list response for the open section. Responses for a video
// the card no longer shows are ignored so an old response can never affect
// the new video. Button state itself comes from the session data.
function applyChaptersResult(
  card: CardDom,
  msg: { tabId: number; videoId: string; chapters: YouTubeChapter[]; status: "available" | "none" | "error" }
) {
  if (card.session.tabId !== msg.tabId) return;
  const currentVideoId = card.session.youtubeVideoId ?? null;
  if (!currentVideoId || currentVideoId !== msg.videoId) return;
  if (msg.status === "available") {
    renderChapters(card, msg.videoId, msg.chapters);
  } else if (msg.status === "none") {
    if (card.chaptersOpen) {
      renderChapters(card, msg.videoId, []);
    }
  } else if (card.chaptersOpen) {
    showChapterMessage(card, "Could not load chapters");
  }
}

function showChapterMessage(card: CardDom, text: string) {
  const message = document.createElement("div");
  message.className = "chapter-message";
  message.textContent = text;
  card.chapterList.replaceChildren(message);
}

function updateActiveChapter(card: CardDom) {
  if (!card.chaptersOpen || card.chapters.length === 0) return;
  const position = card.pendingSeek?.position ?? card.lastInterpolatedPos;
  let activeIndex = -1;
  for (let i = 0; i < card.chapters.length; i++) {
    if (card.chapters[i].startTime <= position + 0.5) activeIndex = i;
    else break;
  }
  if (activeIndex === card.activeChapterIndex) return;
  card.activeChapterIndex = activeIndex;
  const rows = card.chapterList.querySelectorAll<HTMLButtonElement>(".chapter-row");
  rows.forEach((row, index) => {
    row.classList.toggle("is-current", index === activeIndex);
    if (index === activeIndex) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
  });
}

function scrollToActiveChapter(card: CardDom) {
  if (!card.chaptersOpen || card.chapters.length === 0) return;
  updateActiveChapter(card);
  const list = card.chapterList;
  const row = list.querySelectorAll<HTMLButtonElement>(".chapter-row")[card.activeChapterIndex];
  if (!row) {
    list.scrollTop = 0;
    return;
  }
  // Scroll only the chapter list; scrollIntoView would also move the flyout.
  const listRect = list.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const rowTop = rowRect.top - listRect.top + list.scrollTop;
  list.scrollTop = rowTop - (list.clientHeight - rowRect.height) / 2;
}

function renderChapters(card: CardDom, videoId: string, chapters: YouTubeChapter[]) {
  card.chapterVideoId = videoId;
  card.chapters = chapters;
  card.activeChapterIndex = -1;
  if (chapters.length === 0) {
    showChapterMessage(card, "No chapters available for this video");
    return;
  }
  const rows = chapters.map((chapter) => {
    const row = document.createElement("button");
    row.className = "chapter-row";
    row.type = "button";
    row.setAttribute("aria-label", `Seek to ${chapter.title} at ${formatTime(chapter.startTime)}`);
    const title = document.createElement("span");
    title.className = "chapter-title";
    title.textContent = chapter.title;
    const time = document.createElement("span");
    time.className = "chapter-time";
    time.textContent = formatTime(chapter.startTime);
    row.append(title, time);
    row.addEventListener("click", (event) => {
      event.stopPropagation();
      if (card.session.youtubeVideoId !== videoId) return;
      const duration = card.session.state?.position?.duration;
      const seekTime = duration && Number.isFinite(duration)
        ? Math.min(chapter.startTime, duration) : chapter.startTime;
      if (duration && Number.isFinite(duration) && duration > 0) {
        commitSeekPosition(card, seekTime, duration, 0);
      } else {
        sendCommand(card.session.tabId, 0, { action: "seekto", seekTime });
        card.lastInterpolatedPos = seekTime;
      }
      updateActiveChapter(card);
    });
    return row;
  });
  card.chapterList.replaceChildren(...rows);
  scrollToActiveChapter(card);
}

function updatePlayButton(card: CardDom) {
  const session = card.session;
  if (session.degraded) {
    card.playBtn.classList.remove("is-buffering");
    card.playBtn.removeAttribute("aria-busy");
    setIcon(card.playBtn, session.muted ? "volume_off" : "volume_up");
    card.playBtn.setAttribute(
      "aria-label",
      session.muted ? "Unmute tab" : "Mute tab"
    );
    card.playBtn.disabled = false;
    card.playBtn.removeAttribute("title");
    return;
  }
  const blocked = session.state?.playBlocked === true;
  const buffering = session.state?.buffering === true;
  const isPlaying = card.pendingPlayback
    ? card.pendingPlayback.state === "playing"
    : isSessionPlaying(session);
  setIcon(card.playBtn, isPlaying ? "pause" : "play_arrow");
  card.playBtn.classList.toggle("is-buffering", buffering);
  if (buffering) {
    card.playBtn.disabled = true;
    card.playBtn.setAttribute("aria-label", "Media buffering");
    card.playBtn.setAttribute("aria-busy", "true");
    card.playBtn.title = "Media is buffering";
  } else if (blocked && !isPlaying) {
    card.playBtn.removeAttribute("aria-busy");
    // The page has not played yet and Firefox forbids script initiated play.
    card.playBtn.disabled = true;
    card.playBtn.setAttribute("aria-label", "Play blocked by autoplay");
    card.playBtn.setAttribute(
      "title",
      "Autoplay is blocked for this video. Open the tab and press play once, then this button will work."
    );
  } else {
    card.playBtn.removeAttribute("aria-busy");
    card.playBtn.disabled = false;
    card.playBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
    card.playBtn.removeAttribute("title");
  }
}

function reconcilePendingPlayback(
  card: CardDom,
  pending: NonNullable<CardDom["pendingPlayback"]>
) {
  if (card.pendingPlayback !== pending) return;

  const now = Date.now();
  if (card.session.state?.playbackState === pending.state) {
    pending.confirmedAt ??= now;
    if (now - pending.confirmedAt >= pending.settleMs) {
      card.pendingPlayback = null;
      updatePlayButton(card);
      return;
    }
  } else {
    pending.confirmedAt = null;
    if (now >= pending.expiresAt) {
      // The page did not confirm the command. Restore its reported state.
      card.pendingPlayback = null;
      updatePlayButton(card);
      return;
    }
  }

  window.setTimeout(() => reconcilePendingPlayback(card, pending), 100);
}

function applySliderPosition(card: CardDom, pos: number, duration: number) {
  card.lastInterpolatedPos = pos;
  updateActiveChapter(card);
  if (duration <= 0 || !isFinite(duration)) {
    card.activeTrack.style.width = "0px";
    card.inactiveTrack.style.width = "100%";
    card.thumb.style.left = "0px";
    return;
  }

  const pct = Math.max(0, Math.min(pos / duration, 1));
  const rect = card.sliderContainer.getBoundingClientRect();
  const width = rect.width > 0 ? rect.width : 256; // fallback width if hidden

  const thumbX = width * pct;
  const GAP = 4;
  const HALF_THUMB = 2;

  // Active track: 0 to thumbX - GAP - HALF_THUMB
  const activeW = Math.max(0, thumbX - GAP - HALF_THUMB);
  // Inactive track: thumbX + GAP + HALF_THUMB to width
  const inactiveW = Math.max(0, width - (thumbX + GAP + HALF_THUMB));

  card.activeTrack.style.width = `${activeW}px`;
  card.inactiveTrack.style.width = `${inactiveW}px`;
  card.thumb.style.left = `${thumbX}px`;

  card.sliderContainer.setAttribute("aria-valuenow", String(Math.round(pos)));
  card.sliderContainer.setAttribute("aria-valuemax", String(Math.round(duration)));
  card.sliderContainer.setAttribute(
    "aria-valuetext",
    `${formatTime(pos)} / ${formatTime(duration)}`
  );
}

function commitSeekPosition(card: CardDom, position: number, duration: number, frameId = card.session.frameId) {
  const now = Date.now();
  card.pendingSeek = {
    position,
    updatedAt: now,
    duration,
    playbackRate: card.session.state?.playbackState === "playing"
      ? (card.session.state.position?.playbackRate || 1)
      : 0,
    expiresAt: now + 4000
  };
  applySliderPosition(card, position, duration);
  sendCommand(card.session.tabId, frameId, {
    action: "seekto",
    seekTime: position
  });
}

function updateCardDom(card: CardDom, session: Session) {
  if (session.youtubeVideoId !== card.session.youtubeVideoId) {
    setChaptersOpen(card, false);
    card.chapterVideoId = null;
    card.chapters = [];
    card.activeChapterIndex = -1;
    card.chapterList.replaceChildren();
  }
  if (card.pendingPlayback &&
      ((session.frameId !== card.session.frameId && session.hostname !== "open.spotify.com") ||
       session.degraded ||
       (session.state?.playBlocked && card.pendingPlayback.state === "playing"))) {
    card.pendingPlayback = null;
  }
  if (card.pendingSeek) {
    const incoming = session.state?.position;
    if (session.frameId !== card.session.frameId ||
        (incoming && Math.abs(incoming.duration - card.pendingSeek.duration) > 1)) {
      card.pendingSeek = null;
    } else if (incoming &&
               Math.abs(incoming.position - card.pendingSeek.position) <= 1.5) {
      // The background can push an older position before the page reports
      // seeked. Keep the thumb at the requested point until it catches up.
      card.pendingSeek = null;
    }
  }
  card.session = session;
  card.cardEl.dataset.tabId = String(session.tabId);
  card.pinBtn.classList.toggle("is-pinned", session.pinned);
  card.pinBtn.setAttribute("aria-pressed", String(session.pinned));
  card.pinBtn.setAttribute("aria-label", session.pinned ? "Unpin card" : "Pin card to top");
  card.pinBtn.title = session.pinned ? "Unpin card" : "Pin card to top";
  card.chapterBtn.hidden = !session.youtubeVideoId || session.degraded;
  // Chapter availability arrives with the session data from the background.
  // While a first-time lookup is still running the result is unknown, so the
  // button stays hidden; it appears only once the result is known.
  const chapterState = session.chapterState;
  const chapterKnown = !session.degraded && !!session.youtubeVideoId &&
    !!chapterState && chapterState.videoId === session.youtubeVideoId;
  if (!chapterKnown) {
    card.chapterBtn.hidden = true;
  }
  if (card.chapterBtn.hidden && card.chaptersOpen) setChaptersOpen(card, false);
  updateChaptersButton(card);
  card.volumeSection.id = `volume-${session.tabId}`;
  card.volumeBtn.setAttribute("aria-controls", card.volumeSection.id);

  // 1. Text column
  const hostname = session.hostname || "browser";
  card.sourceHostname.textContent = hostname;

  const favicon = safeImageUrl(session.favIconUrl);
  if (favicon) {
    if (card.sourceFavicon.getAttribute("src") !== favicon) card.sourceFavicon.src = favicon;
    card.sourceFavicon.style.display = "block";
  } else {
    card.sourceFavicon.removeAttribute("src");
    card.sourceFavicon.style.display = "none";
  }

  const meta = session.state?.metadata;
  card.titleEl.textContent = meta?.title || session.tabTitle || "Untitled audio";
  card.artistEl.textContent = meta?.artist || "";

  // Keep image nodes stable: repeated state updates must not trigger fresh
  // artwork requests. Remote artwork still needs a request to its host.
  const artwork = session.degraded ? null : safeImageUrl(chooseBestArtwork(meta?.artwork));
  const imageKey = JSON.stringify([artwork, favicon]);
  if (card.artworkContainer.dataset.imageKey !== imageKey) {
    card.artworkContainer.dataset.imageKey = imageKey;
    const showFavicon = () => {
      if (card.artworkContainer.dataset.imageKey !== imageKey) return;
      card.artworkImg = null;
      if (!favicon) { card.artworkContainer.replaceChildren(); return; }
      const fav = document.createElement("img");
      fav.className = "artwork-fallback";
      fav.alt = "";
      fav.referrerPolicy = "no-referrer";
      fav.src = favicon;
      card.artworkContainer.replaceChildren(fav);
    };
    if (artwork) {
      const img = document.createElement("img");
      img.className = "artwork-img";
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.onerror = showFavicon;
      img.src = artwork;
      card.artworkContainer.replaceChildren(img);
      card.artworkImg = img;
    } else showFavicon();
  }

  // 3. Play button
  updatePlayButton(card);

  // Volume row (kept stable; works for degraded/Web Audio via tab mute).
  updateVolumeUI(card);

  // 4. Degraded vs Full Controls
  if (session.degraded) {
    card.bottomRowEl.style.display = "none";
    return;
  }
  card.bottomRowEl.style.display = "flex";

  // Actions visibility
  const actions = session.state?.actions || [];
  const isSeekable = Boolean(session.state?.seekable && !session.state?.isLive);
  const playbackBlocked = session.state?.playBlocked === true;

  // Keep the controls in place, but disable unavailable track actions.
  card.prevBtn.classList.remove("is-hidden");
  card.nextBtn.classList.remove("is-hidden");
  card.prevBtn.disabled = !actions.includes("previoustrack");
  card.nextBtn.disabled = !actions.includes("nexttrack");
  card.prevBtn.title = card.prevBtn.disabled ? "No previous track available" : "Previous track";
  card.nextBtn.title = card.nextBtn.disabled ? "No next track available" : "Next track";

  // ±10s skip buttons & slider
  if (isSeekable) {
    card.rewBtn.classList.remove("is-hidden");
    card.fwdBtn.classList.remove("is-hidden");
    card.rewBtn.disabled = playbackBlocked || !actions.includes("seekbackward");
    card.fwdBtn.disabled = playbackBlocked || !actions.includes("seekforward");
    card.rewBtn.title = playbackBlocked
      ? "Seek unavailable while playback is blocked"
      : card.rewBtn.disabled ? "Seek backward unavailable" : "Seek backward 10 seconds";
    card.fwdBtn.title = playbackBlocked
      ? "Seek unavailable while playback is blocked"
      : card.fwdBtn.disabled ? "Seek forward unavailable" : "Seek forward 10 seconds";
    card.sliderContainer.style.display = "flex";
  } else {
    card.rewBtn.classList.add("is-hidden");
    card.fwdBtn.classList.add("is-hidden");
    card.sliderContainer.style.display = "none";
  }
}

function updateSessionsView(sessions: Session[]) {
  if (!hasHostPermissions) {
    renderPermissionsMissing();
    return;
  }

  if (isReorderingCards) {
    pendingSessionsUpdate = sessions;
    return;
  }

  if (preferredCardOrder) {
    // A state push may have been queued before the background processed the
    // reorder. Merge its fresh card data without restoring its stale order.
    const rank = new Map(preferredCardOrder.map((tabId, index) => [tabId, index]));
    const newSessions = sessions.filter((session) => !rank.has(session.tabId));
    const existingSessions = sessions.filter((session) => rank.has(session.tabId));
    existingSessions.sort((a, b) => rank.get(a.tabId)! - rank.get(b.tabId)!);
    const ordered = [...newSessions, ...existingSessions];
    sessions = [
      ...ordered.filter((session) => session.pinned),
      ...ordered.filter((session) => !session.pinned)
    ];
    preferredCardOrder = sessions.map((session) => session.tabId);
  }

  if (sessions.length === 0) {
    currentSessions = [];
    renderEmptyState();
    return;
  }

  currentSessions = sessions;

  // Remove empty or permission card if any
  const emptyOrPerm = cardsContainer.querySelector(".empty-card, .permission-card");
  if (emptyOrPerm) {
    emptyOrPerm.remove();
  }

  const incomingTabIds = new Set(sessions.map((s) => s.tabId));

  // Prune removed cards
  for (const [tabId, card] of renderedCards.entries()) {
    if (!incomingTabIds.has(tabId)) {
      card.cardEl.remove();
      renderedCards.delete(tabId);
    }
  }

  // Diff-update or insert new cards in order
  sessions.forEach((session, index) => {
    let card = renderedCards.get(session.tabId);
    if (!card) {
      card = createCardDom(session);
      renderedCards.set(session.tabId, card);
    }

    updateCardDom(card, session);

    // Ensure correct DOM ordering
    const existingChild = cardsContainer.children[index];
    if (existingChild !== card.cardEl) {
      cardsContainer.insertBefore(card.cardEl, existingChild || null);
    }
  });
}

// Progress interpolation loop
function startInterpolationLoop() {
  function loop() {
    const now = Date.now();
    for (const card of renderedCards.values()) {
      if (card.isDragging) continue;

      if (card.pendingSeek && now >= card.pendingSeek.expiresAt) {
        card.pendingSeek = null;
      }
      const posState = card.pendingSeek || card.session.state?.position;
      if (!posState || isNaN(posState.duration) || posState.duration <= 0) {
        continue;
      }

      let currentPos = posState.position;
      if (card.session.state?.playbackState === "playing" && !card.session.state.buffering) {
        const elapsedSec = (now - posState.updatedAt) / 1000;
        currentPos += elapsedSec * (posState.playbackRate || 1);
      }

      currentPos = Math.max(0, Math.min(currentPos, posState.duration));
      applySliderPosition(card, currentPos, posState.duration);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// Dev Overlay setup
function initDevOverlay() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("overlay") === "1") {
    const overlayImg = document.createElement("img");
    overlayImg.className = "dev-overlay";
    overlayImg.src = "dev/reference.png";
    overlayImg.alt = "Reference overlay";
    document.body.appendChild(overlayImg);
    isDevOverlayActive = true;

    // Press 'O' to cycle overlay opacity: 0.5 -> 1.0 -> 0.0 -> 0.5
    window.addEventListener("keydown", (e) => {
      if (e.key === "o" || e.key === "O") {
        const curr = parseFloat(overlayImg.style.opacity || "0.5");
        if (curr === 0.5) overlayImg.style.opacity = "1";
        else if (curr === 1) overlayImg.style.opacity = "0";
        else overlayImg.style.opacity = "0.5";
      }
    });
  }
}

// Initialize popup
async function initPopup() {
  const urlParams = new URLSearchParams(window.location.search);
  initDevOverlay();

  // Show a real UI before waiting for permissions or the event page to wake.
  renderEmptyState();

  if (urlParams.get("theme") === "dark") {
    document.documentElement.classList.add("dark");
  }

  // Check if running in WebExtension context
  if (typeof browser === "undefined" || !browser.runtime) {
    if (urlParams.get("mock") !== "1" && urlParams.get("mock") !== "multi") {
      renderEmptyState();
      return;
    }
  }

  // Check permissions
  try {
    const hasPerm = await browser.permissions.contains({
      origins: ["<all_urls>"]
    });
    hasHostPermissions = hasPerm;
  } catch (_) {
    hasHostPermissions = true;
  }

  if (!hasHostPermissions) {
    renderPermissionsMissing();
  }
  void showAudibleFallback();
  if (urlParams.get("mock") === "1" || urlParams.get("mock") === "multi") {
    const isMulti = urlParams.get("mock") === "multi";
    const mockSession1: Session = {
      tabId: 1,
      frameId: 0,
      hostname: "music.youtube.com",
      favIconUrl: "dev/ytm-favicon.png",
      tabTitle: "Different Strings",
      state: {
        source: "mediasession",
        metadata: {
          title: "Different Strings",
          artist: "Rush",
          album: "Permanent Waves",
          artwork: [{ src: "dev/rush-artwork.png" }]
        },
        playbackState: "playing",
        position: {
          duration: 100,
          position: 16.4,
          playbackRate: 0,
          updatedAt: Date.now()
        },
        actions: [
          "play",
          "pause",
          "previoustrack",
          "nexttrack",
          "seekbackward",
          "seekforward",
          "seekto"
        ],
        isLive: false,
        seekable: true,
        volume: { level: 0.7, mediaMuted: false },
        lastPlayedAt: Date.now()
      },
      audible: true,
      muted: false,
      degraded: false,
      pinned: false,
      chapterState: null
    };

    const mockSession2: Session = {
      tabId: 2,
      frameId: 0,
      hostname: "open.spotify.com",
      favIconUrl: "dev/ytm-favicon.png",
      tabTitle: "Billie Jean - Michael Jackson",
      state: {
        source: "mediasession",
        metadata: {
          title: "Billie Jean",
          artist: "Michael Jackson",
          album: "Thriller",
          artwork: [{ src: "dev/rush-artwork.png" }]
        },
        playbackState: "paused",
        position: {
          duration: 294,
          position: 120,
          playbackRate: 0,
          updatedAt: Date.now()
        },
        actions: ["play", "pause", "previoustrack", "nexttrack", "seekto"],
        isLive: false,
        seekable: true,
        volume: { level: 0.35, mediaMuted: false },
        lastPlayedAt: Date.now() - 10000
      },
      audible: false,
      muted: false,
      degraded: false,
      pinned: false,
      chapterState: null
    };

    const mockSession3: Session = {
      tabId: 3,
      frameId: 0,
      hostname: "reddit.com",
      favIconUrl: "dev/ytm-favicon.png",
      tabTitle: "Funny video with sound - Reddit",
      state: null,
      audible: true,
      muted: false,
      degraded: true,
      pinned: false,
      chapterState: null
    };

    currentSessions = isMulti ? [mockSession1, mockSession2, mockSession3] : [mockSession1];
    updateSessionsView(currentSessions);
    startInterpolationLoop();
    return;
  }

  // A disconnected event page must not leave the panel permanently blank.
  function connectPopup() {
    try {
      const connection = browser.runtime.connect({ name: "popup" });
      port = connection;
      connection.onMessage.addListener((rawMsg: any) => {
        const msg = rawMsg as BgToPopupMessage;
        if (msg.type === "sessions") {
          updateSessionsView(msg.sessions);
          if (currentSessions.length === 0) void showAudibleFallback();
        } else if (msg.type === "chapters") {
          const card = renderedCards.get(msg.tabId);
          if (card) {
            applyChaptersResult(card, msg);
          }
        }
      });
      connection.onDisconnect.addListener(() => {
        if (port !== connection) return;
        port = null;
        setTimeout(connectPopup, 500);
      });
      connection.postMessage({ type: "request-sessions" } as PopupToBgMessage);
      for (const card of renderedCards.values()) {
        if (card.chaptersOpen && card.session.youtubeVideoId) {
          connection.postMessage({ type: "chapters-request", tabId: card.session.tabId } as PopupToBgMessage);
        }
      }
    } catch (err) {
      console.error("[MediaControls Popup] Cannot connect to background:", err);
      setTimeout(connectPopup, 500);
    }
  }
  connectPopup();

  startInterpolationLoop();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPopup, { once: true });
} else {
  void initPopup();
}
