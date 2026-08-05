import {
  TTL_DATETIME_MAX_LEN,
  formatGetdate,
  formatGettime,
  formatTtlDateTime,
  resolveTtlTimezone,
} from '../src/ttl/ttlDateTime'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    console.log(`  OK  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('=== ttlDateTime（gettime/getdate 書式） ===')

const fixed = new Date(Date.UTC(2024, 0, 7, 15, 8, 9)) // 2024-01-07 15:08:09 UTC = Sun

{
  const r = formatTtlDateTime('%%', fixed, 'utc')
  check('%% is literal percent', r.ok && r.value === '%', r.ok ? r.value : `result=${r.result}`)
}

{
  const padded = formatTtlDateTime('%d', fixed, 'utc')
  const hash = formatTtlDateTime('%#d', fixed, 'utc')
  check('%d pads day', padded.ok && padded.value === '07', padded.ok ? padded.value : undefined)
  check('%#d strips leading zero', hash.ok && hash.value === '7', hash.ok ? hash.value : undefined)
}

{
  const y = formatTtlDateTime('%Y-%m-%d %H:%M:%S', fixed, 'utc')
  check(
    'UTC Y-m-d H:M:S',
    y.ok && y.value === '2024-01-07 15:08:09',
    y.ok ? y.value : `result=${y.result}`,
  )
}

{
  const bad = formatTtlDateTime('%Q', fixed, 'local')
  check('unsupported specifier → result=2', !bad.ok && bad.result === 2)
}

{
  const trailing = formatTtlDateTime('end%', fixed, 'local')
  check('trailing % → result=2', !trailing.ok && trailing.result === 2)
}

{
  const long = 'x'.repeat(TTL_DATETIME_MAX_LEN) + '%Y'
  const over = formatTtlDateTime(long, fixed, 'utc')
  check('over 511 chars → result=1', !over.ok && over.result === 1)
}

{
  const okLen = formatTtlDateTime('%Y', fixed, 'utc')
  check('short format ok', okLen.ok && okLen.value === '2024', okLen.ok ? okLen.value : undefined)
}

{
  const gmt = resolveTtlTimezone('GMT')
  const utc = resolveTtlTimezone('UTC')
  const win = resolveTtlTimezone('Tokyo Standard Time')
  check('GMT → utc mode', gmt.mode === 'utc' && gmt.note === undefined)
  check('UTC → utc mode', utc.mode === 'utc')
  check(
    'Windows TZ falls back to local with note',
    win.mode === 'local' && typeof win.note === 'string' && win.note.includes('Tokyo'),
    win.note,
  )
}

{
  const d = formatGetdate(undefined, fixed, 'GMT')
  check('getdate default with GMT', d.ok && d.value === '2024-01-07', d.ok ? d.value : undefined)
  const t = formatGettime(undefined, fixed, 'GMT')
  check('gettime default with GMT', t.ok && t.value === '15:08:09', t.ok ? t.value : undefined)
}

{
  const z = formatTtlDateTime('%Z', fixed, 'utc')
  const zLocal = formatTtlDateTime('%Z', fixed, 'local')
  check('%Z utc is UTC', z.ok && z.value === 'UTC', z.ok ? z.value : undefined)
  check('%Z local is LOCAL (simplified)', zLocal.ok && zLocal.value === 'LOCAL', zLocal.ok ? zLocal.value : undefined)
}

console.log(`\n=== TTL DATETIME: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
