# C++ 对拍数据生成器

本目录保存网页端一致性测试所使用的 C++ fixture 生成器。它们分别以
SeedCup 2023 官方服务端和 `seedcup-cppsdk` 的当前实现为权威来源。

## 官方服务端 fixture

以下命令假设官方服务端仓库位于相邻目录 `../seedcup2023`。

### 地图与随机数

官方服务端生产代码使用五个独立随机引擎，其中方块和出生点洗牌由
`std::random_device` 播种，无法通过配置固定。生成器把这五个引擎显式播成同一个
测试 seed，只改变可复现性，不改变随机算法、短路判断或随机数消费顺序。

```bash
g++ -O2 -std=c++17 \
  tools/cpp-fixtures/server_generation_fixture.cpp \
  -o /tmp/server_generation_fixture

/tmp/server_generation_fixture 20260731 \
  > fixtures/server_generation_seed20260731.json
```

### 规则场景

规则场景直接编译官方 `Game`，并通过真实的 `Game::AddAction` 与
`Game::FlushTime` 执行动作额度、推弹、倒计时、爆炸和胜负结算。

```bash
cd ../seedcup2023/src

g++ -O2 -std=c++17 \
  -I . -I util -I server -I server/game \
  -isystem /tmp/seedcup_server_deps/root/usr/include \
  ../../seedcup-web/tools/cpp-fixtures/server_scenario_fixture.cpp \
  server/game/game.cpp util/config.cpp \
  /tmp/seedcup_server_deps/root/usr/lib/x86_64-linux-gnu/libfmt.a \
  -lpthread -o /tmp/server_scenario_fixture
```

运行前使用独立测试配置关闭地图打印和快照，并固定 `seed_random`。多人场景同理，
但配置中的 `player_num` 设为 `4`。

## 搜索 fixture

以下命令假设 C++ Bot SDK 位于相邻目录 `../seedcup-cppsdk`，且已经构建
`src/build/libdl_bot_lib.a` 和 `src/build/libdeeplearning_static.a`。

```bash
cd ../seedcup-cppsdk

g++ -O3 -DNDEBUG -std=gnu++17 \
  -I src/util -I src \
  -I src/third_party/deeplearning/src/deeplearning \
  -I src/third_party/deeplearning/src \
  ../seedcup-web/tools/cpp-fixtures/search_trace_export.cpp \
  src/build/libdl_bot_lib.a src/build/libdeeplearning_static.a \
  -lpthread -o /tmp/search_trace_export

/tmp/search_trace_export \
  src/dl_bot_model_hard_rnnh512_actionctx_exactcf_head128_anchor075_mix050.rnn \
  42 120 0 ../seedcup-web/fixtures/search_rule_seed42.json

/tmp/search_trace_export \
  src/dl_bot_model_hard_rnnh512_actionctx_exactcf_head128_anchor075_mix050.rnn \
  42 120 1 ../seedcup-web/fixtures/search_hybrid_seed42.json
```

`search_trace_export.cpp` 不执行额外诊断评分，避免调试调用推进 scorer 的炸弹跟踪
状态。TypeScript 对拍要求 baseline、chosen、最终动作、六个候选分数和炸弹
tracker 全部一致；混合版本的 RNN prior 允许 `1e-9` 以内的浮点舍入误差。

## 比赛版 easy fixture

easy 的唯一权威实现锁定为 C++ SDK 提交 `c7cdf9e`（`feat:添加手套`）中的
`src/bot.h`。不要使用后续训练分支当前的 `src/bot.h` 重新生成 easy fixture；
后续分支曾加入并发炸弹安全约束，会改变多人局动作并造成机器人互相避让。
该文件的 SHA-256 为
`ec37e5f86846108fe1028936192d0dd9773c8d7887a915792f7577cc1a7b624c`。

生成时先导出历史头文件：

```bash
cd ../seedcup-cppsdk
mkdir -p /tmp/contest-easy
git show c7cdf9e:src/bot.h > /tmp/contest-easy/bot.h
```

`easy_trace_export.cpp` 生成两人连续 fixture，
`easy_multiplayer_trace_export.cpp` 生成四人连续 fixture。它们直接 include 上述
历史头文件，并按真实 SDK `ParseMap` 的逐格解析顺序重建 `GameMsg`。

比赛版使用 `std::random_shuffle`，底层是 glibc `rand()`。四人生成器通过
`initstate/setstate` 为四个 bot 保存独立随机状态，等价于四个独立 C++ 客户端
进程。TypeScript 端使用逐值兼容的 `GlibcRand`，两人和四人 fixture 都要求动作
分歧严格为 `0`。

`contest_easy_replay.cpp` 用于复核网页实际长局。先记录每次决策前的完整状态与
TypeScript 动作，再由该工具按 SDK `ParseMap` 的网格扫描顺序重建 `GameMsg`，
并用四个独立比赛版 Bot 连续回放。当前额外验证的两组 15×15 四人长局分别包含
`687` 和 `657` 个决策，动作分歧均为 `0`。
