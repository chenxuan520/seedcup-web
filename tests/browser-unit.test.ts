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
    expect(document.querySelector('#modelStatus')?.classList).toContain(
      'ready',
    );

    click('#helpBtn');
    expect(
      (document.querySelector('#helpDialog') as HTMLDialogElement).open,
    ).toBe(true);
    click('#helpCloseBtn');
    expect(
      (document.querySelector('#helpDialog') as HTMLDialogElement).open,
    ).toBe(false);
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
