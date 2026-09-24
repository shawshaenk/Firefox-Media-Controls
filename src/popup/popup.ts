import type {
  Action,
  Command,
  FrameState,
  MediaArtwork,
  Session,
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

  // State tracking
  session: Session;
  isDragging: boolean;
  dragPct: number;
  lastInterpolatedPos: number;
  pendingPlayback: {
    state: "playing" | "paused";
    expiresAt: number;
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
        state: null, audible: true, muted: Boolean(tab.mutedInfo?.muted), degraded: true
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
  const m = Math.floor(total / 60);
  const s = total % 60;
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
  currentSessions = reordered;

  if (port) {
    port.postMessage({
      type: "reorder",
      tabIds: newTabIds
    } as PopupToBgMessage);
  }
}

function moveCardByStep(cardEl: HTMLElement, step: number) {
  const allCards = Array.from(cardsContainer.querySelectorAll<HTMLElement>(".media-card"));
  const idx = allCards.indexOf(cardEl);
  if (idx === -1) return;
  const targetIdx = idx + step;
  if (targetIdx < 0 || targetIdx >= allCards.length) return;

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
  hasMovedPastThreshold: boolean;
  pointerId: number;
} | null = null;

function setupCardDrag(dragHandle: HTMLElement, cardEl: HTMLElement, tabId: number) {
  dragHandle.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    const allCards = Array.from(cardsContainer.querySelectorAll<HTMLElement>(".media-card"));
    if (allCards.length < 2) return;

    const initialIndex = allCards.indexOf(cardEl);
    if (initialIndex === -1) return;

    const rect = cardEl.getBoundingClientRect();

    activeDragSession = {
      dragHandle,
      cardEl,
      tabId,
      startY: e.clientY,
      initialIndex,
      cardHeight: rect.height,
      cards: allCards,
      hasMovedPastThreshold: false,
      pointerId: e.pointerId
    };

    dragHandle.setPointerCapture(e.pointerId);
  });

  dragHandle.addEventListener("pointermove", (e: PointerEvent) => {
    if (!activeDragSession || activeDragSession.pointerId !== e.pointerId) return;

    const deltaY = e.clientY - activeDragSession.startY;
    if (!activeDragSession.hasMovedPastThreshold) {
      if (Math.abs(deltaY) > 3) {
        activeDragSession.hasMovedPastThreshold = true;
        isReorderingCards = true;
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
    const offset = Math.round(deltaY / slotHeight);
    const targetIndex = Math.max(
      0,
      Math.min(activeDragSession.cards.length - 1, activeDragSession.initialIndex + offset)
    );

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

    if (!session.hasMovedPastThreshold) {
      return;
    }

    const deltaY = e.clientY - session.startY;
    const GAP = 8;
    const slotHeight = session.cardHeight + GAP;
    const offset = Math.round(deltaY / slotHeight);
    const targetIndex = Math.max(
      0,
      Math.min(session.cards.length - 1, session.initialIndex + offset)
    );

    for (const c of session.cards) {
      c.style.transform = "";
    }

    if (targetIndex !== session.initialIndex) {
      const currentChildren = Array.from(cardsContainer.children);
      const refNode = currentChildren[targetIndex > session.initialIndex ? targetIndex + 1 : targetIndex];
      cardsContainer.insertBefore(session.cardEl, refNode || null);

      commitCardOrder();
    }

    isReorderingCards = false;

    if (pendingSessionsUpdate) {
      const pending = pendingSessionsUpdate;
      pendingSessionsUpdate = null;
      updateSessionsView(pending);
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
      target.closest(".slider-container") ||
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
      const isPlaying = cardDom.pendingPlayback
        ? cardDom.pendingPlayback.state === "playing"
        : current.state?.playbackState === "playing";
      const requestedState = isPlaying ? "paused" : "playing";
      sendCommand(current.tabId, current.frameId, {
        action: isPlaying ? "pause" : "play"
      });
      const pending: NonNullable<CardDom["pendingPlayback"]> = {
        state: requestedState,
        expiresAt: Date.now() + 2500
      };
      cardDom.pendingPlayback = pending;
      updatePlayButton(cardDom);
      window.setTimeout(() => {
        if (cardDom.pendingPlayback === pending) {
          cardDom.pendingPlayback = null;
          updatePlayButton(cardDom);
        }
      }, 2500);
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

  cardEl.appendChild(dragHandle);
  cardEl.appendChild(topRowEl);
  cardEl.appendChild(bottomRowEl);

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
    session,
    isDragging: false,
    dragPct: 0,
    lastInterpolatedPos: 0,
    pendingPlayback: null,
    pendingSeek: null
  };

  return cardDom;
}

function updatePlayButton(card: CardDom) {
  const session = card.session;
  if (session.degraded) {
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
  const isPlaying = card.pendingPlayback
    ? card.pendingPlayback.state === "playing"
    : session.state?.playbackState === "playing";
  setIcon(card.playBtn, isPlaying ? "pause" : "play_arrow");
  if (blocked && !isPlaying) {
    // The page has not played yet and Firefox forbids script initiated play.
    card.playBtn.disabled = true;
    card.playBtn.setAttribute("aria-label", "Play blocked by autoplay");
    card.playBtn.setAttribute(
      "title",
      "Autoplay is blocked for this video. Open the tab and press play once, then this button will work."
    );
  } else {
    card.playBtn.disabled = false;
    card.playBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
    card.playBtn.removeAttribute("title");
  }
}

function applySliderPosition(card: CardDom, pos: number, duration: number) {
  card.lastInterpolatedPos = pos;
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

function commitSeekPosition(card: CardDom, position: number, duration: number) {
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
  sendCommand(card.session.tabId, card.session.frameId, {
    action: "seekto",
    seekTime: position
  });
}

function updateCardDom(card: CardDom, session: Session) {
  if (card.pendingPlayback &&
      (session.frameId !== card.session.frameId || session.degraded ||
       (session.state?.playBlocked && card.pendingPlayback.state === "playing") ||
       session.state?.playbackState === card.pendingPlayback.state)) {
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

  // 1. Text column
  const hostname = session.hostname || "browser";
  card.sourceHostname.textContent = hostname;

  if (session.favIconUrl) {
    card.sourceFavicon.src = session.favIconUrl;
    card.sourceFavicon.style.display = "block";
  } else {
    card.sourceFavicon.style.display = "none";
  }

  const meta = session.state?.metadata;
  card.titleEl.textContent =
    meta?.title || session.tabTitle || "Untitled audio";
  card.artistEl.textContent = meta?.artist || "";

  // 2. Artwork
  const bestArtwork = chooseBestArtwork(meta?.artwork);
  if (bestArtwork && !session.degraded) {
    const img = document.createElement("img");
    img.className = "artwork-img";
    img.alt = "";
    img.src = bestArtwork;
    img.onerror = () => {
      // Fallback to favicon tile on load error
      if (session.favIconUrl) {
        const fav = document.createElement("img");
        fav.className = "artwork-fallback";
        fav.alt = "";
        fav.src = session.favIconUrl;
        card.artworkContainer.replaceChildren(fav);
      } else {
        card.artworkContainer.replaceChildren();
      }
    };
    card.artworkContainer.replaceChildren(img);
    card.artworkImg = img;
  } else if (session.favIconUrl) {
    const fav = document.createElement("img");
    fav.className = "artwork-fallback";
    fav.alt = "";
    fav.src = session.favIconUrl;
    card.artworkContainer.replaceChildren(fav);
    card.artworkImg = null;
  } else {
    card.artworkContainer.replaceChildren();
    card.artworkImg = null;
  }

  // 3. Play button
  updatePlayButton(card);

  // 4. Degraded vs Full Controls
  if (session.degraded) {
    card.bottomRowEl.style.display = "none";
    return;
  }
  card.bottomRowEl.style.display = "flex";

  // Actions visibility
  const actions = session.state?.actions || [];
  const isSeekable = Boolean(session.state?.seekable && !session.state?.isLive);

  // Prev / Next buttons: always visible and functional on each audio card
  card.prevBtn.classList.remove("is-hidden");
  card.nextBtn.classList.remove("is-hidden");

  // ±10s skip buttons & slider
  if (isSeekable) {
    card.rewBtn.classList.remove("is-hidden");
    card.fwdBtn.classList.remove("is-hidden");
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

  if (sessions.length === 0) {
    currentSessions = [];
    renderEmptyState();
    return;
  }

  if (isReorderingCards) {
    pendingSessionsUpdate = sessions;
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
      if (card.session.state?.playbackState === "playing") {
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
        lastPlayedAt: Date.now()
      },
      audible: true,
      muted: false,
      degraded: false
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
        lastPlayedAt: Date.now() - 10000
      },
      audible: false,
      muted: false,
      degraded: false
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
      degraded: true
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
          currentSessions = msg.sessions;
          updateSessionsView(currentSessions);
          if (currentSessions.length === 0) void showAudibleFallback();
        }
      });
      connection.onDisconnect.addListener(() => {
        if (port !== connection) return;
        port = null;
        setTimeout(connectPopup, 500);
      });
      connection.postMessage({ type: "request-sessions" } as PopupToBgMessage);
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
