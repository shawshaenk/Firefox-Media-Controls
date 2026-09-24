"use strict";
(() => {
  // src/relay.ts
  (() => {
    if (window.__mcx_relay_installed) return;
    window.__mcx_relay_installed = true;
    const ALLOWED_ACTIONS = /* @__PURE__ */ new Set([
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
    const pendingCommands = /* @__PURE__ */ new Map();
    let nextCommandId = 0;
    function sanitizeString(str, maxLen = 300) {
      if (typeof str !== "string") return "";
      return str.slice(0, maxLen);
    }
    function isValidArtworkUrl(url) {
      if (typeof url !== "string") return false;
      const trimmed = url.trim().toLowerCase();
      return trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:image/");
    }
    function sanitizeArtwork(list) {
      if (!Array.isArray(list)) return [];
      const valid = [];
      for (const item of list) {
        if (item && isValidArtworkUrl(item.src)) {
          valid.push({
            src: sanitizeString(item.src, 2e3),
            sizes: sanitizeString(item.sizes, 50),
            type: sanitizeString(item.type, 50)
          });
        }
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
        for (const a of state.actions) {
          if (ALLOWED_ACTIONS.has(a) && !actions.includes(a)) {
            actions.push(a);
          }
        }
      }
      const isLive = Boolean(state.isLive);
      const seekable = Boolean(state.seekable);
      const lastPlayedAt = typeof state.lastPlayedAt === "number" && isFinite(state.lastPlayedAt) ? state.lastPlayedAt : Date.now();
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
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data) return;
      if (data.__mcx === "command-result") {
        const resolve = pendingCommands.get(data.id);
        if (resolve) {
          pendingCommands.delete(data.id);
          resolve(data.handled === true);
        }
        return;
      }
      if (data.__mcx !== "up") return;
      const sanitizedState = sanitizeFrameState(data.state);
      const msg = {
        type: "frame-state",
        state: sanitizedState
      };
      browser.runtime.sendMessage(msg).catch(() => {
      });
    });
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
    browser.runtime.onMessage.addListener((message) => {
      if (message && message.type === "cmd" && message.cmd) {
        const sanitized = sanitizeCommand(message.cmd);
        if (!sanitized) return Promise.resolve(false);
        return new Promise((resolve) => {
          const id = ++nextCommandId;
          const timeout = window.setTimeout(() => {
            pendingCommands.delete(id);
            resolve(false);
          }, 700);
          pendingCommands.set(id, (handled) => {
            clearTimeout(timeout);
            resolve(handled);
          });
          window.postMessage({ __mcx: "down", id, cmd: sanitized }, "*");
        });
      } else if (message && message.type === "query-state") {
        const downMsg = {
          __mcx: "down",
          type: "query-state"
        };
        window.postMessage(downMsg, "*");
      }
    });
    window.postMessage({ __mcx: "down", type: "query-state" }, "*");
  })();
})();
//# sourceMappingURL=relay.js.map
