import {
  Action,
  Item,
  actionLegal,
  applyAction,
  cloneGame,
  inBounds,
  runRound,
  scoreState,
} from './engine';
import type { BotController, GameState, PlayerState } from './engine';
import type { PureNnPolicy } from './rnn';
import { CppMt19937 } from './cpp-random';

// ---------------------------------------------------------------------------
// 规则 bot：严格移植自 C++ 原版 src/bot.h（SignDangerous / GetMaxMarkOper /
// EscapeDangerousArea / GetClosestMoveBomb / CanPleaceBomb / ApplyDynamicMoveOrder）。
// 不自行发明评分逻辑，保证与 seedcup-cppsdk 行为一致。
// ---------------------------------------------------------------------------

type Gap = [number, number]; // [dx, dy] —— dx 影响行(上下)，dy 影响列(左右)

const kBombDangerous = 10000;
const kInvincibleDanger = 10000;
const kInvincibleMark = 5000;
const kMudMark = 100;
const kItemMark = 1500;
const kPlayerMark = 2000;

// 对应 C++ BotOper：0 静止 1 左 2 右 3 上 4 下 5 放弹
const OPER_TO_ACTION: Action[] = [
  Action.Silent,
  Action.Left,
  Action.Right,
  Action.Up,
  Action.Down,
  Action.Place,
];

function itemExtraMark(item: Item, hard: boolean): number {
  if (hard) {
    switch (item) {
      case Item.BombRange: return 20;
      case Item.BombNum: return 10;
      case Item.Invincible: return 2000;
      case Item.Rebirth: return 2000;
      case Item.Shield: return 50;
      case Item.Speed: return 2000;
      case Item.Gloves: return 60;
      default: return 0;
    }
  }
  switch (item) {
    case Item.BombRange: return 20;
    case Item.BombNum: return 10;
    case Item.Invincible: return 50;
    case Item.Rebirth: return 50;
    case Item.Shield: return 50;
    case Item.Speed: return 20;
    case Item.Gloves: return 50;
    default: return 0;
  }
}

export interface BotFactory {
  id: string;
  label: string;
  description: string;
  make(): BotController;
}

export class ManualBot implements BotController {
  readonly label = '手动';
  chooseAction(): Action {
    return Action.Silent;
  }
}

/**
 * RuleBot —— C++ Bot 的一次 CalcOnce 决策移植。
 * hard=true 对应 -DHARD 编译期分支；orderMode 对应 move_order_mode_。
 */
export class RuleBot implements BotController {
  readonly label: string;
  protected size = 0;
  protected areaMark: number[][] = [];
  protected moveGap: Gap[] = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  private selfInit: [number, number] = [-1, -1];
  private enemyInit: [number, number] = [-1, -1];
  private moveShuffleRng = new CppMt19937();

  constructor(
    readonly hard = false,
    readonly orderMode = 0,
  ) {
    this.label = hard ? '困难 (hard)' : '简单 (easy)';
  }

  reset(playerId?: number, state?: GameState): void {
    this.size = 0;
    this.areaMark = [];
    this.selfInit = [-1, -1];
    this.enemyInit = [-1, -1];
    this.moveGap = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];
    this.moveShuffleRng = new CppMt19937();
    void playerId;
    void state;
  }


  movesPerTurn(player: PlayerState): number {
    return this.hard ? player.speed : 1;
  }
  chooseAction(state: GameState, playerId: number): Action {
    const player = state.players.find((p) => p.id === playerId);
    if (!player || !player.alive) return Action.Silent;

    this.size = state.config.size;
    // 每次决策清零 area_mark_
    this.areaMark = Array.from({ length: this.size }, () =>
      Array.from({ length: this.size }, () => 0),
    );

    this.initEnemyPos(state, playerId);
    if (this.selfInit[0] === -1) this.selfInit = [player.x, player.y];

    if (this.orderMode !== 0) {
      this.applyDynamicMoveOrder(player.x, player.y);
    }

    const dangerous = this.signDangerous(state, player);
    if (!dangerous && this.orderMode === 0) {
      this.shuffleMoveGap();
    }
    const oper = dangerous
      ? this.escapeDangerousArea(state, player)
      : this.getMaxMarkOper(state, player);
    return OPER_TO_ACTION[oper];
  }

  private shuffleMoveGap(): void {
    this.moveShuffleRng.shuffle(this.moveGap);
  }

  private initEnemyPos(state: GameState, playerId: number): void {
    if (this.enemyInit[0] !== -1) return;
    const enemy = state.players.find((p) => p.id !== playerId);
    if (enemy) this.enemyInit = [enemy.x, enemy.y];
  }

  private correctPos(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  // --- C++ SignBombDanger ---
  private signBombDanger(state: GameState, bx: number, by: number, range: number): void {
    this.areaMark[bx][by] -= kBombDangerous;
    for (const [gx, gy] of this.moveGap) {
      for (let i = 0; i <= range; i++) {
        const nx = bx + gx * i;
        const ny = by + gy * i;
        if (!this.correctPos(nx, ny)) continue;
        if (state.cells[nx][ny].block != null) break;
        this.areaMark[nx][ny] -= kBombDangerous;
      }
    }
  }

  // --- C++ SignPlayerDanger（对手无敌时的碰撞危险）---
  private signPlayerDanger(state: GameState, self: PlayerState, enemy: PlayerState): void {
    if (enemy.invincible === 0) return;
    if (self.invincible >= enemy.invincible) return;
    const { x, y, speed } = enemy;
    for (let i = x - speed; i <= x + speed; i++) {
      const spread = Math.abs(speed - Math.abs(i - x));
      for (let j = y - spread; j <= y + spread; j++) {
        if (!this.correctPos(i, j)) continue;
        if (state.cells[i][j].block != null) continue;
        this.areaMark[i][j] -= kInvincibleDanger;
      }
    }
  }

  // --- C++ SignDangerous ---
  private signDangerous(state: GameState, self: PlayerState): boolean {
    for (const bomb of state.bombs) {
      this.signBombDanger(state, bomb.x, bomb.y, bomb.range);
    }
    for (const p of state.players) {
      if (p.id !== self.id && p.invincible !== 0) {
        this.signPlayerDanger(state, self, p);
      }
    }
    return this.areaMark[self.x][self.y] < 0;
  }

  // 由 (x,y) 相对 player 推断首步方向（C++ 内联逻辑）
  private deriveOper(px: number, py: number, x: number, y: number, prev: number): number {
    if (prev !== 0) return prev;
    if (x - px > 0) return 4; // DOWN
    if (x - px < 0) return 3; // UP
    if (y - py < 0) return 1; // LEFT
    if (y - py > 0) return 2; // RIGHT
    return 0;
  }

  // --- C++ EscapeDangerousArea ---
  private escapeDangerousArea(
    state: GameState,
    player: PlayerState,
  ): number {
    const pass = Array.from({ length: this.size }, () => Array.from({ length: this.size }, () => 0));
    const queue: Array<[number, number, number]> = [[player.x, player.y, 0]];
    pass[player.x][player.y] = 1;
    while (queue.length) {
      const [cx, cy, oper] = queue.shift()!;
      for (const [gx, gy] of this.moveGap) {
        const x = cx + gx;
        const y = cy + gy;
        const operLast = this.deriveOper(player.x, player.y, x, y, oper);
        if (!this.correctPos(x, y)) continue;
        if (pass[x][y]) continue;
        if (state.cells[x][y].block != null || state.cells[x][y].bombId != null) continue;
        if (!this.hard && this.hasBombCapableOpponentAt(state, player.id, x, y)) continue;
        if (this.areaMark[x][y] < 0) {
          pass[x][y] = 1;
          queue.push([x, y, operLast]);
          continue;
        }
        return operLast; // 找到安全区
      }
    }
    if (this.hard && player.gloves) return this.getClosestMoveBomb(state, player);
    return 0; // 等死
  }

  // --- C++ GetClosestMoveBomb（手套推炸弹）---
  private getClosestMoveBomb(state: GameState, player: PlayerState): number {
    const pass = Array.from({ length: this.size }, () => Array.from({ length: this.size }, () => 0));
    const queue: Array<[number, number, number]> = [[player.x, player.y, 0]];
    pass[player.x][player.y] = 1;
    while (queue.length) {
      const [cx, cy, oper] = queue.shift()!;
      for (const [gx, gy] of this.moveGap) {
        const x = cx + gx;
        const y = cy + gy;
        const operLast = this.deriveOper(player.x, player.y, x, y, oper);
        if (!this.correctPos(x, y)) continue;
        if (pass[x][y]) continue;
        if (state.cells[x][y].block != null) continue;
        if (state.cells[x][y].bombId != null) {
          const next: [number, number] = [x, y];
          if (operLast === 3) next[0]--;
          else if (operLast === 4) next[0]++;
          else if (operLast === 1) next[1]--;
          else if (operLast === 2) next[1]++;
          const [nx, ny] = next;
          if (
            !this.correctPos(nx, ny) ||
            state.cells[nx][ny].block != null ||
            state.cells[nx][ny].bombId != null ||
            playerAtCell(state, nx, ny) ||
            state.cells[nx][ny].item !== Item.None
          ) {
            continue; // 不能推
          }
          return operLast;
        }
        pass[x][y] = 1;
        queue.push([x, y, operLast]);
      }
    }
    return 0;
  }

  // --- C++ GetMaxMarkOper ---
  private getMaxMarkOper(state: GameState, player: PlayerState): number {
    const size = this.size;
    const nowX = player.x;
    const nowY = player.y;
    const pass = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
    const operGrid = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
    let result: [number, number] = [nowX, nowY];
    let markMaxNow = 0;

    pass[nowX][nowY] = 1;
    const queue: Array<[number, number, number]> = [[nowX, nowY, 1]];
    while (queue.length) {
      const [px, py, step] = queue.shift()!;
      const val = step;
      const nowOper = operGrid[px][py];
      let selfMark = 0;

      // 距离分（避免同分）
      selfMark += Math.min(
        50,
        Math.abs(size - px - this.enemyInit[0]) + Math.abs(size - py - this.enemyInit[1]),
      );

      const item = state.cells[px][py].item;
      if (item !== Item.None) {
        selfMark += kItemMark + itemExtraMark(item, this.hard);
      }

      // 自己无敌且脚下有人
      if (
        player.invincible !== 0 &&
        (px !== nowX || py !== nowY) &&
        playerAtCell(state, px, py)
      ) {
        selfMark += kInvincibleMark;
      }

      // 扫描四方向炸弹范围内的目标
      for (const [gx, gy] of this.moveGap) {
        const x = px + gx;
        const y = py + gy;
        if (!this.correctPos(x, y)) continue;
        if (pass[x][y] !== 0 && pass[x][y] <= val) continue;

        for (let i = 1; i <= player.bombRange; i++) {
          const rx = px + gx * i;
          const ry = py + gy * i;
          if (!this.correctPos(rx, ry)) break;
          const cell = state.cells[rx][ry];
          const others = countOtherPlayers(state, rx, ry, player.id);
          if (others > 0) selfMark += others * kPlayerMark;
          if (cell.block != null) {
            if (cell.block === 'mud') selfMark += kMudMark;
            break;
          }
          if (cell.bombId != null) break;
        }

        if (
          state.cells[x][y].bombId != null ||
          state.cells[x][y].block != null ||
          this.areaMark[x][y] < 0 ||
          (!this.hard && this.hasBombCapableOpponentAt(state, player.id, x, y))
        ) {
          continue;
        }

        const operLast = this.deriveOper(player.x, player.y, x, y, nowOper);
        operGrid[x][y] = operLast;
        pass[x][y] = 1;
        queue.push([x, y, val + 1]);
      }

      if (markMaxNow < selfMark) {
        if (this.hard) {
          if (item !== Item.None) {
            result = [px, py];
            markMaxNow = selfMark;
          } else if (this.canPlaceBomb(state, player, px, py)) {
            result = [px, py];
            markMaxNow = selfMark;
          }
        } else {
          result = [px, py];
          markMaxNow = selfMark;
        }
      }
    }

    let operTake = operGrid[result[0]][result[1]];
    if (result[0] === player.x && result[1] === player.y && markMaxNow > 0) {
      if (player.bombMax !== player.bombNow) {
        operTake = 5; // 原地放炸弹
      }
      if (!this.hard) {
        if (player.bombMax !== player.bombNow && this.canPlaceBomb(state, player, result[0], result[1])) {
          operTake = 5;
        } else {
          operTake = 0;
        }
      }
    }
    return operTake;
  }

  private hasBombCapableOpponentAt(
    state: GameState,
    playerId: number,
    x: number,
    y: number,
  ): boolean {
    return state.players.some(
      (other) =>
        other.id !== playerId &&
        other.alive &&
        other.x === x &&
        other.y === y &&
        other.bombNow < other.bombMax,
    );
  }

  private applyDynamicMoveOrder(x: number, y: number): void {
    const center = this.size > 0 ? Math.floor(this.size / 2) : 6;
    const vertical: Gap = x <= center ? [1, 0] : [-1, 0];
    const horizontal: Gap = y <= center ? [0, 1] : [0, -1];
    const verticalBack: Gap = [-vertical[0], -vertical[1]];
    const horizontalBack: Gap = [-horizontal[0], -horizontal[1]];
    if (this.orderMode === 1) {
      this.moveGap = [vertical, horizontal, horizontalBack, verticalBack];
    } else if (this.orderMode === 2) {
      this.moveGap = [horizontal, vertical, verticalBack, horizontalBack];
    } else if (this.orderMode === 3) {
      this.moveGap = [verticalBack, horizontalBack, horizontal, vertical];
    } else if (this.orderMode === 4) {
      const basisX = this.selfInit[0] >= 0 ? this.selfInit[0] : x;
      const basisY = this.selfInit[1] >= 0 ? this.selfInit[1] : y;
      const top = basisX <= center;
      const left = basisY <= center;
      if (top && left) {
        this.moveGap = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // DRUL
      } else if (top && !left) {
        this.moveGap = [[1, 0], [0, -1], [0, 1], [-1, 0]]; // DLRU
      } else {
        this.moveGap = [[-1, 0], [0, 1], [0, -1], [1, 0]]; // URLD
      }
    }
  }

  // --- C++ CanPleaceBomb ---
  private canPlaceBomb(state: GameState, player: PlayerState, px: number, py: number): boolean {
    const effectiveSpeed = this.hard ? player.speed : 1;
    const stepMax = effectiveSpeed * state.config.bombTime;
    const baseBombs: Array<[number, number, number]> = [
      [px, py, player.bombRange],
    ];
    if (!this.canEscapeWithVirtualBombs(state, [px, py], stepMax, baseBombs)) {
      return false;
    }

    if (this.hard) return true;

    const combinedWorstCase: Array<[number, number, number]> = [...baseBombs];
    for (const other of state.players) {
      if (
        other.id === player.id ||
        !other.alive ||
        other.bombNow >= other.bombMax
      ) {
        continue;
      }

      const reachable = this.reachablePositions(
        state,
        other,
        Math.max(1, other.speed) * state.config.bombTime,
      );
      for (const [otherX, otherY] of reachable) {
        const cell = state.cells[otherX][otherY];
        if (cell.block != null || cell.bombId != null) continue;
        combinedWorstCase.push([otherX, otherY, other.bombRange]);
        const concurrentBombs: Array<[number, number, number]> = [
          ...baseBombs,
          [otherX, otherY, other.bombRange],
        ];
        if (
          !this.canEscapeWithVirtualBombs(
            state,
            [px, py],
            stepMax,
            concurrentBombs,
          )
        ) {
          return false;
        }

        if (!other.gloves) continue;
        const dx = px - otherX;
        const dy = py - otherY;
        if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
        const pushedX = px + dx;
        const pushedY = py + dy;
        if (!this.correctPos(pushedX, pushedY)) continue;
        const pushedCell = state.cells[pushedX][pushedY];
        if (
          pushedCell.block != null ||
          pushedCell.bombId != null ||
          pushedCell.players.size > 0 ||
          pushedCell.item !== Item.None
        ) {
          continue;
        }
        const pushedBombs: Array<[number, number, number]> = [
          [pushedX, pushedY, player.bombRange],
          [otherX, otherY, other.bombRange],
        ];
        if (
          !this.canEscapeWithVirtualBombs(
            state,
            [px, py],
            stepMax,
            pushedBombs,
          )
        ) {
          return false;
        }
      }
    }
    return this.canEscapeWithVirtualBombs(
      state,
      [px, py],
      stepMax,
      combinedWorstCase,
    );
  }

  private reachablePositions(
    state: GameState,
    player: PlayerState,
    maxSteps: number,
  ): Array<[number, number]> {
    const pass = Array.from(
      { length: this.size },
      () => Array.from({ length: this.size }, () => Number.MAX_SAFE_INTEGER),
    );
    const queue: Array<[number, number, number]> = [[player.x, player.y, 0]];
    const result: Array<[number, number]> = [];
    pass[player.x][player.y] = 0;
    while (queue.length) {
      const [x, y, distance] = queue.shift()!;
      result.push([x, y]);
      if (distance >= maxSteps) continue;
      for (const [gx, gy] of this.moveGap) {
        const nx = x + gx;
        const ny = y + gy;
        if (!this.correctPos(nx, ny)) continue;
        const cell = state.cells[nx][ny];
        if (cell.block != null || cell.bombId != null) continue;
        if (distance + 1 >= pass[nx][ny]) continue;
        pass[nx][ny] = distance + 1;
        queue.push([nx, ny, distance + 1]);
      }
    }
    return result;
  }

  private canEscapeWithVirtualBombs(
    state: GameState,
    start: [number, number],
    stepMax: number,
    bombs: Array<[number, number, number]>,
  ): boolean {
    const blast = new Set<number>();
    const virtualBombs = new Set<number>();
    const addBlast = (bombX: number, bombY: number, range: number) => {
      virtualBombs.add(bombX * 1000 + bombY);
      blast.add(bombX * 1000 + bombY);
      for (const [gx, gy] of this.moveGap) {
        for (let distance = 0; distance <= range; distance++) {
          const nx = bombX + gx * distance;
          const ny = bombY + gy * distance;
          if (!this.correctPos(nx, ny)) continue;
          if (state.cells[nx][ny].block != null) break;
          blast.add(nx * 1000 + ny);
        }
      }
    };
    for (const [x, y, range] of bombs) addBlast(x, y, range);

    const pass = Array.from({ length: this.size }, () => Array.from({ length: this.size }, () => Number.MAX_SAFE_INTEGER));
    pass[start[0]][start[1]] = 1;
    const queue: Array<[number, number, number]> = [[start[0], start[1], 1]];
    while (queue.length) {
      const [cx, cy, dist] = queue.shift()!;
      for (const [gx, gy] of this.moveGap) {
        const x = cx + gx;
        const y = cy + gy;
        if (!this.correctPos(x, y)) continue;
        if (
          state.cells[x][y].block != null ||
          state.cells[x][y].bombId != null ||
          virtualBombs.has(x * 1000 + y)
        ) {
          continue;
        }
        const nextDistance = dist + 1;
        if (nextDistance - 1 > stepMax || nextDistance >= pass[x][y]) continue;
        if (this.areaMark[x][y] < 0) continue;
        if (blast.has(x * 1000 + y)) {
          pass[x][y] = nextDistance;
          queue.push([x, y, nextDistance]);
          continue;
        }
        return true; // 找到安全区
      }
    }
    return false;
  }
}

function playerAtCell(state: GameState, x: number, y: number): boolean {
  return state.players.some((p) => p.alive && p.x === x && p.y === y);
}

function countOtherPlayers(state: GameState, x: number, y: number, selfId: number): number {
  return state.players.filter((p) => p.alive && p.id !== selfId && p.x === x && p.y === y).length;
}

// ---------------------------------------------------------------------------
// 搜索增强 bot：以 hard 规则动作为基线，对 6 个动作做浅层 rollout（对齐
// rule_search_bot.h 思路），仅在明显更优时覆盖规则动作。
// ---------------------------------------------------------------------------

export class SearchBot extends RuleBot {
  readonly label: string = '搜索增强';

  constructor(
    private readonly depth = 6,
    private readonly rollouts = 2,
    private readonly minGap = 900,
  ) {
    super(true, 4);
  }

  chooseAction(state: GameState, playerId: number): Action {
    const baseline = super.chooseAction(state, playerId);
    const player = state.players.find((p) => p.id === playerId);
    if (!player || !player.alive) return baseline;

    const baseScore = rolloutActionScore(state, playerId, baseline, this.depth, this.rollouts);
    let best = baseline;
    let bestScore = baseScore;
    for (const action of OPER_TO_ACTION) {
      if (!actionLegal(state, player, action, false)) continue;
      const score = rolloutActionScore(state, playerId, action, this.depth, this.rollouts);
      if (score > bestScore) {
        bestScore = score;
        best = action;
      }
    }
    return best !== baseline && bestScore - baseScore >= this.minGap ? best : baseline;
  }
}

export class PureNnBot implements BotController {
  readonly label = '纯 NN';
  private selfInit: [number, number] | null = null;
  private enemyInit: [number, number] | null = null;

  constructor(private readonly policy: PureNnPolicy | null) {}

  reset(playerId: number, state: GameState): void {
    const self = state.players.find((p) => p.id === playerId && p.alive);
    const enemy = state.players.find((p) => p.id !== playerId && p.alive);
    this.selfInit = self ? [self.x, self.y] : null;
    this.enemyInit = enemy ? [enemy.x, enemy.y] : null;
    this.policy?.reset();
  }

  chooseAction(state: GameState, playerId: number, sub = 0): Action {
    const player = state.players.find((p) => p.id === playerId && p.alive);
    if (!player || !this.policy) return Action.Silent;
    if (!this.selfInit) this.selfInit = [player.x, player.y];
    const enemy = state.players.find((p) => p.id !== playerId && p.alive);
    if (!this.enemyInit && enemy) this.enemyInit = [enemy.x, enemy.y];
    const probs = this.policy.predict(state, playerId, this.selfInit, this.enemyInit ?? [enemy?.x ?? 0, enemy?.y ?? 0], sub);
    const order = probs
      .map((p, action) => ({ p, action: action as Action }))
      .sort((a, b) => b.p - a.p);
    const inDanger = buildDlAreaMark(state, player)[player.x][player.y];
    let chosen: Action = Action.Silent;
    for (const item of order) {
      if (isPureNnActionLegal(state, player, item.action)) {
        chosen = item.action;
        break;
      }
    }
    this.policy.commit(chosen, inDanger);
    return chosen;
  }
}

function buildDlAreaMark(state: GameState, self: PlayerState): boolean[][] {
  const size = state.config.size;
  const dangerous = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  const directions: Array<[number, number]> = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  for (const bomb of state.bombs) {
    dangerous[bomb.x][bomb.y] = true;
    for (const [dx, dy] of directions) {
      for (let step = 0; step <= bomb.range; step++) {
        const x = bomb.x + dx * step;
        const y = bomb.y + dy * step;
        if (!inBounds(state, x, y)) continue;
        if (state.cells[x][y].block != null) break;
        dangerous[x][y] = true;
      }
    }
  }
  for (const enemy of state.players) {
    if (
      enemy.id === self.id ||
      !enemy.alive ||
      enemy.invincible === 0 ||
      self.invincible >= enemy.invincible
    ) {
      continue;
    }
    for (let x = enemy.x - enemy.speed; x <= enemy.x + enemy.speed; x++) {
      const spread = Math.abs(enemy.speed - Math.abs(x - enemy.x));
      for (let y = enemy.y - spread; y <= enemy.y + spread; y++) {
        if (!inBounds(state, x, y) || state.cells[x][y].block != null) continue;
        dangerous[x][y] = true;
      }
    }
  }
  return dangerous;
}

function canPlaceBombForNn(
  state: GameState,
  player: PlayerState,
  dangerous: boolean[][],
): boolean {
  const blast = new Set<number>();
  const directions: Array<[number, number]> = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  blast.add(player.x * 1000 + player.y);
  for (const [dx, dy] of directions) {
    for (let step = 0; step <= player.bombRange; step++) {
      const x = player.x + dx * step;
      const y = player.y + dy * step;
      if (!inBounds(state, x, y)) continue;
      if (state.cells[x][y].block != null) break;
      blast.add(x * 1000 + y);
    }
  }

  const maxDistance = player.speed * state.config.bombTime;
  const bestDistance = Array.from({ length: state.config.size }, () =>
    Array.from({ length: state.config.size }, () => Number.MAX_SAFE_INTEGER),
  );
  const queue: Array<[number, number, number]> = [[player.x, player.y, 1]];
  bestDistance[player.x][player.y] = 1;
  while (queue.length) {
    const [currentX, currentY, distance] = queue.shift()!;
    for (const [dx, dy] of directions) {
      const x = currentX + dx;
      const y = currentY + dy;
      if (!inBounds(state, x, y)) continue;
      const cell = state.cells[x][y];
      if (cell.block != null || cell.bombId != null) continue;
      if (distance > maxDistance || distance + 1 >= bestDistance[x][y]) continue;
      if (dangerous[x][y]) continue;
      if (blast.has(x * 1000 + y)) {
        bestDistance[x][y] = distance + 1;
        queue.push([x, y, distance + 1]);
        continue;
      }
      return true;
    }
  }
  return false;
}

function isPureNnActionLegal(
  state: GameState,
  player: PlayerState,
  action: Action,
): boolean {
  const dangerous = buildDlAreaMark(state, player);
  if (action === Action.Place) {
    const current = state.cells[player.x][player.y];
    return (
      player.bombNow < player.bombMax &&
      current.bombId == null &&
      current.block == null &&
      canPlaceBombForNn(state, player, dangerous)
    );
  }
  if (action === Action.Silent) return true;
  const [dx, dy] = [
    [0, 0],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
    [0, 0],
  ][action] as [number, number];
  const x = player.x + dx;
  const y = player.y + dy;
  if (!inBounds(state, x, y)) return false;
  const target = state.cells[x][y];
  if (target.block != null || target.bombId != null) return false;
  const currentDanger = dangerous[player.x][player.y];
  return !dangerous[x][y] || currentDanger;
}

export class HybridSearchBot extends SearchBot {
  readonly label = 'NN + 搜索';

  constructor(private readonly policy: PureNnPolicy | null) {
    super(6, 2, 900);
  }

  chooseAction(state: GameState, playerId: number): Action {
    const baseline = super.chooseAction(state, playerId);
    const player = state.players.find((p) => p.id === playerId && p.alive);
    if (!player || !this.policy) return baseline;
    const enemy = state.players.find((p) => p.id !== playerId && p.alive);
    const probs = this.policy.predict(state, playerId, [player.x, player.y], [enemy?.x ?? 0, enemy?.y ?? 0]);
    let best = baseline;
    let bestScore = rolloutActionScore(state, playerId, baseline, 6, 2) + 90 * (probs[baseline] ?? 0);
    for (const action of OPER_TO_ACTION) {
      if (!actionLegal(state, player, action, false)) continue;
      const score = rolloutActionScore(state, playerId, action, 6, 2) + 90 * (probs[action] ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = action;
      }
    }
    return best;
  }
}

function rolloutActionScore(state: GameState, playerId: number, action: Action, depth: number, repeats: number): number {
  let total = 0;
  for (let i = 0; i < repeats; i++) {
    const sim = cloneGame(state, i * 131 + action);
    applyAction(sim, playerId, action);
    const bots = new Map<number, BotController>();
    for (const p of sim.players) bots.set(p.id, new RuleBot(true, 4));
    for (const [id, bot] of bots) bot.reset?.(id, sim);
    for (let d = 0; d < depth && !sim.over; d++) {
      runRound(sim, bots);
    }
    total += scoreState(sim, playerId);
  }
  return total / repeats;
}

export { inBounds };
