import { afterEach, describe, expect, test, vi } from 'vitest';

const originalArgv = [...process.argv];

afterEach(() => {
  process.argv = [...originalArgv];
  vi.resetModules();
});

async function runScript(
  path: string,
  ...args: string[]
): Promise<void> {
  process.argv = [process.execPath, path, ...args];
  await import(path);
}

describe.sequential('C++ parity regressions', { timeout: 120_000 }, () => {
  test('potion weights', async () => {
    await runScript('../scripts/check-potion-weights.ts');
  });

  test('server generation', async () => {
    await runScript(
      '../scripts/check-server-generation.ts',
      'fixtures/server_generation_seed20260731.json',
    );
  });

  test('server scenario', async () => {
    await runScript(
      '../scripts/check-server-scenario.ts',
      'fixtures/server_scenario_seed20260731.json',
      '20260731',
    );
  });

  test('server multiplayer', async () => {
    await runScript(
      '../scripts/check-server-multiplayer.ts',
      'fixtures/server_multiplayer_seed20260731.json',
      '20260731',
    );
  });

  test('NN single frame', async () => {
    await runScript('../scripts/check-nn-parity.ts');
  });

  test('NN sequence', async () => {
    await runScript('../scripts/check-nn-sequence.ts');
  });

  test('contest easy two-player', async () => {
    await runScript(
      '../scripts/check-easy-parity.ts',
      'fixtures/easy_parity_seed42.json',
    );
  });

  test('contest easy four-player', async () => {
    await runScript(
      '../scripts/check-easy-multiplayer-parity.ts',
      'fixtures/easy_multiplayer_seed20260801.json',
    );
  });

  test('contest hard', async () => {
    await runScript(
      '../scripts/check-hard-parity.ts',
      'fixtures/hard_parity_seed42.trace.json',
    );
  });

  test('rule search', async () => {
    await runScript(
      '../scripts/check-search-parity.ts',
      'fixtures/search_rule_seed42.json',
    );
  });

  test('hybrid search', async () => {
    await runScript(
      '../scripts/check-search-parity.ts',
      'fixtures/search_hybrid_seed42.json',
    );
  });

  test('hybrid search full games', async () => {
    await runScript(
      '../scripts/check-search-game-trace.ts',
      'fixtures/search_game_hybrid_seed43_first.trace.json',
    );
    vi.resetModules();
    await runScript(
      '../scripts/check-search-game-trace.ts',
      'fixtures/search_game_hybrid_seed43_second.trace.json',
    );
  });

  test('all parity scripts completed without setting failure status', () => {
    expect(process.exitCode ?? 0).toBe(0);
  });
});
