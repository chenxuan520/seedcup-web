import { readFileSync } from 'node:fs';

import {
  Action,
  BombStatus,
  Item,
  Rng,
  defaultConfig,
  type BlockMeta,
  type GameState,
} from '../src/engine';
import { RuleBot } from '../src/bots';

interface FixtureCell {
  bomb_id: number;
  block_id: number;
  item: number;
  player_ids: number[];
}

interface FixturePlayer {
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

interface FixtureBomb {
  id: number;
  x: number;
  y: number;
  player_id: number;
  bomb_range: number;
  bomb_status: number;
}

interface FixtureBlock {
  id: number;
  x: number;
  y: number;
  removable: number;
}

interface FixtureMessage {
  player_id: number;
  game_round: number;
  grid: FixtureCell[][];
  players: FixturePlayer[];
  bombs: FixtureBomb[];
  blocks: FixtureBlock[];
}

interface Fixture {
  seed: number;
  easy_id: number;
  steps: Array<{
    msg: FixtureMessage;
    action: number;
  }>;
}

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('usage: tsx scripts/check-easy-parity.ts <fixture.json> [...]');
  process.exit(2);
}

let total = 0;
for (const path of paths) {
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as Fixture;
  const bot = new RuleBot(false, 0);
  const initial = toGameState(fixture.seed, fixture.steps[0]?.msg);
  if (!initial) throw new Error(`empty fixture: ${path}`);
  bot.reset(fixture.easy_id, initial);

  for (let index = 0; index < fixture.steps.length; index++) {
    const step = fixture.steps[index];
    const state = toGameState(fixture.seed, step.msg);
    const action = bot.chooseAction(state, fixture.easy_id);
    if (action !== step.action) {
      const player = state.players.find((candidate) => candidate.id === fixture.easy_id);
      throw new Error(
        `easy action mismatch file=${path} step=${index} round=${state.round} ` +
          `pos=${player?.x},${player?.y} cpp=${step.action} ts=${action}`,
      );
    }
    total++;
  }
  console.log(`easy parity ok seed=${fixture.seed} steps=${fixture.steps.length}`);
}

console.log(`easy parity total=${total} mismatches=0`);

function toGameState(seed: number, message?: FixtureMessage): GameState {
  if (!message) throw new Error('fixture message missing');
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
      color: player.id === message.player_id ? '#3b82f6' : '#ef4444',
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
    nextBombId: Math.max(1, ...message.bombs.map((bomb) => bomb.id + 1)),
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
  (state as unknown as { blockMeta: Map<number, BlockMeta> }).blockMeta = blockMeta;
  return state;
}
