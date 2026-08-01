import {
  Action,
  BombStatus,
  Item,
  Rng,
  cppGameSimPlayerOrder,
  createCppGameSimGame,
  type BlockMeta,
  type GameState,
  type PlayerState,
} from './engine';

const moveDelta: Record<Action, [number, number]> = {
  [Action.Silent]: [0, 0],
  [Action.Left]: [0, -1],
  [Action.Right]: [0, 1],
  [Action.Up]: [-1, 0],
  [Action.Down]: [1, 0],
  [Action.Place]: [0, 0],
};

const cppBombBucketCount = Symbol('cppBombBucketCount');
const cppPlayerOrder = Symbol('cppPlayerOrder');
type CppRolloutState = GameState & {
  [cppBombBucketCount]: number;
  [cppPlayerOrder]?: number[];
};

export function initializeCppGameSimState(
  state: GameState,
  maxRound = 400,
): void {
  state.config = {
    ...state.config,
    playerMaxHp: 3,
    bombTime: 3,
    bombRandom: 1,
    shieldTime: 30,
    invincibleTime: 15,
    markKill: 10000,
    markDead: 12000,
    markPick: 100,
    markBombMud: 10,
    maxRound,
  };
  const existingBombs = [...state.bombs];
  state.bombs.length = 0;
  (state as CppRolloutState)[cppBombBucketCount] = 1;
  for (const bomb of existingBombs) insertCppBomb(state, bomb);
}

export { createCppGameSimGame };

export function createCppRolloutState(
  source: GameState,
  bombTimeLeft: ReadonlyMap<number, number>,
  seed: number,
  maxRound: number,
): GameState {
  const playerById = new Map(
    source.players.map((player) => [player.id, player]),
  );
  const playerOrder = cppGameSimPlayerOrder(source);
  const state: CppRolloutState = {
    config: {
      ...source.config,
      playerMaxHp: 3,
      bombTime: 3,
      bombRandom: 1,
      shieldTime: 30,
      invincibleTime: 15,
      markKill: 10000,
      markDead: 12000,
      markPick: 100,
      markBombMud: 10,
      maxRound,
    },
    seed,
    round: source.round,
    over: false,
    winnerIds: [],
    cells: source.cells.map((row) =>
      row.map((cell) => ({
        block: cell.block,
        item: cell.block == null ? cell.item : Item.None,
        bombId: cell.bombId,
        players: new Set<number>(),
        lastBombRound: cell.lastBombRound,
        playerBucketCount: 1,
      })),
    ),
    players: source.players.map((player) => ({ ...player })),
    bombs: [],
    nextBombId: Math.max(
      1,
      ...source.bombs.map((bomb) => bomb.id + 1),
    ),
    bombBucketCount: 1,
    rng: new Rng(seed),
    [cppBombBucketCount]: 1,
    [cppPlayerOrder]: playerOrder.filter((id) => playerById.has(id)),
  };

  // GameSim uses GCC 8 libstdc++ unordered_map<int, ...>. Its iteration order
  // decides which owner receives mud points in simultaneous explosions.
  for (const bomb of source.bombs) {
    insertCppBomb(state, {
      ...bomb,
      timeLeft: Math.max(
        1,
        bombTimeLeft.get(bomb.id) ?? source.config.bombTime,
      ),
      status: BombStatus.Silent,
    });
  }

  for (const player of state.players) {
    if (
      player.alive &&
      player.x >= 0 &&
      player.y >= 0 &&
      player.x < state.config.size &&
      player.y < state.config.size
    ) {
      state.cells[player.x][player.y].players.add(player.id);
    }
  }

  const meta = new Map<number, BlockMeta>();
  let blockId = 1;
  for (let x = 0; x < state.config.size; x++) {
    for (let y = 0; y < state.config.size; y++) {
      const block = state.cells[x][y].block;
      if (block == null) continue;
      meta.set(blockId, {
        id: blockId,
        x,
        y,
        removable: block === 'mud',
        hiddenItem: Item.None,
      });
      blockId++;
    }
  }
  (state as unknown as { blockMeta: Map<number, BlockMeta> }).blockMeta = meta;
  return state;
}

export function stepCppRollout(
  state: GameState,
  actions: ReadonlyMap<number, readonly Action[]>,
): void {
  if (state.over) return;
  state.round++;

  const maxSpeed = Math.max(
    1,
    ...state.players
      .filter((player) => player.alive)
      .map((player) => player.speed),
  );
  // createCppRolloutState preserves the GameMsg unordered-map iteration order,
  // exactly as GameSim::LoadFromMsg stores it in player_ids_.
  const order = [
    ...((state as CppRolloutState)[cppPlayerOrder] ??
      state.players.map((player) => player.id)),
  ];
  if (state.round & 1) order.reverse();

  for (let sub = 0; sub < maxSpeed; sub++) {
    for (const playerId of order) {
      const player = state.players.find((candidate) => candidate.id === playerId);
      if (!player?.alive || sub >= player.speed) continue;
      const action = actions.get(playerId)?.[sub];
      if (action == null) continue;
      applyCppAction(state, player, action);
    }
  }

  flushCppBombs(state);
  for (const player of state.players) {
    if (!player.alive) continue;
    if (player.shield > 0) player.shield--;
    if (player.invincible > 0) player.invincible--;
  }
  checkCppGameOver(state);
}

export function cppRolloutScore(
  state: GameState,
  selfId: number,
): number {
  const self = state.players.find((player) => player.id === selfId);
  const opponent = state.players.find((player) => player.id !== selfId);
  if (!self || !opponent) return 0;

  let score = 0;
  if (self.alive && !opponent.alive) score += 50000;
  if (!self.alive && opponent.alive) score -= 50000;
  if (self.alive) {
    score += self.score;
    score += self.hp * 200;
    score += self.bombMax * 30;
    score += self.bombRange * 30;
    if (self.gloves) score += 50;
    if (self.shield > 0) score += 100;
    if (self.invincible > 0) score += 300;
  }
  if (opponent.alive) {
    score -= opponent.score;
    score -= opponent.hp * 200;
  }
  return score;
}

export function cppRolloutWinners(state: GameState): number[] {
  const alive = state.players.filter((player) => player.alive);
  if (alive.length === 1) return [alive[0].id];
  let top = Number.NEGATIVE_INFINITY;
  let winners: number[] = [];
  for (const player of state.players) {
    if (player.score > top) {
      top = player.score;
      winners = [player.id];
    } else if (player.score === top) {
      winners.push(player.id);
    }
  }
  return winners;
}

function applyCppAction(
  state: GameState,
  player: PlayerState,
  action: Action,
): void {
  if (!player.alive || action === Action.Silent) return;
  if (action === Action.Place) {
    if (player.bombNow >= player.bombMax) return;
    const cell = state.cells[player.x][player.y];
    if (cell.bombId != null || cell.block != null) return;
    const id = state.nextBombId++;
    const timeLeft =
      state.config.bombTime + state.rng.int(state.config.bombRandom + 1);
    insertCppBomb(state, {
      id,
      x: player.x,
      y: player.y,
      range: player.bombRange,
      timeLeft,
      ownerId: player.id,
      status: BombStatus.Silent,
    });
    cell.bombId = id;
    player.bombNow++;
    return;
  }

  const [dx, dy] = moveDelta[action];
  const x = player.x + dx;
  const y = player.y + dy;
  if (!inBounds(state, x, y)) return;
  const target = state.cells[x][y];
  if (target.block != null || target.bombId != null) return;

  state.cells[player.x][player.y].players.delete(player.id);
  player.x = x;
  player.y = y;
  target.players.add(player.id);

  if (target.item !== Item.None) {
    pickupCppItem(state, player, target.item);
    target.item = Item.None;
  }

  for (const otherId of [...target.players]) {
    if (otherId === player.id) continue;
    const other = state.players.find((candidate) => candidate.id === otherId);
    if (!other) continue;
    if (player.invincible > 0 && other.invincible <= 0) {
      damageCppPlayer(state, other, player);
    } else if (other.invincible > 0 && player.invincible <= 0) {
      damageCppPlayer(state, player, other);
    }
  }
}

function insertCppBomb(
  state: GameState,
  bomb: GameState['bombs'][number],
): void {
  const cppState = state as CppRolloutState;
  let bucketCount = cppState[cppBombBucketCount] ?? 1;
  if (bucketCount === 1 || state.bombs.length + 1 >= bucketCount) {
    bucketCount = nextGcc8BucketCount(bucketCount);
    reorderForCppRehash(state.bombs, bucketCount);
    cppState[cppBombBucketCount] = bucketCount;
  }

  const bucket = positiveModulo(bomb.id, bucketCount);
  const sameBucketIndex = state.bombs.findIndex(
    (existing) => positiveModulo(existing.id, bucketCount) === bucket,
  );
  state.bombs.splice(sameBucketIndex < 0 ? 0 : sameBucketIndex, 0, bomb);
}

function reorderForCppRehash(
  bombs: GameState['bombs'],
  bucketCount: number,
): void {
  const groups = new Map<number, GameState['bombs']>();
  const firstSeen: number[] = [];
  for (const bomb of bombs) {
    const bucket = positiveModulo(bomb.id, bucketCount);
    let group = groups.get(bucket);
    if (!group) {
      group = [];
      groups.set(bucket, group);
      firstSeen.push(bucket);
    }
    group.unshift(bomb);
  }
  bombs.splice(
    0,
    bombs.length,
    ...firstSeen
      .toReversed()
      .flatMap((bucket) => groups.get(bucket) ?? []),
  );
}

function nextGcc8BucketCount(current: number): number {
  const bucketCounts = [3, 7, 17, 37, 79, 167, 337, 709, 1493, 3209];
  return bucketCounts.find((candidate) => candidate > current) ?? current * 2 + 1;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function pickupCppItem(
  state: GameState,
  player: PlayerState,
  item: Item,
): void {
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
      player.invincible = Math.max(
        player.invincible,
        state.config.invincibleTime,
      );
      break;
    case Item.Shield:
      player.shield = Math.max(player.shield, state.config.shieldTime);
      break;
    case Item.Speed:
      if (player.speed < 4) player.speed++;
      break;
    case Item.Gloves:
      player.gloves = true;
      break;
  }
  player.score += state.config.markPick;
}

function damageCppPlayer(
  state: GameState,
  victim: PlayerState,
  attacker?: PlayerState,
): boolean {
  if (!victim.alive || victim.invincible > 0) return false;
  if (victim.shield > 0) {
    victim.shield = 0;
    return false;
  }
  victim.hp--;
  if (victim.hp <= 0) {
    victim.alive = false;
    victim.score -= state.config.markDead;
    if (attacker && attacker.id !== victim.id) {
      attacker.score += state.config.markKill;
    }
    return true;
  }
  victim.shield = state.config.shieldTime;
  return false;
}

function flushCppBombs(state: GameState): void {
  const blockMeta = (
    state as unknown as { blockMeta: Map<number, BlockMeta> }
  ).blockMeta;
  const queue: number[] = [];
  for (const bomb of state.bombs) {
    bomb.timeLeft--;
    if (bomb.timeLeft <= 0) queue.push(bomb.id);
  }

  while (queue.length) {
    const bombId = queue.shift()!;
    const index = state.bombs.findIndex((bomb) => bomb.id === bombId);
    if (index < 0) continue;
    const bomb = state.bombs[index];
    const owner = state.players.find((player) => player.id === bomb.ownerId);
    state.bombs.splice(index, 1);
    if (state.cells[bomb.x][bomb.y].bombId === bomb.id) {
      state.cells[bomb.x][bomb.y].bombId = null;
    }
    if (owner) owner.bombNow = Math.max(0, owner.bombNow - 1);

    const explodeCell = (x: number, y: number): boolean => {
      const cell = state.cells[x][y];
      for (const playerId of [...cell.players]) {
        const victim = state.players.find((player) => player.id === playerId);
        if (!victim) continue;
        damageCppPlayer(
          state,
          victim,
          playerId === bomb.ownerId ? undefined : owner,
        );
      }
      if (cell.bombId != null) {
        queue.push(cell.bombId);
        return true;
      }
      if (cell.item !== Item.None) cell.item = Item.None;
      if (cell.block != null) {
        if (cell.block === 'mud') {
          let hiddenItem = Item.None;
          let blockId: number | null = null;
          for (const [id, block] of blockMeta) {
            if (block.x === x && block.y === y) {
              blockId = id;
              hiddenItem = block.hiddenItem;
              break;
            }
          }
          cell.block = null;
          if (blockId != null) blockMeta.delete(blockId);
          if (hiddenItem !== Item.None) cell.item = hiddenItem;
          if (owner) owner.score += state.config.markBombMud;
        }
        return true;
      }
      return false;
    };

    explodeCell(bomb.x, bomb.y);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as Array<[number, number]>) {
      for (let distance = 1; distance <= bomb.range; distance++) {
        const x = bomb.x + dx * distance;
        const y = bomb.y + dy * distance;
        if (!inBounds(state, x, y)) break;
        if (explodeCell(x, y)) break;
      }
    }
  }

  for (const player of state.players) {
    if (!player.alive && player.x >= 0) {
      state.cells[player.x][player.y].players.delete(player.id);
      player.x = -1;
      player.y = -1;
    }
  }
}

function checkCppGameOver(state: GameState): void {
  const alive = state.players.filter((player) => player.alive);
  if (alive.length <= 1 || state.round >= state.config.maxRound) {
    state.over = true;
    state.winnerIds = cppRolloutWinners(state);
  }
}

function inBounds(state: GameState, x: number, y: number): boolean {
  return (
    x >= 0 &&
    y >= 0 &&
    x < state.config.size &&
    y < state.config.size
  );
}
