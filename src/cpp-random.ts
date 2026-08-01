export interface CppMt19937Snapshot {
  state: number[];
  index: number;
}

export interface CppMt19937_64Snapshot {
  state: string[];
  index: number;
}

export class GlibcRand {
  private readonly values: number[] = [];
  private index = 344;

  constructor(seed = 1) {
    this.seed(seed);
  }

  next(): number {
    const value = (
      (this.values[this.index - 31] ?? 0) +
      (this.values[this.index - 3] ?? 0)
    ) >>> 0;
    this.values.push(value);
    this.index++;
    return value >>> 1;
  }

  randomShuffle<T>(values: T[]): void {
    for (let index = 1; index < values.length; index++) {
      const swapIndex = this.next() % (index + 1);
      [values[index], values[swapIndex]] = [
        values[swapIndex],
        values[index],
      ];
    }
  }

  private seed(seed: number): void {
    this.values.length = 0;
    let previous = seed === 0 ? 1 : seed & 0x7fffffff;
    this.values.push(previous);
    for (let index = 1; index < 31; index++) {
      previous = Number((16807n * BigInt(previous)) % 2147483647n);
      this.values.push(previous);
    }
    for (let index = 31; index < 34; index++) {
      this.values.push(this.values[index - 31]);
    }
    for (let index = 34; index < 344; index++) {
      this.values.push(
        (
          (this.values[index - 31] ?? 0) +
          (this.values[index - 3] ?? 0)
        ) >>> 0,
      );
    }
    this.index = 344;
  }
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

  reseed(seed: number): void {
    this.seed(seed);
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

const uint64Mask = (1n << 64n) - 1n;

export class CppMt19937_64 {
  private readonly state = Array.from({ length: 312 }, () => 0n);
  private index = 312;

  constructor(seed: number | bigint) {
    this.seed(BigInt(seed));
  }

  nextUint64(): bigint {
    if (this.index >= this.state.length) this.twist();
    let value = this.state[this.index++];
    value ^= (value >> 29n) & 0x5555555555555555n;
    value ^= (value << 17n) & 0x71d67fffeda60000n;
    value ^= (value << 37n) & 0xfff7eee000000000n;
    value ^= value >> 43n;
    return value & uint64Mask;
  }

  uniformInt(maxInclusive: number): number {
    if (!Number.isInteger(maxInclusive) || maxInclusive < 0) {
      throw new Error(`invalid mt19937_64 range: ${maxInclusive}`);
    }
    const range = BigInt(maxInclusive + 1);
    const generatorRange = uint64Mask;
    const scaling = generatorRange / range;
    const past = range * scaling;
    let value = this.nextUint64();
    while (value >= past) value = this.nextUint64();
    return Number(value / scaling);
  }

  snapshot(): CppMt19937_64Snapshot {
    return {
      state: this.state.map((value) => value.toString()),
      index: this.index,
    };
  }

  restore(snapshot: CppMt19937_64Snapshot): void {
    if (
      snapshot.state.length !== this.state.length ||
      snapshot.index < 0 ||
      snapshot.index > this.state.length
    ) {
      throw new Error('invalid mt19937_64 snapshot');
    }
    for (let index = 0; index < this.state.length; index++) {
      this.state[index] = BigInt(snapshot.state[index]) & uint64Mask;
    }
    this.index = snapshot.index;
  }

  clone(): CppMt19937_64 {
    const copy = new CppMt19937_64(0);
    copy.restore(this.snapshot());
    return copy;
  }

  private seed(seed: bigint): void {
    this.state[0] = seed & uint64Mask;
    for (let index = 1; index < this.state.length; index++) {
      const previous = this.state[index - 1];
      this.state[index] =
        (6364136223846793005n *
          (previous ^ (previous >> 62n)) +
          BigInt(index)) &
        uint64Mask;
    }
    this.index = this.state.length;
  }

  private twist(): void {
    const upperMask = 0xffffffff80000000n;
    const lowerMask = 0x7fffffffn;
    const matrix = 0xb5026f5aa96619e9n;
    for (let index = 0; index < this.state.length; index++) {
      const next = (index + 1) % this.state.length;
      const value =
        (this.state[index] & upperMask) |
        (this.state[next] & lowerMask);
      let twisted =
        this.state[(index + 156) % this.state.length] ^
        (value >> 1n);
      if (value & 1n) twisted ^= matrix;
      this.state[index] = twisted & uint64Mask;
    }
    this.index = 0;
  }
}
