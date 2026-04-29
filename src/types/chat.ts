/**
 * Display items in the zoom view chat. We unify two sources:
 *  - locally-typed user messages (we show them immediately, the SDK doesn't
 *    echo them back as events in streaming-input mode)
 *  - raw SDK events forwarded by the sidecar
 */
export type DisplayItem =
  | { id: string; kind: "user-input"; text: string; ts: number }
  | { id: string; kind: "sdk"; event: SdkEvent; ts: number };

/**
 * Loose shape — we treat SDK events as opaque payloads and inspect known
 * fields at render time. Keeps us decoupled from SDK type shifts.
 */
export interface SdkEvent {
  type: string;
  subtype?: string;
  message?: {
    role?: "user" | "assistant";
    content?: unknown;
  };
  [key: string]: unknown;
}
