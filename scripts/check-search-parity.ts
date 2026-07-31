import { readFileSync } from 'node:fs';

import { HybridSearchBot, SearchBot } from '../src/bots';
import { loadPureNnPolicyFromText } from '../src/rnn';
import {
  fixtureMessageToState,
  type FixtureMessage,
} from './fixture-state';

interface SearchFixture {
  seed: number;
  hybrid: number;
  player_id: number;
  steps: Array<{
    sub?: number;
    msg: FixtureMessage;
    baseline: number;
    chosen: number;
    action: number;
    scores: number[];
    priors: number[];
    scorer_bomb_first_seen?: Array<[number, number]>;
  }>;
}

const fixturePath = process.argv[2];
const modelPath = process.argv[3] ?? 'public/models/pure-nn.rnn';
if (!fixturePath) {
  console.error(
    'usage: tsx scripts/check-search-parity.ts <fixture.json> [model.rnn]',
  );
  process.exit(2);
}

const fixture = JSON.parse(
  readFileSync(fixturePath, 'utf8'),
) as SearchFixture;
const first = fixture.steps[0];
if (!first) throw new Error('empty search fixture');
const initial = fixtureMessageToState(fixture.seed, first.msg);
const policy = fixture.hybrid
  ? loadPureNnPolicyFromText(readFileSync(modelPath, 'utf8'))
  : null;
const bot = fixture.hybrid
  ? new HybridSearchBot(policy)
  : new SearchBot(6, 2, 0.05);
bot.reset(fixture.player_id, initial);

let actionMismatches = 0;
let maximumScoreError = 0;
let maximumPriorError = 0;
let maximumScoreDetail = '';
let maximumPriorDetail = '';
let trackerMismatches = 0;

for (let index = 0; index < fixture.steps.length; index++) {
  const expected = fixture.steps[index];
  const state = fixtureMessageToState(fixture.seed, expected.msg);
  const action = bot.chooseAction(
    state,
    fixture.player_id,
    expected.sub ?? 0,
  );
  const decision = bot.debugDecision();
  if (!decision) throw new Error(`missing search decision step=${index}`);
  if (
    action !== expected.action ||
    decision.baseline !== expected.baseline ||
    decision.chosen !== expected.chosen
  ) {
    actionMismatches++;
    console.error(
      `search action mismatch step=${index} ` +
        `cpp=${expected.baseline}/${expected.chosen}/${expected.action} ` +
        `ts=${decision.baseline}/${decision.chosen}/${action}`,
    );
  }
  const actualTracker = [...decision.bombFirstSeen].sort(
    (left, right) => left[0] - right[0],
  );
  const expectedTracker = [...(expected.scorer_bomb_first_seen ?? [])].sort(
    (left, right) => left[0] - right[0],
  );
  if (JSON.stringify(actualTracker) !== JSON.stringify(expectedTracker)) {
    trackerMismatches++;
    console.error(
      `search tracker mismatch step=${index} ` +
        `cpp=${JSON.stringify(expectedTracker)} ` +
        `ts=${JSON.stringify(actualTracker)}`,
    );
  }
  const scoreError = maxError(decision.scores, expected.scores);
  if (scoreError > maximumScoreError) {
    maximumScoreError = scoreError;
    let action = -1;
    let actionError = -1;
    for (let candidate = 0; candidate < decision.scores.length; candidate++) {
      const error = Math.abs(
        (decision.scores[candidate] ?? 0) -
          (expected.scores[candidate] ?? 0),
      );
      if (error > actionError) {
        actionError = error;
        action = candidate;
      }
    }
    maximumScoreDetail =
      `step=${index} action=${action} ` +
      `ts=${decision.scores[action]} cpp=${expected.scores[action]}`;
  }
  const priorError = maxError(decision.priors, expected.priors);
  if (priorError > maximumPriorError) {
    maximumPriorError = priorError;
    let action = -1;
    let actionError = -1;
    for (let candidate = 0; candidate < decision.priors.length; candidate++) {
      const error = Math.abs(
        (decision.priors[candidate] ?? 0) -
          (expected.priors[candidate] ?? 0),
      );
      if (error > actionError) {
        actionError = error;
        action = candidate;
      }
    }
    maximumPriorDetail =
      `step=${index} action=${action} ` +
      `ts=${decision.priors[action]} cpp=${expected.priors[action]}`;
  }

}

console.log(
  `search parity mode=${fixture.hybrid ? 'hybrid' : 'rule'} ` +
    `steps=${fixture.steps.length} action_mismatches=${actionMismatches} ` +
    `tracker_mismatches=${trackerMismatches} ` +
    `score_max_error=${maximumScoreError} ${maximumScoreDetail} ` +
    `prior_max_error=${maximumPriorError} ${maximumPriorDetail}`,
);

if (
  actionMismatches !== 0 ||
  trackerMismatches !== 0 ||
  maximumScoreError > 1e-12 ||
  maximumPriorError > 1e-9
) {
  process.exit(1);
}

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
