import type { AnalysisReport } from './types'

export function extractRepoName(repoUrl: string): string {
  if (!repoUrl) return ''
  return repoUrl
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\/$/, '')
    .replace(/\.git$/i, '')
}

export function formatEvidenceCitation(
  filePath: string,
  lineStart?: number | null,
  lineEnd?: number | null,
): string {
  if (!filePath) return ''
  if (!lineStart) return filePath
  if (lineEnd && lineEnd !== lineStart) {
    return `${filePath}:L${lineStart}-L${lineEnd}`
  }
  return `${filePath}:L${lineStart}`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function generateHtmlReport(report: AnalysisReport): string {
  const repoName = extractRepoName(report.repo_url)
  const total = report.summary.total_claims || 1
  const suppPct = ((report.summary.supported / total) * 100).toFixed(1)
  const ambPct = ((report.summary.ambiguous / total) * 100).toFixed(1)
  const missPct = ((report.summary.missing / total) * 100).toFixed(1)

  const items = report.results.map((r, i) => {
    const statusColor =
      r.status === 'supported' ? '#16a34a' : r.status === 'ambiguous' ? '#d97706' : '#dc2626'
    const statusBg =
      r.status === 'supported' ? '#f0fdf4' : r.status === 'ambiguous' ? '#fffbeb' : '#fef2f2'
    const citation = r.file_path
      ? formatEvidenceCitation(r.file_path, r.line_start, r.line_end)
      : 'No verified citation'

    return `
      <div class="claim-card">
        <div class="claim-header">
          <span class="badge" style="background:${statusBg};color:${statusColor};border:1px solid ${statusColor}33">
            <span class="dot" style="background:${statusColor}"></span>
            ${r.status.toUpperCase()}
          </span>
          <span class="claim-num">Claim #${i + 1}</span>
        </div>
        <div class="claim-text">${escapeHtml(r.claim.text)}</div>
        ${r.file_path ? `
          <div class="citation-box">
            <div class="citation-meta"><strong>Verified Source:</strong> <code>${escapeHtml(citation)}</code></div>
            ${r.code_snippet ? `<pre><code>${escapeHtml(r.code_snippet)}</code></pre>` : ''}
          </div>
        ` : ''}
        <div class="section-title">Explanation</div>
        <p class="explanation-text">${escapeHtml(r.explanation || '—')}</p>
        ${r.limitations ? `
          <div class="limitations-box">
            <strong>Uncertainty &amp; Limitations:</strong> ${escapeHtml(r.limitations)}
          </div>
        ` : ''}
      </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PaperTrail Report — ${escapeHtml(report.paper_title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.5; padding: 32px 16px; }
    .container { max-width: 860px; margin: 0 auto; }
    header { background: #fff; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 24px; }
    h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 6px; }
    .paper-title { font-size: 14px; color: #64748b; margin-bottom: 16px; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; font-size: 13px; }
    .meta-item { background: #f1f5f9; padding: 10px 14px; border-radius: 8px; }
    .meta-label { color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 2px; }
    .meta-val { font-weight: 600; color: #334155; word-break: break-all; }
    .dist-box { background: #fff; padding: 20px 24px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 24px; }
    .dist-header { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; }
    .dist-bar { height: 10px; display: flex; border-radius: 9999px; overflow: hidden; background: #e2e8f0; margin: 12px 0 8px; }
    .dist-legend { display: flex; gap: 16px; font-size: 12px; flex-wrap: wrap; }
    .legend-item { display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; vertical-align: middle; }
    .claim-card { background: #fff; padding: 20px 24px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 16px; }
    .claim-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .badge { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 5px; }
    .claim-num { font-size: 12px; font-weight: 600; color: #94a3b8; }
    .claim-text { font-size: 14px; font-weight: 500; color: #0f172a; margin-bottom: 14px; line-height: 1.6; }
    .citation-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 12px; font-size: 13px; }
    .citation-meta { margin-bottom: 6px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    pre { background: #0f172a; color: #f8fafc; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; margin-top: 8px; white-space: pre-wrap; }
    pre code { background: transparent; padding: 0; color: inherit; }
    .section-title { font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; margin-bottom: 4px; }
    .explanation-text { font-size: 13px; color: #334155; margin-bottom: 12px; line-height: 1.6; }
    .limitations-box { background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 10px 14px; font-size: 12px; color: #92400e; }
    footer { text-align: center; font-size: 12px; color: #94a3b8; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>PaperTrail Analysis Report</h1>
      <p class="paper-title">${escapeHtml(report.paper_title)}</p>
      <div class="meta-grid">
        <div class="meta-item"><span class="meta-label">Repository</span><span class="meta-val"><a href="${escapeHtml(report.repo_url)}" target="_blank" style="color: #2563eb; text-decoration: none;">${escapeHtml(repoName)}</a></span></div>
        <div class="meta-item"><span class="meta-label">Default Branch</span><span class="meta-val">${escapeHtml(report.default_branch || 'main')}</span></div>
        <div class="meta-item"><span class="meta-label">Indexed Files</span><span class="meta-val">${report.repo_files_indexed ?? '—'}${typeof report.repo_python_files === 'number' ? ` (${report.repo_python_files} Python)` : ''}</span></div>
        <div class="meta-item"><span class="meta-label">Claims Analysed</span><span class="meta-val">${report.summary.total_claims}</span></div>
        <div class="meta-item"><span class="meta-label">Model Used</span><span class="meta-val">${escapeHtml(report.model_used)}</span></div>
        <div class="meta-item"><span class="meta-label">Generated</span><span class="meta-val">${new Date(report.created_at).toLocaleString()}</span></div>
      </div>
    </header>

    <div class="dist-box">
      <div class="dist-header">
        <span>Claim Distribution</span>
        <span style="color: #64748b;">${report.summary.total_claims} claims analysed</span>
      </div>
      <div class="dist-bar">
        <div style="width: ${suppPct}%; background: #22c55e;" title="Supported: ${report.summary.supported}"></div>
        <div style="width: ${ambPct}%; background: #f59e0b;" title="Ambiguous: ${report.summary.ambiguous}"></div>
        <div style="width: ${missPct}%; background: #f87171;" title="Missing: ${report.summary.missing}"></div>
      </div>
      <div class="dist-legend">
        <span class="legend-item"><span class="dot" style="background:#22c55e"></span> Supported: <strong>${report.summary.supported}</strong></span>
        <span class="legend-item"><span class="dot" style="background:#f59e0b"></span> Ambiguous: <strong>${report.summary.ambiguous}</strong></span>
        <span class="legend-item"><span class="dot" style="background:#f87171"></span> Missing: <strong>${report.summary.missing}</strong></span>
      </div>
    </div>

    <div>${items}</div>

    <footer>
      Generated by PaperTrail · Local Gemma 4 · ${new Date().getFullYear()}
    </footer>
  </div>
</body>
</html>`
}

export function downloadReportJson(report: AnalysisReport): void {
  const slug = (report.paper_title || 'papertrail')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'papertrail'
  const jsonStr = JSON.stringify(report, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slug}-report.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadReportHtml(report: AnalysisReport): void {
  const slug = (report.paper_title || 'papertrail')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'papertrail'
  const htmlStr = generateHtmlReport(report)
  const blob = new Blob([htmlStr], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slug}-report.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
