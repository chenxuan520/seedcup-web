import { readFileSync } from 'node:fs';
import {
  BombStatus,
  Item,
  Rng,
  defaultConfig,
  runRound,
  type BotController,
  type BlockMeta,
  type GameState,
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
  const state = toGameState(fixture.seed + index, fixture.maps[index]);
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

function toGameState(seed: number, source: FullMap): GameState {
  const blockById = new Map(source.blocks.map((block) => [block.id, block]));
  const state: GameState = {
    config: { ...defaultConfig, size: source.cells.length, maxRound: 400 },
    seed,
    round: source.round,
    over: false,
    winnerIds: [],
    cells: source.cells.map((row) =>
      row.map((cell) => ({
        block:
          cell.block_id === -1
            ? null
            : blockById.get(cell.block_id)?.removable
              ? 'mud'
              : 'wall',
        item: cell.item as Item,
        bombId: cell.bomb_id === -1 ? null : cell.bomb_id,
        players: new Set(cell.players),
      })),
    ),
    players: source.players.map((player) => ({
      id: player.id,
      name: `P${player.id}`,
      x: player.x,
      y: player.y,
      alive: player.alive !== 0,
      hp: player.hp,
      speed: player.speed,
      bombMax: player.bomb_max_num,
      bombNow: player.bomb_now_num,
      bombRange: player.bomb_range,
      invincible: player.invincible_time,
      shield: player.shield_time,
      gloves: player.has_gloves !== 0,
      score: player.score,
      color: player.id === source.player_id ? '#3b82f6' : '#ef4444',
    })),
    bombs: source.bombs.map((bomb) => ({
      id: bomb.id,
      x: bomb.x,
      y: bomb.y,
      range: bomb.range,
      timeLeft: bomb.time_left,
      ownerId: bomb.owner_id,
      status: BombStatus.Silent,
    })),
    nextBombId: Math.max(1, ...source.bombs.map((bomb) => bomb.id + 1)),
    rng: new Rng(seed),
  };
  const blockMeta = new Map<number, BlockMeta>();
  for (const block of source.blocks) {
    blockMeta.set(block.id, {
      id: block.id,
      x: block.x,
      y: block.y,
      removable: block.removable !== 0,
      hiddenItem: block.hidden_item as Item,
    });
  }
  (
    state as unknown as {
      blockMeta: Map<number, BlockMeta>;
    }
  ).blockMeta = blockMeta;
  return state;
}
