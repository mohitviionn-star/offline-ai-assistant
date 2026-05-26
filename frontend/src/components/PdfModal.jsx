import React, { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDF_OPTIONS = {};

// Normalize text for matching: lowercase, strip non-alphanumeric to spaces,
// collapse whitespace. Same normalization for both the chunk and the PDF text items.
function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function PdfModal({ source, onClose }) {
  if (!source) return null;

  const fileUrl = `/api/documents/${encodeURIComponent(source.filename)}`;
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(source.page || 1);
  const [error, setError] = useState(null);
  const [matchCount, setMatchCount] = useState(0);
  const pageContainerRef = useRef(null);

  // Use the full chunk text if backend sent it, otherwise fall back to snippet.
  const chunkText = source.chunk_text || source.snippet || "";

  useEffect(() => {
    setPageNumber(source.page || 1);
    setError(null);
    setMatchCount(0);
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

  // Build the highlight predicate from the full chunk text once.
  // Strategy: take the normalized chunk as a string. For each pdf.js text item,
  // ask if a meaningful slice of it (>= 8 normalized chars) is a substring of
  // the normalized chunk. This catches multi-word segments without false-firing
  // on common single words.
  const isHit = useMemo(() => {
    const normChunk = norm(chunkText);
    if (normChunk.length < 12) return null;
    return (str) => {
      const n = norm(str);
      if (n.length < 6) return false;        // too short to be meaningful
      if (n.length <= 20) {
        // whole item must appear in chunk
        return normChunk.includes(n);
      }
      // for long items, accept if a substantial prefix appears
      return normChunk.includes(n.slice(0, Math.min(40, n.length)));
    };
  }, [chunkText]);

  // Track count of matches as we render, and after the page renders, scroll
  // the first match into view.
  const matchCountThisRender = useRef(0);
  const customTextRenderer = useMemo(() => {
    if (!isHit) return undefined;
    matchCountThisRender.current = 0;
    return ({ str }) => {
      if (isHit(str)) {
        matchCountThisRender.current += 1;
        const idx = matchCountThisRender.current;
        return `<mark class="pdf-cite-hit" data-cite-hit="${idx}">${escapeHtml(str)}</mark>`;
      }
      return escapeHtml(str);
    };
  }, [isHit]);

  // After the page renders, scroll to the first highlighted item.
  function onPageRenderSuccess() {
    setMatchCount(matchCountThisRender.current);
    requestAnimationFrame(() => {
      const first = pageContainerRef.current?.querySelector('mark[data-cite-hit="1"]');
      if (first) {
        first.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }

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
              {matchCount > 0 && (
                <>
                  {" · "}
                  <span className="text-amber-700 font-medium">
                    {matchCount} highlighted match{matchCount !== 1 ? "es" : ""}
                  </span>
                </>
              )}
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
            {pageNumber !== source.page && (
              <button
                className="ml-1 px-2 py-1 text-[11px] rounded bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200"
                onClick={() => setPageNumber(source.page)}
                aria-label="jump to cited page"
              >
                ↩ cited p.{source.page}
              </button>
            )}
            <button
              className="ml-3 px-2 py-1 text-sm rounded hover:bg-slate-100 text-slate-600"
              onClick={onClose}
              aria-label="close"
            >
              ✕
            </button>
          </div>
        </header>

        <div
          ref={pageContainerRef}
          className="flex-1 overflow-auto bg-slate-100 flex items-start justify-center p-6"
        >
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
                onRenderSuccess={onPageRenderSuccess}
                renderAnnotationLayer={false}
                className="shadow-md"
              />
            </Document>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 bg-slate-50">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-1">
            Cited chunk
          </div>
          <div className="text-[13px] text-slate-800 leading-snug max-h-24 overflow-auto">
            {source.snippet}
            {chunkText.length > (source.snippet?.length || 0) && <span className="text-slate-400">…</span>}
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
