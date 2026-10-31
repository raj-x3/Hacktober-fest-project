import { useState, useEffect } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { getReport } from '../lib/api'
import { getGitHubFileUrl } from '../lib/github'
import type { AnalysisReport, EvidenceResult, EvidenceStatus } from '../lib/types'

const STATUS_META: Record<EvidenceStatus, { label: string; bg: string; text: string; dot: string }> = {
  supported: { label: 'Supported',  bg: 'bg-green-50',  text: 'text-green-700',  dot: 'bg-green-500'  },
  ambiguous: { label: 'Ambiguous',  bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500'  },
  missing:   { label: 'Missing',    bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-400'    },
}

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [report, setReport] = useState<AnalysisReport | null>(
    (location.state as { report?: AnalysisReport })?.report ?? null,
  )
  const [loading, setLoading] = useState(!report)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [filter, setFilter] = useState<EvidenceStatus | 'all'>('all')

  useEffect(() => {
    if (report || !id) return
    setLoading(true)
    getReport(id)
      .then(r => { setReport(r); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [id, report])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 gap-3">
        <svg className="w-5 h-5 animate-spin text-brand-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        Loading report…
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-500">
        <p className="text-red-500">{error ?? 'Report not found.'}</p>
        <button onClick={() => navigate('/app')} className="text-sm text-brand-600 hover:underline">
          ← Back to analysis
        </button>
      </div>
    )
  }

  const filtered = filter === 'all'
    ? report.results
    : report.results.filter(r => r.status === filter)

  const activeResult: EvidenceResult | undefined = filtered[activeIndex]

  return (
    <div className="flex h-full">
      {/* ── Left: claim list ─────────────────────────────────── */}
      <aside className="w-80 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        {/* Overview header */}
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900 mb-1 truncate" title={report.paper_title}>
            {report.paper_title}
          </h2>
          <p className="text-xs text-gray-400 truncate mb-2">{report.repo_url}</p>

          {/* Repository statistics */}
          {(typeof report.repo_files_indexed === 'number' || typeof report.repo_python_files === 'number') && (
            <div className="flex items-center gap-2 mb-3 text-[11px] text-gray-500 bg-gray-50 px-2.5 py-1.5 rounded-lg border border-gray-100">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />
              <span className="truncate">
                Inspected <strong className="font-semibold text-gray-700">{report.repo_files_indexed ?? 0}</strong> files
                {typeof report.repo_python_files === 'number' && (
                  <> (<strong className="font-semibold text-gray-700">{report.repo_python_files}</strong> Python)</>
                )}
              </span>
            </div>
          )}

          {/* Summary badges */}
          <div className="flex gap-2 flex-wrap">
            {(['all', 'supported', 'ambiguous', 'missing'] as const).map(f => {
              const count =
                f === 'all' ? report.results.length : report.summary[f]
              return (
                <button
                  key={f}
                  onClick={() => { setFilter(f); setActiveIndex(0) }}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors duration-150 ${
                    filter === f
                      ? 'bg-brand-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f === 'all' ? `All ${count}` : `${STATUS_META[f].label} ${count}`}
                </button>
              )
            })}
          </div>
        </div>

        {/* Claim list */}
        <div className="flex-1 overflow-y-auto thin-scroll py-2">
          {filtered.map((result, i) => {
            const meta = STATUS_META[result.status]
            return (
              <button
                key={result.claim.id}
                onClick={() => setActiveIndex(i)}
                className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors duration-150 ${
                  activeIndex === i ? 'bg-brand-50' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${meta.text}`}>
                    {meta.label}
                  </span>
                </div>
                <p className="text-xs text-gray-700 line-clamp-3 leading-relaxed">
                  {result.claim.text}
                </p>
              </button>
            )
          })}

          {filtered.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-10">No results for this filter.</p>
          )}
        </div>
      </aside>

      {/* ── Right: evidence detail ───────────────────────────── */}
      <main className="flex-1 overflow-y-auto thin-scroll p-6">
        {activeResult ? (
          <motion.div
            key={activeResult.claim.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="max-w-2xl"
          >
            {/* Status badge */}
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold mb-4 ${STATUS_META[activeResult.status].bg} ${STATUS_META[activeResult.status].text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[activeResult.status].dot}`} />
              {STATUS_META[activeResult.status].label} evidence
            </div>

            {/* Claim */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 mb-4">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Research Claim</p>
              <p className="text-sm text-gray-800 leading-relaxed">{activeResult.claim.text}</p>
              {activeResult.claim.page && (
                <p className="text-xs text-gray-400 mt-2">Page {activeResult.claim.page}</p>
              )}
            </div>

            {/* Source file */}
            {activeResult.file_path && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Source File</p>
                  {(() => {
                    const ghUrl = getGitHubFileUrl(
                      report.repo_url,
                      activeResult.file_path,
                      report.default_branch,
                      activeResult.line_start,
                      activeResult.line_end,
                    )
                    return ghUrl ? (
                      <a
                        href={ghUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline transition-colors"
                      >
                        View on GitHub
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    ) : null
                  })()}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  {(() => {
                    const ghUrl = getGitHubFileUrl(
                      report.repo_url,
                      activeResult.file_path,
                      report.default_branch,
                      activeResult.line_start,
                      activeResult.line_end,
                    )
                    return ghUrl ? (
                      <a
                        href={ghUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs bg-gray-100 hover:bg-brand-50 text-brand-700 hover:text-brand-800 px-2 py-1 rounded transition-colors"
                        title="Open in GitHub"
                      >
                        {activeResult.file_path}
                      </a>
                    ) : (
                      <span className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                        {activeResult.file_path}
                      </span>
                    )
                  })()}
                  {activeResult.line_start && (
                    <span className="text-xs text-gray-400 font-mono">
                      L{activeResult.line_start}{activeResult.line_end ? `–${activeResult.line_end}` : ''}
                    </span>
                  )}
                </div>

                {activeResult.code_snippet && (
                  <pre className="text-[11px] font-mono bg-gray-950 text-gray-200 rounded-lg p-4 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                    {activeResult.code_snippet}
                  </pre>
                )}
              </div>
            )}

            {/* Explanation */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 mb-4">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Explanation</p>
              <p className="text-sm text-gray-700 leading-relaxed">{activeResult.explanation}</p>
            </div>

            {/* Limitations */}
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-5">
              <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider mb-2">Uncertainty & Limitations</p>
              <p className="text-sm text-amber-800 leading-relaxed">{activeResult.limitations}</p>
            </div>
          </motion.div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Select a claim to view its evidence.
          </div>
        )}
      </main>
    </div>
  )
}
