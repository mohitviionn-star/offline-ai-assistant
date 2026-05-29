import React, { useEffect, useMemo, useRef, useState } from "react";

// Map filename → vertical so the doc list can group them. Patterns first, then
// any unmatched doc falls into "Other".
const VERTICAL_RULES = [
  { name: "Nursing Home",  test: (f) => /fall-|insulin|rehab|wound|tenant_handbook|resident/i.test(f) || /hipaa|nist-800/.test(f) },
  { name: "Legal",         test: (f) => /custody|mediation|injury|settlement|alimony|case-strategy/i.test(f) },
  { name: "Real Estate",   test: (f) => /landlord|tenant|ohio|lease|property|investment/i.test(f) },
];

function useStickyBool(key, defaultValue) {
  const [v, setV] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return defaultValue;
      return stored === "1";
    } catch {
      return defaultValue;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, v ? "1" : "0"); } catch {}
  }, [key, v]);
  return [v, setV];
}

function verticalFor(filename = "") {
  for (const r of VERTICAL_RULES) {
    if (r.test(filename)) return r.name;
  }
  return "Other";
}

function parseSchema(schemaText = "") {
  // Returns an array of table names from the schema dump.
  const lines = schemaText.split("\n");
  const tables = [];
  for (const line of lines) {
    const m = line.match(/^TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
    if (m) tables.push(m[1]);
  }
  return tables;
}

export default function Sidebar({
  health,
  schema,
  docs,
  conversations = [],
  activeConversationId,
  onNewConversation,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
}) {
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [docsSectionOpen, setDocsSectionOpen] = useStickyBool("sidebar:docs-open", false);
  const [dbSectionOpen, setDbSectionOpen] = useStickyBool("sidebar:db-open", false);

  const grouped = useMemo(() => {
    const g = {};
    for (const d of docs) {
      const v = verticalFor(d.filename);
      (g[v] = g[v] || []).push(d);
    }
    // Stable order: Nursing Home, Legal, Real Estate, then Other
    const order = ["Nursing Home", "Legal", "Real Estate", "Other"];
    return order.filter((k) => g[k]).map((k) => [k, g[k]]);
  }, [docs]);

  const tables = useMemo(() => parseSchema(schema), [schema]);

  return (
    <aside className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col min-h-0">
      {/* Conversations — primary nav, grows to take available space */}
      <ConversationsList
        conversations={conversations}
        activeId={activeConversationId}
        onNew={onNewConversation}
        onSelect={onSelectConversation}
        onRename={onRenameConversation}
        onDelete={onDeleteConversation}
      />

      {/* Secondary context (workspace, docs, db). Sits at natural size below
          Conversations. Conversations gets any extra vertical space. */}
      <div className="shrink-0">
        {/* Workspace meta */}
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="eyebrow">Workspace</div>
          <div className="mt-1 text-sm font-semibold text-ink leading-tight">Demo environment</div>
          <div className="mt-0.5 text-[11px] text-slate-500">Local · offline · grounded</div>
        </div>

      {/* Documents — collapsible */}
      <div className="px-5 py-4 border-b border-slate-200">
        <button
          onClick={() => setDocsSectionOpen((s) => !s)}
          className="w-full flex items-center justify-between gap-2 text-left"
          aria-expanded={docsSectionOpen}
        >
          <span className="flex items-center gap-1.5">
            <Chevron open={docsSectionOpen} />
            <span className="eyebrow">Documents</span>
          </span>
          <span className="text-[11px] text-slate-500 tabular-nums">{docs.length}</span>
        </button>
        {docsSectionOpen && (grouped.length === 0 ? (
          <div className="mt-2 text-[11px] text-slate-400">No documents yet — add a PDF.</div>
        ) : (
          <div className="mt-3 space-y-3">
            {grouped.map(([vertical, items]) => (
              <div key={vertical}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                  {vertical}
                </div>
                <ul className="space-y-0.5">
                  {items.map((d) => (
                    <li key={d.doc_id} className="flex items-baseline justify-between gap-2 text-[12px] text-slate-700">
                      <span className="truncate">{d.filename}</span>
                      <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">{d.pages}p</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Database — collapsible */}
      <div className="px-5 py-4 border-b border-slate-200">
        <button
          onClick={() => setDbSectionOpen((s) => !s)}
          className="w-full flex items-center justify-between gap-2 text-left"
          aria-expanded={dbSectionOpen}
        >
          <span className="flex items-center gap-1.5">
            <Chevron open={dbSectionOpen} />
            <span className="eyebrow">Database</span>
          </span>
          <span className="text-[11px] text-slate-500 tabular-nums">{tables.length} tables</span>
        </button>
        {dbSectionOpen && (
          <>
            {tables.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {tables.map((t) => (
                  <span
                    key={t}
                    className="px-1.5 py-0.5 rounded text-[10.5px] font-mono bg-slate-100 text-slate-700 border border-slate-200"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            <button
              onClick={() => setSchemaOpen((s) => !s)}
              className="mt-2 text-[11px] text-slate-500 hover:text-ink"
            >
              {schemaOpen ? "Hide" : "View"} full schema
            </button>
            {schemaOpen && (
              <pre className="mt-2 text-[10.5px] font-mono leading-snug text-slate-600 whitespace-pre-wrap max-h-44 overflow-auto border-t border-slate-100 pt-2">
                {schema || "(no schema)"}
              </pre>
            )}
          </>
        )}
      </div>
      </div>{/* end scrollable middle */}

      {/* Status footer (pinned at bottom) */}
      <div className="px-5 py-4 text-[11px] space-y-1.5 bg-slate-50 border-t border-slate-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                health?.ollama_alive ? "bg-good" : "bg-bad"
              }`}
            />
            <span className="text-slate-700 font-medium">LLM</span>
          </div>
          <span className="text-slate-500 font-mono text-[10.5px]">{health?.ollama_model || "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-good" />
            <span className="text-slate-700 font-medium">Vector store</span>
          </div>
          <span className="text-slate-500 font-mono text-[10.5px]">Qdrant</span>
        </div>
      </div>
    </aside>
  );
}

function Chevron({ open }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ConversationsList({ conversations, activeId, onNew, onSelect, onRename, onDelete }) {
  // Sort by recent activity, newest first.
  const ordered = useMemo(() => {
    return [...conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [conversations]);

  return (
    <div className="flex-1 min-h-0 flex flex-col px-5 py-4 border-b border-slate-200">
      <div className="flex items-center justify-between shrink-0">
        <div className="eyebrow">Conversations</div>
        <button
          onClick={onNew}
          title="New conversation"
          aria-label="New conversation"
          className="w-5 h-5 rounded-md inline-flex items-center justify-center text-slate-500
                     hover:text-ink hover:bg-slate-100 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <ul className="mt-2 space-y-0.5 flex-1 overflow-y-auto pr-1 min-h-0">
        {ordered.length === 0 ? (
          <li className="text-[11px] text-slate-400 px-1.5 py-1">No conversations yet.</li>
        ) : (
          ordered.map((c) => (
            <ConversationItem
              key={c.id}
              conv={c}
              isActive={c.id === activeId}
              onSelect={() => onSelect?.(c.id)}
              onRename={(t) => onRename?.(c.id, t)}
              onDelete={() => {
                if (window.confirm("Delete this conversation? It can't be undone.")) {
                  onDelete?.(c.id);
                }
              }}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function ConversationItem({ conv, isActive, onSelect, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conv.title || "");
  const inputRef = useRef(null);
  const isEmpty = !conv.messages || conv.messages.length === 0;
  const displayTitle = conv.title || (isEmpty ? "New conversation" : "Untitled");

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEdit(e) {
    e?.stopPropagation();
    setDraft(conv.title || "");
    setEditing(true);
  }

  function commit() {
    const t = draft.trim();
    if (t && t !== conv.title) onRename?.(t);
    setEditing(false);
  }

  function onKeyDown(e) {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
  }

  return (
    <li
      className={`group flex items-center gap-1 px-1.5 py-1 rounded-md transition-colors cursor-pointer
        ${isActive ? "bg-slate-100" : "hover:bg-slate-50"}`}
      onClick={editing ? undefined : onSelect}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 text-[12px] text-ink bg-white border border-slate-300 rounded px-1.5 py-0.5 outline-none focus:border-slate-500"
          placeholder="Conversation title"
        />
      ) : (
        <span
          className={`flex-1 min-w-0 truncate text-[12px] ${isActive ? "text-ink font-medium" : "text-slate-700"}`}
          title={displayTitle}
          onDoubleClick={startEdit}
        >
          {displayTitle}
        </span>
      )}
      {!editing && (
        <span className="hidden group-hover:inline-flex items-center gap-0.5">
          <button
            onClick={startEdit}
            title="Rename"
            aria-label="Rename conversation"
            className="w-5 h-5 inline-flex items-center justify-center rounded text-slate-400 hover:text-ink hover:bg-white"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
            title="Delete"
            aria-label="Delete conversation"
            className="w-5 h-5 inline-flex items-center justify-center rounded text-slate-400 hover:text-red-600 hover:bg-white"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </span>
      )}
    </li>
  );
}
