# SeedCup 2023 机器人竞技场

2023 年种子杯（SeedCup）炸弹人题目的浏览器交互版。项目使用 TypeScript 复刻服务端游戏状态与核心规则，并提供简单、困难、搜索、纯神经网络、神经网络加搜索五种机器人，可直接观看对局或手动参战。

在线体验：[https://chenxuan520.github.io/seedcup-web/](https://chenxuan520.github.io/seedcup-web/)

相关项目：

- [本项目源码](https://github.com/chenxuan520/seedcup-web)
- [官方服务端](https://github.com/chenxuan520/seedcup2023)
- [C++ Bot SDK](https://gitee.com/chenxuan520/seedcup-cppsdk)
- [C++ 深度学习库](https://github.com/chenxuan520/deeplearning)

## 功能

- 支持 2 至 4 名玩家，以及 11、13、15、17 四种地图尺寸
- 支持固定墙、泥墙、隐藏道具、炸弹、爆炸链、生命、护盾和无敌状态
- 支持种子复现、随机地图、暂停、单步、重置、倍速和对局日志
- 支持生命、炸弹数量、火力、速度、爆炸时间等高级对局参数
- 支持对局 JSON 导出与导入
- 支持键盘手动操作和五类机器人
- 浏览器内直接解析并运行 C++ 训练生成的 `DLRNNH1` 权重
- 每个机器人运行在独立 Web Worker 中，按返回顺序模拟多个 C++ 客户端向服务端并发提交动作
- 内置中文玩法帮助，说明胜负规则、地图元素、角色状态和七类道具图标

## 机器人

| 名称 | 主要逻辑 |
| --- | --- |
| 手动玩家 | 由键盘控制 |
| 简单 | 对齐 C++ easy bot，每回合固定执行一个动作 |
| 困难 | 对齐比赛提交 `c7cdf9e` 的 C++ hard bot，包含危险逃生、放弹安全判定和独立 glibc 随机方向序 |
| 更强搜索 | 在规则状态评估上进行有限深度搜索 |
| 纯神经网络 | 仅使用 RNN 策略输出，并执行与 C++ 一致的动作合法性过滤 |
| 神经网络加搜索 | 搜索为主，使用同一 RNN 策略作为小权重先验 |

纯神经网络和神经网络加搜索共用一份权重，不存在第二个模型文件。

首次进入页面时，蓝方默认是简单机器人，红方默认是纯神经网络，直接展示训练模型与官方 easy 的对战效果。需要手动参战时，可在右侧“对局设置”中把任意座位切换为手动玩家。

## 并发模型

浏览器主线程对应原 C++ 服务端，每个非手动玩家对应一个独立 Web Worker 客户端：

1. 每回合开始时，主线程向所有 Worker 发送同一份只读状态快照。
2. 每个 Worker 独立保留规则 bot 状态、方向随机数状态或 RNN hidden/history。
3. Worker 在自己的线程内计算完整动作数组。
4. 哪个 Worker 先返回，主线程就先按数组顺序执行哪个客户端的动作。
5. 全部客户端返回或达到当前回合截止时间后，统一移动炸弹、结算爆炸并推进回合。

这与原项目“多个 C++ 客户端独立计算并发回包，服务端单线程按网络到达顺序 `AddAction`，定时器统一 `FlushTime`”的执行边界一致。

服务端地图概率、隐藏道具、炸弹时长、泥墙洗牌和出生点洗牌使用彼此独立的
C++ 随机引擎。网页把用户输入的 seed 分别注入这些引擎，因此同一 seed 可以复现；
官方服务端生产代码中的两个洗牌引擎由 `std::random_device` 播种，本身没有固定
seed 复现接口。

默认道具权重与当前官方服务端同步为
`火力12:炸弹12:回血4:无敌1:护盾4:加速6:手套6`。六类普通道具保持原来的
相对比例并统一扩大两倍，无敌数量保持为 `1`，其在已生成道具中的占比由
`1/23` 降为 `1/45`。

## 安装运行

需要 Node.js 20 或更新版本。

```bash
npm install
npm run dev
```

打开终端输出的本地地址即可使用。需要让局域网内其他设备访问时：

```bash
npm run dev -- --host 0.0.0.0
```

### 静态部署

这个项目不需要 Node.js 服务端或模型推理服务。构建时，Vite 会把模型原样复制到 `dist/models/pure-nn.rnn`；页面打开后，浏览器通过 HTTP 下载模型文本，在本地解析并完成推理：

```bash
npm run build
```

将整个 `dist/` 目录部署到任意静态托管服务即可，例如 GitHub Pages、Vercel、Netlify、Nginx 或对象存储静态网站。构建产物使用相对基路径，既支持部署到域名根目录，也支持部署到 `/seedcup-web/` 一类子目录。

仓库内置 `.github/workflows/pages.yml`。推送 `main` 后，GitHub Actions 会自动构建并发布到 GitHub Pages，无需提交 `dist/`。

部署时需要注意：

- 必须部署整个 `dist/`，尤其不能漏掉 `dist/models/pure-nn.rnn`
- 静态服务器应允许访问 `.rnn` 文件；推荐返回 `text/plain` 或 `application/octet-stream`
- 建议开启 gzip 或 Brotli，模型由 6.25 MiB 文本压缩到约 2 MiB 后传输
- 建议为模型配置长期缓存；更新权重时需要同步调整缓存策略
- 页面模型推理完全发生在访问者浏览器中，不占用服务器 CPU

本地检查生产构建：

```bash
npm run build
npm run preview -- --host 0.0.0.0
```

### 准备模型

仓库已经包含网页当前使用的 `public/models/pure-nn.rnn`，克隆后可以直接运行。它不是 JSON，也不是传统二进制模型，而是 C++ 训练程序使用的 `DLRNNH1` 自定义纯文本权重格式：文件头记录网络结构，后续每行保存一个浮点参数。

需要替换或恢复模型时，准备脚本会接受显式路径，并尝试相邻目录中的 `seedcup-cppsdk`：

```bash
npm run prepare:model -- /path/to/dl_bot_model_hard_rnnh512_actionctx_exactcf_head128_anchor075_mix050.rnn
```

也可以使用环境变量：

```bash
SEEDCUP_MODEL=/path/to/model.rnn npm run prepare:model
```

脚本会校验模型格式和 SHA-256，然后复制为 `public/models/pure-nn.rnn`。`.gitignore` 仍会排除其他实验权重，避免误提交训练过程产生的大量模型。当前适配权重的信息如下：

| 属性 | 值 |
| --- | --- |
| 格式 | `DLRNNH1` |
| 输入维度 | 1616 |
| 隐藏层维度 | 512 |
| 输出动作数 | 6 |
| Head 维度 | 128 |
| 文件大小 | 6,552,867 字节，约 6.25 MiB |
| SHA-256 | `33399908cac62017cef4446083ef9ead4a3e25b73d18992f6718c3d40117614b` |

模型输入由 1426 维 `FeatureExtractorV2`、16 维动作历史、30 维结果特征和 144 维动作上下文组成。TypeScript 端按 C++ 公式逐项实现，并保留连续 RNN hidden state、动作历史与炸弹跟踪状态。

## 操作

- `WASD` 或方向键：移动
- 空格：放置炸弹
- 页面控制栏：开始、暂停、单步、重置和切换速度
- 设置齿轮：调整地图、人数和高级对局参数
- 顶栏“玩法帮助”：查看完整玩法、地图图例、状态效果和道具说明

推荐展示组合：

- 简单机器人 对 纯神经网络：默认组合，直接观看训练模型效果
- 搜索增强 对 困难：展示浅层 rollout 与 RNN 先验；这是实验策略，不代表真实服务端强于困难
- 纯神经网络 对 简单：展示独立 NN 策略
- 手动玩家 对 困难或更强搜索：体验实际对战

## 验证

安装依赖并准备模型后，可运行核心验证：

```bash
npm run test:all
```

该命令依次执行生产构建、官方服务端地图/RNG/规则/4 人场景对拍、搜索与混合
搜索对拍、单帧和连续 NN 对拍、比赛版 easy 两人/四人动作对拍、比赛版 hard
连续动作对拍、搜索正反手整局对拍、速度规则检查以及 bot 无卡死测试。

浏览器 E2E 会自行启动临时预览服务，验证 2 人和 4 人对局、随机地图、种子复现、爆炸效果、高级设置以及导出导入：

```bash
npx playwright install chromium
npm run test:browser
```

当前固定 fixture 的对拍结果：

- 原服务端可控 seed 下，方块 ID/位置/隐藏道具、4 个出生点和连续 64 次炸弹随机值完全一致
- 原服务端动作额度、推弹、倒计时、爆炸、死亡坐标、格子爆炸轮次和胜负场景完全一致
- 原服务端 4 人同格无敌碰撞中，玩家集合顺序、伤害、护盾与状态递减完全一致
- 特征、历史、结果特征、动作上下文和完整输入的最大误差均为 `0`
- 40 步输出概率最大误差为 `1.734723475976807e-18`
- 40 步 top action 不一致数为 `0`
- 比赛版 C++ easy（提交 `c7cdf9e`）与 TypeScript easy：两人连续 `47` 步、四人连续 `236` 步动作不一致数均为 `0`
- 比赛版 C++ hard（提交 `c7cdf9e`）与 TypeScript hard：连续 `217` 个动作及状态摘要不一致数为 `0`
- C++ RuleSearch/HybridSearch 共 `224` 个子步的 baseline、chosen、最终动作、六个候选分数和炸弹 tracker 不一致数为 `0`
- HybridSearch 对比赛版 hard 的正反手整局 `100 / 62` 回合动作、搜索决策和完整状态摘要不一致数为 `0`
- easy 安全脚本仅报告自炸、推弹和到达顺序竞态，不作为修改比赛版算法的依据；easy 的唯一硬门槛是 C++ 动作逐项一致
- 同 `seed=1000..1059`、同 C++ `GameSim` 裁判下，C++/TypeScript 的 winner 和结束回合均为 `60 / 60` 一致
- 生产 `src` 覆盖率：statements `97.37%`、branches `90.66%`、functions `98.32%`、lines `98.72%`

以下模型胜率仅描述对应裁判和参数，不代表搜索增强已经战胜 hard：

| 评估 | 结果 |
| --- | --- |
| TypeScript，同 seed、C++ `GameSim`、NN 固定 P1、纯 NN 对比赛版 easy | 53 / 60，88.33% |
| C++，同 seed、同 `GameSim`、NN 固定 P1、纯 NN 对比赛版 easy | 53 / 60，88.33% |
| 网页随机地图 paired，纯 NN 对 easy | 97 / 120，80.83% |
| 网页随机地图，纯 NN 对 hard | 15 / 60，25.0% |

搜索增强在原 C++ 服务端上的固定 seed 正反手配对结果为 `2 / 10`。因此当前
搜索增强只作为算法实验展示，不能宣称真实服务端强于比赛版 hard。完整根因、
评测口径和整改过程见
[事故复盘与工程整改报告](docs/事故复盘与工程整改报告.md)。

## 对齐方法

`fixtures/` 保存由 C++ 导出的服务端状态、特征和推理结果。`tools/cpp-fixtures/`
保存对应生成器和复现说明。单帧对拍用于定位静态特征或前向计算偏差，连续对拍
覆盖 RNN hidden state、动作历史、炸弹跟踪和多轮状态更新。easy 专项对拍使用
C++ `Bot::CalcOnce` 导出的连续状态与动作，验证 TypeScript 的 BFS、放弹判定、
方向随机序和安全约束。

官方服务端和 C++ 训练 `GameSim` 是两套不同裁判：网页主体验按官方服务端的
`AddAction/FlushTime`、独立 RNG 和推弹规则运行；搜索 rollout 与训练胜率回归按
C++ `GameSim` 运行。测试和文档分别标明裁判，不把两套语义混为一谈。

## 目录

```text
src/engine.ts                  游戏状态、地图与回合模拟
src/bots.ts                    规则、搜索、纯 NN 与混合机器人
src/bot-worker.ts              独立机器人 Worker 客户端
src/bot-protocol.ts            主线程与 Worker 消息协议
src/cpp-random.ts              C++ std::mt19937 / std::shuffle 对齐实现
src/cpp-game-sim.ts            C++ 训练 GameSim 与搜索 rollout
src/rnn.ts                     DLRNNH1 解析、特征提取与推理
src/main.ts                    页面结构、交互与 Canvas 绘制
src/app.css                    页面样式与响应式布局
fixtures/                      C++/TypeScript 对拍数据
scripts/prepare-model.sh       本地模型准备与校验
scripts/check-nn-parity.ts     单帧数值对拍
scripts/check-nn-sequence.ts   连续 40 步数值对拍
scripts/check-easy-parity.ts   比赛版 C++/TypeScript easy 两人动作对拍
scripts/check-easy-multiplayer-parity.ts  比赛版 easy 四人连续动作对拍
scripts/check-easy-safety.ts   easy 风险观测，不改变原算法
scripts/check-server-*.ts      官方服务端生成、规则与 4 人场景对拍
scripts/check-hard-parity.ts   比赛版 hard 连续动作与状态摘要对拍
scripts/check-search-parity.ts RuleSearch/HybridSearch 子步级对拍
scripts/check-search-game-trace.ts  HybridSearch 正反手整局对拍
scripts/eval-real-server-hybrid.sh  原 C++ 服务端固定 seed 配对评测
tools/cpp-fixtures/            C++ fixture 生成器与复现说明
scripts/run-browser-tests.sh   自启动服务的浏览器 E2E
```
