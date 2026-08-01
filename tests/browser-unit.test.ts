import { afterAll, beforeAll, describe, expect, test } from 'vitest';

let originalFetch: typeof fetch;

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  originalFetch = globalThis.fetch;
  await import('../src/main');
  await viWaitFor(
    () => document.querySelector('#modelText')?.textContent?.includes('已加载'),
    20_000,
  );
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('browser application controls', () => {
  test('default match and help are rendered', () => {
    const seats = [
      ...document.querySelectorAll<HTMLSelectElement>('.seat-select'),
    ];
    expect(seats.map((seat) => seat.value)).toEqual(['easy', 'nn']);
    expect(document.querySelectorAll('.player-card')).toHaveLength(2);
    expect(document.querySelector('#stats')?.textContent).toContain('简单');
    expect(document.querySelector('#modelStatus')?.classList).toContain(
      'ready',
    );
    const botInfoTriggers = [
      ...document.querySelectorAll<HTMLButtonElement>('.bot-info-trigger'),
    ];
    expect(botInfoTriggers).toHaveLength(2);
    expect(botInfoTriggers[0].getAttribute('aria-label')).toContain('简单');
    expect(botInfoTriggers[1].getAttribute('aria-label')).toContain(
      '纯神经网络',
    );
    const nnWrap = botInfoTriggers[1].closest('.seat-select-wrap')!;
    const nnLabel = nnWrap.querySelector<HTMLElement>('.seat-selection-label')!;
    const nnIcon = botInfoTriggers[1].querySelector<HTMLElement>('span')!;
    const wrapRect = nnWrap.getBoundingClientRect();
    const labelRect = nnLabel.getBoundingClientRect();
    const triggerRect = botInfoTriggers[1].getBoundingClientRect();
    const iconRect = nnIcon.getBoundingClientRect();
    expect(iconRect.left - labelRect.right).toBeGreaterThanOrEqual(3);
    expect(iconRect.left - labelRect.right).toBeLessThanOrEqual(7);
    expect(wrapRect.right - triggerRect.right).toBeGreaterThan(30);
    expect(triggerRect.width).toBeGreaterThanOrEqual(32);
    expect(triggerRect.height).toBeGreaterThanOrEqual(32);

    click('#helpBtn');
    expect(
      (document.querySelector('#helpDialog') as HTMLDialogElement).open,
    ).toBe(true);
    click('#helpCloseBtn');
    expect(
      (document.querySelector('#helpDialog') as HTMLDialogElement).open,
    ).toBe(false);

    botInfoTriggers[0].click();
    const botInfoDialog =
      document.querySelector<HTMLDialogElement>('#botInfoDialog')!;
    expect(botInfoDialog.open).toBe(true);
    expect(botInfoDialog.textContent).toContain('简单机器人');
    expect(botInfoDialog.textContent).toContain('固定最多 1 个');
    expect(botInfoDialog.textContent).toContain('BFS 路径搜索');
    expect(botInfoDialog.textContent).toContain('c7cdf9e');
    click('#botInfoCloseBtn');
    expect(botInfoDialog.open).toBe(false);

    botInfoTriggers[1].click();
    const nnDialog = document.querySelector<HTMLDialogElement>('#nnDialog')!;
    expect(nnDialog.open).toBe(true);
    expect(nnDialog.textContent).toContain('1,156,486');
    expect(nnDialog.textContent).toContain('DLRNNH1');
    expect(nnDialog.textContent).toContain('10,578 steps');
    expect(nnDialog.textContent).toContain('精确反事实标注');
    expect(nnDialog.textContent).toContain('anchor075_seed909');
    expect(nnDialog.textContent).toContain('16 个 worker');
    expect(nnDialog.textContent).toContain('seedcup2023');
    expect(nnDialog.textContent).toContain('seedcup-cppsdk');
    expect(nnDialog.textContent).toContain('deeplearning');
    expect(nnDialog.textContent).toContain('seedcup-web');
    expect(nnDialog.textContent).toContain('TypeScript 推理实现');
    expect(nnDialog.textContent).toContain('1v1 训练');
    expect(nnDialog.textContent).toContain('多人局属于弱兼容');
    expect(nnDialog.textContent).toContain('1426 + 16 + 30 + 144 = 1616');
    expect(nnDialog.textContent).toContain('827,392');
    expect(nnDialog.textContent).toContain('262,144');
    expect(nnDialog.textContent).toContain('65,536');
    expect(nnDialog.textContent).toContain('71.54%');
    expect(nnDialog.textContent).toContain('HP/3');
    expect(nnDialog.textContent).toContain('炸弹上限/5');
    expect(nnDialog.textContent).toContain('道具不是可攻击单位');
    expect(nnDialog.textContent).toContain('拾取前不区分道具类型');
    expect(nnDialog.textContent).toContain('loss_weight 为 0');
    expect(nnDialog.textContent).toContain(
      'target = 0.75 × base_policy + 0.25 × counterfactual_target',
    );
    expect(nnDialog.textContent).toContain('学习率使用 0.00005');
    expect(nnDialog.textContent).toContain('多 seed 审计后才晋级');
    expect(nnDialog.textContent).toContain('1,800 局采集');
    expect(nnDialog.textContent).toContain('309,129 steps');
    expect(nnDialog.textContent).toContain('1,000 局采集');
    expect(nnDialog.textContent).toContain('330,877 steps');
    expect(nnDialog.textContent).toContain('0 个新对局');
    expect(nnDialog.textContent).toContain('434 个监督状态');
    expect(nnDialog.textContent).toContain('402 labels');
    expect(nnDialog.textContent).toContain('33,224,960');
    expect(nnDialog.textContent).toContain('61,680');
    expect(nnDialog.textContent).toContain('2,508');
    expect(nnDialog.textContent).toContain('2 分 38 秒');
    expect(nnDialog.textContent).toContain('2 分 51 秒');
    expect(nnDialog.textContent).toContain('5 分 28 秒');
    expect(nnDialog.textContent).toContain('不能可靠拆出每一段的分钟数');
    expect(nnDialog.textContent).toContain('冻结 RNN body');
    expect(nnDialog.textContent).toContain('没有下载公开数据集');
    const download = document.querySelector<HTMLAnchorElement>(
      '#nnDownloadLink',
    )!;
    expect(download.href).toContain('/models/pure-nn.rnn');
    expect(download.download).toBe('pure-nn.rnn');
    expect(document.body.classList).toContain('dialog-open');
    click('#nnCloseBtn');
    expect(nnDialog.open).toBe(false);
    expect(document.body.classList).not.toContain('dialog-open');
    botInfoTriggers[1].focus();
    const spaceEvent = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    botInfoTriggers[1].dispatchEvent(spaceEvent);
    expect(spaceEvent.defaultPrevented).toBe(false);
  });

  test('start, pause, resume, reset, and single step work', async () => {
    click('#playBtn');
    expect(text('#playBtn')).toBe('暂停');
    await viWaitFor(() => round() >= 2, 10_000);

    click('#playBtn');
    expect(text('#playBtn')).toBe('开始');
    const paused = round();
    await wait(600);
    expect(round()).toBe(paused);

    click('#playBtn');
    await viWaitFor(() => round() > paused, 10_000);
    click('#resetBtn');
    expect(round()).toBe(0);
    expect(text('#playBtn')).toBe('开始');
    await wait(500);
    expect(round()).toBe(0);

    click('#stepBtn');
    await viWaitFor(() => round() === 1, 5_000);
    expect(text('#playBtn')).toBe('开始');
  });

  test('player count, map size, bots, seed, and settings reset state', () => {
    changeSelect('#playerNum', '4');
    expect(document.querySelectorAll('.seat-select')).toHaveLength(4);
    expect(document.querySelectorAll('.player-card')).toHaveLength(4);

    changeSelect('#mapSize', '15');
    changeSelect('.seat-select[data-seat="0"]', 'manual');
    changeSelect('.seat-select[data-seat="1"]', 'hard');
    changeSelect('.seat-select[data-seat="2"]', 'search');
    changeSelect('.seat-select[data-seat="3"]', 'nn');
    expect(
      [...document.querySelectorAll<HTMLSelectElement>('.seat-select')].map(
        (seat) => seat.value,
      ),
    ).toEqual(['manual', 'hard', 'search', 'nn']);
    expect(
      [...document.querySelectorAll('.bot-info-trigger')].map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual([
      '查看蓝方手动说明',
      '查看红方困难说明',
      '查看绿方搜索增强说明',
      '查看黄方纯神经网络说明',
    ]);
    expect(
      [...document.querySelectorAll('.seat-selection-label')].map(
        (label) => label.textContent,
      ),
    ).toEqual(['手动', '困难', '搜索增强', '纯神经网络']);

    const descriptions = [
      ['0', '手动玩家', '键盘与屏幕方向键'],
      ['1', '困难机器人', '最多等于当前 speed'],
      ['2', '搜索增强机器人', '3 层 / 每动作 1 rollout'],
    ];
    for (const [seat, title, detail] of descriptions) {
      document
        .querySelector<HTMLButtonElement>(`.bot-info-trigger[data-bot-info="${seat}"]`)!
        .click();
      const dialog =
        document.querySelector<HTMLDialogElement>('#botInfoDialog')!;
      expect(dialog.open).toBe(true);
      expect(dialog.textContent).toContain(title);
      expect(dialog.textContent).toContain(detail);
      if (seat === '2') {
        expect(dialog.textContent).toContain('静止 + 四方向 + 放弹');
        expect(dialog.textContent).toContain('RuleBot(true, orderMode=4)');
        expect(dialog.textContent).toContain('ContestHardBot');
        expect(dialog.textContent).toContain('0.05');
        expect(dialog.textContent).toContain('0.005');
        expect(dialog.textContent).toContain('危险区时不搜索');
        expect(dialog.textContent).toContain('模型加载失败');
      }
      click('#botInfoCloseBtn');
    }

    const seed = document.querySelector<HTMLInputElement>('#seedInput')!;
    seed.value = '12345';
    seed.dispatchEvent(new Event('change', { bubbles: true }));
    changeInput('#playerHpInput', '3');
    changeInput('#maxHpInput', '5');
    changeInput('#bombNumInput', '4');
    changeInput('#bombRangeInput', '3');
    changeInput('#playerSpeedInput', '3');
    changeInput('#bombTimeInput', '5');
    changeInput('#bombRandomInput', '2');
    changeInput('#mudRandomInput', '60');
    changeInput('#potionProbabilityInput', '40');
    changeInput('#wallRandomInput', '20');
    changeInput('#maxRoundInput', '500');
    expect(text('#roundBadge')).toBe('回合 0');
    expect(document.querySelector('#stats')?.textContent).toContain('0/4');
  });

  test('shuffle clears fixed seed and keyboard/manual controls do not error', () => {
    const seed = document.querySelector<HTMLInputElement>('#seedInput')!;
    seed.value = '100';
    click('#shuffleBtn');
    expect(seed.value).toBe('');

    const play = document.querySelector<HTMLButtonElement>('#playBtn')!;
    play.focus();
    const focusedMove = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    });
    play.dispatchEvent(focusedMove);
    expect(focusedMove.defaultPrevented).toBe(true);

    for (const key of ['w', 'a', 's', 'd', 'ArrowUp', ' ']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      '[data-action]',
    )) {
      button.click();
    }
  });

  test('exports, imports, and renders every board element and winner state', async () => {
    let exportedBlob: Blob | null = null;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      exportedBlob = blob;
      return 'blob:test-export';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    click('#exportBtn');
    expect(exportedBlob).not.toBeNull();
    const payload = JSON.parse(await exportedBlob!.text());
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;

    payload.controls.playerNum = '2';
    payload.controls.mapSize = '13';
    payload.controls.bots = ['manual', 'hard'];
    payload.controls.advanced.unknownControl = 'ignored';
    payload.state.config.playerNum = 2;
    payload.state.over = true;
    payload.state.winnerIds = [payload.state.players[0].id];
    payload.state.players = payload.state.players.slice(0, 2);
    payload.state.players[0].x = 0;
    payload.state.players[0].y = 0;
    payload.state.players[0].invincible = 5;
    payload.state.players[0].shield = 0;
    payload.state.players[1].x = 12;
    payload.state.players[1].y = 12;
    payload.state.players[1].invincible = 0;
    payload.state.players[1].shield = 5;
    for (const row of payload.state.cells) {
      for (const cell of row) {
        cell.block = null;
        cell.item = 0;
        cell.bombId = null;
        cell.players = [];
      }
    }
    payload.state.cells[0][0].players = [payload.state.players[0].id];
    payload.state.cells[12][12].players = [payload.state.players[1].id];
    payload.state.cells[2][2].block = 'wall';
    payload.state.cells[2][3].block = 'mud';
    const items = [1, 2, 3, 4, 5, 6, 7];
    items.forEach((item, index) => {
      payload.state.cells[4][index + 2].item = item;
    });
    payload.state.bombs = [
      {
        id: 501,
        x: 6,
        y: 6,
        range: 2,
        timeLeft: 1,
        ownerId: payload.state.players[0].id,
        status: 0,
      },
      {
        id: 502,
        x: 8,
        y: 8,
        range: 2,
        timeLeft: 3,
        ownerId: payload.state.players[1].id,
        status: 0,
      },
    ];
    payload.state.cells[6][6].bombId = 501;
    payload.state.cells[8][8].bombId = 502;
    payload.state.nextBombId = 503;
    payload.state.blockMeta = [
      {
        id: 601,
        x: 2,
        y: 2,
        removable: false,
        hiddenItem: 0,
      },
      {
        id: 602,
        x: 2,
        y: 3,
        removable: true,
        hiddenItem: 7,
      },
    ];

    await importPayload(payload);
    expect(document.querySelector('#winnerOverlay')?.classList).toContain(
      'show',
    );
    expect(document.querySelector('#winnerBig')?.textContent).toContain(
      '获胜',
    );
    expect(document.querySelector('#stats')?.textContent).toContain('无敌');
    expect(document.querySelector('#stats')?.textContent).toContain('护盾');
    await wait(50);
    const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
    expect(canvas.toDataURL().length).toBeGreaterThan(1000);
  });

  test('imports legacy defaults, migrates hybrid, renders draw, and restarts ended matches', async () => {
    changeSelect('#playerNum', '4');
    let exportedBlob: Blob | null = null;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      exportedBlob = blob;
      return 'blob:legacy-export';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    click('#exportBtn');
    const payload = JSON.parse(await exportedBlob!.text());
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;

    payload.controls.playerNum = '3';
    payload.controls.bots = ['hybrid'];
    payload.controls.advanced = {};
    payload.state.config.playerNum = 3;
    payload.state.over = true;
    payload.state.winnerIds = payload.state.players
      .slice(0, 2)
      .map((player: { id: number }) => player.id);
    payload.state.players = payload.state.players.slice(0, 3);
    payload.state.serverRngState = undefined;
    delete payload.state.serverRngState;
    delete payload.state.bombBucketCount;
    for (const row of payload.state.cells) {
      for (const cell of row) {
        delete cell.lastBombRound;
        delete cell.playerBucketCount;
      }
    }
    payload.state.players[2].alive = false;
    payload.state.players[2].x = -1;
    payload.state.players[2].y = -1;
    await importPayload(payload);

    const seats = [
      ...document.querySelectorAll<HTMLSelectElement>('.seat-select'),
    ];
    expect(seats).toHaveLength(3);
    expect(seats[0].value).toBe('search');
    expect(seats[1].value).toBe('nn');
    expect(seats[2].value).toBe('easy');
    expect(
      [...document.querySelectorAll('.bot-info-trigger')].map((button) =>
        button.getAttribute('aria-controls'),
      ),
    ).toEqual(['botInfoDialog', 'nnDialog', 'botInfoDialog']);
    expect(
      [...document.querySelectorAll('.seat-selection-label')].map(
        (label) => label.textContent,
      ),
    ).toEqual(['搜索增强', '纯神经网络', '简单']);
    expect(document.querySelector('#winnerBig')?.textContent).toBe('平局');
    expect(document.querySelector('#winnerOverlay')?.classList).toContain(
      'show',
    );

    click('#playBtn');
    expect(text('#playBtn')).toBe('暂停');
    click('#playBtn');
    expect(text('#playBtn')).toBe('开始');
  });

  test('covers passive controls and dialog backdrop paths', () => {
    const file = document.querySelector<HTMLInputElement>('#importFile')!;
    Object.defineProperty(file, 'files', {
      configurable: true,
      value: [],
    });
    file.dispatchEvent(new Event('change', { bubbles: true }));

    click('#helpBtn');
    const dialog = document.querySelector<HTMLDialogElement>('#helpDialog')!;
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog.open).toBe(false);

    changeSelect('.seat-select[data-seat="0"]', 'easy');
    const easyTrigger = document.querySelector<HTMLButtonElement>(
      '.bot-info-trigger[data-bot-info="0"]',
    )!;
    easyTrigger.click();
    const botInfoDialog =
      document.querySelector<HTMLDialogElement>('#botInfoDialog')!;
    expect(botInfoDialog.open).toBe(true);
    expect(document.body.classList).toContain('dialog-open');
    botInfoDialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(botInfoDialog.open).toBe(false);
    expect(document.body.classList).not.toContain('dialog-open');

    const nnTrigger = document.querySelector<HTMLButtonElement>(
      '.bot-info-trigger[data-bot-info="1"]',
    )!;
    nnTrigger.click();
    const nnDialog = document.querySelector<HTMLDialogElement>('#nnDialog')!;
    nnDialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(nnDialog.open).toBe(false);
    expect(document.body.classList).not.toContain('dialog-open');

    const speed = document.querySelector<HTMLInputElement>('#speedInput')!;
    speed.value = '1';
    speed.dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
  });

  test('rejects unsupported import versions', async () => {
    await importPayload({ version: 2 });
    expect(document.querySelector('#modelText')?.textContent).toContain(
      '不支持的存档版本',
    );
  });

  test('animates explosions, logs game over, and blocks stepping ended games', async () => {
    changeSelect('#playerNum', '2');
    let exportedBlob: Blob | null = null;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      exportedBlob = blob;
      return 'blob:blast-export';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    click('#exportBtn');
    const payload = JSON.parse(await exportedBlob!.text());
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;

    payload.controls.bots = ['manual', 'manual'];
    payload.state.over = false;
    payload.state.winnerIds = [];
    for (const row of payload.state.cells) {
      for (const cell of row) {
        cell.block = null;
        cell.item = 0;
        cell.bombId = null;
        cell.players = [];
      }
    }
    payload.state.players[0].x = 6;
    payload.state.players[0].y = 5;
    payload.state.players[0].hp = 1;
    payload.state.players[0].alive = true;
    payload.state.players[1].x = 6;
    payload.state.players[1].y = 7;
    payload.state.players[1].hp = 1;
    payload.state.players[1].alive = true;
    payload.state.cells[6][5].players = [payload.state.players[0].id];
    payload.state.cells[6][7].players = [payload.state.players[1].id];
    payload.state.bombs = [
      {
        id: 700,
        x: 6,
        y: 6,
        range: 2,
        timeLeft: 0,
        ownerId: payload.state.players[0].id,
        status: 0,
      },
    ];
    payload.state.cells[6][6].bombId = 700;
    payload.state.nextBombId = 701;
    payload.state.blockMeta = [];
    await importPayload(payload);
    click('#stepBtn');
    await viWaitFor(
      () => text('#roundBadge').includes('结束'),
      5_000,
    );
    expect(document.querySelector('#log')?.textContent).toContain('爆炸');
    expect(document.querySelector('#winnerOverlay')?.classList).toContain(
      'show',
    );
    const endedRound = round();
    click('#stepBtn');
    await wait(50);
    expect(round()).toBe(endedRound);
    await wait(400);
    expect(document.querySelector<HTMLCanvasElement>('#board')!.toDataURL())
      .toContain('data:image/png');
  });
});

function click(selector: string): void {
  document.querySelector<HTMLButtonElement>(selector)?.click();
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() ?? '';
}

function round(): number {
  return Number(text('#roundBadge').match(/\d+/)?.[0] ?? 0);
}

function changeSelect(selector: string, value: string): void {
  const select = document.querySelector<HTMLSelectElement>(selector)!;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function changeInput(selector: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function viWaitFor(
  predicate: () => boolean | undefined,
  timeout: number,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) {
      throw new Error(`condition timed out after ${timeout}ms`);
    }
    await wait(25);
  }
}

async function importPayload(payload: unknown): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('#importFile')!;
  const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
  const generation = Number(canvas.dataset.importGeneration ?? 0);
  const file = new File([JSON.stringify(payload)], 'match.json', {
    type: 'application/json',
  });
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [file],
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await viWaitFor(
    () => Number(canvas.dataset.importGeneration ?? 0) > generation,
    5_000,
  );
}
