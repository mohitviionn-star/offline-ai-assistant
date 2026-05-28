import React, { useEffect, useRef, useState } from "react";
import { getHealth, getSchema, ingestPdf, listDocuments, listModels, postQuery, streamQuery } from "./api";
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
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);  // null = backend default
  const fileRef = useRef(null);
  const abortRef = useRef(null);

  function onStop() {
    abortRef.current?.abort();
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

    const t0 = Date.now();
    abortRef.current = new AbortController();
    try {
      await streamQuery(question, {
        model: selectedModel,
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
    <div className="app-shell">
      <Sidebar
        health={health}
        schema={schema}
        docs={docs}
        uploadStatus={uploadStatus}
        onUploadClick={() => fileRef.current?.click()}
      />
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onFile} />
      <main className="flex-1 flex min-w-0">
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center justify-between pl-6 pr-4 border-b border-slate-200 bg-white">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="avatar-ai w-6 h-6 rounded-lg !text-[9px]">AI</div>
              <div className="text-[13px] font-semibold text-ink tracking-tight leading-tight">
                Grounded Assistant
              </div>
            </div>
            <div className="text-[10.5px] text-slate-400 hidden md:block">
              Hybrid retrieval · on-prem LLM
            </div>
          </header>
          <Chat
            messages={messages}
            pending={pending}
            onAsk={onAsk}
            onStop={onStop}
            onCiteClick={handleCiteClick}
            models={models}
            selectedModel={selectedModel}
            onSelectModel={setSelectedModel}
            onUploadClick={() => fileRef.current?.click()}
            uploadStatus={uploadStatus}
          />
        </div>
        <SourcePanel source={activeSource} onClose={() => setActiveSource(null)} onOpenPdf={openFullPdf} />
      </main>
      <PdfModal source={pdfModal} onClose={() => setPdfModal(null)} />
    </div>
  );
}
