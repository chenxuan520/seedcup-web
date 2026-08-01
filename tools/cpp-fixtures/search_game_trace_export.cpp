#include "bot.h"
#include "dl/game_sim.h"
#include "dl/rule_search_bot.h"

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

struct CapturedDecision {
  dl_bot::RuleSearchBot::SearchDecision decision;
  std::vector<std::pair<int, int>> tracker;
};

void JsonActions(std::ostream &out,
                 const std::vector<seedcup::ActionType> &actions) {
  out << "[";
  for (size_t index = 0; index < actions.size(); ++index) {
    if (index) out << ",";
    out << static_cast<int>(actions[index]);
  }
  out << "]";
}

void JsonInts(std::ostream &out, const std::vector<int> &values) {
  out << "[";
  for (size_t index = 0; index < values.size(); ++index) {
    if (index) out << ",";
    out << values[index];
  }
  out << "]";
}

void JsonDoubles(std::ostream &out, const std::vector<double> &values) {
  out << "[";
  for (size_t index = 0; index < values.size(); ++index) {
    if (index) out << ",";
    out << std::setprecision(17) << values[index];
  }
  out << "]";
}

void JsonDecision(std::ostream &out,
                  const CapturedDecision &captured) {
  const auto &decision = captured.decision;
  out << "{\"baseline\":" << decision.baseline_oper_idx
      << ",\"chosen\":" << decision.chosen_oper_idx << ",\"scores\":";
  JsonDoubles(out, decision.action_scores);
  out << ",\"priors\":";
  JsonDoubles(out, decision.policy_priors);
  out << ",\"tracker\":[";
  for (size_t index = 0; index < captured.tracker.size(); ++index) {
    if (index) out << ",";
    const auto &[bomb_id, round] = captured.tracker[index];
    out << "[" << bomb_id << "," << round << "]";
  }
  out << "]}";
}

void ConfigureSearch(dl_bot::RuleSearchBot &search, bool hybrid,
                     const std::string &model) {
  search.set_hard_mode(true);
  search.set_search_depth(hybrid ? 3 : 6);
  search.set_search_rollouts(hybrid ? 1 : 2);
  search.set_min_rule_gap(0.05);
  search.set_rollout_mode(0);
  search.set_search_in_danger(false);
  search.set_move_order_mode(4);
  search.set_bomb_time(3);
  if (!hybrid) return;
  search.set_seed_move_rng_from_initial_map(true);
  search.set_policy_prior_weight(0.005);
  if (!search.LoadPolicyModel(model)) {
    throw std::runtime_error("failed to load policy model");
  }
}

std::vector<seedcup::ActionType>
Drive(Bot &bot, int player_id, seedcup::GameMsg msg, SeedCup &server,
      dl_bot::RuleSearchBot *search,
      std::vector<CapturedDecision> *decisions) {
  auto player = msg.players.find(player_id);
  if (player == msg.players.end() || !player->second ||
      !player->second->alive) {
    return {};
  }
  int speed = player->second->speed;
  if (!bot.hard_mode()) {
    player->second->speed = 1;
    speed = 1;
  }
  std::vector<seedcup::ActionType> actions;
  for (int sub = 0; sub < speed; ++sub) {
    const auto action = bot.CalcOnce(msg, server);
    if (search && decisions) {
      CapturedDecision captured;
      captured.decision = search->last_decision();
      for (const auto &[bomb_id, round] :
           search->scorer_bomb_first_seen_round_for_debug()) {
        captured.tracker.push_back({bomb_id, round});
      }
      decisions->push_back(std::move(captured));
    }
    if (action != seedcup::SILENT) actions.push_back(action);
  }
  return actions;
}

} // namespace

int main(int argc, char **argv) {
  if (argc != 7) {
    std::cerr << "usage: search_game_trace <model> <seed> <max_round> "
                 "<hybrid 0/1> <search_first 0/1> <out>\n";
    return 1;
  }
  const std::string model = argv[1];
  const uint64_t seed = std::strtoull(argv[2], nullptr, 10);
  const int max_round = std::max(1, std::atoi(argv[3]));
  const bool hybrid = std::atoi(argv[4]) != 0;
  const bool search_first = std::atoi(argv[5]) != 0;
  std::ofstream out(argv[6], std::ios::trunc);
  if (!out.is_open()) return 1;

  dl_bot::SimConfig config;
  config.seed = seed;
  config.max_round = max_round;
  dl_bot::GameSim sim(config);
  sim.Init();
  const int first_id = sim.player_ids()[0];
  const int second_id = sim.player_ids()[1];
  const int search_id = search_first ? first_id : second_id;

  dl_bot::RuleSearchBot search;
  ConfigureSearch(search, hybrid, model);
  Bot hard;
  hard.set_hard_mode(true);
  hard.set_contest_rules(true);
  hard.set_bomb_time(config.bomb_time);
  hard.set_move_order_mode(0);
  search.ResetForNewGame();
  hard.ResetForNewGame();
  Bot::ResetMoveShuffleRngForThread();
  SeedCup dummy("src/config.json", "search-game-trace");

  out << "{\"seed\":" << seed << ",\"hybrid\":" << (hybrid ? 1 : 0)
      << ",\"search_first\":" << (search_first ? 1 : 0)
      << ",\"initial\":";
  sim.ExportFullState(out, first_id);
  out << ",\"steps\":[";

  bool first_step = true;
  while (!sim.IsOver()) {
    std::vector<CapturedDecision> decisions;
    Bot &first_bot =
        first_id == search_id ? static_cast<Bot &>(search) : hard;
    Bot &second_bot =
        second_id == search_id ? static_cast<Bot &>(search) : hard;
    auto first_actions =
        Drive(first_bot, first_id, sim.BuildMsg(first_id), dummy,
              first_id == search_id ? &search : nullptr, &decisions);
    auto second_actions =
        Drive(second_bot, second_id, sim.BuildMsg(second_id), dummy,
              second_id == search_id ? &search : nullptr, &decisions);

    std::unordered_map<int, std::vector<seedcup::ActionType>> actions;
    actions[first_id] = first_actions;
    actions[second_id] = second_actions;
    sim.Step(actions);

    if (!first_step) out << ",";
    first_step = false;
    out << "{\"round\":" << sim.round() << ",\"p1_actions\":";
    JsonActions(out, first_actions);
    out << ",\"p2_actions\":";
    JsonActions(out, second_actions);
    out << ",\"search_decisions\":[";
    for (size_t index = 0; index < decisions.size(); ++index) {
      if (index) out << ",";
      JsonDecision(out, decisions[index]);
    }
    out << "],\"state\":";
    sim.ExportFullState(out, first_id);
    out << ",\"over\":" << (sim.IsOver() ? 1 : 0)
        << ",\"winners\":";
    JsonInts(out, sim.IsOver() ? sim.Winners() : std::vector<int>{});
    out << "}";
  }
  out << "],\"max_round\":" << max_round << "}\n";
  return 0;
}
