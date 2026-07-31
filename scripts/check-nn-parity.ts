import { readFileSync } from 'node:fs';
import { debugPredictFromFixture } from '../src/rnn';
import { Item, type Cell, type GameState, Rng, defaultConfig } from '../src/engine';

interface Fixture {
  seed: number;
  msg: {
    player_id: number;
    game_round: number;
    grid: Array<Array<{ bomb_id: number; block_id: number; item: number; player_ids: number[] }>>;
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
    bombs: Array<{ id: number; x: number; y: number; player_id: number; bomb_range: number; bomb_status: number }>;
    blocks: Array<{ id: number; x: number; y: number; removable: number }>;
  };
  features: number[];
  history: number[];
  outcome: number[];
  action_context: number[];
  input: number[];
  probs: number[];
  action_idx: number;
}

const fixturePath = process.argv[2] ?? 'fixtures/nn_parity_seed2026073001.json';
const modelPath = process.argv[3] ?? 'public/models/pure-nn.rnn';

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
const modelText = readFileSync(modelPath, 'utf8');
const state = fixtureToState(fixture);
const js = debugPredictFromFixture(state, modelText);

let ok = true;
ok &&= compareArray('features', js.features, fixture.features, 1e-12);
ok &&= compareArray('history', js.history, fixture.history, 1e-12);
ok &&= compareArray('outcome', js.outcome, fixture.outcome, 1e-12);
ok &&= compareArray('action_context', js.actionContext, fixture.action_context, 1e-12);
ok &&= compareArray('input', js.input, fixture.input, 1e-12);
ok &&= compareArray('probs', js.probs, fixture.probs, 1e-9);
if (js.actionIdx !== fixture.action_idx) {
  console.error(`action mismatch js=${js.actionIdx} cpp=${fixture.action_idx}`);
  ok = false;
} else {
  console.log(`action ok ${js.actionIdx}`);
}

if (!ok) process.exit(1);

function fixtureToState(f: Fixture): GameState {
  const size = f.msg.grid.length;
  const blockById = new Map(f.msg.blocks.map((b) => [b.id, b]));
  const cells: Cell[][] = f.msg.grid.map((row) =>
    row.map((c) => {
      const block = c.block_id === -1 ? null : blockById.get(c.block_id)?.removable ? 'mud' : 'wall';
      return {
        block,
        item: c.item as Item,
        bombId: c.bomb_id === -1 ? null : c.bomb_id,
      };
    }),
  );
  return {
    config: { ...defaultConfig, size },
    seed: f.seed,
    round: f.msg.game_round,
    over: false,
    winnerIds: [],
    cells,
    players: f.msg.players
      .map((p) => ({
        id: p.id,
        name: `P${p.id}`,
        x: p.x,
        y: p.y,
        alive: p.alive !== 0,
        hp: p.hp,
        speed: p.speed,
        bombMax: p.bomb_max_num,
        bombNow: p.bomb_now_num,
        bombRange: p.bomb_range,
        invincible: p.invincible_time,
        shield: p.shield_time,
        gloves: p.has_gloves !== 0,
        score: p.score,
        color: p.id === f.msg.player_id ? '#2563eb' : '#dc2626',
      }))
      .sort((a, b) => (a.id === f.msg.player_id ? -1 : b.id === f.msg.player_id ? 1 : a.id - b.id)),
    bombs: f.msg.bombs.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      range: b.bomb_range,
      timeLeft: b.bomb_status,
      ownerId: b.player_id,
    })),
    nextBombId: Math.max(1, ...f.msg.bombs.map((b) => b.id + 1)),
    rng: new Rng(f.seed),
  };
}

function compareArray(name: string, actual: number[], expected: number[], eps: number): boolean {
  if (actual.length !== expected.length) {
    console.error(`${name} length mismatch js=${actual.length} cpp=${expected.length}`);
    return false;
  }
  let max = 0;
  let idx = -1;
  for (let i = 0; i < actual.length; i++) {
    const d = Math.abs((actual[i] ?? 0) - (expected[i] ?? 0));
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max > eps) {
    console.error(`${name} mismatch max=${max} idx=${idx} js=${actual[idx]} cpp=${expected[idx]}`);
    return false;
  }
  console.log(`${name} ok max=${max}`);
  return true;
}
