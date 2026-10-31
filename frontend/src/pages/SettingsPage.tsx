import { useState, useEffect } from 'react'
import { getOllamaStatus } from '../lib/api'
import type { OllamaStatus } from '../lib/types'

export default function SettingsPage() {
  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const checkStatus = () => {
    setLoading(true)
    getOllamaStatus()
      .then(st => {
        setStatus(st)
        setLoading(false)
      })
      .catch(() => {
        setStatus({
          running: false,
          model: 'gemma4:e4b',
          model_available: false,
          error: 'Connection to backend or Ollama failed.',
        })
        setLoading(false)
      })
  }

  useEffect(() => {
    checkStatus()
  }, [])

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      {/* ── Page header ───────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight mb-2">
          Settings
        </h1>
        <p className="text-gray-500 text-sm leading-relaxed max-w-lg">
          Configure local Gemma 4 model inference, repository indexing limits, and runtime parameters.
        </p>
      </div>

      <div className="space-y-6">
        {/* ── Local AI Model ──────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200/80 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Local AI Model (Ollama)
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                PaperTrail executes all claim extraction and evidence analysis locally.
              </p>
            </div>
            <button
              onClick={checkStatus}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg border border-gray-200 hover:border-gray-300 bg-gray-50 text-gray-700 text-xs font-semibold hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              {loading ? 'Checking…' : 'Test Connection'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-100">
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider block mb-1">
                Active Model
              </span>
              <span className="font-mono text-xs font-semibold text-gray-800">
                {status?.model || 'gemma4:e4b'}
              </span>
            </div>
            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-100">
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider block mb-1">
                Ollama Endpoint
              </span>
              <span className="font-mono text-xs font-semibold text-gray-800">
                http://localhost:11434
              </span>
            </div>
          </div>

          {/* Status banner */}
          {status && (
            <div
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-xs ${
                status.running && status.model_available
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  status.running && status.model_available
                    ? 'bg-emerald-500'
                    : 'bg-amber-500'
                }`}
              />
              <span className="font-medium">
                {status.running && status.model_available
                  ? 'Ollama service is active and model is loaded.'
                  : !status.running
                    ? 'Ollama service is not responding. Please run `ollama serve`.'
                    : `Model '${status.model}' is missing. Run \`ollama pull ${status.model}\`.`}
              </span>
            </div>
          )}
        </div>

        {/* ── Repository Ingestion Rules ──────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200/80 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">
            Repository Ingestion Rules
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Deterministic file prioritisation rules designed to capture core source code while avoiding bloat.
          </p>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-gray-600">Maximum files indexed per repository</span>
              <span className="font-mono font-semibold text-gray-800">120 files</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-gray-600">Python source file size cap</span>
              <span className="font-mono font-semibold text-gray-800">300 KB</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-gray-600">Documentation & Markdown size cap</span>
              <span className="font-mono font-semibold text-gray-800">40 KB</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-gray-600">Priority order</span>
              <span className="font-mono font-semibold text-gray-800 text-[11px]">
                .py &gt; .sh &gt; .yaml/.toml &gt; .json &gt; .txt &gt; .md
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-600">Citation validation</span>
              <span className="font-medium text-emerald-600">Authoritative file location (no model line numbers)</span>
            </div>
          </div>
        </div>

        {/* ── About ───────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200/80 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">
            About PaperTrail
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            PaperTrail bridges machine-learning research papers and open-source implementations
            with verifiable, grounded code evidence.
          </p>

          <div className="text-xs text-gray-600 space-y-2 leading-relaxed">
            <p>
              • <strong>Version:</strong> 1.1.0 (Hacktoberfest Edition)
            </p>
            <p>
              • <strong>Inference Engine:</strong> Gemma 4 running 100% locally through Ollama.
            </p>
            <p>
              • <strong>Strict Factuality:</strong> Line citations are validated directly against the git clone. Fabricated or hallucinated paths and line numbers are rejected.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
