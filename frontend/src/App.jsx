import React, { useEffect, useRef, useState } from "react";
import { getHealth, getSchema, ingestPdf, listDocuments, postQuery, streamQuery } from "./api";
import Chat from "./components/Chat.jsx";
import PdfModal from "./components/PdfModal.jsx";
import Sidebar from "./components/Sidebar.jsx";
import SourcePanel from "./components/SourcePanel.jsx";

export default function App() {
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(false);
  const [health, setHealth] = useState(null);
  const [schema, setSchema] = useState("");
  const [docs, setDocs] = useState([]);
  const [activeSource, setActiveSource] = useState(null);
  const [pdfModal, setPdfModal] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const fileRef = useRef(null);

  function handleCiteClick(c) {
    if (c?.type === "document") setPdfModal(c);
    else setActiveSource(c);
  }

  async function refresh() {
    const [h, s, d] = await Promise.all([getHealth(), getSchema(), listDocuments()]);
    setHealth(h);
    setSchema(s.schema || "");
    setDocs(d.documents || []);
  }

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  async function onAsk(question) {
    if (!question.trim()) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setPending(true);

    // Add a placeholder assistant message that we'll mutate as tokens stream in.
    let assistantIdx;
    setMessages((m) => {
      assistantIdx = m.length;
      return [
        ...m,
        { role: "assistant", answer: "", citations: [], confidence: null, streaming: true },
      ];
    });

    const update = (patch) =>
      setMessages((m) => m.map((msg, i) => (i === assistantIdx ? { ...msg, ...patch } : msg)));
    const appendToken = (tok) =>
      setMessages((m) =>
        m.map((msg, i) => (i === assistantIdx ? { ...msg, answer: (msg.answer || "") + tok } : msg))
      );

    try {
      await streamQuery(question, {
        onMeta: (meta) => update({ route: meta.route, rationale: meta.rationale, citations: meta.citations, evidence: meta.evidence }),
        onToken: (tok) => appendToken(tok),
        onDone: (done) => update({ confidence: done.confidence, latency_ms: done.latency_ms, fast_path: done.fast_path, gated: done.gated, streaming: false }),
        onError: (e) => update({ answer: `Error: ${e.message}`, confidence: "low", streaming: false }),
      });
    } catch (e) {
      update({ answer: `Error: ${e.message}`, confidence: "low", streaming: false });
    } finally {
      setPending(false);
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus(`Ingesting ${file.name}…`);
    try {
      const res = await ingestPdf(file);
      setUploadStatus(`Ingested ${res.filename} (${res.chunks} chunks, ${res.pages} pages)`);
      await refresh();
    } catch (err) {
      setUploadStatus(`Upload failed: ${err.message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      setTimeout(() => setUploadStatus(null), 4000);
    }
  }

  return (
    <div className="h-full flex">
      <Sidebar
        health={health}
        schema={schema}
        docs={docs}
        uploadStatus={uploadStatus}
        onUploadClick={() => fileRef.current?.click()}
      />
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onFile} />
      <main className="flex-1 flex min-w-0">
        <div className="flex-1 flex flex-col min-w-0 border-r border-slate-200">
          <header className="h-14 flex items-center px-6 border-b border-slate-200 bg-white">
            <h1 className="text-base font-semibold tracking-tight">
              Offline AI Assistant
              <span className="ml-2 text-xs font-normal text-slate-500">
                hybrid retrieval · grounded citations · local LLM
              </span>
            </h1>
          </header>
          <Chat
            messages={messages}
            pending={pending}
            onAsk={onAsk}
            onCiteClick={handleCiteClick}
          />
        </div>
        <SourcePanel source={activeSource} onClose={() => setActiveSource(null)} />
      </main>
      <PdfModal source={pdfModal} onClose={() => setPdfModal(null)} />
    </div>
  );
}
