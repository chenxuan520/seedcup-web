import {
  Action,
  applyActionBatch,
  cloneGame,
  createGame,
  defaultConfig,
  flushRound,
  simulateClientAction,
  type BotController,
  type GameState,
  type StepEvent,
} from '../src/engine';
import { RuleBot } from '../src/bots';

const seeds = [
  ...Array.from({ length: 60 }, (_, index) => 1000 + index),
  1110,
];
let games = 0;
let easyDeaths = 0;
let orderIndependentSelfDeaths = 0;
let arrivalRaces = 0;
let easyPushedBombDeaths = 0;
let opponentChainDeaths = 0;
const failures: string[] = [];

for (const seed of seeds) {
  for (const opponentHard of [false, true]) {
    const easyFirst = play(seed, opponentHard, true);
    const opponentFirst = play(seed, opponentHard, false);
    easyDeaths += Number(easyFirst.easyDied) + Number(opponentFirst.easyDied);
    easyPushedBombDeaths +=
      Number(easyFirst.pushedBombDeath) +
      Number(opponentFirst.pushedBombDeath);
    opponentChainDeaths +=
      Number(easyFirst.opponentChainDeath) +
      Number(opponentFirst.opponentChainDeath);
    if (easyFirst.selfBombDeath && opponentFirst.selfBombDeath) {
      orderIndependentSelfDeaths++;
      failures.push(
        `seed=${seed} opponent=${opponentHard ? 'hard' : 'easy'} ` +
          `easy_first_round=${easyFirst.round} ` +
          `opponent_first_round=${opponentFirst.round}`,
      );
    } else if (easyFirst.selfBombDeath || opponentFirst.selfBombDeath) {
      arrivalRaces++;
    }
    games += 2;
  }
}

console.log(
  `easy safety games=${games} deaths=${easyDeaths} ` +
    `order_independent_self_deaths=${orderIndependentSelfDeaths} ` +
    `arrival_races=${arrivalRaces} ` +
    `pushed_bomb_deaths=${easyPushedBombDeaths} ` +
    `opponent_chain_deaths=${opponentChainDeaths}`,
);
for (const failure of failures) console.warn(`easy safety observation ${failure}`);

function play(
  seed: number,
  opponentHard: boolean,
  easyFirst: boolean,
): {
  easyDied: boolean;
  selfBombDeath: boolean;
  pushedBombDeath: boolean;
  opponentChainDeath: boolean;
  round: number;
} {
  const state = createGame(seed, { ...defaultConfig, maxRound: 400 });
  const easyId = state.players[0].id;
  const opponentId = state.players[1].id;
  const bots = new Map<number, BotController>([
    [easyId, new RuleBot(false, 0)],
    [opponentId, new RuleBot(opponentHard, opponentHard ? 4 : 0)],
  ]);
  for (const [playerId, bot] of bots) bot.reset?.(playerId, state);

  let easyDied = false;
  let selfBombDeath = false;
  let pushedBombDeath = false;
  let opponentChainDeath = false;
  while (!state.over) {
    const batches = decideBatches(state, bots);
    const events: StepEvent[] = [];
    const order = easyFirst
      ? [easyId, opponentId]
      : [opponentId, easyId];
    for (const playerId of order) {
      applyActionBatch(
        state,
        playerId,
        batches.get(playerId) ?? [],
        events,
      );
    }
    flushRound(state, events);
    for (const event of events) {
      if (event.kind !== 'damage' || event.playerId !== easyId) continue;
      easyDied = true;
      if (event.bombOwnerId === easyId) selfBombDeath = true;
      if (event.pusherId === easyId) pushedBombDeath = true;
      if (
        event.ownerId !== easyId &&
        event.bombOwnerId === easyId
      ) {
        opponentChainDeath = true;
      }
    }
  }
  return {
    easyDied,
    selfBombDeath,
    pushedBombDeath,
    opponentChainDeath,
    round: state.round,
  };
}

function decideBatches(
  state: GameState,
  bots: Map<number, BotController>,
): Map<number, Action[]> {
  const batches = new Map<number, Action[]>();
  for (const player of state.players) {
    if (!player.alive) continue;
    const bot = bots.get(player.id);
    if (!bot) continue;
    const moveCount = bot.movesPerTurn?.(player) ?? player.speed;
    const planning = cloneGame(state, player.id);
    if (bot instanceof RuleBot && !bot.hard) {
      const planningPlayer = planning.players.find(
        (candidate) => candidate.id === player.id,
      );
      if (planningPlayer) planningPlayer.speed = 1;
    }
    const actions: Action[] = [];
    for (let sub = 0; sub < moveCount; sub++) {
      const action = bot.chooseAction(planning, player.id, sub);
      if (action !== Action.Silent) actions.push(action);
      simulateClientAction(planning, player.id, action);
    }
    batches.set(player.id, actions);
  }
  return batches;
}
