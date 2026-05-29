import React, { useEffect, useRef, useState } from "react";
import { getHealth, getSchema, listDocuments, listModels, postFeedback, postQuery, streamQuery } from "./api";
import Chat from "./components/Chat.jsx";
import PdfModal from "./components/PdfModal.jsx";
import Sidebar from "./components/Sidebar.jsx";
import SourcePanel from "./components/SourcePanel.jsx";

// Convert the UI message list into the planner/answer history payload.
// Cap at the last 6 messages (≈3 turns) and skip messages that didn't produce
// a real answer (stopped, refused with no content).
function buildHistoryPayload(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.text || "" });
    } else if (m.role === "assistant") {
      const content = (m.answer || "").trim();
      if (!content) continue; // skip empty assistant turns (stopped before any text)
      out.push({ role: "assistant", content });
    }
  }
  return out.slice(-6);
}

const STORAGE_KEY_CONVS = "convs:v1";
const STORAGE_KEY_ACTIVE = "convs:v1:active";

function makeNewConversation() {
  return {
    id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: null, // null = auto-derive from first user message
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function deriveTitle(messages) {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser?.text) return null;
  const t = firstUser.text.trim().replace(/\s+/g, " ");
  return t.length > 60 ? t.slice(0, 60).trim() + "…" : t;
}

export default function App() {
  const [conversations, setConversations] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY_CONVS) || "null");
      if (Array.isArray(stored) && stored.length) return stored;
    } catch {}
    return [makeNewConversation()];
  });
  const [activeId, setActiveId] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_ACTIVE) || null;
  });

  // Persist conversations + active id.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_CONVS, JSON.stringify(conversations)); } catch {}
  }, [conversations]);
  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(STORAGE_KEY_ACTIVE, activeId);
      else localStorage.removeItem(STORAGE_KEY_ACTIVE);
    } catch {}
  }, [activeId]);

  // Keep activeId pointing at a real conversation. When the stored activeId
  // is missing/invalid, fall back to the MOST RECENTLY UPDATED conversation
  // (not just `conversations[0]`, which is the most recently CREATED).
  useEffect(() => {
    if (!activeId || !conversations.find((c) => c.id === activeId)) {
      const sorted = [...conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setActiveId(sorted[0]?.id || null);
    }
  }, [conversations, activeId]);

  const activeConv = conversations.find((c) => c.id === activeId);
  const messages = activeConv?.messages || [];

  // Updates the messages of the active conversation. Mirrors React's setState
  // signature so the rest of the code reads naturally.
  function setMessages(updater) {
    setConversations((cs) =>
      cs.map((c) => {
        if (c.id !== activeId) return c;
        const next = typeof updater === "function" ? updater(c.messages) : updater;
        return {
          ...c,
          messages: next,
          title: c.title || deriveTitle(next),
          updatedAt: Date.now(),
        };
      })
    );
  }

  const [pending, setPending] = useState(false);
  const [health, setHealth] = useState(null);
  const [schema, setSchema] = useState("");
  const [docs, setDocs] = useState([]);
  const [activeSource, setActiveSource] = useState(null);
  const [pdfModal, setPdfModal] = useState(null);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);  // null = backend default
  const abortRef = useRef(null);

  // --- Mobile sidebar drawer ---
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // --- Theme (light/dark) ---
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") return stored;
    } catch {}
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try { localStorage.setItem("theme", theme); } catch {}
  }, [theme]);

  function onStop() {
    abortRef.current?.abort();
  }

  function onNewConversation() {
    abortRef.current?.abort();
    const c = makeNewConversation();
    setConversations((cs) => [c, ...cs]);
    setActiveId(c.id);
    setActiveSource(null);
  }

  function onSelectConversation(id) {
    if (id === activeId) return;
    abortRef.current?.abort();
    setActiveId(id);
    setActiveSource(null);
  }

  function onRenameConversation(id, title) {
    const t = (title || "").trim().slice(0, 80);
    if (!t) return;
    setConversations((cs) =>
      cs.map((c) => (c.id === id ? { ...c, title: t, updatedAt: Date.now() } : c))
    );
  }

  function onDeleteConversation(id) {
    setConversations((cs) => {
      const filtered = cs.filter((c) => c.id !== id);
      return filtered.length ? filtered : [makeNewConversation()];
    });
    if (id === activeId) {
      abortRef.current?.abort();
      setActiveId(null); // the keep-active effect picks the next one
      setActiveSource(null);
    }
  }

  function handleCiteClick(c) {
    // Both docs and SQL open in the right-side evidence panel.
    // The panel exposes an "Open PDF" button for the full document viewer.
    setActiveSource(c);
  }

  function openFullPdf(c) {
    setPdfModal(c);
  }

  async function refresh() {
    const [h, s, d, m] = await Promise.all([getHealth(), getSchema(), listDocuments(), listModels()]);
    setHealth(h);
    setSchema(s.schema || "");
    setDocs(d.documents || []);
    const available = m.available || [];
    setModels(available);
    if (!selectedModel && m.current) setSelectedModel(m.current);
  }

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  async function onAsk(question, opts = {}) {
    if (!question.trim()) return;
    const { replaceIdx = null } = opts;
    setPending(true);

    // Build history from completed exchanges BEFORE this turn.
    // For regenerate: take everything before the assistant slot we're replacing.
    // For a fresh ask: take all messages so far.
    const cutoff = replaceIdx !== null ? replaceIdx - 1 : messages.length;
    const history = buildHistoryPayload(messages.slice(0, cutoff));

    // For regenerate: reset the existing assistant message in place (keep the
    // user message above it). For a fresh ask: append user + assistant placeholder.
    let assistantIdx;
    if (replaceIdx !== null) {
      assistantIdx = replaceIdx;
      setMessages((m) =>
        m.map((msg, i) =>
          i === assistantIdx
            ? { role: "assistant", answer: "", citations: [], confidence: null, streaming: true }
            : msg
        )
      );
    } else {
      setMessages((m) => [...m, { role: "user", text: question }]);
      setMessages((m) => {
        assistantIdx = m.length;
        return [
          ...m,
          { role: "assistant", answer: "", citations: [], confidence: null, streaming: true },
        ];
      });
    }

    const update = (patch) =>
      setMessages((m) => m.map((msg, i) => (i === assistantIdx ? { ...msg, ...patch } : msg)));
    const appendToken = (tok) =>
      setMessages((m) =>
        m.map((msg, i) => (i === assistantIdx ? { ...msg, answer: (msg.answer || "") + tok } : msg))
      );

    const t0 = Date.now();
    abortRef.current = new AbortController();
    try {
      await streamQuery(question, {
        model: selectedModel,
        history,
        signal: abortRef.current.signal,
        onPlan: (plan) => update({
          route: plan.route,
          rationale: plan.rationale,
          plannedSql: plan.sql_query,
          plannedDocsQuery: plan.docs_query,
          clarification: plan.clarification || "",
          clarification_options: plan.clarification_options || [],
          phase: "retrieving",
          steps: [{ kind: "plan", status: "done", t: Date.now() - t0 }],
        }),
        onStep: (step) =>
          setMessages((m) =>
            m.map((msg, i) => {
              if (i !== assistantIdx) return msg;
              const steps = msg.steps ? [...msg.steps] : [];
              steps.push({ ...step, t: Date.now() - t0 });
              return { ...msg, steps };
            })
          ),
        onMeta: (meta) => update({
          route: meta.route,
          rationale: meta.rationale,
          citations: meta.citations,
          evidence: meta.evidence,
          model_used: selectedModel,
          phase: "answering",
        }),
        onToken: (tok) => appendToken(tok),
        onDone: (done) => update({
          confidence: done.confidence,
          latency_ms: done.latency_ms,
          fast_path: done.fast_path,
          gated: done.gated,
          clarification_required: done.clarification_required,
          followups_pending: !!done.followups_pending,
          streaming: false,
          phase: "done",
        }),
        onFollowups: (data) => update({ followups: data.questions || [], followups_pending: false }),
        onError: (e) => update({ answer: `Error: ${e.message}`, confidence: "low", streaming: false, phase: "error" }),
      });
    } catch (e) {
      update({ answer: `Error: ${e.message}`, confidence: "low", streaming: false });
    } finally {
      // If the message is still marked as streaming, this was an abort — finalize it.
      setMessages((m) =>
        m.map((msg, i) =>
          i === assistantIdx && msg.streaming
            ? { ...msg, streaming: false, stopped: true, followups_pending: false, phase: "stopped" }
            : msg
        )
      );
      abortRef.current = null;
      setPending(false);
    }
  }

  async function onRegenerate(assistantIdx) {
    const userMsg = messages[assistantIdx - 1];
    if (!userMsg || userMsg.role !== "user") return;
    await onAsk(userMsg.text, { replaceIdx: assistantIdx });
  }

  async function onEditUserMessage(userIdx, newText) {
    if (!newText.trim()) return;
    const assistantIdx = userIdx + 1;
    // Update user message text in place, then regenerate the assistant answer.
    setMessages((m) =>
      m.map((msg, i) => (i === userIdx ? { ...msg, text: newText } : msg))
    );
    await onAsk(newText, { replaceIdx: assistantIdx });
  }

  async function onFeedback(assistantIdx, vote) {
    const msg = messages[assistantIdx];
    const userMsg = messages[assistantIdx - 1];
    if (!msg || !userMsg) return;
    // If they click the same vote again, treat it as a clear.
    const next = msg.vote === vote ? null : vote;
    setMessages((m) => m.map((x, i) => (i === assistantIdx ? { ...x, vote: next } : x)));
    if (next) {
      try {
        await postFeedback({ vote: next, question: userMsg.text, answer: msg.answer || "" });
      } catch {
        // Revert on failure.
        setMessages((m) => m.map((x, i) => (i === assistantIdx ? { ...x, vote: msg.vote || null } : x)));
      }
    }
  }

  return (
    <div className="app-shell">
      {/* Sidebar — fixed-drawer on mobile, inline on md+ */}
      <div
        className={`fixed inset-y-0 left-0 z-40 md:static md:translate-x-0 md:h-full md:flex transition-transform duration-200
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <Sidebar
          health={health}
          schema={schema}
          docs={docs}
          conversations={conversations}
          activeConversationId={activeId}
          onNewConversation={() => { onNewConversation(); setSidebarOpen(false); }}
          onSelectConversation={(id) => { onSelectConversation(id); setSidebarOpen(false); }}
          onRenameConversation={onRenameConversation}
          onDeleteConversation={onDeleteConversation}
        />
      </div>
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}
      <main className="flex-1 flex min-w-0">
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center justify-between pl-3 md:pl-6 pr-4 border-b border-slate-200 bg-white">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setSidebarOpen(true)}
                title="Menu"
                aria-label="Open menu"
                className="md:hidden w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <div className="avatar-ai w-6 h-6 rounded-lg !text-[9px]">AI</div>
              <div className="text-[13px] font-semibold text-ink tracking-tight leading-tight truncate">
                Grounded Assistant
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-[10.5px] text-slate-400 hidden md:block">
                Hybrid retrieval · on-prem LLM
              </div>
              <button
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                aria-label="Toggle theme"
                className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-ink hover:bg-slate-100 transition-colors"
              >
                {theme === "dark" ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                )}
              </button>
            </div>
          </header>
          <Chat
            messages={messages}
            pending={pending}
            onAsk={onAsk}
            onStop={onStop}
            onRegenerate={onRegenerate}
            onEditUserMessage={onEditUserMessage}
            onFeedback={onFeedback}
            onCiteClick={handleCiteClick}
            models={models}
            selectedModel={selectedModel}
            onSelectModel={setSelectedModel}
          />
        </div>
        <SourcePanel source={activeSource} onClose={() => setActiveSource(null)} onOpenPdf={openFullPdf} />
      </main>
      <PdfModal source={pdfModal} onClose={() => setPdfModal(null)} />
    </div>
  );
}
