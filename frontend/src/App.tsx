import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './pages/AppShell'
import AnalysisPage from './pages/AnalysisPage'
import ResultsPage from './pages/ResultsPage'
import ResearchLibraryPage from './pages/ResearchLibraryPage'
import SettingsPage from './pages/SettingsPage'

// Lazy-load the intro so Three.js only loads when the intro is actually shown
const IntroPage = lazy(() => import('./pages/IntroPage'))

function IntroLoading() {
  return (
    <div className="fixed inset-0 bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-6 h-6 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={
        <Suspense fallback={<IntroLoading />}>
          <IntroPage />
        </Suspense>
      } />
      <Route path="/app" element={<AppShell />}>
        <Route index element={<AnalysisPage />} />
        <Route path="library" element={<ResearchLibraryPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="results/:id" element={<ResultsPage />} />
      </Route>
      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
