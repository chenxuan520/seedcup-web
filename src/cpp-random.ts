export interface CppMt19937Snapshot {
  state: number[];
  index: number;
}

export class CppMt19937 {
  private readonly state = new Uint32Array(624);
  private index = 624;

  constructor(seed = 0x9e3779b9) {
    this.seed(seed);
  }

  nextUint32(): number {
    if (this.index >= this.state.length) this.twist();
    let value = this.state[this.index++];
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c5680;
    value ^= (value << 15) & 0xefc60000;
    value ^= value >>> 18;
    return value >>> 0;
  }

  uniformInt(maxInclusive: number): number {
    if (!Number.isInteger(maxInclusive) || maxInclusive < 0) {
      throw new Error(`invalid mt19937 range: ${maxInclusive}`);
    }
    const range = maxInclusive + 1;
    const scaling = Math.floor(0xffffffff / range);
    const past = range * scaling;
    let value = this.nextUint32();
    while (value >= past) value = this.nextUint32();
    return Math.floor(value / scaling);
  }

  shuffle<T>(values: T[]): void {
    const range = values.length;
    if (range <= 1) return;

    let index = 1;
    if (range % 2 === 0) {
      const swapIndex = this.uniformInt(1);
      [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
      index++;
    }

    while (index < range) {
      const swapRange = index + 1;
      const pair = this.uniformInt(swapRange * (swapRange + 1) - 1);
      const firstSwap = Math.floor(pair / (swapRange + 1));
      const secondSwap = pair % (swapRange + 1);
      [values[index], values[firstSwap]] = [values[firstSwap], values[index]];
      index++;
      [values[index], values[secondSwap]] = [values[secondSwap], values[index]];
      index++;
    }
  }

  snapshot(): CppMt19937Snapshot {
    return {
      state: Array.from(this.state),
      index: this.index,
    };
  }

  restore(snapshot: CppMt19937Snapshot): void {
    if (
      snapshot.state.length !== this.state.length ||
      snapshot.index < 0 ||
      snapshot.index > this.state.length
    ) {
      throw new Error('invalid mt19937 snapshot');
    }
    this.state.set(snapshot.state);
    this.index = snapshot.index;
  }

  clone(): CppMt19937 {
    const copy = new CppMt19937(0);
    copy.restore(this.snapshot());
    return copy;
  }

  private seed(seed: number): void {
    this.state[0] = seed >>> 0;
    for (let index = 1; index < this.state.length; index++) {
      const previous = this.state[index - 1];
      this.state[index] = (
        Math.imul(1812433253, (previous ^ (previous >>> 30)) >>> 0) + index
      ) >>> 0;
    }
    this.index = this.state.length;
  }

  private twist(): void {
    for (let index = 0; index < this.state.length; index++) {
      const next = (index + 1) % this.state.length;
      const value =
        (this.state[index] & 0x80000000) |
        (this.state[next] & 0x7fffffff);
      let twisted =
        this.state[(index + 397) % this.state.length] ^ (value >>> 1);
      if (value & 1) twisted ^= 0x9908b0df;
      this.state[index] = twisted >>> 0;
    }
    this.index = 0;
  }
}
