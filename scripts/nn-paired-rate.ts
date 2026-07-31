import { readFileSync } from 'node:fs';
import {
  createGame,
  defaultConfig,
  runRound,
  type BotController,
} from '../src/engine';
import { PureNnBot, RuleBot } from '../src/bots';
import { loadPureNnPolicyFromText } from '../src/rnn';

const modelText = readFileSync('public/models/pure-nn.rnn', 'utf8');

function play(seed: number, nnFirst: boolean): number {
  const state = createGame(seed, { ...defaultConfig, maxRound: 400 });
  const policy = loadPureNnPolicyFromText(modelText);
  const nn = new PureNnBot(policy);
  const easy = new RuleBot(false, 0);
  const nnId = nnFirst ? 1 : 2;
  const easyId = nnFirst ? 2 : 1;
  const bots = new Map<number, BotController>([
    [nnId, nn],
    [easyId, easy],
  ]);
  for (const [playerId, bot] of bots) bot.reset?.(playerId, state);
  while (!state.over) runRound(state, bots);
  if (state.winnerIds.length !== 1) return 0;
  return state.winnerIds[0] === nnId ? 1 : -1;
}

let wins = 0;
let losses = 0;
let draws = 0;
const pairs = 60;
for (let index = 0; index < pairs; index++) {
  const seed = 1000 + index * 7;
  for (const nnFirst of [true, false]) {
    const result = play(seed, nnFirst);
    if (result > 0) wins++;
    else if (result < 0) losses++;
    else draws++;
  }
}

const games = pairs * 2;
console.log(
  `paired games=${games} nn_wins=${wins} easy_wins=${losses} draws=${draws} ` +
    `nn_winrate=${(wins / games).toFixed(4)}`,
);
