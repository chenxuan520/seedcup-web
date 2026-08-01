import { describe, expect, test } from 'vitest';

import {
  Action,
  BombStatus,
  Item,
  actionLegal,
  applyAction,
  applyActionBatch,
  bombAt,
  checkGameOver,
  cloneGame,
  cppGameMsgPlayerOrder,
  createCppGameSimGame,
  createGame,
  defaultConfig,
  deserializeGameState,
  flushRound,
  runRound,
  scoreState,
  serializeGameState,
  simulateClientAction,
  synchronizeServerIdCounters,
  type BlockMeta,
  type BotController,
  type GameState,
} from '../src/engine';

describe('engine branch completion', () => {
  test('default constructors and generated server/gamesim modes', () => {
    const server = createGame();
    const gameSim = createCppGameSimGame();
    expect(server.config.size).toBe(13);
    expect(gameSim.config.size).toBe(13);
    expect(server.serverRng).toBeDefined();
    expect(gameSim.serverRng).toBeUndefined();
    synchronizeServerIdCounters(server);
    synchronizeServerIdCounters(gameSim);
  });

  test('deserialize accepts legacy optional fields', () => {
    const source = serializeGameState(createGame(500));
    delete source.serverRngState;
    delete source.bombBucketCount;
    for (const row of source.cells) {
      for (const cell of row) {
        delete cell.lastBombRound;
        delete cell.playerBucketCount;
      }
    }
    const state = deserializeGameState(source);
    expect(state.serverRng).toBeUndefined();
    expect(state.bombBucketCount).toBeGreaterThan(0);
    expect(state.cells[0][0].lastBombRound).toBe(-1);
  });

  test('actionLegal covers gloves, missing bombs, edges, and danger override', () => {
    const state = openState(501);
    const player = placePlayer(state, 0, 0, 0);
    player.gloves = true;
    state.cells[0][1].bombId = 999;
    expect(actionLegal(state, player, Action.Right)).toBe(false);
    state.bombs.push({
      id: 999,
      x: 0,
      y: 1,
      range: 1,
      timeLeft: 2,
      ownerId: player.id,
      status: BombStatus.Right,
    });
    expect(actionLegal(state, player, Action.Right)).toBe(false);
    state.bombs[0].status = BombStatus.Silent;
    expect(actionLegal(state, player, Action.Right)).toBe(true);
    expect(actionLegal(state, player, Action.Up)).toBe(false);
    state.cells[0][0].block = 'wall';
    expect(actionLegal(state, player, Action.Place)).toBe(false);
  });

  test('applyAction rejects over/dead/blocked/out-of-bounds and handles nonlethal damage', () => {
    const state = openState(502);
    const first = placePlayer(state, 0, 0, 0);
    const second = placePlayer(state, 1, 0, 1);
    first.hp = 2;
    second.invincible = 4;
    applyAction(state, first.id, Action.Left);
    expect(first.x).toBe(0);
    state.cells[1][0].block = 'wall';
    applyAction(state, first.id, Action.Down);
    expect(first.x).toBe(0);
    applyAction(state, first.id, Action.Right);
    expect(first.hp).toBe(1);
    expect(first.shield).toBe(state.config.shieldTime);
    first.alive = false;
    applyAction(state, first.id, Action.Place);
    state.over = true;
    applyAction(state, second.id, Action.Place);
    expect(state.bombs).toHaveLength(0);
  });

  test('applyAction place rejects capacity and occupied cells', () => {
    const state = openState(503);
    const player = placePlayer(state, 0, 4, 4);
    player.bombNow = player.bombMax;
    applyAction(state, player.id, Action.Place);
    expect(state.bombs).toHaveLength(0);
    player.bombNow = 0;
    state.cells[4][4].bombId = 55;
    applyAction(state, player.id, Action.Place);
    state.cells[4][4].bombId = null;
    state.cells[4][4].block = 'wall';
    applyAction(state, player.id, Action.Place);
    expect(state.bombs).toHaveLength(0);
  });

  test('action batches and rounds reject over/dead/missing controllers', () => {
    const state = openState(504);
    const first = placePlayer(state, 0, 6, 6);
    const second = placePlayer(state, 1, 12, 12);
    first.alive = false;
    applyActionBatch(state, first.id, [Action.Left]);
    applyActionBatch(state, -1, [Action.Left]);
    state.over = true;
    applyActionBatch(state, second.id, [Action.Left]);
    flushRound(state);
    expect(state.round).toBe(0);

    state.over = false;
    first.alive = true;
    const bots = new Map<number, BotController>();
    const queue = new Map([[first.id, [Action.Silent]]]);
    runRound(state, bots, queue);
    expect(state.round).toBe(1);
  });

  test('simulateClientAction covers place, silent, edges, blocks, and every item', () => {
    const state = openState(505);
    const player = placePlayer(state, 0, 6, 6);
    simulateClientAction(state, -1, Action.Left);
    simulateClientAction(state, player.id, Action.Silent);
    simulateClientAction(state, player.id, Action.Place);
    expect(state.bombs).toHaveLength(1);
    simulateClientAction(state, player.id, Action.Place);
    state.bombs = [];
    state.cells[6][6].bombId = null;
    state.cells[6][5].block = 'wall';
    simulateClientAction(state, player.id, Action.Left);
    state.cells[6][5].block = null;

    for (const item of [
      Item.BombNum,
      Item.BombRange,
      Item.Invincible,
      Item.Shield,
      Item.Rebirth,
      Item.Speed,
      Item.Gloves,
    ]) {
      placePlayer(state, 0, 6, 6);
      state.cells[6][5].item = item;
      simulateClientAction(state, player.id, Action.Left);
    }
    expect(player.gloves).toBe(true);
  });

  test('moving bombs stop at every obstacle and outside the map', () => {
    for (const obstacle of ['bomb', 'block', 'item', 'player'] as const) {
      const state = openState(510 + obstacle.length);
      const bomb = {
        id: 1,
        x: 6,
        y: 6,
        range: 1,
        timeLeft: 3,
        ownerId: state.players[0].id,
        status: BombStatus.Right,
      };
      state.bombs = [bomb];
      state.cells[6][6].bombId = 1;
      if (obstacle === 'bomb') state.cells[6][7].bombId = 2;
      if (obstacle === 'block') state.cells[6][7].block = 'wall';
      if (obstacle === 'item') state.cells[6][7].item = Item.Speed;
      if (obstacle === 'player') state.cells[6][7].players.add(999);
      flushRound(state);
      expect(bomb.y).toBe(6);
      expect(bomb.status).toBe(BombStatus.Silent);
    }
    const edge = openState(520);
    edge.bombs = [{
      id: 3,
      x: 0,
      y: 0,
      range: 1,
      timeLeft: 3,
      ownerId: edge.players[0].id,
      status: BombStatus.Up,
    }];
    edge.cells[0][0].bombId = 3;
    flushRound(edge);
    expect(edge.bombs[0].status).toBe(BombStatus.Silent);
  });

  test('explosions cover missing bombs, items, walls, no owner, shield, and invincible', () => {
    const state = openState(521);
    const shielded = placePlayer(state, 0, 6, 5);
    const invincible = placePlayer(state, 1, 6, 7);
    shielded.shield = 2;
    invincible.invincible = 2;
    state.cells[6][8].item = Item.Speed;
    state.cells[6][9].block = 'wall';
    state.bombs = [{
      id: 10,
      x: 6,
      y: 6,
      range: 4,
      timeLeft: 0,
      ownerId: 999,
      status: BombStatus.Silent,
    }];
    state.cells[6][6].bombId = 10;
    flushRound(state);
    expect(shielded.alive).toBe(true);
    expect(shielded.shield).toBe(0);
    expect(invincible.alive).toBe(true);
    expect(state.cells[6][8].item).toBe(Item.None);
    expect(state.cells[6][9].block).toBe('wall');
  });

  test('game over covers no survivors, alive survivor, score replacement and ties', () => {
    const solo = openState(522);
    solo.players[1].alive = false;
    const events: Parameters<typeof checkGameOver>[1] = [];
    checkGameOver(solo, events);
    expect(solo.winnerIds).toEqual([solo.players[0].id]);

    const none = openState(523);
    none.players[0].alive = false;
    none.players[1].alive = false;
    none.players[0].score = 1;
    none.players[1].score = 2;
    checkGameOver(none);
    expect(none.winnerIds).toEqual([none.players[1].id]);

    const tie = openState(524);
    tie.round = tie.config.maxRound + 1;
    tie.players[0].score = 3;
    tie.players[1].score = 3;
    checkGameOver(tie);
    expect(tie.winnerIds).toHaveLength(2);
  });

  test('scoreState covers every survival bonus and opponent branch', () => {
    const state = openState(525);
    const [first, second] = state.players;
    first.score = 500;
    first.hp = 2;
    first.bombMax = 3;
    first.bombRange = 2;
    first.speed = 3;
    first.gloves = true;
    first.shield = 2;
    first.invincible = 2;
    second.score = 100;
    second.hp = 1;
    expect(scoreState(state, first.id)).toBeGreaterThan(0);
    first.alive = false;
    expect(scoreState(state, first.id)).toBeLessThan(0);
    first.alive = true;
    second.alive = false;
    expect(scoreState(state, first.id)).toBeGreaterThan(50_000);
    state.players.splice(1, 1);
    expect(scoreState(state, first.id)).toBeGreaterThan(0);
    expect(scoreState(state, -1)).toBe(-100000);
  });

  test('miscellaneous helper and short-circuit branches', () => {
    const state = openState(526);
    const first = placePlayer(state, 0, 6, 6);
    const second = placePlayer(state, 1, 6, 6);
    second.alive = false;
    expect(cppGameMsgPlayerOrder(state)).toContain(first.id);
    expect(cppGameMsgPlayerOrder(state)).not.toContain(second.id);

    state.bombs.push({
      id: 88,
      x: 5,
      y: 5,
      range: 1,
      timeLeft: 2,
      ownerId: first.id,
      status: BombStatus.Right,
    });
    state.cells[5][5].bombId = 88;
    expect(bombAt(state, 88)?.id).toBe(88);
    first.gloves = true;
    first.x = 5;
    first.y = 4;
    state.cells[5][4].players.add(first.id);
    applyAction(state, first.id, Action.Right);
    expect(state.bombs[0].status).toBe(BombStatus.Right);

    first.hp = state.config.playerMaxHp;
    state.cells[5][3].item = Item.Rebirth;
    applyAction(state, first.id, Action.Left);
    expect(first.hp).toBe(state.config.playerMaxHp);

    const cloned = cloneGame(state);
    expect(cloned.seed).toBe(state.seed);
    first.shield = 0;
    first.invincible = 0;
    flushRound(state);
    expect(first.shield).toBe(0);
    expect(first.invincible).toBe(0);
  });
});

function openState(seed: number): GameState {
  const state = createGame(seed, { ...defaultConfig, maxRound: 20 });
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
  (state as unknown as { blockMeta: Map<number, BlockMeta> }).blockMeta =
    new Map();
  return state;
}

function placePlayer(
  state: GameState,
  index: number,
  x: number,
  y: number,
) {
  const player = state.players[index];
  for (const row of state.cells) {
    for (const cell of row) cell.players.delete(player.id);
  }
  player.x = x;
  player.y = y;
  player.alive = true;
  state.cells[x][y].players.add(player.id);
  return player;
}
