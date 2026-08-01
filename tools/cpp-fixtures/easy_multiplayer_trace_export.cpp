#include "bot.h"
#include "dl/game_sim.h"

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <random>
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

struct EasyClient {
  Bot bot;
  char rand_state[128]{};

  EasyClient() {
    bot.set_bomb_time(3);
    initstate(1, rand_state, sizeof(rand_state));
  }

  seedcup::ActionType Decide(seedcup::GameMsg msg, SeedCup &server) {
    setstate(rand_state);
    msg.players.at(msg.player_id)->speed = 1;
    return bot.CalcOnce(msg, server);
  }
};

seedcup::GameMsg BuildSdkView(const dl_bot::GameSim &sim, int player_id) {
  const auto source = sim.BuildMsg(player_id);
  seedcup::GameMsg view;
  view.player_id = player_id;
  view.game_round = source.game_round;
  view.grid = source.grid;
  for (size_t x = 0; x < source.grid.size(); ++x) {
    for (size_t y = 0; y < source.grid[x].size(); ++y) {
      const auto &cell = source.grid[x][y];
      std::unordered_set<int> player_ids(
          cell.player_ids.begin(), cell.player_ids.end());
      for (int id : player_ids) {
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
  if (argc != 4) {
    std::cerr << "usage: easy4_trace <seed> <rounds> <out>\n";
    return 1;
  }
  const uint64_t seed = std::strtoull(argv[1], nullptr, 10);
  const int max_rounds = std::max(1, std::atoi(argv[2]));
  std::ofstream out(argv[3], std::ios::trunc);
  if (!out.is_open()) return 2;

  dl_bot::SimConfig config;
  config.seed = seed;
  config.player_num = 4;
  config.max_round = max_rounds;
  dl_bot::GameSim sim(config);
  sim.Init();
  const auto ids = sim.player_ids();
  std::vector<EasyClient> clients(ids.size());
  SeedCup dummy("src/config.json", "easy4_trace");

  out << "{\"seed\":" << seed << ",\"player_ids\":";
  JsonIntVec(out, ids);
  out << ",\"steps\":[";
  bool first_step = true;
  while (!sim.IsOver() && sim.round() < max_rounds) {
    std::unordered_map<int, std::vector<seedcup::ActionType>> actions;
    for (size_t index = 0; index < ids.size(); ++index) {
      const int player_id = ids[index];
      const auto msg = BuildSdkView(sim, player_id);
      const auto player = msg.players.find(player_id);
      if (player == msg.players.end() || !player->second || !player->second->alive) {
        continue;
      }
      std::ostringstream snapshot;
      JsonMsg(snapshot, msg);
      const auto action = clients[index].Decide(msg, dummy);
      if (!first_step) out << ",";
      first_step = false;
      out << "{\"round\":" << sim.round()
          << ",\"player_id\":" << player_id << ",\"msg\":";
      out << snapshot.str();
      out << ",\"action\":" << static_cast<int>(action) << "}";
      if (action != seedcup::SILENT) actions[player_id] = {action};
    }
    sim.Step(actions);
  }
  out << "]}\n";
}
