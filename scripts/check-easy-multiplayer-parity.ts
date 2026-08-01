import { readFileSync } from 'node:fs';

import { Action } from '../src/engine';
import { RuleBot } from '../src/bots';
import {
  fixtureMessageToState,
  type FixtureMessage,
} from './fixture-state';

interface MultiplayerEasyFixture {
  seed: number;
  player_ids: number[];
  steps: Array<{
    round: number;
    player_id: number;
    msg: FixtureMessage;
    action: number;
  }>;
}

const fixturePath = process.argv[2];
if (!fixturePath) {
  console.error(
    'usage: tsx scripts/check-easy-multiplayer-parity.ts <fixture.json>',
  );
  process.exit(2);
}
const fixture = JSON.parse(
  readFileSync(fixturePath, 'utf8'),
) as MultiplayerEasyFixture;
const firstStep = fixture.steps[0];
if (!firstStep) throw new Error('empty multiplayer easy fixture');

const initialState = fixtureMessageToState(fixture.seed, firstStep.msg);
const bots = new Map<number, RuleBot>();
for (const playerId of fixture.player_ids) {
  const bot = new RuleBot(false, 0);
  bot.reset(playerId, initialState);
  bots.set(playerId, bot);
}

let mismatches = 0;
let maximumStill = 0;
const consecutiveSilent = new Map<number, number>();
const maximumSilent = new Map<number, number>();

for (let index = 0; index < fixture.steps.length; index++) {
  const expected = fixture.steps[index];
  const bot = bots.get(expected.player_id);
  if (!bot) throw new Error(`missing bot player=${expected.player_id}`);
  const state = fixtureMessageToState(fixture.seed, expected.msg);
  const planningPlayer = state.players.find(
    (player) => player.id === expected.player_id,
  );
  if (planningPlayer) planningPlayer.speed = 1;
  const actual = bot.chooseAction(state, expected.player_id);
  if (actual !== expected.action) {
    mismatches++;
    console.error(
      `easy4 mismatch step=${index} round=${expected.round} ` +
        `player=${expected.player_id} cpp=${expected.action} js=${actual}`,
    );
  }

  const silent =
    actual === Action.Silent
      ? (consecutiveSilent.get(expected.player_id) ?? 0) + 1
      : 0;
  consecutiveSilent.set(expected.player_id, silent);
  maximumSilent.set(
    expected.player_id,
    Math.max(maximumSilent.get(expected.player_id) ?? 0, silent),
  );
  maximumStill = Math.max(maximumStill, silent);
}

console.log(
  `easy multiplayer parity players=${fixture.player_ids.length} ` +
    `steps=${fixture.steps.length} mismatches=${mismatches} ` +
    `max_consecutive_silent=${maximumStill} per_player=` +
    JSON.stringify(Object.fromEntries(maximumSilent)),
);

if (mismatches !== 0) process.exit(1);
