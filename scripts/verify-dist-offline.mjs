import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDistOfflineInvariants } from './dist-offline-invariants.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
assertDistOfflineInvariants(resolve(root, 'dist'))
console.log('dist/ は file:// 直開き向けです。')
