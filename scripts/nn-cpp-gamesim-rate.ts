import { readFileSync } from 'node:fs';

import {
  Action,
  defaultConfig,
  simulateClientAction,
  type BotController,
  type GameState,
} from '../src/engine';
import { PureNnBot, RuleBot } from '../src/bots';
import {
  createCppGameSimGame,
  initializeCppGameSimState,
  stepCppRollout,
} from '../src/cpp-game-sim';
import { loadPureNnPolicyFromText } from '../src/rnn';

const modelText = readFileSync('public/models/pure-nn.rnn', 'utf8');
const seedStart = Number(process.argv[2] ?? 1000);
const games = Number(process.argv[3] ?? 60);

let wins = 0;
let losses = 0;
let draws = 0;

for (let game = 0; game < games; game++) {
  const seed = seedStart + game;
  const state = createCppGameSimGame(seed, {
    ...defaultConfig,
    maxRound: 400,
  });
  initializeCppGameSimState(state, 400);
  const nn = new PureNnBot(loadPureNnPolicyFromText(modelText));
  const easy = new RuleBot(false, 0);
  const bots = new Map<number, BotController>([
    [state.players[0].id, nn],
    [state.players[1].id, easy],
  ]);
  for (const [playerId, bot] of bots) bot.reset?.(playerId, state);

  while (!state.over) {
    const actions = new Map<number, Action[]>();
    for (const player of state.players) {
      if (!player.alive) continue;
      const bot = bots.get(player.id);
      if (!bot) continue;
      const speed = bot.movesPerTurn?.(player) ?? player.speed;
      const planning = cloneForPlanning(state);
      const batch: Action[] = [];
      for (let sub = 0; sub < speed; sub++) {
        const action = bot.chooseAction(planning, player.id, sub);
        if (action !== Action.Silent) batch.push(action);
        simulateClientAction(planning, player.id, action);
      }
      actions.set(player.id, batch);
    }
    stepCppRollout(state, actions);
  }

  const winner = state.winnerIds.length === 1 ? state.winnerIds[0] : -1;
  console.log(
    `game=${game} seed=${seed} round=${state.round} winner=${winner}`,
  );
  if (winner === state.players[0].id) wins++;
  else if (winner === state.players[1].id) losses++;
  else draws++;
}

console.log(
  `cpp_gamesim games=${games} nn_wins=${wins} easy_wins=${losses} ` +
    `draws=${draws} nn_winrate=${(wins / games).toFixed(4)}`,
);

function cloneForPlanning(state: GameState): GameState {
  const clone: GameState = {
    ...state,
    config: { ...state.config },
    winnerIds: [...state.winnerIds],
    cells: state.cells.map((row) =>
      row.map((cell) => ({
        ...cell,
        players: new Set(cell.players),
      })),
    ),
    players: state.players.map((player) => ({ ...player })),
    bombs: state.bombs.map((bomb) => ({ ...bomb })),
    rng: state.rng.fork(0),
  };
  const sourceMeta = (
    state as unknown as { blockMeta: Map<number, unknown> }
  ).blockMeta;
  (clone as unknown as { blockMeta: Map<number, unknown> }).blockMeta =
    new Map(sourceMeta);
  return clone;
}
