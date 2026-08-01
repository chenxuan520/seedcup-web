#include "bot.h"
#include "dl/game_sim.h"

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

void JsonIntVec(std::ostream &out, const std::vector<int> &values) {
  out << "[";
  for (size_t index = 0; index < values.size(); ++index) {
    if (index) out << ",";
    out << values[index];
  }
  out << "]";
}

void JsonMsg(std::ostream &out, const seedcup::GameMsg &msg) {
  out << "{\"player_id\":" << msg.player_id
      << ",\"game_round\":" << msg.game_round << ",\"grid\":[";
  for (size_t x = 0; x < msg.grid.size(); ++x) {
    if (x) out << ",";
    out << "[";
    for (size_t y = 0; y < msg.grid[x].size(); ++y) {
      if (y) out << ",";
      const auto &cell = msg.grid[x][y];
      std::vector<int> players(cell.player_ids.begin(), cell.player_ids.end());
      out << "{\"x\":" << cell.x << ",\"y\":" << cell.y
          << ",\"bomb_id\":" << cell.bomb_id
          << ",\"block_id\":" << cell.block_id
          << ",\"item\":" << static_cast<int>(cell.item)
          << ",\"player_ids\":";
      JsonIntVec(out, players);
      out << "}";
    }
    out << "]";
  }
  out << "],\"players\":[";
  bool first = true;
  for (const auto &[id, player] : msg.players) {
    if (!player) continue;
    if (!first) out << ",";
    first = false;
    out << "{\"id\":" << id << ",\"x\":" << player->x
        << ",\"y\":" << player->y
        << ",\"alive\":" << (player->alive ? 1 : 0)
        << ",\"bomb_max_num\":" << player->bomb_max_num
        << ",\"bomb_now_num\":" << player->bomb_now_num
        << ",\"bomb_range\":" << player->bomb_range
        << ",\"speed\":" << player->speed << ",\"hp\":" << player->hp
        << ",\"invincible_time\":" << player->invincible_time
        << ",\"score\":" << player->score
        << ",\"shield_time\":" << player->shield_time
        << ",\"has_gloves\":" << (player->has_gloves ? 1 : 0) << "}";
  }
  out << "],\"bombs\":[";
  first = true;
  for (const auto &[id, bomb] : msg.bombs) {
    if (!bomb) continue;
    if (!first) out << ",";
    first = false;
    out << "{\"id\":" << id << ",\"x\":" << bomb->x
        << ",\"y\":" << bomb->y << ",\"player_id\":" << bomb->player_id
        << ",\"bomb_range\":" << bomb->bomb_range
        << ",\"bomb_status\":" << bomb->bomb_status << "}";
  }
  out << "],\"blocks\":[";
  first = true;
  for (const auto &[id, block] : msg.blocks) {
    if (!block) continue;
    if (!first) out << ",";
    first = false;
    out << "{\"id\":" << id << ",\"x\":" << block->x
        << ",\"y\":" << block->y
        << ",\"removable\":" << (block->removable ? 1 : 0) << "}";
  }
  out << "]}";
}

seedcup::GameMsg BuildSdkView(const dl_bot::GameSim &sim, int player_id) {
  const auto source = sim.BuildMsg(player_id);
  seedcup::GameMsg view;
  view.player_id = player_id;
  view.game_round = source.game_round;
  view.grid = source.grid;
  for (const auto &row : source.grid) {
    for (const auto &cell : row) {
      for (int id : cell.player_ids) {
        const auto player = source.players.find(id);
        if (player != source.players.end() && player->second) {
          view.players[id] =
              std::make_shared<seedcup::Player>(*player->second);
        }
      }
      if (cell.bomb_id != -1) {
        const auto bomb = source.bombs.find(cell.bomb_id);
        if (bomb != source.bombs.end() && bomb->second) {
          view.bombs[cell.bomb_id] =
              std::make_shared<seedcup::Bomb>(*bomb->second);
        }
      }
      if (cell.block_id != -1) {
        const auto block = source.blocks.find(cell.block_id);
        if (block != source.blocks.end() && block->second) {
          view.blocks[cell.block_id] =
              std::make_shared<seedcup::Block>(*block->second);
        }
      }
    }
  }
  return view;
}

} // namespace

int main(int argc, char **argv) {
  if (argc != 4) {
    std::cerr << "usage: contest_hard_trace <seed> <rounds> <out>\n";
    return 1;
  }
  const uint64_t seed = std::strtoull(argv[1], nullptr, 10);
  const int rounds = std::max(1, std::atoi(argv[2]));
  std::ofstream out(argv[3], std::ios::trunc);
  if (!out.is_open()) return 2;

  dl_bot::SimConfig config;
  config.seed = seed;
  config.max_round = rounds;
  dl_bot::GameSim sim(config);
  sim.Init();
  const int hard_id = sim.player_ids()[0];
  Bot hard;
#ifdef CURRENT_CONTEST_RULES
  hard.set_hard_mode(true);
  hard.set_contest_rules(true);
#endif
  hard.set_bomb_time(config.bomb_time);
  char rand_state[128]{};
  initstate(1, rand_state, sizeof(rand_state));
  SeedCup dummy("src/config.json", "contest-hard-trace");

  out << "{\"seed\":" << seed << ",\"hard_id\":" << hard_id
      << ",\"steps\":[";
  bool first = true;
  while (!sim.IsOver() && sim.round() < rounds) {
    auto msg = BuildSdkView(sim, hard_id);
    auto player = msg.players.find(hard_id);
    if (player == msg.players.end() || !player->second ||
        !player->second->alive) {
      break;
    }
    std::vector<seedcup::ActionType> actions;
    for (int sub = 0; sub < player->second->speed; ++sub) {
      std::ostringstream snapshot;
      JsonMsg(snapshot, msg);
      setstate(rand_state);
      const auto action = hard.CalcOnce(msg, dummy);
      if (!first) out << ",";
      first = false;
      out << "{\"sub\":" << sub << ",\"msg\":" << snapshot.str()
          << ",\"action\":" << static_cast<int>(action) << "}";
      if (action != seedcup::SILENT) actions.push_back(action);
    }
    sim.Step({{hard_id, actions}});
  }
  out << "]}\n";
  return 0;
}
