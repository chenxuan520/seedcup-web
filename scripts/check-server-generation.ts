import { readFileSync } from 'node:fs';

import {
  Action,
  applyAction,
  createGame,
  defaultConfig,
  type BlockMeta,
  type GameState,
} from '../src/engine';

interface GenerationFixture {
  seed: number;
  size: number;
  blocks: Array<{
    id: number;
    x: number;
    y: number;
    removable: number;
    hidden_item: number;
  }>;
  births: Array<[number, number]>;
  bomb_extras: number[];
}

const fixturePath = process.argv[2];
if (!fixturePath) {
  console.error(
    'usage: tsx scripts/check-server-generation.ts <fixture.json>',
  );
  process.exit(2);
}
const fixture = JSON.parse(
  readFileSync(fixturePath, 'utf8'),
) as GenerationFixture;
const state = createGame(fixture.seed, {
  ...defaultConfig,
  size: fixture.size,
  playerNum: 4,
});
const meta = (
  state as unknown as { blockMeta: Map<number, BlockMeta> }
).blockMeta;
const actualBlocks = [...meta.values()]
  .sort((left, right) => left.id - right.id)
  .map((block) => ({
    id: block.id,
    x: block.x,
    y: block.y,
    removable: block.removable ? 1 : 0,
    hidden_item: block.hiddenItem,
  }));
const actualBirths = state.players.map(
  (player) => [player.x, player.y] as [number, number],
);

if (JSON.stringify(actualBlocks) !== JSON.stringify(fixture.blocks)) {
  const index = firstDifference(actualBlocks, fixture.blocks);
  throw new Error(
    `server block mismatch index=${index} ` +
      `ts=${JSON.stringify(actualBlocks[index])} ` +
      `cpp=${JSON.stringify(fixture.blocks[index])}`,
  );
}
if (JSON.stringify(actualBirths) !== JSON.stringify(fixture.births)) {
  throw new Error(
    `server birth mismatch ts=${JSON.stringify(actualBirths)} ` +
      `cpp=${JSON.stringify(fixture.births)}`,
  );
}

const actualExtras: number[] = [];
for (let index = 0; index < fixture.bomb_extras.length; index++) {
  const sandbox = emptyBombCell(state);
  const player = state.players[index % state.players.length];
  state.cells[player.x][player.y].players.delete(player.id);
  player.x = sandbox[0];
  player.y = sandbox[1];
  player.bombMax = fixture.bomb_extras.length + 1;
  player.bombNow = 0;
  state.cells[player.x][player.y].players.add(player.id);
  const before = state.bombs.length;
  applyAction(state, player.id, Action.Place);
  const bomb = state.bombs[before];
  if (!bomb) throw new Error(`bomb was not created index=${index}`);
  actualExtras.push(bomb.timeLeft - state.config.bombTime);
  state.cells[bomb.x][bomb.y].bombId = null;
  state.bombs.splice(before, 1);
}

if (JSON.stringify(actualExtras) !== JSON.stringify(fixture.bomb_extras)) {
  const index = firstDifference(actualExtras, fixture.bomb_extras);
  throw new Error(
    `server bomb RNG mismatch index=${index} ` +
      `ts=${actualExtras[index]} cpp=${fixture.bomb_extras[index]}`,
  );
}

console.log(
  `server generation parity seed=${fixture.seed} ` +
    `blocks=${actualBlocks.length} births=${actualBirths.length} ` +
    `bomb_extras=${actualExtras.length}`,
);

function emptyBombCell(game: GameState): [number, number] {
  for (let x = 0; x < game.config.size; x++) {
    for (let y = 0; y < game.config.size; y++) {
      const cell = game.cells[x][y];
      if (cell.block == null && cell.bombId == null) return [x, y];
    }
  }
  throw new Error('no empty cell');
}

function firstDifference<T>(actual: T[], expected: T[]): number {
  for (let index = 0; index < Math.max(actual.length, expected.length); index++) {
    if (JSON.stringify(actual[index]) !== JSON.stringify(expected[index])) {
      return index;
    }
  }
  return -1;
}
