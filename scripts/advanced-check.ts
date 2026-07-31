import { chromium } from 'playwright';
const url = process.env.URL ?? 'http://localhost:5173/';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1080 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#modelStatus')?.classList.contains('ready'), { timeout: 15000 });
  await page.click('summary');
  await page.fill('#playerHpInput', '5');
  await page.fill('#maxHpInput', '7');
  await page.fill('#bombNumInput', '4');
  await page.fill('#bombRangeInput', '3');
  await page.fill('#playerSpeedInput', '3');
  await page.fill('#bombTimeInput', '6');
  await page.dispatchEvent('#bombTimeInput', 'change');
  await page.waitForTimeout(150);
  const text = await page.textContent('#stats');
  const hpDots = await page.$$eval('.player-card:first-child .hp-dots i.on', (items) => items.length);
  const ok = Boolean(text?.includes('0/4') && text?.includes('火力3') && text?.includes('速度3') && hpDots === 5);
  console.log(`advanced_settings_visible=${ok ? 1 : 0}`);
  if (!ok) throw new Error(`${text ?? 'empty stats'} hpDots=${hpDots}`);
  await browser.close();
}
main();
