/**
 * マクロ起動時のコマンドライン系システム変数（Manual 5）。
 * 出典: https://teratermproject.github.io/manual/5/en/macro/commandline.html
 *       https://teratermproject.github.io/manual/5/ja/macro/commandline.html
 *
 * result（コマンド副作用）とは別 SSOT。起動時にだけ決まる params / param1〜9 / paramcnt を扱う。
 *
 * エディタ既定（方針 A）: 起動引数未指定なら paramcnt=0・param* 空・params[0] 未設定。
 * ファイル名を常に入れる挙動（方針 B）は dryRun オプション等で後から opt-in する。
 */

/** 構造化した起動引数（params[0]/params[1]/params[2..] に対応） */
export type MacroLaunchArgv = {
  /** → params[0]。省略時は TTPMACRO.EXE 風に合成 */
  commandLine?: string
  /** → params[1] / param1。パス付きでも basename のみ格納（公式どおり） */
  macroFileName?: string
  /** → params[2..] / param2.. */
  args?: string[]
}

/**
 * 後方互換の string[] 形式: [マクロファイル名, 引数1, 引数2, ...]
 * （params[1], params[2], ... に対応。params[0] は合成）
 */
export type MacroArgvInput = string[] | MacroLaunchArgv

export type CommandLineParamsSnapshot = {
  /** 起動引数が明示されたか（エディタ未指定の方針 A では false） */
  specified: boolean
  /** 公式: params[1]（ファイル名）を含む個数。params[0] は含めない */
  paramcnt: number
  /** params[i]。未指定時は空。指定時は 0=コマンドライン全体, 1=ファイル名, 2..=引数 */
  params: ReadonlyMap<number, string>
  /** param1..param9（足りない分は空文字） */
  param1to9: readonly string[]
}

const PARAM_SET_BY = 'マクロ起動時（コマンドライン）'
const UNSPECIFIED_NOTE = 'エディタでは起動引数が未指定（方針 A）'

export function basenameMacroFile(pathOrName: string): string {
  const normalized = pathOrName.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || pathOrName
}

export function synthesizeCommandLine(macroFileName: string, args: readonly string[]): string {
  const parts = ['TTPMACRO.EXE']
  // 空のファイル名スロットも位置を保つ（後方互換 string[] の '' 先頭）
  parts.push(macroFileName === '' ? '""' : macroFileName)
  parts.push(...args)
  return parts.join(' ')
}

function emptyParam1to9(): string[] {
  return Array.from({ length: 9 }, () => '')
}

/** 入力を公式の params レイアウトへ正規化する */
export function buildCommandLineParamsSnapshot(input?: MacroArgvInput): CommandLineParamsSnapshot {
  if (input === undefined) {
    return { specified: false, paramcnt: 0, params: new Map(), param1to9: emptyParam1to9() }
  }

  if (Array.isArray(input)) {
    if (input.length === 0) {
      return { specified: false, paramcnt: 0, params: new Map(), param1to9: emptyParam1to9() }
    }
    // 先頭は常にファイル名スロット（空文字でも params[1]/paramcnt に含める）
    return snapshotFromParts({
      includeFileSlot: true,
      macroFileName: basenameMacroFile(input[0]!),
      args: input.slice(1),
      commandLine: undefined,
    })
  }

  const args = input.args ?? []
  const hasFileField = input.macroFileName !== undefined
  const rawFile = input.macroFileName
  if (!hasFileField && args.length === 0 && !input.commandLine?.trim()) {
    return { specified: false, paramcnt: 0, params: new Map(), param1to9: emptyParam1to9() }
  }
  const includeFileSlot = hasFileField || args.length > 0
  const file = hasFileField ? basenameMacroFile(rawFile ?? '') : ''
  return snapshotFromParts({
    includeFileSlot,
    macroFileName: file,
    args,
    commandLine: input.commandLine,
  })
}

function snapshotFromParts(opts: {
  /** ファイル名スロット（params[1]）を持つか。空文字でも true なら paramcnt に含める */
  includeFileSlot: boolean
  macroFileName: string
  args: readonly string[]
  commandLine: string | undefined
}): CommandLineParamsSnapshot {
  const { includeFileSlot, macroFileName: file, args, commandLine } = opts
  const params = new Map<number, string>()

  const cmdline =
    commandLine?.trim() ||
    (includeFileSlot ? synthesizeCommandLine(file, args) : commandLine?.trim() || '')

  if (cmdline) params.set(0, cmdline)
  if (includeFileSlot) params.set(1, file)
  args.forEach((arg, i) => params.set(i + 2, arg))

  // 公式: paramcnt は params[1]（ファイル名）を含む。空のファイル名スロットも 1 と数える。params[0] は含めない
  const paramcnt = (includeFileSlot ? 1 : 0) + args.length

  const param1to9 = emptyParam1to9()
  if (includeFileSlot) param1to9[0] = file
  for (let i = 0; i < Math.min(args.length, 8); i++) {
    param1to9[i + 1] = args[i]!
  }

  return { specified: true, paramcnt, params, param1to9 }
}

/** params[index] の公式意味（ホバー用） */
export function formatParamsIndexHoverNote(index: number): string {
  if (index === 0) {
    return `params[0] — コマンドライン文字列全体。${PARAM_SET_BY}`
  }
  if (index === 1) {
    return `params[1] — マクロファイル名（パス除く）。${PARAM_SET_BY}`
  }
  if (index >= 2) {
    return `params[${index}] — マクロへ渡した引数 #${index - 1}。${PARAM_SET_BY}`
  }
  return PARAM_SET_BY
}

/** param1..param9 の公式意味（ホバー用） */
export function formatParamNHoverNote(n: number): string {
  if (n === 1) {
    return `param1 — マクロファイル名（params[1] と同じ）。${PARAM_SET_BY}`
  }
  if (n >= 2 && n <= 9) {
    return `param${n} — params[${n}] と同じ（マクロ引数）。params[10] 以降に相当する変数はない`
  }
  return PARAM_SET_BY
}

export function formatParamcntHoverNote(specified: boolean): string {
  const base =
    'paramcnt — params に格納されたパラメータ数（マクロファイル名 params[1] を含む。params[0] は含めない）'
  if (!specified) return `${base}。${UNSPECIFIED_NOTE}`
  return `${base}。${PARAM_SET_BY}`
}

export function formatParamsArrayHoverNote(specified: boolean): string {
  const base = 'params — 起動時パラメータ配列（[0]=コマンドライン全体 / [1]=ファイル名 / [2]..=引数）'
  if (!specified) return `${base}。${UNSPECIFIED_NOTE}`
  return `${base}。${PARAM_SET_BY}`
}

export function getParamNMeta(n: number): { description: string; setBy: string; defaultHint: string } {
  if (n === 1) {
    return {
      description: 'マクロファイル名（params[1] と同じ・パス除く）',
      setBy: PARAM_SET_BY,
      defaultHint: '空文字（起動引数未指定）',
    }
  }
  return {
    description: `マクロ起動引数（params[${n}] と同じ）`,
    setBy: PARAM_SET_BY,
    defaultHint: '空文字（起動引数未指定）',
  }
}

export function getParamcntMeta(): { description: string; setBy: string; defaultHint: string } {
  return {
    description: '起動パラメータ数（ファイル名 params[1] を含む。params[0] は含めない）',
    setBy: PARAM_SET_BY,
    defaultHint: '0（起動引数未指定）',
  }
}

export function getParamsArrayMeta(): { description: string; setBy: string; defaultHint: string } {
  return {
    description: '起動時パラメータ配列（[0]=コマンドライン / [1]=ファイル名 / [2]..=引数）',
    setBy: PARAM_SET_BY,
    defaultHint: '未設定（起動引数未指定）',
  }
}

export function isUnspecifiedCommandLine(snapshot: CommandLineParamsSnapshot): boolean {
  return !snapshot.specified
}
