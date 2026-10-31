import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AnalysisReport, EvidenceResult, Claim, JobStatus, OllamaStatus } from '../src/lib/types.ts'

describe('Schema Matching: Backend Contract vs Frontend Types', () => {
  it('validates a complete AnalysisReport payload from backend', () => {
    const rawBackendPayload = {
      id: 'b1234567-89ab-cdef-0123-456789abcdef',
      paper_title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
      repo_url: 'https://github.com/google-research/bert',
      created_at: '2026-11-01T00:00:00.000000Z',
      model_used: 'gemma4:e4b',
      default_branch: 'master',
      repo_files_indexed: 47,
      repo_python_files: 12,
      results: [
        {
          claim: {
            id: 'claim_0_0',
            text: 'BERT uses a bidirectional Transformer architecture.',
            page: 1,
          },
          status: 'supported',
          file_path: 'modeling.py',
          line_start: 342,
          line_end: 415,
          code_snippet: 'class BertModel(object):\n  def __init__(self, config, is_training):',
          explanation: 'The BertModel class explicitly implements the multi-layer bidirectional Transformer encoder.',
          limitations: 'Numerical performance benchmarks require running evaluation scripts.',
        },
        {
          claim: {
            id: 'claim_0_1',
            text: 'Pre-training uses 15% masked language modeling probability.',
            page: 3,
          },
          status: 'ambiguous',
          file_path: 'create_pretraining_data.py',
          line_start: 342,
          line_end: 350,
          code_snippet: 'masked_lm_prob = 0.15',
          explanation: 'Default argument specifies 15% probability, but command-line flag can override it.',
          limitations: 'Exact pre-training command arguments are not captured in the code snippet.',
        },
        {
          claim: {
            id: 'claim_0_2',
            text: 'Trained on 64 TPU chips for 4 days.',
            page: 4,
          },
          status: 'missing',
          file_path: null,
          line_start: null,
          line_end: null,
          code_snippet: null,
          explanation: 'Hardware training logs and cluster configurations are not stored in the repository.',
          limitations: 'Hardware infrastructure is external to the open-source repository.',
        },
      ],
      summary: {
        total_claims: 3,
        supported: 1,
        ambiguous: 1,
        missing: 1,
      },
    }

    const report: AnalysisReport = rawBackendPayload

    assert.equal(typeof report.id, 'string')
    assert.equal(typeof report.paper_title, 'string')
    assert.equal(typeof report.repo_url, 'string')
    assert.equal(typeof report.model_used, 'string')
    assert.equal(report.default_branch, 'master')
    assert.equal(report.repo_files_indexed, 47)
    assert.equal(report.repo_python_files, 12)
    assert.equal(report.results.length, 3)

    // Check individual results
    const r0: EvidenceResult = report.results[0]!
    assert.equal(r0.status, 'supported')
    assert.equal(r0.file_path, 'modeling.py')
    assert.equal(r0.line_start, 342)
    assert.equal(r0.line_end, 415)
    assert.equal(typeof r0.code_snippet, 'string')

    const r2: EvidenceResult = report.results[2]!
    assert.equal(r2.status, 'missing')
    assert.equal(r2.file_path, null)
    assert.equal(r2.line_start, null)
    assert.equal(r2.line_end, null)
    assert.equal(r2.code_snippet, null)

    // Check summary
    assert.equal(report.summary.total_claims, 3)
    assert.equal(report.summary.supported, 1)
    assert.equal(report.summary.ambiguous, 1)
    assert.equal(report.summary.missing, 1)
  })

  it('validates JobStatus polling schema from backend', () => {
    const rawJobStatus = {
      job_id: 'job-12345',
      stage: 'Indexing source files',
      stage_index: 2,
      total_stages: 5,
      done: false,
      error: null,
      log: [
        '[1/5] Extracting research claims',
        'Paper title: BERT Architecture',
        '[2/5] Cloning repository',
        '[3/5] Indexing source files — Indexed 45 files (12 Python)',
      ],
    }

    const jobStatus: JobStatus = {
      job_id: rawJobStatus.job_id,
      stage: rawJobStatus.stage,
      stage_index: rawJobStatus.stage_index,
      total_stages: rawJobStatus.total_stages,
      done: rawJobStatus.done,
      error: rawJobStatus.error ?? undefined,
      log: rawJobStatus.log,
    }

    assert.equal(jobStatus.job_id, 'job-12345')
    assert.equal(jobStatus.stage_index, 2)
    assert.equal(jobStatus.total_stages, 5)
    assert.equal(jobStatus.done, false)
    assert.equal(jobStatus.log?.length, 4)
    assert.equal(jobStatus.log?.[3], '[3/5] Indexing source files — Indexed 45 files (12 Python)')
  })

  it('validates OllamaStatus health schema from backend', () => {
    const rawHealthy = {
      running: true,
      model: 'gemma4:e4b',
      model_available: true,
    }

    const healthy: OllamaStatus = rawHealthy
    assert.equal(healthy.running, true)
    assert.equal(healthy.model, 'gemma4:e4b')
    assert.equal(healthy.model_available, true)

    const rawUnhealthy = {
      running: false,
      model: 'gemma4:e4b',
      model_available: false,
      error: 'Ollama is not running. Start it with: ollama serve',
    }

    const unhealthy: OllamaStatus = rawUnhealthy
    assert.equal(unhealthy.running, false)
    assert.equal(unhealthy.model_available, false)
    assert.ok(unhealthy.error?.includes('ollama serve'))
  })
})
