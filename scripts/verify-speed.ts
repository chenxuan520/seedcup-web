// 专项验证：easy 每回合位移必须 ≤1，hard 可 >1（speed 提升后）。
import { createGame, runRound, defaultConfig, type BotController } from '../src/engine';
import { ContestHardBot, RuleBot } from '../src/bots';

function maxStepDelta(makeP1: () => BotController, makeP2: () => BotController, seed: number) {
  const state = createGame(seed, { ...defaultConfig });
  const p1Id = state.players[0].id;
  const p2Id = state.players[1].id;
  const bots = new Map<number, BotController>([
    [p1Id, makeP1()],
    [p2Id, makeP2()],
  ]);
  for (const [id, b] of bots) b.reset?.(id, state);
  let maxP1 = 0;
  let maxP2 = 0;
  let sumSpeedSeenP1 = 0;
  for (let i = 0; i < 80 && !state.over; i++) {
    const b1 = state.players[0];
    const b2 = state.players[1];
    const x1 = b1.x, y1 = b1.y, x2 = b2.x, y2 = b2.y;
    sumSpeedSeenP1 = Math.max(sumSpeedSeenP1, b1.speed);
    runRound(state, bots);
    if (b1.alive) maxP1 = Math.max(maxP1, Math.abs(b1.x - x1) + Math.abs(b1.y - y1));
    if (b2.alive) maxP2 = Math.max(maxP2, Math.abs(b2.x - x2) + Math.abs(b2.y - y2));
  }
  return { maxP1, maxP2, speedP1: sumSpeedSeenP1 };
}

let fail = 0;
console.log('=== easy(P1) vs hard(P2)：验证 easy 单回合位移 ≤1 ===');
for (const seed of [1, 42, 123, 777]) {
  const r = maxStepDelta(
    () => new RuleBot(false, 0),
    () => new ContestHardBot(),
    seed,
  );
  // easy 即便 speed>1，也应每回合最多动 1 格（对齐 C++ MapCall speed=1）
  const easyOk = r.maxP1 <= 1;
  if (!easyOk) fail++;
  console.log(`seed=${seed} easy单回合最大位移=${r.maxP1}(speed达到${r.speedP1}) hard最大位移=${r.maxP2}${easyOk ? '' : '  <-- easy 违规多步!'}`);
}

console.log('=== hard vs hard：验证 hard 提速后能单回合多步 ===');
let hardMultiSeen = false;
for (const seed of [1, 42, 123, 777]) {
  const r = maxStepDelta(
    () => new ContestHardBot(),
    () => new ContestHardBot(),
    seed,
  );
  if (r.maxP1 >= 2 || r.maxP2 >= 2) hardMultiSeen = true;
  console.log(`seed=${seed} hardP1最大位移=${r.maxP1} hardP2最大位移=${r.maxP2}`);
}
if (!hardMultiSeen) {
  console.log('注意：本批次未观察到 hard 多步（可能没吃到加速），非致命');
}

console.log(fail === 0 ? '\n✅ easy 单步对齐验证通过' : `\n❌ easy 单步违规 ${fail} 次`);
process.exit(fail === 0 ? 0 : 1);
