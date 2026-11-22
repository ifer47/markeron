import { chromium } from 'playwright'

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
)
const ctx = await browser.newContext({
  viewport: { width: 420, height: 1000 },
  deviceScaleFactor: 2,
  // The panel paints its own surface; keep the rounded corners transparent so the
  // marketing scenes can place it on any background.
  omitBackground: true,
})
const page = await ctx.newPage()

for (const [locale, out] of [
  ['zh-CN', 'assets/store-screenshots/panel-zh.png'],
  ['en', 'assets/store-screenshots/panel-en.png'],
]) {
  await page.goto(`http://localhost:1420/assets/store-screenshots/panel-shot.html?locale=${locale}&tool=pen&color=%23FF3B30`, {
    waitUntil: 'networkidle',
  })
  await page.waitForTimeout(800)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /展开|收起|Expand|Collapse/.test(x.textContent || ''))
    b?.click()
  })
  await page.waitForTimeout(600)
  const el = await page.$('.overlay-panel-surface')
  console.log(locale, await el.boundingBox())
  await el.screenshot({ path: out })
}
await browser.close()
