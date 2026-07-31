import { readFileSync } from 'node:fs';
import {
  runRound,
  type BotController,
} from '../src/engine';
import { PureNnBot, RuleBot } from '../src/bots';
import { loadPureNnPolicyFromText } from '../src/rnn';
import {
  fullStateFixtureToState,
  type FullStateFixture,
} from './fixture-state';

interface MapFixture {
  seed: number;
  maps: FullStateFixture[];
}

const fixture = JSON.parse(
  readFileSync('fixtures/cpp_maps_seed1000.json', 'utf8'),
) as MapFixture;
const modelText = readFileSync('public/models/pure-nn.rnn', 'utf8');

let wins = 0;
let losses = 0;
let draws = 0;
for (let index = 0; index < fixture.maps.length; index++) {
  const seed = fixture.seed + index;
  const state = fullStateFixtureToState(seed, fixture.maps[index]);
  const nn = new PureNnBot(loadPureNnPolicyFromText(modelText));
  const easy = new RuleBot(false, 0);
  const bots = new Map<number, BotController>([
    [state.players[0].id, nn],
    [state.players[1].id, easy],
  ]);
  for (const [playerId, bot] of bots) bot.reset?.(playerId, state);
  while (!state.over) runRound(state, bots);
  console.log(
    `game=${index} seed=${seed} round=${state.round} ` +
      `winner=${state.winnerIds.length === 1 ? state.winnerIds[0] : -1}`,
  );
  if (state.winnerIds.length !== 1) draws++;
  else if (state.winnerIds[0] === state.players[0].id) wins++;
  else losses++;
}

console.log(
  `cpp_maps games=${fixture.maps.length} nn_wins=${wins} ` +
    `easy_wins=${losses} draws=${draws} ` +
    `nn_winrate=${(wins / fixture.maps.length).toFixed(4)}`,
);
