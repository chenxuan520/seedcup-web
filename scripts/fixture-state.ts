import {
  BombStatus,
  Item,
  Rng,
  defaultConfig,
  type BlockMeta,
  type GameState,
} from '../src/engine';

export interface FixtureCell {
  bomb_id: number;
  block_id: number;
  item: number;
  player_ids: number[];
}

export interface FixturePlayer {
  id: number;
  x: number;
  y: number;
  alive: number;
  bomb_max_num: number;
  bomb_now_num: number;
  bomb_range: number;
  speed: number;
  hp: number;
  invincible_time: number;
  score: number;
  shield_time: number;
  has_gloves: number;
}

export interface FixtureBomb {
  id: number;
  x: number;
  y: number;
  player_id: number;
  bomb_range: number;
  bomb_status: number;
}

export interface FixtureBlock {
  id: number;
  x: number;
  y: number;
  removable: number;
}

export interface FixtureMessage {
  player_id: number;
  game_round: number;
  grid: FixtureCell[][];
  players: FixturePlayer[];
  bombs: FixtureBomb[];
  blocks: FixtureBlock[];
}

export interface FullStateFixture {
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

export function fullStateFixtureToState(
  seed: number,
  source: FullStateFixture,
): GameState {
  const blocks = new Map(source.blocks.map((block) => [block.id, block]));
  const state: GameState = {
    config: {
      ...defaultConfig,
      size: source.cells.length,
      maxRound: 400,
    },
    seed,
    round: source.round,
    over: false,
    winnerIds: [],
    cells: source.cells.map((row) =>
      row.map((cell) => ({
        block:
          cell.block_id === -1
            ? null
            : blocks.get(cell.block_id)?.removable
              ? 'mud'
              : 'wall',
        item: cell.item as Item,
        bombId: cell.bomb_id === -1 ? null : cell.bomb_id,
        players: new Set(cell.players),
      })),
    ),
    players: source.players.map((player, index) => ({
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
      color: index === 0 ? '#3b82f6' : '#ef4444',
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
  (state as unknown as { blockMeta: Map<number, BlockMeta> }).blockMeta =
    new Map(
      source.blocks.map((block) => [
        block.id,
        {
          id: block.id,
          x: block.x,
          y: block.y,
          removable: block.removable !== 0,
          hiddenItem: block.hidden_item as Item,
        },
      ]),
    );
  return state;
}

export function fixtureMessageToState(
  seed: number,
  message: FixtureMessage,
): GameState {
  const blocks = new Map(message.blocks.map((block) => [block.id, block]));
  const state: GameState = {
    config: { ...defaultConfig, size: message.grid.length },
    seed,
    round: message.game_round,
    over: false,
    winnerIds: [],
    cells: message.grid.map((row) =>
      row.map((cell) => ({
        block:
          cell.block_id === -1
            ? null
            : blocks.get(cell.block_id)?.removable
              ? 'mud'
              : 'wall',
        item: cell.item as Item,
        bombId: cell.bomb_id === -1 ? null : cell.bomb_id,
        players: new Set(cell.player_ids),
      })),
    ),
    players: message.players.map((player) => ({
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
      color:
        player.id === message.player_id ? '#3b82f6' : '#ef4444',
    })),
    bombs: message.bombs.map((bomb) => ({
      id: bomb.id,
      x: bomb.x,
      y: bomb.y,
      range: bomb.bomb_range,
      timeLeft: bomb.bomb_status,
      ownerId: bomb.player_id,
      status: BombStatus.Silent,
    })),
    nextBombId: Math.max(
      1,
      ...message.bombs.map((bomb) => bomb.id + 1),
    ),
    rng: new Rng(seed),
  };
  const blockMeta = new Map<number, BlockMeta>();
  for (const block of message.blocks) {
    blockMeta.set(block.id, {
      id: block.id,
      x: block.x,
      y: block.y,
      removable: block.removable !== 0,
      hiddenItem: Item.None,
    });
  }
  (state as unknown as { blockMeta: Map<number, BlockMeta> }).blockMeta =
    blockMeta;
  return state;
}
