import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { isCommand, isKeyword, isSystemVariable } from './commands'

type State = {
  inBlockComment: boolean
}

const ttlLanguage = StreamLanguage.define<State>({
  name: 'ttl',
  startState: () => ({ inBlockComment: false }),

  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.match('*/')) {
        state.inBlockComment = false
        return 'comment'
      }
      stream.next()
      return 'comment'
    }

    if (stream.eatSpace()) return null

    // Block comment start
    if (stream.match('/*')) {
      state.inBlockComment = true
      return 'comment'
    }

    // Line comment
    if (stream.match(';')) {
      stream.skipToEnd()
      return 'comment'
    }

    // Label
    if (stream.sol() && stream.match(':')) {
      stream.eatWhile(/[\w]/)
      return 'labelName'
    }

    // String literal (single or double quoted)
    if (stream.match(/['"]/)) {
      const quote = stream.current()
      while (!stream.eol()) {
        if (stream.next() === quote) break
      }
      return 'string'
    }

    // Number
    if (stream.match(/-?\d+(\.\d+)?/)) {
      return 'number'
    }

    // Identifier / keyword / command
    if (stream.match(/[a-zA-Z_][\w]*/)) {
      const word = stream.current()
      const lower = word.toLowerCase()

      if (isKeyword(lower)) return 'keyword'
      if (isCommand(lower)) return 'className'
      if (isSystemVariable(lower)) return 'typeName'
      if (lower === 'then') return 'keyword'

      return 'variableName'
    }

    // Operators
    if (stream.match(/<>|>=|<=|:=|[=<>+\-*/%#]/)) {
      return 'operator'
    }

    stream.next()
    return null
  },

  languageData: {
    commentTokens: { line: ';', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ["'", '"'] },
  },
})

export { ttlLanguage }

export const ttlHighlightDark = HighlightStyle.define([
  { tag: t.comment, color: '#6a9955' },
  { tag: t.string, color: '#ce9178' },
  { tag: t.number, color: '#b5cea8' },
  { tag: t.keyword, color: '#c586c0', fontWeight: 'bold' },
  { tag: t.className, color: '#dcdcaa' },
  { tag: t.variableName, color: '#9cdcfe' },
  { tag: t.typeName, color: '#4ec9b0' },
  { tag: t.labelName, color: '#d7ba7d' },
  { tag: t.operator, color: '#d4d4d4' },
], { themeType: 'dark' })

export const ttlHighlightLight = HighlightStyle.define([
  { tag: t.comment, color: '#5f7d52' },
  { tag: t.string, color: '#8b5a3c' },
  { tag: t.number, color: '#4a7c59' },
  { tag: t.keyword, color: '#7b4e9e', fontWeight: 'bold' },
  { tag: t.className, color: '#7a6f2e' },
  { tag: t.variableName, color: '#2d6a8a' },
  { tag: t.typeName, color: '#2a7a6f' },
  { tag: t.labelName, color: '#8a6d2f' },
  { tag: t.operator, color: '#4a4845' },
], { themeType: 'light' })

export const ttlHighlightExtension = [
  syntaxHighlighting(ttlHighlightDark),
  syntaxHighlighting(ttlHighlightLight),
]
