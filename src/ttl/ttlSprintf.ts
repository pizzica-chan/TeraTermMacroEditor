/**
 * TTL sprintf / sprintf2 の書式評価（公式 Manual 5 の主要サブセット）
 * @see https://teratermproject.github.io/manual/5/en/macro/command/sprintf2.html
 *
 * 対応: %% / %s / %c / %d %i %u %o %x %X / 浮動小数（引数は文字列）%e %E %f %g %G %a %A
 * フラグ -, +, 0, #, 空白 / 幅・精度（数値または *）
 *
 * 近似（C printf と一致しない箇所）:
 * - %g / %G … `Number#toPrecision` ベース（%f/%e の自動切替ではない）
 * - %a / %A … hex float ではなく指数表記（`toExponential`）で近似
 */

export type SprintfArg = { kind: 'int'; value: number } | { kind: 'str'; value: string }

/** 公式 result: 0=成功 / 1=書式なし / 2=書式不正 / 3=引数不正 */
export type SprintfFormatResultCode = 0 | 1 | 2 | 3

export type SprintfFormatOutcome =
  | { result: 0; value: string }
  | { result: 1 | 2 | 3; value: string }

const TYPE_CHARS = 'diouxXeEfFgGaAcs'

function isFlag(ch: string): boolean {
  return ch === '-' || ch === '+' || ch === '0' || ch === '#' || ch === ' '
}

function padAligned(text: string, width: number | undefined, flags: string): string {
  if (width === undefined || width <= text.length) return text
  const padLen = width - text.length
  const padChar = flags.includes('-') ? ' ' : flags.includes('0') && !flags.includes('-') ? '0' : ' '
  if (flags.includes('-')) return text + ' '.repeat(padLen)
  if (padChar === '0' && /^[+-]/.test(text)) {
    return text[0]! + '0'.repeat(padLen) + text.slice(1)
  }
  if (padChar === '0' && /^(0[xX]|0)/.test(text) && flags.includes('#')) {
    // 0x 系はプレフィックス後にゼロ埋め
    if (/^0[xX]/.test(text)) return text.slice(0, 2) + '0'.repeat(padLen) + text.slice(2)
  }
  return padChar.repeat(padLen) + text
}

function applySign(absText: string, negative: boolean, flags: string): string {
  if (negative) return `-${absText}`
  if (flags.includes('+')) return `+${absText}`
  if (flags.includes(' ')) return ` ${absText}`
  return absText
}

function toInt32(n: number): number {
  return n | 0
}

function toUint32(n: number): number {
  return n >>> 0
}

function takeArg(args: SprintfArg[], index: { i: number }): SprintfArg | undefined {
  if (index.i >= args.length) return undefined
  return args[index.i++]
}

function asInt(arg: SprintfArg | undefined): number | undefined {
  if (!arg) return undefined
  if (arg.kind === 'int') return arg.value
  const t = arg.value.trim()
  if (t === '') return undefined
  // 公式: 型に合わせて変換。10 進 / 0x を許容
  if (/^[-+]?\d+$/.test(t)) return Number(t)
  if (/^[-+]?0[xX][0-9a-fA-F]+$/.test(t)) return Number(t)
  return undefined
}

function asStr(arg: SprintfArg | undefined): string | undefined {
  if (!arg) return undefined
  if (arg.kind === 'str') return arg.value
  return String(arg.value)
}

function formatInteger(
  raw: number,
  type: string,
  flags: string,
  width: number | undefined,
  precision: number | undefined,
): string {
  let body: string
  let negative = false

  if (type === 'd' || type === 'i') {
    const v = toInt32(raw)
    negative = v < 0
    const abs = Math.abs(v)
    body = abs.toString(10)
    if (precision !== undefined) body = body.padStart(precision, '0')
    body = applySign(body, negative, flags)
  } else if (type === 'u') {
    body = toUint32(raw).toString(10)
    if (precision !== undefined) body = body.padStart(precision, '0')
  } else if (type === 'o') {
    body = toUint32(raw).toString(8)
    if (precision !== undefined) body = body.padStart(precision, '0')
    if (flags.includes('#') && body !== '0') body = `0${body}`
  } else if (type === 'x' || type === 'X') {
    body = toUint32(raw).toString(16)
    if (type === 'X') body = body.toUpperCase()
    if (precision !== undefined) body = body.padStart(precision, '0')
    if (flags.includes('#') && toUint32(raw) !== 0) {
      body = (type === 'X' ? '0X' : '0x') + body
    }
  } else {
    body = String(raw)
  }

  // precision 指定時の 0 フラグは無効（C に近い）
  const padFlags = precision !== undefined ? flags.replace(/0/g, '') : flags
  return padAligned(body, width, padFlags)
}

function formatFloat(
  rawStr: string,
  type: string,
  flags: string,
  width: number | undefined,
  precision: number | undefined,
): string | undefined {
  const n = Number(rawStr.trim())
  if (!Number.isFinite(n)) return undefined
  const prec = precision ?? 6
  let body: string
  switch (type) {
    case 'f':
    case 'F':
      body = n.toFixed(prec)
      break
    case 'e':
      body = n.toExponential(prec)
      break
    case 'E':
      body = n.toExponential(prec).toUpperCase()
      break
    case 'g':
    case 'G': {
      // 近似: C の %g（%f/%e 自動選択）ではなく toPrecision
      body = n.toPrecision(prec === 0 ? 1 : prec)
      if (type === 'G') body = body.toUpperCase()
      break
    }
    case 'a':
    case 'A':
      // 近似: C の hex float (%a) ではなく指数表記
      body = n.toExponential(prec)
      if (type === 'A') body = body.toUpperCase()
      break
    default:
      return undefined
  }
  if (n >= 0) {
    if (flags.includes('+')) body = `+${body}`
    else if (flags.includes(' ')) body = ` ${body}`
  }
  const padFlags = flags.includes('-') ? flags.replace(/0/g, '') : flags
  return padAligned(body, width, padFlags)
}

/**
 * C printf 風に format と引数から文字列を組み立てる。
 * 引数が足りない・型が合わない → result 3
 * 不正な % シーケンス → result 2
 * 空の format → result 1
 *
 * %g/%G/%a/%A は上記ファイル先頭のとおり近似実装。
 */
export function formatTtlSprintf(format: string, args: SprintfArg[]): SprintfFormatOutcome {
  if (format === '') return { result: 1, value: '' }

  let out = ''
  const argIndex = { i: 0 }
  let i = 0

  while (i < format.length) {
    const ch = format[i]!
    if (ch !== '%') {
      out += ch
      i += 1
      continue
    }
    if (format[i + 1] === '%') {
      out += '%'
      i += 2
      continue
    }

    i += 1
    let flags = ''
    while (i < format.length && isFlag(format[i]!)) {
      flags += format[i]!
      i += 1
    }

    let width: number | undefined
    if (format[i] === '*') {
      const wArg = asInt(takeArg(args, argIndex))
      if (wArg === undefined) return { result: 3, value: '' }
      width = wArg
      i += 1
    } else if (i < format.length && format[i]! >= '0' && format[i]! <= '9') {
      let w = ''
      while (i < format.length && format[i]! >= '0' && format[i]! <= '9') {
        w += format[i]!
        i += 1
      }
      width = Number(w)
    }

    let precision: number | undefined
    if (format[i] === '.') {
      i += 1
      if (format[i] === '*') {
        const pArg = asInt(takeArg(args, argIndex))
        if (pArg === undefined) return { result: 3, value: '' }
        precision = Math.max(0, pArg)
        i += 1
      } else {
        let p = ''
        while (i < format.length && format[i]! >= '0' && format[i]! <= '9') {
          p += format[i]!
          i += 1
        }
        precision = p === '' ? 0 : Number(p)
      }
    }

    const type = format[i]
    if (!type || !TYPE_CHARS.includes(type)) {
      return { result: 2, value: '' }
    }
    i += 1

    if (type === 's') {
      const s = asStr(takeArg(args, argIndex))
      if (s === undefined) return { result: 3, value: '' }
      let text = s
      if (precision !== undefined) text = text.slice(0, precision)
      out += padAligned(text, width, flags.includes('0') ? flags.replace(/0/g, '') : flags)
      continue
    }

    if (type === 'c') {
      const code = asInt(takeArg(args, argIndex))
      if (code === undefined) return { result: 3, value: '' }
      out += padAligned(String.fromCharCode(code & 0xff), width, flags.replace(/0/g, ''))
      continue
    }

    if ('diouxX'.includes(type)) {
      const n = asInt(takeArg(args, argIndex))
      if (n === undefined) return { result: 3, value: '' }
      out += formatInteger(n, type, flags, width, precision)
      continue
    }

    // 浮動小数: 公式どおり文字列引数
    const fStr = asStr(takeArg(args, argIndex))
    if (fStr === undefined) return { result: 3, value: '' }
    const formatted = formatFloat(fStr, type, flags, width, precision)
    if (formatted === undefined) return { result: 3, value: '' }
    out += formatted
  }

  return { result: 0, value: out }
}
