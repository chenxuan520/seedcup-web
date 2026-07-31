#include "config.h"
#include "server/game/game.h"

#include <algorithm>
#include <iostream>
#include <string>
#include <vector>

namespace {

void PrintState(const char *name, Game &game,
                const std::vector<ID> &winner_ids = {}) {
  std::cout << "{\"name\":\"" << name << "\",\"round\":"
            << game.game_now_round() << ",\"status\":"
            << static_cast<int>(game.game_status()) << ",\"players\":[";
  bool first = true;
  for (const auto &[id, player] : game.player_map()) {
    if (!first) std::cout << ",";
    first = false;
    const auto pos = player->pos();
    std::cout << "{\"id\":" << id << ",\"x\":" << pos.first
              << ",\"y\":" << pos.second << ",\"alive\":"
              << (player->status() == ALIVE ? 1 : 0)
              << ",\"hp\":" << player->HP()
              << ",\"speed\":" << player->speed()
              << ",\"bomb_max\":" << player->bomb_max_num()
              << ",\"bomb_now\":" << player->bomb_now_num()
              << ",\"bomb_range\":" << player->bomb_range()
              << ",\"shield\":" << player->shield_time()
              << ",\"invincible\":" << player->invincible_time()
              << ",\"gloves\":" << (player->has_gloves() ? 1 : 0)
              << ",\"score\":" << player->mark() << "}";
  }
  std::cout << "],\"cells\":[";
  for (size_t x = 0; x < game.map().size(); ++x) {
    if (x) std::cout << ",";
    std::cout << "[";
    for (size_t y = 0; y < game.map()[x].size(); ++y) {
      if (y) std::cout << ",";
      const auto &cell = game.map()[x][y];
      int removable = 0;
      int hidden_item = 0;
      if (cell->block_id() != -1) {
        const auto block = game.block_map().at(cell->block_id());
        removable = block->IsBombAble() ? 1 : 0;
        if (removable) hidden_item = block->BombInjuries().second;
      }
      std::vector<int> players(
          cell->players().begin(), cell->players().end());
      std::sort(players.begin(), players.end());
      std::cout << "{\"block_id\":" << cell->block_id()
                << ",\"removable\":" << removable
                << ",\"hidden_item\":" << hidden_item
                << ",\"bomb_id\":" << cell->bomb_id()
                << ",\"item\":" << static_cast<int>(cell->potion_type())
                << ",\"last_bomb_round\":" << cell->last_bomb_round()
                << ",\"players\":[";
      for (size_t index = 0; index < players.size(); ++index) {
        if (index) std::cout << ",";
        std::cout << players[index];
      }
      std::cout << "]}";
    }
    std::cout << "]";
  }
  std::cout << "],\"bombs\":[";
  first = true;
  for (const auto &[id, bomb] : game.bomb_map()) {
    if (!first) std::cout << ",";
    first = false;
    const auto pos = bomb->pos();
    std::cout << "{\"id\":" << id << ",\"x\":" << pos.first
              << ",\"y\":" << pos.second
              << ",\"time\":" << bomb->bomb_time()
              << ",\"range\":" << bomb->bomb_range()
              << ",\"owner\":" << bomb->player_id()
              << ",\"status\":" << static_cast<int>(bomb->bomb_status())
              << "}";
  }
  std::cout << "],\"winners\":[";
  for (size_t index = 0; index < winner_ids.size(); ++index) {
    if (index) std::cout << ",";
    std::cout << winner_ids[index];
  }
  std::cout << "]}";
}

void SetPlayer(Game &game, ID id, int x, int y) {
  const auto player = game.player_map().at(id);
  const auto old = player->pos();
  game.map()[old.first][old.second]->players().erase(id);
  player->set_pos({x, y});
  game.map()[x][y]->players().insert(id);
}

void ClearCell(Game &game, int x, int y) {
  game.map()[x][y]->set_block_id(-1);
  game.map()[x][y]->set_potion_type(NO_POTION);
}

}  // namespace

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;
  Game &game = Game::GetInstance();
  game.Init();
  ID p0 = -1, p1 = -1;
  game.AddPlayer(p0, "p0");
  game.AddPlayer(p1, "p1");

  ClearCell(game, 4, 4);
  ClearCell(game, 4, 5);
  ClearCell(game, 4, 6);
  ClearCell(game, 4, 7);
  SetPlayer(game, p0, 4, 4);
  SetPlayer(game, p1, 4, 7);
  game.player_map().at(p0)->set_speed(2);
  game.player_map().at(p0)->set_has_gloves(true);
  game.player_map().at(p0)->set_bomb_max_num(4);
  game.player_map().at(p1)->set_bomb_max_num(4);

  std::cout << "{\"steps\":[";
  PrintState("initial", game);

  const int place_rc = game.AddAction(Action(p0, PLACED));
  const int move_off_rc = game.AddAction(Action(p0, MOVE_RIGHT));
  const int over_speed_rc = game.AddAction(Action(p0, MOVE_RIGHT));
  std::cout << ",{\"name\":\"action_results\",\"place\":" << place_rc
            << ",\"move_off\":" << move_off_rc
            << ",\"over_speed\":" << over_speed_rc << "}";

  std::vector<ID> winners;
  game.FlushTime(winners);
  std::cout << ",";
  PrintState("flush_1", game, winners);
  game.FlushTime(winners);
  std::cout << ",";
  PrintState("flush_2", game, winners);

  game.AddAction(Action(p0, MOVE_LEFT));
  game.FlushTime(winners);
  std::cout << ",";
  PrintState("flush_3", game, winners);
  game.FlushTime(winners);
  std::cout << ",";
  PrintState("flush_4", game, winners);
  game.FlushTime(winners);
  std::cout << ",";
  PrintState("flush_5", game, winners);
  std::cout << "]}\n";
}
