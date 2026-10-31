import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { getRecentAnalyses } from '../lib/api'

const navItems = [
  { to: '/app', label: 'New Analysis', icon: PlusIcon, end: true },
  { to: '/app/library', label: 'Research Library', icon: BookIcon, end: false },
  { to: '/app/settings', label: 'Settings', icon: GearIcon, end: false },
]

export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const recent = getRecentAnalyses()

  return (
    <div className="app-shell flex h-screen overflow-hidden">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="w-60 shrink-0 flex flex-col border-r border-gray-200 bg-white">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center shadow-sm">
              <span className="text-white text-sm font-bold">P</span>
            </div>
            <span className="font-semibold text-gray-900 text-[15px] tracking-tight">
              Paper<span className="text-brand-600">Trail</span>
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={`w-4 h-4 ${isActive ? 'text-brand-600' : 'text-gray-400'}`} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}

          {/* Recent analyses */}
          {recent.length > 0 && (
            <div className="mt-5">
              <p className="px-3 mb-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Recent
              </p>
              {recent.slice(0, 8).map(r => (
                <button
                  key={r.id}
                  onClick={() => navigate(`/app/results/${r.id}`)}
                  className="w-full text-left flex flex-col px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors duration-150"
                >
                  <span className="text-xs font-medium text-gray-700 truncate">{r.title}</span>
                  <span className="text-[11px] text-gray-400 truncate">{r.repo}</span>
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-100">
          <button
            onClick={() => { sessionStorage.removeItem('pt_skip_intro'); navigate('/') }}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors duration-150"
          >
            ← Back to intro
          </button>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top nav */}
        <header className="h-14 shrink-0 border-b border-gray-200 bg-white flex items-center px-6 gap-4">
          <div className="flex-1 max-w-sm">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search analyses…"
                className="w-full pl-9 pr-4 py-1.5 text-sm rounded-lg border border-gray-200 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 transition-all duration-150 placeholder:text-gray-400"
              />
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-semibold">
              DG
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto thin-scroll bg-[#f8f9fc]">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            className="h-full"
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  )
}

// ── Icons (inline SVG) ────────────────────────────────────────────────────
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}
function BookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  )
}
function GearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  )
}
