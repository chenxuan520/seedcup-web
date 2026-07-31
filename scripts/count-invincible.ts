import { createGame, Item, type BlockMeta } from '../src/engine';
function count(seed:number){
  const state=createGame(seed);
  const meta=(state as unknown as {blockMeta:Map<number,BlockMeta>}).blockMeta;
  let mud=0, potion=0, inv=0;
  for (const block of meta.values()) {
    if (!block.removable) continue;
    mud++;
    if (block.hiddenItem !== Item.None) potion++;
    if (block.hiddenItem === Item.Invincible) inv++;
  }
  return {seed,mud,potion,inv};
}
for (const seed of [1,42,123,999,20260730,31415,2718,8080]) console.log(count(seed));
let sum=0; const n=1000;
for(let i=0;i<n;i++) sum+=count(100000+i).inv;
console.log('avg_inv_1000=', sum/n);
