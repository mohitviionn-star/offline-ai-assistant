import React, { useEffect, useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDF_OPTIONS = {
  // pdf.js options can go here if needed
};

export default function PdfModal({ source, onClose }) {
  if (!source) return null;

  const fileUrl = `/api/documents/${encodeURIComponent(source.filename)}`;
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(source.page || 1);
  const [error, setError] = useState(null);

  useEffect(() => {
    setPageNumber(source.page || 1);
    setError(null);
  }, [source]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setPageNumber((p) => Math.max(1, p - 1));
      else if (e.key === "ArrowRight")
        setPageNumber((p) => Math.min(numPages || p, p + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [numPages, onClose]);

  // Build a normalized list of phrases from the snippet for highlighting
  const highlightPhrases = useMemo(() => {
    const snippet = (source.snippet || "").trim();
    if (!snippet) return [];
    // Pick a handful of distinctive multi-word phrases (4-10 words) from the snippet.
    // pdf.js text-layer items are broken on spaces, so highlight at the phrase level
    // by matching each text item that appears in any phrase.
    const cleaned = snippet
      .replace(/\s+/g, " ")
      .replace(/[\(\)\[\]"']/g, "");
    const words = cleaned.split(" ").filter((w) => w.length > 0);
    const phrases = [];
    for (let i = 0; i < words.length; i += 5) {
      const slice = words.slice(i, i + 7).join(" ");
      if (slice.length >= 12) phrases.push(slice.toLowerCase());
    }
    return phrases;
  }, [source.snippet]);

  const customTextRenderer = useMemo(() => {
    if (!highlightPhrases.length) return undefined;
    return ({ str }) => {
      const lower = str.toLowerCase();
      const hit = highlightPhrases.some(
        (p) => p.includes(lower.trim()) && lower.trim().length >= 3
      );
      if (hit) {
        return `<mark class="pdf-cite-hit">${escapeHtml(str)}</mark>`;
      }
      return escapeHtml(str);
    };
  }, [highlightPhrases]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-stretch"
      onClick={onClose}
    >
      <div
        className="m-auto bg-white shadow-2xl rounded-lg w-[min(960px,92vw)] max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="h-12 px-5 flex items-center justify-between border-b border-slate-200">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{source.filename}</div>
            <div className="text-xs text-slate-500">
              page {pageNumber}
              {numPages ? ` of ${numPages}` : ""} · cited p.{source.page}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-1 text-sm rounded hover:bg-slate-100 disabled:opacity-30"
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              disabled={pageNumber <= 1}
              aria-label="previous page"
            >
              ◀
            </button>
            <button
              className="px-2 py-1 text-sm rounded hover:bg-slate-100 disabled:opacity-30"
              onClick={() =>
                setPageNumber((p) => Math.min(numPages || p, p + 1))
              }
              disabled={!!numPages && pageNumber >= numPages}
              aria-label="next page"
            >
              ▶
            </button>
            <button
              className="ml-3 px-2 py-1 text-sm rounded hover:bg-slate-100 text-slate-600"
              onClick={onClose}
              aria-label="close"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto bg-slate-100 flex items-start justify-center p-6">
          {error ? (
            <div className="text-sm text-rose-600 mt-12">Failed to load PDF: {error}</div>
          ) : (
            <Document
              file={fileUrl}
              onLoadSuccess={({ numPages }) => setNumPages(numPages)}
              onLoadError={(e) => setError(e?.message || "unknown")}
              loading={<div className="mt-12 text-sm text-slate-500">Loading PDF…</div>}
              options={PDF_OPTIONS}
            >
              <Page
                pageNumber={pageNumber}
                width={Math.min(820, window.innerWidth * 0.85)}
                customTextRenderer={customTextRenderer}
                renderAnnotationLayer={false}
                className="shadow-md"
              />
            </Document>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 bg-slate-50">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
            Matched snippet
          </div>
          <div className="text-sm text-slate-800 leading-snug max-h-24 overflow-auto">
            {source.snippet}
          </div>
        </footer>
      </div>
    </div>
  );
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
