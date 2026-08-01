import { beforeAll, describe, expect, test, vi } from 'vitest';

interface WorkerMessage {
  type: string;
  generation: number;
  requestId?: number;
}

class ControlledWorker {
  static instances: ControlledWorker[] = [];

  readonly messages: WorkerMessage[] = [];
  private messageListeners: Array<(event: MessageEvent) => void> = [];
  private errorListeners: Array<(event: ErrorEvent) => void> = [];
  private terminated = false;

  constructor() {
    ControlledWorker.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent & ErrorEvent) => void,
  ): void {
    if (type === 'message') this.messageListeners.push(listener);
    if (type === 'error') this.errorListeners.push(listener);
  }

  postMessage(message: WorkerMessage): void {
    this.messages.push(message);
    if (message.type === 'configure') {
      this.emitMessage({ type: 'ready', generation: message.generation - 1 });
      queueMicrotask(() =>
        this.emitMessage({ type: 'ready', generation: message.generation }),
      );
      return;
    }
    if (message.type === 'decide') {
      const index = ControlledWorker.instances.indexOf(this);
      queueMicrotask(() => {
        if (this.terminated) return;
        if (index % 2 === 0) {
          this.emitMessage({
            type: 'decision',
            generation: message.generation,
            requestId: message.requestId,
            actions: [],
          });
        } else {
          this.emitMessage({
            type: 'error',
            generation: message.generation,
            requestId: message.requestId,
            message: 'controlled decision failure',
          });
        }
      });
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  fail(message = ''): void {
    const event = { message } as ErrorEvent;
    for (const listener of this.errorListeners) listener(event);
  }

  private emitMessage(data: unknown): void {
    const event = { data } as MessageEvent;
    for (const listener of this.messageListeners) listener(event);
  }
}

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal('Worker', ControlledWorker);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(minimalModelText(), { status: 200 })),
  );
  await import('../src/main');
  await waitFor(() => ControlledWorker.instances.length === 2);
  await waitFor(() =>
    document.querySelector('#modelStatus')?.classList.contains('ready'),
  );
});

describe('main Worker failure and race handling', () => {
  test('stale messages are ignored and decision failures are reported', async () => {
    click('#stepBtn');
    await waitFor(
      () =>
        document
          .querySelector('#modelText')
          ?.textContent?.includes('决策失败'),
    );
    expect(document.querySelector('#modelStatus')?.classList).toContain(
      'error',
    );
    expect(currentRound()).toBe(1);
  });

  test('worker error event uses fallback text without breaking reset', async () => {
    const playerNumber = document.querySelector<HTMLSelectElement>(
      '#playerNum',
    )!;
    playerNumber.value = '3';
    playerNumber.dispatchEvent(new Event('change', { bubbles: true }));
    if (ControlledWorker.instances.length < 5) {
      throw new Error('expected three replacement workers');
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    ControlledWorker.instances.at(-1)?.fail('');
    await new Promise((resolve) => setTimeout(resolve, 0));
    click('#resetBtn');
    expect(currentRound()).toBe(0);
    expect(document.querySelectorAll('.player-card')).toHaveLength(3);
  });

  test('reset terminates workers while a round is pending', async () => {
    click('#stepBtn');
    click('#resetBtn');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(currentRound()).toBe(0);
    expect(document.querySelector('#playBtn')?.textContent).toBe('开始');
  });

  test('reset settles readiness for a worker terminated before ready', async () => {
    const playerNumber = document.querySelector<HTMLSelectElement>(
      '#playerNum',
    )!;
    playerNumber.value = '4';
    playerNumber.dispatchEvent(new Event('change', { bubbles: true }));
    click('#resetBtn');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(currentRound()).toBe(0);
    expect(document.querySelectorAll('.player-card')).toHaveLength(4);
  });

  test('unknown selector values use fallback bot creation', async () => {
    const select = document.querySelector<HTMLSelectElement>(
      '.seat-select[data-seat="0"]',
    )!;
    select.innerHTML += '<option value="unknown">unknown</option>';
    select.value = 'unknown';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(document.querySelectorAll('.player-card').length).toBeGreaterThan(0);
  });
});

function click(selector: string): void {
  document.querySelector<HTMLButtonElement>(selector)?.click();
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
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function minimalModelText(): string {
  const inputDim = 1616;
  const outputDim = 6;
  return [
    'DLRNNH1',
    inputDim,
    1,
    outputDim,
    64,
    1,
    ...Array(inputDim).fill('0'),
    '0',
    '0',
    '0',
    '0',
    ...Array(outputDim).fill('0'),
    ...Array(outputDim).fill('0'),
  ].join(' ');
}
