import type { Action, Command, FrameState, MediaArtwork, MediaMetadataState, PositionState, VolumeState } from "./protocol";

const ALLOWED_ACTIONS = new Set<Action>([
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

function sanitizeString(str: any, maxLen = 300): string {
  if (typeof str !== "string") return "";
  return str.slice(0, maxLen);
}

// Never truncate URLs: doing so can change the resource being requested.
export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 32768) return null;
  const src = value.trim();
  if (/^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)(?:;|,)/i.test(src)) return src;
  if (src.length > 8192) return null;
  try {
    const url = new URL(src);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return url.href;
  } catch (_) { return null; }
}

function sanitizeArtwork(list: any): MediaArtwork[] {
  if (!Array.isArray(list)) return [];
  const valid: MediaArtwork[] = [];
  // Bound both work and the forwarded payload, even for hostile page arrays.
  for (const item of list.slice(0, 8)) {
    const src = safeImageUrl(item?.src);
    if (src) valid.push({ src, sizes: sanitizeString(item.sizes, 50), type: sanitizeString(item.type, 50) });
  }
  return valid;
}

function sanitizeMetadata(meta: any): MediaMetadataState | null {
  if (!meta || typeof meta !== "object") return null;
  return {
    title: sanitizeString(meta.title, 300),
    artist: sanitizeString(meta.artist, 300),
    album: sanitizeString(meta.album, 300),
    artwork: sanitizeArtwork(meta.artwork)
  };
}

function sanitizePosition(pos: any): PositionState | null {
  if (!pos || typeof pos !== "object") return null;
  const duration =
    pos.duration === Infinity
      ? Infinity
      : typeof pos.duration === "number" && isFinite(pos.duration)
      ? Math.max(0, pos.duration)
      : NaN;

  if (isNaN(duration)) return null;

  const position =
    typeof pos.position === "number" && isFinite(pos.position)
      ? Math.max(0, pos.position)
      : 0;

  const playbackRate =
    typeof pos.playbackRate === "number" && isFinite(pos.playbackRate) && pos.playbackRate > 0
      ? pos.playbackRate
      : 1;

  const updatedAt =
    typeof pos.updatedAt === "number" && isFinite(pos.updatedAt)
      ? pos.updatedAt
      : Date.now();

  return {
    duration,
    position,
    playbackRate,
    updatedAt
  };
}

function sanitizeVolume(vol: any): VolumeState | null {
  if (!vol || typeof vol !== "object") return null;
  if (typeof vol.level !== "number" || !isFinite(vol.level)) return null;
  const level = Math.min(1, Math.max(0, vol.level));
  return {
    level,
    mediaMuted: vol.mediaMuted === true
  };
}

export function sanitizeFrameState(state: any): FrameState | null {
  if (!state || typeof state !== "object") return null;

  const source =
    state.source === "mediasession" ||
    state.source === "element" ||
    state.source === "webaudio"
      ? state.source
      : null;

  if (!source) return null;

  const playbackState =
    state.playbackState === "playing" ||
    state.playbackState === "paused" ||
    state.playbackState === "none"
      ? state.playbackState
      : "none";

  const actions: Action[] = [];
  if (Array.isArray(state.actions)) {
    for (const a of state.actions.slice(0, 32)) {
      if (ALLOWED_ACTIONS.has(a) && !actions.includes(a)) {
        actions.push(a);
      }
    }
  }

  const isLive = Boolean(state.isLive);
  const seekable = Boolean(state.seekable);
  const lastPlayedAt =
    typeof state.lastPlayedAt === "number" && isFinite(state.lastPlayedAt)
      ? Math.min(Date.now(), Math.max(0, state.lastPlayedAt))
      : Date.now();
  const playBlocked = state.playBlocked === true;
  const buffering = state.buffering === true;

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
    playBlocked,
    buffering
  };
}


export function sanitizeCommand(cmd: any): Command | null {
  if (!cmd || typeof cmd !== "object" || typeof cmd.action !== "string") return null;
  if (!ALLOWED_ACTIONS.has(cmd.action as Action)) return null;
  const sanitized: Command = { action: cmd.action as Action };
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
