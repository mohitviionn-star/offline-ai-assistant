import React, { useEffect, useRef, useState } from "react";

const SAMPLE_PROMPTS = [
  // Nursing home (SNF) — residents/admissions/medications + clinical SOPs
  "Does Robert Miller have physical therapy approval, and what does our protocol say about PT eligibility?",
  "Which residents are currently on insulin AND have a fall-risk history, and what is our insulin administration protocol?",
  "What medications is Robert Miller allergic to?",
  // Legal — divorce: clients/cases/payments + custody/mediation SOPs
  "Does Sarah Klein's custody agreement allow overnight travel outside Illinois, and what does our custody SOP say about travel restrictions?",
  "Show all missed alimony payments for Michael Rosenberg and retrieve the enforcement procedure from our settlement SOP.",
  // Legal — personal injury: treatments/cases + case strategy SOPs
  "Did Robert Diaz miss any treatment appointments, and what does our case strategy memo say about treatment gaps?",
  "Which clients have upcoming statute-of-limitations deadlines, and what does our PI strategy say about SOL?",
  // Real estate — properties + landlord-tenant law
  "Which property has the highest current value, and what does the landlord-tenant handbook say about security deposits?",
];

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
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto pt-8">
            <div className="text-lg font-semibold text-slate-800">
              Ask a question that combines your documents and database.
            </div>
            <div className="mt-1 text-sm text-slate-500">
              Try one of these to see hybrid retrieval in action:
            </div>
            <div className="mt-4 grid gap-2">
              {SAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => onAsk(p)}
                  className="text-left text-sm px-4 py-3 rounded-lg bg-white border border-slate-200
                             hover:border-accent hover:shadow-sm transition-all"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <Message key={i} msg={m} onCiteClick={onCiteClick} />
        ))}
        {pending && !(messages.length && messages[messages.length - 1]?.role === "assistant" && (messages[messages.length - 1]?.answer || "").length > 0) && (
          <PendingBubble />
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="border-t border-slate-200 bg-white px-6 py-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={pending}
            placeholder="Ask anything about your documents or data…"
            className="flex-1 px-4 py-3 rounded-lg border border-slate-300 bg-white text-sm
                       focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="px-5 py-3 rounded-lg bg-accent text-white text-sm font-medium
                       hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            Ask
          </button>
        </div>
      </form>
    </div>
  );
}

function Message({ msg, onCiteClick }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-2xl px-4 py-3 rounded-2xl bg-accent text-white text-sm">
          {msg.text}
        </div>
      </div>
    );
  }

  const docCites = (msg.citations || []).filter((c) => c.type === "document");
  const sqlCites = (msg.citations || []).filter((c) => c.type === "sql");

  return (
    <div className="flex justify-start">
      <div className="max-w-3xl w-full">
        <div className="px-4 py-3 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <RenderAnswer
            text={msg.answer || ""}
            citations={msg.citations || []}
            onCiteClick={onCiteClick}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
            <Badge route={msg.route} confidence={msg.confidence} latency={msg.latency_ms} />
            {docCites.map((c, i) => (
              <button key={`d${i}`} className="cite-chip doc" onClick={() => onCiteClick?.(c)}>
                📄 {c.label}
              </button>
            ))}
            {sqlCites.map((c, i) => (
              <button key={`s${i}`} className="cite-chip sql" onClick={() => onCiteClick?.(c)}>
                ⚙ {c.label}
              </button>
            ))}
          </div>
          {msg.rationale && (
            <div className="mt-2 text-[11px] text-slate-400 italic">
              router: {msg.rationale}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RenderAnswer({ text, citations, onCiteClick }) {
  // Render [doc:...] and [sql:...] markers as inline pills.
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
        // exact label match preferred; fall back to filename match
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
        {kind === "doc" ? "📄" : "⚙"} {label}
      </button>
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(<span key={key++}>{text.slice(lastIdx)}</span>);

  return <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{parts}</div>;
}

function Badge({ route, confidence, latency }) {
  const conf = {
    high: "bg-emerald-50 text-emerald-700 border-emerald-200",
    medium: "bg-amber-50 text-amber-700 border-amber-200",
    low: "bg-rose-50 text-rose-700 border-rose-200",
    refused: "bg-slate-100 text-slate-600 border-slate-200",
  }[confidence] || "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-md border ${conf}`}>
      {route || "?"} · {confidence || "?"} · {latency ? `${latency}ms` : "—"}
    </span>
  );
}

function PendingBubble() {
  return (
    <div className="flex justify-start">
      <div className="px-4 py-3 rounded-2xl bg-white border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
          Routing, retrieving, answering…
        </div>
      </div>
    </div>
  );
}
