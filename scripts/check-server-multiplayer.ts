import { readFileSync } from 'node:fs';

import {
  Action,
  applyActionBatch,
  createGame,
  defaultConfig,
  flushRound,
} from '../src/engine';

interface PlayerView {
  id: number;
  x: number;
  y: number;
  alive: number;
  hp: number;
  shield: number;
  invincible: number;
  score: number;
}

interface FixtureStep {
  name: string;
  round?: number;
  players?: PlayerView[];
  target_players?: number[];
}

const fixturePath = process.argv[2];
const seed = Number(process.argv[3] ?? 20260731);
if (!fixturePath) {
  console.error(
    'usage: tsx scripts/check-server-multiplayer.ts <fixture.json> [seed]',
  );
  process.exit(2);
}
const fixture = JSON.parse(
  readFileSync(fixturePath, 'utf8'),
) as { steps: FixtureStep[] };
const state = createGame(seed, {
  ...defaultConfig,
  playerNum: 4,
});
const target = state.cells[4][6];
const source = state.cells[4][5];
target.block = null;
target.item = 0;
target.bombId = null;
target.players = new Set([3, 1, 2]);
target.playerBucketCount = 7;
source.block = null;
source.item = 0;
source.bombId = null;
source.players = new Set([0]);
source.playerBucketCount = 3;

for (const player of state.players) {
  for (const row of state.cells) {
    for (const cell of row) cell.players.delete(player.id);
  }
}
source.players = new Set([0]);
target.players = new Set([3, 1, 2]);
for (const player of state.players) {
  player.x = 4;
  player.y = player.id === 0 ? 5 : 6;
  player.hp = player.id === 0 ? 1 : 2;
  player.shield = 0;
  player.invincible = player.id === 0 ? 5 : 0;
  player.score = 0;
}

compare('before_move');
applyActionBatch(state, 0, [Action.Right]);
compare('after_move');
flushRound(state);
compare('after_flush');

console.log('server multiplayer parity steps=3 players=4');

function compare(name: string): void {
  const expected = fixture.steps.find((step) => step.name === name);
  if (!expected?.players || !expected.target_players) {
    throw new Error(`missing fixture step ${name}`);
  }
  const actualPlayers = gcc8PlayerOrder(state.players.map((player) => player.id))
    .map((id) => state.players.find((player) => player.id === id)!)
    .map((player) => ({
      id: player.id,
      x: player.x,
      y: player.y,
      alive: player.alive ? 1 : 0,
      hp: player.hp,
      shield: player.shield,
      invincible: player.invincible,
      score: player.score,
    }));
  assertEqual(name, 'players', actualPlayers, expected.players);
  assertEqual(
    name,
    'target_players',
    [...state.cells[4][6].players],
    expected.target_players,
  );
}

function gcc8PlayerOrder(ids: number[]): number[] {
  let ordered: number[] = [];
  let bucketCount = 1;
  for (const id of ids) {
    if (bucketCount === 1 || ordered.length + 1 >= bucketCount) {
      bucketCount =
        [3, 7, 17, 37].find((candidate) => candidate > bucketCount) ??
        bucketCount * 2 + 1;
      const groups = new Map<number, number[]>();
      const firstSeen: number[] = [];
      for (const existing of ordered) {
        const bucket = existing % bucketCount;
        let group = groups.get(bucket);
        if (!group) {
          group = [];
          groups.set(bucket, group);
          firstSeen.push(bucket);
        }
        group.unshift(existing);
      }
      ordered = firstSeen
        .toReversed()
        .flatMap((bucket) => groups.get(bucket) ?? []);
    }
    const bucket = id % bucketCount;
    const same = ordered.findIndex(
      (existing) => existing % bucketCount === bucket,
    );
    ordered.splice(same < 0 ? 0 : same, 0, id);
  }
  return ordered;
}

function assertEqual(
  step: string,
  field: string,
  actual: unknown,
  expected: unknown,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${step} ${field} mismatch ` +
        `ts=${JSON.stringify(actual)} cpp=${JSON.stringify(expected)}`,
    );
  }
}
