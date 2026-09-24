export type Action =
  | "play"
  | "pause"
  | "previoustrack"
  | "nexttrack"
  | "seekbackward"
  | "seekforward"
  | "seekto"
  | "setvolume"
  | "stop";

export interface MediaArtwork {
  src: string;
  sizes?: string;
  type?: string;
}

export interface MediaMetadataState {
  title: string;
  artist: string;
  album: string;
  artwork: MediaArtwork[];
}

export interface PositionState {
  duration: number;
  position: number;
  playbackRate: number;
  updatedAt: number; // epoch ms
}

export interface VolumeState {
  level: number; // 0 to 1
  mediaMuted: boolean;
}

export interface FrameState {
  source: "mediasession" | "element" | "webaudio";
  metadata: MediaMetadataState | null;
  playbackState: "playing" | "paused" | "none";
  position: PositionState | null;
  actions: Action[]; // handlers the page registered + ones we can emulate
  isLive: boolean; // duration === Infinity or live stream
  seekable: boolean;
  volume: VolumeState | null; // null when no safe numeric volume control
  lastPlayedAt: number; // epoch ms, for ordering
  playBlocked?: boolean; // true when Firefox denies script initiated playback
}

export interface Command {
  action: Action;
  seekTime?: number;
  offset?: number;
  volume?: number; // 0 to 1, for setvolume
}

export interface Session {
  tabId: number;
  frameId: number;
  hostname: string;
  favIconUrl: string;
  tabTitle: string;
  state: FrameState | null;
  audible: boolean;
  muted: boolean;
  degraded: boolean;
  pinned: boolean;
  youtubeVideoId?: string;
  chapterState: ChapterState | null;
}

export interface YouTubeChapter {
  title: string;
  startTime: number;
}

// Cached YouTube chapter availability for one video, attached to the card's
// session data. `status` is only ever "available" or "none": a failed lookup
// is never classified as "no chapters" (it stays absent/unknown and is
// retried). Absent (null) means the lookup has not finished yet.
export interface ChapterState {
  videoId: string;
  status: "available" | "none";
}

// MAIN -> relay: { __mcx: "up", state: FrameState | null }
export type McxUpMessage =
  | { __mcx: "up"; state: FrameState | null }
  | { __mcx: "command-result"; id: number; handled: boolean };

// relay -> MAIN: { __mcx: "down", cmd?: Command, type?: "query-state" }
export type McxDownMessage =
  | { __mcx: "down"; cmd: Command; id?: number; type?: undefined }
  | { __mcx: "down"; cmd?: undefined; type: "query-state" };

// relay -> bg: { type: "frame-state", state: FrameState | null }
export interface RelayToBgMessage {
  type: "frame-state";
  state: FrameState | null;
}

// bg -> relay: { type: "cmd", cmd: Command } | { type: "query-state" }
export type BgToRelayMessage =
  | { type: "cmd"; cmd: Command }
  | { type: "query-state" };

// popup -> bg (via port or runtime):
export type PopupToBgMessage =
  | { type: "cmd"; tabId: number; frameId?: number; cmd: Command }
  | { type: "focus"; tabId: number }
  | { type: "mute"; tabId: number; muted: boolean }
  | { type: "reorder"; tabIds: number[] }
  | { type: "pin"; tabId: number; pinned: boolean }
  | { type: "chapters-request"; tabId: number }
  | { type: "request-sessions" };

// bg -> popup (via port):
// chapters status: "available" (chapters present), "none" (video confirmed
// to have no chapters), or "error" (lookup failed — not proof of absence).
export type BgToPopupMessage =
  | { type: "sessions"; sessions: Session[] }
  | { type: "chapters"; tabId: number; videoId: string; chapters: YouTubeChapter[]; status: "available" | "none" | "error" };
