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

  const defaultBots = await page.$$eval('.seat-select', (selects) =>
    selects.map((select) => (select as HTMLSelectElement).value),
  );
  if (defaultBots[0] !== 'easy' || defaultBots[1] !== 'nn') {
    throw new Error(`default bots mismatch: ${defaultBots.join('/')}`);
  }

  const desktopLayout = await page.evaluate(() => {
    const players = document.querySelector('.player-rail')?.getBoundingClientRect();
    const arena = document.querySelector('.arena-panel')?.getBoundingClientRect();
    const controls = document.querySelector('.control-rail')?.getBoundingClientRect();
    if (!players || !arena || !controls) return null;
    return {
      ordered: players.left < arena.left && arena.left < controls.left,
      noOverflow:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    };
  });
  if (!desktopLayout?.ordered || !desktopLayout.noOverflow) {
    throw new Error(`desktop layout mismatch: ${JSON.stringify(desktopLayout)}`);
  }

  await page.click('#helpBtn');
  const helpState = await page.$eval('#helpDialog', (dialog) => {
    const text = dialog.textContent ?? '';
    return {
      open: (dialog as HTMLDialogElement).open,
      itemCount: dialog.querySelectorAll('.help-item-card').length,
      hasAllTopics: [
        '快速开始',
        '胜负与炸弹',
        '地图图例',
        '道具图标',
        '角色状态',
        '火力',
        '炸弹',
        '回血',
        '无敌',
        '护盾',
        '加速',
        '手套',
      ].every((topic) => text.includes(topic)),
    };
  });
  if (!helpState.open || helpState.itemCount !== 7 || !helpState.hasAllTopics) {
    throw new Error(`help content incomplete: ${JSON.stringify(helpState)}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => {
    const players = document.querySelector('.player-rail')?.getBoundingClientRect();
    const arena = document.querySelector('.arena-panel')?.getBoundingClientRect();
    const controls = document.querySelector('.control-rail')?.getBoundingClientRect();
    if (!players || !arena || !controls) return null;
    return {
      ordered: arena.top < players.top && players.top < controls.top,
      noOverflow:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    };
  });
  if (!mobileLayout?.ordered || !mobileLayout.noOverflow) {
    throw new Error(`mobile layout mismatch: ${JSON.stringify(mobileLayout)}`);
  }
  const mobileHelp = await page.$eval('#helpDialog', (dialog) => {
    const rect = dialog.getBoundingClientRect();
    const close = dialog.querySelector('#helpCloseBtn')?.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewport: window.innerWidth,
      closeVisible: Boolean(close && close.top >= 0 && close.bottom <= window.innerHeight),
    };
  });
  if (
    mobileHelp.left < 0 ||
    mobileHelp.right > mobileHelp.viewport ||
    !mobileHelp.closeVisible
  ) {
    throw new Error(`mobile help overflow: ${JSON.stringify(mobileHelp)}`);
  }
  await page.click('#helpCloseBtn');
  if (await page.$eval('#helpDialog', (dialog) => (dialog as HTMLDialogElement).open)) {
    throw new Error('help dialog did not close');
  }
  const nnInfo = await page.$$eval('.nn-info-trigger', (buttons) =>
    buttons.map((button) => {
      const trigger = button.getBoundingClientRect();
      const wrap = button.closest('.seat-select-wrap')?.getBoundingClientRect();
      const label = button
        .closest('.seat-select-wrap')
        ?.querySelector('.seat-selection-label')
        ?.getBoundingClientRect();
      return {
        hidden: button.classList.contains('is-hidden'),
        label: button.getAttribute('aria-label') ?? '',
        textGap: label ? trigger.left - label.right : -1,
        trailingSpace: wrap ? wrap.right - trigger.right : -1,
      };
    }),
  );
  if (
    nnInfo.length !== 2 ||
    !nnInfo[0].hidden ||
    nnInfo[1].hidden ||
    !nnInfo[1].label.includes('纯神经网络') ||
    nnInfo[1].textGap < 3 ||
    nnInfo[1].textGap > 7 ||
    nnInfo[1].trailingSpace <= 30
  ) {
    throw new Error(`nn info trigger mismatch: ${JSON.stringify(nnInfo)}`);
  }
  await page.click('.nn-info-trigger[data-nn-info="1"]');
  const mobileNn = await page.$eval('#nnDialog', (dialog) => {
    const element = dialog as HTMLDialogElement;
    const rect = element.getBoundingClientRect();
    const close = element.querySelector('#nnCloseBtn')?.getBoundingClientRect();
    const download = element.querySelector<HTMLAnchorElement>('#nnDownloadLink');
    return {
      open: element.open,
      text: element.textContent ?? '',
      href: download?.href ?? '',
      download: download?.download ?? '',
      left: rect.left,
      right: rect.right,
      viewport: window.innerWidth,
      closeVisible: Boolean(
        close && close.top >= 0 && close.bottom <= window.innerHeight,
      ),
    };
  });
  if (
    !mobileNn.open ||
    !mobileNn.text.includes('1,156,486') ||
    !mobileNn.text.includes('434 个可修正状态') ||
    !mobileNn.text.includes('1426 + 16 + 30 + 144 = 1616') ||
    !mobileNn.text.includes('827,392') ||
    !mobileNn.text.includes('262,144') ||
    !mobileNn.text.includes('拾取前不区分道具类型') ||
    !mobileNn.text.includes('0.75 × base_policy') ||
    mobileNn.download !== 'pure-nn.rnn' ||
    !mobileNn.href.includes('/models/pure-nn.rnn') ||
    mobileNn.left < 0 ||
    mobileNn.right > mobileNn.viewport ||
    !mobileNn.closeVisible
  ) {
    throw new Error(`nn dialog mismatch: ${JSON.stringify(mobileNn)}`);
  }
  await page.click('#nnCloseBtn');
  if (await page.$eval('#nnDialog', (dialog) => (dialog as HTMLDialogElement).open)) {
    throw new Error('nn dialog did not close');
  }
  await page.setViewportSize({ width: 1360, height: 1080 });

  await page.selectOption('.seat-select[data-seat="0"]', 'nn');
  const changedNnTriggers = await page.$$eval('.nn-info-trigger', (buttons) =>
    buttons.map((button) => button.classList.contains('is-hidden')),
  );
  if (changedNnTriggers.length !== 2 || changedNnTriggers.some(Boolean)) {
    throw new Error(
      `nn info trigger did not follow selection: ${JSON.stringify(changedNnTriggers)}`,
    );
  }
  await page.selectOption('.seat-select[data-seat="0"]', 'easy');
  const restoredNnTriggers = await page.$$eval('.nn-info-trigger', (buttons) =>
    buttons.map((button) => button.classList.contains('is-hidden')),
  );
  if (
    restoredNnTriggers.length !== 2 ||
    !restoredNnTriggers[0] ||
    restoredNnTriggers[1]
  ) {
    throw new Error(
      `nn info trigger did not restore: ${JSON.stringify(restoredNnTriggers)}`,
    );
  }

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

  const stepRound = async () => {
    const before = await page.textContent('#roundBadge');
    await page.click('#stepBtn');
    await page.waitForFunction(
      (previous) => document.querySelector('#roundBadge')?.textContent !== previous,
      before,
      { timeout: 5000 },
    );
  };

  const problems: string[] = [];

  // 场景1: 2 人 13x13 困难 vs 困难
  await page.selectOption('#playerNum', '2');
  await page.selectOption('#mapSize', '13');
  let seatSel = await page.$$('.seat-select');
  await seatSel[0].selectOption('hard');
  await seatSel[1].selectOption('hard');
  await page.click('#resetBtn');
  await page.waitForFunction(
    () => Number((document.querySelector('#board') as HTMLCanvasElement).dataset.botWorkers) === 2,
  );

  const moved = [new Set<string>(), new Set<string>()];
  let shotExplosion = false;
  for (let i = 0; i < 100; i++) {
    await stepRound();
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
  const arrivalOrder = await page.$eval('#board', (board) =>
    (board as HTMLCanvasElement).dataset.arrivalOrder ?? '',
  );
  if (arrivalOrder.split(',').filter(Boolean).length !== 2) {
    problems.push(`worker arrivals missing: ${arrivalOrder}`);
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
    await stepRound();
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
    await stepRound();
    const afterImportCards = await page.$$eval('.player-card', (cards) => cards.length);
    if (afterImportCards !== 4) problems.push(`import restored wrong player count: ${afterImportCards}`);
  }

  if (errors.length) problems.push(`pageerror: ${errors.join(' | ')}`);
  if (consoleErrors.length) problems.push(`console: ${consoleErrors.slice(0, 3).join(' | ')}`);
  if (!modelText?.includes('已加载')) problems.push(`model not loaded: ${modelText}`);

  console.log('model:', modelText);
  console.log(
    'default bots:',
    defaultBots.join(' / '),
    ' help items:',
    helpState.itemCount,
    ' three-column layout:',
    desktopLayout.ordered,
    ' mobile order:',
    mobileLayout.ordered,
    ' nn details:',
    mobileNn.open,
  );
  console.log('worker arrivals:', arrivalOrder);
  console.log('2p moves:', moved[0].size, '/', moved[1].size, ' explosion:', shotExplosion);
  console.log('shuffle unique:', prints.size, '/3  seed reproducible:', fpA === fpB);
  console.log('4p selectors/cards/movers:', seats4.length, '/', cards4, '/', movers);
  console.log('pageerror:', errors.length, ' console:', consoleErrors.length);

  if (problems.length) {
    console.error('\nFAIL:\n - ' + problems.join('\n - '));
    await browser.close();
    process.exit(1);
  }
  await browser.close();
  console.log('\nOK: 2p/4p games, random map, seed reproducible, explosion fx, no errors');
}

main().catch((e) => {
  console.error('E2E error:', e);
  process.exit(1);
});
