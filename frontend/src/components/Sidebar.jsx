import React from "react";

export default function Sidebar({ health, schema, docs, uploadStatus, onUploadClick }) {
  return (
    <aside className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col">
      <div className="px-5 py-4 border-b border-slate-200">
        <div className="text-sm font-semibold">Workspace</div>
        <div className="mt-1 text-xs text-slate-500">Local · offline · grounded</div>
      </div>

      <div className="px-5 py-4 border-b border-slate-200">
        <button
          onClick={onUploadClick}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md
                     bg-accent text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Upload PDF
        </button>
        {uploadStatus && (
          <div className="mt-2 text-xs text-slate-600">{uploadStatus}</div>
        )}
      </div>

      <div className="px-5 py-4 border-b border-slate-200">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Documents ({docs.length})
        </div>
        <ul className="mt-2 space-y-1">
          {docs.length === 0 && (
            <li className="text-xs text-slate-400">No documents yet — upload a PDF.</li>
          )}
          {docs.map((d) => (
            <li key={d.doc_id} className="text-sm text-slate-700 truncate">
              {d.filename}{" "}
              <span className="text-xs text-slate-400">· {d.pages}p</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-5 py-4 border-b border-slate-200">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Database</div>
        <pre className="mt-2 text-[11px] font-mono leading-snug text-slate-600 whitespace-pre-wrap max-h-44 overflow-auto">
{schema || "(no schema)"}
        </pre>
      </div>

      <div className="mt-auto px-5 py-4 text-[11px] text-slate-500 space-y-1">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              health?.ollama_alive ? "bg-emerald-500" : "bg-rose-500"
            }`}
          />
          Ollama · {health?.ollama_model || "?"}
        </div>
        <div className="text-slate-400 break-all">Qdrant: {health?.qdrant_url}</div>
      </div>
    </aside>
  );
}
