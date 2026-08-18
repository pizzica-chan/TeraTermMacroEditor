import { DocumentSettings } from '../text/documentSettings'
import type { TextEncoding, NewlineType } from '../text/types'
import {
  isUnresolvedValueDisplay,
  type UnresolvedValueDisplay,
} from '../ttl/unresolvedDisplay'

export interface AppSettings {
  isDark: boolean
  defaultEncoding: TextEncoding
  defaultNewline: NewlineType
  sidePanelWidth: number
  flowchartShowDetailedWaits: boolean
  flowchartShowAssignments: boolean
  /** send 系の前に flushrecv があるか（flushrecv→wait 系の並び、およびその間の 2 つ目以降の send） */
  checkFlushrecvBeforeSend: boolean
  /** 連続する send / sendln の間に wait 系またはダイアログがあるか */
  checkConsecutiveSend: boolean
  /** 静的解析の未確定値を連結式で出すか、文字列へ埋め込んで出すか */
  unresolvedValueDisplay: UnresolvedValueDisplay
}

const STORAGE_KEY = 'ttl-macro-editor-settings'

const DEFAULTS: AppSettings = {
  isDark: true,
  defaultEncoding: 'UTF-8',
  defaultNewline: 'LF',
  sidePanelWidth: 440,
  flowchartShowDetailedWaits: false,
  flowchartShowAssignments: false,
  checkFlushrecvBeforeSend: false,
  checkConsecutiveSend: false,
  unresolvedValueDisplay: 'expression',
}

function isEncoding(v: unknown): v is TextEncoding {
  return v === 'UTF-8' || v === 'SJIS'
}

function isNewline(v: unknown): v is NewlineType {
  return v === 'LF' || v === 'CRLF' || v === 'CR'
}

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      isDark: typeof parsed.isDark === 'boolean' ? parsed.isDark : DEFAULTS.isDark,
      defaultEncoding: isEncoding(parsed.defaultEncoding) ? parsed.defaultEncoding : DEFAULTS.defaultEncoding,
      defaultNewline: isNewline(parsed.defaultNewline) ? parsed.defaultNewline : DEFAULTS.defaultNewline,
      sidePanelWidth:
        typeof parsed.sidePanelWidth === 'number' && parsed.sidePanelWidth >= 200 && parsed.sidePanelWidth <= 900
          ? parsed.sidePanelWidth
          : DEFAULTS.sidePanelWidth,
      flowchartShowDetailedWaits:
        typeof parsed.flowchartShowDetailedWaits === 'boolean'
          ? parsed.flowchartShowDetailedWaits
          : DEFAULTS.flowchartShowDetailedWaits,
      flowchartShowAssignments:
        typeof parsed.flowchartShowAssignments === 'boolean'
          ? parsed.flowchartShowAssignments
          : DEFAULTS.flowchartShowAssignments,
      checkFlushrecvBeforeSend:
        typeof parsed.checkFlushrecvBeforeSend === 'boolean'
          ? parsed.checkFlushrecvBeforeSend
          : DEFAULTS.checkFlushrecvBeforeSend,
      checkConsecutiveSend:
        typeof parsed.checkConsecutiveSend === 'boolean'
          ? parsed.checkConsecutiveSend
          : DEFAULTS.checkConsecutiveSend,
      unresolvedValueDisplay: isUnresolvedValueDisplay(parsed.unresolvedValueDisplay)
        ? parsed.unresolvedValueDisplay
        : DEFAULTS.unresolvedValueDisplay,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveAppSettings(partial: Partial<AppSettings>): void {
  const current = loadAppSettings()
  const next = { ...current, ...partial }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // localStorage 不可時は無視
  }
}

export function createDefaultDocumentSettings(): DocumentSettings {
  const settings = loadAppSettings()
  const doc = new DocumentSettings()
  doc.encoding = settings.defaultEncoding
  doc.newline = settings.defaultNewline
  return doc
}
