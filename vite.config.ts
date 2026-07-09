import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const base = './'

function assetRelativePath(href: string): string {
  const assetsIndex = href.indexOf('assets/')
  if (assetsIndex >= 0) return href.slice(assetsIndex)
  return href.replace(/^\.\//, '')
}

/** 配布向け HTML 調整 — CSS インライン化、classic script を #app の後ろへ */
function fixDistHtml(): Plugin {
  return {
    name: 'fix-dist-html',
    closeBundle() {
      const distDir = resolve(process.cwd(), 'dist')
      const htmlPath = resolve(distDir, 'index.html')
      let html = readFileSync(htmlPath, 'utf8')

      const cssLinkRe = /<link[^>]*href="([^"]*assets\/[^"]+\.css)"[^>]*>\s*/i
      const cssMatch = html.match(cssLinkRe)
      if (!cssMatch) {
        throw new Error('[fix-dist-html] dist/index.html に CSS 参照が見つかりません')
      }

      const cssPath = resolve(distDir, assetRelativePath(cssMatch[1]!))
      const css = readFileSync(cssPath, 'utf8')
      html = html.replace(cssLinkRe, `<style>${css}</style>\n    `)

      const scriptRe = /<script[^>]*\ssrc="([^"]*assets\/[^"]+\.js)"[^>]*>\s*<\/script>/i
      const scriptMatch = html.match(scriptRe)
      if (!scriptMatch) {
        throw new Error('[fix-dist-html] dist/index.html に JS 参照が見つかりません')
      }

      const scriptTag = '<script defer src="./assets/app.js"></script>'
      html = html.replace(scriptRe, '')
      html = html.replace(/<div id="app"><\/div>/, `<div id="app"></div>\n    ${scriptTag}`)

      html = html.replace(/href="\/favicon\.svg"/, 'href="./favicon.svg"')

      writeFileSync(htmlPath, html)
    },
  }
}

export default defineConfig({
  base,
  plugins: [fixDistHtml()],
  build: {
    cssCodeSplit: false,
    target: 'es2015',
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/app[extname]',
      },
    },
  },
})
