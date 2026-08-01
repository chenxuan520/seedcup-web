import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import {
  Action,
  cloneGame,
  createCppGameSimGame,
  defaultConfig,
  simulateClientAction,
  type BlockMeta,
  type BotController,
  type GameState,
} from '../src/engine';
import {
  ContestHardBot,
  HybridSearchBot,
  SearchBot,
} from '../src/bots';
import { loadPureNnPolicyFromText } from '../src/rnn';
import {
  initializeCppGameSimState,
  stepCppRollout,
} from '../src/cpp-game-sim';
import {
  fullStateFixtureToState,
  type FullStateFixture,
} from './fixture-state';

interface SearchDecisionFixture {
  baseline: number;
  chosen: number;
  scores: number[];
  tracker: Array<[number, number]>;
}

interface SearchGameTrace {
  version?: number;
  seed: number;
  hybrid: number;
  search_first: number;
  max_round?: number;
  initial?: FullStateFixture;
  initial_hash?: string;
  steps: Array<{
    round: number;
    p1_actions: number[];
    p2_actions: number[];
    search_decisions: SearchDecisionFixture[];
    state?: FullStateFixture;
    state_hash?: string;
  }>;
}

const path = process.argv[2];
if (!path) {
  throw new Error('usage: tsx scripts/check-search-game-trace.ts <trace.json>');
}

const trace = JSON.parse(readFileSync(path, 'utf8')) as SearchGameTrace;
const modelPath = process.argv[3] ?? 'public/models/pure-nn.rnn';
const maxRound = trace.max_round ?? 400;
const state = createCppGameSimGame(trace.seed, {
  ...defaultConfig,
  maxRound,
});
initializeCppGameSimState(state, maxRound);
if (trace.initial) {
  const expectedInitial = fullStateFixtureToState(trace.seed, trace.initial);
  assertEqualState(state, expectedInitial, 'initial state');
}
if (trace.initial_hash) {
  assertHash(state, trace.initial_hash, 'initial state');
}

const search = trace.hybrid
  ? new HybridSearchBot(
      loadPureNnPolicyFromText(readFileSync(modelPath, 'utf8')),
    )
  : new SearchBot(6, 2, 0.05);
const hard = new ContestHardBot();
const searchFirst = trace.search_first !== 0;
const bots = new Map<number, BotController>([
  [state.players[0].id, searchFirst ? search : hard],
  [state.players[1].id, searchFirst ? hard : search],
]);
for (const [playerId, bot] of bots) bot.reset?.(playerId, state);

for (let index = 0; index < trace.steps.length; index++) {
  const expected = trace.steps[index];
  const actions = new Map<number, Action[]>();
  const decisions: SearchDecisionFixture[] = [];
  for (const player of state.players) {
    if (!player.alive) continue;
    const bot = bots.get(player.id);
    if (!bot) continue;
    const planning = cloneGame(state, player.id);
    const batch: Action[] = [];
    const speed = bot.movesPerTurn?.(player) ?? player.speed;
    for (let sub = 0; sub < speed; sub++) {
      const action = bot.chooseAction(planning, player.id, sub);
      if (bot === search) {
        const decision = search.debugDecision();
        if (!decision) {
          throw new Error(
            `missing search decision before round=${expected.round} sub=${sub}`,
          );
        }
        decisions.push({
          baseline: decision.baseline,
          chosen: decision.chosen,
          scores: decision.scores,
          tracker: decision.bombFirstSeen,
        });
      }
      if (action !== Action.Silent) batch.push(action);
      simulateClientAction(planning, player.id, action);
    }
    actions.set(player.id, batch);
  }

  const actualP1 = actions.get(state.players[0].id) ?? [];
  const actualP2 = actions.get(state.players[1].id) ?? [];
  assertEqual(
    [actualP1, actualP2],
    [expected.p1_actions, expected.p2_actions],
    `actions before round=${expected.round}`,
  );
  assertDecisions(decisions, expected.search_decisions, expected.round);

  stepCppRollout(state, actions);
  if (expected.state) {
    const expectedState = fullStateFixtureToState(trace.seed, expected.state);
    assertEqualState(state, expectedState, `state after round=${expected.round}`);
  }
  if (expected.state_hash) {
    assertHash(
      state,
      expected.state_hash,
      `state after round=${expected.round}`,
    );
  }
}

console.log(
  `search game trace ok seed=${trace.seed} ` +
    `hybrid=${trace.hybrid ? 1 : 0} ` +
    `search_first=${searchFirst ? 1 : 0} rounds=${trace.steps.length}`,
);

function assertDecisions(
  actual: SearchDecisionFixture[],
  expected: SearchDecisionFixture[],
  round: number,
): void {
  if (actual.length !== expected.length) {
    throw new Error(
      `search decision count mismatch before round=${round}: ` +
        `cpp=${expected.length} web=${actual.length}`,
    );
  }
  for (let sub = 0; sub < expected.length; sub++) {
    const actualDecision = normalizeDecision(actual[sub]);
    const expectedDecision = normalizeDecision(expected[sub]);
    const scoreError = Math.max(
      0,
      ...actualDecision.scores.map((score, index) =>
        Math.abs(score - (expectedDecision.scores[index] ?? 0)),
      ),
    );
    if (
      actualDecision.baseline !== expectedDecision.baseline ||
      actualDecision.chosen !== expectedDecision.chosen ||
      JSON.stringify(actualDecision.tracker) !==
        JSON.stringify(expectedDecision.tracker) ||
      actualDecision.scores.length !== expectedDecision.scores.length ||
      scoreError > 1e-12
    ) {
      throw new Error(
        `search decision mismatch before round=${round} sub=${sub}: ` +
          `score_error=${scoreError} ` +
          `cpp=${JSON.stringify(expectedDecision)} ` +
          `web=${JSON.stringify(actualDecision)}`,
      );
    }
  }
}

function normalizeDecision(
  decision: SearchDecisionFixture,
): SearchDecisionFixture {
  return {
    ...decision,
    tracker: [...decision.tracker].sort(
      (left, right) => left[0] - right[0],
    ),
  };
}

function assertEqualState(
  actual: GameState,
  expected: GameState,
  label: string,
): void {
  assertEqual(comparable(actual), comparable(expected), label);
}

function assertHash(
  state: GameState,
  expected: string,
  label: string,
): void {
  const actual = createHash('sha256')
    .update(JSON.stringify(canonicalState(state)))
    .digest('hex');
  if (actual !== expected) {
    throw new Error(`${label} hash mismatch: cpp=${expected} web=${actual}`);
  }
}

function canonicalState(state: GameState): unknown {
  const blocks = [
    ...(
      state as unknown as { blockMeta: Map<number, BlockMeta> }
    ).blockMeta.values(),
  ]
    .map((block) => ({
      id: block.id,
      x: block.x,
      y: block.y,
      removable: Number(block.removable),
      hidden_item: block.hiddenItem,
    }))
    .sort((left, right) => left.id - right.id);
  const blockAt = new Map(
    blocks.map((block) => [`${block.x},${block.y}`, block.id]),
  );
  return {
    round: state.round,
    over: Number(state.over),
    winner_ids: [...state.winnerIds].sort((left, right) => left - right),
    cells: state.cells.map((row, x) =>
      row.map((cell, y) => ({
        block_id: blockAt.get(`${x},${y}`) ?? -1,
        bomb_id: cell.bombId ?? -1,
        item: cell.item,
        players: [...cell.players].sort((left, right) => left - right),
      })),
    ),
    players: [...state.players]
      .map((player) => ({
        id: player.id,
        x: player.x,
        y: player.y,
        alive: Number(player.alive),
        hp: player.hp,
        speed: player.speed,
        bomb_max_num: player.bombMax,
        bomb_now_num: player.bombNow,
        bomb_range: player.bombRange,
        invincible_time: player.invincible,
        shield_time: player.shield,
        has_gloves: Number(player.gloves),
        score: player.score,
      }))
      .sort((left, right) => left.id - right.id),
    bombs: [...state.bombs]
      .map((bomb) => ({
        id: bomb.id,
        x: bomb.x,
        y: bomb.y,
        range: bomb.range,
        time_left: bomb.timeLeft,
        owner_id: bomb.ownerId,
      }))
      .sort((left, right) => left.id - right.id),
    blocks,
  };
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText === expectedText) return;
  throw new Error(
    `${label} mismatch: ${firstDifference(actual, expected, '$')} ` +
      `cpp=${expectedText} web=${actualText}`,
  );
}

function comparable(state: GameState): unknown {
  const blocks = [
    ...(
      state as unknown as { blockMeta: Map<number, BlockMeta> }
    ).blockMeta.values(),
  ]
    .map((block) => ({
      id: block.id,
      x: block.x,
      y: block.y,
      removable: block.removable,
      hiddenItem: block.hiddenItem,
    }))
    .sort((left, right) => left.id - right.id);
  return {
    round: state.round,
    cells: state.cells.map((row) =>
      row.map((cell) => ({
        block: cell.block,
        item: cell.item,
        bombId: cell.bombId,
        players: [...cell.players].sort((left, right) => left - right),
      })),
    ),
    players: [...state.players]
      .map((player) => ({
        id: player.id,
        x: player.x,
        y: player.y,
        alive: player.alive,
        hp: player.hp,
        speed: player.speed,
        bombMax: player.bombMax,
        bombNow: player.bombNow,
        bombRange: player.bombRange,
        invincible: player.invincible,
        shield: player.shield,
        gloves: player.gloves,
        score: player.score,
      }))
      .sort((left, right) => left.id - right.id),
    bombs: state.bombs.map((bomb) => ({
      id: bomb.id,
      x: bomb.x,
      y: bomb.y,
      range: bomb.range,
      timeLeft: bomb.timeLeft,
      ownerId: bomb.ownerId,
    })),
    blocks,
  };
}

function firstDifference(
  actual: unknown,
  expected: unknown,
  path: string,
): string {
  if (Object.is(actual, expected)) return '';
  if (
    actual == null ||
    expected == null ||
    typeof actual !== 'object' ||
    typeof expected !== 'object'
  ) {
    return `${path}: cpp=${JSON.stringify(expected)} web=${JSON.stringify(actual)}`;
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    return `${path}: cpp=${JSON.stringify(expected)} web=${JSON.stringify(actual)}`;
  }
  const actualRecord = actual as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(actualRecord),
    ...Object.keys(expectedRecord),
  ]);
  for (const key of keys) {
    const difference = firstDifference(
      actualRecord[key],
      expectedRecord[key],
      `${path}.${key}`,
    );
    if (difference) return difference;
  }
  return `${path}: values differ`;
}
