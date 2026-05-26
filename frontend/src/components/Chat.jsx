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
        {pending && !(messages.length && messages[messages.length - 1]?.role === "assistant" && (messages[messages.length - 1]?.answer || "").length > 0) && (
          <PendingBubble />
        )}
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
  const showProgressHeader = isStreaming && msg.route && !(msg.answer && msg.answer.length > 0);

  return (
    <div className="flex justify-start">
      <div className="max-w-3xl w-full">
        <div className="surface rounded-md p-4">
          {showProgressHeader && (
            <div className="mb-3 pb-3 border-b border-slate-100 space-y-2">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-violet-200 bg-violet-50 text-violet-800 font-semibold">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-600 animate-soft-pulse" />
                  {phase === "retrieving" ? "RETRIEVING EVIDENCE" : phase === "answering" ? "COMPOSING ANSWER" : "THINKING"}
                </span>
                <span className="text-slate-500">route</span>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded border font-mono text-[10.5px] route-${msg.route}`}>
                  {msg.route}
                </span>
              </div>
              {msg.plannedSql && (
                <div className="sql-preview">
                  <span className="text-emerald-700 font-semibold">SQL </span>
                  <span className="text-slate-800">{msg.plannedSql}</span>
                </div>
              )}
              {msg.plannedDocsQuery && (
                <div className="text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-700">Docs query</span> · {msg.plannedDocsQuery}
                </div>
              )}
            </div>
          )}
          <RenderAnswer
            text={msg.answer || ""}
            citations={msg.citations || []}
            onCiteClick={onCiteClick}
          />
          {(msg.answer || msg.confidence) && (
            <div className="mt-3.5 flex flex-wrap items-center gap-1.5 pt-3 border-t border-slate-100">
              <Badge route={msg.route} confidence={msg.confidence} latency={msg.latency_ms} fastPath={msg.fast_path} />
              {docCites.map((c, i) => (
                <button key={`d${i}`} className="cite-chip doc" onClick={() => onCiteClick?.(c)}>
                  <span className="text-[9px]">📄</span> {c.label}
                </button>
              ))}
              {sqlCites.map((c, i) => (
                <button key={`s${i}`} className="cite-chip sql" onClick={() => onCiteClick?.(c)}>
                  <span className="text-[9px] font-sans">⚙</span> {c.label}
                </button>
              ))}
            </div>
          )}
          {msg.rationale && !showProgressHeader && (
            <div className="mt-2 text-[10.5px] text-slate-400">
              <span className="text-slate-500">router</span> · {msg.rationale}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RenderAnswer({ text, citations, onCiteClick }) {
  const parts = [];
  const re = /\[(doc|sql):([^\]]+)\]/g;
  let lastIdx = 0;
  let match;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(<span key={key++}>{text.slice(lastIdx, match.index)}</span>);
    const kind = match[1];
    const label = match[2].trim();
    const cite = citations.find((c) => {
      if (kind === "doc") {
        if (c.type !== "document") return false;
        return c.label === label || label.startsWith(c.filename);
      }
      return c.type === "sql";
    });
    parts.push(
      <button
        key={key++}
        className={`cite-chip ${kind === "doc" ? "doc" : "sql"} mx-0.5 align-baseline`}
        onClick={() => cite && onCiteClick?.(cite)}
      >
        <span className="text-[9px]">{kind === "doc" ? "📄" : "⚙"}</span> {label}
      </button>
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(<span key={key++}>{text.slice(lastIdx)}</span>);

  return <div className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap">{parts}</div>;
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

function PendingBubble() {
  return (
    <div className="flex justify-start">
      <div className="surface rounded-md px-4 py-3">
        <div className="flex items-center gap-2 text-[13px] text-slate-600">
          <span className="inline-block w-2 h-2 rounded-full bg-violet-600 animate-soft-pulse" />
          Routing, retrieving, answering…
        </div>
      </div>
    </div>
  );
}
