import {
  createGame,
  defaultConfig,
  runRound,
  type BotController,
} from '../src/engine';
import { RuleBot } from '../src/bots';

const seeds = Array.from({ length: 120 }, (_, index) => 1000 + index);
let games = 0;
let easyDeaths = 0;
let easyCausedDeaths = 0;
let easyPushedBombDeaths = 0;
let opponentChainDeaths = 0;

for (const seed of seeds) {
  for (const opponentHard of [false, true]) {
    const state = createGame(seed, { ...defaultConfig, maxRound: 400 });
    const easyId = state.players[0].id;
    const opponentId = state.players[1].id;
    const bots = new Map<number, BotController>([
      [easyId, new RuleBot(false, 0)],
      [opponentId, new RuleBot(opponentHard, opponentHard ? 4 : 0)],
    ]);
    for (const [playerId, bot] of bots) bot.reset?.(playerId, state);

    while (!state.over) {
      const events = runRound(state, bots);
      for (const event of events) {
        if (event.kind !== 'damage' || event.playerId !== easyId) continue;
        easyDeaths++;
        if (event.ownerId === easyId) easyCausedDeaths++;
        if (event.pusherId === easyId) easyPushedBombDeaths++;
        if (
          event.ownerId !== easyId &&
          event.bombOwnerId === easyId
        ) {
          opponentChainDeaths++;
        }
      }
    }
    games++;
  }
}

console.log(
  `easy safety games=${games} deaths=${easyDeaths} ` +
    `easy_caused_deaths=${easyCausedDeaths} ` +
    `pushed_bomb_deaths=${easyPushedBombDeaths} ` +
    `opponent_chain_deaths=${opponentChainDeaths}`,
);

if (easyCausedDeaths !== 0) process.exit(1);
