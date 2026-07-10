import { linter, type Diagnostic as CMDiagnostic } from '@codemirror/lint'
import { analyzeTTL } from './analyzer'
import {
  analysisCacheRevisionField,
  getCachedAnalysis,
  getExternallyUsedNames,
  getIncludeResolver,
  includeGraphRevisionField,
} from './analysisContext'

function toSeverity(sev: 'error' | 'warning' | 'info'): CMDiagnostic['severity'] {
  if (sev === 'error') return 'error'
  if (sev === 'warning') return 'warning'
  return 'info'
}

function mapDiagnostics(
  doc: { lines: number; line: (n: number) => { from: number } },
  diagnostics: ReturnType<typeof analyzeTTL>['diagnostics'],
): CMDiagnostic[] {
  const mapped: CMDiagnostic[] = []
  for (const d of diagnostics) {
    if (d.line < 1 || d.line > doc.lines) continue
    try {
      const line = doc.line(d.line)
      mapped.push({
        from: line.from + d.column,
        to: line.from + (d.endColumn ?? d.column + 1),
        severity: toSeverity(d.severity),
        message: d.message,
      })
    } catch {
      // 行番号が範囲外の診断はスキップ（include 先など）
    }
  }
  return mapped
}

export const ttlLinter = linter(
  (view) => {
    const source = view.state.doc.toString()
    const result =
      getCachedAnalysis(source) ??
      analyzeTTL(source, {
        includeResolver: getIncludeResolver(),
        externallyUsedNames: getExternallyUsedNames(),
      })
    return mapDiagnostics(view.state.doc, result.diagnostics)
  },
  {
    delay: 300,
    needsRefresh: (update) =>
      update.docChanged ||
      update.startState.field(includeGraphRevisionField) !== update.state.field(includeGraphRevisionField) ||
      update.startState.field(analysisCacheRevisionField) !== update.state.field(analysisCacheRevisionField),
  },
)
