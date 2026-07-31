import { readFileSync } from 'node:fs';
import {
  createGame,
  defaultConfig,
  runRound,
  type BotController,
} from '../src/engine';
import { PureNnBot, RuleBot } from '../src/bots';
import { loadPureNnPolicyFromText } from '../src/rnn';

interface FullMap {
  player_id: number;
  round: number;
  cells: Array<
    Array<{
      block_id: number;
      bomb_id: number;
      item: number;
      players: number[];
    }>
  >;
  players: Array<{
    id: number;
    x: number;
    y: number;
    alive: number;
    hp: number;
    speed: number;
    bomb_max_num: number;
    bomb_now_num: number;
    bomb_range: number;
    invincible_time: number;
    shield_time: number;
    has_gloves: number;
    score: number;
  }>;
  bombs: Array<{
    id: number;
    x: number;
    y: number;
    range: number;
    time_left: number;
    owner_id: number;
  }>;
  blocks: Array<{
    id: number;
    x: number;
    y: number;
    removable: number;
    hidden_item: number;
  }>;
}

interface MapFixture {
  seed: number;
  maps: FullMap[];
}

const fixture = JSON.parse(
  readFileSync('fixtures/cpp_maps_seed1000.json', 'utf8'),
) as MapFixture;
const modelText = readFileSync('public/models/pure-nn.rnn', 'utf8');

let wins = 0;
let losses = 0;
let draws = 0;
for (let index = 0; index < fixture.maps.length; index++) {
  const state = createGame(fixture.seed + index, {
    ...defaultConfig,
    size: fixture.maps[index].cells.length,
    maxRound: 400,
  });
  const nn = new PureNnBot(loadPureNnPolicyFromText(modelText));
  const easy = new RuleBot(false, 0);
  const bots = new Map<number, BotController>([
    [state.players[0].id, nn],
    [state.players[1].id, easy],
  ]);
  for (const [playerId, bot] of bots) bot.reset?.(playerId, state);
  while (!state.over) runRound(state, bots);
  if (state.winnerIds.length !== 1) draws++;
  else if (state.winnerIds[0] === state.players[0].id) wins++;
  else losses++;
}

console.log(
  `cpp_maps games=${fixture.maps.length} nn_wins=${wins} ` +
    `easy_wins=${losses} draws=${draws} ` +
    `nn_winrate=${(wins / fixture.maps.length).toFixed(4)}`,
);
