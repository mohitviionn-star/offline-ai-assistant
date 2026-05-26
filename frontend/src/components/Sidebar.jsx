import React, { useMemo, useState } from "react";

// Map filename → vertical so the doc list can group them. Patterns first, then
// any unmatched doc falls into "Other".
const VERTICAL_RULES = [
  { name: "Nursing Home",  test: (f) => /fall-|insulin|rehab|wound|tenant_handbook|resident/i.test(f) || /hipaa|nist-800/.test(f) },
  { name: "Legal",         test: (f) => /custody|mediation|injury|settlement|alimony|case-strategy/i.test(f) },
  { name: "Real Estate",   test: (f) => /landlord|tenant|ohio|lease|property|investment/i.test(f) },
];

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

export default function Sidebar({ health, schema, docs, uploadStatus, onUploadClick }) {
  const [schemaOpen, setSchemaOpen] = useState(false);

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
    <aside className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col">
      {/* Workspace meta */}
      <div className="px-5 py-4 border-b border-slate-200">
        <div className="eyebrow">Workspace</div>
        <div className="mt-1 text-sm font-semibold text-ink leading-tight">Demo environment</div>
        <div className="mt-0.5 text-[11px] text-slate-500">Local · offline · grounded</div>
      </div>

      {/* Add document */}
      <div className="px-5 py-4 border-b border-slate-200">
        <button
          onClick={onUploadClick}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md
                     bg-ink text-white text-xs font-semibold tracking-wide
                     hover:bg-brand-800 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          Add document
        </button>
        {uploadStatus && (
          <div className="mt-2 text-[11px] text-slate-600 leading-snug">{uploadStatus}</div>
        )}
      </div>

      {/* Documents — grouped by vertical */}
      <div className="px-5 py-4 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div className="eyebrow">Documents</div>
          <div className="text-[11px] text-slate-500 tabular-nums">{docs.length}</div>
        </div>
        {grouped.length === 0 ? (
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
        )}
      </div>

      {/* Schema preview */}
      <div className="px-5 py-4 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div className="eyebrow">Database</div>
          <div className="text-[11px] text-slate-500 tabular-nums">{tables.length} tables</div>
        </div>
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
      </div>

      {/* Status footer */}
      <div className="mt-auto px-5 py-4 text-[11px] space-y-1.5 bg-slate-50 border-t border-slate-200">
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
