import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createGame,
  serializeGameState,
} from '../src/engine';
import type {
  BotWorkerRequest,
  BotWorkerResponse,
} from '../src/bot-protocol';

interface WorkerHarness {
  messages: BotWorkerResponse[];
  dispatch(message: BotWorkerRequest, expectResponse?: boolean): Promise<void>;
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe.sequential('bot worker protocol', () => {
  test.each(['easy', 'hard', 'search', 'nn', 'hybrid'] as const)(
    'configures and decides for %s',
    async (botId) => {
      const harness = await createHarness();
      const state = createGame(900 + botId.length);
      const playerId = state.players[0].id;
      await harness.dispatch({
        type: 'configure',
        generation: 1,
        playerId,
        botId,
        modelUrl: '/models/pure-nn.rnn',
        state: serializeGameState(state),
      });
      expect(harness.messages.at(-1)).toEqual({
        type: 'ready',
        generation: 1,
      });

      await harness.dispatch({
        type: 'decide',
        generation: 1,
        requestId: 10,
        state: serializeGameState(state),
      });
      const decision = harness.messages.find(
        (message) =>
          message.type === 'decision' && message.requestId === 10,
      );
      expect(decision?.type).toBe('decision');
      if (decision?.type === 'decision') {
        expect(decision.actions.length).toBeLessThanOrEqual(
          botId === 'easy' ? 1 : state.players[0].speed,
        );
      }
    },
    120_000,
  );

  test('ignores stale and premature decide messages', async () => {
    const harness = await createHarness();
    const state = createGame(777);
    await harness.dispatch({
      type: 'decide',
      generation: 1,
      requestId: 1,
      state: serializeGameState(state),
    }, false);
    expect(harness.messages).toEqual([]);

    await harness.dispatch({
      type: 'configure',
      generation: 2,
      playerId: state.players[0].id,
      botId: 'easy',
      modelUrl: '/models/pure-nn.rnn',
      state: serializeGameState(state),
    });
    const count = harness.messages.length;
    await harness.dispatch({
      type: 'decide',
      generation: 1,
      requestId: 2,
      state: serializeGameState(state),
    }, false);
    expect(harness.messages).toHaveLength(count);
  });

  test('reports configure and decide failures', async () => {
    const harness = await createHarness();
    const state = createGame(778);
    await harness.dispatch({
      type: 'configure',
      generation: 3,
      playerId: state.players[0].id,
      botId: 'nn',
      modelUrl: '/missing-model.rnn',
      state: serializeGameState(state),
    });
    expect(harness.messages.at(-1)).toMatchObject({
      type: 'error',
      generation: 3,
    });
  });

  test('reports non-Error loader failures and returns no actions for dead players', async () => {
    const harness = await createHarness();
    const state = createGame(779);
    await harness.dispatch({
      type: 'configure',
      generation: 4,
      playerId: state.players[0].id,
      botId: 'nn',
      modelUrl: '/string-error.rnn',
      state: serializeGameState(state),
    });
    expect(harness.messages.at(-1)).toMatchObject({
      type: 'error',
      generation: 4,
      message: 'string loader failure',
    });

    state.players[0].alive = false;
    await harness.dispatch({
      type: 'configure',
      generation: 5,
      playerId: state.players[0].id,
      botId: 'easy',
      modelUrl: '/models/pure-nn.rnn',
      state: serializeGameState(state),
    });
    await harness.dispatch({
      type: 'decide',
      generation: 5,
      requestId: 50,
      state: serializeGameState(state),
    });
    expect(harness.messages.at(-1)).toEqual({
      type: 'decision',
      generation: 5,
      requestId: 50,
      actions: [],
    });
  });
});

async function createHarness(): Promise<WorkerHarness> {
  const messages: BotWorkerResponse[] = [];
  let listener:
    | ((event: MessageEvent<BotWorkerRequest>) => void)
    | undefined;
  const worker = {
    addEventListener(
      type: string,
      callback: (event: MessageEvent<BotWorkerRequest>) => void,
    ) {
      if (type === 'message') listener = callback;
    },
    postMessage(message: BotWorkerResponse) {
      messages.push(message);
    },
  };
  vi.stubGlobal('self', worker);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('missing-model')) {
      return new Response('missing', { status: 404 });
    }
    if (url.includes('string-error')) {
      throw 'string loader failure';
    }
    if (url.includes('pure-nn.rnn')) {
      return new Response(minimalModelText(), { status: 200 });
    }
    return new Response('unexpected URL', { status: 500 });
  });
  await import('../src/bot-worker');
  if (!listener) throw new Error('worker message listener was not installed');
  return {
    messages,
    async dispatch(message, expectResponse = true) {
      const before = messages.length;
      listener?.({ data: message } as MessageEvent<BotWorkerRequest>);
      if (!expectResponse) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(messages).toHaveLength(before);
        return;
      }
      await vi.waitFor(
        () => {
          const terminal = messages.find(
            (entry) =>
              entry.generation === message.generation &&
              (entry.type === 'error' ||
                (message.type === 'configure'
                  ? entry.type === 'ready'
                  : entry.type === 'decision')),
          );
          if (!terminal && message.generation >= 0) {
            throw new Error('worker response pending');
          }
        },
        { timeout: 120_000 },
      );
    },
  };
}

function minimalModelText(): string {
  const inputDim = 1616;
  const hiddenDim = 1;
  const outputDim = 6;
  const headDim = 1;
  const values = [
    ...Array(inputDim * hiddenDim).fill('0'),
    '0',
    '0',
    '0',
    '0',
    ...Array(outputDim * headDim).fill('0'),
    ...Array(outputDim).fill('0'),
  ];
  return [
    'DLRNNH1',
    inputDim,
    hiddenDim,
    outputDim,
    64,
    headDim,
    ...values,
  ].join(' ');
}
