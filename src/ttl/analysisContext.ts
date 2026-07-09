import { StateEffect, StateField, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { IncludeResolver } from './analyzer'

let currentResolver: IncludeResolver | undefined
let externallyUsedNames: ReadonlySet<string> | undefined

export const bumpIncludeGraphRevisionEffect = StateEffect.define<void>()

export const includeGraphRevisionField = StateField.define<number>({
  create: () => 0,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(bumpIncludeGraphRevisionEffect)) return value + 1
    }
    return value
  },
})

export function bumpIncludeGraphRevision(view: EditorView): void {
  view.dispatch({ effects: bumpIncludeGraphRevisionEffect.of() })
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

export const includeGraphRevisionExtension: Extension = includeGraphRevisionField
