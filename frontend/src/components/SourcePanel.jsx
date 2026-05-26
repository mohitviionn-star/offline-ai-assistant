import React from "react";

export default function SourcePanel({ source, onClose, onOpenPdf }) {
  if (!source) {
    return (
      <aside className="w-[28rem] shrink-0 bg-slate-50 border-l border-slate-200 hidden lg:flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 bg-white">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            Evidence
          </div>
          <div className="mt-1 text-[13px] text-slate-600 leading-snug">
            Click any citation in the answer to inspect the underlying evidence.
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-center text-[12px] text-slate-400">
          No citation selected.
        </div>
      </aside>
    );
  }

  const isDoc = source.type === "document";

  return (
    <aside className="w-[28rem] shrink-0 bg-white border-l border-slate-200 flex flex-col">
      <header className="px-5 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {isDoc ? "Document evidence" : "Database evidence"}
          </div>
          <div className="mt-0.5 text-[13px] font-medium text-ink truncate">{source.label}</div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-ink text-sm shrink-0"
          aria-label="close"
        >
          ✕
        </button>
      </header>

      {isDoc ? <DocSource s={source} onOpenPdf={onOpenPdf} /> : <SqlSource s={source} />}
    </aside>
  );
}

function DocSource({ s, onOpenPdf }) {
  return (
    <div className="flex-1 overflow-auto">
      <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-2 text-[11px]">
        <div className="text-slate-500">
          File · <span className="font-mono text-slate-700">{s.filename}</span> · page {s.page}
        </div>
        <button
          onClick={() => onOpenPdf?.(s)}
          className="px-2.5 py-1 text-[11px] rounded border border-slate-300 bg-white text-ink
                     hover:border-ink hover:bg-slate-50 font-medium transition-colors"
        >
          Open full PDF →
        </button>
      </div>
      <div className="px-5 py-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">
          Cited passage
        </div>
        <blockquote className="text-[13px] text-slate-800 leading-relaxed border-l-2 border-indigo-200 pl-3 whitespace-pre-wrap">
          {s.chunk_text || s.snippet || "(no text available)"}
        </blockquote>
      </div>
    </div>
  );
}

function SqlSource({ s }) {
  const rows = s.rows_preview || [];
  const cols = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-5 py-4 border-b border-slate-200">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">
          Executed query
        </div>
        <pre className="text-[11.5px] font-mono leading-snug text-slate-800 bg-slate-50 border border-slate-200 rounded-md p-3 whitespace-pre-wrap break-words">
{s.sql}
        </pre>
        {s.rationale && (
          <div className="mt-2 text-[11.5px] text-slate-600 italic leading-snug">
            {s.rationale}
          </div>
        )}
        {s.error && (
          <div className="mt-3 border border-rose-200 bg-rose-50 rounded-md px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-700 mb-1">
              SQL error
            </div>
            <div className="text-[12px] text-rose-800 font-mono leading-snug whitespace-pre-wrap">
              {s.error}
            </div>
          </div>
        )}
      </div>
      <div className="px-5 py-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">
          Result rows {typeof s.row_count === "number" ? `(${s.row_count})` : ""}
        </div>
        {rows.length > 0 ? (
          <div className="overflow-auto border border-slate-200 rounded-md">
            <table className="text-[11.5px] w-full">
              <thead className="bg-slate-50">
                <tr>
                  {cols.map((k) => (
                    <th
                      key={k}
                      className="text-left px-3 py-2 font-semibold text-slate-700 border-b border-slate-200 whitespace-nowrap"
                    >
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    {cols.map((k) => (
                      <td key={k} className="px-3 py-2 text-slate-800 font-mono whitespace-nowrap">
                        {row[k] === null || row[k] === undefined ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          String(row[k])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-[12px] text-slate-400 italic">No rows returned.</div>
        )}
      </div>
    </div>
  );
}
