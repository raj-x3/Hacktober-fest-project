// ─── Shared types for PaperTrail frontend ─────────────────────────────────

export type EvidenceStatus = 'supported' | 'ambiguous' | 'missing'

export interface Claim {
  id: string
  text: string
  page?: number
}

export interface EvidenceResult {
  claim: Claim
  status: EvidenceStatus
  file_path: string | null
  line_start: number | null
  line_end: number | null
  code_snippet: string | null
  explanation: string
  limitations: string
}

export interface AnalysisReport {
  id: string
  paper_title: string
  repo_url: string
  created_at: string
  model_used: string
  results: EvidenceResult[]
  summary: {
    total_claims: number
    supported: number
    ambiguous: number
    missing: number
  }
}

export interface AnalysisStage {
  id: string
  label: string
  detail: string
  status: 'pending' | 'running' | 'done' | 'error'
}

export interface SubmitPayload {
  repo_url: string
}

export interface OllamaStatus {
  running: boolean
  model: string
  model_available: boolean
  error?: string
}
