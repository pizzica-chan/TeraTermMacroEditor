import { StateEffect, StateField, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { AnalysisResult, IncludeResolver } from './analyzer'
import type { EvaluationResult } from './evaluator'

let currentResolver: IncludeResolver | undefined
let externallyUsedNames: ReadonlySet<string> | undefined

let cachedSource = ''
let cachedAnalysis: AnalysisResult | null = null
let cachedEvaluation: EvaluationResult | null = null

export const bumpIncludeGraphRevisionEffect = StateEffect.define<void>()
export const bumpAnalysisCacheRevisionEffect = StateEffect.define<void>()

export const includeGraphRevisionField = StateField.define<number>({
  create: () => 0,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(bumpIncludeGraphRevisionEffect)) return value + 1
    }
    return value
  },
})

export const analysisCacheRevisionField = StateField.define<number>({
  create: () => 0,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(bumpAnalysisCacheRevisionEffect)) return value + 1
    }
    return value
  },
})

export function bumpIncludeGraphRevision(view: EditorView): void {
  view.dispatch({ effects: bumpIncludeGraphRevisionEffect.of() })
}

export function bumpAnalysisCacheRevision(view: EditorView): void {
  view.dispatch({ effects: bumpAnalysisCacheRevisionEffect.of() })
}

export function setIncludeResolver(resolver: IncludeResolver | undefined): void {
  currentResolver = resolver
}

export function getIncludeResolver(): IncludeResolver | undefined {
  return currentResolver
}

export function setExternallyUsedNames(names: ReadonlySet<string> | undefined): void {
  externallyUsedNames = names
}

export function getExternallyUsedNames(): ReadonlySet<string> | undefined {
  return externallyUsedNames
}

export function setAnalysisCache(
  source: string,
  analysis: AnalysisResult,
  evaluation: EvaluationResult,
): void {
  cachedSource = source
  cachedAnalysis = analysis
  cachedEvaluation = evaluation
}

export function getCachedAnalysis(source: string): AnalysisResult | null {
  return source === cachedSource ? cachedAnalysis : null
}

export function getCachedEvaluation(source: string): EvaluationResult | null {
  return source === cachedSource ? cachedEvaluation : null
}

export function clearAnalysisCache(): void {
  cachedSource = ''
  cachedAnalysis = null
  cachedEvaluation = null
}

export const includeGraphRevisionExtension: Extension = [
  includeGraphRevisionField,
  analysisCacheRevisionField,
]
