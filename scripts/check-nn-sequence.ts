import { readFileSync } from 'node:fs';
import {
  Item,
  Rng,
  defaultConfig,
  type Cell,
  type GameState,
} from '../src/engine';
import { loadPureNnPolicyFromText } from '../src/rnn';
import { isPureNnActionLegal } from '../src/bots';

interface FixtureMessage {
  player_id: number;
  game_round: number;
  grid: Array<
    Array<{
      bomb_id: number;
      block_id: number;
      item: number;
      player_ids: number[];
    }>
  >;
  players: Array<{
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
  }>;
  bombs: Array<{
    id: number;
    x: number;
    y: number;
    player_id: number;
    bomb_range: number;
    bomb_status: number;
  }>;
  blocks: Array<{
    id: number;
    x: number;
    y: number;
    removable: number;
  }>;
}

interface FixtureStep {
  round: number;
  sub: number;
  msg: FixtureMessage;
  features: number[];
  history: number[];
  outcome: number[];
  action_context: number[];
  input: number[];
  probs: number[];
  action_idx: number;
}

interface SequenceFixture {
  seed: number;
  steps: FixtureStep[];
}

const fixturePath =
  process.argv[2] ?? 'fixtures/nn_sequence_seed1000.json';
const modelPath = process.argv[3] ?? 'public/models/pure-nn.rnn';
const fixture = JSON.parse(
  readFileSync(fixturePath, 'utf8'),
) as SequenceFixture;
const policy = loadPureNnPolicyFromText(readFileSync(modelPath, 'utf8'));

const firstMessage = fixture.steps[0]?.msg;
if (!firstMessage) throw new Error('empty sequence fixture');
const firstSelf = firstMessage.players.find(
  (player) => player.id === firstMessage.player_id,
);
const firstEnemy = firstMessage.players.find(
  (player) => player.id !== firstMessage.player_id,
);
if (!firstSelf || !firstEnemy) throw new Error('fixture players missing');
const selfInit: [number, number] = [firstSelf.x, firstSelf.y];
const enemyInit: [number, number] = [firstEnemy.x, firstEnemy.y];

let maxProbabilityError = 0;
let probabilityErrorStep = -1;
let maxHistoryError = 0;
let historyErrorStep = -1;
let actionMismatches = 0;
let chosenActionMismatches = 0;
const groupMaximums = new Map<string, { error: number; step: number }>();
const groupDetails = new Map<
  string,
  { index: number; actual: number; expected: number }
>();

for (let index = 0; index < fixture.steps.length; index++) {
  const step = fixture.steps[index];
  const state = fixtureToState(fixture.seed, step.msg);
  const history = policy.historyFeatures(step.sub);
  const historyError = maxError(history, step.history);
  if (historyError > maxHistoryError) {
    maxHistoryError = historyError;
    historyErrorStep = index;
  }

  const probabilities = policy.predict(
    state,
    step.msg.player_id,
    selfInit,
    enemyInit,
    step.sub,
  );
  const debug = policy.debugStep();
  if (!debug) throw new Error(`missing debug step ${index}`);
  updateMaximum('features', debug.features, step.features, index);
  updateMaximum('outcome', debug.outcome, step.outcome, index);
  updateMaximum(
    'action_context',
    debug.actionContext,
    step.action_context,
    index,
  );
  updateMaximum('input', debug.input, step.input, index);
  const probabilityError = maxError(probabilities, step.probs);
  if (probabilityError > maxProbabilityError) {
    maxProbabilityError = probabilityError;
    probabilityErrorStep = index;
  }
  const topAction = probabilities.indexOf(Math.max(...probabilities));
  const cppTopAction = step.probs.indexOf(Math.max(...step.probs));
  if (topAction !== cppTopAction) actionMismatches++;

  const self = state.players.find(
    (player) => player.id === step.msg.player_id,
  );
  const chosenAction = self
    ? probabilities
        .map((probability, action) => ({
          probability,
          action: action as Action,
        }))
        .sort((left, right) => right.probability - left.probability)
        .find((candidate) =>
          isPureNnActionLegal(state, self, candidate.action),
        )?.action ?? Action.Silent
    : Action.Silent;
  if (chosenAction !== step.action_idx) chosenActionMismatches++;
  const inDanger = self ? isDangerous(state, self.x, self.y) : false;
  policy.commit(step.action_idx, inDanger);
}

console.log(`steps=${fixture.steps.length}`);
console.log(
  `history_max_error=${maxHistoryError} step=${historyErrorStep}`,
);
console.log(
  `probability_max_error=${maxProbabilityError} step=${probabilityErrorStep}`,
);
console.log(`top_action_mismatches=${actionMismatches}`);
console.log(`chosen_action_mismatches=${chosenActionMismatches}`);
for (const [name, value] of groupMaximums) {
  const detail = groupDetails.get(name);
  console.log(
    `${name}_max_error=${value.error} step=${value.step}` +
      (detail
        ? ` index=${detail.index} js=${detail.actual} cpp=${detail.expected}`
        : ''),
  );
}

if (
  maxHistoryError > 1e-12 ||
  maxProbabilityError > 1e-9 ||
  actionMismatches !== 0 ||
  chosenActionMismatches !== 0 ||
  [...groupMaximums.values()].some((value) => value.error > 1e-12)
) {
  process.exit(1);
}

function updateMaximum(
  name: string,
  actual: number[],
  expected: number[],
  step: number,
): void {
  const error = maxError(actual, expected);
  const current = groupMaximums.get(name);
  if (!current || error > current.error) {
    groupMaximums.set(name, { error, step });
    let largestIndex = -1;
    let largestError = -1;
    for (let index = 0; index < actual.length; index++) {
      const difference = Math.abs(
        (actual[index] ?? 0) - (expected[index] ?? 0),
      );
      if (difference > largestError) {
        largestError = difference;
        largestIndex = index;
      }
    }
    groupDetails.set(name, {
      index: largestIndex,
      actual: actual[largestIndex] ?? 0,
      expected: expected[largestIndex] ?? 0,
    });
  }
}
console.log('sequence parity ok');

function maxError(actual: number[], expected: number[]): number {
  if (actual.length !== expected.length) return Number.POSITIVE_INFINITY;
  let maximum = 0;
  for (let index = 0; index < actual.length; index++) {
    maximum = Math.max(
      maximum,
      Math.abs((actual[index] ?? 0) - (expected[index] ?? 0)),
    );
  }
  return maximum;
}

function fixtureToState(seed: number, message: FixtureMessage): GameState {
  const size = message.grid.length;
  const blockById = new Map(
    message.blocks.map((block) => [block.id, block]),
  );
  const cells: Cell[][] = message.grid.map((row) =>
    row.map((cell) => {
      const block =
        cell.block_id === -1
          ? null
          : blockById.get(cell.block_id)?.removable
            ? 'mud'
            : 'wall';
      return {
        block,
        item: cell.item as Item,
        bombId: cell.bomb_id === -1 ? null : cell.bomb_id,
        players: new Set(cell.player_ids),
      };
    }),
  );
  return {
    config: { ...defaultConfig, size },
    seed,
    round: message.game_round,
    over: false,
    winnerIds: [],
    cells,
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
      color: '#ffffff',
    })),
    bombs: message.bombs.map((bomb) => ({
      id: bomb.id,
      x: bomb.x,
      y: bomb.y,
      range: bomb.bomb_range,
      timeLeft: bomb.bomb_status,
      ownerId: bomb.player_id,
      status: 0,
    })),
    nextBombId: Math.max(
      1,
      ...message.bombs.map((bomb) => bomb.id + 1),
    ),
    rng: new Rng(seed),
  };
}

function isDangerous(
  state: GameState,
  selfX: number,
  selfY: number,
): boolean {
  for (const bomb of state.bombs) {
    if (bomb.x === selfX && bomb.y === selfY) return true;
    const sameRow = bomb.x === selfX;
    const sameColumn = bomb.y === selfY;
    if (!sameRow && !sameColumn) continue;
    const distance = Math.abs(bomb.x - selfX) + Math.abs(bomb.y - selfY);
    if (distance > bomb.range) continue;
    const dx = Math.sign(selfX - bomb.x);
    const dy = Math.sign(selfY - bomb.y);
    let blocked = false;
    for (let step = 1; step <= distance; step++) {
      const x = bomb.x + dx * step;
      const y = bomb.y + dy * step;
      if (state.cells[x][y].block != null) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return true;
  }
  return false;
}
