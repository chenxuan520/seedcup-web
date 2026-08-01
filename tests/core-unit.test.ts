import { describe, expect, test } from 'vitest';

import {
  Action,
  BombStatus,
  Item,
  Rng,
  ServerRng,
  actionLegal,
  actionName,
  applyAction,
  applyActionBatch,
  bombAt,
  checkGameOver,
  cloneGame,
  createGame,
  dangerInfo,
  defaultConfig,
  deserializeGameState,
  inBounds,
  isWalkable,
  itemName,
  itemShort,
  flushRound,
  playerAt,
  runRound,
  scoreState,
  serializeGameState,
  type BlockMeta,
} from '../src/engine';
import {
  CppMt19937,
  CppMt19937_64,
  GlibcRand,
} from '../src/cpp-random';

describe('C++ random compatibility primitives', () => {
  test('glibc rand has deterministic default and zero seeds', () => {
    const defaultRng = new GlibcRand();
    const zeroRng = new GlibcRand(0);
    const expected = [
      1804289383,
      846930886,
      1681692777,
      1714636915,
      1957747793,
    ];
    expect(expected.map(() => defaultRng.next())).toEqual(expected);
    expect(expected.map(() => zeroRng.next())).toEqual(expected);
  });

  test('glibc shuffle consumes state and remains deterministic', () => {
    const left = [0, 1, 2, 3];
    const right = [0, 1, 2, 3];
    new GlibcRand(7).randomShuffle(left);
    new GlibcRand(7).randomShuffle(right);
    expect(left).toEqual(right);
    expect(left).not.toEqual([0, 1, 2, 3]);
  });

  test('mt19937 snapshot, clone, validation, and shuffle edges', () => {
    const rng = new CppMt19937(42);
    const prefix = Array.from({ length: 5 }, () => rng.nextUint32());
    expect(prefix).toEqual([
      1608637542,
      3421126067,
      4083286876,
      787846414,
      3143890026,
    ]);
    const clone = rng.clone();
    expect(clone.nextUint32()).toBe(rng.nextUint32());

    const snapshot = rng.snapshot();
    const next = rng.nextUint32();
    rng.restore(snapshot);
    expect(rng.nextUint32()).toBe(next);
    expect(() => rng.uniformInt(-1)).toThrow('invalid mt19937 range');
    expect(() =>
      rng.restore({ state: [1], index: 0 }),
    ).toThrow('invalid mt19937 snapshot');

    const none: number[] = [];
    const one = [1];
    const even = [0, 1, 2, 3];
    const odd = [0, 1, 2, 3, 4];
    rng.shuffle(none);
    rng.shuffle(one);
    rng.shuffle(even);
    rng.shuffle(odd);
    expect(none).toEqual([]);
    expect(one).toEqual([1]);
    expect([...even].sort()).toEqual([0, 1, 2, 3]);
    expect([...odd].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  test('mt19937_64 snapshot, clone, and validation', () => {
    const rng = new CppMt19937_64(42);
    expect(rng.nextUint64()).toBe(13930160852258120406n);
    const clone = rng.clone();
    expect(clone.nextUint64()).toBe(rng.nextUint64());
    const snapshot = rng.snapshot();
    const value = rng.nextUint64();
    rng.restore(snapshot);
    expect(rng.nextUint64()).toBe(value);
    expect(() => rng.uniformInt(-1)).toThrow('invalid mt19937_64 range');
    expect(() =>
      rng.restore({ state: ['1'], index: 0 }),
    ).toThrow('invalid mt19937_64 snapshot');
  });
});

describe('engine public behavior', () => {
  test('Rng and ServerRng snapshots, forks, and boundaries', () => {
    const rng = new Rng(123);
    expect(rng.int(0)).toBe(0);
    expect(rng.next()).toBeGreaterThanOrEqual(0);
    expect(rng.next()).toBeLessThan(1);
    expect(rng.probability()).toBeGreaterThanOrEqual(0);
    const fork = rng.fork(2);
    expect(fork).toBeInstanceOf(Rng);
    const values = [1, 2, 3, 4];
    rng.shuffle(values);
    expect([...values].sort()).toEqual([1, 2, 3, 4]);
    const snapshot = rng.snapshot();
    const next = rng.int(100);
    rng.restore(snapshot);
    expect(rng.int(100)).toBe(next);

    const server = new ServerRng(456);
    const serverClone = server.clone();
    expect(serverClone.probability.nextUint64()).toBe(
      server.probability.nextUint64(),
    );
    const serverSnapshot = server.snapshot();
    const potion = server.potion.nextUint64();
    server.restore(serverSnapshot);
    expect(server.potion.nextUint64()).toBe(potion);
  });

  test('state serialization, clone isolation, and lookup helpers', () => {
    const state = createGame(77, { ...defaultConfig, playerNum: 4 });
    const clone = cloneGame(state, 3);
    clone.players[0].score = 999;
    expect(state.players[0].score).not.toBe(999);

    const serialized = serializeGameState(state);
    const restored = deserializeGameState(serialized);
    expect(serializeGameState(restored)).toEqual(serialized);

    const self = state.players[0];
    expect(inBounds(state, self.x, self.y)).toBe(true);
    expect(inBounds(state, -1, self.y)).toBe(false);
    expect(playerAt(state, self.x, self.y)?.id).toBe(self.id);
    expect(playerAt(state, self.x, self.y, self.id)).toBeUndefined();
    expect(bombAt(state, null)).toBeUndefined();
    expect(isWalkable(state, self.x, self.y)).toBe(true);
    expect(isWalkable(state, -1, -1)).toBe(false);
  });

  test('danger map stops at walls and marks bomb range', () => {
    const state = createGame(1);
    for (const row of state.cells) {
      for (const cell of row) {
        cell.block = null;
        cell.bombId = null;
      }
    }
    state.bombs = [
      {
        id: 99,
        x: 6,
        y: 6,
        ownerId: state.players[0].id,
        range: 3,
        timeLeft: 2,
        status: BombStatus.Silent,
      },
    ];
    state.cells[6][6].bombId = 99;
    state.cells[6][8].block = 'wall';
    const info = dangerInfo(state);
    expect(info.danger[6][6]).toBe(true);
    expect(info.time[6][7]).toBe(2);
    expect(info.danger[6][8]).toBe(false);
    expect(info.danger[6][9]).toBe(false);
  });

  test('action legality covers silent, place, movement, blocks, and danger', () => {
    const state = createGame(2);
    for (const row of state.cells) {
      for (const cell of row) {
        cell.block = null;
        cell.bombId = null;
      }
    }
    const player = state.players[0];
    state.cells[player.x][player.y].players.delete(player.id);
    player.x = 6;
    player.y = 6;
    state.cells[6][6].players.add(player.id);
    expect(actionLegal(state, player, Action.Silent)).toBe(true);
    expect(actionLegal(state, player, Action.Place)).toBe(true);
    player.bombNow = player.bombMax;
    expect(actionLegal(state, player, Action.Place)).toBe(false);
    player.bombNow = 0;
    state.cells[6][5].block = 'wall';
    expect(actionLegal(state, player, Action.Left)).toBe(false);
    state.cells[6][5].block = null;
    expect(actionLegal(state, player, Action.Left)).toBe(true);

    state.bombs.push({
      id: 7,
      x: 4,
      y: 5,
      ownerId: player.id,
      range: 3,
      timeLeft: 1,
      status: BombStatus.Silent,
    });
    state.cells[4][5].bombId = 7;
    expect(actionLegal(state, player, Action.Left)).toBe(false);
    expect(actionLegal(state, player, Action.Left, false)).toBe(true);
    player.alive = false;
    expect(actionLegal(state, player, Action.Silent)).toBe(false);
  });

  test('applyAction handles invalid players, place limits, movement, and items', () => {
    const state = createGame(3);
    for (const row of state.cells) {
      for (const cell of row) {
        cell.block = null;
        cell.bombId = null;
        cell.item = Item.None;
      }
    }
    const player = state.players[0];
    state.cells[player.x][player.y].players.delete(player.id);
    player.x = 6;
    player.y = 6;
    state.cells[6][6].players.add(player.id);
    const events: Parameters<typeof applyAction>[3] = [];

    applyAction(state, -999, Action.Place, events);
    expect(state.bombs).toHaveLength(0);
    applyAction(state, player.id, Action.Place, events);
    expect(state.bombs).toHaveLength(1);
    applyAction(state, player.id, Action.Place, events);
    expect(state.bombs).toHaveLength(1);
    state.cells[6][6].bombId = null;
    state.bombs = [];
    player.bombNow = 0;

    const items = [
      Item.BombRange,
      Item.BombNum,
      Item.Rebirth,
      Item.Invincible,
      Item.Shield,
      Item.Speed,
      Item.Gloves,
    ];
    const positions = [
      [6, 5],
      [6, 4],
      [6, 3],
      [6, 2],
      [6, 1],
      [6, 0],
      [5, 0],
    ] as Array<[number, number]>;
    player.hp = 1;
    for (let index = 0; index < items.length; index++) {
      const [x, y] = positions[index];
      state.cells[x][y].item = items[index];
      applyAction(
        state,
        player.id,
        index === items.length - 1 ? Action.Up : Action.Left,
        events,
      );
    }
    expect(player.bombRange).toBeGreaterThan(defaultConfig.bombRange);
    expect(player.bombMax).toBeGreaterThan(defaultConfig.bombNum);
    expect(player.hp).toBeGreaterThan(1);
    expect(player.invincible).toBeGreaterThan(0);
    expect(player.shield).toBeGreaterThan(0);
    expect(player.speed).toBeGreaterThan(defaultConfig.playerSpeed);
    expect(player.gloves).toBe(true);
  });

  test('game-over and score branches', () => {
    const state = createGame(4);
    const [first, second] = state.players;
    second.alive = false;
    checkGameOver(state);
    expect(state.over).toBe(true);
    expect(state.winnerIds).toEqual([first.id]);

    const draw = createGame(5);
    draw.players[0].score = 10;
    draw.players[1].score = 10;
    draw.round = draw.config.maxRound + 1;
    checkGameOver(draw);
    expect(draw.winnerIds).toHaveLength(2);
    expect(scoreState(draw, -1)).toBe(-100000);
    expect(scoreState(draw, draw.players[0].id)).toBeTypeOf('number');
  });

  test('public labels cover every enum and unknown fallback', () => {
    expect(itemName(Item.None)).toBe('无');
    expect(itemShort(Item.None)).toBe('');
    for (let item = Item.None; item <= Item.Gloves; item++) {
      expect(itemName(item)).toBeTruthy();
      if (item !== Item.None) expect(itemShort(item)).toBeTruthy();
    }
    for (let action = Action.Silent; action <= Action.Place; action++) {
      expect(actionName(action)).toBeTruthy();
    }
    expect(itemName(99 as Item)).toBe('无');
    expect(itemShort(99 as Item)).toBe('');
    expect(actionName(99 as Action)).toBe('静止');
  });

  test('hidden block metadata survives direct inspection', () => {
    const state = createGame(6);
    const meta = (
      state as unknown as { blockMeta: Map<number, BlockMeta> }
    ).blockMeta;
    expect(meta.size).toBeGreaterThan(0);
    expect([...meta.values()].some((block) => block.removable)).toBe(true);
  });

  test('gloves push bombs and bomb movement stops at obstacles', () => {
    const state = emptyState(10);
    const player = state.players[0];
    player.x = 6;
    player.y = 6;
    player.gloves = true;
    state.cells[6][6].players.add(player.id);
    state.bombs.push({
      id: 1,
      x: 6,
      y: 5,
      range: 1,
      timeLeft: 3,
      ownerId: player.id,
      status: BombStatus.Silent,
    });
    state.cells[6][5].bombId = 1;
    applyAction(state, player.id, Action.Left);
    expect(state.bombs[0].status).toBe(BombStatus.Left);
    flushRound(state);
    expect(state.bombs[0].y).toBe(4);

    state.cells[6][3].block = 'wall';
    flushRound(state);
    expect(state.bombs[0].y).toBe(4);
    expect(state.bombs[0].status).toBe(BombStatus.Silent);
  });

  test('invincible collision covers shields, damage, kills, and mutual safety', () => {
    const state = emptyState(11);
    const [attacker, victim] = state.players;
    attacker.x = 6;
    attacker.y = 5;
    victim.x = 6;
    victim.y = 6;
    attacker.invincible = 5;
    victim.shield = 2;
    state.cells[6][5].players.add(attacker.id);
    state.cells[6][6].players.add(victim.id);

    applyAction(state, attacker.id, Action.Right);
    expect(victim.alive).toBe(true);
    expect(victim.shield).toBe(0);

    attacker.x = 6;
    attacker.y = 5;
    state.cells[6][6].players.delete(attacker.id);
    state.cells[6][5].players.add(attacker.id);
    victim.hp = 1;
    applyAction(state, attacker.id, Action.Right);
    expect(victim.alive).toBe(false);
    expect(attacker.score).toBe(state.config.markKill);

    const mutual = emptyState(12);
    mutual.players[0].invincible = 3;
    mutual.players[1].invincible = 2;
    mutual.players[0].x = 6;
    mutual.players[0].y = 5;
    mutual.players[1].x = 6;
    mutual.players[1].y = 6;
    mutual.cells[6][5].players.add(mutual.players[0].id);
    mutual.cells[6][6].players.add(mutual.players[1].id);
    applyAction(mutual, mutual.players[0].id, Action.Right);
    expect(mutual.players.every((player) => player.alive)).toBe(true);
  });

  test('chain explosions destroy mud, reveal items, kill, and clean players', () => {
    const state = emptyState(13);
    const [owner, victim] = state.players;
    owner.x = 0;
    owner.y = 0;
    victim.x = 6;
    victim.y = 8;
    state.cells[0][0].players.add(owner.id);
    state.cells[6][8].players.add(victim.id);
    state.bombs = [
      {
        id: 1,
        x: 6,
        y: 6,
        range: 3,
        timeLeft: 0,
        ownerId: owner.id,
        status: BombStatus.Silent,
      },
      {
        id: 2,
        x: 6,
        y: 7,
        range: 2,
        timeLeft: 3,
        ownerId: owner.id,
        status: BombStatus.Silent,
      },
    ];
    state.cells[6][6].bombId = 1;
    state.cells[6][7].bombId = 2;
    state.cells[6][9].block = 'mud';
    const metadata = (
      state as unknown as { blockMeta: Map<number, BlockMeta> }
    ).blockMeta;
    metadata.set(999, {
      id: 999,
      x: 6,
      y: 9,
      removable: true,
      hiddenItem: Item.Gloves,
    });
    const events: Parameters<typeof flushRound>[1] = [];
    flushRound(state, events);
    expect(state.bombs).toHaveLength(0);
    expect(victim.alive).toBe(false);
    expect(state.cells[6][8].players.has(victim.id)).toBe(false);
    expect(state.cells[6][9].block).toBeNull();
    expect(state.cells[6][9].item).toBe(Item.Gloves);
    expect(events.some((event) => event.kind === 'explode')).toBe(true);
    expect(events.some((event) => event.kind === 'damage')).toBe(true);
  });

  test('action batches enforce speed and runRound consumes human queues', () => {
    const state = emptyState(14);
    const player = state.players[0];
    player.x = 6;
    player.y = 6;
    player.speed = 2;
    state.cells[6][6].players.add(player.id);
    applyActionBatch(state, player.id, [
      Action.Left,
      Action.Left,
      Action.Left,
    ]);
    expect(player.y).toBe(4);
    applyActionBatch(state, player.id, [Action.Left]);
    expect(player.y).toBe(4);

    const queued = new Map([[player.id, [Action.Up, Action.Right]]]);
    const bots = new Map([
      [
        state.players[1].id,
        {
          label: 'silent',
          chooseAction: () => Action.Silent,
        },
      ],
    ]);
    const events = runRound(state, bots, queued);
    expect(state.round).toBe(1);
    expect(events.some((event) => event.kind === 'round')).toBe(true);
    expect(queued.get(player.id)).toHaveLength(0);
    expect(runRound({ ...state, over: true }, bots)).toEqual([]);
  });
});

function emptyState(seed: number) {
  const state = createGame(seed);
  for (const row of state.cells) {
    for (const cell of row) {
      cell.block = null;
      cell.item = Item.None;
      cell.bombId = null;
      cell.players.clear();
    }
  }
  state.bombs = [];
  state.acceptedActions = new Map();
  (
    state as unknown as { blockMeta: Map<number, BlockMeta> }
  ).blockMeta = new Map();
  return state;
}
