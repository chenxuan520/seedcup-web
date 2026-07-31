// SeedCup 2023 浏览器模拟器
// 规则严格对齐原版服务端 seedcup2023/src/server/game/*（game.cpp / player.h /
// bomb.h / area.h / potion/* / block/*）。不自行发明数值或流程。
//
// 坐标约定与服务端一致：pos.first = 行(x, 上下)，pos.second = 列(y, 左右)。

export const BOARD_SIZE = 13;

export enum Action {
  Silent = 0, // SLIENT
  Left = 1, // MOVE_LEFT
  Right = 2, // MOVE_RIGHT
  Up = 3, // MOVE_UP
  Down = 4, // MOVE_DOWN
  Place = 5, // PLACED
}

// 对齐服务端 PotionType 枚举值
export enum Item {
  None = 0,
  BombRange = 1,
  BombNum = 2,
  Rebirth = 3, // 重生药：回血
  Invincible = 4,
  Shield = 5,
  Speed = 6,
  Gloves = 7,
}

export type BlockKind = 'wall' | 'mud' | null;

export interface Cell {
  block: BlockKind;
  item: Item; // 仅当 block 为 mud 时可携带隐藏道具；空地上的道具是炸出来的
  bombId: number | null;
  players: Set<number>;
}

export interface PlayerState {
  id: number;
  name: string;
  x: number;
  y: number;
  alive: boolean;
  hp: number;
  speed: number;
  bombMax: number;
  bombNow: number;
  bombRange: number;
  invincible: number;
  shield: number;
  gloves: boolean;
  score: number;
  color: string;
}

// 炸弹运动状态（手套推弹）
export enum BombStatus {
  Silent = 0,
  Left = 1,
  Right = 2,
  Up = 3,
  Down = 4,
}

export interface BombState {
  id: number;
  x: number;
  y: number;
  range: number;
  timeLeft: number; // 对齐 bomb_time_：>0 递减，==0 时爆炸
  ownerId: number;
  status: BombStatus;
}

export interface BlockMeta {
  id: number;
  x: number;
  y: number;
  removable: boolean;
  hiddenItem: Item;
}

export interface GameConfig {
  size: number;
  playerNum: number;
  playerHp: number;
  playerMaxHp: number;
  playerSpeed: number;
  bombTime: number;
  bombRange: number;
  bombNum: number;
  bombRandom: number;
  shieldTime: number;
  invincibleTime: number;
  markKill: number;
  markDead: number;
  markPick: number;
  markBombMud: number;
  potionProbability: number;
  wallRandom: number;
  mudRandom: number;
  maxRound: number;
}

export interface GameState {
  config: GameConfig;
  seed: number;
  round: number;
  over: boolean;
  winnerIds: number[];
  cells: Cell[][];
  players: PlayerState[];
  bombs: BombState[];
  nextBombId: number;
  rng: Rng;
}

export interface StepEvent {
  kind: 'move' | 'place' | 'explode' | 'pickup' | 'damage' | 'round' | 'gameover';
  text: string;
  cells?: Array<[number, number]>; // explode 事件携带爆炸覆盖的格子
}

export interface BotController {
  readonly label: string;
  reset?(playerId: number, state: GameState): void;
  chooseAction(state: GameState, playerId: number, sub?: number): Action;
  // 每回合允许提交的动作数上限。对齐 C++ MapCall：easy 恒为 1，hard 按 speed。
  // 未实现时默认按玩家 speed。
  movesPerTurn?(player: PlayerState): number;
}

// mulberry32：确定性 PRNG。C++ 用 mt19937，逐位无法复现，但保证规则语义与
// 生成流程一致（同一种子在本模拟器内可复现）。
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state += 0x6d2b79f5;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // 对齐服务端 Random(0,100)：返回 [0,99]
  probability(): number {
    return Math.floor(this.next() * 100);
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  fork(salt: number): Rng {
    return new Rng((this.state ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0);
  }

  snapshot(): number {
    return this.state >>> 0;
  }

  restore(state: number): void {
    this.state = state >>> 0;
  }
}

export const defaultConfig: GameConfig = {
  size: BOARD_SIZE,
  playerNum: 2,
  playerHp: 1,
  playerMaxHp: 3,
  playerSpeed: 2,
  bombTime: 3,
  bombRange: 1,
  bombNum: 2,
  bombRandom: 1,
  shieldTime: 30,
  invincibleTime: 15,
  markKill: 10000,
  markDead: 12000,
  markPick: 100,
  markBombMud: 10,
  potionProbability: 50,
  wallRandom: 25,
  mudRandom: 75,
  maxRound: 1200,
};

// 对齐服务端 GenPotionList 默认表 5:5:2:1:2:3:3 展开：
// SHIELD×2, INVINCIBLE×1, REBIRTH×2, BOMB_RANGE×6, BOMB_NUM×6, SPEED×3, GLOVES×3
const potionBag: Item[] = [
  Item.Shield, Item.Shield,
  Item.Invincible,
  Item.Rebirth, Item.Rebirth,
  Item.BombRange, Item.BombRange, Item.BombRange, Item.BombRange, Item.BombRange, Item.BombRange,
  Item.BombNum, Item.BombNum, Item.BombNum, Item.BombNum, Item.BombNum, Item.BombNum,
  Item.Speed, Item.Speed, Item.Speed,
  Item.Gloves, Item.Gloves, Item.Gloves,
];

export const moveDeltas: Record<Action, [number, number]> = {
  [Action.Silent]: [0, 0],
  [Action.Left]: [0, -1],
  [Action.Right]: [0, 1],
  [Action.Up]: [-1, 0],
  [Action.Down]: [1, 0],
  [Action.Place]: [0, 0],
};

const playerColors = ['#3b82f6', '#ef4444', '#22c55e', '#eab308'];
const playerNames = ['蓝', '红', '绿', '黄'];

function makeCell(): Cell {
  return { block: null, item: Item.None, bombId: null, players: new Set() };
}

export function createGame(seed = Date.now() >>> 0, config: GameConfig = defaultConfig): GameState {
  const rng = new Rng(seed);
  const size = config.size;
  const cells: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => makeCell()),
  );

  const mid = Math.floor(size / 2);
  const blockMeta = new Map<number, BlockMeta>();
  let nextBlockId = 1;

  // --- 对齐 InitMap / IsCreateWall ---
  const isCreateWall = (i: number, j: number): boolean => {
    if (i % 2 !== 0 && j % 2 !== 0) return true; // 固定墙
    if (
      (i + j) % 2 !== 0 &&
      i >= 1 && i < size - 1 && j >= 1 && j < size - 1 &&
      rng.probability() < config.wallRandom
    ) {
      return true; // 随机墙
    }
    void mid;
    return false;
  };

  const blockArr: Array<[number, number]> = [];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (isCreateWall(i, j)) {
        const id = nextBlockId++;
        cells[i][j].block = 'wall';
        blockMeta.set(id, { id, x: i, y: j, removable: false, hiddenItem: Item.None });
      } else if ((size - i <= 2 || i <= 1) && (size - j <= 2 || j <= 1)) {
        // 出生区，留空
      } else {
        blockArr.push([i, j]);
      }
    }
  }

  shuffle(blockArr, rng);
  for (const [i, j] of blockArr) {
    if (rng.probability() >= config.mudRandom) continue;
    const id = nextBlockId++;
    cells[i][j].block = 'mud';
    let hidden = Item.None;
    if (rng.probability() < config.potionProbability) {
      hidden = potionBag[rng.int(potionBag.length)];
    }
    blockMeta.set(id, { id, x: i, y: j, removable: true, hiddenItem: hidden });
  }

  // --- 出生点：[(0,0),(N-1,N-1),(N-1,0),(0,N-1)] 洗牌 ---
  const birth: Array<[number, number]> = [
    [0, 0],
    [size - 1, size - 1],
    [size - 1, 0],
    [0, size - 1],
  ];
  shuffle(birth, rng);

  const players: PlayerState[] = [];
  for (let i = 0; i < config.playerNum && i < birth.length; i++) {
    const [x, y] = birth[i];
    const p = makePlayer(i + 1, playerNames[i] ?? `P${i + 1}`, x, y, playerColors[i] ?? '#888', config);
    players.push(p);
    cells[x][y].players.add(p.id);
  }

  const state: GameState = {
    config,
    seed,
    round: 0,
    over: false,
    winnerIds: [],
    cells,
    players,
    bombs: [],
    nextBombId: 1,
    rng,
  };
  (state as unknown as { blockMeta: Map<number, BlockMeta> }).blockMeta = blockMeta;
  return state;
}

function getBlockMeta(state: GameState): Map<number, BlockMeta> {
  return (state as unknown as { blockMeta: Map<number, BlockMeta> }).blockMeta;
}

function makePlayer(id: number, name: string, x: number, y: number, color: string, config: GameConfig): PlayerState {
  return {
    id,
    name,
    x,
    y,
    alive: true,
    hp: config.playerHp,
    speed: config.playerSpeed,
    bombMax: config.bombNum,
    bombNow: 0,
    bombRange: config.bombRange,
    invincible: 0,
    shield: 0,
    gloves: false,
    score: 0,
    color,
  };
}

function shuffle<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function cloneGame(state: GameState, rngSalt = 0): GameState {
  const cloned: GameState = {
    config: { ...state.config },
    seed: state.seed,
    round: state.round,
    over: state.over,
    winnerIds: [...state.winnerIds],
    cells: state.cells.map((row) =>
      row.map((c) => ({ block: c.block, item: c.item, bombId: c.bombId, players: new Set(c.players) })),
    ),
    players: state.players.map((p) => ({ ...p })),
    bombs: state.bombs.map((b) => ({ ...b })),
    nextBombId: state.nextBombId,
    rng: state.rng.fork(rngSalt),
  };
  const meta = getBlockMeta(state);
  const clonedMeta = new Map<number, BlockMeta>();
  for (const [id, m] of meta) clonedMeta.set(id, { ...m });
  (cloned as unknown as { blockMeta: Map<number, BlockMeta> }).blockMeta = clonedMeta;
  return cloned;
}

export function inBounds(state: GameState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.config.size && y < state.config.size;
}

export function playerAt(state: GameState, x: number, y: number, exceptId = -1): PlayerState | undefined {
  return state.players.find((p) => p.alive && p.id !== exceptId && p.x === x && p.y === y);
}

export function bombAt(state: GameState, id: number | null): BombState | undefined {
  if (id == null) return undefined;
  return state.bombs.find((b) => b.id === id);
}

export function isWalkable(state: GameState, x: number, y: number): boolean {
  if (!inBounds(state, x, y)) return false;
  const cell = state.cells[x][y];
  return cell.block == null && cell.bombId == null;
}

// 危险图（渲染 + NN 特征用）：与规则 bot 的 area_mark_ 同源，标记炸弹爆炸范围。
export function dangerInfo(state: GameState): { danger: boolean[][]; time: number[][] } {
  const n = state.config.size;
  const danger = Array.from({ length: n }, () => Array.from({ length: n }, () => false));
  const time = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  const mark = (x: number, y: number, t: number) => {
    danger[x][y] = true;
    time[x][y] = time[x][y] === 0 ? t : Math.min(time[x][y], t);
  };
  for (const bomb of state.bombs) {
    mark(bomb.x, bomb.y, bomb.timeLeft);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as Array<[number, number]>) {
      for (let r = 1; r <= bomb.range; r++) {
        const x = bomb.x + dx * r;
        const y = bomb.y + dy * r;
        if (!inBounds(state, x, y)) break;
        if (state.cells[x][y].block != null) break;
        mark(x, y, bomb.timeLeft);
      }
    }
  }
  return { danger, time };
}

// 供 bot 判断动作合法性（不改变状态）
export function actionLegal(state: GameState, player: PlayerState, action: Action, avoidNewDanger = true): boolean {
  if (!player.alive) return false;
  if (action === Action.Silent) return true;
  if (action === Action.Place) {
    const cell = state.cells[player.x][player.y];
    return player.bombNow < player.bombMax && cell.block == null && cell.bombId == null;
  }
  const [dx, dy] = moveDeltas[action];
  const nx = player.x + dx;
  const ny = player.y + dy;
  if (!inBounds(state, nx, ny)) return false;
  const cell = state.cells[nx][ny];
  // 手套推弹视为合法尝试
  if (player.gloves && cell.bombId != null) {
    const bomb = bombAt(state, cell.bombId);
    return bomb ? bomb.status === BombStatus.Silent : false;
  }
  if (cell.block != null || cell.bombId != null) return false;
  if (avoidNewDanger) {
    const info = dangerInfo(state);
    if (!info.danger[player.x][player.y] && info.danger[nx][ny]) return false;
  }
  return true;
}

// --- 对齐服务端 DealMoveAction / DealPlaceAction ---
export function applyAction(state: GameState, playerId: number, action: Action, events: StepEvent[] = []): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !player.alive || state.over) return;

  if (action === Action.Silent) return;

  if (action === Action.Place) {
    if (player.bombNow >= player.bombMax) return;
    const cell = state.cells[player.x][player.y];
    if (cell.bombId != null || cell.block != null) return;
    const id = state.nextBombId++;
    const extra = state.rng.int(state.config.bombRandom + 1); // rand(0..bombRandom)
    state.bombs.push({
      id,
      x: player.x,
      y: player.y,
      range: player.bombRange,
      timeLeft: state.config.bombTime + extra,
      ownerId: player.id,
      status: BombStatus.Silent,
    });
    cell.bombId = id;
    player.bombNow++;
    events.push({ kind: 'place', text: `${player.name} 放置炸弹` });
    return;
  }

  const [dx, dy] = moveDeltas[action];
  const nx = player.x + dx;
  const ny = player.y + dy;
  if (!inBounds(state, nx, ny)) return;
  const dst = state.cells[nx][ny];

  // 推炸弹
  if (player.gloves && dst.bombId != null) {
    const bomb = bombAt(state, dst.bombId);
    if (bomb && bomb.status === BombStatus.Silent) {
      bomb.status = action as unknown as BombStatus; // Left/Right/Up/Down 对齐
    }
    return; // 推弹后玩家不移动
  }

  if (dst.block != null || dst.bombId != null) return;

  // 移动
  state.cells[player.x][player.y].players.delete(player.id);
  player.x = nx;
  player.y = ny;
  dst.players.add(player.id);

  // 相遇（无敌碰撞伤害）
  for (const otherId of [...dst.players]) {
    if (otherId === player.id) continue;
    const other = state.players.find((p) => p.id === otherId);
    if (other) meetOtherPlayer(state, player, other, events);
  }

  // 捡道具
  if (dst.item !== Item.None) {
    pickupItem(state, player, dst.item);
    events.push({ kind: 'pickup', text: `${player.name} 拾取 ${itemName(dst.item)}` });
    dst.item = Item.None;
  }
}

// --- 对齐 Player::MeetOtherPlayer ---
function meetOtherPlayer(state: GameState, self: PlayerState, other: PlayerState, events: StepEvent[]): void {
  if (other.id === self.id) return;
  if (other.invincible > 0 && self.invincible > 0) return;
  if (other.invincible > 0) {
    const killed = injuries(state, self);
    if (killed) other.score += state.config.markKill;
    if (killed) events.push({ kind: 'damage', text: `${self.name} 撞上无敌的 ${other.name}，被淘汰` });
    return;
  }
  if (self.invincible > 0) {
    const killed = injuries(state, other);
    if (killed) self.score += state.config.markKill;
    if (killed) events.push({ kind: 'damage', text: `${self.name}(无敌) 撞死 ${other.name}` });
  }
}

// --- 对齐 Player::Injuries + DescHP ---
// 返回 true 表示该玩家死亡（被 injuries 判定）
function injuries(state: GameState, victim: PlayerState): boolean {
  if (!victim.alive) return false;
  if (victim.invincible > 0) return false;
  if (victim.shield > 0) {
    victim.shield = 0;
    return false;
  }
  victim.hp--;
  if (victim.hp <= 0) {
    victim.alive = false;
    victim.score -= state.config.markDead;
    return true;
  }
  victim.shield = state.config.shieldTime; // 受伤后短暂护盾
  return false;
}

// --- 对齐各 potion PickUp ---
function pickupItem(state: GameState, player: PlayerState, item: Item): void {
  switch (item) {
    case Item.BombRange:
      player.bombRange++;
      break;
    case Item.BombNum:
      player.bombMax++;
      break;
    case Item.Rebirth:
      if (player.hp < state.config.playerMaxHp) player.hp++;
      break;
    case Item.Invincible:
      player.invincible = state.config.invincibleTime;
      break;
    case Item.Shield:
      player.shield = state.config.shieldTime;
      break;
    case Item.Speed:
      player.speed++;
      break;
    case Item.Gloves:
      player.gloves = true;
      break;
  }
  player.score += state.config.markPick;
}

// --- 对齐 Game::FlushTime 的一整轮 ---
export function runRound(state: GameState, bots: Map<number, BotController>, humanQueued?: Map<number, Action[]>): StepEvent[] {
  const events: StepEvent[] = [];
  if (state.over) return events;

  // 对齐 C++ DriveBot/MapCall：每个客户端先基于同一个回合快照，独立算完
  // 自己整批动作；本地只模拟自己的动作，不能看到对手在本回合刚做的动作。
  const actionBatches = new Map<number, Action[]>();
  for (const player of state.players) {
    if (!player.alive) continue;
    const bot = bots.get(player.id);
    const moveCount = Math.max(
      1,
      bot?.movesPerTurn ? bot.movesPerTurn(player) : player.speed,
    );
    const planningState = cloneGame(state, player.id);
    const actions: Action[] = [];
    for (let sub = 0; sub < moveCount; sub++) {
      const queued = humanQueued?.get(player.id);
      let action: Action | undefined = queued?.shift();
      if (action == null) {
        action =
          bot?.chooseAction(planningState, player.id, sub) ?? Action.Silent;
      }
      actions.push(action);
      simulateClientAction(planningState, player.id, action);
    }
    actionBatches.set(player.id, actions);
  }

  // 对齐 GameSim::Step：决策时看到旧 round，提交后才 round++，再按子步
  // round-robin 应用动作；奇数轮反转玩家顺序以模拟到达顺序抖动。
  state.round++;
  const order = state.players.map((player) => player.id);
  if (state.round & 1) order.reverse();
  const maxSteps = Math.max(
    1,
    ...state.players.map(
      (player) => actionBatches.get(player.id)?.length ?? 0,
    ),
  );
  for (let sub = 0; sub < maxSteps; sub++) {
    for (const playerId of order) {
      const player = state.players.find((candidate) => candidate.id === playerId);
      if (!player?.alive) continue;
      const action = actionBatches.get(playerId)?.[sub];
      if (action == null) continue;
      applyAction(state, playerId, action, events);
    }
  }

  flushBombMove(state, events);
  flushBombExplode(state, events);
  flushPlayers(state);
  events.push({ kind: 'round', text: `第 ${state.round} 回合` });
  checkGameOver(state, events);
  return events;
}

function simulateClientAction(
  state: GameState,
  playerId: number,
  action: Action,
): void {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player?.alive) return;
  if (action === Action.Place) {
    const cell = state.cells[player.x][player.y];
    if (cell.block != null || cell.bombId != null) return;
    const bombId = -1_000_000 - state.bombs.length;
    state.bombs.push({
      id: bombId,
      x: player.x,
      y: player.y,
      range: player.bombRange,
      timeLeft: state.config.bombTime,
      ownerId: player.id,
      status: BombStatus.Silent,
    });
    cell.bombId = bombId;
    return;
  }
  if (action === Action.Silent) return;
  const [dx, dy] = moveDeltas[action];
  const x = player.x + dx;
  const y = player.y + dy;
  if (!inBounds(state, x, y)) return;
  const target = state.cells[x][y];
  if (target.block != null || target.bombId != null) return;
  state.cells[player.x][player.y].players.delete(player.id);
  player.x = x;
  player.y = y;
  target.players.add(player.id);
  if (target.item === Item.None) return;
  switch (target.item) {
    case Item.BombNum:
      player.bombMax++;
      break;
    case Item.BombRange:
      player.bombRange++;
      break;
    case Item.Invincible:
      player.invincible += 32767;
      break;
    case Item.Shield:
      player.shield += 32767;
      break;
    case Item.Rebirth:
      if (player.hp < state.config.playerMaxHp) player.hp++;
      break;
    case Item.Speed:
      player.speed++;
      break;
    case Item.Gloves:
      player.gloves = true;
      break;
  }
  target.item = Item.None;
}

// --- 对齐 FlushBombMove（手套推动的炸弹逐格移动）---
function flushBombMove(state: GameState, _events: StepEvent[]): void {
  for (const bomb of state.bombs) {
    if (bomb.status === BombStatus.Silent) continue;
    let nx = bomb.x;
    let ny = bomb.y;
    if (bomb.status === BombStatus.Up) nx--;
    else if (bomb.status === BombStatus.Down) nx++;
    else if (bomb.status === BombStatus.Right) ny++;
    else if (bomb.status === BombStatus.Left) ny--;
    if (!inBounds(state, nx, ny)) {
      bomb.status = BombStatus.Silent;
      continue;
    }
    const area = state.cells[nx][ny];
    if (area.bombId != null || area.block != null || area.item !== Item.None || area.players.size > 0) {
      bomb.status = BombStatus.Silent;
      continue;
    }
    state.cells[bomb.x][bomb.y].bombId = null;
    area.bombId = bomb.id;
    bomb.x = nx;
    bomb.y = ny;
  }
}

// --- 对齐 FlushBombExplode ---
function flushBombExplode(state: GameState, events: StepEvent[]): void {
  const meta = getBlockMeta(state);
  const queue: number[] = [];
  for (const bomb of state.bombs) {
    bomb.timeLeft--;
    if (bomb.timeLeft <= 0) queue.push(bomb.id);
  }

  const findBomb = (id: number) => state.bombs.find((b) => b.id === id);
  const removeBomb = (id: number) => {
    const idx = state.bombs.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const b = state.bombs[idx];
    if (state.cells[b.x][b.y].bombId === id) state.cells[b.x][b.y].bombId = null;
    state.bombs.splice(idx, 1);
  };

  while (queue.length) {
    const bombId = queue.shift()!;
    const bomb = findBomb(bombId);
    if (!bomb) continue;
    const { x: bx, y: by, range } = bomb;
    const owner = state.players.find((p) => p.id === bomb.ownerId);

    removeBomb(bombId);
    if (owner) owner.bombNow = Math.max(0, owner.bombNow - 1);

    const explodeCell = (x: number, y: number): boolean => {
      const area = state.cells[x][y];
      // 炸人
      for (const pid of [...area.players]) {
        const victim = state.players.find((p) => p.id === pid);
        if (!victim) continue;
        const killed = injuries(state, victim);
        if (killed) {
          if (owner && owner.id !== pid) owner.score += state.config.markKill;
          events.push({ kind: 'damage', text: `${victim.name} 被炸弹淘汰` });
        }
      }
      // 链爆
      if (area.bombId != null) {
        queue.push(area.bombId);
        return true;
      }
      // 炸道具
      if (area.item !== Item.None) {
        area.item = Item.None;
      }
      // 炸方块
      if (area.block != null) {
        if (area.block === 'mud') {
          const blockId = findBlockIdAt(meta, x, y);
          const hidden = blockId != null ? meta.get(blockId)?.hiddenItem ?? Item.None : Item.None;
          if (owner) owner.score += state.config.markBombMud;
          area.block = null;
          if (blockId != null) meta.delete(blockId);
          if (hidden !== Item.None) area.item = hidden;
        }
        return true; // 墙 / 泥墙都阻断
      }
      return false;
    };

    const blast: Array<[number, number]> = [];
    blast.push([bx, by]);
    explodeCell(bx, by);
    for (let dir = 0; dir < 4; dir++) {
      for (let r = 1; r <= range; r++) {
        let x = bx;
        let y = by;
        if (dir === 0) x += r;
        else if (dir === 1) x -= r;
        else if (dir === 2) y += r;
        else y -= r;
        if (!inBounds(state, x, y)) break;
        blast.push([x, y]);
        if (explodeCell(x, y)) break;
      }
    }
    events.push({ kind: 'explode', text: `炸弹在 ${bx},${by} 爆炸`, cells: blast });
  }

  // 清理死亡玩家的格子占位
  for (const p of state.players) {
    if (!p.alive && p.x >= 0) {
      state.cells[p.x][p.y].players.delete(p.id);
      p.x = -1;
      p.y = -1;
    }
  }
}

function findBlockIdAt(meta: Map<number, BlockMeta>, x: number, y: number): number | null {
  for (const [id, m] of meta) {
    if (m.x === x && m.y === y) return id;
  }
  return null;
}

// --- 对齐 FlushPlayer ---
function flushPlayers(state: GameState): void {
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p.shield > 0) p.shield--;
    if (p.invincible > 0) p.invincible--;
  }
}

// --- 对齐 IsGameOver ---
export function checkGameOver(state: GameState, events: StepEvent[] = []): void {
  const alive = state.players.filter((p) => p.alive);
  const aliveNum = alive.length;
  // 最高分胜者（并列保留）
  let top = -Infinity;
  let markWinners: number[] = [];
  for (const p of state.players) {
    if (p.score > top) {
      top = p.score;
      markWinners = [p.id];
    } else if (p.score === top) {
      markWinners.push(p.id);
    }
  }
  if (aliveNum === 1) {
    state.over = true;
    state.winnerIds = [alive[0].id];
    events.push({ kind: 'gameover', text: '对局结束' });
    return;
  }
  if (state.round > state.config.maxRound || aliveNum === 0) {
    state.over = true;
    state.winnerIds = markWinners;
    events.push({ kind: 'gameover', text: '对局结束' });
  }
}

export function scoreState(state: GameState, selfId: number): number {
  const self = state.players.find((p) => p.id === selfId);
  const enemy = state.players.find((p) => p.id !== selfId);
  if (!self) return -100000;
  let score = self.score;
  if (self.alive) score += 5000 + self.hp * 200 + self.bombMax * 30 + self.bombRange * 30 + self.speed * 25;
  else score -= 50000;
  if (self.gloves) score += 50;
  if (self.shield > 0) score += 100;
  if (self.invincible > 0) score += 300;
  if (enemy) {
    score -= enemy.score;
    if (enemy.alive) score -= 5000 + enemy.hp * 200;
    else score += 50000;
  }
  return score;
}

export function itemName(item: Item): string {
  switch (item) {
    case Item.BombRange: return '火力';
    case Item.BombNum: return '炸弹';
    case Item.Rebirth: return '回血';
    case Item.Invincible: return '无敌';
    case Item.Shield: return '护盾';
    case Item.Speed: return '加速';
    case Item.Gloves: return '手套';
    default: return '无';
  }
}

export function itemShort(item: Item): string {
  switch (item) {
    case Item.BombRange: return '火';
    case Item.BombNum: return '弹';
    case Item.Rebirth: return '血';
    case Item.Invincible: return '敌';
    case Item.Shield: return '盾';
    case Item.Speed: return '速';
    case Item.Gloves: return '套';
    default: return '';
  }
}

export function actionName(action: Action): string {
  return ['静止', '左', '右', '上', '下', '放弹'][action] ?? '静止';
}
