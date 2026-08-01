import { readFileSync } from 'node:fs';

import {
  createCppGameSimGame,
  defaultConfig,
  type BlockMeta,
} from '../src/engine';
import {
  fullStateFixtureToState,
  type FullStateFixture,
} from './fixture-state';

interface MapFixture {
  seed: number;
  maps: FullStateFixture[];
}

const fixturePath =
  process.argv[2] ?? 'fixtures/cpp_maps_seed1000.json';
const fixture = JSON.parse(
  readFileSync(fixturePath, 'utf8'),
) as MapFixture;

for (let index = 0; index < fixture.maps.length; index++) {
  const seed = fixture.seed + index;
  const expected = fullStateFixtureToState(seed, fixture.maps[index]);
  const actual = createCppGameSimGame(seed, {
    ...defaultConfig,
    maxRound: 400,
  });
  const actualMeta = [
    ...(
      actual as unknown as { blockMeta: Map<number, BlockMeta> }
    ).blockMeta.values(),
  ]
    .sort((left, right) => left.id - right.id)
    .map(({ id, x, y, removable, hiddenItem }) => ({
      id,
      x,
      y,
      removable,
      hiddenItem,
    }));
  const expectedMeta = [
    ...(
      expected as unknown as { blockMeta: Map<number, BlockMeta> }
    ).blockMeta.values(),
  ]
    .sort((left, right) => left.id - right.id)
    .map(({ id, x, y, removable, hiddenItem }) => ({
      id,
      x,
      y,
      removable,
      hiddenItem,
    }));
  const actualPlayers = actual.players.map(
    ({ id, x, y }) => ({ id, x, y }),
  );
  const expectedPlayers = expected.players.map(
    ({ id, x, y }) => ({ id, x, y }),
  );
  if (
    JSON.stringify(actualMeta) !== JSON.stringify(expectedMeta) ||
    JSON.stringify(actualPlayers) !== JSON.stringify(expectedPlayers)
  ) {
    throw new Error(
      `C++ GameSim generation mismatch seed=${seed} ` +
        `actual_players=${JSON.stringify(actualPlayers)} ` +
        `expected_players=${JSON.stringify(expectedPlayers)}`,
    );
  }
}

console.log(
  `C++ GameSim generation parity maps=${fixture.maps.length} ` +
    `seed=${fixture.seed}..${fixture.seed + fixture.maps.length - 1}`,
);
