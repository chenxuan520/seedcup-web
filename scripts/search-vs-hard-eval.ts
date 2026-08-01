import {
  Action,
  cloneGame,
  defaultConfig,
  simulateClientAction,
  type BotController,
  type GameState,
} from '../src/engine';
import {
  ContestHardBot,
  HybridSearchBot,
  SearchBot,
} from '../src/bots';
import { loadPureNnPolicyFromText } from '../src/rnn';
import { readFileSync } from 'node:fs';
import {
  createCppGameSimGame,
  initializeCppGameSimState,
  stepCppRollout,
} from '../src/cpp-game-sim';

const baseSeed = Number(process.argv[2] ?? 1000);
const beginGame = Number(process.argv[3] ?? 0);
const endGame = Number(process.argv[4] ?? 60);
const pairedSides = process.argv.includes('--paired-sides');
const summaryOnly = process.argv.includes('--summary');
const requireNonLosing = process.argv.includes('--require-non-losing');
const depth = readNumber('--depth', 6);
const rollouts = readNumber('--rollouts', 2);
const minGap = readNumber('--min-gap', 0.05);
const hybrid = process.argv.includes('--hybrid');
const modelText = hybrid
  ? readFileSync('public/models/pure-nn.rnn', 'utf8')
  : '';

let searchWins = 0;
let hardWins = 0;
let draws = 0;
for (let game = beginGame; game < endGame; game++) {
  const pairIndex = pairedSides ? Math.floor(game / 2) : game;
  const seed = baseSeed + pairIndex;
  const searchFirst = game % 2 === 0;
  const result = play(seed, searchFirst);
  if (result.result === 'search') searchWins++;
  else if (result.result === 'hard') hardWins++;
  else draws++;
  if (!summaryOnly) {
    console.log(JSON.stringify({ game, seed, searchFirst, ...result }));
  }
}
const games = searchWins + hardWins + draws;
console.log(
  `search_vs_hard games=${games} search_wins=${searchWins} ` +
    `hard_wins=${hardWins} draws=${draws} ` +
    `search_winrate=${games ? (searchWins / games).toFixed(4) : '0.0000'} ` +
    `hybrid=${hybrid ? 1 : 0} paired_sides=${pairedSides ? 1 : 0}`,
);
if (requireNonLosing && searchWins < hardWins) process.exit(1);

function play(
  seed: number,
  searchFirst: boolean,
): { round: number; result: 'search' | 'hard' | 'draw'; winner: number } {
  const state = createCppGameSimGame(seed, {
    ...defaultConfig,
    maxRound: 400,
  });
  initializeCppGameSimState(state, 400);
  const search = hybrid
    ? new HybridSearchBot(loadPureNnPolicyFromText(modelText))
    : new SearchBot(depth, rollouts, minGap);
  const hard = new ContestHardBot();
  const searchId = searchFirst ? state.players[0].id : state.players[1].id;
  const hardId = searchFirst ? state.players[1].id : state.players[0].id;
  const bots = new Map<number, BotController>([
    [searchId, search],
    [hardId, hard],
  ]);
  for (const [playerId, bot] of bots) bot.reset?.(playerId, state);

  while (!state.over) {
    const actions = new Map<number, Action[]>();
    for (const player of state.players) {
      if (!player.alive) continue;
      const bot = bots.get(player.id);
      if (!bot) continue;
      const planning = cloneForClient(state, player.id);
      const batch: Action[] = [];
      const speed = bot.movesPerTurn?.(player) ?? player.speed;
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
  return {
    round: state.round,
    result:
      winner < 0 ? 'draw' : winner === searchId ? 'search' : 'hard',
    winner,
  };
}

function cloneForClient(state: GameState, salt: number): GameState {
  return cloneGame(state, salt);
}

function readNumber(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
}
