import type { TextEncoding, NewlineType } from './types'
import { decodeBytes, encodeString, detectEncoding, findUnencodableChars } from './codec'
import { detectNewline, normalizeNewlines, applyNewline } from './newline'

export interface LoadedDocument {
  text: string
  encoding: TextEncoding
  newline: NewlineType
  rawBytes: Uint8Array
}

export class DocumentSettings {
  encoding: TextEncoding = 'UTF-8'
  newline: NewlineType = 'LF'
  private rawBytes: Uint8Array | null = null
  private dirty = false

  markDirty(): void {
    this.dirty = true
  }

  resetDirty(): void {
    this.dirty = false
  }

  isDirty(): boolean {
    return this.dirty
  }

  loadFromBytes(bytes: Uint8Array): LoadedDocument {
    this.rawBytes = bytes
    this.dirty = false
    this.encoding = detectEncoding(bytes)
    const decoded = decodeBytes(bytes, this.encoding)
    this.newline = detectNewline(decoded)
    const text = normalizeNewlines(decoded)
    return { text, encoding: this.encoding, newline: this.newline, rawBytes: bytes }
  }

  loadFromText(text: string, encoding: TextEncoding = 'UTF-8', newline: NewlineType = 'LF'): LoadedDocument {
    this.rawBytes = encodeString(normalizeNewlines(text), encoding)
    this.dirty = false
    this.encoding = encoding
    this.newline = newline
    return { text: normalizeNewlines(text), encoding, newline, rawBytes: this.rawBytes }
  }

  /** 文字コード切替（自動変換） */
  changeEncoding(currentText: string, newEncoding: TextEncoding): { text: string; warning?: string } {
    const oldEncoding = this.encoding
    if (oldEncoding === newEncoding) return { text: currentText }

    let newText: string
    if (!this.dirty && this.rawBytes) {
      // 未編集時は生バイトを新エンコーディングで再解釈
      newText = normalizeNewlines(decodeBytes(this.rawBytes, newEncoding))
    } else {
      // 編集済みの Unicode テキストはそのまま（保存時のエンコードのみ変更）
      newText = currentText
    }

    this.encoding = newEncoding

    const bad = findUnencodableChars(newText, newEncoding)
    const warning =
      bad.length > 0
        ? `${newEncoding} で表現できない文字があります: ${bad.slice(0, 5).join(' ')}${bad.length > 5 ? ' ...' : ''}`
        : undefined

    return { text: newText, warning }
  }

  /** 改行コード切替（自動変換） */
  changeNewline(currentText: string, newNewline: NewlineType): string {
    this.newline = newNewline
    return normalizeNewlines(currentText)
  }

  prepareSave(editorText: string): { bytes: Uint8Array; warning?: string } {
    const normalized = normalizeNewlines(editorText)
    const withNewline = applyNewline(normalized, this.newline)
    const bad = findUnencodableChars(withNewline, this.encoding)
    const bytes = encodeString(withNewline, this.encoding)
    this.rawBytes = bytes
    this.dirty = false
    return {
      bytes,
      warning:
        bad.length > 0
          ? `${this.encoding} で保存できない文字があります: ${bad.slice(0, 5).join(' ')}`
          : undefined,
    }
  }

  reset(): void {
    this.encoding = 'UTF-8'
    this.newline = 'LF'
    this.rawBytes = null
    this.dirty = false
  }
}
