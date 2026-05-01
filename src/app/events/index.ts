/**
 * One-call bundle that wires every Tauri event listener the app needs at
 * boot, plus the git heartbeat. Returns an async cleanup that tears
 * everything down — useful for HMR and StrictMode's double-mount in dev.
 *
 * Each individual listener lives in its own file (one per concern) so
 * adding a new event class is a localised change. This file just lists
 * them in one place.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";

import { listenBinaryStatus } from "./binary";
import {
  listenCardsChanged,
  listenExternalJsonlUpdate,
} from "./cards";
import {
  listenGitStatusChanged,
  startGitStatusHeartbeat,
} from "./git";
import {
  listenPermissionAutoApproved,
  listenPermissionRequest,
} from "./permissions";
import {
  listenSessionEnded,
  listenSessionError,
  listenSessionStarted,
  listenSessionStream,
} from "./session";

/**
 * Wire every global listener + start the heartbeat. Returns a cleanup
 * that synchronously stops the interval and (best-effort) detaches each
 * Tauri listener once their `listen()` promises resolve.
 */
export function wireGlobalEvents(): () => void {
  // Tauri's `listen()` is async — we capture the promises and resolve
  // them in the cleanup so we don't drop early-resolved unlisten fns.
  const unlistens: Array<Promise<UnlistenFn>> = [
    listenCardsChanged(),
    listenSessionStream(),
    listenPermissionAutoApproved(),
    listenPermissionRequest(),
    listenSessionStarted(),
    listenSessionEnded(),
    listenSessionError(),
    listenBinaryStatus(),
    listenGitStatusChanged(),
    listenExternalJsonlUpdate(),
  ];
  const stopHeartbeat = startGitStatusHeartbeat();

  return () => {
    stopHeartbeat();
    for (const p of unlistens) {
      void p.then((fn) => fn());
    }
  };
}
