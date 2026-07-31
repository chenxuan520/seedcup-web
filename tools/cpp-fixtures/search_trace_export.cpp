#include "bot.h"
#define private public
#define protected public
#include "dl/dl_bot.h"
#include "dl/game_sim.h"
#include "dl/rule_search_bot.h"
#undef private
#undef protected

#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

void JsonIntVec(std::ostream &out, const std::vector<int> &values) {
  out << "[";
  for (size_t index = 0; index < values.size(); index++) {
    if (index) out << ",";
    out << values[index];
  }
  out << "]";
}

void JsonDoubleVec(std::ostream &out, const std::vector<double> &values) {
  out << "[";
  for (size_t index = 0; index < values.size(); index++) {
    if (index) out << ",";
    out << std::setprecision(17) << values[index];
  }
  out << "]";
}

void JsonMsg(std::ostream &out, const seedcup::GameMsg &msg) {
  out << "{";
  out << "\"player_id\":" << msg.player_id << ",";
  out << "\"game_round\":" << msg.game_round << ",";
  out << "\"grid\":[";
  for (size_t x = 0; x < msg.grid.size(); x++) {
    if (x) out << ",";
    out << "[";
    for (size_t y = 0; y < msg.grid[x].size(); y++) {
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

void JsonScoreBreakdown(std::ostream &out, const seedcup::GameMsg &msg,
                        int self_id) {
  int opponent_id = -1;
  for (const auto &[id, player] : msg.players) {
    if (id != self_id) {
      opponent_id = id;
      break;
    }
  }
  const auto self_it = msg.players.find(self_id);
  const auto opponent_it = msg.players.find(opponent_id);
  out << "{\"self_alive\":"
      << (self_it != msg.players.end() && self_it->second->alive ? 1 : 0)
      << ",\"opp_alive\":"
      << (opponent_it != msg.players.end() && opponent_it->second->alive ? 1 : 0)
      << ",\"self_score\":"
      << (self_it != msg.players.end() ? self_it->second->score : 0)
      << ",\"opp_score\":"
      << (opponent_it != msg.players.end() ? opponent_it->second->score : 0)
      << ",\"self_hp\":"
      << (self_it != msg.players.end() ? self_it->second->hp : 0)
      << ",\"opp_hp\":"
      << (opponent_it != msg.players.end() ? opponent_it->second->hp : 0)
      << "}";
}

void Configure(dl_bot::RuleSearchBot &bot, bool hybrid,
               const std::string &model) {
  bot.set_hard_mode(true);
  bot.set_search_depth(6);
  bot.set_search_rollouts(2);
  bot.set_min_rule_gap(0.05);
  bot.set_rollout_mode(0);
  bot.set_search_in_danger(false);
  bot.set_move_order_mode(4);
  bot.set_bomb_time(3);
  if (hybrid) {
    bot.set_policy_prior_weight(0.005);
    if (!bot.LoadPolicyModel(model)) {
      std::cerr << "failed to load model\n";
      std::exit(2);
    }
  }
}

} // namespace

int main(int argc, char **argv) {
  if (argc != 6) {
    std::cerr << "usage: search_trace <model> <seed> <steps> <hybrid 0/1> <out>\n";
    return 1;
  }
  const std::string model = argv[1];
  const uint64_t seed = std::strtoull(argv[2], nullptr, 10);
  const int max_steps = std::max(1, std::atoi(argv[3]));
  const bool hybrid = std::atoi(argv[4]) != 0;
  std::ofstream out(argv[5], std::ios::trunc);
  if (!out.is_open()) return 1;

  dl_bot::SimConfig config;
  config.seed = seed;
  config.max_round = 400;
  dl_bot::GameSim sim(config);
  sim.Init();
  const int search_id = sim.player_ids()[0];
  const int opponent_id = sim.player_ids()[1];

  dl_bot::RuleSearchBot search;
  Configure(search, hybrid, model);
  Bot opponent;
  opponent.set_hard_mode(true);
  opponent.set_bomb_time(config.bomb_time);
  opponent.set_move_order_mode(4);
  search.ResetForNewGame();
  opponent.ResetForNewGame();
  Bot::ResetMoveShuffleRngForThread();
  SeedCup dummy("src/config.json", "search_trace");

  out << "{\"seed\":" << seed << ",\"hybrid\":" << (hybrid ? 1 : 0)
      << ",\"player_id\":" << search_id << ",\"steps\":[";
  int emitted = 0;
  while (!sim.IsOver() && emitted < max_steps) {
    auto msg = sim.BuildMsg(search_id);
    auto opponent_msg = sim.BuildMsg(opponent_id);
    std::vector<seedcup::ActionType> search_actions;
    auto search_player = msg.players[search_id];
    for (int sub = 0; sub < search_player->speed &&
                      emitted < max_steps; sub++) {
      auto snapshot = dl_bot::DeepCopyGameMsg(msg);
      auto action = search.CalcOnce(msg, dummy);
      const auto &decision = search.last_decision();
      if (emitted) out << ",";
      out << "{\"sub\":" << sub << ",\"msg\":";
      JsonMsg(out, snapshot);
      out << ",\"baseline\":" << decision.baseline_oper_idx
          << ",\"chosen\":" << decision.chosen_oper_idx
          << ",\"action\":" << static_cast<int>(action)
          << ",\"scores\":";
      JsonDoubleVec(out, decision.action_scores);
      out << ",\"priors\":";
      JsonDoubleVec(out, decision.policy_priors);
      out << ",\"scorer_bomb_first_seen\":[";
      bool first_tracker = true;
      for (const auto &[bomb_id, first_round] :
           search.scorer_.bomb_first_seen_round_) {
        if (!first_tracker) out << ",";
        first_tracker = false;
        out << "[" << bomb_id << "," << first_round << "]";
      }
      out << "]}";
      emitted++;
      if (action != seedcup::SILENT) search_actions.push_back(action);
    }
    std::vector<seedcup::ActionType> opponent_actions;
    auto opponent_player = opponent_msg.players[opponent_id];
    for (int sub = 0; sub < opponent_player->speed; sub++) {
      auto next = opponent.CalcOnce(opponent_msg, dummy);
      if (next != seedcup::SILENT) opponent_actions.push_back(next);
    }
    std::unordered_map<int, std::vector<seedcup::ActionType>> actions;
    actions[search_id] = std::move(search_actions);
    actions[opponent_id] = std::move(opponent_actions);
    sim.Step(actions);
  }
  out << "]}\n";
}
