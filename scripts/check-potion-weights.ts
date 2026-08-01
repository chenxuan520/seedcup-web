import { Item, potionBag } from '../src/engine';

const counts = Array.from({ length: Item.Gloves + 1 }, () => 0);
for (const item of potionBag) counts[item]++;

const expected = [0, 12, 12, 4, 1, 4, 6, 6];
if (JSON.stringify(counts) !== JSON.stringify(expected)) {
  throw new Error(
    `potion weights mismatch actual=${JSON.stringify(counts)} ` +
      `expected=${JSON.stringify(expected)}`,
  );
}

console.log(
  `potion weights ok total=${potionBag.length} ` +
    `invincible=${counts[Item.Invincible]}`,
);
