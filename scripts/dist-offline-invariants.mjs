import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * dist/ が file:// 直開き（HTTP サーバー不要）向けか検証する。
 * @returns {string[]} エラーメッセージの配列（空なら OK）
 */
export function validateDistOfflineInvariants(distDir) {
  const errors = []
  const htmlPath = join(distDir, 'index.html')

  if (!existsSync(htmlPath)) {
    return ['dist/index.html が存在しません']
  }

  const html = readFileSync(htmlPath, 'utf8')

  if (/<script[^>]+type="module"/i.test(html)) {
    errors.push('ES module の script があります（file:// では外部 module が読めません）')
  }
  if (/<link[^>]+href=["'][^"']*assets\/[^"']+\.css["']/i.test(html)) {
    errors.push('外部 CSS の link があります（index.html へのインライン化が必要です）')
  }
  if (!/<style>[\s\S]+<\/style>/i.test(html)) {
    errors.push('CSS が index.html にインライン化されていません')
  }
  if (!/<script defer src="\.\/assets\/app\.js"><\/script>/.test(html)) {
    errors.push('script は <script defer src="./assets/app.js"></script> である必要があります')
  }

  const appIdx = html.indexOf('id="app"')
  const scriptIdx = html.indexOf('<script defer src="./assets/app.js">')
  if (appIdx === -1 || scriptIdx === -1 || scriptIdx <= appIdx) {
    errors.push('#app 要素の後ろに app.js の script を配置してください')
  }

  const jsPath = join(distDir, 'assets/app.js')
  if (!existsSync(jsPath)) {
    errors.push('dist/assets/app.js が存在しません')
  }

  return errors
}

export function assertDistOfflineInvariants(distDir) {
  const errors = validateDistOfflineInvariants(distDir)
  if (errors.length > 0) {
    throw new Error(
      `dist/ は file:// オフライン配布向けではありません:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    )
  }
}
