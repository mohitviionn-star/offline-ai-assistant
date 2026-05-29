import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Highlight, themes as prismThemes } from "prism-react-renderer";

const SAMPLE_PROMPTS = [
  { vertical: "Healthcare · Nursing Home", icon: "◐", prompt: "Does Robert Miller have physical therapy approval, and what does our protocol say about PT eligibility?" },
  { vertical: "Healthcare · Nursing Home", icon: "◐", prompt: "Which residents are currently on insulin AND have a fall-risk history, and what is our insulin administration protocol?" },
  { vertical: "Healthcare · Nursing Home", icon: "◐", prompt: "What medications is Robert Miller allergic to?" },
  { vertical: "Property Management", icon: "◓", prompt: "How much rent has Devon Patel paid in the last 6 months, and what does our tenant handbook say about late fees?" },
  { vertical: "Property Management", icon: "◓", prompt: "Which leases are expiring in the next 6 months, and what does the handbook say about renewal notices?" },
  { vertical: "Property Management", icon: "◓", prompt: "Are pets allowed at 120 Maple Ave, and what is our pet deposit policy?" },
  { vertical: "Legal · Divorce", icon: "◑", prompt: "Show all missed alimony payments for Michael Rosenberg and retrieve the enforcement procedure from our settlement SOP." },
  { vertical: "Legal · Personal Injury", icon: "◑", prompt: "Did Robert Diaz miss any treatment appointments, and what does our case strategy memo say about treatment gaps?" },
];

function groupedPrompts() {
  const groups = {};
  for (const p of SAMPLE_PROMPTS) {
    (groups[p.vertical] = groups[p.vertical] || []).push(p);
  }
  return Object.entries(groups);
}

const DRAFT_KEY = "composer:draft";

// Returns the Web Speech API recognition constructor, or null if unsupported.
function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export default function Chat({ messages, pending, onAsk, onStop, onRegenerate, onEditUserMessage, onFeedback, onCiteClick, models, selectedModel, onSelectModel }) {
  const [input, setInput] = useState(() => {
    try { return localStorage.getItem(DRAFT_KEY) || ""; } catch { return ""; }
  });
  const endRef = useRef(null);
  const textareaRef = useRef(null);

  // Persist draft as the user types — debounced. Cleared on submit.
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, input); } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  // Auto-grow the textarea up to a cap (CSS max-height handles the cap).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = el.scrollHeight + "px";
  }, [input]);

  function submit(e) {
    e?.preventDefault();
    // While a query is in flight, the button acts as a Stop.
    if (pending) {
      onStop?.();
      return;
    }
    if (!input.trim()) return;
    onAsk(input);
    setInput("");
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
  }

  function onKeyDown(e) {
    // Enter to send (or stop while pending), Shift+Enter for newline.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  // --- Voice input (Web Speech API) ---
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);
  const speechBaseRef = useRef("");
  const speechAvailable = !!getSpeechRecognition();

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Recog = getSpeechRecognition();
    if (!Recog) return;
    const r = new Recog();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    speechBaseRef.current = input ? input + (input.endsWith(" ") ? "" : " ") : "";
    r.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (final) speechBaseRef.current += final;
      setInput(speechBaseRef.current + interim);
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recognitionRef.current = r;
    try { r.start(); setListening(true); } catch {}
  }

  useEffect(() => () => recognitionRef.current?.stop?.(), []);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-3xl mx-auto space-y-7">
          {messages.length === 0 && <EmptyState onAsk={onAsk} />}
          {messages.map((m, i) => (
            <Message
              key={i}
              msg={m}
              idx={i}
              isLast={i === messages.length - 1}
              isLastUser={m.role === "user" && i === messages.length - 2}
              pending={pending}
              onCiteClick={onCiteClick}
              onAsk={onAsk}
              onRegenerate={onRegenerate}
              onEditUserMessage={onEditUserMessage}
              onFeedback={onFeedback}
            />
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <div className="px-6 pt-3 pb-5 bg-gradient-to-t from-white via-white to-white/0">
        <form onSubmit={submit} className="max-w-3xl mx-auto">
          <div className="composer-shell">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={pending ? "Stop the current answer (□) or keep typing your next question…" : "Message the assistant — Shift+Enter for a new line"}
              className="composer-textarea"
            />
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="flex items-center gap-1">
                {speechAvailable && (
                  <button
                    type="button"
                    onClick={toggleListening}
                    title={listening ? "Stop listening" : "Voice input"}
                    aria-label={listening ? "Stop listening" : "Voice input"}
                    className={`composer-btn ${listening ? "!text-red-600 animate-soft-pulse" : ""}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={listening ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  </button>
                )}
                {models && models.length > 0 && (
                  <ModelPill models={models} selectedModel={selectedModel} onSelectModel={onSelectModel} disabled={pending} />
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] text-slate-400 hidden sm:inline">
                  Enter ↵ to send
                </span>
                <button
                  type="submit"
                  disabled={!pending && !input.trim()}
                  className="composer-send"
                  title={pending ? "Stop" : "Send"}
                  aria-label={pending ? "Stop generating" : "Send"}
                >
                  {pending ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <rect x="5" y="5" width="14" height="14" rx="2" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-[10.5px] text-slate-400">
            Grounded answers only · every claim is cited from your docs or your database.
          </p>
        </form>
      </div>
    </div>
  );
}

function ModelPill({ models, selectedModel, onSelectModel, disabled }) {
  const cur = models.find((m) => m.name === selectedModel) || models[0];
  const label = cur?.label || cur?.name || "model";
  return (
    <div className="relative">
      <select
        value={selectedModel || ""}
        onChange={(e) => onSelectModel?.(e.target.value || null)}
        disabled={disabled}
        className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
        title="Local LLM used for this query"
        aria-label="Model selector"
      >
        {models.map((m) => (
          <option key={m.name} value={m.name}>{m.label || m.name}</option>
        ))}
      </select>
      <span className="composer-pill pointer-events-none">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span className="font-medium truncate max-w-[140px]">{label}</span>
      </span>
    </div>
  );
}

function EmptyState({ onAsk }) {
  return (
    <div className="pt-4">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-sm font-bold tracking-tight shadow-md mb-4">
          AI
        </div>
        <h2 className="text-[22px] font-semibold text-ink tracking-tight leading-tight">
          How can I help today?
        </h2>
        <p className="mt-1.5 text-[13px] text-slate-500 max-w-xl mx-auto">
          I ground every answer in your documents and your database — and cite the exact source for each claim.
        </p>
      </div>

      <div className="mt-7 space-y-5">
        {groupedPrompts().map(([vertical, items]) => (
          <div key={vertical}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">
              {vertical}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((p) => (
                <button
                  key={p.prompt}
                  onClick={() => onAsk(p.prompt)}
                  className="group text-left text-[12.5px] leading-snug text-slate-800
                             px-3.5 py-2.5 rounded-xl bg-white border border-slate-200
                             hover:border-slate-400 hover:shadow-card transition-all"
                >
                  <span className="text-slate-400 mr-1.5">{p.icon}</span>
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

function Message({ msg, idx, isLast, isLastUser, pending, onCiteClick, onAsk, onRegenerate, onEditUserMessage, onFeedback }) {
  if (msg.role === "user") {
    return (
      <UserMessage
        msg={msg}
        idx={idx}
        editable={isLastUser && !pending}
        onSave={(newText) => onEditUserMessage?.(idx, newText)}
      />
    );
  }

  const docCites = (msg.citations || []).filter((c) => c.type === "document");
  const sqlCites = (msg.citations || []).filter((c) => c.type === "sql");

  const isStreaming = !!msg.streaming;
  const phase = msg.phase;
  const showClarification = !!msg.clarification;
  const showProgressHeader = isStreaming && !(msg.answer && msg.answer.length > 0) && !showClarification;
  const cited = extractCitedInOrder(msg.answer || "", msg.citations || []);
  const followups = Array.isArray(msg.followups) ? msg.followups : [];
  const wasStopped = !!msg.stopped;
  const stoppedEmpty = wasStopped && !(msg.answer && msg.answer.length > 0);

  return (
    <div className="flex gap-3 items-start">
      <div className="avatar-ai">AI</div>
      <div className="flex-1 min-w-0 pt-0.5">
        {showProgressHeader ? (
          <ProgressTimeline phase={phase} steps={msg.steps || []} route={msg.route} />
        ) : showClarification ? (
          <ClarificationBanner
            question={msg.clarification}
            options={msg.clarification_options || []}
            onAsk={onAsk}
          />
        ) : stoppedEmpty ? (
          <StoppedNotice />
        ) : (
          <>
            <RenderAnswer
              text={msg.answer || ""}
              cited={cited}
              onCiteClick={onCiteClick}
              streaming={isStreaming}
            />
            {wasStopped && <StoppedTag />}
          </>
        )}

        {!isStreaming && !showClarification && cited.length > 0 && (
          <SourcesList cited={cited} onCiteClick={onCiteClick} />
        )}
        {!isStreaming && !showClarification && (msg.latency_ms || wasStopped) && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            {msg.latency_ms && <Badge latency={msg.latency_ms} />}
            <ActionRow
              msg={msg}
              cited={cited}
              canRegenerate={isLast && !pending}
              showCopy={!stoppedEmpty}
              showFeedback={!stoppedEmpty}
              onCopy={() => copyAnswerToClipboard(msg, cited)}
              onRegenerate={() => onRegenerate?.(idx)}
              onFeedback={(vote) => onFeedback?.(idx, vote)}
            />
          </div>
        )}
        {!isStreaming && !showClarification && (followups.length > 0 || msg.followups_pending) && (
          <FollowupsRow questions={followups} pending={msg.followups_pending} onAsk={onAsk} />
        )}
      </div>
    </div>
  );
}

function UserMessage({ msg, editable, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.text || "");
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!editing) setDraft(msg.text || "");
  }, [msg.text, editing]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = el.scrollHeight + "px";
  }, [editing, draft]);

  function startEdit() {
    setDraft(msg.text || "");
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === (msg.text || "").trim()) {
      setEditing(false);
      return;
    }
    setEditing(false);
    onSave?.(trimmed);
  }

  function cancel() {
    setDraft(msg.text || "");
    setEditing(false);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  }

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] w-full rounded-2xl rounded-br-md bg-white border border-indigo-300 ring-2 ring-indigo-100 px-3.5 py-2.5">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            className="w-full resize-none bg-transparent outline-none text-[14px] text-ink leading-snug max-h-[200px]"
          />
          <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-slate-100">
            <span className="text-[10.5px] text-slate-400 mr-auto">Esc to cancel · ⌘↵ to save</span>
            <button
              onClick={cancel}
              className="text-[11.5px] px-2.5 py-1 rounded-md text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={commit}
              disabled={!draft.trim() || draft.trim() === (msg.text || "").trim()}
              className="text-[11.5px] px-2.5 py-1 rounded-md bg-ink text-white hover:bg-slate-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed"
            >
              Save & resend
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-end group">
      <div className="max-w-[85%] relative rounded-2xl rounded-br-md bg-slate-100 border border-slate-200 px-4 py-2.5 text-[14px] text-ink leading-snug whitespace-pre-wrap">
        {msg.text}
        {editable && (
          <button
            onClick={startEdit}
            title="Edit and resend"
            aria-label="Edit message"
            className="absolute -top-2.5 -left-2.5 w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm
                       text-slate-500 hover:text-ink hover:border-slate-400 opacity-0 group-hover:opacity-100
                       transition-opacity inline-flex items-center justify-center"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function StoppedNotice() {
  return (
    <div className="flex items-center gap-2 text-[13px] text-slate-500 italic">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <rect x="6" y="6" width="12" height="12" rx="1.5" />
      </svg>
      Stopped before the answer started. Ask again to retry.
    </div>
  );
}

function StoppedTag() {
  return (
    <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] text-slate-400 italic">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <rect x="5" y="5" width="14" height="14" rx="1.5" />
      </svg>
      stopped — answer may be incomplete
    </span>
  );
}

function ClarificationBanner({ question, options, onAsk }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
      <div className="flex items-start gap-2">
        <span className="text-amber-600 text-[14px] leading-none mt-[2px]" aria-hidden>?</span>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700 mb-1">
            Quick clarification
          </div>
          <div className="text-[13.5px] text-ink leading-snug">{question}</div>
          {options.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => onAsk?.(opt)}
                  className="text-[12px] leading-tight px-2.5 py-1 rounded-full
                             bg-white border border-amber-300 text-amber-900
                             hover:bg-amber-100 hover:border-amber-400 transition-colors"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FollowupsRow({ questions, pending, onAsk }) {
  // Stagger: label fades in first, then each chip ~250ms after the previous.
  const labelDelay = 0;
  const firstChipDelay = 350;
  const chipStagger = 250;

  // While waiting for the followups LLM call, show 3 skeleton chips.
  // The label appears immediately so the user sees something is coming.
  const showSkeleton = pending && questions.length === 0;

  return (
    <div className="mt-4 pt-3 border-t border-slate-100">
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-1.5 gentle-fade-in"
        style={{ animationDelay: `${labelDelay}ms` }}
      >
        You might also ask
      </div>
      {showSkeleton ? (
        <div className="flex flex-wrap gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block h-[26px] rounded-full border border-slate-200 overflow-hidden gentle-fade-in"
              style={{
                width: `${110 + (i * 47) % 90}px`,
                animationDelay: `${firstChipDelay + i * chipStagger}ms`,
              }}
              aria-hidden
            >
              <span
                className="block w-full h-full skeleton-shimmer"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            </span>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {questions.map((q, i) => (
            <button
              key={i}
              onClick={() => onAsk?.(q)}
              className="text-left text-[12px] leading-snug px-3 py-1.5 rounded-full
                         bg-slate-50 border border-slate-200 text-slate-700
                         hover:bg-slate-100 hover:border-slate-300 hover:text-ink
                         transition-colors max-w-full truncate gentle-fade-in"
              style={{ animationDelay: `${firstChipDelay + i * chipStagger}ms` }}
              title={q}
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Walk the answer text in order, find each [doc:...] / [sql:...] marker,
 * dedupe (same source = same number), and resolve to the underlying citation
 * object. Returns an ordered list: [{n, kind, label, cite}].
 */
function extractCitedInOrder(text, citations) {
  const seen = new Map();
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

const CITE_SCHEME = "cite";

function preprocess(text, cited) {
  const byKey = new Map(cited.map((c) => [c.key, c]));
  return text.replace(/\[(doc|sql):([^\]]+)\]/g, (_m, kind, label) => {
    const trimmed = label.trim();
    const entry = byKey.get(`${kind}:${trimmed}`);
    const n = entry ? entry.n : "?";
    return `[${n}](${CITE_SCHEME}-${kind}://${encodeURIComponent(trimmed)})`;
  });
}

function RenderAnswer({ text, cited, onCiteClick, streaming = false }) {
  const byKey = new Map(cited.map((c) => [c.key, c]));
  const processed = preprocess(text || "", cited);

  const components = {
    code: ({ inline, className, children, ...rest }) => {
      const text = String(children || "").replace(/\n$/, "");
      const lang = (className || "").match(/language-(\w+)/)?.[1] || "sql";
      if (inline) {
        return (
          <code className="px-1 py-0.5 rounded bg-slate-100 text-[0.92em] font-mono text-slate-800" {...rest}>
            {children}
          </code>
        );
      }
      return (
        <Highlight code={text} language={lang} theme={prismThemes.github}>
          {({ className: cn, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={`${cn} mt-2 mb-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-mono leading-snug overflow-x-auto`}
              style={style}
            >
              {tokens.map((line, i) => (
                <div key={i} {...getLineProps({ line })}>
                  {line.map((token, j) => (
                    <span key={j} {...getTokenProps({ token })} />
                  ))}
                </div>
              ))}
            </pre>
          )}
        </Highlight>
      );
    },
    a: ({ href, children }) => {
      if (typeof href === "string" && href.startsWith(`${CITE_SCHEME}-`)) {
        const kind = href.startsWith(`${CITE_SCHEME}-doc`) ? "doc" : "sql";
        const label = decodeURIComponent(href.replace(`${CITE_SCHEME}-${kind}://`, ""));
        const entry = byKey.get(`${kind}:${label}`);
        return (
          <button
            onClick={() => entry?.cite && onCiteClick?.(entry.cite)}
            className={`inline-flex items-baseline align-baseline px-1 mx-0.5 rounded text-[10.5px] font-semibold leading-none transition-colors
              ${kind === "doc"
                ? "bg-indigo-100 text-indigo-800 hover:bg-indigo-200 hover:text-indigo-900"
                : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 hover:text-emerald-900 font-mono"}`}
            title={entry ? `[${entry.n}] ${kind === "doc" ? "📄" : "⚙"} ${label}` : label}
          >
            {children}
          </button>
        );
      }
      return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
    },
  };

  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
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
            <li key={entry.n} className="flex items-start gap-2 text-[12.5px] text-slate-700 leading-snug">
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

function copyAnswerToClipboard(msg, cited) {
  // Build a markdown blob: answer with [doc:...]/[sql:...] replaced by [N],
  // then a Sources list.
  const byKey = new Map(cited.map((c) => [c.key, c]));
  const body = (msg.answer || "").replace(/\[(doc|sql):([^\]]+)\]/g, (_m, kind, label) => {
    const entry = byKey.get(`${kind}:${label.trim()}`);
    return entry ? `[${entry.n}]` : "";
  });
  const sources = cited.length
    ? "\n\nSources:\n" + cited.map((c) => {
        if (c.kind === "doc") return `[${c.n}] ${c.label}`;
        const r = c.cite?.rationale;
        return `[${c.n}] SQL${r ? ` — ${r}` : ""}`;
      }).join("\n")
    : "";
  return navigator.clipboard.writeText(body.trim() + sources);
}

function ActionRow({ msg, cited, canRegenerate, showCopy = true, showFeedback = true, onCopy, onRegenerate, onFeedback }) {
  const [copied, setCopied] = useState(false);
  const vote = msg.vote || null;

  async function handleCopy() {
    try {
      await onCopy();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard may be denied in insecure contexts
    }
  }

  return (
    <div className="inline-flex items-center gap-0.5">
      {showCopy && (
        <IconBtn
          title={copied ? "Copied!" : "Copy answer"}
          onClick={handleCopy}
          active={copied}
        >
          {copied ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </IconBtn>
      )}
      {showFeedback && (
        <>
          <IconBtn
            title="Helpful"
            onClick={() => onFeedback?.("up")}
            active={vote === "up"}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill={vote === "up" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
            </svg>
          </IconBtn>
          <IconBtn
            title="Not helpful"
            onClick={() => onFeedback?.("down")}
            active={vote === "down"}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill={vote === "down" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
            </svg>
          </IconBtn>
        </>
      )}
      {canRegenerate && (
        <IconBtn title="Regenerate" onClick={onRegenerate}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </IconBtn>
      )}
    </div>
  );
}

function IconBtn({ title, active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors
        ${active
          ? "bg-slate-100 text-ink"
          : "text-slate-400 hover:text-slate-700 hover:bg-slate-50"}`}
    >
      {children}
    </button>
  );
}

function Badge({ latency }) {
  if (!latency) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] text-slate-400 tabular-nums">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      {`${(latency / 1000).toFixed(1)}s`}
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
