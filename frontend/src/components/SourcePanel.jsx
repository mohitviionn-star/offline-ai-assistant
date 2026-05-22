import React from "react";

export default function SourcePanel({ source, onClose }) {
  if (!source) {
    return (
      <aside className="w-[28rem] shrink-0 bg-slate-50 border-l border-slate-200 hidden lg:flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 bg-white">
          <div className="text-sm font-semibold">Source viewer</div>
          <div className="text-xs text-slate-500">
            ⚙ SQL chips open here · 📄 PDF chips open the document viewer.
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-slate-400">
          Click a SQL chip to inspect the query and rows.
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[28rem] shrink-0 bg-white border-l border-slate-200 flex flex-col">
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">
            {source.type === "document" ? "Document evidence" : "Database evidence"}
          </div>
          <div className="text-xs text-slate-500 truncate">{source.label}</div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-sm">
          ✕
        </button>
      </div>

      {source.type === "document" ? <DocSource s={source} /> : <SqlSource s={source} />}
    </aside>
  );
}

function DocSource({ s }) {
  const pdfHref = s.filename ? `/api/documents/${encodeURIComponent(s.filename)}#page=${s.page}` : null;
  return (
    <div className="flex-1 overflow-auto">
      <div className="px-5 py-4 border-b border-slate-200 text-xs text-slate-500">
        File: <span className="font-mono text-slate-700">{s.filename}</span> · page {s.page}
      </div>
      <div className="px-5 py-4">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Matched snippet</div>
        <div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md p-3 whitespace-pre-wrap leading-relaxed">
          {s.snippet}
        </div>
        {pdfHref && (
          <a
            href={pdfHref}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-xs text-accent hover:underline"
          >
            Open PDF at page {s.page} →
          </a>
        )}
      </div>
    </div>
  );
}

function SqlSource({ s }) {
  return (
    <div className="flex-1 overflow-auto">
      <div className="px-5 py-4 border-b border-slate-200">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Executed SQL</div>
        <pre className="text-[12px] font-mono leading-snug text-slate-800 bg-slate-50 border border-slate-200 rounded-md p-3 whitespace-pre-wrap">
{s.sql}
        </pre>
        {s.rationale && (
          <div className="mt-2 text-xs text-slate-500 italic">{s.rationale}</div>
        )}
        {s.error && (
          <div className="mt-2 text-xs text-rose-600">Error: {s.error}</div>
        )}
      </div>
      <div className="px-5 py-4">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
          Rows ({s.row_count})
        </div>
        {s.rows_preview && s.rows_preview.length > 0 ? (
          <div className="overflow-auto border border-slate-200 rounded-md">
            <table className="text-xs w-full">
              <thead className="bg-slate-50">
                <tr>
                  {Object.keys(s.rows_preview[0]).map((k) => (
                    <th key={k} className="text-left px-3 py-2 font-semibold text-slate-600 border-b border-slate-200">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.rows_preview.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    {Object.values(row).map((v, j) => (
                      <td key={j} className="px-3 py-2 text-slate-700 font-mono">
                        {String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-slate-400">No rows returned.</div>
        )}
      </div>
    </div>
  );
}
