import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isValidGitHubRepoUrl } from '../src/lib/github.ts'

describe('Upload and Input Validation', () => {
  describe('isValidGitHubRepoUrl', () => {
    it('accepts standard public repository URLs', () => {
      assert.equal(isValidGitHubRepoUrl('https://github.com/google-research/bert'), true)
      assert.equal(isValidGitHubRepoUrl('https://github.com/facebook/react'), true)
      assert.equal(isValidGitHubRepoUrl('https://github.com/owner/my-repo_name.py'), true)
    })

    it('accepts URLs with trailing slashes or .git suffix', () => {
      assert.equal(isValidGitHubRepoUrl('https://github.com/google-research/bert/'), true)
      assert.equal(isValidGitHubRepoUrl('https://github.com/google-research/bert.git'), true)
      assert.equal(isValidGitHubRepoUrl('https://github.com/google-research/bert.git/'), true)
    })

    it('accepts www subdomain', () => {
      assert.equal(isValidGitHubRepoUrl('https://www.github.com/google-research/bert'), true)
    })

    it('rejects non-github hosts', () => {
      assert.equal(isValidGitHubRepoUrl('https://gitlab.com/owner/repo'), false)
      assert.equal(isValidGitHubRepoUrl('https://bitbucket.org/owner/repo'), false)
      assert.equal(isValidGitHubRepoUrl('https://not-github.com/owner/repo'), false)
    })

    it('rejects incomplete URLs', () => {
      assert.equal(isValidGitHubRepoUrl('https://github.com/'), false)
      assert.equal(isValidGitHubRepoUrl('https://github.com/owner'), false)
      assert.equal(isValidGitHubRepoUrl('github.com'), false)
      assert.equal(isValidGitHubRepoUrl(''), false)
      assert.equal(isValidGitHubRepoUrl(null), false)
      assert.equal(isValidGitHubRepoUrl(undefined), false)
    })

    it('rejects dangerous or malformed input', () => {
      assert.equal(isValidGitHubRepoUrl('javascript:alert(1)'), false)
      assert.equal(isValidGitHubRepoUrl('file:///etc/passwd'), false)
      assert.equal(isValidGitHubRepoUrl('https://github.com/owner/repo;rm -rf /'), false)
      assert.equal(isValidGitHubRepoUrl('https://github.com/owner/repo/issues'), false)
      assert.equal(isValidGitHubRepoUrl('https://github.com/owner/repo/pull/1'), false)
    })
  })

  describe('PDF upload validation rules', () => {
    function validatePdfUpload(file: { name: string; type: string; size: number }): { valid: boolean; error?: string } {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        return { valid: false, error: 'Please upload a PDF file.' }
      }
      if (file.size <= 0) {
        return { valid: false, error: 'The uploaded file is empty.' }
      }
      return { valid: true }
    }

    it('accepts valid PDF files', () => {
      const result = validatePdfUpload({ name: 'paper.pdf', type: 'application/pdf', size: 1024 * 50 })
      assert.equal(result.valid, true)
      assert.equal(result.error, undefined)
    })

    it('accepts valid PDF with uppercase extension', () => {
      const result = validatePdfUpload({ name: 'PAPER.PDF', type: 'application/pdf', size: 2048 })
      assert.equal(result.valid, true)
    })

    it('rejects non-PDF mime types and extensions', () => {
      const invalidFiles = [
        { name: 'document.docx', type: 'application/vnd.openxmlformats', size: 5000 },
        { name: 'image.png', type: 'image/png', size: 5000 },
        { name: 'script.py', type: 'text/x-python', size: 500 },
        { name: 'archive.zip', type: 'application/zip', size: 10000 },
      ]
      for (const f of invalidFiles) {
        const res = validatePdfUpload(f)
        assert.equal(res.valid, false)
        assert.equal(res.error, 'Please upload a PDF file.')
      }
    })

    it('rejects 0-byte empty files', () => {
      const result = validatePdfUpload({ name: 'empty.pdf', type: 'application/pdf', size: 0 })
      assert.equal(result.valid, false)
      assert.equal(result.error, 'The uploaded file is empty.')
    })
  })
})
