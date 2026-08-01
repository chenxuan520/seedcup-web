import { describe, expect, test } from 'vitest';

import {
  Action,
  BombStatus,
  Item,
  createGame,
  defaultConfig,
  type GameState,
} from '../src/engine';
import {
  HybridSearchBot,
  PureNnBot,
  RuleBot,
  SearchBot,
  isPureNnActionLegal,
} from '../src/bots';
import {
  cppRolloutScore,
  cppRolloutWinners,
  createCppRolloutState,
  initializeCppGameSimState,
  stepCppRollout,
} from '../src/cpp-game-sim';
import {
  debugPredictFromFixture,
  extractFeatures,
  loadPureNnPolicyFromText,
} from '../src/rnn';

describe('bot edge matrix', () => {
  test('default constructors, move counts, and every item score branch', () => {
    const state = openState(99);
    const easy = new RuleBot();
    const search = new SearchBot();
    easy.reset(state.players[0].id, state);
    search.reset(state.players[0].id, state);
    expect(easy.movesPerTurn(state.players[0])).toBe(1);
    expect(new RuleBot(true).movesPerTurn(state.players[0])).toBe(
      state.players[0].speed,
    );
    expect(
      search.debugScoreOper(state, state.players[0].id, Action.Silent),
    ).toBeGreaterThanOrEqual(0);

    for (const hard of [false, true]) {
      for (const item of [
        Item.None,
        Item.BombRange,
        Item.BombNum,
        Item.Rebirth,
        Item.Invincible,
        Item.Shield,
        Item.Speed,
        Item.Gloves,
      ]) {
        const itemState = openState(1000 + Number(item) + Number(hard) * 20);
        movePlayer(itemState, 0, 6, 6);
        itemState.cells[6][5].item = item;
        const bot = new RuleBot(hard, 0);
        bot.reset(itemState.players[0].id, itemState);
        expect(
          bot.chooseAction(itemState, itemState.players[0].id),
        ).toBeTypeOf('number');
      }
    }
  });

  test('rule bots cover every dynamic move order and missing players', () => {
    for (const mode of [1, 2, 3, 4]) {
      for (const corner of [
        [0, 0],
        [0, 12],
        [12, 0],
        [12, 12],
      ] as Array<[number, number]>) {
        const state = openState(100 + mode + corner[0] + corner[1]);
        movePlayer(state, 0, corner[0], corner[1]);
        const bot = new RuleBot(true, mode);
        bot.reset(state.players[0].id, state);
        expect(bot.chooseAction(state, state.players[0].id)).toBeTypeOf(
          'number',
        );
      }
    }
    const state = openState(200);
    const bot = new RuleBot(true, 4);
    bot.reset(-1, state);
    expect(bot.chooseAction(state, -1)).toBe(Action.Silent);
    state.players[0].alive = false;
    expect(bot.chooseAction(state, state.players[0].id)).toBe(Action.Silent);
  });

  test('rule bot handles invincible danger, glove bombs, items, and blocked paths', () => {
    const state = openState(201);
    movePlayer(state, 0, 6, 6);
    movePlayer(state, 1, 6, 8);
    state.players[1].invincible = 5;
    state.players[1].speed = 2;
    state.cells[6][5].block = 'wall';
    state.cells[5][6].block = 'wall';
    state.cells[7][6].block = 'wall';
    state.players[0].gloves = true;
    state.bombs.push({
      id: 10,
      x: 6,
      y: 7,
      range: 2,
      timeLeft: 1,
      ownerId: state.players[1].id,
      status: BombStatus.Silent,
    });
    state.cells[6][7].bombId = 10;
    const bot = new RuleBot(false, 0);
    bot.reset(state.players[0].id, state);
    expect(bot.chooseAction(state, state.players[0].id)).toBeTypeOf('number');

    state.cells[6][5].block = null;
    state.cells[6][5].item = Item.Invincible;
    state.cells[6][7].bombId = null;
    state.bombs = [];
    expect(bot.chooseAction(state, state.players[0].id)).toBeTypeOf('number');

    state.players[1].invincible = 0;
    expect(bot.chooseAction(state, state.players[0].id)).toBeTypeOf('number');
    state.players[1].invincible = 2;
    state.players[0].invincible = 3;
    expect(bot.chooseAction(state, state.players[0].id)).toBeTypeOf('number');
  });

  test('glove escape probes all four push directions and blockers', () => {
    const directions = [
      [Action.Up, -1, 0],
      [Action.Down, 1, 0],
      [Action.Left, 0, -1],
      [Action.Right, 0, 1],
    ] as const;
    for (const [, dx, dy] of directions) {
      const state = openState(250 + dx * 3 + dy);
      movePlayer(state, 0, 6, 6);
      state.players[0].gloves = true;
      const bx = 6 + dx;
      const by = 6 + dy;
      state.bombs = [{
        id: 40,
        x: bx,
        y: by,
        range: 4,
        timeLeft: 1,
        ownerId: state.players[1].id,
        status: BombStatus.Silent,
      }];
      state.cells[bx][by].bombId = 40;
      const bot = new RuleBot(false, 0);
      bot.reset(state.players[0].id, state);
      expect(bot.chooseAction(state, state.players[0].id)).toBeTypeOf(
        'number',
      );
      const nx = bx + dx;
      const ny = by + dy;
      if (nx >= 0 && ny >= 0 && nx < 13 && ny < 13) {
        state.cells[nx][ny].item = Item.Speed;
        expect(bot.chooseAction(state, state.players[0].id)).toBeTypeOf(
          'number',
        );
      }
    }
  });

  test('search covers danger, no opponent, illegal action, and debug snapshots', () => {
    const state = openState(202);
    movePlayer(state, 0, 6, 6);
    movePlayer(state, 1, 12, 12);
    const search = new SearchBot(2, 1, 0.01);
    search.reset(state.players[0].id, state);
    expect(search.debugDecision()).toBeNull();
    expect(
      search.debugScoreOper(state, state.players[0].id, Action.Left, 1, 1),
    ).toBeGreaterThanOrEqual(0);
    state.cells[6][5].block = 'wall';
    expect(
      search.debugScoreOper(state, state.players[0].id, Action.Left, 1, 1),
    ).toBe(-1);

    state.bombs.push({
      id: 20,
      x: 6,
      y: 6,
      range: 1,
      timeLeft: 1,
      ownerId: state.players[1].id,
      status: BombStatus.Silent,
    });
    state.cells[6][6].bombId = 20;
    expect(search.chooseAction(state, state.players[0].id)).toBeTypeOf(
      'number',
    );
    expect(search.debugDecision()?.scores).toEqual([]);

    const solo = openState(203);
    solo.players.splice(1, 1);
    const soloSearch = new SearchBot(1, 1, 0);
    soloSearch.reset(solo.players[0].id, solo);
    expect(
      soloSearch.debugScoreOper(
        solo,
        solo.players[0].id,
        Action.Silent,
        1,
        1,
      ),
    ).toBeGreaterThanOrEqual(0);

    const missing = new SearchBot();
    missing.reset(-1, state);
    expect(missing.chooseAction(state, -1)).toBe(Action.Silent);
    expect(
      missing.debugScoreOper(state, -1, Action.Silent),
    ).toBe(-1);
  });

  test('pure and hybrid NN cover absent policy, absent player, and legal fallbacks', () => {
    const state = openState(204);
    const noPolicy = new PureNnBot(null);
    noPolicy.reset(state.players[0].id, state);
    expect(noPolicy.chooseAction(state, state.players[0].id)).toBe(
      Action.Silent,
    );
    const policy = loadPureNnPolicyFromText(minimalModelText());
    const pure = new PureNnBot(policy);
    pure.reset(state.players[0].id, state);
    expect(pure.chooseAction(state, -1)).toBe(Action.Silent);
    expect(pure.chooseAction(state, state.players[0].id)).toBeTypeOf('number');
    const hybrid = new HybridSearchBot(policy);
    hybrid.reset(state.players[0].id, state);
    expect(hybrid.chooseAction(state, state.players[0].id)).toBeTypeOf(
      'number',
    );

    const player = state.players[0];
    expect(isPureNnActionLegal(state, player, Action.Silent)).toBe(true);
    player.bombNow = player.bombMax;
    expect(isPureNnActionLegal(state, player, Action.Place)).toBe(false);
    player.alive = false;
    expect(isPureNnActionLegal(state, player, Action.Left)).toBe(false);

    const solo = openState(205);
    solo.players.splice(1, 1);
    pure.reset(solo.players[0].id, solo);
    expect(pure.chooseAction(solo, solo.players[0].id)).toBeTypeOf(
      'number',
    );
  });
});

describe('RNN feature edge matrix', () => {
  test('features cover missing self, non-13 maps, missing enemy, boundaries, and rays', () => {
    const state = openState(300);
    expect(extractFeatures(state, -1, [0, 0], [12, 12])).toEqual(
      Array(1426).fill(0),
    );
    const small = createGame(1, { ...defaultConfig, size: 11 });
    expect(
      extractFeatures(small, small.players[0].id, [0, 0], [10, 10]),
    ).toEqual(Array(1426).fill(0));

    state.players.splice(1, 1);
    movePlayer(state, 0, 0, 0);
    state.players[0].gloves = true;
    state.players[0].invincible = 2;
    state.players[0].shield = 2;
    state.cells[0][1].item = Item.Speed;
    state.cells[1][0].block = 'mud';
    state.bombs.push({
      id: 30,
      x: 0,
      y: 2,
      range: 2,
      timeLeft: 0,
      ownerId: state.players[0].id,
      status: BombStatus.Silent,
    });
    state.cells[0][2].bombId = 30;
    const features = extractFeatures(state, state.players[0].id, [0, 0], [
      12,
      12,
    ]);
    expect(features).toHaveLength(1426);
    expect(features.some((value) => value !== 0)).toBe(true);
  });

  test('policy history, bomb tracking, malformed model, and empty fixture paths', () => {
    expect(() => loadPureNnPolicyFromText('BAD 1 1')).toThrow(
      'unsupported model',
    );
    const policy = loadPureNnPolicyFromText(minimalModelText());
    expect(policy.debugStep()).toBeNull();
    policy.commit(Action.Place, true);
    policy.commit(Action.Left, false);
    expect(policy.historyFeatures(-10)[14]).toBe(0);
    expect(policy.historyFeatures(99)[14]).toBe(1);
    const state = openState(301);
    state.bombs.push({
      id: 31,
      x: 6,
      y: 6,
      range: 1,
      timeLeft: 3,
      ownerId: state.players[0].id,
      status: BombStatus.Silent,
    });
    policy.predict(state, state.players[0].id, [0, 0], [12, 12]);
    state.round++;
    state.bombs = [];
    policy.predict(state, state.players[0].id, [0, 0], [12, 12]);
    expect(policy.debugStep()).not.toBeNull();

    const empty = openState(302);
    empty.players = [];
    const debug = debugPredictFromFixture(empty, minimalModelText());
    expect(debug.actionIdx).toBeGreaterThanOrEqual(0);
  });
});

describe('C++ rollout edge matrix', () => {
  test('scores, winners, invalid actions, items, collisions, and terminal states', () => {
    const source = openState(400);
    movePlayer(source, 0, 6, 6);
    movePlayer(source, 1, 6, 8);
    source.cells[6][7].item = Item.BombRange;
    const state = createCppRolloutState(source, new Map(), 123, 3);
    initializeCppGameSimState(state, 3);
    stepCppRollout(
      state,
      new Map([
        [state.players[0].id, [Action.Right, Action.Place]],
        [state.players[1].id, [Action.Left, Action.Place]],
      ]),
    );
    expect(cppRolloutScore(state, state.players[0].id)).toBeTypeOf('number');
    expect(cppRolloutScore(state, -1)).toBe(0);
    expect(cppRolloutWinners(state).length).toBeGreaterThan(0);
    stepCppRollout(state, new Map());
    stepCppRollout(state, new Map());
    expect(state.over).toBe(true);
    const round = state.round;
    stepCppRollout(state, new Map());
    expect(state.round).toBe(round);
  });

  test('rollout item matrix and action rejection branches', () => {
    const state = createCppRolloutState(openState(401), new Map(), 1, 20);
    initializeCppGameSimState(state, 20);
    const first = state.players[0];
    first.x = 6;
    first.y = 6;
    state.cells[6][6].players.add(first.id);
    first.bombNow = first.bombMax;
    stepCppRollout(state, new Map([[first.id, [Action.Place]]]));
    expect(state.bombs).toHaveLength(0);

    first.bombNow = 0;
    state.cells[6][5].block = 'wall';
    stepCppRollout(state, new Map([[first.id, [Action.Left]]]));
    expect(first.y).toBe(6);
    state.cells[6][5].block = null;

    for (const item of [
      Item.BombRange,
      Item.BombNum,
      Item.Rebirth,
      Item.Invincible,
      Item.Shield,
      Item.Speed,
      Item.Gloves,
    ]) {
      first.x = 6;
      first.y = 6;
      for (const row of state.cells) {
        for (const cell of row) cell.players.delete(first.id);
      }
      state.cells[6][6].players.add(first.id);
      state.cells[6][5].item = item;
      stepCppRollout(state, new Map([[first.id, [Action.Left]]]));
      state.round = 0;
      state.over = false;
    }
    expect(first.gloves).toBe(true);
    expect(first.speed).toBeLessThanOrEqual(4);
  });

  test('rollout damage covers invincible, shield, nonlethal, death and attacker scoring', () => {
    const source = openState(402);
    movePlayer(source, 0, 6, 5);
    movePlayer(source, 1, 6, 6);
    const state = createCppRolloutState(source, new Map(), 2, 20);
    initializeCppGameSimState(state, 20);
    const [first, second] = state.players;

    first.invincible = 3;
    second.shield = 2;
    stepCppRollout(state, new Map([[first.id, [Action.Right]]]));
    expect(second.shield).toBe(0);

    resetMeet(state, first.id, second.id);
    second.hp = 2;
    stepCppRollout(state, new Map([[first.id, [Action.Right]]]));
    expect(second.hp).toBe(1);
    expect(second.shield).toBeGreaterThan(0);

    resetMeet(state, first.id, second.id);
    second.shield = 0;
    second.hp = 1;
    stepCppRollout(state, new Map([[first.id, [Action.Right]]]));
    expect(second.alive).toBe(false);
    expect(first.score).toBeGreaterThan(0);

    const protectedState = createCppRolloutState(source, new Map(), 3, 20);
    initializeCppGameSimState(protectedState, 20);
    protectedState.players[1].invincible = 3;
    protectedState.bombs.push({
      id: 99,
      x: protectedState.players[1].x,
      y: protectedState.players[1].y,
      range: 1,
      timeLeft: 1,
      ownerId: protectedState.players[0].id,
      status: BombStatus.Silent,
    });
    protectedState.cells[protectedState.players[1].x][
      protectedState.players[1].y
    ].bombId = 99;
    stepCppRollout(protectedState, new Map());
    expect(protectedState.players[1].alive).toBe(true);
  });

  test('rollout explosions cover chain bombs, items, mud, walls and missing owners', () => {
    const source = openState(403);
    const state = createCppRolloutState(source, new Map(), 4, 20);
    initializeCppGameSimState(state, 20);
    state.bombs = [
      {
        id: 1,
        x: 6,
        y: 6,
        range: 3,
        timeLeft: 1,
        ownerId: 999,
        status: BombStatus.Silent,
      },
      {
        id: 2,
        x: 6,
        y: 7,
        range: 2,
        timeLeft: 3,
        ownerId: state.players[0].id,
        status: BombStatus.Silent,
      },
    ];
    state.cells[6][6].bombId = 1;
    state.cells[6][7].bombId = 2;
    state.cells[6][8].item = Item.Speed;
    state.cells[6][9].block = 'mud';
    state.cells[6][10].block = 'wall';
    const metadata = (state as unknown as {
      blockMeta: Map<number, {
        id: number;
        x: number;
        y: number;
        removable: boolean;
        hiddenItem: Item;
      }>;
    }).blockMeta;
    metadata.set(800, {
      id: 800,
      x: 6,
      y: 9,
      removable: true,
      hiddenItem: Item.Gloves,
    });
    stepCppRollout(state, new Map());
    expect(state.cells[6][8].item).toBe(Item.None);
    expect(state.cells[6][9].block).toBeNull();
    expect(state.cells[6][9].item).toBe(Item.Gloves);
    expect(state.cells[6][10].block).toBe('wall');
  });

  test('rollout scores and winners cover alive, dead, bonuses, ties, and absent opponents', () => {
    const state = createCppRolloutState(openState(404), new Map(), 5, 20);
    const [first, second] = state.players;
    first.score = 100;
    first.hp = 2;
    first.bombMax = 3;
    first.bombRange = 2;
    first.gloves = true;
    first.shield = 2;
    first.invincible = 2;
    second.score = 50;
    second.hp = 1;
    expect(cppRolloutScore(state, first.id)).toBeGreaterThan(0);

    first.alive = false;
    expect(cppRolloutScore(state, first.id)).toBeLessThan(0);
    first.alive = true;
    second.alive = false;
    expect(cppRolloutScore(state, first.id)).toBeGreaterThan(50_000);
    expect(cppRolloutWinners(state)).toEqual([first.id]);

    second.alive = true;
    first.score = 10;
    second.score = 10;
    expect(cppRolloutWinners(state)).toHaveLength(2);
    second.score = 11;
    expect(cppRolloutWinners(state)).toEqual([second.id]);
    state.players.splice(1, 1);
    expect(cppRolloutScore(state, first.id)).toBe(0);
  });

  test('rollout reverse invincible collision and shield branches', () => {
    const source = openState(405);
    movePlayer(source, 0, 6, 5);
    movePlayer(source, 1, 6, 6);
    const state = createCppRolloutState(source, new Map(), 6, 20);
    const [first, second] = state.players;
    second.invincible = 3;
    first.shield = 2;
    stepCppRollout(state, new Map([[first.id, [Action.Right]]]));
    expect(first.shield).toBe(0);
    resetMeet(state, first.id, second.id);
    first.hp = 1;
    first.shield = 0;
    stepCppRollout(state, new Map([[first.id, [Action.Right]]]));
    expect(first.alive).toBe(false);
    expect(second.score).toBeGreaterThan(0);
  });
});

function openState(seed: number): GameState {
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
  return state;
}

function movePlayer(
  state: GameState,
  index: number,
  x: number,
  y: number,
): void {
  const player = state.players[index];
  for (const row of state.cells) {
    for (const cell of row) cell.players.delete(player.id);
  }
  player.x = x;
  player.y = y;
  state.cells[x][y].players.add(player.id);
}

function resetMeet(
  state: GameState,
  firstId: number,
  secondId: number,
): void {
  const first = state.players.find((player) => player.id === firstId)!;
  const second = state.players.find((player) => player.id === secondId)!;
  for (const row of state.cells) {
    for (const cell of row) {
      cell.players.delete(first.id);
      cell.players.delete(second.id);
    }
  }
  first.x = 6;
  first.y = 5;
  first.alive = true;
  second.x = 6;
  second.y = 6;
  second.alive = true;
  state.cells[6][5].players.add(first.id);
  state.cells[6][6].players.add(second.id);
  state.over = false;
}

function minimalModelText(): string {
  const inputDim = 1616;
  const hiddenDim = 1;
  const outputDim = 6;
  const headDim = 1;
  return [
    'DLRNNH1',
    inputDim,
    hiddenDim,
    outputDim,
    64,
    headDim,
    ...Array(inputDim).fill('0'),
    '0',
    '0',
    '0',
    '0',
    ...Array(outputDim).fill('0'),
    ...Array(outputDim).fill('0'),
  ].join(' ');
}
