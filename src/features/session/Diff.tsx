/**
 * Tiny inline diff viewer for Edit/MultiEdit/Write tool inputs. Not a full
 * Myers diff — we trim the common prefix/suffix line-wise and render the
 * differing middle as a `-` block followed by a `+` block. Good enough for
 * the typical Edit shape (small change inside a larger context).
 */

interface DiffSegment {
  kind: "context" | "del" | "add" | "elided";
  text: string;
}

const CONTEXT_LINES = 2;

function buildSegments(oldText: string, newText: string): DiffSegment[] {
  const oldLines = oldText.length === 0 ? [] : oldText.split("\n");
  const newLines = newText.length === 0 ? [] : newText.split("\n");

  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }
  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] ===
      newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const segs: DiffSegment[] = [];

  // Prefix context: at most CONTEXT_LINES lines, with an elision marker if more.
  if (prefixLen > CONTEXT_LINES) {
    segs.push({
      kind: "elided",
      text: `${prefixLen - CONTEXT_LINES} ligne${
        prefixLen - CONTEXT_LINES > 1 ? "s" : ""
      } inchangée${prefixLen - CONTEXT_LINES > 1 ? "s" : ""}`,
    });
    for (let i = prefixLen - CONTEXT_LINES; i < prefixLen; i++) {
      segs.push({ kind: "context", text: oldLines[i] });
    }
  } else {
    for (let i = 0; i < prefixLen; i++) {
      segs.push({ kind: "context", text: oldLines[i] });
    }
  }

  for (let i = prefixLen; i < oldLines.length - suffixLen; i++) {
    segs.push({ kind: "del", text: oldLines[i] });
  }
  for (let i = prefixLen; i < newLines.length - suffixLen; i++) {
    segs.push({ kind: "add", text: newLines[i] });
  }

  if (suffixLen > CONTEXT_LINES) {
    for (let i = 0; i < CONTEXT_LINES; i++) {
      segs.push({
        kind: "context",
        text: oldLines[oldLines.length - suffixLen + i],
      });
    }
    segs.push({
      kind: "elided",
      text: `${suffixLen - CONTEXT_LINES} ligne${
        suffixLen - CONTEXT_LINES > 1 ? "s" : ""
      } inchangée${suffixLen - CONTEXT_LINES > 1 ? "s" : ""}`,
    });
  } else if (suffixLen > 0) {
    for (let i = oldLines.length - suffixLen; i < oldLines.length; i++) {
      segs.push({ kind: "context", text: oldLines[i] });
    }
  }

  return segs;
}

interface DiffBlockProps {
  oldText: string;
  newText: string;
}

export function DiffBlock({ oldText, newText }: DiffBlockProps) {
  const segs = buildSegments(oldText, newText);
  if (segs.length === 0) {
    return (
      <p className="px-3 py-2 font-mono text-[11px] text-[var(--text-muted)]">
        (rien à afficher)
      </p>
    );
  }
  return (
    <div className="font-mono text-[11px] leading-[1.55]">
      {segs.map((s, i) => (
        <DiffLine key={i} seg={s} />
      ))}
    </div>
  );
}

function DiffLine({ seg }: { seg: DiffSegment }) {
  if (seg.kind === "elided") {
    return (
      <div className="px-3 py-1 text-center text-[10.5px] italic text-[var(--text-muted)]">
        … {seg.text} …
      </div>
    );
  }
  const bg =
    seg.kind === "del"
      ? "bg-red-500/10"
      : seg.kind === "add"
      ? "bg-emerald-500/10"
      : "";
  const prefixChar =
    seg.kind === "del" ? "-" : seg.kind === "add" ? "+" : " ";
  const prefixColor =
    seg.kind === "del"
      ? "text-red-400/80"
      : seg.kind === "add"
      ? "text-emerald-400/80"
      : "text-[var(--text-muted)]";
  return (
    <div className={`flex ${bg}`}>
      <span
        className={`w-6 shrink-0 select-none text-center ${prefixColor}`}
      >
        {prefixChar}
      </span>
      <span className="min-w-0 flex-1 pr-2 whitespace-pre-wrap break-all">
        {seg.text || " "}
      </span>
    </div>
  );
}
