/**
 * `auth-changed` — Rust pushes a fresh `AuthStatus` whenever the credentials
 * file changes on disk, after a successful `claude auth login`, after
 * `claude auth logout`, and as a periodic heartbeat so the `expired` flag
 * crosses correctly. We mirror it straight into the auth store; the gate
 * and the Settings account section both subscribe there.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { AuthStatus } from "../../ipc/auth";
import { useAuthStore } from "../../stores/authStore";

export async function listenAuthChanged(): Promise<UnlistenFn> {
  return listen<AuthStatus>("auth-changed", (e) => {
    useAuthStore.getState().setFromStatus(e.payload);
  });
}
