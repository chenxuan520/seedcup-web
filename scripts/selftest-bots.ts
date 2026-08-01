import { createGame, runRound, type BotController } from '../src/engine';
import {
  ContestHardBot,
  ManualBot,
  RuleBot,
  SearchBot,
} from '../src/bots';

function play(makeP1: () => BotController, makeP2: () => BotController, seed: number, maxRounds = 120) {
  const state = createGame(seed);
  const p1 = makeP1();
  const p2 = makeP2();
  const p1Id = state.players[0].id;
  const p2Id = state.players[1].id;
  const bots = new Map<number, BotController>([
    [p1Id, p1],
    [p2Id, p2],
  ]);
  for (const [id, b] of bots) b.reset?.(id, state);
  const start = state.players.map((p) => `(${p.x},${p.y})`);
  let moves1 = 0;
  let moves2 = 0;
  let placed = 0;
  let prev = state.players.map((p) => `${p.x},${p.y}`);
  let maxStill = 0;
  let stillRun = 0;
  for (let i = 0; i < maxRounds && !state.over; i++) {
    const before = state.bombs.length;
    runRound(state, bots);
    if (state.bombs.length > before) placed++;
    const now = state.players.map((p) => `${p.x},${p.y}`);
    const p1moved = now[0] !== prev[0];
    if (p1moved) moves1++;
    if (now[1] !== prev[1]) moves2++;
    if (!p1moved) {
      stillRun++;
      maxStill = Math.max(maxStill, stillRun);
    } else {
      stillRun = 0;
    }
    prev = now;
  }
  return {
    seed,
    rounds: state.round,
    over: state.over,
    winner: state.winnerIds.join(',') || 'draw',
    p1: `${p1.label}`,
    p2: `${p2.label}`,
    moves1,
    moves2,
    placed,
    maxStill,
    start: start.join(' '),
  };
}

const seeds = [1, 42, 123, 777];
let fail = 0;

console.log('=== 困难 vs 困难 ===');
for (const s of seeds) {
  const r = play(() => new ContestHardBot(), () => new ContestHardBot(), s);
  const bad = r.moves1 < 3 || r.moves2 < 3;
  if (bad) fail++;
  console.log(
    `seed=${r.seed} rounds=${r.rounds} winner=${r.winner} p1moves=${r.moves1} p2moves=${r.moves2} placed=${r.placed} maxStill=${r.maxStill}${bad ? '  <-- 卡死!' : ''}`,
  );
}

console.log('=== 简单 vs 困难 ===');
for (const s of seeds) {
  const r = play(() => new RuleBot(false, 0), () => new ContestHardBot(), s);
  const bad = r.moves1 < 3 || r.moves2 < 3;
  if (bad) fail++;
  console.log(
    `seed=${r.seed} rounds=${r.rounds} winner=${r.winner} easy_moves=${r.moves1} hard_moves=${r.moves2} placed=${r.placed}${bad ? '  <-- 卡死!' : ''}`,
  );
}

console.log('=== 搜索 vs 困难 ===');
for (const s of [42]) {
  const r = play(
    () => new SearchBot(6, 2, 0.05),
    () => new ContestHardBot(),
    s,
  );
  const bad = r.moves1 < 3 || r.moves2 < 3;
  if (bad) fail++;
  console.log(
    `seed=${r.seed} rounds=${r.rounds} winner=${r.winner} search_moves=${r.moves1} hard_moves=${r.moves2} placed=${r.placed}${bad ? '  <-- 卡死!' : ''}`,
  );
}

// 手动 vs 困难：手动方静止，困难方应照常行动
console.log('=== 手动(静止) vs 困难 ===');
{
  const r = play(() => new ManualBot(), () => new ContestHardBot(), 42);
  console.log(`seed=${r.seed} rounds=${r.rounds} winner=${r.winner} manual_moves=${r.moves1} hard_moves=${r.moves2} placed=${r.placed}`);
  if (r.moves2 < 3) fail++;
}

console.log(fail === 0 ? '\n全部通过：没有 bot 卡死' : `\n失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
