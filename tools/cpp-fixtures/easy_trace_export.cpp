#include "bot.h"
#include "dl/game_sim.h"

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
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
  for (size_t x = 0; x < source.grid.size(); ++x) {
    for (size_t y = 0; y < source.grid[x].size(); ++y) {
      const auto &cell = source.grid[x][y];
      for (int id : cell.player_ids) {
        const auto it = source.players.find(id);
        if (it != source.players.end() && it->second) {
          view.players[id] = std::make_shared<seedcup::Player>(*it->second);
        }
      }
      if (cell.bomb_id != -1) {
        const auto it = source.bombs.find(cell.bomb_id);
        if (it != source.bombs.end() && it->second) {
          view.bombs[cell.bomb_id] =
              std::make_shared<seedcup::Bomb>(*it->second);
        }
      }
      if (cell.block_id != -1) {
        const auto it = source.blocks.find(cell.block_id);
        if (it != source.blocks.end() && it->second) {
          view.blocks[cell.block_id] =
              std::make_shared<seedcup::Block>(*it->second);
        }
      }
    }
  }
  return view;
}

} // namespace

int main(int argc, char **argv) {
  if (argc != 4) return 1;
  const uint64_t seed = std::strtoull(argv[1], nullptr, 10);
  const int rounds = std::max(1, std::atoi(argv[2]));
  std::ofstream out(argv[3], std::ios::trunc);
  dl_bot::SimConfig config;
  config.seed = seed;
  config.max_round = rounds;
  dl_bot::GameSim sim(config);
  sim.Init();
  const int easy_id = sim.player_ids()[0];
  Bot easy;
  easy.set_bomb_time(config.bomb_time);
  SeedCup dummy("src/config.json", "easy2_trace");

  out << "{\"seed\":" << seed << ",\"easy_id\":" << easy_id
      << ",\"steps\":[";
  bool first = true;
  while (!sim.IsOver() && sim.round() < rounds) {
    auto msg = BuildSdkView(sim, easy_id);
    std::ostringstream snapshot;
    JsonMsg(snapshot, msg);
    static bool initialized = false;
    static char persistent_state[128]{};
    if (!initialized) {
      initstate(1, persistent_state, sizeof(persistent_state));
      initialized = true;
    }
    setstate(persistent_state);
    msg.players.at(easy_id)->speed = 1;
    const auto action = easy.CalcOnce(msg, dummy);
    if (!first) out << ",";
    first = false;
    out << "{\"msg\":";
    out << snapshot.str();
    out << ",\"action\":" << static_cast<int>(action) << "}";
    std::unordered_map<int, std::vector<seedcup::ActionType>> actions;
    if (action != seedcup::SILENT) actions[easy_id] = {action};
    sim.Step(actions);
  }
  out << "]}\n";
}
