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
  const mobileRuleLabels = await page.$$eval(
    '.seat-select-wrap',
    (wraps) => wraps.map((wrap) => {
      const select = wrap.querySelector<HTMLSelectElement>('.seat-select');
      return {
        visible: (
          wrap.querySelector<HTMLElement>('.seat-selection-label')?.innerText ??
          ''
        ).trim(),
        selected: select?.selectedOptions[0]?.textContent?.trim() ?? '',
      };
    }),
  );
  if (
    mobileRuleLabels[0]?.visible !== '简单' ||
    mobileRuleLabels[0]?.selected !== '简单' ||
    mobileRuleLabels[1]?.visible !== '纯神经网络' ||
    mobileRuleLabels[1]?.selected !== '纯神经网络'
  ) {
    throw new Error(
      `mobile bot qualifiers should be hidden: ${JSON.stringify(mobileRuleLabels)}`,
    );
  }
  await page.click('#helpCloseBtn');
  if (await page.$eval('#helpDialog', (dialog) => (dialog as HTMLDialogElement).open)) {
    throw new Error('help dialog did not close');
  }
  const botInfo = await page.$$eval('.bot-info-trigger', (buttons) =>
    buttons.map((button) => {
      const trigger = button.getBoundingClientRect();
      const icon = button.querySelector('span')?.getBoundingClientRect();
      const wrap = button.closest('.seat-select-wrap')?.getBoundingClientRect();
      const label = button
        .closest('.seat-select-wrap')
        ?.querySelector('.seat-selection-label')
        ?.getBoundingClientRect();
      return {
        label: button.getAttribute('aria-label') ?? '',
        controls: button.getAttribute('aria-controls') ?? '',
        textGap: label && icon ? icon.left - label.right : -1,
        trailingSpace: wrap ? wrap.right - trigger.right : -1,
        width: trigger.width,
        height: trigger.height,
      };
    }),
  );
  if (
    botInfo.length !== 2 ||
    !botInfo[0].label.includes('简单') ||
    botInfo[0].controls !== 'botInfoDialog' ||
    !botInfo[1].label.includes('纯神经网络') ||
    botInfo[1].controls !== 'nnDialog' ||
    botInfo.some(
      (info) =>
        info.textGap < 3 ||
        info.textGap > 7 ||
        info.trailingSpace <= 30 ||
        info.width < 32 ||
        info.height < 32,
    )
  ) {
    throw new Error(`bot info trigger mismatch: ${JSON.stringify(botInfo)}`);
  }
  await page.click('.bot-info-trigger[data-bot-info="0"]');
  const mobileEasyInfo = await page.$eval('#botInfoDialog', (dialog) => {
    const element = dialog as HTMLDialogElement;
    const rect = element.getBoundingClientRect();
    return {
      open: element.open,
      text: element.textContent ?? '',
      left: rect.left,
      right: rect.right,
      viewport: window.innerWidth,
    };
  });
  if (
    !mobileEasyInfo.open ||
    !mobileEasyInfo.text.includes('简单机器人') ||
    !mobileEasyInfo.text.includes('固定最多 1 个') ||
    !mobileEasyInfo.text.includes('BFS 路径搜索') ||
    mobileEasyInfo.left < 0 ||
    mobileEasyInfo.right > mobileEasyInfo.viewport
  ) {
    throw new Error(
      `easy bot info mismatch: ${JSON.stringify(mobileEasyInfo)}`,
    );
  }
  await page.click('#botInfoCloseBtn');

  const checkGenericBotInfo = async (
    botId: 'manual' | 'hard' | 'search',
    activation: 'Enter' | 'Space' | 'click',
    expected: string[],
  ) => {
    await page.selectOption('.seat-select[data-seat="0"]', botId);
    const trigger = '.bot-info-trigger[data-bot-info="0"]';
    if (activation === 'click') {
      await page.click(trigger);
    } else {
      await page.focus(trigger);
      await page.keyboard.press(activation);
    }
    const state = await page.$eval('#botInfoDialog', (dialog) => ({
      open: (dialog as HTMLDialogElement).open,
      text: dialog.textContent ?? '',
      bodyLocked: document.body.classList.contains('dialog-open'),
    }));
    if (
      !state.open ||
      !state.bodyLocked ||
      expected.some((text) => !state.text.includes(text))
    ) {
      throw new Error(
        `${botId} bot info mismatch: ${JSON.stringify(state)}`,
      );
    }
    await page.keyboard.press('Escape');
    const closed = await page.$eval('#botInfoDialog', (dialog) => ({
      open: (dialog as HTMLDialogElement).open,
      bodyLocked: document.body.classList.contains('dialog-open'),
    }));
    if (closed.open || closed.bodyLocked) {
      throw new Error(
        `${botId} bot info did not close cleanly: ${JSON.stringify(closed)}`,
      );
    }
  };
  await checkGenericBotInfo('manual', 'Enter', [
    '手动玩家',
    '键盘与屏幕方向键',
  ]);
  await checkGenericBotInfo('hard', 'Space', [
    '困难机器人',
    '最多等于当前 speed',
  ]);
  await checkGenericBotInfo('search', 'click', [
    '搜索增强机器人',
    '静止 + 四方向 + 放弹',
    'RuleBot(true, orderMode=4)',
    'ContestHardBot',
    '0.05',
    '0.005',
    '危险区时不搜索',
    '模型加载失败',
  ]);
  await page.selectOption('.seat-select[data-seat="0"]', 'easy');

  await page.focus('.bot-info-trigger[data-bot-info="1"]');
  await page.keyboard.press('Enter');
  const mobileNn = await page.$eval('#nnDialog', (dialog) => {
    const element = dialog as HTMLDialogElement;
    const rect = element.getBoundingClientRect();
    const close = element.querySelector('#nnCloseBtn')?.getBoundingClientRect();
    const download = element.querySelector<HTMLAnchorElement>('#nnDownloadLink');
    const body = element.querySelector('.help-body');
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
      noHorizontalOverflow: Boolean(
        body && body.scrollWidth <= body.clientWidth + 1,
      ),
    };
  });
  if (
    !mobileNn.open ||
    !mobileNn.text.includes('1,156,486') ||
    !mobileNn.text.includes('434 个监督状态') ||
    !mobileNn.text.includes('1426 + 16 + 30 + 144 = 1616') ||
    !mobileNn.text.includes('827,392') ||
    !mobileNn.text.includes('262,144') ||
    !mobileNn.text.includes('拾取前不区分道具类型') ||
    !mobileNn.text.includes('0.75 × base_policy') ||
    !mobileNn.text.includes('1,800 局采集') ||
    !mobileNn.text.includes('309,129 steps') ||
    !mobileNn.text.includes('1,000 局采集') ||
    !mobileNn.text.includes('330,877 steps') ||
    !mobileNn.text.includes('33,224,960') ||
    !mobileNn.text.includes('2 分 38 秒') ||
    !mobileNn.text.includes('2 分 51 秒') ||
    !mobileNn.text.includes('不能可靠拆出每一段的分钟数') ||
    mobileNn.download !== 'pure-nn.rnn' ||
    !mobileNn.href.includes('/models/pure-nn.rnn') ||
    mobileNn.left < 0 ||
    mobileNn.right > mobileNn.viewport ||
    !mobileNn.closeVisible ||
    !mobileNn.noHorizontalOverflow
  ) {
    throw new Error(`nn dialog mismatch: ${JSON.stringify(mobileNn)}`);
  }
  await page.click('#nnCloseBtn');
  if (await page.$eval('#nnDialog', (dialog) => (dialog as HTMLDialogElement).open)) {
    throw new Error('nn dialog did not close');
  }
  await page.focus('.bot-info-trigger[data-bot-info="1"]');
  await page.keyboard.press('Space');
  if (!await page.$eval('#nnDialog', (dialog) => (dialog as HTMLDialogElement).open)) {
    throw new Error('nn dialog did not open with Space');
  }
  await page.click('#nnCloseBtn');
  await page.setViewportSize({ width: 1360, height: 1080 });

  await page.selectOption('.seat-select[data-seat="0"]', 'nn');
  const changedNnState = await page.$$eval('.seat-select-wrap', (wraps) =>
    wraps.map((wrap) => ({
      controls:
        wrap.querySelector('.bot-info-trigger')?.getAttribute('aria-controls') ??
        '',
      text: wrap.querySelector('.seat-selection-label')?.textContent ?? '',
    })),
  );
  if (
    changedNnState.length !== 2 ||
    changedNnState.some((seat) => seat.controls !== 'nnDialog') ||
    changedNnState.some((seat) => seat.text !== '纯神经网络')
  ) {
    throw new Error(
      `nn selection overlay did not follow selection: ${JSON.stringify(changedNnState)}`,
    );
  }
  await page.selectOption('.seat-select[data-seat="0"]', 'easy');
  const restoredNnState = await page.$$eval('.seat-select-wrap', (wraps) =>
    wraps.map((wrap) => ({
      controls:
        wrap.querySelector('.bot-info-trigger')?.getAttribute('aria-controls') ??
        '',
      text: wrap.querySelector('.seat-selection-label')?.textContent ?? '',
    })),
  );
  if (
    restoredNnState.length !== 2 ||
    restoredNnState[0].controls !== 'botInfoDialog' ||
    restoredNnState[1].controls !== 'nnDialog' ||
    restoredNnState[0].text !== '简单' ||
    restoredNnState[1].text !== '纯神经网络'
  ) {
    throw new Error(
      `nn selection overlay did not restore: ${JSON.stringify(restoredNnState)}`,
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

  // 按钮保留焦点时，WASD 仍应交给手动玩家，而 Enter/Space 保留按钮语义。
  await page.selectOption('.seat-select[data-seat="0"]', 'manual');
  await page.selectOption('.seat-select[data-seat="1"]', 'hard');
  const manualStart = (await readPlayers())[0];
  await page.click('#playBtn');
  const focusAfterPlay = await page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.id ?? '',
  );
  if (focusAfterPlay !== 'playBtn') {
    problems.push(`play button did not retain focus: ${focusAfterPlay}`);
  }
  const inwardKeys =
    manualStart.x < 6
      ? ['s', manualStart.y < 6 ? 'd' : 'a']
      : ['w', manualStart.y < 6 ? 'd' : 'a'];
  let manualMovedWithButtonFocus = false;
  for (let attempt = 0; attempt < 20 && !manualMovedWithButtonFocus; attempt++) {
    for (const key of inwardKeys) await page.keyboard.press(key);
    await page.waitForTimeout(120);
    const current = (await readPlayers())[0];
    manualMovedWithButtonFocus =
      current.x !== manualStart.x || current.y !== manualStart.y;
  }
  if (!manualMovedWithButtonFocus) {
    problems.push('manual player did not move while play button retained focus');
  }
  if ((await page.textContent('#playBtn')) === '暂停') await page.click('#playBtn');

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
    const afterImportSelections = await page.$$eval(
      '.seat-select-wrap',
      (wraps) => wraps.map((wrap) => {
        const select = wrap.querySelector<HTMLSelectElement>('.seat-select');
        return {
          selected: select?.selectedOptions[0]?.textContent ?? '',
          visible: wrap.querySelector('.seat-selection-label')?.textContent ?? '',
        };
      }),
    );
    if (
      afterImportSelections.length !== 4 ||
      afterImportSelections.some((seat) => seat.selected !== seat.visible)
    ) {
      problems.push(
        `import bot labels out of sync: ${JSON.stringify(afterImportSelections)}`,
      );
    }
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
