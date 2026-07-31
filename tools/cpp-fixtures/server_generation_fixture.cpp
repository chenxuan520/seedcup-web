#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <random>
#include <utility>
#include <vector>

namespace {

constexpr int kSize = 13;
constexpr int kWallRandom = 25;
constexpr int kMudRandom = 75;
constexpr int kPotionProbability = 50;

constexpr int kPotionBag[] = {
    5, 5, 4, 3, 3,
    1, 1, 1, 1, 1, 1,
    2, 2, 2, 2, 2, 2,
    6, 6, 6,
    7, 7, 7,
};

struct Block {
  int id;
  int x;
  int y;
  bool removable;
  int hidden_item;
};

}  // namespace

int main(int argc, char **argv) {
  const uint64_t seed =
      argc > 1 ? std::strtoull(argv[1], nullptr, 10) : 20260731ULL;
  std::mt19937_64 probability_rng(seed);
  std::mt19937_64 potion_rng(seed);
  std::mt19937_64 bomb_rng(seed);
  std::mt19937 block_shuffle_rng(static_cast<uint32_t>(seed));
  std::mt19937 birth_shuffle_rng(static_cast<uint32_t>(seed));
  std::uniform_int_distribution<int> probability(0, 99);
  std::uniform_int_distribution<int> potion(
      0, static_cast<int>(std::size(kPotionBag)) - 1);
  std::uniform_int_distribution<int> bomb_extra(0, 1);

  std::vector<std::vector<int>> block_ids(
      kSize, std::vector<int>(kSize, -1));
  std::vector<Block> blocks;
  std::vector<std::pair<int, int>> mud_candidates;
  int next_block_id = 0;

  auto roll_probability = [&]() { return probability(probability_rng); };
  auto is_wall = [&](int i, int j) {
    if (i % 2 != 0 && j % 2 != 0) return true;
    if ((i + j) % 2 != 0 &&
        i >= 1 && i < kSize - 1 && j >= 1 && j < kSize - 1 &&
        roll_probability() < kWallRandom) {
      return true;
    }
    if (((j == kSize / 2 && (i == 0 || i == kSize - 1)) ||
         (i == kSize / 2 && (j == 0 || j == kSize - 1))) &&
        roll_probability() < kWallRandom) {
      return true;
    }
    return false;
  };

  for (int i = 0; i < kSize; ++i) {
    for (int j = 0; j < kSize; ++j) {
      if (is_wall(i, j)) {
        const int id = next_block_id++;
        block_ids[i][j] = id;
        blocks.push_back({id, i, j, false, 0});
      } else if ((kSize - i <= 2 || i <= 1) &&
                 (kSize - j <= 2 || j <= 1)) {
        continue;
      } else {
        mud_candidates.push_back({i, j});
      }
    }
  }

  std::shuffle(
      mud_candidates.begin(), mud_candidates.end(), block_shuffle_rng);
  for (const auto &[i, j] : mud_candidates) {
    if (roll_probability() >= kMudRandom) continue;
    int hidden = 0;
    if (roll_probability() < kPotionProbability) {
      hidden = kPotionBag[potion(potion_rng)];
    }
    const int id = next_block_id++;
    block_ids[i][j] = id;
    blocks.push_back({id, i, j, true, hidden});
  }

  std::vector<std::pair<int, int>> births = {
      {0, 0}, {kSize - 1, kSize - 1},
      {kSize - 1, 0}, {0, kSize - 1},
  };
  std::shuffle(births.begin(), births.end(), birth_shuffle_rng);

  std::cout << "{\"seed\":" << seed << ",\"size\":" << kSize
            << ",\"blocks\":[";
  for (size_t index = 0; index < blocks.size(); ++index) {
    if (index) std::cout << ",";
    const auto &block = blocks[index];
    std::cout << "{\"id\":" << block.id
              << ",\"x\":" << block.x
              << ",\"y\":" << block.y
              << ",\"removable\":" << (block.removable ? 1 : 0)
              << ",\"hidden_item\":" << block.hidden_item << "}";
  }
  std::cout << "],\"births\":[";
  for (size_t index = 0; index < births.size(); ++index) {
    if (index) std::cout << ",";
    std::cout << "[" << births[index].first << ","
              << births[index].second << "]";
  }
  std::cout << "],\"bomb_extras\":[";
  for (int index = 0; index < 64; ++index) {
    if (index) std::cout << ",";
    std::cout << bomb_extra(bomb_rng);
  }
  std::cout << "]}\n";
}
