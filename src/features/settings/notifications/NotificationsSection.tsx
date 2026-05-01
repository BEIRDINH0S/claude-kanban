import { Bell } from "lucide-react";
import { useState } from "react";

import { readNotifyOnTurnEnd, writeNotifyOnTurnEnd } from "../../../lib/prefs";
import { Card, Toggle } from "../layout";

/**
 * "Notify on turn end" — a single toggle backed by a localStorage pref. The
 * actual notification delivery happens in App.tsx's session-event listener,
 * which checks `readNotifyOnTurnEnd()` synchronously each time a `result`
 * event lands. We don't subscribe to a store here because the pref changes
 * are user-driven and never need to round-trip across components.
 */
export function NotificationsSection() {
  const [enabled, setEnabled] = useState(readNotifyOnTurnEnd);
  const toggle = () => {
    setEnabled((v) => {
      const next = !v;
      writeNotifyOnTurnEnd(next);
      return next;
    });
  };
  return (
    <Card
      icon={
        <Bell
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Notify when a turn ends"
      subtitle="System notification when Claude finishes a turn, unless the card is open in zoom view. Lets you fire several sessions and go do something else."
      trailing={
        <Toggle
          enabled={enabled}
          onToggle={toggle}
          ariaLabel={enabled ? "Disable" : "Enable"}
        />
      }
    />
  );
}
