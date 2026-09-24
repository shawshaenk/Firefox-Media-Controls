"use strict";
(() => {
  // src/popup/icons.ts
  var ICON_PATHS = {
    expand_more: "M480-383q-7 0-13-2.5t-11-7.5L272-577q-11-11-11-28t11-28q11-11 28-11t28 11l152 152 152-152q11-11 28-11t28 11q11 11 11 28t-11 28L504-393q-5 5-11 7.5t-13 2.5Z",
    push_pin: "M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h6v7l1 1 1-1v-7h6v-2c-1.66 0-3-1.34-3-3Z",
    drag_indicator: "M360-160q-33 0-56.5-23.5T280-240q0-33 23.5-56.5T360-320q33 0 56.5 23.5T440-240q0 33-23.5 56.5T360-160Zm240 0q-33 0-56.5-23.5T520-240q0-33 23.5-56.5T600-320q33 0 56.5 23.5T680-240q0 33-23.5 56.5T600-160ZM360-400q-33 0-56.5-23.5T280-480q0-33 23.5-56.5T360-560q33 0 56.5 23.5T440-480q0 33-23.5 56.5T360-400Zm240 0q-33 0-56.5-23.5T520-480q0-33 23.5-56.5T600-560q33 0 56.5 23.5T680-480q0 33-23.5 56.5T600-400ZM360-640q-33 0-56.5-23.5T280-720q0-33 23.5-56.5T360-800q33 0 56.5 23.5T440-720q0 33-23.5 56.5T360-640Zm240 0q-33 0-56.5-23.5T520-720q0-33 23.5-56.5T600-800q33 0 56.5 23.5T680-720q0 33-23.5 56.5T600-640Z",
    skip_previous: "M220-280v-400q0-17 11.5-28.5T260-720q17 0 28.5 11.5T300-680v400q0 17-11.5 28.5T260-240q-17 0-28.5-11.5T220-280Zm458-1L430-447q-9-6-13.5-14.5T412-480q0-10 4.5-18.5T430-513l248-166q5-4 11-5t11-1q16 0 28 11t12 29v330q0 18-12 29t-28 11q-5 0-11-1t-11-5Z",
    replay_10: "M360-500h-30q-13 0-21.5-8.5T300-530q0-13 8.5-21.5T330-560h60q13 0 21.5 8.5T420-530v180q0 13-8.5 21.5T390-320q-13 0-21.5-8.5T360-350v-150Zm140 180q-17 0-28.5-11.5T460-360v-160q0-17 11.5-28.5T500-560h80q17 0 28.5 11.5T620-520v160q0 17-11.5 28.5T580-320h-80Zm20-60h40v-120h-40v120ZM480-80q-75 0-140.5-28.5t-114-77q-48.5-48.5-77-114T120-440q0-17 11.5-28.5T160-480q17 0 28.5 11.5T200-440q0 117 81.5 198.5T480-160q117 0 198.5-81.5T760-440q0-117-81.5-198.5T480-720h-6l34 34q12 12 11.5 28T508-630q-12 12-28.5 12.5T451-629L348-732q-12-12-12-28t12-28l103-103q12-12 28.5-11.5T508-890q11 12 11.5 28T508-834l-34 34h6q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-440q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-80Z",
    forward_10: "M480-80q-75 0-140.5-28.5t-114-77q-48.5-48.5-77-114T120-440q0-75 28.5-140.5t77-114q48.5-48.5 114-77T480-800h6l-34-34q-12-12-11.5-28t11.5-28q12-12 28.5-12.5T509-891l103 103q12 12 12 28t-12 28L509-629q-12 12-28.5 11.5T452-630q-11-12-11.5-28t11.5-28l34-34h-6q-117 0-198.5 81.5T200-440q0 117 81.5 198.5T480-160q117 0 198.5-81.5T760-440q0-17 11.5-28.5T800-480q17 0 28.5 11.5T840-440q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-80ZM360-500h-30q-13 0-21.5-8.5T300-530q0-13 8.5-21.5T330-560h60q13 0 21.5 8.5T420-530v180q0 13-8.5 21.5T390-320q-13 0-21.5-8.5T360-350v-150Zm140 180q-17 0-28.5-11.5T460-360v-160q0-17 11.5-28.5T500-560h80q17 0 28.5 11.5T620-520v160q0 17-11.5 28.5T580-320h-80Zm20-60h40v-120h-40v120Z",
    skip_next: "M660-280v-400q0-17 11.5-28.5T700-720q17 0 28.5 11.5T740-680v400q0 17-11.5 28.5T700-240q-17 0-28.5-11.5T660-280Zm-440-35v-330q0-18 12-29t28-11q5 0 11 1t11 5l248 166q9 6 13.5 14.5T548-480q0 10-4.5 18.5T530-447L282-281q-5 4-11 5t-11 1q-16 0-28-11t-12-29Z",
    pause: "M640-200q-33 0-56.5-23.5T560-280v-400q0-33 23.5-56.5T640-760q33 0 56.5 23.5T720-680v400q0 33-23.5 56.5T640-200Zm-320 0q-33 0-56.5-23.5T240-280v-400q0-33 23.5-56.5T320-760q33 0 56.5 23.5T400-680v400q0 33-23.5 56.5T320-200Z",
    play_arrow: "M320-273v-414q0-17 12-28.5t28-11.5q5 0 10.5 1.5T381-721l326 207q9 6 13.5 15t4.5 19q0 10-4.5 19T707-446L381-239q-5 3-10.5 4.5T360-233q-16 0-28-11.5T320-273Z",
    volume_up: "M760-481q0-83-44-151.5T598-735q-15-7-22-21.5t-2-29.5q6-16 21.5-23t31.5 0q97 43 155 131.5T840-481q0 108-58 196.5T627-153q-16 7-31.5 0T574-176q-5-15 2-29.5t22-21.5q74-34 118-102.5T760-481ZM280-360H160q-17 0-28.5-11.5T120-400v-160q0-17 11.5-28.5T160-600h120l132-132q19-19 43.5-8.5T480-703v446q0 27-24.5 37.5T412-228L280-360Zm380-120q0 42-19 79.5T591-339q-10 6-20.5.5T560-356v-250q0-12 10.5-17.5t20.5.5q31 25 50 63t19 80Z",
    volume_off: "M671-177q-11 7-22 13t-23 11q-15 7-30.5 0T574-176q-6-15 1.5-29.5T598-227q7-3 13-6.5t12-7.5L480-368v111q0 27-24.5 37.5T412-228L280-360H160q-17 0-28.5-11.5T120-400v-160q0-17 11.5-28.5T160-600h88L84-764q-11-11-11-28t11-28q11-11 28-11t28 11l680 680q11 11 11 28t-11 28q-11 11-28 11t-28-11l-93-93Zm89-304q0-83-44-151.5T598-735q-15-7-22-21.5t-2-29.5q6-16 21.5-23t31.5 0q97 43 155 131t58 197q0 33-6 65.5T817-353q-8 22-24.5 27.5t-30.5.5q-14-5-22.5-18t-.5-30q11-26 16-52.5t5-55.5ZM591-623q33 21 51 63t18 80v10q0 5-1 10-2 13-14 17t-22-6l-51-51q-6-6-9-13.5t-3-15.5v-77q0-12 10.5-17.5t20.5.5Zm-201-59q-6-6-6-14t6-14l22-22q19-19 43.5-8.5T480-703v63q0 14-12 19t-22-5l-56-56Z"
  };
  function createIcon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", name === "push_pin" ? "0 0 24 24" : "0 -960 960 960");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("fill", "currentColor");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATHS[name]);
    svg.appendChild(path);
    return svg;
  }
  function setIcon(container, name) {
    container.replaceChildren(createIcon(name));
  }

  // src/popup/popup.ts
  var port = null;
  var currentSessions = [];
  var renderedCards = /* @__PURE__ */ new Map();
  var hasHostPermissions = true;
  var isDevOverlayActive = false;
  var isReorderingCards = false;
  var pendingSessionsUpdate = null;
  var cardsContainer = document.getElementById("cards-container");
  async function showAudibleFallback() {
    if (!hasHostPermissions || currentSessions.length > 0) return;
    try {
      const tabs = await browser.tabs.query({ audible: true });
      if (currentSessions.length > 0 || tabs.length === 0) return;
      const sessions = tabs.filter((tab) => tab.id !== void 0).map((tab) => {
        let hostname = "";
        try {
          hostname = new URL(tab.url || "").hostname;
        } catch (_) {
        }
        return {
          tabId: tab.id,
          frameId: 0,
          hostname,
          favIconUrl: tab.favIconUrl || "",
          tabTitle: tab.title || "Audible tab",
          state: null,
          audible: true,
          muted: Boolean(tab.mutedInfo?.muted),
          degraded: true,
          pinned: false
        };
      });
      if (sessions.length > 0) updateSessionsView(sessions);
    } catch (err) {
      console.warn("[MediaControls Popup] Could not inspect audible tabs:", err);
    }
  }
  function formatTime(sec) {
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
  function parseSize(sizeStr) {
    if (!sizeStr) return 0;
    const match = sizeStr.match(/(\d+)x(\d+)/i);
    if (match) {
      return parseInt(match[1], 10);
    }
    return 0;
  }
  function chooseBestArtwork(artworks) {
    if (!artworks || artworks.length === 0) return null;
    const sorted = [...artworks].sort((a, b) => parseSize(b.sizes) - parseSize(a.sizes));
    const preferred = sorted.find((a) => parseSize(a.sizes) >= 96);
    return (preferred || sorted[0])?.src || null;
  }
  function sendCommand(tabId, frameId, cmd) {
    if (port) {
      port.postMessage({
        type: "cmd",
        tabId,
        frameId,
        cmd
      });
    }
  }
  function isSessionPlaying(session) {
    if (session.state?.playbackState === "playing") return true;
    if (session.state?.playbackState === "paused") return false;
    return session.audible;
  }
  function sendFocus(tabId) {
    if (port) {
      port.postMessage({
        type: "focus",
        tabId
      });
    }
  }
  function sendMute(tabId, muted) {
    if (port) {
      port.postMessage({
        type: "mute",
        tabId,
        muted
      });
    }
  }
  function renderPermissionsMissing() {
    cardsContainer.replaceChildren();
    renderedCards.clear();
    const card = document.createElement("div");
    card.className = "permission-card";
    const text = document.createElement("div");
    text.className = "permission-text";
    text.textContent = "Media Controls requires permission to access tabs in order to control playback.";
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
            port.postMessage({ type: "request-sessions" });
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
    const currentCardEls = Array.from(cardsContainer.querySelectorAll(".media-card"));
    const newTabIds = [];
    for (const el of currentCardEls) {
      const tid = Number(el.dataset.tabId);
      if (tid) newTabIds.push(tid);
    }
    const byId = new Map(currentSessions.map((s) => [s.tabId, s]));
    const reordered = [];
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
    if (port) {
      port.postMessage({
        type: "reorder",
        tabIds: currentSessions.map((session) => session.tabId)
      });
    }
  }
  function moveCardByStep(cardEl, step) {
    const allCards = Array.from(cardsContainer.querySelectorAll(".media-card"));
    const idx = allCards.indexOf(cardEl);
    if (idx === -1) return;
    const targetIdx = idx + step;
    if (targetIdx < 0 || targetIdx >= allCards.length) return;
    const refNode = allCards[targetIdx > idx ? targetIdx + 1 : targetIdx];
    cardsContainer.insertBefore(cardEl, refNode || null);
    commitCardOrder();
    cardEl.focus();
  }
  var activeDragSession = null;
  function dragTargetIndex(session, deltaY) {
    const center = session.cardCenters[session.initialIndex] + deltaY;
    let target = session.initialIndex;
    if (deltaY > 0) {
      for (let i = session.initialIndex + 1; i < session.cards.length; i++) {
        if (center >= session.cardCenters[i]) target = i;
      }
    } else {
      for (let i = session.initialIndex - 1; i >= 0; i--) {
        if (center <= session.cardCenters[i]) target = i;
      }
    }
    return target;
  }
  function setupCardDrag(dragHandle, cardEl, tabId) {
    dragHandle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const allCards = Array.from(cardsContainer.querySelectorAll(".media-card"));
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
        cardCenters: allCards.map((card) => {
          const bounds = card.getBoundingClientRect();
          return bounds.top + bounds.height / 2;
        }),
        hasMovedPastThreshold: false,
        pointerId: e.pointerId
      };
      dragHandle.setPointerCapture(e.pointerId);
    });
    dragHandle.addEventListener("pointermove", (e) => {
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
    const endDrag = (e) => {
      if (!activeDragSession || activeDragSession.pointerId !== e.pointerId) return;
      const session = activeDragSession;
      activeDragSession = null;
      try {
        dragHandle.releasePointerCapture(e.pointerId);
      } catch (_) {
      }
      document.body.style.cursor = "";
      cardsContainer.classList.remove("is-reordering");
      cardEl.classList.remove("is-dragging");
      dragHandle.classList.remove("is-dragging");
      if (!session.hasMovedPastThreshold) {
        return;
      }
      const deltaY = e.clientY - session.startY;
      const targetIndex = dragTargetIndex(session, deltaY);
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
  function createCardDom(session) {
    const cardEl = document.createElement("div");
    cardEl.className = "media-card";
    cardEl.setAttribute("tabindex", "0");
    cardEl.setAttribute("role", "article");
    cardEl.dataset.tabId = String(session.tabId);
    cardEl.addEventListener("click", (e) => {
      const target = e.target;
      if (target.closest("button") || target.closest(".slider-container") || target.closest(".chapter-section") || target.closest(".card-drag-handle")) {
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
      if (!videoId) return;
      setChaptersOpen(cardDom, !cardDom.chaptersOpen);
      if (cardDom.chaptersOpen) {
        if (cardDom.chapterVideoId !== videoId) {
          showChapterMessage(cardDom, "Loading chapters\u2026");
        }
        port?.postMessage({ type: "chapters-request", tabId: cardDom.session.tabId });
      }
    });
    const pinBtn = document.createElement("button");
    pinBtn.className = "card-pin-btn";
    pinBtn.type = "button";
    setIcon(pinBtn, "push_pin");
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const pinned = !cardDom.session.pinned;
      const updated = currentSessions.map(
        (item) => item.tabId === cardDom.session.tabId ? { ...item, pinned } : item
      );
      updateSessionsView([
        ...updated.filter((item) => item.pinned),
        ...updated.filter((item) => !item.pinned)
      ]);
      port?.postMessage({ type: "pin", tabId: cardDom.session.tabId, pinned });
    });
    const topRowEl = document.createElement("div");
    topRowEl.className = "card-top-row";
    const artworkContainer = document.createElement("div");
    artworkContainer.className = "artwork-container";
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
        const isPlaying = cardDom.pendingPlayback ? cardDom.pendingPlayback.state === "playing" : isSessionPlaying(current);
        const requestedState = isPlaying ? "paused" : "playing";
        sendCommand(current.tabId, current.frameId, {
          action: isPlaying ? "pause" : "play"
        });
        const pending = {
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
    const updateSliderFromPointer = (e) => {
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
    const commitSeek = (e) => {
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
    cardEl.appendChild(chapterBtn);
    cardEl.appendChild(pinBtn);
    cardEl.appendChild(dragHandle);
    cardEl.appendChild(topRowEl);
    cardEl.appendChild(bottomRowEl);
    cardEl.appendChild(chapterSection);
    const cardDom = {
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
      session,
      isDragging: false,
      dragPct: 0,
      lastInterpolatedPos: 0,
      pendingPlayback: null,
      pendingSeek: null
    };
    return cardDom;
  }
  function setChaptersOpen(card, open) {
    card.chaptersOpen = open;
    card.chapterSection.hidden = !open;
    card.chapterBtn.classList.toggle("is-open", open);
    card.chapterBtn.setAttribute("aria-expanded", String(open));
    card.chapterBtn.setAttribute("aria-label", open ? "Hide video chapters" : "Show video chapters");
    card.chapterBtn.title = open ? "Hide video chapters" : "Show video chapters";
  }
  function showChapterMessage(card, text) {
    const message = document.createElement("div");
    message.className = "chapter-message";
    message.textContent = text;
    card.chapterList.replaceChildren(message);
  }
  function updateActiveChapter(card) {
    if (!card.chaptersOpen || card.chapters.length === 0) return;
    const position = card.pendingSeek?.position ?? card.lastInterpolatedPos;
    let activeIndex = -1;
    for (let i = 0; i < card.chapters.length; i++) {
      if (card.chapters[i].startTime <= position + 0.5) activeIndex = i;
      else break;
    }
    if (activeIndex === card.activeChapterIndex) return;
    card.activeChapterIndex = activeIndex;
    const rows = card.chapterList.querySelectorAll(".chapter-row");
    rows.forEach((row, index) => {
      row.classList.toggle("is-current", index === activeIndex);
      if (index === activeIndex) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    });
  }
  function renderChapters(card, videoId, chapters) {
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
        const seekTime = duration && Number.isFinite(duration) ? Math.min(chapter.startTime, duration) : chapter.startTime;
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
    updateActiveChapter(card);
  }
  function updatePlayButton(card) {
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
    const isPlaying = card.pendingPlayback ? card.pendingPlayback.state === "playing" : isSessionPlaying(session);
    setIcon(card.playBtn, isPlaying ? "pause" : "play_arrow");
    if (blocked && !isPlaying) {
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
  function applySliderPosition(card, pos, duration) {
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
    const width = rect.width > 0 ? rect.width : 256;
    const thumbX = width * pct;
    const GAP = 4;
    const HALF_THUMB = 2;
    const activeW = Math.max(0, thumbX - GAP - HALF_THUMB);
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
  function commitSeekPosition(card, position, duration, frameId = card.session.frameId) {
    const now = Date.now();
    card.pendingSeek = {
      position,
      updatedAt: now,
      duration,
      playbackRate: card.session.state?.playbackState === "playing" ? card.session.state.position?.playbackRate || 1 : 0,
      expiresAt: now + 4e3
    };
    applySliderPosition(card, position, duration);
    sendCommand(card.session.tabId, frameId, {
      action: "seekto",
      seekTime: position
    });
  }
  function updateCardDom(card, session) {
    if (session.youtubeVideoId !== card.session.youtubeVideoId) {
      setChaptersOpen(card, false);
      card.chapterVideoId = null;
      card.chapters = [];
      card.activeChapterIndex = -1;
      card.chapterList.replaceChildren();
    }
    if (card.pendingPlayback && (session.frameId !== card.session.frameId || session.degraded || session.state?.playBlocked && card.pendingPlayback.state === "playing" || session.state?.playbackState === card.pendingPlayback.state)) {
      card.pendingPlayback = null;
    }
    if (card.pendingSeek) {
      const incoming = session.state?.position;
      if (session.frameId !== card.session.frameId || incoming && Math.abs(incoming.duration - card.pendingSeek.duration) > 1) {
        card.pendingSeek = null;
      } else if (incoming && Math.abs(incoming.position - card.pendingSeek.position) <= 1.5) {
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
    if (card.chapterBtn.hidden && card.chaptersOpen) setChaptersOpen(card, false);
    const hostname = session.hostname || "browser";
    card.sourceHostname.textContent = hostname;
    if (session.favIconUrl) {
      card.sourceFavicon.src = session.favIconUrl;
      card.sourceFavicon.style.display = "block";
    } else {
      card.sourceFavicon.style.display = "none";
    }
    const meta = session.state?.metadata;
    card.titleEl.textContent = meta?.title || session.tabTitle || "Untitled audio";
    card.artistEl.textContent = meta?.artist || "";
    const bestArtwork = chooseBestArtwork(meta?.artwork);
    if (bestArtwork && !session.degraded) {
      const img = document.createElement("img");
      img.className = "artwork-img";
      img.alt = "";
      img.src = bestArtwork;
      img.onerror = () => {
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
    updatePlayButton(card);
    if (session.degraded) {
      card.bottomRowEl.style.display = "none";
      return;
    }
    card.bottomRowEl.style.display = "flex";
    const actions = session.state?.actions || [];
    const isSeekable = Boolean(session.state?.seekable && !session.state?.isLive);
    const playbackBlocked = session.state?.playBlocked === true;
    card.prevBtn.classList.remove("is-hidden");
    card.nextBtn.classList.remove("is-hidden");
    card.prevBtn.disabled = !actions.includes("previoustrack");
    card.nextBtn.disabled = !actions.includes("nexttrack");
    card.prevBtn.title = card.prevBtn.disabled ? "No previous track available" : "Previous track";
    card.nextBtn.title = card.nextBtn.disabled ? "No next track available" : "Next track";
    if (isSeekable) {
      card.rewBtn.classList.remove("is-hidden");
      card.fwdBtn.classList.remove("is-hidden");
      card.rewBtn.disabled = playbackBlocked || !actions.includes("seekbackward");
      card.fwdBtn.disabled = playbackBlocked || !actions.includes("seekforward");
      card.rewBtn.title = playbackBlocked ? "Seek unavailable while playback is blocked" : card.rewBtn.disabled ? "Seek backward unavailable" : "Seek backward 10 seconds";
      card.fwdBtn.title = playbackBlocked ? "Seek unavailable while playback is blocked" : card.fwdBtn.disabled ? "Seek forward unavailable" : "Seek forward 10 seconds";
      card.sliderContainer.style.display = "flex";
    } else {
      card.rewBtn.classList.add("is-hidden");
      card.fwdBtn.classList.add("is-hidden");
      card.sliderContainer.style.display = "none";
    }
  }
  function updateSessionsView(sessions) {
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
    const emptyOrPerm = cardsContainer.querySelector(".empty-card, .permission-card");
    if (emptyOrPerm) {
      emptyOrPerm.remove();
    }
    const incomingTabIds = new Set(sessions.map((s) => s.tabId));
    for (const [tabId, card] of renderedCards.entries()) {
      if (!incomingTabIds.has(tabId)) {
        card.cardEl.remove();
        renderedCards.delete(tabId);
      }
    }
    sessions.forEach((session, index) => {
      let card = renderedCards.get(session.tabId);
      if (!card) {
        card = createCardDom(session);
        renderedCards.set(session.tabId, card);
      }
      updateCardDom(card, session);
      const existingChild = cardsContainer.children[index];
      if (existingChild !== card.cardEl) {
        cardsContainer.insertBefore(card.cardEl, existingChild || null);
      }
    });
  }
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
          const elapsedSec = (now - posState.updatedAt) / 1e3;
          currentPos += elapsedSec * (posState.playbackRate || 1);
        }
        currentPos = Math.max(0, Math.min(currentPos, posState.duration));
        applySliderPosition(card, currentPos, posState.duration);
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
  function initDevOverlay() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("overlay") === "1") {
      const overlayImg = document.createElement("img");
      overlayImg.className = "dev-overlay";
      overlayImg.src = "dev/reference.png";
      overlayImg.alt = "Reference overlay";
      document.body.appendChild(overlayImg);
      isDevOverlayActive = true;
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
  async function initPopup() {
    const urlParams = new URLSearchParams(window.location.search);
    initDevOverlay();
    renderEmptyState();
    if (urlParams.get("theme") === "dark") {
      document.documentElement.classList.add("dark");
    }
    if (typeof browser === "undefined" || !browser.runtime) {
      if (urlParams.get("mock") !== "1" && urlParams.get("mock") !== "multi") {
        renderEmptyState();
        return;
      }
    }
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
      const mockSession1 = {
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
        degraded: false,
        pinned: false
      };
      const mockSession2 = {
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
          lastPlayedAt: Date.now() - 1e4
        },
        audible: false,
        muted: false,
        degraded: false,
        pinned: false
      };
      const mockSession3 = {
        tabId: 3,
        frameId: 0,
        hostname: "reddit.com",
        favIconUrl: "dev/ytm-favicon.png",
        tabTitle: "Funny video with sound - Reddit",
        state: null,
        audible: true,
        muted: false,
        degraded: true,
        pinned: false
      };
      currentSessions = isMulti ? [mockSession1, mockSession2, mockSession3] : [mockSession1];
      updateSessionsView(currentSessions);
      startInterpolationLoop();
      return;
    }
    function connectPopup() {
      try {
        const connection = browser.runtime.connect({ name: "popup" });
        port = connection;
        connection.onMessage.addListener((rawMsg) => {
          const msg = rawMsg;
          if (msg.type === "sessions") {
            currentSessions = msg.sessions;
            updateSessionsView(currentSessions);
            if (currentSessions.length === 0) void showAudibleFallback();
          } else if (msg.type === "chapters") {
            const card = renderedCards.get(msg.tabId);
            if (card?.chaptersOpen && card.session.youtubeVideoId === msg.videoId) {
              renderChapters(card, msg.videoId, msg.chapters);
            }
          }
        });
        connection.onDisconnect.addListener(() => {
          if (port !== connection) return;
          port = null;
          setTimeout(connectPopup, 500);
        });
        connection.postMessage({ type: "request-sessions" });
        for (const card of renderedCards.values()) {
          if (card.chaptersOpen && card.session.youtubeVideoId) {
            connection.postMessage({ type: "chapters-request", tabId: card.session.tabId });
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
})();
//# sourceMappingURL=popup.js.map
