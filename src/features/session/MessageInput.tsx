import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  onSend: (text: string) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

export function MessageInput({ onSend, disabled, placeholder }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Autofocus on mount and after each successful send. We defer with rAF so
  // the focus call lands AFTER the parent's `animate-zoom-in` first paint —
  // some browsers drop focus calls that hit a node mid-animation when it
  // sits inside a `backdrop-filter` ancestor (the glass modal here).
  useEffect(() => {
    if (disabled) return;
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [disabled]);

  // Auto-grow textarea up to a sensible cap.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setText("");
    await onSend(trimmed);
  };

  return (
    <div className="px-6 pb-5">
      <div className="mx-auto flex max-w-[760px] items-end gap-2">
        <div className="glass flex-1 rounded-2xl px-4 py-2.5">
          <textarea
            ref={ref}
            // Belt-and-suspenders with the rAF effect above — covers the
            // initial mount before React effects run.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={!disabled}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter for newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={placeholder ?? "Réponds à Claude…"}
            disabled={disabled}
            rows={1}
            className="block w-full resize-none bg-transparent font-mono text-[13px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !text.trim()}
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[var(--color-accent)] text-white shadow-[0_0_24px_var(--color-accent-ring)] transition-opacity disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
          aria-label="Envoyer"
        >
          <ArrowUp className="size-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
