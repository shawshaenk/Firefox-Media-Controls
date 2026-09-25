import { sanitizeFrameState, sanitizeCommand } from "./shared/validation";
import type { McxDownMessage, McxUpMessage, RelayToBgMessage } from "./shared/protocol";

(() => {
  // The manifest and background injection can both load this script in the
  // same frame. Duplicate listeners would execute every popup command twice.
  if ((window as any).__mcx_relay_installed) return;
  (window as any).__mcx_relay_installed = true;

  const pendingCommands = new Map<number, (handled: boolean) => void>();
  let nextCommandId = 0;
  let pendingState: unknown;
  let stateTimer: number | null = null;
  let lastSentAt = -Infinity;

  function flushState() {
    stateTimer = null;
    const raw = pendingState;
    pendingState = undefined;
    const state = sanitizeFrameState(raw);
    // Invalid data must not erase a legitimate session.
    if (raw !== null && state === null) return;
    lastSentAt = performance.now();
    browser.runtime.sendMessage({ type: "frame-state", state } as RelayToBgMessage).catch(() => {});
  }

  // Listen for messages from MAIN-world page-hook
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as McxUpMessage;
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

    // Keep only the latest update. Command acknowledgements above bypass this
    // limiter so a noisy page cannot delay a user's play/pause command.
    pendingState = data.state;
    if (stateTimer !== null) return;
    const wait = Math.max(0, 100 - (performance.now() - lastSentAt));
    if (wait === 0) flushState();
    else stateTimer = window.setTimeout(flushState, wait);
  });

  window.addEventListener("pagehide", (event) => {
    if (!event.isTrusted) return;
    if (stateTimer !== null) clearTimeout(stateTimer);
    pendingState = null;
    flushState();
  });

  // Listen for commands and queries from background script
  browser.runtime.onMessage.addListener((message: any) => {
    if (message && message.type === "cmd" && message.cmd) {
      const sanitized = sanitizeCommand(message.cmd);
      if (!sanitized) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const id = ++nextCommandId;
        const timeout = window.setTimeout(() => {
          pendingCommands.delete(id);
          resolve(false);
        }, 700);
        pendingCommands.set(id, (handled) => {
          clearTimeout(timeout);
          resolve(handled);
        });
        window.postMessage({ __mcx: "down", id, cmd: sanitized } as McxDownMessage, "*");
      });
    } else if (message && message.type === "query-state") {
      const downMsg: McxDownMessage = {
        __mcx: "down",
        type: "query-state"
      };
      window.postMessage(downMsg, "*");
    }
  });

  // Ask MAIN world for initial state
  window.postMessage({ __mcx: "down", type: "query-state" } as McxDownMessage, "*");
})();
