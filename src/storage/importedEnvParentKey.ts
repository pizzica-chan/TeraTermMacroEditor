/** `${親タブID}:${include行}`。親タブIDは末尾の `:` より前（ID にコロンがあってもよい） */

export function importedEnvParentKey(parentTabId: string, includeLine: number): string {
  return `${parentTabId}:${includeLine}`
}

export function parseImportedEnvParentKey(
  key: string,
): { parentTabId: string; includeLine: number } | undefined {
  const sep = key.lastIndexOf(':')
  if (sep <= 0 || sep >= key.length - 1) return undefined
  const parentTabId = key.slice(0, sep)
  const linePart = key.slice(sep + 1)
  if (!parentTabId || !/^[1-9]\d*$/.test(linePart)) return undefined
  return { parentTabId, includeLine: Number(linePart) }
}

export function isImportedEnvParentKeyForTab(key: string | undefined, tabId: string): boolean {
  if (!key) return false
  return parseImportedEnvParentKey(key)?.parentTabId === tabId
}

export function sanitizeImportedEnvParentKey(
  key: unknown,
  tabIds: ReadonlySet<string>,
): string | undefined {
  if (typeof key !== 'string') return undefined
  const parsed = parseImportedEnvParentKey(key)
  if (!parsed || !tabIds.has(parsed.parentTabId)) return undefined
  return key
}
