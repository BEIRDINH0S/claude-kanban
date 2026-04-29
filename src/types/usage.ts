export type RateLimitType =
  | "five_hour"
  | "seven_day"
  | "seven_day_opus"
  | "seven_day_sonnet"
  | "overage";

export interface RateLimitInfo {
  status: "allowed" | "allowed_warning" | "rejected";
  rateLimitType?: RateLimitType;
  /** 0..1 — fraction consumed of the window. Sparse: the SDK omits this
   *  when the user is well below any warning threshold. */
  utilization?: number;
  /** Threshold (0..1) the user just crossed — last meaningful usage signal
   *  the API gave us. We use it as a floor estimate when `utilization` is
   *  missing. */
  surpassedThreshold?: number;
  /** Unix timestamp (seconds) when the window resets. */
  resetsAt?: number;
  isUsingOverage?: boolean;
}
