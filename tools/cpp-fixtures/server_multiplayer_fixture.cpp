#include "config.h"
#include "server/game/game.h"

#include <iostream>
#include <vector>

namespace {

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

void PrintState(const char *name, Game &game) {
  std::cout << "{\"name\":\"" << name << "\",\"round\":"
            << game.game_now_round() << ",\"players\":[";
  bool first = true;
  for (const auto &[id, player] : game.player_map()) {
    if (!first) std::cout << ",";
    first = false;
    const auto pos = player->pos();
    std::cout << "{\"id\":" << id << ",\"x\":" << pos.first
              << ",\"y\":" << pos.second << ",\"alive\":"
              << (player->status() == ALIVE ? 1 : 0)
              << ",\"hp\":" << player->HP()
              << ",\"shield\":" << player->shield_time()
              << ",\"invincible\":" << player->invincible_time()
              << ",\"score\":" << player->mark() << "}";
  }
  std::cout << "],\"target_players\":[";
  const auto &players = game.map()[4][6]->players();
  first = true;
  for (int id : players) {
    if (!first) std::cout << ",";
    first = false;
    std::cout << id;
  }
  std::cout << "]}";
}

}  // namespace

int main() {
  Game &game = Game::GetInstance();
  game.Init();
  std::vector<ID> ids(4, -1);
  for (int index = 0; index < 4; ++index) {
    game.AddPlayer(ids[index], "p" + std::to_string(index));
  }
  ClearCell(game, 4, 5);
  ClearCell(game, 4, 6);
  SetPlayer(game, ids[0], 4, 5);
  for (int index = 1; index < 4; ++index) {
    SetPlayer(game, ids[index], 4, 6);
    game.player_map().at(ids[index])->IncrHP();
  }
  game.player_map().at(ids[0])->set_invincible_time(5);

  std::cout << "{\"steps\":[";
  PrintState("before_move", game);
  const int move_rc = game.AddAction(Action(ids[0], MOVE_RIGHT));
  std::cout << ",{\"name\":\"move_result\",\"rc\":" << move_rc << "},";
  PrintState("after_move", game);
  std::vector<ID> winners;
  game.FlushTime(winners);
  std::cout << ",";
  PrintState("after_flush", game);
  std::cout << "]}\n";
}
