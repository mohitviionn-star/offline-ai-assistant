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
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      <div className="flex-1 overflow-y-auto px-8 py-8 space-y-6">
        {messages.length === 0 && <EmptyState onAsk={onAsk} />}

        {messages.map((m, i) => (
          <Message key={i} msg={m} onCiteClick={onCiteClick} />
        ))}
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
    // User turn: a quiet header, not a bubble.
    return (
      <div className="max-w-3xl mx-auto pt-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-1">
          You asked
        </div>
        <div className="text-[15px] text-ink leading-snug font-medium">
          {msg.text}
        </div>
      </div>
    );
  }

  const docCites = (msg.citations || []).filter((c) => c.type === "document");
  const sqlCites = (msg.citations || []).filter((c) => c.type === "sql");

  const isStreaming = !!msg.streaming;
  const phase = msg.phase;
  const showProgressHeader = isStreaming && !(msg.answer && msg.answer.length > 0);

  const cited = extractCitedInOrder(msg.answer || "", msg.citations || []);

  return (
    <div className="max-w-3xl mx-auto">
      {/* The answer itself: flat, no bubble, just typography. */}
      {showProgressHeader ? (
        <ProgressTimeline phase={phase} steps={msg.steps || []} route={msg.route} />
      ) : (
        <RenderAnswer
          text={msg.answer || ""}
          cited={cited}
          onCiteClick={onCiteClick}
          streaming={isStreaming}
        />
      )}

      {/* Sources + meta block — only after streaming is fully done.
          While tokens are still arriving the answer text is the only thing visible. */}
      {!isStreaming && cited.length > 0 && (
        <SourcesList cited={cited} onCiteClick={onCiteClick} />
      )}
      {!isStreaming && (msg.answer || msg.confidence) && (
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <Badge route={msg.route} confidence={msg.confidence} latency={msg.latency_ms} fastPath={msg.fast_path} />
          {(docCites.length + sqlCites.length) > cited.length && (
            <span className="text-[10.5px] text-slate-400">
              {cited.length} of {docCites.length + sqlCites.length} sources used in answer
            </span>
          )}
          {msg.rationale && (
            <span className="text-[10.5px] text-slate-400">
              <span className="text-slate-500">·</span> router: {msg.rationale}
            </span>
          )}
        </div>
      )}

      {/* Subtle divider between turns once the response is settled. */}
      {!isStreaming && (
        <div className="mt-6 border-t border-slate-200" />
      )}
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

function RenderAnswer({ text, cited, onCiteClick, streaming = false }) {
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

  return (
    <div className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap">
      {parts}
      {streaming && (
        <span
          className="inline-block w-[2px] h-[1em] align-text-bottom ml-0.5 bg-ink animate-blink-cursor"
          aria-hidden
        />
      )}
    </div>
  );
}

function SourcesList({ cited, onCiteClick }) {
  return (
    <div className="mt-4 pt-3 border-t border-slate-100">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-1.5">
        Sources <span className="text-slate-400 normal-case font-normal">— click a citation to see the evidence</span>
      </div>
      <ol className="space-y-1">
        {cited.map((entry) => {
          const cite = entry.cite;
          const isDoc = entry.kind === "doc";
          let label;
          if (isDoc) {
            label = entry.label;
          } else {
            const rationale = cite?.rationale;
            label = rationale ? `Database query — ${rationale}` : "Database query";
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
                title={isDoc ? "Open in evidence panel" : "Inspect SQL + rows"}
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

// Phrases by phase. Headline = phase title; subline rotates through these.
const PHASE_COPY = {
  planning: {
    headline: "Planning your answer",
    sublines: [
      "Reading your question carefully…",
      "Loading the schema into context…",
      "Looking at which tables and documents I have…",
      "Deciding whether to query, read, or both…",
      "Drafting a query in my head…",
      "Picking the right tools for this one…",
      "Thinking through the approach…",
      "Mapping your question to the data…",
    ],
  },
  gathering: {
    headline: "Gathering evidence",
    sublines: [
      "Pulling records from your database…",
      "Reading through the documents…",
      "Looking for the most relevant chunks…",
      "Embedding the search query…",
      "Cross-referencing the sources…",
      "Finding the citations…",
    ],
  },
  composing: {
    headline: "Composing the answer",
    sublines: [
      "Weaving evidence into a clean answer…",
      "Picking the right phrasing…",
      "Making sure every claim has a citation…",
      "Drafting the response…",
      "Putting it all together…",
      "Polishing the wording…",
      "Almost ready to write…",
    ],
  },
};

const PATIENCE_SUBLINES = [
  "Hang tight — running on your own machine, not in the cloud.",
  "Quality over speed — still working…",
  "Local LLMs are thorough. Patience pays off.",
  "Slower than the cloud, but your data never leaves your hardware.",
];

function pickSubline(phaseKey, elapsed) {
  // After 35s, blend in patience copy so we acknowledge the wait.
  const phasePhrases = PHASE_COPY[phaseKey]?.sublines || [];
  if (elapsed >= 35) {
    const pool = [...phasePhrases, ...PATIENCE_SUBLINES];
    return pool[Math.floor(elapsed / 3) % pool.length];
  }
  return phasePhrases[Math.floor(elapsed / 2.5) % phasePhrases.length];
}

function ProgressTimeline({ phase, steps, route }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - start) / 1000), 250);
    return () => clearInterval(id);
  }, []);

  const elapsedInt = Math.floor(elapsed);

  // Figure out the current phase from event state.
  const hasPlan = !!route;
  const sqlStep = steps.find((s) => s.kind === "sql" && s.status === "started" || s.kind === "sql" && s.status === "done");
  const docsStep = steps.find((s) => s.kind === "docs" && s.status === "started" || s.kind === "docs" && s.status === "done");
  const sqlDone = !!steps.find((s) => s.kind === "sql" && s.status === "done");
  const docsDone = !!steps.find((s) => s.kind === "docs" && s.status === "done");
  const allRetrievalDone =
    (!sqlStep || sqlDone) &&
    (!docsStep || docsDone) &&
    (sqlDone || docsDone);

  let phaseKey;
  if (!hasPlan) phaseKey = "planning";
  else if (phase === "answering" || allRetrievalDone) phaseKey = "composing";
  else phaseKey = "gathering";

  // Build step list.
  const items = [];
  if (route) {
    items.push({ key: "plan", done: true, label: `Routed to ${route}` });
  }
  const sqlStarted = steps.find((s) => s.kind === "sql" && s.status === "started");
  const sqlDoneStep = steps.find((s) => s.kind === "sql" && s.status === "done");
  const docsStarted = steps.find((s) => s.kind === "docs" && s.status === "started");
  const docsDoneStep = steps.find((s) => s.kind === "docs" && s.status === "done");

  if (sqlStarted || sqlDoneStep) {
    items.push({
      key: "sql",
      done: !!sqlDoneStep,
      label: sqlDoneStep ? "Database lookup" : "Querying database",
      detail: sqlDoneStep
        ? sqlDoneStep.has_error
          ? "no result"
          : `${sqlDoneStep.row_count} row${sqlDoneStep.row_count === 1 ? "" : "s"} found`
        : null,
    });
  }
  if (docsStarted || docsDoneStep) {
    items.push({
      key: "docs",
      done: !!docsDoneStep,
      label: docsDoneStep ? "Document search" : "Searching documents",
      detail: docsDoneStep
        ? `${docsDoneStep.count} chunk${docsDoneStep.count === 1 ? "" : "s"}` +
          (docsDoneStep.top_score ? ` · top score ${docsDoneStep.top_score}` : "")
        : null,
    });
  }

  const headline = PHASE_COPY[phaseKey].headline;
  const subline = pickSubline(phaseKey, elapsed);

  return (
    <div className="mb-3 pb-4 border-b border-slate-100">
      <div className="flex items-start gap-3">
        <BouncingDotsLoader compact />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-ink leading-tight">
            {headline}
            <AnimatedDots />
          </div>
          <div className="mt-1 text-[12px] text-slate-500 leading-snug truncate min-h-[1em]">
            {subline}
          </div>
          {items.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {items.map((it) => (
                <li key={it.key} className="flex items-center gap-2 text-[12px] leading-tight">
                  <StepIcon done={it.done} />
                  <span className={it.done ? "text-slate-600" : "text-slate-700 font-medium"}>
                    {it.label}
                  </span>
                  {it.detail && (
                    <span className="text-slate-400 text-[11px]">— {it.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="text-[10.5px] tabular-nums text-slate-400 shrink-0">
          {elapsedInt}s
        </span>
      </div>
    </div>
  );
}

function BouncingDotsLoader({ compact = false }) {
  // Three dots that bounce in sequence — small, indigo-tinted, matches the
  // "thinking" feel of modern assistants.
  const size = compact ? "w-7 h-7" : "w-9 h-9";
  const dotSize = compact ? "w-1.5 h-1.5" : "w-2 h-2";
  return (
    <div className={`${size} rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center gap-0.5 shrink-0`}>
      <span className={`${dotSize} rounded-full bg-indigo-600 animate-bounce-1`} />
      <span className={`${dotSize} rounded-full bg-indigo-600 animate-bounce-2`} />
      <span className={`${dotSize} rounded-full bg-indigo-600 animate-bounce-3`} />
    </div>
  );
}

function AnimatedDots() {
  // Three dots that animate cyclically in the headline — like "Thinking..."
  return (
    <span className="inline-block ml-0.5">
      <span className="animate-blink-1">.</span>
      <span className="animate-blink-2">.</span>
      <span className="animate-blink-3">.</span>
    </span>
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
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-600 animate-soft-pulse" />
    </span>
  );
}

