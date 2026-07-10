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

export const ttlLinter = linter(
  (view) => {
    const source = view.state.doc.toString()
    const cached = getCachedAnalysis(source)
    const result =
      cached ??
      analyzeTTL(source, {
        includeResolver: getIncludeResolver(),
        externallyUsedNames: getExternallyUsedNames(),
      })
    return result.diagnostics.map((d) => ({
      from: view.state.doc.line(d.line).from + d.column,
      to: view.state.doc.line(d.line).from + (d.endColumn ?? d.column + 1),
      severity: toSeverity(d.severity),
      message: d.message,
    }))
  },
  {
    delay: 300,
    needsRefresh: (update) =>
      update.docChanged ||
      update.startState.field(includeGraphRevisionField) !== update.state.field(includeGraphRevisionField) ||
      update.startState.field(analysisCacheRevisionField) !== update.state.field(analysisCacheRevisionField),
  },
)
