import React, { useEffect, useRef, useState } from "react";

const SAMPLE_PROMPTS = [
  { vertical: "Nursing Home", icon: "◐", prompt: "Does Robert Miller have physical therapy approval, and what does our protocol say about PT eligibility?" },
  { vertical: "Nursing Home", icon: "◐", prompt: "Which residents are currently on insulin AND have a fall-risk history, and what is our insulin administration protocol?" },
  { vertical: "Nursing Home", icon: "◐", prompt: "What medications is Robert Miller allergic to?" },
  { vertical: "Legal · Divorce", icon: "◑", prompt: "Does Sarah Klein's custody agreement allow overnight travel outside Illinois, and what does our custody SOP say about travel restrictions?" },
  { vertical: "Legal · Divorce", icon: "◑", prompt: "Show all missed alimony payments for Michael Rosenberg and retrieve the enforcement procedure from our settlement SOP." },
  { vertical: "Legal · Personal Injury", icon: "◑", prompt: "Did Robert Diaz miss any treatment appointments, and what does our case strategy memo say about treatment gaps?" },
  { vertical: "Legal · Personal Injury", icon: "◑", prompt: "Which clients have upcoming statute-of-limitations deadlines, and what does our PI strategy say about SOL?" },
  { vertical: "Real Estate", icon: "◓", prompt: "Which property has the highest current value, and what does the landlord-tenant handbook say about security deposits?" },
];

function groupedPrompts() {
  const groups = {};
  for (const p of SAMPLE_PROMPTS) {
    (groups[p.vertical] = groups[p.vertical] || []).push(p);
  }
  return Object.entries(groups);
}

export default function Chat({ messages, pending, onAsk, onCiteClick }) {
  const [input, setInput] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  function submit(e) {
    e?.preventDefault();
    if (pending || !input.trim()) return;
    onAsk(input);
    setInput("");
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {messages.length === 0 && <EmptyState onAsk={onAsk} />}

        {messages.map((m, i) => (
          <Message key={i} msg={m} onCiteClick={onCiteClick} />
        ))}
        {/* PendingBubble removed — ProgressTimeline inside the streaming
            assistant bubble now provides the live feedback. */}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="border-t border-slate-200 bg-white px-6 py-3.5">
        <div className="flex gap-2 items-center">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={pending}
            placeholder="Ask about residents, cases, properties, or any policy…"
            className="flex-1 px-4 py-2.5 rounded-md border border-slate-300 bg-white text-sm text-ink
                       placeholder:text-slate-400
                       focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent
                       disabled:bg-slate-50 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="px-4 py-2.5 rounded-md bg-ink text-white text-sm font-semibold
                       hover:bg-brand-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Ask
          </button>
        </div>
      </form>
    </div>
  );
}

function EmptyState({ onAsk }) {
  return (
    <div className="max-w-3xl mx-auto pt-6">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">
        Hybrid intelligence demo
      </div>
      <h2 className="text-2xl font-semibold text-ink tracking-tight leading-tight">
        Ground every answer in your documents and your data.
      </h2>
      <p className="mt-2 text-sm text-slate-600 max-w-2xl">
        This assistant routes between document retrieval and SQL on the fly, then cites the exact source for every claim.
        Pick a sample prompt below to see all three verticals in action.
      </p>

      <div className="mt-6 space-y-5">
        {groupedPrompts().map(([vertical, items]) => (
          <div key={vertical}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">
              {vertical}
            </div>
            <div className="grid gap-2">
              {items.map((p) => (
                <button
                  key={p.prompt}
                  onClick={() => onAsk(p.prompt)}
                  className="group text-left text-[13px] leading-snug text-slate-800
                             px-4 py-3 rounded-md bg-white border border-slate-200
                             hover:border-ink hover:shadow-card transition-all"
                >
                  <span className="text-slate-400 mr-2">{p.icon}</span>
                  {p.prompt}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Message({ msg, onCiteClick }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-2xl px-4 py-2.5 rounded-md bg-ink text-white text-sm leading-relaxed">
          {msg.text}
        </div>
      </div>
    );
  }

  const docCites = (msg.citations || []).filter((c) => c.type === "document");
  const sqlCites = (msg.citations || []).filter((c) => c.type === "sql");

  const isStreaming = !!msg.streaming;
  const phase = msg.phase;
  // Show progress timeline while streaming AND answer text hasn't started yet.
  // Also show it during the silent pre-plan wait (no route, no steps yet).
  const showProgressHeader = isStreaming && !(msg.answer && msg.answer.length > 0);

  return (
    <div className="flex justify-start">
      <div className="max-w-3xl w-full">
        <div className="surface rounded-md p-4">
          {showProgressHeader && (
            <ProgressTimeline phase={phase} steps={msg.steps || []} route={msg.route} />
          )}
          {(() => {
            const cited = extractCitedInOrder(msg.answer || "", msg.citations || []);
            return (
              <>
                <RenderAnswer
                  text={msg.answer || ""}
                  cited={cited}
                  onCiteClick={onCiteClick}
                />
                {cited.length > 0 && (
                  <SourcesList cited={cited} onCiteClick={onCiteClick} />
                )}
                {(msg.answer || msg.confidence) && (
                  <div className="mt-3 flex items-center gap-2 pt-3 border-t border-slate-100">
                    <Badge route={msg.route} confidence={msg.confidence} latency={msg.latency_ms} fastPath={msg.fast_path} />
                    {/* Extra-evidence toggle: cited count vs total retrieved */}
                    {(docCites.length + sqlCites.length) > cited.length && (
                      <span className="text-[10.5px] text-slate-400">
                        {cited.length} of {docCites.length + sqlCites.length} sources used in answer
                      </span>
                    )}
                  </div>
                )}
                {msg.rationale && !showProgressHeader && (
                  <div className="mt-2 text-[10.5px] text-slate-400">
                    <span className="text-slate-500">router</span> · {msg.rationale}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

/**
 * Walk the answer text in order, find each [doc:...] / [sql:...] marker,
 * dedupe (same source = same number), and resolve to the underlying citation
 * object. Returns an ordered list: [{n, kind, label, cite}].
 *
 * If a marker has no matching citation (LLM made one up), the entry still
 * appears but with cite=null so the UI can still render the inline marker.
 */
function extractCitedInOrder(text, citations) {
  const seen = new Map();   // key → { n, kind, label, cite }
  const order = [];
  const re = /\[(doc|sql):([^\]]+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1];
    const label = m[2].trim();
    const key = `${kind}:${label}`;
    if (seen.has(key)) continue;
    const cite = citations.find((c) => {
      if (kind === "doc") {
        if (c.type !== "document") return false;
        return c.label === label || label.startsWith(c.filename);
      }
      return c.type === "sql";
    });
    const entry = { n: order.length + 1, kind, label, cite, key };
    seen.set(key, entry);
    order.push(entry);
  }
  return order;
}

function RenderAnswer({ text, cited, onCiteClick }) {
  // Build a quick lookup: marker key → cited entry
  const byKey = new Map(cited.map((c) => [c.key, c]));
  const parts = [];
  const re = /\[(doc|sql):([^\]]+)\]/g;
  let lastIdx = 0;
  let match;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(<span key={key++}>{text.slice(lastIdx, match.index)}</span>);
    const k = match[1];
    const lbl = match[2].trim();
    const entry = byKey.get(`${k}:${lbl}`);
    parts.push(
      <button
        key={key++}
        className={`inline-flex items-baseline align-baseline px-1 mx-0.5 rounded text-[10.5px] font-semibold leading-none transition-colors
          ${k === "doc"
            ? "bg-indigo-100 text-indigo-800 hover:bg-indigo-200 hover:text-indigo-900"
            : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 hover:text-emerald-900 font-mono"}`}
        onClick={() => entry?.cite && onCiteClick?.(entry.cite)}
        title={entry ? `[${entry.n}] ${entry.kind === "doc" ? "📄" : "⚙"} ${lbl}` : lbl}
      >
        {entry ? entry.n : "?"}
      </button>
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(<span key={key++}>{text.slice(lastIdx)}</span>);

  return <div className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap">{parts}</div>;
}

function SourcesList({ cited, onCiteClick }) {
  return (
    <div className="mt-4 pt-3 border-t border-slate-100">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-1.5">
        Sources
      </div>
      <ol className="space-y-1">
        {cited.map((entry) => {
          const cite = entry.cite;
          const isDoc = entry.kind === "doc";
          let label;
          if (isDoc) {
            label = entry.label;
          } else {
            // For SQL, prefer a clean human label over the truncated SQL string
            const sql = cite?.sql || entry.label;
            const rationale = cite?.rationale;
            label = rationale ? `Database query — ${rationale}` : `Database query`;
          }
          return (
            <li
              key={entry.n}
              className="flex items-start gap-2 text-[12.5px] text-slate-700 leading-snug"
            >
              <span className="shrink-0 text-[10.5px] font-semibold text-slate-500 tabular-nums w-6 text-right pt-[2px]">
                [{entry.n}]
              </span>
              <button
                onClick={() => cite && onCiteClick?.(cite)}
                disabled={!cite}
                className={`text-left flex-1 min-w-0 hover:underline ${cite ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
                title={isDoc ? "Open PDF at cited page" : "Inspect SQL + rows"}
              >
                <span className="mr-1 text-[10.5px]">{isDoc ? "📄" : "⚙"}</span>
                <span className={isDoc ? "text-indigo-800 font-medium" : "text-emerald-800 font-medium font-mono"}>
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Badge({ route, confidence, latency, fastPath }) {
  const confClass = {
    high: "conf-high",
    medium: "conf-medium",
    low: "conf-low",
    refused: "conf-refused",
  }[confidence] || "conf-low";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10.5px] px-2 py-1 rounded border font-medium ${confClass}`}>
      <span className={`inline-flex items-center px-1 py-0.5 rounded font-mono text-[9.5px] route-${route || "low"}`}>
        {route || "?"}
      </span>
      <span className="uppercase tracking-wide">{confidence || "?"}</span>
      <span className="text-slate-400">·</span>
      <span className="tabular-nums">{latency ? `${(latency / 1000).toFixed(1)}s` : "—"}</span>
      {fastPath && (
        <span className="inline-block px-1 py-0.5 ml-0.5 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold tracking-wide">FP</span>
      )}
    </span>
  );
}

// Rotating "thinking" copy used while we're waiting for the first event from the
// backend (the plan LLM call can take 5-30s before anything reports back).
const THINKING_PHRASES = [
  "Reading your question…",
  "Looking at the schema…",
  "Choosing the right tools…",
  "Planning the query…",
  "Almost there…",
  "Still working — local LLMs take a moment…",
];

function ProgressTimeline({ phase, steps, route }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, []);

  // If no events yet (phase undefined or still pre-plan), show the rotating copy.
  const hasAnyEvent = !!route || steps.length > 0;
  if (!hasAnyEvent) {
    const phraseIdx = Math.min(THINKING_PHRASES.length - 1, Math.floor(elapsed / 3));
    return (
      <div className="mb-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2 text-[12px] text-slate-600">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-600 animate-soft-pulse" />
          <span className="font-medium text-slate-700">{THINKING_PHRASES[phraseIdx]}</span>
          <span className="ml-auto text-[10.5px] tabular-nums text-slate-400">{elapsed}s</span>
        </div>
      </div>
    );
  }

  // Build a timeline. Show route decision (from plan), then sql + docs steps,
  // then the current phase ("Composing answer…" if answering).
  const items = [];
  if (route) {
    items.push({
      key: "plan",
      done: true,
      label: `Routed to ${route}`,
      detail: null,
    });
  }
  // Find sql/docs in steps
  const sqlStarted = steps.find((s) => s.kind === "sql" && s.status === "started");
  const sqlDone = steps.find((s) => s.kind === "sql" && s.status === "done");
  const docsStarted = steps.find((s) => s.kind === "docs" && s.status === "started");
  const docsDone = steps.find((s) => s.kind === "docs" && s.status === "done");

  if (sqlStarted || sqlDone) {
    items.push({
      key: "sql",
      done: !!sqlDone,
      label: sqlDone ? "Database lookup" : "Querying database…",
      detail: sqlDone
        ? sqlDone.has_error
          ? "(no result)"
          : `${sqlDone.row_count} row${sqlDone.row_count === 1 ? "" : "s"} found`
        : null,
    });
  }
  if (docsStarted || docsDone) {
    items.push({
      key: "docs",
      done: !!docsDone,
      label: docsDone ? "Document search" : "Searching documents…",
      detail: docsDone
        ? `${docsDone.count} chunk${docsDone.count === 1 ? "" : "s"}` +
          (docsDone.top_score ? ` · top score ${docsDone.top_score}` : "")
        : null,
    });
  }
  if (phase === "answering") {
    items.push({
      key: "compose",
      done: false,
      label: "Composing answer…",
      detail: null,
    });
  }

  return (
    <div className="mb-3 pb-3 border-b border-slate-100">
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it.key} className="flex items-center gap-2 text-[12px] leading-tight">
            <StepIcon done={it.done} />
            <span className={it.done ? "text-slate-700" : "text-slate-700 font-medium"}>
              {it.label}
            </span>
            {it.detail && (
              <span className="text-slate-400 text-[11px]">— {it.detail}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-1.5 text-[10.5px] text-slate-400 tabular-nums">
        elapsed {elapsed}s
      </div>
    </div>
  );
}

function StepIcon({ done }) {
  if (done) {
    return (
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[10px]">
        ✓
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-4 h-4">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-600 animate-soft-pulse" />
    </span>
  );
}

