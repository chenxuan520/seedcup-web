#include "bot.h"
#include "json.hpp"

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

using json = nlohmann::json;

namespace {

seedcup::GameMsg ParseFixture(const json &source) {
  seedcup::GameMsg msg;
  msg.player_id = source["player_id"].get<int>();
  msg.game_round = source["game_round"].get<int>();
  const int size = static_cast<int>(source["grid"].size());
  msg.grid.resize(size, std::vector<seedcup::Area>(size));
  for (int x = 0; x < size; ++x) {
    for (int y = 0; y < size; ++y) {
      const auto &cell = source["grid"][x][y];
      auto &area = msg.grid[x][y];
      area.x = x;
      area.y = y;
      area.bomb_id = cell["bomb_id"].get<int>();
      area.block_id = cell["block_id"].get<int>();
      area.item = static_cast<seedcup::ItemType>(cell["item"].get<int>());
      for (const auto &id : cell["player_ids"]) {
        area.player_ids.insert(id.get<int>());
      }
    }
  }
  std::unordered_map<int, json> source_players;
  for (const auto &source_player : source["players"]) {
    const int id = source_player["id"].get<int>();
    source_players.emplace(id, source_player);
  }
  for (int x = 0; x < size; ++x) {
    for (int y = 0; y < size; ++y) {
      for (int id : msg.grid[x][y].player_ids) {
        const auto source_it = source_players.find(id);
        if (source_it == source_players.end()) continue;
        const auto &source_player = source_it->second;
    auto player = std::make_shared<seedcup::Player>();
    player->player_id = id;
    player->x = source_player["x"].get<int>();
    player->y = source_player["y"].get<int>();
    player->alive = source_player["alive"].get<int>() != 0;
    player->bomb_max_num = source_player["bomb_max_num"].get<int>();
    player->bomb_now_num = source_player["bomb_now_num"].get<int>();
    player->bomb_range = source_player["bomb_range"].get<int>();
    player->speed = source_player["speed"].get<int>();
    player->hp = source_player["hp"].get<int>();
    player->invincible_time = source_player["invincible_time"].get<int>();
    player->score = source_player["score"].get<int>();
    player->shield_time = source_player["shield_time"].get<int>();
    player->has_gloves = source_player["has_gloves"].get<int>() != 0;
    msg.players[id] = std::move(player);
      }
    }
  }
  for (const auto &source_bomb : source["bombs"]) {
    const int id = source_bomb["id"].get<int>();
    auto bomb = std::make_shared<seedcup::Bomb>();
    bomb->bomb_id = id;
    bomb->x = source_bomb["x"].get<int>();
    bomb->y = source_bomb["y"].get<int>();
    bomb->player_id = source_bomb["player_id"].get<int>();
    bomb->bomb_range = source_bomb["bomb_range"].get<int>();
    bomb->bomb_status = source_bomb["bomb_status"].get<int>();
    msg.bombs[id] = std::move(bomb);
  }
  for (const auto &source_block : source["blocks"]) {
    const int id = source_block["id"].get<int>();
    auto block = std::make_shared<seedcup::Block>();
    block->block_id = id;
    block->x = source_block["x"].get<int>();
    block->y = source_block["y"].get<int>();
    block->removable = source_block["removable"].get<int>() != 0;
    msg.blocks[id] = std::move(block);
  }
  return msg;
}

struct Client {
  Bot bot;
  char rand_state[128]{};

  Client() {
    bot.set_bomb_time(3);
    initstate(1, rand_state, sizeof(rand_state));
  }

  int Decide(seedcup::GameMsg msg, SeedCup &dummy) {
    setstate(rand_state);
    msg.players.at(msg.player_id)->speed = 1;
    return static_cast<int>(bot.CalcOnce(msg, dummy));
  }
};

} // namespace

int main(int argc, char **argv) {
  if (argc != 2) return 1;
  std::ifstream input(argv[1]);
  const json fixture = json::parse(input);
  std::unordered_map<int, std::unique_ptr<Client>> clients;
  for (const auto &id : fixture["player_ids"]) {
    clients[id.get<int>()] = std::make_unique<Client>();
  }
  SeedCup dummy("src/config.json", "contest_easy_replay");
  int mismatches = 0;
  int index = 0;
  for (const auto &step : fixture["steps"]) {
    const int player_id = step["player_id"].get<int>();
    const int expected = step["action"].get<int>();
    const int actual =
        clients.at(player_id)->Decide(ParseFixture(step["msg"]), dummy);
    if (actual != expected) {
      if (mismatches < 20) {
        std::cerr << "mismatch step=" << index
                  << " round=" << step["round"].get<int>()
                  << " player=" << player_id
                  << " cpp=" << actual << " js=" << expected << "\n";
      }
      mismatches++;
    }
    index++;
  }
  std::cout << "contest easy replay steps=" << index
            << " mismatches=" << mismatches << "\n";
  return mismatches == 0 ? 0 : 2;
}
