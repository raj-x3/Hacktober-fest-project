import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { submitAnalysis, pollJob, getReport, saveRecentAnalysis, getOllamaStatus } from '../lib/api'
import { isValidGitHubRepoUrl } from '../lib/github'
import type { JobStatus } from '../lib/api'
import type { AnalysisStage, OllamaStatus } from '../lib/types'

const STAGES_META: Omit<AnalysisStage, 'status'>[] = [
  { id: 'claims',  label: 'Extracting research claims',        detail: 'Parsing PDF and identifying experimental claims with Gemma…' },
  { id: 'clone',   label: 'Cloning repository',                detail: 'Fetching repository files and commit history from GitHub…' },
  { id: 'index',   label: 'Indexing source files',             detail: 'Prioritising Python modules, configs and training scripts…' },
  { id: 'connect', label: 'Connecting claims to evidence',     detail: 'Asking Gemma 4 to locate verified code evidence for each claim…' },
  { id: 'report',  label: 'Generating the report',            detail: 'Validating snippet line citations and structuring report…' },
]

const POLL_INTERVAL = 1800 // ms

export default function AnalysisPage() {
  const [pdf, setPdf] = useState<File | null>(null)
  const [repoUrl, setRepoUrl] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [stages, setStages] = useState<AnalysisStage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [latestLog, setLatestLog] = useState<string | null>(null)
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [checkingOllama, setCheckingOllama] = useState(true)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const navigate = useNavigate()

  // Check Ollama health on mount
  useEffect(() => {
    let mounted = true
    getOllamaStatus()
      .then(st => {
        if (mounted) {
          setOllamaStatus(st)
          setCheckingOllama(false)
        }
      })
      .catch(() => {
        if (mounted) {
          setOllamaStatus({
            running: false,
            model: 'gemma4:e4b',
            model_available: false,
            error: 'Could not connect to backend/Ollama.',
          })
          setCheckingOllama(false)
        }
      })
    return () => { mounted = false }
  }, [])

  // Clear polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const initStages = useCallback((): AnalysisStage[] =>
    STAGES_META.map((s, i) => ({ ...s, status: i === 0 ? 'running' : 'pending' })), [])

  const applyJobStatus = useCallback((js: JobStatus): AnalysisStage[] =>
    STAGES_META.map((s, i) => ({
      ...s,
      status: i < js.stage_index ? 'done'
        : i === js.stage_index ? (js.error ? 'error' : 'running')
        : 'pending',
    })), [])

  const handleFile = useCallback((file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please upload a PDF file.')
      return
    }
    if (file.size <= 0) {
      setError('The selected PDF file is empty.')
      return
    }
    setError(null)
    setPdf(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const handleSubmit = useCallback(async () => {
    if (!pdf) { setError('Please upload a research paper (PDF).'); return }
    if (!repoUrl.trim()) { setError('Please enter a GitHub repository URL.'); return }
    if (!isValidGitHubRepoUrl(repoUrl.trim())) {
      setError('Please enter a valid public GitHub repository URL (e.g. https://github.com/owner/repo).')
      return
    }

    setError(null)
    setSubmitting(true)
    setLatestLog('Starting analysis pipeline…')
    setStages(initStages())

    try {
      const { job_id } = await submitAnalysis(pdf, repoUrl.trim())

      // Poll for progress
      pollRef.current = setInterval(async () => {
        try {
          const js = await pollJob(job_id)
          setStages(applyJobStatus(js))

          if (js.log && js.log.length > 0) {
            // Find most recent meaningful log message
            const useful = js.log.filter(l => !l.startsWith('DEBUG') && !l.includes('Traceback'))
            if (useful.length > 0) {
              setLatestLog(useful[useful.length - 1])
            }
          }

          if (js.done || js.error) {
            clearInterval(pollRef.current!)
            if (js.error) {
              setError(js.error)
              setSubmitting(false)
              return
            }
            // Fetch report and navigate
            const report = await getReport(job_id)
            saveRecentAnalysis({
              id: job_id,
              title: report.paper_title,
              repo: repoUrl.trim(),
              date: new Date().toISOString(),
            })
            navigate(`/app/results/${job_id}`, { state: { report } })
          }
        } catch (e: unknown) {
          clearInterval(pollRef.current!)
          setError(e instanceof Error ? e.message : 'Polling failed.')
          setSubmitting(false)
        }
      }, POLL_INTERVAL)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start analysis.')
      setSubmitting(false)
      setStages([])
    }
  }, [pdf, repoUrl, navigate, initStages, applyJobStatus])

  const isRunning = submitting && stages.length > 0

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      {/* ── Page header ─────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight mb-2">
          Analyse Research with Evidence
        </h1>
        <p className="text-gray-500 text-sm leading-relaxed max-w-lg">
          Connect a research paper with its GitHub implementation to trace experimental
          claims to their source-code evidence.
        </p>
      </div>

      <AnimatePresence mode="wait">
        {!isRunning ? (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          >
            {/* ── Ollama status indicator ────────────────────── */}
            {!checkingOllama && ollamaStatus && (
              ollamaStatus.running && ollamaStatus.model_available ? (
                <div className="flex items-center justify-between px-3.5 py-2 mb-5 rounded-lg bg-emerald-50 border border-emerald-200/60 text-xs text-emerald-800">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="font-medium">Ollama & {ollamaStatus.model} online</span>
                  </div>
                  <span className="text-[11px] text-emerald-600 font-mono">Local inference ready</span>
                </div>
              ) : (
                <div className="p-3.5 mb-5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <div className="flex items-start gap-2.5">
                    <svg className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <p className="font-semibold text-amber-800">
                        {!ollamaStatus.running ? 'Local Ollama is not running' : `Model ${ollamaStatus.model} not found`}
                      </p>
                      <p className="mt-0.5 text-amber-700 leading-relaxed">
                        {!ollamaStatus.running
                          ? 'Start your local Ollama server by running "ollama serve" in a terminal.'
                          : `Run "ollama pull ${ollamaStatus.model}" in your terminal to install the required model.`}
                      </p>
                    </div>
                  </div>
                </div>
              )
            )}

            {/* ── PDF upload ─────────────────────────────────── */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Research Paper (PDF)
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`relative flex flex-col items-center justify-center gap-3 h-40 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
                  dragOver
                    ? 'border-brand-400 bg-brand-50'
                    : pdf
                      ? 'border-brand-300 bg-brand-50/60'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {pdf ? (
                  <>
                    <PdfIcon className="w-8 h-8 text-brand-500" />
                    <div className="text-center">
                      <p className="text-sm font-medium text-gray-800">{pdf.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{(pdf.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setPdf(null) }}
                      className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <XIcon className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <UploadIcon className="w-8 h-8 text-gray-300" />
                    <div className="text-center">
                      <p className="text-sm text-gray-500">
                        <span className="text-brand-600 font-medium">Click to upload</span> or drag and drop
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">PDF only</p>
                    </div>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
                />
              </div>
            </div>

            {/* ── GitHub URL ─────────────────────────────────── */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                GitHub Repository URL
              </label>
              <div className="relative">
                <GithubIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="url"
                  value={repoUrl}
                  onChange={e => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/user/repository"
                  className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 transition-all duration-150 placeholder:text-gray-400"
                />
              </div>
            </div>

            {/* ── Error ──────────────────────────────────────── */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Submit ─────────────────────────────────────── */}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm shadow-sm shadow-brand-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ transition: 'background-color 200ms var(--ease-out), transform 160ms var(--ease-out)' }}
              onMouseDown={e => { if (!submitting) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.97)' }}
              onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
            >
              Analyse
            </button>

            {/* ── How it works ───────────────────────────────── */}
            <div className="mt-10 border border-gray-100 rounded-xl bg-white p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">How PaperTrail works</h3>
              <ol className="space-y-2.5">
                {[
                  'Upload a machine-learning research paper as a PDF.',
                  'Provide the GitHub URL of the paper\'s implementation.',
                  'PaperTrail extracts experimental claims from the paper.',
                  'It inspects relevant source files in the repository.',
                  'Gemma 4 (running locally via Ollama) maps each claim to code evidence.',
                  'A structured report shows supported, ambiguous and missing evidence.',
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-gray-600">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-600 text-xs font-semibold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </motion.div>
        ) : (
          /* ── Analysis workspace ─────────────────────────── */
          <motion.div
            key="workspace"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="rounded-xl border border-gray-200 bg-white p-6 mb-4">
              <div className="flex items-center gap-3 mb-6">
                <SpinnerIcon className="w-5 h-5 text-brand-600 animate-spin" />
                <span className="text-sm font-semibold text-gray-800">Analysis in progress…</span>
              </div>

              <div className="space-y-3">
                {stages.map((stage, i) => (
                  <motion.div
                    key={stage.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                    className="flex items-start gap-3"
                  >
                    <div className="mt-0.5 shrink-0">
                      {stage.status === 'done'    && <CheckIcon    className="w-4 h-4 text-green-500" />}
                      {stage.status === 'running' && <SpinnerIcon  className="w-4 h-4 text-brand-500 animate-spin" />}
                      {stage.status === 'pending' && <DotIcon      className="w-4 h-4 text-gray-300" />}
                      {stage.status === 'error'   && <ErrorIcon    className="w-4 h-4 text-red-500" />}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${
                        stage.status === 'done'    ? 'text-gray-600' :
                        stage.status === 'running' ? 'text-gray-900' :
                        stage.status === 'error'   ? 'text-red-600'  : 'text-gray-400'
                      }`}>
                        {stage.label}
                      </p>
                      {stage.status === 'running' && (
                        <p className="text-xs text-gray-400 mt-0.5">{stage.detail}</p>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* ── Live Progress Log ─────────────────────────── */}
              {latestLog && (
                <div className="mt-5 pt-4 border-t border-gray-100 flex items-start gap-2 text-xs text-gray-500 font-mono">
                  <span className="text-brand-500 shrink-0 select-none">›</span>
                  <span className="truncate">{latestLog}</span>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-400 text-center">
              Running Gemma 4 locally via Ollama — this may take a few minutes.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Inline icons ──────────────────────────────────────────────────────────
function UploadIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 5.75 5.75 0 011.076 11.095" /></svg>
}
function PdfIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
}
function XIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
}
function GithubIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>
}
function SpinnerIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
}
function CheckIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
}
function DotIcon({ className }: { className?: string }) {
  return <svg className={className} fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>
}
function ErrorIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
}
