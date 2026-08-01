import { beforeAll, describe, expect, test, vi } from 'vitest';

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('missing', { status: 404 })),
  );
  await import('../src/main');
  await waitFor(() =>
    document.querySelector('#modelText')?.textContent?.includes('不可用'),
  );
});

describe('browser failure paths', () => {
  test('model failure leaves non-model bots usable', async () => {
    expect(document.querySelector('#modelText')?.textContent).toContain(
      '神经网络不可用',
    );
    const seats = [
      ...document.querySelectorAll<HTMLSelectElement>('.seat-select'),
    ];
    setSelect(seats[0], 'easy');
    setSelect(seats[1], 'hard');
    click('#playBtn');
    await waitFor(() => currentRound() >= 1, 10_000);
    click('#playBtn');
    expect(document.querySelector('#playBtn')?.textContent).toBe('开始');
  });

  test('invalid import reports an error without throwing', async () => {
    const input = document.querySelector<HTMLInputElement>('#importFile')!;
    const file = new File(['not json'], 'broken.json', {
      type: 'application/json',
    });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() =>
      document.querySelector('#modelText')?.textContent?.includes('导入失败'),
    );
    expect(document.querySelector('#modelStatus')?.classList).toContain(
      'error',
    );
  });
});

function click(selector: string): void {
  document.querySelector<HTMLButtonElement>(selector)?.click();
}

function setSelect(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function currentRound(): number {
  const text = document.querySelector('#roundBadge')?.textContent ?? '';
  return Number(text.match(/\d+/)?.[0] ?? 0);
}

async function waitFor(
  predicate: () => boolean | undefined,
  timeout = 5_000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) {
      throw new Error(`condition timed out after ${timeout}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
