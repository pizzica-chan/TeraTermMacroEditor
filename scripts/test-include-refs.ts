import { findIncludeRefs } from '../src/ttl/includeRefs'

const src = `bbb = ''
include bbb

kaisuu = 10
for i 0 kaisuu
  include host[i]
  sendln host[i]
next`

const refs = findIncludeRefs(src)
for (const r of refs) {
  const loop = r.loopContext
    ? `${r.loopContext.values.length} vals ${r.loopContext.start}-${r.loopContext.end}`
    : 'none'
  console.log(`L${r.line}`, r.raw, 'loop:', loop)
}
