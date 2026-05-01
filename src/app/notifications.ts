/**
 * Best-effort wrapper around the Tauri OS-notification plugin. Asks the
 * user for permission on the first call, caches the result, and returns
 * a boolean from then on. Used by both the session-event listener (turn
 * end) and the permission-request listener — anywhere we want to surface
 * a non-blocking system notification.
 *
 * Module-level cache: there's exactly one user, exactly one host OS, and
 * the granted/denied state doesn't flip mid-session. So caching the first
 * answer is correct and avoids re-prompting on every call.
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let cached: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const r = await requestPermission();
      granted = r === "granted";
    }
    cached = granted;
    return granted;
  } catch {
    cached = false;
    return false;
  }
}

interface NotifyArgs {
  title: string;
  body: string;
}

/**
 * Best-effort. Silently no-ops when permission is denied or the OS
 * channel is unavailable — notifications are nice-to-have, never the
 * source of truth for what the user sees.
 */
export async function notify({ title, body }: NotifyArgs): Promise<void> {
  const ok = await ensurePermission();
  if (!ok) return;
  try {
    sendNotification({ title, body, icon: "icons/128x128.png" });
  } catch {
    // Plugin or OS rejected — no-op.
  }
}
