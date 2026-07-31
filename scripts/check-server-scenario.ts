import { readFileSync } from 'node:fs';

import {
  Action,
  BombStatus,
  Item,
  Rng,
  ServerRng,
  applyActionBatch,
  defaultConfig,
  flushRound,
  type BlockMeta,
  type GameState,
} from '../src/engine';

interface ScenarioCell {
  block_id: number;
  removable: number;
  hidden_item: number;
  bomb_id: number;
  item: number;
  last_bomb_round: number;
  players: number[];
}

interface ScenarioPlayer {
  id: number;
  x: number;
  y: number;
  alive: number;
  hp: number;
  speed: number;
  bomb_max: number;
  bomb_now: number;
  bomb_range: number;
  shield: number;
  invincible: number;
  gloves: number;
  score: number;
}

interface ScenarioBomb {
  id: number;
  x: number;
  y: number;
  time: number;
  range: number;
  owner: number;
  status: number;
}

interface ScenarioStep {
  name: string;
  round?: number;
  status?: number;
  players?: ScenarioPlayer[];
  cells?: ScenarioCell[][];
  bombs?: ScenarioBomb[];
  winners?: number[];
}

interface ScenarioFixture {
  steps: ScenarioStep[];
}

const fixturePath = process.argv[2];
const seed = Number(process.argv[3] ?? 20260731);
if (!fixturePath) {
  console.error(
    'usage: tsx scripts/check-server-scenario.ts <fixture.json> [seed]',
  );
  process.exit(2);
}
const fixture = JSON.parse(
  readFileSync(fixturePath, 'utf8'),
) as ScenarioFixture;
const initial = requireStateStep(fixture.steps[0]);
const state = stateFromFixture(seed, initial);
const playerZero = state.players.find((player) => player.id === 0);
if (!playerZero) throw new Error('missing player 0');

compareState(state, initial);
applyActionBatch(
  state,
  playerZero.id,
  [Action.Place, Action.Right, Action.Right],
);

const expectedNames = ['flush_1', 'flush_2', 'flush_3', 'flush_4', 'flush_5'];
for (const name of expectedNames) {
  if (name === 'flush_3') {
    applyActionBatch(state, playerZero.id, [Action.Left]);
  }
  flushRound(state);
  const expected = requireStateStep(
    fixture.steps.find((step) => step.name === name),
  );
  compareState(state, expected);
}

console.log(
  `server scenario parity steps=${expectedNames.length + 1} ` +
    `final_round=${state.round}`,
);

function stateFromFixture(seedValue: number, source: ScenarioStep): GameState {
  const sourceCells = source.cells!;
  const blockMeta = new Map<number, BlockMeta>();
  const cells = sourceCells.map((row, x) =>
    row.map((cell, y) => {
      if (cell.block_id !== -1) {
        blockMeta.set(cell.block_id, {
          id: cell.block_id,
          x,
          y,
          removable: cell.removable !== 0,
          hiddenItem: cell.hidden_item as Item,
        });
      }
      return {
        block:
          cell.block_id === -1
            ? null
            : cell.removable
              ? ('mud' as const)
              : ('wall' as const),
        item: cell.item as Item,
        bombId: cell.bomb_id === -1 ? null : cell.bomb_id,
        players: new Set(cell.players),
        lastBombRound: cell.last_bomb_round,
      };
    }),
  );
  const state: GameState = {
    config: {
      ...defaultConfig,
      size: cells.length,
      playerNum: source.players!.length,
    },
    seed: seedValue,
    round: source.round!,
    over: source.status === 4,
    winnerIds: source.status === 4 ? [...(source.winners ?? [])] : [],
    cells,
    players: source.players!
      .map((player) => ({
        id: player.id,
        name: `P${player.id}`,
        x: player.x,
        y: player.y,
        alive: player.alive !== 0,
        hp: player.hp,
        speed: player.speed,
        bombMax: player.bomb_max,
        bombNow: player.bomb_now,
        bombRange: player.bomb_range,
        invincible: player.invincible,
        shield: player.shield,
        gloves: player.gloves !== 0,
        score: player.score,
        color: player.id === 0 ? '#3b82f6' : '#ef4444',
      }))
      .sort((left, right) => left.id - right.id),
    bombs: source.bombs!.map((bomb) => ({
      id: bomb.id,
      x: bomb.x,
      y: bomb.y,
      range: bomb.range,
      timeLeft: bomb.time,
      ownerId: bomb.owner,
      status: bomb.status as BombStatus,
    })),
    nextBombId: Math.max(0, ...source.bombs!.map((bomb) => bomb.id + 1)),
    bombBucketCount: 1,
    rng: new Rng(seedValue),
    serverRng: new ServerRng(seedValue),
    acceptedActions: new Map(),
  };
  (state as unknown as { blockMeta: Map<number, BlockMeta> }).blockMeta =
    blockMeta;
  return state;
}

function compareState(state: GameState, expected: ScenarioStep): void {
  if (state.round !== expected.round) {
    throw new Error(
      `${expected.name} round mismatch ts=${state.round} cpp=${expected.round}`,
    );
  }
  const expectedOver = expected.status === 4;
  if (state.over !== expectedOver) {
    throw new Error(
      `${expected.name} game status mismatch ` +
        `ts=${state.over ? 'GAME_OVER' : 'WAIT_ACTION'} ` +
        `cpp=${expected.status}`,
    );
  }
  if (expectedOver) {
    assertEqual(
      expected.name,
      'winners',
      state.winnerIds,
      expected.winners ?? [],
    );
  }
  const actualPlayers = [...state.players]
    .sort((left, right) => left.id - right.id)
    .map((player) => ({
      id: player.id,
      x: player.x,
      y: player.y,
      alive: player.alive ? 1 : 0,
      hp: player.hp,
      speed: player.speed,
      bomb_max: player.bombMax,
      bomb_now: player.bombNow,
      bomb_range: player.bombRange,
      shield: player.shield,
      invincible: player.invincible,
      gloves: player.gloves ? 1 : 0,
      score: player.score,
    }));
  const expectedPlayers = [...expected.players!].sort(
    (left, right) => left.id - right.id,
  );
  assertEqual(expected.name, 'players', actualPlayers, expectedPlayers);

  const actualBombs = state.bombs.map((bomb) => ({
    id: bomb.id,
    x: bomb.x,
    y: bomb.y,
    time: bomb.timeLeft,
    range: bomb.range,
    owner: bomb.ownerId,
    status: bomb.status,
  }));
  assertEqual(expected.name, 'bombs', actualBombs, expected.bombs);

  const blockMeta = (
    state as unknown as { blockMeta: Map<number, BlockMeta> }
  ).blockMeta;
  const actualCells = state.cells.map((row, x) =>
    row.map((cell, y) => {
      let block: BlockMeta | undefined;
      for (const candidate of blockMeta.values()) {
        if (candidate.x === x && candidate.y === y) {
          block = candidate;
          break;
        }
      }
      return {
        block_id: block?.id ?? -1,
        removable: block?.removable ? 1 : 0,
        hidden_item: block?.hiddenItem ?? 0,
        bomb_id: cell.bombId ?? -1,
        item: cell.item,
        last_bomb_round: cell.lastBombRound,
        players: [...cell.players].sort((left, right) => left - right),
      };
    }),
  );
  assertEqual(expected.name, 'cells', actualCells, expected.cells);
}

function assertEqual(
  step: string,
  field: string,
  actual: unknown,
  expected: unknown,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${step} ${field} mismatch\n` +
        `ts=${JSON.stringify(actual)}\ncpp=${JSON.stringify(expected)}`,
    );
  }
}

function requireStateStep(
  step: ScenarioStep | undefined,
): ScenarioStep {
  if (!step?.players || !step.cells || !step.bombs) {
    throw new Error('missing scenario state step');
  }
  return step;
}
