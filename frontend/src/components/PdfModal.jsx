import React, { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDF_OPTIONS = {};

/**
 * Find the chunk's actual byte range within the concatenated page text.
 * Both strings are "packed" (lowercased, whitespace stripped) so that small
 * whitespace differences between the cited chunk (extracted by pypdf) and the
 * page text (extracted by pdf.js) don't break matching.
 *
 * Returns { start, end } in ORIGINAL pageText character coordinates, or null
 * if no good match exists.
 */
function locateChunkInPage(pageText, chunkText) {
  if (!pageText || !chunkText) return null;

  const packed = (s) => s.toLowerCase().replace(/\s+/g, "");
  const pageP = packed(pageText);
  const chunkP = packed(chunkText);
  if (chunkP.length < 20) return null;

  // Position map: index in pageP → index in pageText
  const map = new Array(pageP.length);
  let pi = 0;
  for (let i = 0; i < pageText.length; i++) {
    if (!/\s/.test(pageText[i])) {
      map[pi++] = i;
    }
  }

  // Try the full chunk first, then back off to shorter prefixes if not found.
  // Stops at 30 chars — anything shorter would be too fragile.
  for (let len = chunkP.length; len >= 30; len = Math.max(30, len - 20)) {
    const probe = chunkP.slice(0, len);
    const idx = pageP.indexOf(probe);
    if (idx >= 0) {
      const start = map[idx];
      const lastIdx = idx + len - 1;
      const end = (map[lastIdx] ?? map[map.length - 1]) + 1;
      return { start, end, matchedLen: len };
    }
    if (len === 30) break;
  }
  return null;
}

export default function PdfModal({ source, onClose }) {
  if (!source) return null;

  const fileUrl = `/api/documents/${encodeURIComponent(source.filename)}`;
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(source.page || 1);
  const [error, setError] = useState(null);
  const [hitIndices, setHitIndices] = useState(null);
  const [matchInfo, setMatchInfo] = useState(null); // { count, matchedLen, chunkLen }
  const pageContainerRef = useRef(null);

  const chunkText = source.chunk_text || source.snippet || "";

  useEffect(() => {
    setPageNumber(source.page || 1);
    setError(null);
    setHitIndices(null);
    setMatchInfo(null);
  }, [source]);

  // Reset when navigating pages so the new page recomputes its own hits.
  useEffect(() => {
    setHitIndices(null);
    setMatchInfo(null);
  }, [pageNumber]);

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

  // Called by react-pdf when the page's text content is loaded.
  // We compute the chunk's location in the page text, then derive the set of
  // text-item indices that fall inside that location.
  function onGetTextSuccess(textContent) {
    const items = textContent?.items || [];
    if (items.length === 0) {
      setHitIndices(new Set());
      setMatchInfo(null);
      return;
    }

    // Concatenate item strings with single-space separators (matches the visual
    // reading order). Track each item's [start, end) byte range in pageText.
    let pageText = "";
    const ranges = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      const s = items[i].str || "";
      const start = pageText.length;
      pageText += s;
      ranges[i] = [start, pageText.length];
      pageText += " ";
    }

    const loc = locateChunkInPage(pageText, chunkText);
    if (!loc) {
      setHitIndices(new Set());
      setMatchInfo({ count: 0, matchedLen: 0, chunkLen: chunkText.length });
      return;
    }

    // Any item whose range overlaps [loc.start, loc.end) is part of the chunk.
    const hits = new Set();
    for (let i = 0; i < ranges.length; i++) {
      const [s, e] = ranges[i];
      if (s < loc.end && e > loc.start) hits.add(i);
    }
    setHitIndices(hits);
    setMatchInfo({ count: hits.size, matchedLen: loc.matchedLen, chunkLen: chunkText.length });
  }

  const customTextRenderer = useMemo(() => {
    if (!hitIndices) return undefined;
    return ({ str, itemIndex }) => {
      if (hitIndices.has(itemIndex)) {
        // Mark the first hit specially so the auto-scroll target is distinct.
        const isFirst = itemIndex === Math.min(...hitIndices);
        const attr = isFirst ? ' data-cite-hit="1"' : "";
        return `<mark class="pdf-cite-hit"${attr}>${escapeHtml(str)}</mark>`;
      }
      return escapeHtml(str);
    };
  }, [hitIndices]);

  // After the page renders, scroll the first highlighted item into view.
  function onPageRenderSuccess() {
    requestAnimationFrame(() => {
      const first = pageContainerRef.current?.querySelector('mark[data-cite-hit="1"]');
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
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
              {matchInfo?.count > 0 ? (
                <>
                  {" · "}
                  <span className="text-amber-700 font-medium">
                    chunk found ({matchInfo.matchedLen}/{matchInfo.chunkLen} chars matched)
                  </span>
                </>
              ) : matchInfo?.count === 0 ? (
                <>
                  {" · "}
                  <span className="text-slate-500">chunk not located on this page</span>
                </>
              ) : null}
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
                onGetTextSuccess={onGetTextSuccess}
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
