import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getGitHubFileUrl } from '../src/lib/github.ts'

describe('getGitHubFileUrl: line ranges and branch support', () => {
  it('constructs correct link for start and end line numbers', () => {
    const url = getGitHubFileUrl(
      'https://github.com/google-research/bert',
      'create_pretraining_data.py',
      'master',
      342,
      415,
    )
    assert.equal(
      url,
      'https://github.com/google-research/bert/blob/master/create_pretraining_data.py#L342-L415',
    )
  })

  it('constructs single line anchor when start equals end', () => {
    const url = getGitHubFileUrl(
      'https://github.com/google-research/bert',
      'modeling.py',
      'master',
      50,
      50,
    )
    assert.equal(
      url,
      'https://github.com/google-research/bert/blob/master/modeling.py#L50',
    )
  })

  it('constructs single line anchor when only lineStart is provided', () => {
    const url = getGitHubFileUrl(
      'https://github.com/google-research/bert',
      'modeling.py',
      'main',
      120,
      null,
    )
    assert.equal(
      url,
      'https://github.com/google-research/bert/blob/main/modeling.py#L120',
    )
  })

  it('constructs file link without line anchor when line numbers are unavailable', () => {
    const url = getGitHubFileUrl(
      'https://github.com/google-research/bert',
      'README.md',
      'main',
      null,
      null,
    )
    assert.equal(
      url,
      'https://github.com/google-research/bert/blob/main/README.md',
    )
  })

  it('defaults to main branch if branch is empty or not specified', () => {
    const url = getGitHubFileUrl(
      'https://github.com/owner/repo',
      'src/index.py',
      '',
      1,
      10,
    )
    assert.equal(
      url,
      'https://github.com/owner/repo/blob/main/src/index.py#L1-L10',
    )
  })

  it('strips trailing .git and trailing slashes from repo URL', () => {
    const url = getGitHubFileUrl(
      'https://github.com/owner/repo.git/',
      'src/model.py',
      'develop',
      25,
      30,
    )
    assert.equal(
      url,
      'https://github.com/owner/repo/blob/develop/src/model.py#L25-L30',
    )
  })

  it('strips leading slashes from file path', () => {
    const url = getGitHubFileUrl(
      'https://github.com/owner/repo',
      '/nested/folder/code.py',
      'main',
      5,
      15,
    )
    assert.equal(
      url,
      'https://github.com/owner/repo/blob/main/nested/folder/code.py#L5-L15',
    )
  })

  it('returns null if file_path is missing or empty', () => {
    assert.equal(getGitHubFileUrl('https://github.com/owner/repo', null), null)
    assert.equal(getGitHubFileUrl('https://github.com/owner/repo', ''), null)
    assert.equal(getGitHubFileUrl('https://github.com/owner/repo', undefined), null)
  })

  it('returns null if repo_url is missing or empty', () => {
    assert.equal(getGitHubFileUrl('', 'main.py'), null)
    assert.equal(getGitHubFileUrl('   ', 'main.py'), null)
  })

  it('returns null if repo_url is not a valid github.com URL', () => {
    assert.equal(getGitHubFileUrl('https://gitlab.com/owner/repo', 'main.py'), null)
    assert.equal(getGitHubFileUrl('http://insecure-site.com/repo', 'main.py'), null)
    assert.equal(getGitHubFileUrl('javascript:alert(1)', 'main.py'), null)
  })
})
