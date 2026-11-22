/**
 * Export store-screenshot HTML scenes to marketing PNGs at 2880×1620 (1.5× of 1920×1080).
 * Usage: node scripts/export-store-screenshots.mjs
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scenes = path.join(root, 'assets', 'store-screenshots')

/** @type {{ html: string, outs: string[] }[]} */
const jobs = [
  {
    html: 'scene2-tools-en.html',
    // English shots are shared by README and the website: one copy, in docs/assets/.
    outs: ['docs/assets/tools.png'],
  },
  {
    html: 'scene2-tools.html',
    outs: ['assets/十种标注工具.png'],
  },
  {
    html: 'scene1-desktop-en.html',
    outs: ['assets/desktop-annotation.png'],
  },
  {
    html: 'scene1-desktop.html',
    outs: ['assets/桌面标注场景.png'],
  },
  {
    html: 'scene3-panel-en.html',
    outs: ['docs/assets/settings.png'],
  },
  {
    html: 'scene3-panel.html',
    outs: ['assets/设置面板.png'],
  },
  {
    html: 'scene4-shortcuts-en.html',
    outs: ['docs/assets/shortcuts.png'],
  },
  {
    html: 'scene4-shortcuts.html',
    outs: ['assets/快捷键一览.png'],
  },
  {
    html: 'scene0-hero-en.html',
    outs: ['docs/assets/hero.png'],
  },
  {
    html: 'scene0-hero.html',
    outs: ['assets/MarkerOn.png'],
  },
  {
    // Settings-window scenes embed a real 660×500 @2x capture
    // (`settings-window-en.png` / `settings-window-zh.png`); re-capture it when the
    // settings UI changes, then re-run this export.
    html: 'scene5-settings-en.html',
    outs: ['docs/assets/settings-window.png'],
  },
  {
    html: 'scene5-settings.html',
    outs: ['assets/设置窗口.png'],
  },
  {
    html: 'scene6-stroke-en.html',
    outs: ['docs/assets/stroke-styles.png'],
  },
  {
    html: 'scene6-stroke.html',
    outs: ['assets/线型与线宽.png'],
  },
  {
    html: 'scene7-whiteboard-en.html',
    outs: ['docs/assets/whiteboard.png'],
  },
  {
    html: 'scene7-whiteboard.html',
    outs: ['assets/白板模式.png'],
  },
  {
    html: 'scene8-precision-en.html',
    outs: ['docs/assets/precision-editing.png'],
  },
  {
    html: 'scene8-precision.html',
    outs: ['assets/编辑与精修.png'],
  },
]

// Allow an existing Chromium install (CI caches, offline machines) to be reused.
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
)
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1.5,
})
const page = await context.newPage()

for (const job of jobs) {
  const htmlPath = path.join(scenes, job.html)
  const url = pathToFileURL(htmlPath).href
  console.log('render', job.html)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(200)
  const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080 } })
  for (const out of job.outs) {
    const dest = path.join(root, out)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, buf)
    console.log('  ->', out, `(${buf.length} bytes)`)
  }
}

await browser.close()
console.log('done')
