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

## 机器人

| 名称 | 主要逻辑 |
| --- | --- |
| 手动玩家 | 由键盘控制 |
| 简单 | 对齐 C++ easy bot，每回合固定执行一个动作 |
| 困难 | 对齐 C++ hard bot，包含危险逃生、放弹安全判定和动态方向序 |
| 更强搜索 | 在规则状态评估上进行有限深度搜索 |
| 纯神经网络 | 仅使用 RNN 策略输出，并执行与 C++ 一致的动作合法性过滤 |
| 神经网络加搜索 | 搜索为主，使用同一 RNN 策略作为小权重先验 |

纯神经网络和神经网络加搜索共用一份权重，不存在第二个模型文件。

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

推荐展示组合：

- 更强搜索 对 困难：展示规则和搜索效果
- 纯神经网络 对 简单：展示独立 NN 策略
- 手动玩家 对 困难或更强搜索：体验实际对战

## 验证

安装依赖并准备模型后，可运行核心验证：

```bash
npm run test:all
```

该命令依次执行生产构建、单帧 NN 对拍、40 步连续 NN 对拍、easy 单步规则检查和 bot 无卡死测试。

浏览器 E2E 会自行启动临时预览服务，验证 2 人和 4 人对局、随机地图、种子复现、爆炸效果、高级设置以及导出导入：

```bash
npx playwright install chromium
npm run test:browser
```

当前固定 fixture 的对拍结果：

- 特征、历史、结果特征、动作上下文和完整输入的最大误差均为 `0`
- 40 步输出概率最大误差为 `1.734723475976807e-18`
- 40 步 top action 不一致数为 `0`

当前留档胜率用于回归，不代表所有地图和参数下的保证值：

| 评估 | 结果 |
| --- | --- |
| 网页随机地图 paired，纯 NN 对 easy | 107 / 120，89.2% |
| 网页随机地图，纯 NN 对 hard | 15 / 60，25.0% |
| C++ GameSim 同地图集，纯 NN 对 easy | 58 / 60，96.7% |
| C++ `dl_eval` 基准，纯 NN 对 easy | 55 / 60，91.7% |

## 对齐方法

`fixtures/` 保存由 C++ 导出的状态、特征和推理结果。单帧对拍用于定位静态特征或前向计算偏差，连续对拍则覆盖 RNN hidden state、动作历史、炸弹跟踪和多轮状态更新。

网页实现用于交互展示，关键行为以官方服务端和 C++ `GameSim` 为对齐基准。涉及正式比赛结论或大规模胜率统计时，仍应以 C++ evaluator 为准。

## 目录

```text
src/engine.ts                  游戏状态、地图与回合模拟
src/bots.ts                    规则、搜索、纯 NN 与混合机器人
src/rnn.ts                     DLRNNH1 解析、特征提取与推理
src/main.ts                    页面结构、交互与 Canvas 绘制
src/app.css                    页面样式与响应式布局
fixtures/                      C++/TypeScript 对拍数据
scripts/prepare-model.sh       本地模型准备与校验
scripts/check-nn-parity.ts     单帧数值对拍
scripts/check-nn-sequence.ts   连续 40 步数值对拍
scripts/run-browser-tests.sh   自启动服务的浏览器 E2E
```
