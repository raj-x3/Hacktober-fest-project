/**
 * GitHub repository and citation URL utilities for PaperTrail.
 */

export function getGitHubFileUrl(
  repoUrl: string,
  filePath: string | null | undefined,
  branch = 'main',
  lineStart?: number | null,
  lineEnd?: number | null,
): string | null {
  if (!filePath || !repoUrl) return null
  const cleanRepo = repoUrl.trim().replace(/\.git\/?$/, '').replace(/\/+$/, '')
  if (!/^https?:\/\/(www\.)?github\.com\//i.test(cleanRepo)) return null

  const cleanPath = filePath.replace(/^\/+/, '')
  const cleanBranch = (branch || 'main').trim()
  const base = `${cleanRepo}/blob/${cleanBranch}/${cleanPath}`

  if (typeof lineStart === 'number' && lineStart > 0) {
    if (typeof lineEnd === 'number' && lineEnd > lineStart) {
      return `${base}#L${lineStart}-L${lineEnd}`
    }
    return `${base}#L${lineStart}`
  }
  return base
}

/**
 * Validates whether a string is an acceptable GitHub repository URL.
 */
export function isValidGitHubRepoUrl(url: string | null | undefined): boolean {
  if (!url) return false
  const trimmed = url.trim()
  return /^https?:\/\/(www\.)?github\.com\/[\w\-.]+\/[\w\-.]+(?:\.git)?\/?$/i.test(trimmed)
}
