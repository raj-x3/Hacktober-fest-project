import type { AnalysisReport, OllamaStatus } from './types'

const BASE = '/api'

async function post<T>(path: string, body: FormData | Record<string, unknown>): Promise<T> {
  const init: RequestInit =
    body instanceof FormData
      ? { method: 'POST', body }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }

  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Request failed')
  }
  return res.json() as Promise<T>
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Request failed')
  }
  return res.json() as Promise<T>
}

// ─── API surface ──────────────────────────────────────────────────────────

/** Check Ollama + model availability */
export const getOllamaStatus = () => get<OllamaStatus>('/health/ollama')

/** Submit PDF + GitHub URL for analysis. Returns a job id. */
export async function submitAnalysis(pdf: File, repoUrl: string): Promise<{ job_id: string }> {
  const fd = new FormData()
  fd.append('pdf', pdf)
  fd.append('repo_url', repoUrl)
  return post<{ job_id: string }>('/analyse', fd)
}

/** Poll job status – returns stage info */
export interface JobStatus {
  job_id: string
  stage: string
  stage_index: number
  total_stages: number
  done: boolean
  error?: string
  log?: string[]
}
export const pollJob = (jobId: string) => get<JobStatus>(`/analyse/${jobId}/status`)

/** Fetch completed report */
export const getReport = (jobId: string) => get<AnalysisReport>(`/analyse/${jobId}/report`)

/** List recent analyses stored in browser localStorage */
export function getRecentAnalyses(): Array<{ id: string; title: string; repo: string; date: string }> {
  try {
    return JSON.parse(localStorage.getItem('pt_recent') ?? '[]')
  } catch {
    return []
  }
}

export function saveRecentAnalysis(entry: { id: string; title: string; repo: string; date: string }) {
  const list = getRecentAnalyses()
  const updated = [entry, ...list.filter(e => e.id !== entry.id)].slice(0, 20)
  localStorage.setItem('pt_recent', JSON.stringify(updated))
}
