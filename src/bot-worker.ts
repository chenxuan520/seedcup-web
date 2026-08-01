/// <reference lib="webworker" />

import {
  Action,
  deserializeGameState,
  simulateClientAction,
  type BotController,
  type GameState,
} from './engine';
import {
  ContestHardBot,
  HybridSearchBot,
  PureNnBot,
  RuleBot,
} from './bots';
import {
  loadPureNnPolicy,
  type PureNnPolicy,
} from './rnn';
import type {
  BotId,
  BotWorkerRequest,
  BotWorkerResponse,
} from './bot-protocol';

const worker = self as DedicatedWorkerGlobalScope;

let generation = 0;
let playerId = -1;
let botId: BotId = 'easy';
let bot: BotController | null = null;
let policy: PureNnPolicy | null = null;
let messageQueue = Promise.resolve();

worker.addEventListener('message', (event: MessageEvent<BotWorkerRequest>) => {
  const message = event.data;
  messageQueue = messageQueue
    .then(() => handleMessage(message))
    .catch((error: unknown) => {
      post({
        type: 'error',
        generation,
        requestId: message.type === 'decide' ? message.requestId : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
    });
});

async function handleMessage(message: BotWorkerRequest): Promise<void> {
  if (message.type === 'configure') {
    generation = message.generation;
    playerId = message.playerId;
    botId = message.botId;
    policy = needsModel(botId) ? await loadPureNnPolicy(message.modelUrl) : null;
    bot = createBot(botId, policy);
    const state = deserializeGameState(message.state);
    bot.reset?.(playerId, state);
    post({ type: 'ready', generation });
    return;
  }

  if (
    message.generation !== generation ||
    playerId < 0 ||
    bot == null
  ) {
    return;
  }

  const state = deserializeGameState(message.state);
  const actions = decideBatch(state, bot, botId, playerId);
  post({
    type: 'decision',
    generation,
    requestId: message.requestId,
    actions,
  });
}

function decideBatch(
  state: GameState,
  controller: BotController,
  controllerId: BotId,
  id: number,
): Action[] {
  const player = state.players.find((candidate) => candidate.id === id);
  if (!player?.alive) return [];
  if (controllerId === 'easy') player.speed = 1;
  const actions: Action[] = [];
  for (let sub = 0; sub < Math.max(1, player.speed); sub++) {
    const action = controller.chooseAction(state, id, sub);
    if (action !== Action.Silent) actions.push(action);
    simulateClientAction(state, id, action);
  }
  return actions;
}

function createBot(
  id: BotId,
  nnPolicy: PureNnPolicy | null,
): BotController {
  switch (id) {
    case 'easy':
      return new RuleBot(false, 0);
    case 'hard':
      return new ContestHardBot();
    case 'search':
      return new HybridSearchBot(nnPolicy);
    case 'nn':
      return new PureNnBot(nnPolicy);
    case 'hybrid':
      return new HybridSearchBot(nnPolicy);
  }
}

function needsModel(id: BotId): boolean {
  return id === 'search' || id === 'nn' || id === 'hybrid';
}

function post(message: BotWorkerResponse): void {
  worker.postMessage(message);
}
