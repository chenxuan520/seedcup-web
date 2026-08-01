import { readFileSync } from 'node:fs';

import { ContestHardBot } from '../src/bots';
import {
  Action,
  cloneGame,
  createCppGameSimGame,
  defaultConfig,
  simulateClientAction,
  type BlockMeta,
  type GameState,
} from '../src/engine';
import {
  initializeCppGameSimState,
  stepCppRollout,
} from '../src/cpp-game-sim';

interface HardFixture {
  seed: number;
  hard_id: number;
  steps: Array<{
    round: number;
    sub: number;
    action: number;
    state_hash: string;
  }>;
}

const path = process.argv[2];
if (!path) {
  throw new Error('usage: tsx scripts/check-hard-parity.ts <fixture.json>');
}
const fixture = JSON.parse(readFileSync(path, 'utf8')) as HardFixture;
const first = fixture.steps[0];
if (!first) throw new Error('empty hard fixture');
const state = createCppGameSimGame(fixture.seed, {
  ...defaultConfig,
  maxRound: 120,
});
initializeCppGameSimState(state, 120);
const hard = new ContestHardBot();
hard.reset(fixture.hard_id, state);

let index = 0;
while (index < fixture.steps.length) {
  const round = fixture.steps[index].round;
  if (state.round !== round) {
    throw new Error(
      `hard round mismatch step=${index} cpp=${round} web=${state.round}`,
    );
  }
  const planning = cloneGame(state, fixture.hard_id);
  const actions: Action[] = [];
  while (
    index < fixture.steps.length &&
    fixture.steps[index].round === round
  ) {
    const step = fixture.steps[index];
    const actualHash = hashGameMessage(planning);
    if (actualHash !== step.state_hash) {
      throw new Error(
        `hard state mismatch step=${index} round=${round} sub=${step.sub} ` +
          `cpp=${step.state_hash} web=${actualHash}`,
      );
    }
    const action = hard.chooseAction(planning, fixture.hard_id);
    if (action !== step.action) {
      throw new Error(
        `hard action mismatch step=${index} round=${round} ` +
          `sub=${step.sub} cpp=${step.action} web=${action}`,
      );
    }
    if (action !== Action.Silent) actions.push(action);
    simulateClientAction(planning, fixture.hard_id, action);
    index++;
  }
  stepCppRollout(state, new Map([[fixture.hard_id, actions]]));
}

console.log(
  `hard parity ok seed=${fixture.seed} steps=${fixture.steps.length}`,
);

function hashGameMessage(state: GameState): string {
  let hash = 1_469_598_103_934_665_603n;
  const mask = (1n << 64n) - 1n;
  const add = (value: number): void => {
    hash ^= BigInt.asUintN(64, BigInt(value));
    hash = (hash * 1_099_511_628_211n) & mask;
  };
  const blockMeta = (
    state as unknown as { blockMeta: Map<number, BlockMeta> }
  ).blockMeta;
  const blockAt = new Map(
    [...blockMeta.values()].map((block) => [
      `${block.x},${block.y}`,
      block,
    ]),
  );

  add(state.round);
  for (let x = 0; x < state.config.size; x++) {
    for (let y = 0; y < state.config.size; y++) {
      const cell = state.cells[x][y];
      const block = blockAt.get(`${x},${y}`);
      add(x);
      add(y);
      add(block?.id ?? -1);
      add(block == null ? -1 : Number(block.removable));
      add(cell.bombId ?? -1);
      add(cell.item);
      for (const id of [...cell.players].sort((left, right) => left - right)) {
        add(id);
      }
    }
  }
  for (const player of [...state.players].sort(
    (left, right) => left.id - right.id,
  )) {
    for (const value of [
      player.id,
      player.x,
      player.y,
      Number(player.alive),
      player.hp,
      player.speed,
      player.bombMax,
      player.bombNow,
      player.bombRange,
      player.invincible,
      player.shield,
      Number(player.gloves),
      player.score,
    ]) {
      add(value);
    }
  }
  for (const bomb of [...state.bombs].sort(
    (left, right) => left.id - right.id,
  )) {
    for (const value of [
      bomb.id,
      bomb.x,
      bomb.y,
      bomb.range,
    ]) {
      add(value);
    }
    if (bomb.id < 2_000_000_000) add(bomb.timeLeft);
    add(bomb.ownerId);
  }
  return hash.toString();
}
