import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import type { AnalysisStage, JobStatus } from '../src/lib/types.ts'

const STAGES_META: Omit<AnalysisStage, 'status'>[] = [
  { id: 'claims',  label: 'Extracting research claims',        detail: 'Parsing PDF and identifying experimental claims with Gemma…' },
  { id: 'clone',   label: 'Cloning repository',                detail: 'Fetching repository files and commit history from GitHub…' },
  { id: 'index',   label: 'Indexing source files',             detail: 'Prioritising Python modules, configs and training scripts…' },
  { id: 'connect', label: 'Connecting claims to evidence',     detail: 'Asking Gemma 4 to locate verified code evidence for each claim…' },
  { id: 'report',  label: 'Generating the report',            detail: 'Validating snippet line citations and structuring report…' },
]

function applyJobStatus(js: JobStatus): AnalysisStage[] {
  return STAGES_META.map((s, i) => ({
    ...s,
    status: i < js.stage_index
      ? 'done'
      : i === js.stage_index
        ? (js.error ? 'error' : 'running')
        : 'pending',
  }))
}

describe('Analysis Workflow & Stage Progression', () => {
  it('initializes stage 0 as running and stages 1-4 as pending', () => {
    const js: JobStatus = {
      job_id: 'job-1',
      stage: 'Extracting research claims',
      stage_index: 0,
      total_stages: 5,
      done: false,
    }
    const stages = applyJobStatus(js)
    assert.equal(stages.length, 5)
    assert.equal(stages[0]?.status, 'running')
    assert.equal(stages[1]?.status, 'pending')
    assert.equal(stages[2]?.status, 'pending')
    assert.equal(stages[3]?.status, 'pending')
    assert.equal(stages[4]?.status, 'pending')
  })

  it('marks previous stages as done and current stage as running at stage 2', () => {
    const js: JobStatus = {
      job_id: 'job-1',
      stage: 'Indexing source files',
      stage_index: 2,
      total_stages: 5,
      done: false,
    }
    const stages = applyJobStatus(js)
    assert.equal(stages[0]?.status, 'done')
    assert.equal(stages[1]?.status, 'done')
    assert.equal(stages[2]?.status, 'running')
    assert.equal(stages[3]?.status, 'pending')
    assert.equal(stages[4]?.status, 'pending')
  })

  it('marks current stage as error when js.error is present', () => {
    const js: JobStatus = {
      job_id: 'job-1',
      stage: 'Cloning repository',
      stage_index: 1,
      total_stages: 5,
      done: true,
      error: 'Repository not found or does not exist (404)',
    }
    const stages = applyJobStatus(js)
    assert.equal(stages[0]?.status, 'done')
    assert.equal(stages[1]?.status, 'error')
    assert.equal(stages[2]?.status, 'pending')
    assert.equal(stages[3]?.status, 'pending')
    assert.equal(stages[4]?.status, 'pending')
  })

  it('marks all stages as done when stage_index reaches 5', () => {
    const js: JobStatus = {
      job_id: 'job-1',
      stage: 'Done',
      stage_index: 5,
      total_stages: 5,
      done: true,
    }
    const stages = applyJobStatus(js)
    assert.ok(stages.every(s => s.status === 'done'))
  })
})

describe('Recent Analyses Storage & Deduplication', () => {
  // In-memory mock storage for testing
  const mockStorage = new Map<string, string>()

  function mockGetRecentAnalyses(): Array<{ id: string; title: string; repo: string; date: string }> {
    try {
      return JSON.parse(mockStorage.get('pt_recent') ?? '[]')
    } catch {
      return []
    }
  }

  function mockSaveRecentAnalysis(entry: { id: string; title: string; repo: string; date: string }) {
    const list = mockGetRecentAnalyses()
    const updated = [entry, ...list.filter(e => e.id !== entry.id)].slice(0, 20)
    mockStorage.set('pt_recent', JSON.stringify(updated))
  }

  beforeEach(() => {
    mockStorage.clear()
  })

  it('saves and retrieves an analysis entry', () => {
    mockSaveRecentAnalysis({
      id: 'analysis-1',
      title: 'BERT Paper',
      repo: 'https://github.com/google-research/bert',
      date: '2026-11-01T00:00:00Z',
    })
    const list = mockGetRecentAnalyses()
    assert.equal(list.length, 1)
    assert.equal(list[0]?.id, 'analysis-1')
    assert.equal(list[0]?.title, 'BERT Paper')
  })

  it('deduplicates entries with the same id and moves latest to the top', () => {
    mockSaveRecentAnalysis({ id: 'a1', title: 'Paper 1', repo: 'repo1', date: '2026-11-01T00:00:00Z' })
    mockSaveRecentAnalysis({ id: 'a2', title: 'Paper 2', repo: 'repo2', date: '2026-11-01T01:00:00Z' })
    mockSaveRecentAnalysis({ id: 'a1', title: 'Paper 1 (Updated)', repo: 'repo1', date: '2026-11-01T02:00:00Z' })

    const list = mockGetRecentAnalyses()
    assert.equal(list.length, 2)
    assert.equal(list[0]?.id, 'a1')
    assert.equal(list[0]?.title, 'Paper 1 (Updated)')
    assert.equal(list[1]?.id, 'a2')
  })

  it('caps history at 20 entries', () => {
    for (let i = 0; i < 25; i++) {
      mockSaveRecentAnalysis({ id: `a${i}`, title: `Paper ${i}`, repo: `repo${i}`, date: new Date().toISOString() })
    }
    const list = mockGetRecentAnalyses()
    assert.equal(list.length, 20)
    assert.equal(list[0]?.id, 'a24')
  })
})
