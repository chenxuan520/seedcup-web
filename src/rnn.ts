import { Action, Item, dangerInfo, inBounds, moveDeltas } from './engine';
import type { GameState } from './engine';

type Pos = [number, number];

interface RnnModel {
  inputDim: number;
  hiddenDim: number;
  outputDim: number;
  maxSeqLen: number;
  headDim: number;
  inputWeight: Float64Array;
  hiddenWeight: Float64Array;
  bias: Float64Array;
  headWeight: Float64Array;
  headBias: Float64Array;
  outputWeight: Float64Array;
  outputBias: Float64Array;
}

export interface PolicyDebugStep {
  features: number[];
  history: number[];
  outcome: number[];
  actionContext: number[];
  input: number[];
}

export class PureNnPolicy {
  private hidden: Float64Array;
  private recentActions = [0, 0];
  private recentDanger = [false, false];
  private stepsSincePlace = 1000;
  private bombFirstSeenRound = new Map<number, number>();
  private lastDebugStep: PolicyDebugStep | null = null;

  constructor(private readonly model: RnnModel) {
    this.hidden = new Float64Array(model.hiddenDim);
  }

  reset(): void {
    this.hidden.fill(0);
    this.recentActions = [0, 0];
    this.recentDanger = [false, false];
    this.stepsSincePlace = 1000;
    this.bombFirstSeenRound.clear();
    this.lastDebugStep = null;
  }

  predict(state: GameState, playerId: number, selfInit: Pos, enemyInit: Pos, iter = 0): number[] {
    const featureState = this.buildFeatureState(state);
    const features = extractFeatures(featureState, playerId, selfInit, enemyInit);
    const history = this.historyFeatures(iter);
    const outcome = outcomeFeatures(featureState, playerId);
    const actionContext = actionContextFeatures(featureState, playerId, features);
    const input = new Float64Array(this.model.inputDim);
    let offset = 0;
    offset = copyInto(input, features, offset);
    offset = copyInto(input, history, offset);
    offset = copyInto(input, outcome, offset);
    offset = copyInto(input, actionContext, offset);
    this.lastDebugStep = {
      features,
      history,
      outcome,
      actionContext,
      input: Array.from(input),
    };
    this.forwardStep(input);
    const logits = this.project();
    return softmax(Array.from(logits));
  }

  debugStep(): PolicyDebugStep | null {
    return this.lastDebugStep;
  }

  private buildFeatureState(state: GameState): GameState {
    const activeBombIds = new Set(state.bombs.map((bomb) => bomb.id));
    for (const bomb of state.bombs) {
      if (!this.bombFirstSeenRound.has(bomb.id)) {
        this.bombFirstSeenRound.set(bomb.id, state.round);
      }
    }
    for (const bombId of this.bombFirstSeenRound.keys()) {
      if (!activeBombIds.has(bombId)) this.bombFirstSeenRound.delete(bombId);
    }

    return {
      ...state,
      bombs: state.bombs.map((bomb) => {
        const firstSeen = this.bombFirstSeenRound.get(bomb.id) ?? state.round;
        const age = state.round - firstSeen;
        return {
          ...bomb,
          timeLeft: Math.max(1, state.config.bombTime - age),
        };
      }),
    };
  }

  // 提交本步实际执行的动作，更新历史（对齐 C++ UpdateCnnHistory，用 chosen_oper）。
  commit(action: number, inDanger: boolean): void {
    this.recentActions[1] = this.recentActions[0];
    this.recentActions[0] = action;
    this.recentDanger[1] = this.recentDanger[0];
    this.recentDanger[0] = inDanger;
    if (action === Action.Place) this.stepsSincePlace = 0;
    else if (this.stepsSincePlace < 1000) this.stepsSincePlace++;
  }

  historyFeatures(iter = 0): number[] {
    const h = Array.from({ length: 16 }, () => 0);
    if (this.recentActions[0] >= 0 && this.recentActions[0] < 6) h[this.recentActions[0]] = 1;
    if (this.recentActions[1] >= 0 && this.recentActions[1] < 6) h[6 + this.recentActions[1]] = 1;
    h[12] = this.recentDanger[0] ? 1 : 0;
    h[13] = this.recentDanger[1] ? 1 : 0;
    h[14] = Math.max(0, Math.min(1, iter / 4));
    h[15] = this.stepsSincePlace >= 8 ? 1 : Math.max(0, Math.min(1, this.stepsSincePlace / 8));
    return h;
  }

  forwardStep(input: Float64Array): void {
    const { inputDim, hiddenDim, inputWeight, hiddenWeight, bias } = this.model;
    const next = new Float64Array(hiddenDim);
    for (let h = 0; h < hiddenDim; h++) {
      let sum = bias[h];
      const inputBase = h * inputDim;
      for (let i = 0; i < inputDim; i++) sum += inputWeight[inputBase + i] * input[i];
      const hiddenBase = h * hiddenDim;
      for (let i = 0; i < hiddenDim; i++) sum += hiddenWeight[hiddenBase + i] * this.hidden[i];
      next[h] = Math.tanh(sum);
    }
    this.hidden = next;
  }

  project(): number[] {
    const { hiddenDim, headDim, outputDim, headWeight, headBias, outputWeight, outputBias } = this.model;
    const head = new Float64Array(headDim);
    for (let r = 0; r < headDim; r++) {
      let sum = headBias[r];
      const base = r * hiddenDim;
      for (let h = 0; h < hiddenDim; h++) sum += headWeight[base + h] * this.hidden[h];
      head[r] = Math.tanh(sum);
    }
    const logits = new Array(outputDim).fill(0);
    for (let o = 0; o < outputDim; o++) {
      let sum = outputBias[o];
      const base = o * headDim;
      for (let r = 0; r < headDim; r++) sum += outputWeight[base + r] * head[r];
      logits[o] = sum;
    }
    return logits;
  }
}

export function debugPredictFromFixture(
  fixtureState: GameState,
  modelText: string,
): {
  features: number[];
  history: number[];
  outcome: number[];
  actionContext: number[];
  input: number[];
  probs: number[];
  actionIdx: number;
} {
  const model = parseDlrnnh1(modelText);
  const policy = new PureNnPolicy(model);
  const playerId = fixtureState.players[0]?.id ?? 1;
  const self = fixtureState.players.find((p) => p.id === playerId);
  const enemy = fixtureState.players.find((p) => p.id !== playerId);
  const selfInit: Pos = [self?.x ?? 0, self?.y ?? 0];
  const enemyInit: Pos = [enemy?.x ?? 0, enemy?.y ?? 0];
  const features = extractFeatures(fixtureState, playerId, selfInit, enemyInit);
  const history = policy.historyFeatures();
  const outcome = outcomeFeatures(fixtureState, playerId);
  const actionContext = actionContextFeatures(fixtureState, playerId, features);
  const input = [...features, ...history, ...outcome, ...actionContext];
  policy.forwardStep(Float64Array.from(input));
  const probs = softmax(policy.project());
  const actionIdx = probs.indexOf(Math.max(...probs));
  return { features, history, outcome, actionContext, input, probs, actionIdx };
}

export async function loadPureNnPolicy(
  url = `${import.meta.env.BASE_URL}models/pure-nn.rnn`,
): Promise<PureNnPolicy> {
  const text = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`failed to load model: ${r.status}`);
    return r.text();
  });
  return new PureNnPolicy(parseDlrnnh1(text));
}

// 从模型文本构造 policy（供 Node 测试脚本使用，浏览器走 loadPureNnPolicy）。
export function loadPureNnPolicyFromText(text: string): PureNnPolicy {
  return new PureNnPolicy(parseDlrnnh1(text));
}

function parseDlrnnh1(text: string): RnnModel {
  const tokens = text.trim().split(/\s+/);
  let p = 0;
  const magic = tokens[p++];
  if (magic !== 'DLRNNH1') throw new Error(`unsupported model ${magic}`);
  const inputDim = Number(tokens[p++]);
  const hiddenDim = Number(tokens[p++]);
  const outputDim = Number(tokens[p++]);
  const maxSeqLen = Number(tokens[p++]);
  const headDim = Number(tokens[p++]);
  const take = (n: number) => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = Number(tokens[p++]);
    return out;
  };
  const inputWeight = take(hiddenDim * inputDim);
  const hiddenWeight = take(hiddenDim * hiddenDim);
  const bias = take(hiddenDim);
  const headWeight = take(headDim * hiddenDim);
  const headBias = take(headDim);
  const outputWeight = take(outputDim * headDim);
  const outputBias = take(outputDim);
  return { inputDim, hiddenDim, outputDim, maxSeqLen, headDim, inputWeight, hiddenWeight, bias, headWeight, headBias, outputWeight, outputBias };
}

function copyInto(dst: Float64Array, src: ArrayLike<number>, offset: number): number {
  for (let i = 0; i < src.length && offset + i < dst.length; i++) dst[offset + i] = src[i];
  return offset + src.length;
}

function softmax(logits: number[]): number[] {
  const m = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - m));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((v) => v / sum);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function norm(v: number, scale: number): number {
  return scale <= 0 ? 0 : clamp(v / scale, 0, 1);
}

export function extractFeatures(state: GameState, playerId: number, selfInit: Pos, enemyInit: Pos): number[] {
  const n = state.config.size;
  const self = state.players.find((p) => p.id === playerId);
  const enemy = state.players.find((p) => p.id !== playerId);
  const out = new Array(1426).fill(0);
  if (!self || n !== 13) return out;
  const info = dangerInfo(state);
  const cellCount = 169;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      const idx = x * n + y;
      const cell = state.cells[x][y];
      out[idx] = cell.block == null && cell.bombId == null ? 1 : 0;
      out[cellCount + idx] = cell.block === 'mud' ? 1 : 0;
      out[2 * cellCount + idx] = cell.bombId != null ? 1 : 0;
      out[3 * cellCount + idx] = info.danger[x][y] ? 1 : 0;
      out[4 * cellCount + idx] = cell.item !== Item.None ? 1 : 0;
      out[5 * cellCount + idx] = state.players.some((p) => p.id !== playerId && p.alive && p.x === x && p.y === y) ? 1 : 0;
      const bomb = state.bombs.find((b) => b.id === cell.bombId);
      out[6 * cellCount + idx] = bomb ? clamp(bomb.timeLeft / 5, 0, 1) : 0;
      out[7 * cellCount + idx] = info.time[x][y] ? clamp(info.time[x][y] / 5, 0, 1) : 0;
    }
  }
  const stats: number[] = [];
  stats.push(norm(self.x, n - 1), norm(self.y, n - 1), norm(self.hp, 3), norm(self.bombMax, 5), norm(self.bombNow, 5), norm(self.bombRange, 5), norm(self.speed, 3));
  stats.push(self.gloves ? 1 : 0, self.invincible > 0 ? 1 : 0, self.shield > 0 ? 1 : 0);
  if (enemy) {
    stats.push(norm(enemy.x, n - 1), norm(enemy.y, n - 1), norm(enemy.hp, 3), norm(enemy.bombMax, 5), norm(enemy.bombNow, 5), norm(enemy.bombRange, 5), norm(enemy.speed, 3));
    stats.push(enemy.gloves ? 1 : 0, enemy.invincible > 0 ? 1 : 0, enemy.shield > 0 ? 1 : 0, enemy.alive ? 1 : 0);
    stats.push(clamp((self.score - enemy.score) / 25000, -1, 1));
    stats.push(norm(Math.abs(enemy.x - self.x) + Math.abs(enemy.y - self.y), 2 * (n - 1)));
  } else {
    for (let i = 0; i < 13; i++) stats.push(0);
  }
  stats.push(norm(state.round, 300));
  stats.push(norm(selfInit[0], n - 1), norm(selfInit[1], n - 1), selfInit[0] <= n / 2 ? 1 : 0, selfInit[0] > n / 2 ? 1 : 0, selfInit[1] <= n / 2 ? 1 : 0, selfInit[1] > n / 2 ? 1 : 0);
  stats.push(norm(enemyInit[0], n - 1), norm(enemyInit[1], n - 1), enemyInit[0] <= n / 2 ? 1 : 0, enemyInit[0] > n / 2 ? 1 : 0, enemyInit[1] <= n / 2 ? 1 : 0, enemyInit[1] > n / 2 ? 1 : 0);
  for (let action = 0; action < 6; action++) {
    stats.push(featureActionLegal(state, self, action as Action) ? 1 : 0);
  }
  for (const action of [Action.Right, Action.Left, Action.Down, Action.Up]) {
    const [dx, dy] = moveDeltas[action];
    const ax = self.x + dx;
    const ay = self.y + dy;
    if (inBounds(state, ax, ay)) {
      const cell = state.cells[ax][ay];
      stats.push(cell.block == null && cell.bombId == null ? 1 : 0, cell.item !== Item.None ? 1 : 0, cell.block === 'mud' ? 1 : 0, info.time[ax][ay] ? clamp(info.time[ax][ay] / 5, 0, 1) : 0);
    } else {
      stats.push(0, 0, 0, 0);
    }
    let rayItem = 0;
    let rayMud = 0;
    let rayEnemy = 0;
    let rayDanger = 0;
    for (let step = 1; step < n; step++) {
      const x = self.x + dx * step;
      const y = self.y + dy * step;
      if (!inBounds(state, x, y)) break;
      const cell = state.cells[x][y];
      if (!rayItem && cell.item !== Item.None) rayItem = 1 / step;
      if (!rayMud && cell.block === 'mud') rayMud = 1 / step;
      if (!rayEnemy && state.players.some((p) => p.id !== playerId && p.alive && p.x === x && p.y === y)) rayEnemy = 1 / step;
      const normalizedDanger = info.time[x][y] / 5;
      if (
        normalizedDanger > 0 &&
        (!rayDanger || normalizedDanger < rayDanger)
      ) {
        rayDanger = normalizedDanger;
      }
      if (cell.block != null || cell.bombId != null) break;
    }
    stats.push(clamp(rayItem, 0, 1), clamp(rayMud, 0, 1), clamp(rayEnemy, 0, 1), clamp(rayDanger, 0, 1));
  }
  for (let i = 0; i < stats.length && 1352 + i < out.length; i++) out[1352 + i] = stats[i];
  return out;
}

function featureActionLegal(
  state: GameState,
  self: {
    alive: boolean;
    x: number;
    y: number;
    bombNow: number;
    bombMax: number;
  },
  action: Action,
): boolean {
  if (!self.alive) return false;
  if (action === Action.Silent) return true;
  if (action === Action.Place) {
    const current = state.cells[self.x][self.y];
    return (
      self.bombNow < self.bombMax &&
      current.bombId == null &&
      current.block == null
    );
  }
  const [dx, dy] = moveDeltas[action];
  const x = self.x + dx;
  const y = self.y + dy;
  if (!inBounds(state, x, y)) return false;
  const target = state.cells[x][y];
  if (target.block != null || target.bombId != null) return false;
  const danger = dangerInfo(state).danger;
  const currentDanger = danger[self.x][self.y];
  if (danger[x][y] && !currentDanger) return false;
  return true;
}

function outcomeFeatures(state: GameState, playerId: number): number[] {
  const self = state.players.find((x) => x.id === playerId);
  if (!self) return new Array(30).fill(0);
  const enemy = state.players.find((x) => x.id !== playerId);
  const n = state.config.size;
  const info = dangerInfo(state);
  const danger = info.danger;
  const baseEnemyDist = enemy ? Math.abs(enemy.x - self.x) + Math.abs(enemy.y - self.y) : 2 * (n - 1);
  const out: number[] = [];
  for (let oper = 0; oper < 6; oper++) {
    const pos = legalAfter(state, self, oper as Action);
    const legal = pos.legal;
    const afterDanger = legal && inBounds(state, pos.x, pos.y) && danger[pos.x][pos.y];
    const safeDist = legal ? nearestSafeDistance(state, pos.x, pos.y, danger) : n * 2;
    let enemyDist = baseEnemyDist;
    if (legal && enemy) enemyDist = Math.abs(enemy.x - pos.x) + Math.abs(enemy.y - pos.y);
    const enemyDelta = clamp((baseEnemyDist - enemyDist + 4) / 8, 0, 1);
    const bombAvailable = oper === Action.Place && legal;
    out.push(legal ? 1 : 0);
    out.push(afterDanger ? 1 : 0);
    out.push(1 - clamp(safeDist / 8, 0, 1));
    out.push(enemyDelta);
    out.push(bombAvailable ? 1 : 0);
  }
  return out;
}

function actionContextFeatures(state: GameState, playerId: number, _features: number[]): number[] {
  const self = state.players.find((x) => x.id === playerId);
  const out = new Array(144).fill(0);
  if (!self) return out;
  const n = state.config.size;
  const enemy = state.players.find((p) => p.id !== playerId);
  const dangerTime = dangerTimeMap(state, self.speed);
  for (let oper = 0; oper < 6; oper++) {
    const base = oper * 24;
    const pos = actionTarget(self, oper as Action);
    const inb = inBounds(state, pos.x, pos.y);
    let blocked = true;
    let targetItem = false;
    if (inb) {
      const c = state.cells[pos.x][pos.y];
      blocked = c.block != null || c.bombId != null;
      targetItem = c.item !== Item.None;
    }
    let distEnemy = 2 * (n - 1);
    if (enemy?.alive && inb) {
      distEnemy = Math.abs(enemy.x - pos.x) + Math.abs(enemy.y - pos.y);
    }
    const selfDangerLeft = dangerTime[self.x][self.y];
    const targetDangerLeft = inb ? dangerTime[pos.x][pos.y] : 0;
    const escDist = inb && !blocked ? escapeDistance(state, pos.x, pos.y, Math.max(1, self.speed * 5), dangerTime) : -1;
    const escapeNow = escDist >= 0;
    let escapeAfterBomb = false;
    let escapeAfterBombDist = -1;
    if (oper === Action.Place && inb && !blocked && self.bombNow < self.bombMax && state.cells[self.x][self.y].bombId == null) {
      const timeWithBomb = dangerTimeMapWithVirtualBomb(state, self.x, self.y, self.bombRange, Math.max(1, self.speed), self.speed);
      escapeAfterBombDist = escapeDistance(state, self.x, self.y, Math.max(1, self.speed * 5), timeWithBomb);
      escapeAfterBomb = escapeAfterBombDist >= 0;
    }
    const coversEnemy = bombCoversEnemy(state, self, enemy);
    out[base + 0] = inb ? 1 : 0;
    out[base + 1] = blocked ? 1 : 0;
    out[base + 2] = oper === Action.Silent ? 1 : 0;
    out[base + 3] = oper === Action.Place ? 1 : 0;
    out[base + 4] = inb ? clamp(pos.x / (n - 1), 0, 1) : 0;
    out[base + 5] = inb ? clamp(pos.y / (n - 1), 0, 1) : 0;
    out[base + 6] = targetItem ? 1 : 0;
    out[base + 7] = clamp(distEnemy / (2 * (n - 1)), 0, 1);
    out[base + 8] = self.bombNow < self.bombMax ? 1 : 0;
    out[base + 9] = coversEnemy ? 1 : 0;
    out[base + 10] = self.invincible > 0 ? 1 : 0;
    out[base + 11] = self.shield > 0 ? 1 : 0;
    out[base + 12] = escapeNow ? 1 : 0;
    out[base + 13] = escapeAfterBomb ? 1 : 0;
    out[base + 14] = inb && !blocked && state.players.some((p) => p.alive && p.x === pos.x && p.y === pos.y) ? 1 : 0;
    out[base + 15] = self.bombMax > 0 ? clamp(self.bombNow / self.bombMax, 0, 1) : 0;
    out[base + 16] = selfDangerLeft > 0 ? 1 : 0;
    out[base + 17] = targetDangerLeft > 0 ? 1 : 0;
    out[base + 18] = clamp(selfDangerLeft / 5, 0, 1);
    out[base + 19] = clamp(targetDangerLeft / 5, 0, 1);
    out[base + 20] = escDist >= 0 ? clamp(escDist / 10, 0, 1) : 1;
    out[base + 21] = escDist >= 0 && targetDangerLeft > 0 && escDist < targetDangerLeft ? 1 : 0;
    out[base + 22] = escapeAfterBombDist >= 0 ? clamp(escapeAfterBombDist / 10, 0, 1) : 1;
    out[base + 23] = oper === Action.Place && coversEnemy && escapeAfterBomb ? 1 : 0;
  }
  return out;
}

function legalAfter(state: GameState, self: { alive: boolean; x: number; y: number; bombNow: number; bombMax: number }, oper: Action): { legal: boolean; x: number; y: number } {
  const target = actionTarget(self, oper);
  if (!self.alive) return { legal: false, ...target };
  if (oper === Action.Silent) return { legal: true, ...target };
  if (oper === Action.Place) {
    const c = state.cells[self.x][self.y];
    return { legal: self.bombNow < self.bombMax && c.bombId == null && c.block == null, ...target };
  }
  if (!inBounds(state, target.x, target.y)) return { legal: false, ...target };
  const c = state.cells[target.x][target.y];
  return { legal: c.block == null && c.bombId == null, ...target };
}

function actionTarget(self: { x: number; y: number }, oper: Action): { x: number; y: number } {
  const [dx, dy] = moveDeltas[oper];
  return { x: self.x + dx, y: self.y + dy };
}

function nearestSafeDistance(state: GameState, sx: number, sy: number, danger: boolean[][]): number {
  const n = state.config.size;
  if (!inBounds(state, sx, sy)) return n * 2;
  if (!danger[sx][sy]) return 0;
  const q: Array<[number, number]> = [[sx, sy]];
  const dist = Array.from({ length: n }, () => Array.from({ length: n }, () => -1));
  dist[sx][sy] = 0;
  const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length) {
    const [x, y] = q.shift()!;
    if (!danger[x][y]) return dist[x][y];
    if (dist[x][y] >= 8) continue;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state, nx, ny) || dist[nx][ny] !== -1) continue;
      const c = state.cells[nx][ny];
      if (c.block != null || c.bombId != null) continue;
      dist[nx][ny] = dist[x][y] + 1;
      q.push([nx, ny]);
    }
  }
  return n * 2;
}

function dangerTimeMap(state: GameState, fallbackSpeed: number): number[][] {
  const n = state.config.size;
  const times = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (const b of state.bombs) {
    markBombTime(state, times, b.x, b.y, b.range, b.timeLeft > 0 ? b.timeLeft : Math.max(1, fallbackSpeed));
  }
  return times;
}

function dangerTimeMapWithVirtualBomb(state: GameState, x: number, y: number, range: number, time: number, fallbackSpeed: number): number[][] {
  const times = dangerTimeMap(state, fallbackSpeed);
  markBombTime(state, times, x, y, range, time);
  return times;
}

function markBombTime(state: GameState, times: number[][], bx: number, by: number, range: number, time: number): void {
  const set = (x: number, y: number) => {
    times[x][y] = times[x][y] === 0 ? time : Math.min(times[x][y], time);
  };
  if (!inBounds(state, bx, by)) return;
  set(bx, by);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
    for (let r = 1; r <= range; r++) {
      const x = bx + dx * r;
      const y = by + dy * r;
      if (!inBounds(state, x, y)) break;
      if (state.cells[x][y].block != null) break;
      set(x, y);
    }
  }
}

function escapeDistance(state: GameState, sx: number, sy: number, maxSteps: number, dangerTime: number[][]): number {
  const n = state.config.size;
  if (!inBounds(state, sx, sy)) return -1;
  const q: Array<[number, number]> = [[sx, sy]];
  const dist = Array.from({ length: n }, () => Array.from({ length: n }, () => -1));
  dist[sx][sy] = 0;
  const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length) {
    const [x, y] = q.shift()!;
    const t = dangerTime[x][y];
    if (t === 0 || dist[x][y] < t) return dist[x][y];
    if (dist[x][y] >= maxSteps) continue;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state, nx, ny) || dist[nx][ny] !== -1) continue;
      const c = state.cells[nx][ny];
      if (c.block != null || c.bombId != null) continue;
      dist[nx][ny] = dist[x][y] + 1;
      q.push([nx, ny]);
    }
  }
  return -1;
}

function bombCoversEnemy(state: GameState, self: { x: number; y: number; bombRange: number }, enemy: { x: number; y: number; alive: boolean } | undefined): boolean {
  if (!enemy?.alive) return false;
  if (self.x === enemy.x && self.y === enemy.y) return true;
  if (self.x !== enemy.x && self.y !== enemy.y) return false;
  const dx = enemy.x > self.x ? 1 : enemy.x < self.x ? -1 : 0;
  const dy = enemy.y > self.y ? 1 : enemy.y < self.y ? -1 : 0;
  const dist = Math.abs(enemy.x - self.x) + Math.abs(enemy.y - self.y);
  if (dist > self.bombRange) return false;
  for (let step = 1; step <= dist; step++) {
    const x = self.x + dx * step;
    const y = self.y + dy * step;
    if (!inBounds(state, x, y)) return false;
    if (state.cells[x][y].block != null) return false;
    if (step < dist && state.cells[x][y].bombId != null) return false;
  }
  return true;
}
