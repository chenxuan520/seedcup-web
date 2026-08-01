import { chromium, type Page } from 'playwright';

const url = process.env.URL ?? 'http://localhost:4173/';

async function roundOf(page: Page): Promise<number> {
  const text = (await page.textContent('#roundBadge')) ?? '';
  return Number(text.match(/\d+/)?.[0] ?? 0);
}

async function waitForRoundAfter(
  page: Page,
  previous: number,
  timeout = 8000,
): Promise<number> {
  await page.waitForFunction(
    (round) => {
      const text = document.querySelector('#roundBadge')?.textContent ?? '';
      return Number(text.match(/\d+/)?.[0] ?? 0) > round;
    },
    previous,
    { timeout },
  );
  return roundOf(page);
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  let delayedModels = 0;
  await page.route('**/models/pure-nn.rnn', async (route) => {
    delayedModels++;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#playBtn');
  if ((await page.textContent('#modelText'))?.includes('已加载')) {
    throw new Error('model loaded before early-start race could be exercised');
  }

  await page.click('#playBtn');
  if ((await page.textContent('#playBtn'))?.trim() !== '暂停') {
    throw new Error('early click did not enter playing state');
  }

  const earlyRound = await waitForRoundAfter(page, 0);
  await page.waitForFunction(
    () => document.querySelector('#modelStatus')?.classList.contains('ready'),
    undefined,
    { timeout: 20000 },
  );
  if ((await page.textContent('#playBtn'))?.trim() !== '暂停') {
    throw new Error('model completion interrupted an already running match');
  }
  const loadedRound = await waitForRoundAfter(page, earlyRound);

  await page.click('#playBtn');
  if ((await page.textContent('#playBtn'))?.trim() !== '开始') {
    throw new Error('pause did not update the button state');
  }
  const pausedRound = await roundOf(page);
  await page.waitForTimeout(900);
  if ((await roundOf(page)) !== pausedRound) {
    throw new Error('round advanced while paused');
  }

  await page.click('#playBtn');
  const resumedRound = await waitForRoundAfter(page, pausedRound);

  await page.fill('#speedInput', '12');
  await page.dispatchEvent('#speedInput', 'input');
  const speedStart = await roundOf(page);
  await page.waitForTimeout(700);
  const speedEnd = await roundOf(page);
  if (speedEnd - speedStart < 3) {
    throw new Error(
      `speed control did not accelerate autoplay: ${speedStart}->${speedEnd}`,
    );
  }

  await page.click('#resetBtn');
  if (
    (await roundOf(page)) !== 0 ||
    (await page.textContent('#playBtn'))?.trim() !== '开始'
  ) {
    throw new Error('reset did not stop autoplay and return to round zero');
  }
  await page.waitForTimeout(500);
  if ((await roundOf(page)) !== 0) {
    throw new Error('round advanced after reset stopped autoplay');
  }

  await page.click('#stepBtn');
  await page.waitForFunction(
    () => document.querySelector('#roundBadge')?.textContent === '回合 1',
    undefined,
    { timeout: 5000 },
  );
  if ((await page.textContent('#playBtn'))?.trim() !== '开始') {
    throw new Error('single step unexpectedly started autoplay');
  }

  if (delayedModels < 2) {
    throw new Error(`expected main and worker model requests, got ${delayedModels}`);
  }
  if (errors.length) {
    throw new Error(`browser errors: ${errors.join(' | ')}`);
  }

  console.log(
    `autoplay ok early=${earlyRound} loaded=${loadedRound} ` +
      `resumed=${resumedRound} speed_delta=${speedEnd - speedStart} ` +
      `model_requests=${delayedModels}`,
  );
  await browser.close();
}

main().catch((error) => {
  console.error('autoplay check failed:', error);
  process.exit(1);
});
