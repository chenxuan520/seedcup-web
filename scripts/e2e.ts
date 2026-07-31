import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1080 } });
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#modelStatus')?.classList.contains('ready'), {
    timeout: 15000,
  });
  const modelText = (await page.textContent('#modelText'))?.trim();

  const fingerprint = () =>
    page.evaluate(() => (document.querySelector('canvas') as HTMLCanvasElement).toDataURL().slice(0, 3000));

  const readPlayers = () =>
    page.$$eval('.player-card', (cards) =>
      cards.map((c) => {
        const vs = c.querySelectorAll('.pstat .v');
        const posText = vs[5]?.textContent?.trim() ?? '-';
        const [x, y] = posText.includes(',') ? posText.split(',').map(Number) : [-1, -1];
        return { x, y };
      }),
    );

  const problems: string[] = [];

  // 场景1: 2 人 13x13 困难 vs 困难
  await page.selectOption('#playerNum', '2');
  await page.selectOption('#mapSize', '13');
  let seatSel = await page.$$('.seat-select');
  await seatSel[0].selectOption('hard');
  await seatSel[1].selectOption('hard');
  await page.click('#resetBtn');
  await page.waitForTimeout(120);

  const moved = [new Set<string>(), new Set<string>()];
  let shotExplosion = false;
  for (let i = 0; i < 100; i++) {
    await page.click('#stepBtn');
    const ps = await readPlayers();
    ps.forEach((p, idx) => p.x >= 0 && moved[idx].add(`${p.x},${p.y}`));
    if (!shotExplosion) {
      const boom = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.log-line')).some((l) => l.textContent?.includes('爆炸')),
      );
      if (boom) {
        await page.screenshot({ path: 'e2e-explosion.png', fullPage: true });
        shotExplosion = true;
      }
    }
    if (((await page.textContent('#roundBadge')) ?? '').includes('结束')) break;
  }
  if (moved[0].size < 3 || moved[1].size < 3) problems.push(`2ren bot stuck: ${moved[0].size}/${moved[1].size}`);
  if (!shotExplosion) problems.push('no explosion captured');

  // 场景2: 换地图随机 + 种子复现
  const prints = new Set<string>();
  for (let i = 0; i < 3; i++) {
    await page.click('#shuffleBtn');
    await page.waitForTimeout(120);
    prints.add(await fingerprint());
  }
  if (prints.size < 3) problems.push(`shuffle not random: ${prints.size}/3`);

  await page.fill('#seedInput', '20260730');
  await page.dispatchEvent('#seedInput', 'change');
  await page.waitForTimeout(120);
  const fpA = await fingerprint();
  await page.fill('#seedInput', '888');
  await page.dispatchEvent('#seedInput', 'change');
  await page.waitForTimeout(120);
  await page.fill('#seedInput', '20260730');
  await page.dispatchEvent('#seedInput', 'change');
  await page.waitForTimeout(120);
  const fpB = await fingerprint();
  if (fpA !== fpB) problems.push('seed not reproducible');

  // 场景3: 4 人 15x15
  await page.fill('#seedInput', '');
  await page.dispatchEvent('#seedInput', 'change');
  await page.selectOption('#playerNum', '4');
  await page.selectOption('#mapSize', '15');
  await page.waitForTimeout(120);
  const seats4 = await page.$$('.seat-select');
  if (seats4.length !== 4) problems.push(`expect 4 selectors got ${seats4.length}`);
  await page.click('#resetBtn');
  await page.waitForTimeout(120);
  const cards4 = await page.$$eval('.player-card', (c) => c.length);
  if (cards4 !== 4) problems.push(`expect 4 player cards got ${cards4}`);
  const moved4 = [0, 0, 0, 0].map(() => new Set<string>());
  for (let i = 0; i < 60; i++) {
    await page.click('#stepBtn');
    const ps = await readPlayers();
    ps.forEach((p, idx) => p.x >= 0 && moved4[idx]?.add(`${p.x},${p.y}`));
    if (((await page.textContent('#roundBadge')) ?? '').includes('结束')) break;
  }
  const movers = moved4.filter((s) => s.size >= 2).length;
  if (movers < 3) problems.push(`4ren too few movers: ${movers}`);
  await page.screenshot({ path: 'e2e-4p.png', fullPage: true });

  // 场景4: 导出/导入。先下载当前局面，再导入同一 JSON，之后继续单步。
  const downloadPromise = page.waitForEvent('download');
  await page.click('#exportBtn');
  const download = await downloadPromise;
  const archivePath = await download.path();
  if (!archivePath) problems.push('export did not create a downloadable file');
  if (archivePath) {
    const chooserPromise = page.waitForEvent('filechooser');
    await page.click('#importBtn');
    const chooser = await chooserPromise;
    await chooser.setFiles(archivePath);
    await page.waitForTimeout(120);
    await page.click('#stepBtn');
    const afterImportCards = await page.$$eval('.player-card', (cards) => cards.length);
    if (afterImportCards !== 4) problems.push(`import restored wrong player count: ${afterImportCards}`);
  }

  await browser.close();

  if (errors.length) problems.push(`pageerror: ${errors.join(' | ')}`);
  if (consoleErrors.length) problems.push(`console: ${consoleErrors.slice(0, 3).join(' | ')}`);
  if (!modelText?.includes('已加载')) problems.push(`model not loaded: ${modelText}`);

  console.log('model:', modelText);
  console.log('2p moves:', moved[0].size, '/', moved[1].size, ' explosion:', shotExplosion);
  console.log('shuffle unique:', prints.size, '/3  seed reproducible:', fpA === fpB);
  console.log('4p selectors/cards/movers:', seats4.length, '/', cards4, '/', movers);
  console.log('pageerror:', errors.length, ' console:', consoleErrors.length);

  if (problems.length) {
    console.error('\nFAIL:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
  console.log('\nOK: 2p/4p games, random map, seed reproducible, explosion fx, no errors');
}

main().catch((e) => {
  console.error('E2E error:', e);
  process.exit(1);
});
