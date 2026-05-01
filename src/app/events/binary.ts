/**
 * `binary-status` — Rust resolved (or failed to resolve) the `claude`
 * binary at sidecar boot. Carries the resolved path (or null when not
 * installed) plus the effective runtime flavour (`native` | `wsl`),
 * which the Settings page uses to confirm a runtime-pref change has
 * actually taken effect after a restart.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { useErrorsStore } from "../../stores/errorsStore";

interface BinaryStatusPayload {
  claudeBinary: string | null;
  /** "native" | "wsl" — the runtime the sidecar resolved at boot. May be
   *  absent if the user is on an older sidecar build. */
  runtime?: "native" | "wsl" | null;
  runtimePref?: "auto" | "native" | "wsl" | null;
}

export async function listenBinaryStatus(): Promise<UnlistenFn> {
  return listen<BinaryStatusPayload>("binary-status", (e) => {
    useErrorsStore
      .getState()
      .setBinaryStatus(e.payload.claudeBinary, e.payload.runtime ?? null);
  });
}
