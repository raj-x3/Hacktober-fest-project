import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { getRecentAnalyses } from '../lib/api'

export default function ResearchLibraryPage() {
  const navigate = useNavigate()
  const [analyses, setAnalyses] = useState(() => getRecentAnalyses())

  const clearAll = () => {
    localStorage.removeItem('pt_recent')
    setAnalyses([])
  }

  const removeItem = (id: string) => {
    const next = analyses.filter(a => a.id !== id)
    localStorage.setItem('pt_recent', JSON.stringify(next))
    setAnalyses(next)
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* ── Page header ───────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight mb-2">
            Research Library
          </h1>
          <p className="text-gray-500 text-sm leading-relaxed max-w-lg">
            Browse and review previously analysed research papers and their verified
            repository implementations.
          </p>
        </div>
        {analyses.length > 0 && (
          <button
            onClick={clearAll}
            className="text-xs text-gray-400 hover:text-red-600 transition-colors py-1.5 px-3 rounded-lg hover:bg-red-50 border border-transparent hover:border-red-100"
          >
            Clear history
          </button>
        )}
      </div>

      {analyses.length > 0 ? (
        <div className="grid gap-4">
          {analyses.map((item, idx) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.2 }}
              className="group bg-white rounded-xl border border-gray-200/80 p-5 hover:border-brand-300 hover:shadow-sm transition-all duration-150 flex items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                  <span className="text-[11px] font-medium text-brand-600 uppercase tracking-wider">
                    Analysis Report
                  </span>
                  <span className="text-xs text-gray-400">·</span>
                  <span className="text-xs text-gray-400">
                    {new Date(item.date).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-gray-900 truncate group-hover:text-brand-600 transition-colors">
                  {item.title}
                </h3>
                <p className="text-xs text-gray-500 font-mono truncate mt-0.5">
                  {item.repo}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => navigate(`/app/results/${item.id}`)}
                  className="px-3.5 py-1.5 rounded-lg bg-gray-50 hover:bg-brand-50 text-gray-700 hover:text-brand-700 text-xs font-semibold border border-gray-200 hover:border-brand-200 transition-all duration-150"
                >
                  View Report →
                </button>
                <button
                  onClick={() => removeItem(item.id)}
                  className="p-1.5 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
                  title="Remove from history"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200/80 p-12 text-center max-w-lg mx-auto mt-6">
          <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            No analyses saved yet
          </h2>
          <p className="text-xs text-gray-500 leading-relaxed max-w-sm mx-auto mb-6">
            When you run an analysis on a research paper and repository, your report
            will be preserved here for instant access.
          </p>
          <button
            onClick={() => navigate('/app')}
            className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs shadow-sm transition-colors"
          >
            Start New Analysis
          </button>
        </div>
      )}
    </div>
  )
}
