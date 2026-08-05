/**
 * Tera Term gettime / getdate 向けの簡易 strftime（Microsoft 系の主要指定子）。
 * ドライラン専用。静的解析では使わない。
 *
 * @see https://teratermproject.github.io/manual/5/en/macro/command/gettime.html
 * @see https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/strftime-wcsftime-strftime-l-wcsftime-l
 */

/** 公式: 生成文字列の上限（これを超えると result=1 で未格納） */
export const TTL_DATETIME_MAX_LEN = 511

export type TtlDateTimeZoneMode = 'local' | 'utc'

export type FormatTtlDateTimeResult =
  | { ok: true; value: string; result: 0; timezoneNote?: string }
  | { ok: false; result: 1 | 2; timezoneNote?: string }

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const
const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** 対応する変換指定子（`#` 付きを含む）。未対応は result=2 */
const SUPPORTED = new Set([
  'a',
  'A',
  'b',
  'B',
  'c',
  'd',
  'H',
  'I',
  'j',
  'm',
  'M',
  'p',
  'S',
  'U',
  'w',
  'W',
  'x',
  'X',
  'y',
  'Y',
  'z',
  'Z',
  '%',
])

export function defaultGettimeFormat(): string {
  return '%H:%M:%S'
}

export function defaultGetdateFormat(): string {
  return '%Y-%m-%d'
}

/**
 * timezone 引数を解釈する。
 * GMT/UTC 以外の Windows タイムゾーン名はブラウザでは完全再現できないため、
 * ローカル時刻へフォールバックし note を返す。
 */
export function resolveTtlTimezone(timezone: string | undefined): {
  mode: TtlDateTimeZoneMode
  note?: string
} {
  if (timezone === undefined || timezone.trim() === '') return { mode: 'local' }
  const t = timezone.trim()
  const upper = t.toUpperCase()
  if (upper === 'GMT' || upper === 'UTC' || upper === 'UTC+0' || upper === 'UTC-0' || upper === 'Z') {
    return { mode: 'utc' }
  }
  return {
    mode: 'local',
    note: `タイムゾーン '${t}' はドライランでは未対応のためローカル時刻を使用`,
  }
}

function pad2(n: number, hash: boolean): string {
  if (hash) return String(n)
  return n < 10 ? `0${n}` : String(n)
}

function pad3(n: number): string {
  if (n < 10) return `00${n}`
  if (n < 100) return `0${n}`
  return String(n)
}

function dayOfYear(date: Date, utc: boolean): number {
  const y = utc ? date.getUTCFullYear() : date.getFullYear()
  const start = utc ? Date.UTC(y, 0, 0) : new Date(y, 0, 0).getTime()
  const now = utc
    ? Date.UTC(y, date.getUTCMonth(), date.getUTCDate())
    : new Date(y, date.getMonth(), date.getDate()).getTime()
  return Math.floor((now - start) / 86_400_000)
}

/** 日曜始まりの週番号 %U（0–53） */
function weekNumberSunday(date: Date, utc: boolean): number {
  const y = utc ? date.getUTCFullYear() : date.getFullYear()
  const jan1 = utc ? new Date(Date.UTC(y, 0, 1)) : new Date(y, 0, 1)
  const jan1Dow = utc ? jan1.getUTCDay() : jan1.getDay()
  const doy = dayOfYear(date, utc)
  return Math.floor((doy + jan1Dow) / 7)
}

/** 月曜始まりの週番号 %W（0–53） */
function weekNumberMonday(date: Date, utc: boolean): number {
  const y = utc ? date.getUTCFullYear() : date.getFullYear()
  const jan1 = utc ? new Date(Date.UTC(y, 0, 1)) : new Date(y, 0, 1)
  const jan1Dow = utc ? jan1.getUTCDay() : jan1.getDay()
  const mondayBased = (jan1Dow + 6) % 7
  const doy = dayOfYear(date, utc)
  return Math.floor((doy + mondayBased) / 7)
}

function timezoneOffsetString(date: Date, utc: boolean): string {
  if (utc) return '+0000'
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const hh = Math.floor(abs / 60)
  const mm = abs % 60
  return `${sign}${pad2(hh, false)}${pad2(mm, false)}`
}

function convertOne(
  spec: string,
  hash: boolean,
  date: Date,
  utc: boolean,
): string | undefined {
  const year = utc ? date.getUTCFullYear() : date.getFullYear()
  const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1
  const day = utc ? date.getUTCDate() : date.getDate()
  const hours = utc ? date.getUTCHours() : date.getHours()
  const minutes = utc ? date.getUTCMinutes() : date.getMinutes()
  const seconds = utc ? date.getUTCSeconds() : date.getSeconds()
  const dow = utc ? date.getUTCDay() : date.getDay()
  const hours12 = hours % 12 === 0 ? 12 : hours % 12

  switch (spec) {
    case 'a':
      return WEEKDAY_SHORT[dow]
    case 'A':
      return WEEKDAY_LONG[dow]
    case 'b':
      return MONTH_SHORT[month - 1]
    case 'B':
      return MONTH_LONG[month - 1]
    case 'c':
      return `${WEEKDAY_SHORT[dow]} ${MONTH_SHORT[month - 1]} ${pad2(day, false)} ${pad2(hours, false)}:${pad2(minutes, false)}:${pad2(seconds, false)} ${year}`
    case 'd':
      return pad2(day, hash)
    case 'H':
      return pad2(hours, hash)
    case 'I':
      return pad2(hours12, hash)
    case 'j':
      return pad3(dayOfYear(date, utc))
    case 'm':
      return pad2(month, hash)
    case 'M':
      return pad2(minutes, hash)
    case 'p':
      return hours < 12 ? 'AM' : 'PM'
    case 'S':
      return pad2(seconds, hash)
    case 'U':
      return pad2(weekNumberSunday(date, utc), hash)
    case 'w':
      return String(dow)
    case 'W':
      return pad2(weekNumberMonday(date, utc), hash)
    case 'x':
      return `${pad2(month, false)}/${pad2(day, false)}/${String(year).slice(-2)}`
    case 'X':
      return `${pad2(hours, false)}:${pad2(minutes, false)}:${pad2(seconds, false)}`
    case 'y':
      return pad2(year % 100, hash)
    case 'Y':
      return String(year)
    case 'z':
      return timezoneOffsetString(date, utc)
    case 'Z':
      // MSVC / Tera Term はタイムゾーン略称（例: JST）。ブラウザでは正式名を取れないため簡略化する。
      return utc ? 'UTC' : 'LOCAL'
    case '%':
      return '%'
    default:
      return undefined
  }
}

/**
 * format を展開する。未対応の `%` 指定子や末尾の単独 `%` は result=2。
 */
export function formatTtlDateTime(
  format: string,
  date: Date,
  mode: TtlDateTimeZoneMode,
  timezoneNote?: string,
): FormatTtlDateTimeResult {
  const utc = mode === 'utc'
  let out = ''
  for (let i = 0; i < format.length; i++) {
    const ch = format[i]!
    if (ch !== '%') {
      out += ch
      continue
    }
    if (i + 1 >= format.length) {
      return { ok: false, result: 2, timezoneNote }
    }
    let j = i + 1
    let hash = false
    if (format[j] === '#') {
      hash = true
      j++
      if (j >= format.length) return { ok: false, result: 2, timezoneNote }
    }
    const spec = format[j]!
    if (!SUPPORTED.has(spec)) {
      return { ok: false, result: 2, timezoneNote }
    }
    const piece = convertOne(spec, hash, date, utc)
    if (piece === undefined) return { ok: false, result: 2, timezoneNote }
    out += piece
    i = j
  }

  if (out.length > TTL_DATETIME_MAX_LEN) {
    return { ok: false, result: 1, timezoneNote }
  }
  return { ok: true, value: out, result: 0, timezoneNote }
}

export function formatGettime(
  format: string | undefined,
  date: Date,
  timezone?: string,
): FormatTtlDateTimeResult {
  const { mode, note } = resolveTtlTimezone(timezone)
  return formatTtlDateTime(format ?? defaultGettimeFormat(), date, mode, note)
}

export function formatGetdate(
  format: string | undefined,
  date: Date,
  timezone?: string,
): FormatTtlDateTimeResult {
  const { mode, note } = resolveTtlTimezone(timezone)
  return formatTtlDateTime(format ?? defaultGetdateFormat(), date, mode, note)
}
