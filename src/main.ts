import './app.css';
import {
  Action,
  BombStatus,
  type BlockMeta,
  type Cell,
  Item,
  Rng,
  ServerRng,
  applyActionBatch,
  createGame,
  dangerInfo,
  defaultConfig,
  flushRound,
  serializeGameState,
  synchronizeServerIdCounters,
  type BotController,
  type GameState,
  type SerializedGameState,
  type StepEvent,
} from './engine';
import { HybridSearchBot, ManualBot, PureNnBot, RuleBot, SearchBot } from './bots';
import { loadPureNnPolicy, type PureNnPolicy } from './rnn';
import type {
  BotId,
  BotWorkerResponse,
} from './bot-protocol';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <div class="logo">✦</div>
      <div>
        <h1>SeedCup 机器人竞技场</h1>
        <p class="sub">2023 年种子杯 SeedCup 题目 · 浏览器炸弹人对战</p>
      </div>
    </div>
    <div class="topbar-actions">
      <button class="help-trigger" id="helpBtn" type="button" aria-haspopup="dialog" aria-controls="helpDialog">
        <span class="help-trigger-icon" aria-hidden="true">?</span>
        <span>玩法帮助</span>
      </button>
      <div class="status-pill" id="modelStatus"><span class="dot"></span><span id="modelText">正在加载神经网络模型…</span></div>
    </div>
  </header>

  <div class="layout">
    <aside class="player-rail">
      <section class="card card-pad player-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">实时数据</span>
            <h2>玩家状态</h2>
          </div>
          <span class="live-indicator"><i></i>LIVE</span>
        </div>
        <div id="stats"></div>
      </section>
    </aside>

    <main class="card card-pad arena-panel">
      <div class="stage-head">
        <div class="versus" id="versus"></div>
        <div class="round-badge" id="roundBadge">回合 0</div>
      </div>

      <div class="board-wrap">
        <canvas id="board" width="780" height="780"></canvas>
        <div class="winner-overlay" id="winnerOverlay">
          <div class="winner-card">
            <div class="big" id="winnerBig">—</div>
            <div class="sub" id="winnerSub"></div>
          </div>
        </div>
      </div>

      <div class="controls">
        <button class="btn primary" id="playBtn">开始</button>
        <button class="btn" id="stepBtn">单步</button>
        <button class="btn" id="resetBtn">重开</button>
        <div class="speed-control">
          <span>速度</span>
          <input id="speedInput" type="range" min="1" max="12" value="6" />
        </div>
      </div>

      <div class="legend">
        <span><i class="lg-blue"></i>蓝方</span>
        <span><i class="lg-red"></i>红方</span>
        <span><i class="lg-wall"></i>墙壁</span>
        <span><i class="lg-mud"></i>泥墙</span>
        <span><i class="lg-bomb"></i>炸弹</span>
        <span><i class="lg-danger"></i>爆炸范围</span>
        <span><i class="lg-item"></i>道具</span>
      </div>

      <section class="manual-panel">
        <div class="manual-copy">
          <span class="panel-kicker">手动玩家</span>
          <h2>方向与炸弹</h2>
          <p>键盘 WASD / 方向键移动，空格放置炸弹。</p>
        </div>
        <div class="dpad">
          <button class="up" data-action="3" aria-label="向上">↑</button>
          <button class="left" data-action="1" aria-label="向左">←</button>
          <button class="stay" data-action="0" aria-label="原地等待">·</button>
          <button class="right" data-action="2" aria-label="向右">→</button>
          <button class="down" data-action="4" aria-label="向下">↓</button>
          <button class="bomb" data-action="5">放炸弹</button>
        </div>
      </section>
    </main>

    <aside class="control-rail">
      <section class="card card-pad settings-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Match setup</span>
            <h2>对局设置</h2>
          </div>
        </div>
        <div class="field two-col">
          <div>
            <label>玩家数量</label>
            <div class="select-wrap"><select id="playerNum">
              <option value="2">2 人</option>
              <option value="3">3 人</option>
              <option value="4">4 人</option>
            </select></div>
          </div>
          <div>
            <label>地图大小</label>
            <div class="select-wrap"><select id="mapSize">
              <option value="11">11 × 11</option>
              <option value="13" selected>13 × 13</option>
              <option value="15">15 × 15</option>
              <option value="17">17 × 17</option>
            </select></div>
          </div>
        </div>
        <div id="botSelectors"></div>
        <div class="field">
          <label>随机种子（留空 = 每局随机地图）</label>
          <div class="seed-row">
            <input id="seedInput" type="number" placeholder="随机" />
            <button class="btn" id="shuffleBtn" title="换一张随机地图">换地图</button>
          </div>
        </div>
        <div class="io-actions">
          <button class="btn" id="exportBtn">导出对局</button>
          <button class="btn" id="importBtn">导入对局</button>
          <input id="importFile" type="file" accept="application/json,.json" hidden />
        </div>
        <details class="advanced-settings">
          <summary><span class="gear">⚙</span><span>高级设置</span></summary>
          <div class="advanced-grid">
            <label>爆炸时间
              <input id="bombTimeInput" type="number" min="1" max="12" value="3" />
            </label>
            <label>炸弹随机延迟
              <input id="bombRandomInput" type="number" min="0" max="6" value="1" />
            </label>
            <label>初始速度
              <input id="playerSpeedInput" type="number" min="1" max="8" value="2" />
            </label>
            <label>初始炸弹
              <input id="bombNumInput" type="number" min="1" max="8" value="2" />
            </label>
            <label>初始火力
              <input id="bombRangeInput" type="number" min="1" max="8" value="1" />
            </label>
            <label>初始血量
              <input id="playerHpInput" type="number" min="1" max="10" value="1" />
            </label>
            <label>血量上限
              <input id="maxHpInput" type="number" min="1" max="10" value="3" />
            </label>
            <label>泥墙概率
              <input id="mudRandomInput" type="number" min="0" max="100" value="75" />
            </label>
            <label>道具概率
              <input id="potionProbabilityInput" type="number" min="0" max="100" value="50" />
            </label>
            <label>随机墙概率
              <input id="wallRandomInput" type="number" min="0" max="100" value="25" />
            </label>
            <label>最大回合
              <input id="maxRoundInput" type="number" min="50" max="3000" value="1200" />
            </label>
          </div>
        </details>
        <div class="field-note" id="botNote"></div>
      </section>

      <section class="card card-pad source-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">SeedCup 2023</span>
            <h2>题目与实现</h2>
          </div>
        </div>
        <p>2023 年种子杯炸弹人对战题。网页规则、机器人和神经网络推理均与 C++ 实现对拍。</p>
        <div class="source-links">
          <a href="https://github.com/chenxuan520/seedcup2023" target="_blank" rel="noreferrer">官方服务端</a>
          <a href="https://gitee.com/chenxuan520/seedcup-cppsdk" target="_blank" rel="noreferrer">C++ Bot SDK</a>
          <a href="https://github.com/chenxuan520/deeplearning" target="_blank" rel="noreferrer">深度学习库</a>
        </div>
      </section>

      <section class="card card-pad log-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Round events</span>
            <h2>对局日志</h2>
          </div>
        </div>
        <div class="log" id="log"></div>
      </section>
    </aside>
  </div>

  <dialog class="help-dialog" id="helpDialog" aria-labelledby="helpTitle">
    <div class="help-shell">
      <header class="help-head">
        <div>
          <span class="help-kicker">SeedCup 2023</span>
          <h2 id="helpTitle">炸弹人玩法说明</h2>
          <p>默认由你控制蓝方，直接挑战红方纯神经网络。</p>
        </div>
        <button class="help-close" id="helpCloseBtn" type="button" aria-label="关闭帮助" title="关闭">×</button>
      </header>

      <div class="help-body">
        <section class="help-section help-quickstart">
          <div class="help-section-title">
            <span class="help-step">01</span>
            <div>
              <h3>快速开始</h3>
              <p>看到右上角“神经网络模型已加载”后即可开始。</p>
            </div>
          </div>
          <div class="help-flow">
            <div><strong>蓝方</strong><span>默认是你</span></div>
            <span class="help-vs">VS</span>
            <div class="nn"><strong>红方</strong><span>默认是纯神经网络</span></div>
          </div>
          <ol class="help-steps">
            <li>使用 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 或方向键移动。</li>
            <li>按 <kbd>空格</kbd> 放炸弹，及时离开红色危险范围。</li>
            <li>炸开泥墙拾取道具，设法让对手生命归零。</li>
          </ol>
        </section>

        <section class="help-section">
          <div class="help-section-title">
            <span class="help-step">02</span>
            <div>
              <h3>胜负与炸弹</h3>
              <p>炸弹倒计时结束后沿上下左右爆炸，墙体会阻挡火焰。</p>
            </div>
          </div>
          <div class="help-rules">
            <div><span class="rule-mark survive"></span><strong>最后存活</strong><p>场上只剩一名玩家时，该玩家立即获胜。</p></div>
            <div><span class="rule-mark score"></span><strong>回合上限</strong><p>达到最大回合或无人存活时，按分数判定胜者。</p></div>
            <div><span class="rule-mark blast"></span><strong>连锁爆炸</strong><p>爆炸会引爆范围内的其他炸弹，泥墙被炸毁后可能掉落道具。</p></div>
          </div>
        </section>

        <section class="help-section">
          <div class="help-section-title">
            <span class="help-step">03</span>
            <div>
              <h3>地图图例</h3>
              <p>颜色与棋盘中的实际显示一致。</p>
            </div>
          </div>
          <div class="help-map-grid">
            <div class="help-map-item"><span class="map-swatch player blue"></span><div><strong>蓝方玩家</strong><p>默认由进入页面的用户控制。</p></div></div>
            <div class="help-map-item"><span class="map-swatch player red"></span><div><strong>红方玩家</strong><p>默认使用纯神经网络策略。</p></div></div>
            <div class="help-map-item"><span class="map-swatch wall"></span><div><strong>固定墙</strong><p>不可穿越，也无法被炸毁。</p></div></div>
            <div class="help-map-item"><span class="map-swatch mud"></span><div><strong>泥墙</strong><p>可被炸毁，内部可能藏有道具。</p></div></div>
            <div class="help-map-item"><span class="map-swatch bomb">3</span><div><strong>炸弹</strong><p>数字是剩余倒计时，爆炸呈十字形扩散。</p></div></div>
            <div class="help-map-item"><span class="map-swatch danger"></span><div><strong>危险范围</strong><p>红色呼吸区域表示即将被炸弹覆盖。</p></div></div>
          </div>
        </section>

        <section class="help-section">
          <div class="help-section-title">
            <span class="help-step">04</span>
            <div>
              <h3>道具图标</h3>
              <p>炸开泥墙后，道具会出现在空地上，走过去即可拾取。</p>
            </div>
          </div>
          <div class="help-item-grid">
            <div class="help-item-card"><span class="help-item-icon fire">✣</span><div><strong>火力</strong><p>爆炸范围增加 1 格。</p></div></div>
            <div class="help-item-card"><span class="help-item-icon capacity">●<b>+</b></span><div><strong>炸弹</strong><p>可同时放置的炸弹上限增加 1。</p></div></div>
            <div class="help-item-card"><span class="help-item-icon heal">♥</span><div><strong>回血</strong><p>生命未满时恢复 1 点生命。</p></div></div>
            <div class="help-item-card"><span class="help-item-icon invincible">★</span><div><strong>无敌</strong><p>持续期间免疫伤害，接触其他玩家可造成致命伤害。</p></div></div>
            <div class="help-item-card"><span class="help-item-icon shield">⬟</span><div><strong>护盾</strong><p>抵消下一次伤害，受伤后也会获得短暂护盾。</p></div></div>
            <div class="help-item-card"><span class="help-item-icon speed">ϟ</span><div><strong>加速</strong><p>速度增加 1，每回合可执行更多移动。</p></div></div>
            <div class="help-item-card"><span class="help-item-icon gloves">✊</span><div><strong>手套</strong><p>向炸弹移动时可将静止炸弹推向该方向。</p></div></div>
          </div>
        </section>

        <section class="help-section help-status-section">
          <div class="help-section-title">
            <span class="help-step">05</span>
            <div>
              <h3>角色状态</h3>
              <p>角色周围的光环和右侧玩家状态会同步显示效果。</p>
            </div>
          </div>
          <div class="help-status-grid">
            <div><span class="status-ring invincible"></span><strong>金色光环</strong><p>当前处于无敌状态。</p></div>
            <div><span class="status-ring shield"></span><strong>青色光环</strong><p>当前拥有护盾保护。</p></div>
            <div><span class="status-ring hp"></span><strong>绿色生命点</strong><p>每个亮点代表 1 点当前生命。</p></div>
          </div>
        </section>
      </div>
    </div>
  </dialog>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const ctx = canvas.getContext('2d')!;
const playerNumSel = document.querySelector<HTMLSelectElement>('#playerNum')!;
const mapSizeSel = document.querySelector<HTMLSelectElement>('#mapSize')!;
const botSelectors = document.querySelector<HTMLDivElement>('#botSelectors')!;
const versusEl = document.querySelector<HTMLDivElement>('#versus')!;
const playBtn = document.querySelector<HTMLButtonElement>('#playBtn')!;
const stepBtn = document.querySelector<HTMLButtonElement>('#stepBtn')!;
const resetBtn = document.querySelector<HTMLButtonElement>('#resetBtn')!;
const speedInput = document.querySelector<HTMLInputElement>('#speedInput')!;
const seedInput = document.querySelector<HTMLInputElement>('#seedInput')!;
const shuffleBtn = document.querySelector<HTMLButtonElement>('#shuffleBtn')!;
const exportBtn = document.querySelector<HTMLButtonElement>('#exportBtn')!;
const importBtn = document.querySelector<HTMLButtonElement>('#importBtn')!;
const importFile = document.querySelector<HTMLInputElement>('#importFile')!;
const bombTimeInput = document.querySelector<HTMLInputElement>('#bombTimeInput')!;
const bombRandomInput = document.querySelector<HTMLInputElement>('#bombRandomInput')!;
const playerSpeedInput = document.querySelector<HTMLInputElement>('#playerSpeedInput')!;
const bombNumInput = document.querySelector<HTMLInputElement>('#bombNumInput')!;
const bombRangeInput = document.querySelector<HTMLInputElement>('#bombRangeInput')!;
const playerHpInput = document.querySelector<HTMLInputElement>('#playerHpInput')!;
const maxHpInput = document.querySelector<HTMLInputElement>('#maxHpInput')!;
const mudRandomInput = document.querySelector<HTMLInputElement>('#mudRandomInput')!;
const potionProbabilityInput = document.querySelector<HTMLInputElement>('#potionProbabilityInput')!;
const wallRandomInput = document.querySelector<HTMLInputElement>('#wallRandomInput')!;
const maxRoundInput = document.querySelector<HTMLInputElement>('#maxRoundInput')!;
const roundBadge = document.querySelector<HTMLDivElement>('#roundBadge')!;
const statsEl = document.querySelector<HTMLDivElement>('#stats')!;
const logEl = document.querySelector<HTMLDivElement>('#log')!;
const botNote = document.querySelector<HTMLDivElement>('#botNote')!;
const modelStatus = document.querySelector<HTMLDivElement>('#modelStatus')!;
const modelText = document.querySelector<HTMLSpanElement>('#modelText')!;
const winnerOverlay = document.querySelector<HTMLDivElement>('#winnerOverlay')!;
const winnerBig = document.querySelector<HTMLDivElement>('#winnerBig')!;
const winnerSub = document.querySelector<HTMLDivElement>('#winnerSub')!;
const helpBtn = document.querySelector<HTMLButtonElement>('#helpBtn')!;
const helpCloseBtn = document.querySelector<HTMLButtonElement>('#helpCloseBtn')!;
const helpDialog = document.querySelector<HTMLDialogElement>('#helpDialog')!;

const seatColors = ['#3b82f6', '#ef4444', '#22c55e', '#eab308'];
const seatNames = ['蓝', '红', '绿', '黄'];

let nnPolicy: PureNnPolicy | null = null;
let state: GameState;
let bots = new Map<number, BotController>();
let running = false;
let timer: number | null = null;
let frame = 0;
let gameOverLogged = false;
let workerGeneration = 0;
let workerRequestId = 0;
let roundInFlight = false;
let activeRoundToken = 0;
const manualQueues = new Map<number, Action[]>();
const botWorkers = new Map<number, BotWorkerClient>();

// 爆炸特效：记录每个爆炸格的触发帧，draw 时按存活时长渲染火焰
interface Blast {
  x: number;
  y: number;
  born: number;
}
let blasts: Blast[] = [];
const BLAST_LIFE = 16; // 帧
// 玩家朝向（用于角色眼睛/表情朝向）：1 右 -1 左
const facing = new Map<number, number>();
const lastPos = new Map<number, string>();

const botOptions = [
  { id: 'manual', label: '手动', note: '由你用键盘或屏幕方向键操控。' },
  { id: 'easy', label: '简单', note: '官方 easy 规则：BFS 寻找最优格，速度固定为 1。' },
  { id: 'hard', label: '困难', note: '官方 hard 规则：危险逃生 + 放弹安全判定 + 动态方向序。' },
  { id: 'search', label: '搜索增强', note: '在困难规则基础上做浅层 rollout 搜索，仅在明显更优时改动作。' },
  { id: 'nn', label: '纯神经网络', note: '加载 DLRNNH1 模型，逐步用 RNN 策略输出动作。' },
  { id: 'hybrid', label: '神经网络+搜索', note: '搜索为主，叠加一个小权重的 NN 策略先验。' },
];
const defaultSeatBots = ['manual', 'nn', 'easy', 'easy'];
const modelUrl = new URL(
  `${import.meta.env.BASE_URL}models/pure-nn.rnn`,
  window.location.href,
).href;

class BotWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<
    number,
    {
      resolve: (actions: Action[]) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;

  constructor(
    readonly playerId: number,
    readonly botId: BotId,
    readonly generation: number,
    initialState: SerializedGameState,
  ) {
    this.worker = new Worker(new URL('./bot-worker.ts', import.meta.url), {
      type: 'module',
      name: `seedcup-${botId}-p${playerId}`,
    });
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.addEventListener('message', (event: MessageEvent<BotWorkerResponse>) => {
      this.handleMessage(event.data);
    });
    this.worker.addEventListener('error', (event) => {
      const error = new Error(event.message || `玩家 ${playerId} Worker 运行失败`);
      this.rejectReady(error);
      this.rejectPending(error);
    });
    this.worker.postMessage({
      type: 'configure',
      generation,
      playerId,
      botId,
      modelUrl,
      state: initialState,
    });
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  async decide(
    requestId: number,
    stateSnapshot: SerializedGameState,
  ): Promise<Action[]> {
    await this.readyPromise;
    return new Promise<Action[]>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({
        type: 'decide',
        generation: this.generation,
        requestId,
        state: stateSnapshot,
      });
    });
  }

  terminate(): void {
    this.worker.terminate();
    this.rejectPending(new Error('Bot Worker 已重置'));
  }

  private handleMessage(message: BotWorkerResponse): void {
    if (message.generation !== this.generation) return;
    if (message.type === 'ready') {
      this.resolveReady();
      return;
    }
    if (message.type === 'error') {
      const error = new Error(message.message);
      if (message.requestId == null) this.rejectReady(error);
      else {
        const pending = this.pending.get(message.requestId);
        this.pending.delete(message.requestId);
        pending?.reject(error);
      }
      return;
    }
    const pending = this.pending.get(message.requestId);
    this.pending.delete(message.requestId);
    pending?.resolve(message.actions);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function isWorkerBot(botId: string): botId is BotId {
  return botId !== 'manual';
}

function configureBotWorkers(): void {
  workerGeneration++;
  activeRoundToken++;
  for (const client of botWorkers.values()) client.terminate();
  botWorkers.clear();
  const snapshot = serializeGameState(state);
  const seats = seatBotIds();
  for (let index = 0; index < state.players.length; index++) {
    const botId = seats[index] ?? 'hard';
    if (!isWorkerBot(botId)) continue;
    const player = state.players[index];
    botWorkers.set(
      player.id,
      new BotWorkerClient(player.id, botId, workerGeneration, snapshot),
    );
  }
  canvas.dataset.botWorkers = String(botWorkers.size);
}

function makeBot(id: string): BotController {
  switch (id) {
    case 'manual': return new ManualBot();
    case 'easy': return new RuleBot(false, 0);
    case 'hard': return new RuleBot(true, 4);
    case 'search': return new SearchBot(6, 2, 0.05);
    case 'nn': return new PureNnBot(nnPolicy);
    case 'hybrid': return new HybridSearchBot(nnPolicy);
    default: return new RuleBot(true, 4);
  }
}

// 按玩家数量渲染 N 个 bot 选择器
function renderBotSelectors(): void {
  const num = Number(playerNumSel.value);
  const prev = [...botSelectors.querySelectorAll<HTMLSelectElement>('.seat-select')].map((s) => s.value);
  let html = '';
  for (let i = 0; i < num; i++) {
    const cur = prev[i] ?? defaultSeatBots[i] ?? 'hard';
    const opts = botOptions.map((b) => `<option value="${b.id}"${b.id === cur ? ' selected' : ''}>${b.label}</option>`).join('');
    html += `
      <div class="field">
        <label><span class="seat-chip" style="background:${seatColors[i]}"></span>${seatNames[i]}方 玩家</label>
        <div class="select-wrap"><select class="seat-select" data-seat="${i}">${opts}</select></div>
      </div>`;
  }
  botSelectors.innerHTML = html;
  botSelectors.querySelectorAll<HTMLSelectElement>('.seat-select').forEach((s) => {
    s.addEventListener('change', resetGame);
  });
}

function seatBotIds(): string[] {
  return [...botSelectors.querySelectorAll<HTMLSelectElement>('.seat-select')].map((s) => s.value);
}

renderBotSelectors();

window.addEventListener('error', (e) => setError(`运行错误：${e.message}`));
window.addEventListener('unhandledrejection', (e) => setError(`运行错误：${String(e.reason).slice(0, 90)}`));

function setError(msg: string): void {
  modelStatus.classList.remove('ready');
  modelStatus.classList.add('error');
  modelText.textContent = msg;
}

void loadPureNnPolicy()
  .then((policy) => {
    nnPolicy = policy;
    modelStatus.classList.add('ready');
    modelText.textContent = '神经网络模型已加载';
    resetGame();
  })
  .catch((err) => {
    modelText.textContent = `神经网络不可用：${String(err).slice(0, 60)}`;
    resetGame();
  });

function resetGame(): void {
  const raw = seedInput.value.trim();
  const seed = raw !== '' ? Number(raw) >>> 0 : (Math.floor(Math.random() * 0xffffffff) >>> 0);
  const size = Number(mapSizeSel.value);
  const playerNum = Number(playerNumSel.value);
  state = createGame(seed, {
    ...defaultConfig,
    size,
    playerNum,
    playerHp: Math.min(Number(playerHpInput.value), Number(maxHpInput.value)),
    playerMaxHp: Number(maxHpInput.value),
    playerSpeed: Number(playerSpeedInput.value),
    bombTime: Number(bombTimeInput.value),
    bombRandom: Number(bombRandomInput.value),
    bombNum: Number(bombNumInput.value),
    bombRange: Number(bombRangeInput.value),
    wallRandom: Number(wallRandomInput.value),
    mudRandom: Number(mudRandomInput.value),
    potionProbability: Number(potionProbabilityInput.value),
    maxRound: Number(maxRoundInput.value),
  });
  manualQueues.clear();
  const seats = seatBotIds();
  bots = new Map();
  state.players.forEach((p, i) => bots.set(p.id, makeBot(seats[i] ?? 'hard')));
  for (const [id, bot] of bots) bot.reset?.(id, state);
  configureBotWorkers();
  logEl.innerHTML = '';
  blasts = [];
  facing.clear();
  lastPos.clear();
  gameOverLogged = false;
  running = false;
  playBtn.textContent = '开始';
  winnerOverlay.classList.remove('show');
  updateNames();
  draw();
  renderStats();
}

interface ExportedMatch {
  version: 1;
  controls: {
    playerNum: string;
    mapSize: string;
    seed: string;
    bots: string[];
    advanced: Record<string, string>;
  };
  state: {
    config: GameState['config'];
    seed: number;
    round: number;
    over: boolean;
    winnerIds: number[];
    rngState: SerializedGameState['rngState'];
    serverRngState?: SerializedGameState['serverRngState'];
    cells: Array<
      Array<{
        block: string | null;
        item: number;
        bombId: number | null;
        players: number[];
        lastBombRound?: number;
        playerBucketCount?: number;
      }>
    >;
    players: GameState['players'];
    bombs: GameState['bombs'];
    nextBombId: number;
    bombBucketCount?: number;
    blockMeta: Array<BlockMeta>;
  };
}

function blockMetaOf(gameState: GameState): Map<number, BlockMeta> {
  return (gameState as unknown as { blockMeta: Map<number, BlockMeta> }).blockMeta;
}

function exportMatch(): void {
  const payload: ExportedMatch = {
    version: 1,
    controls: {
      playerNum: playerNumSel.value,
      mapSize: mapSizeSel.value,
      seed: seedInput.value,
      bots: seatBotIds(),
      advanced: advancedControlValues(),
    },
    state: {
      config: { ...state.config },
      seed: state.seed,
      round: state.round,
      over: state.over,
      winnerIds: [...state.winnerIds],
      rngState: state.rng.snapshot(),
      serverRngState: state.serverRng?.snapshot(),
      cells: state.cells.map((row) =>
        row.map((cell) => ({
          block: cell.block,
          item: cell.item,
          bombId: cell.bombId,
          players: [...cell.players],
          lastBombRound: cell.lastBombRound,
          playerBucketCount: cell.playerBucketCount,
        })),
      ),
      players: state.players.map((player) => ({ ...player })),
      bombs: state.bombs.map((bomb) => ({ ...bomb })),
      nextBombId: state.nextBombId,
      bombBucketCount: state.bombBucketCount,
      blockMeta: [...blockMetaOf(state).values()].map((block) => ({ ...block })),
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `seedcup-arena-r${state.round}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function advancedControlValues(): Record<string, string> {
  return {
    bombTimeInput: bombTimeInput.value,
    bombRandomInput: bombRandomInput.value,
    playerSpeedInput: playerSpeedInput.value,
    bombNumInput: bombNumInput.value,
    bombRangeInput: bombRangeInput.value,
    playerHpInput: playerHpInput.value,
    maxHpInput: maxHpInput.value,
    mudRandomInput: mudRandomInput.value,
    potionProbabilityInput: potionProbabilityInput.value,
    wallRandomInput: wallRandomInput.value,
    maxRoundInput: maxRoundInput.value,
  };
}

function applyAdvancedControlValues(values: Record<string, string>): void {
  for (const [id, value] of Object.entries(values)) {
    const element = document.querySelector<HTMLInputElement>(`#${id}`);
    if (element) element.value = value;
  }
}

function importMatch(payload: ExportedMatch): void {
  if (payload.version !== 1) throw new Error('不支持的存档版本');
  playerNumSel.value = payload.controls.playerNum;
  mapSizeSel.value = payload.controls.mapSize;
  seedInput.value = payload.controls.seed;
  applyAdvancedControlValues(payload.controls.advanced);
  renderBotSelectors();
  botSelectors.querySelectorAll<HTMLSelectElement>('.seat-select').forEach((select, index) => {
    select.value = payload.controls.bots[index] ?? defaultSeatBots[index] ?? 'hard';
  });
  const restored: GameState = {
    config: { ...payload.state.config },
    seed: payload.state.seed,
    round: payload.state.round,
    over: payload.state.over,
    winnerIds: [...payload.state.winnerIds],
    cells: payload.state.cells.map((row) =>
      row.map((cell) => ({
        block: cell.block as Cell['block'],
        item: cell.item as Item,
        bombId: cell.bombId,
        players: new Set(cell.players),
        lastBombRound: cell.lastBombRound ?? -1,
        playerBucketCount: cell.playerBucketCount ?? 1,
      })),
    ),
    players: payload.state.players.map((player) => ({ ...player })),
    bombs: payload.state.bombs.map((bomb) => ({
      ...bomb,
      status: bomb.status as BombStatus,
    })),
    nextBombId: payload.state.nextBombId,
    bombBucketCount: payload.state.bombBucketCount ?? 1,
    rng: new Rng(payload.state.seed),
    acceptedActions: new Map(),
  };
  restored.rng.restore(payload.state.rngState);
  if (payload.state.serverRngState) {
    restored.serverRng = new ServerRng(payload.state.seed);
    restored.serverRng.restore(payload.state.serverRngState);
  }
  (restored as unknown as { blockMeta: Map<number, BlockMeta> }).blockMeta = new Map(
    payload.state.blockMeta.map((block) => [block.id, { ...block }]),
  );
  synchronizeServerIdCounters(restored);
  state = restored;
  bots = new Map();
  const seats = seatBotIds();
  state.players.forEach((player, index) => bots.set(player.id, makeBot(seats[index] ?? 'hard')));
  for (const [id, bot] of bots) bot.reset?.(id, state);
  configureBotWorkers();
  manualQueues.clear();
  blasts = [];
  facing.clear();
  lastPos.clear();
  gameOverLogged = state.over;
  running = false;
  playBtn.textContent = '开始';
  winnerOverlay.classList.toggle('show', state.over);
  if (state.over) showWinner();
  updateNames();
  draw();
  renderStats();
}

function updateNames(): void {
  const seats = seatBotIds();
  versusEl.innerHTML = state.players
    .map((p) => `<span class="side"><span class="chip" style="background:${p.color}"></span>${bots.get(p.id)?.label ?? ''}</span>`)
    .join('<span class="vs">VS</span>');
  botNote.innerHTML = state.players
    .map((p, i) => {
      const opt = botOptions.find((b) => b.id === seats[i]);
      return `<b style="color:${p.color}">${p.name}方 · ${opt?.label ?? ''}</b>：${opt?.note ?? ''}`;
    })
    .join('<br />');
}

async function stepGame(): Promise<void> {
  if (roundInFlight || state.over) return;
  roundInFlight = true;
  const generation = workerGeneration;
  const roundToken = ++activeRoundToken;
  const events: StepEvent[] = [];
  const arrivalOrder: number[] = [];
  canvas.dataset.arrivalOrder = '';
  try {
    const clients = [...botWorkers.values()];
    const ready = await Promise.allSettled(clients.map((client) => client.ready()));
    if (generation !== workerGeneration) return;
    for (const result of ready) {
      if (result.status === 'rejected') {
        setError(`Bot Worker 初始化失败：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    }

    const snapshot = serializeGameState(state);
    const submissions: Array<Promise<void>> = [];
    for (const player of state.players) {
      if (!player.alive) continue;
      const client = botWorkers.get(player.id);
      if (client) {
        const requestId = ++workerRequestId;
        submissions.push(
          client.decide(requestId, snapshot).then((actions) => {
            if (
              generation !== workerGeneration ||
              roundToken !== activeRoundToken
            ) {
              return;
            }
            // 与 C++ 服务端一致：某个客户端的整批动作到达后立即按数组顺序执行。
            arrivalOrder.push(player.id);
            canvas.dataset.arrivalOrder = arrivalOrder.join(',');
            applyActionBatch(state, player.id, actions, events);
          }).catch((error: unknown) => {
            if (generation !== workerGeneration) return;
            setError(`Bot Worker 决策失败：${error instanceof Error ? error.message : String(error)}`);
          }),
        );
      } else {
        const queued = manualQueues.get(player.id) ?? [];
        const actions = queued.splice(0, Math.max(0, player.speed));
        applyActionBatch(state, player.id, actions, events);
      }
    }
    await Promise.race([
      Promise.allSettled(submissions),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, currentRoundInterval());
      }),
    ]);
    if (generation !== workerGeneration) return;
    // Close this round before flushing so late Worker replies cannot mutate
    // the next round after the deadline has passed.
    activeRoundToken++;
    flushRound(state, events);
  } finally {
    roundInFlight = false;
  }

  for (const e of events) {
    if (e.kind === 'explode' && e.cells) {
      for (const [x, y] of e.cells) blasts.push({ x, y, born: frame });
    }
    if (e.kind !== 'round' && e.kind !== 'move') pushLog(e);
  }
  if (state.over && !gameOverLogged) {
    gameOverLogged = true;
    running = false;
    playBtn.textContent = '开始';
    showWinner();
  }
  draw();
  renderStats();
}

function showWinner(): void {
  const ids = state.winnerIds;
  if (ids.length === 1) {
    const p = state.players.find((x) => x.id === ids[0]);
    winnerBig.textContent = `${p?.name ?? ''}方 获胜`;
    winnerBig.style.color = p?.color ?? '#fff';
    winnerSub.textContent = `${bots.get(ids[0])?.label ?? ''} · 用时 ${state.round} 回合`;
  } else {
    winnerBig.textContent = '平局';
    winnerBig.style.color = '#e6edf7';
    winnerSub.textContent = `用时 ${state.round} 回合`;
  }
  winnerOverlay.classList.add('show');
}

function pushLog(e: StepEvent): void {
  const div = document.createElement('div');
  div.className = `log-line ${e.kind}`;
  div.textContent = `第${state.round}回合 · ${e.text}`;
  logEl.prepend(div);
  while (logEl.childNodes.length > 100) logEl.lastChild?.remove();
}

function loop(): void {
  if (timer != null) window.clearInterval(timer);
  const ms = currentRoundInterval();
  timer = window.setInterval(() => {
    if (running && !roundInFlight) void stepGame();
  }, ms);
}

function currentRoundInterval(): number {
  return Math.max(60, 640 - Number(speedInput.value) * 48);
}

playBtn.addEventListener('click', () => {
  if (state.over) resetGame();
  running = !running;
  playBtn.textContent = running ? '暂停' : '开始';
  loop();
});
stepBtn.addEventListener('click', () => {
  if (state.over) return;
  void stepGame();
});
resetBtn.addEventListener('click', resetGame);
shuffleBtn.addEventListener('click', () => {
  seedInput.value = ''; // 清空 = 每次随机地图
  resetGame();
});
exportBtn.addEventListener('click', exportMatch);
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  importFile.value = '';
  if (!file) return;
  try {
    importMatch(JSON.parse(await file.text()) as ExportedMatch);
  } catch (error) {
    setError(`导入失败：${String(error).slice(0, 80)}`);
  }
});

function openHelp(): void {
  if (!helpDialog.open) helpDialog.showModal();
  document.body.classList.add('dialog-open');
}

function closeHelp(): void {
  helpDialog.close();
}

helpBtn.addEventListener('click', openHelp);
helpCloseBtn.addEventListener('click', closeHelp);
helpDialog.addEventListener('click', (event) => {
  if (event.target === helpDialog) closeHelp();
});
helpDialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
speedInput.addEventListener('input', loop);
playerNumSel.addEventListener('change', () => {
  renderBotSelectors();
  resetGame();
});
mapSizeSel.addEventListener('change', resetGame);
seedInput.addEventListener('change', resetGame);
[
  bombTimeInput,
  bombRandomInput,
  playerSpeedInput,
  bombNumInput,
  bombRangeInput,
  playerHpInput,
  maxHpInput,
  mudRandomInput,
  potionProbabilityInput,
  wallRandomInput,
  maxRoundInput,
].forEach((input) => input.addEventListener('change', resetGame));

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) => {
  b.addEventListener('click', () => queueManual(Number(b.dataset.action) as Action));
});

window.addEventListener('keydown', (e) => {
  const map: Record<string, Action> = {
    ArrowUp: Action.Up,
    ArrowDown: Action.Down,
    ArrowLeft: Action.Left,
    ArrowRight: Action.Right,
    w: Action.Up,
    s: Action.Down,
    a: Action.Left,
    d: Action.Right,
    ' ': Action.Place,
  };
  const action = map[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (action == null) return;
  e.preventDefault();
  queueManual(action);
});

function queueManual(action: Action): void {
  for (const [id, bot] of bots) {
    if (bot instanceof ManualBot) {
      const q = manualQueues.get(id) ?? [];
      q.push(action);
      manualQueues.set(id, q);
    }
  }
}

// 持续动画帧（炸弹闪烁 / 危险呼吸）
function tick(): void {
  frame++;
  draw();
  requestAnimationFrame(tick);
}

function draw(): void {
  const size = state.config.size;
  const cell = canvas.width / size;
  const danger = dangerInfo(state);
  const pulse = 0.5 + 0.5 * Math.sin(frame * 0.12);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 底格
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const px = y * cell;
      const py = x * cell;
      ctx.fillStyle = (x + y) % 2 === 0 ? '#121a2b' : '#0f1626';
      ctx.fillRect(px, py, cell, cell);
    }
  }

  // 危险范围（呼吸红）
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (!danger.danger[x][y]) continue;
      const t = danger.time[x][y];
      const urgency = t <= 1 ? 0.34 : t <= 2 ? 0.24 : 0.16;
      ctx.fillStyle = `rgba(239,68,68,${urgency * (0.7 + 0.3 * pulse)})`;
      ctx.fillRect(y * cell, x * cell, cell, cell);
    }
  }

  // 方块 / 道具
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const c = state.cells[x][y];
      const px = y * cell;
      const py = x * cell;
      if (c.block === 'wall') {
        drawRound(px + 3, py + 3, cell - 6, cell - 6, 5, '#3a4560');
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        drawRoundPath(px + 3, py + 3, cell - 6, (cell - 6) / 2, 5);
        ctx.fill();
      } else if (c.block === 'mud') {
        drawRound(px + 5, py + 5, cell - 10, cell - 10, 5, '#8a5a2b');
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + cell / 2, py + 6);
        ctx.lineTo(px + cell / 2, py + cell - 6);
        ctx.stroke();
      } else if (c.item !== Item.None) {
        drawItem(px, py, cell, c.item, pulse);
      }
    }
  }

  // 炸弹
  for (const bomb of state.bombs) {
    const cx = bomb.y * cell + cell / 2;
    const cy = bomb.x * cell + cell / 2;
    const r = cell * 0.3;
    const blink = bomb.timeLeft <= 1 ? 0.4 + 0.6 * pulse : 1;
    ctx.fillStyle = `rgba(17,24,39,${blink})`;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = bomb.timeLeft <= 1 ? '#ef4444' : '#f59e0b';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 引信火花
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(cx + r * 0.5, cy - r * 0.8, cell * 0.05 * (0.7 + 0.6 * pulse), 0, Math.PI * 2);
    ctx.fill();
    // 倒计时
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.floor(cell * 0.32)}px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(bomb.timeLeft), cx, cy + 1);
  }

  // 爆炸火焰特效
  blasts = blasts.filter((b) => frame - b.born < BLAST_LIFE);
  for (const b of blasts) {
    const age = (frame - b.born) / BLAST_LIFE; // 0→1
    drawBlast(b.x, b.y, cell, age);
  }

  // 玩家
  for (const p of state.players) {
    if (!p.alive) continue;
    // 更新朝向
    const key = `${p.x},${p.y}`;
    const prev = lastPos.get(p.id);
    if (prev && prev !== key) {
      const py = Number(prev.split(',')[1]);
      if (p.y > py) facing.set(p.id, 1);
      else if (p.y < py) facing.set(p.id, -1);
    }
    lastPos.set(p.id, key);
    drawPlayer(p.y * cell + cell / 2, p.x * cell + cell / 2, cell, p.color, facing.get(p.id) ?? 1, p.invincible > 0, p.shield > 0, pulse);
  }

  roundBadge.textContent = state.over ? `结束 · ${state.round} 回合` : `回合 ${state.round}`;
}

// 炸弹人角色：头盔球体 + 护目镜带 + 眼睛 + 底部阴影 + 状态光环
function drawPlayer(
  cx: number,
  cy: number,
  cell: number,
  color: string,
  face: number,
  inv: boolean,
  shield: boolean,
  pulse: number,
): void {
  const r = cell * 0.36;
  ctx.save();

  // 落地阴影
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.92, r * 0.8, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  // 状态光环：无敌金色，护盾青色，双层发光更醒目
  if (inv || shield) {
    const c1 = inv ? "245,158,11" : "56,189,248";
    const rr = r + cell * 0.1 + pulse * 2.5;
    const halo = ctx.createRadialGradient(cx, cy, r, cx, cy, rr + cell * 0.2);
    halo.addColorStop(0, `rgba(${c1},0)`);
    halo.addColorStop(0.72, `rgba(${c1},${0.4 + 0.25 * pulse})`);
    halo.addColorStop(1, `rgba(${c1},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, rr + cell * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(${c1},${0.85 + 0.15 * pulse})`;
    ctx.lineWidth = Math.max(2.5, cell * 0.06);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 身体球（立体渐变）
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.2, cx, cy, r * 1.05);
  g.addColorStop(0, lighten(color));
  g.addColorStop(0.6, color);
  g.addColorStop(1, darken(color));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // 顶部高光
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.28, cy - r * 0.5, r * 0.42, r * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // 护目镜深色带
  ctx.fillStyle = 'rgba(9,14,25,0.9)';
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.05, r * 0.86, r * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  // 双眼（朝向偏移）
  const eo = r * 0.34;
  const dx = face * r * 0.12;
  for (const sx of [-eo, eo]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx + sx + dx, cy - r * 0.05, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b0f17';
    ctx.beginPath();
    ctx.arc(cx + sx + dx + face * r * 0.05, cy - r * 0.05, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  // 护目镜高光
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1, cell * 0.02);
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.05, r * 0.86, r * 0.34, 0, Math.PI * 1.05, Math.PI * 1.55);
  ctx.stroke();

  // 外描边
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1.5, cell * 0.03);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

// 每种道具的专属配色（对齐官方语义：火力/炸弹/无敌/护盾/加速/回血/手套）
const itemStyle: Record<number, { a: string; b: string; ring: string }> = {
  [Item.BombRange]: { a: '#fb923c', b: '#ef4444', ring: '#fca5a5' }, // 火力·橙红
  [Item.BombNum]: { a: '#94a3b8', b: '#475569', ring: '#cbd5e1' }, // 炸弹数·灰
  [Item.Rebirth]: { a: '#fb7185', b: '#e11d48', ring: '#fecdd3' }, // 回血·粉红
  [Item.Invincible]: { a: '#fde047', b: '#f59e0b', ring: '#fef08a' }, // 无敌·金
  [Item.Shield]: { a: '#38bdf8', b: '#2563eb', ring: '#bae6fd' }, // 护盾·蓝
  [Item.Speed]: { a: '#34d399', b: '#059669', ring: '#a7f3d0' }, // 加速·绿
  [Item.Gloves]: { a: '#c4b5fd', b: '#7c3aed', ring: '#ddd6fe' }, // 手套·紫
};

function drawItem(px: number, py: number, cell: number, item: Item, pulse: number): void {
  const cx = px + cell / 2;
  const cy = py + cell / 2;
  const r = cell * 0.3;
  const st = itemStyle[item] ?? { a: '#34d399', b: '#059669', ring: '#a7f3d0' };

  ctx.save();
  ctx.translate(cx, cy);

  // 呼吸光晕
  const glow = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 1.7);
  glow.addColorStop(0, hexA(st.ring, 0.35 + 0.2 * pulse));
  glow.addColorStop(1, hexA(st.ring, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.7, 0, Math.PI * 2);
  ctx.fill();

  // 圆形底盘（立体渐变）
  const body = ctx.createLinearGradient(-r, -r, r, r);
  body.addColorStop(0, st.a);
  body.addColorStop(1, st.b);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // 高光
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.4, r * 0.5, r * 0.28, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // 描边
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = Math.max(1.4, cell * 0.03);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  // 专属符号
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = Math.max(1.5, cell * 0.035);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawItemGlyph(item, r);

  ctx.restore();
}

// 在已 translate 到格心、以 r 为半径的坐标系里画各道具符号
function drawItemGlyph(item: Item, r: number): void {
  const s = r * 0.62;
  switch (item) {
    case Item.BombRange: {
      // 火力：四向箭头（十字爆炸）
      ctx.lineWidth = r * 0.16;
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 2);
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.3);
        ctx.lineTo(0, -s);
        ctx.moveTo(-s * 0.28, -s * 0.72);
        ctx.lineTo(0, -s);
        ctx.lineTo(s * 0.28, -s * 0.72);
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case Item.BombNum: {
      // 炸弹数：小炸弹 + “＋”
      ctx.beginPath();
      ctx.arc(-s * 0.2, s * 0.25, s * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = r * 0.14;
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, -s * 0.25);
      ctx.lineTo(s * 0.05, -s * 0.62);
      ctx.stroke();
      // 加号
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.moveTo(s * 0.45, -s * 0.35);
      ctx.lineTo(s * 0.45, -s * 0.02);
      ctx.moveTo(s * 0.28, -s * 0.18);
      ctx.lineTo(s * 0.62, -s * 0.18);
      ctx.stroke();
      break;
    }
    case Item.Rebirth: {
      // 回血：爱心
      ctx.beginPath();
      const h = s * 1.0;
      ctx.moveTo(0, h * 0.55);
      ctx.bezierCurveTo(h * 1.1, -h * 0.25, h * 0.45, -h * 0.95, 0, -h * 0.35);
      ctx.bezierCurveTo(-h * 0.45, -h * 0.95, -h * 1.1, -h * 0.25, 0, h * 0.55);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case Item.Invincible: {
      // 无敌：五角星
      drawStar(0, 0, 5, s, s * 0.44);
      ctx.fill();
      break;
    }
    case Item.Shield: {
      // 护盾：盾牌
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.78, -s * 0.55);
      ctx.lineTo(s * 0.78, s * 0.2);
      ctx.quadraticCurveTo(s * 0.78, s * 0.85, 0, s);
      ctx.quadraticCurveTo(-s * 0.78, s * 0.85, -s * 0.78, s * 0.2);
      ctx.lineTo(-s * 0.78, -s * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = r * 0.1;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.55);
      ctx.lineTo(0, s * 0.55);
      ctx.stroke();
      break;
    }
    case Item.Speed: {
      // 加速：闪电
      ctx.beginPath();
      ctx.moveTo(s * 0.35, -s);
      ctx.lineTo(-s * 0.45, s * 0.15);
      ctx.lineTo(s * 0.02, s * 0.15);
      ctx.lineTo(-s * 0.3, s);
      ctx.lineTo(s * 0.5, -s * 0.2);
      ctx.lineTo(s * 0.02, -s * 0.2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case Item.Gloves: {
      // 手套：拳套
      ctx.beginPath();
      ctx.moveTo(-s * 0.55, -s * 0.2);
      ctx.quadraticCurveTo(-s * 0.55, -s * 0.8, s * 0.1, -s * 0.8);
      ctx.quadraticCurveTo(s * 0.7, -s * 0.8, s * 0.7, -s * 0.1);
      ctx.lineTo(s * 0.7, s * 0.5);
      ctx.quadraticCurveTo(s * 0.7, s, s * 0.1, s);
      ctx.lineTo(-s * 0.3, s);
      ctx.quadraticCurveTo(-s * 0.75, s, -s * 0.75, s * 0.5);
      ctx.closePath();
      ctx.fill();
      // 拇指
      ctx.beginPath();
      ctx.moveTo(-s * 0.55, -s * 0.05);
      ctx.quadraticCurveTo(-s, -s * 0.05, -s, s * 0.35);
      ctx.quadraticCurveTo(-s, s * 0.6, -s * 0.6, s * 0.55);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}

function drawStar(cx: number, cy: number, spikes: number, outer: number, inner: number): void {
  ctx.beginPath();
  let rot = -Math.PI / 2;
  const step = Math.PI / spikes;
  ctx.moveTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer);
  for (let i = 0; i < spikes; i++) {
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer);
  }
  ctx.closePath();
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// 爆炸火焰：age 0→1。初期强白核心+橙焰快速铺满格子，后期膨胀淡出。
function drawBlast(gx: number, gy: number, cell: number, age: number): void {
  const cx = gy * cell + cell / 2;
  const cy = gx * cell + cell / 2;
  const ease = 1 - Math.pow(1 - age, 2); // 快速展开
  const radius = cell * (0.28 + 0.34 * ease);
  const alpha = age < 0.25 ? 1 : 1 - (age - 0.25) / 0.75; // 前段满，后段淡出

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 外层橙红
  const g1 = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius);
  g1.addColorStop(0, `rgba(255,220,120,${0.9 * alpha})`);
  g1.addColorStop(0.45, `rgba(249,115,22,${0.7 * alpha})`);
  g1.addColorStop(1, `rgba(220,38,38,0)`);
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // 白热核心（仅前半段）
  if (age < 0.5) {
    const coreA = (1 - age / 0.5) * alpha;
    ctx.fillStyle = `rgba(255,255,255,${0.85 * coreA})`;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  // 火花
  const sparks = 5;
  for (let i = 0; i < sparks; i++) {
    const ang = (i / sparks) * Math.PI * 2 + gx + gy;
    const dist = radius * (0.6 + 0.5 * ease);
    const sx = cx + Math.cos(ang) * dist;
    const sy = cy + Math.sin(ang) * dist;
    ctx.fillStyle = `rgba(255,200,80,${0.8 * alpha})`;
    ctx.beginPath();
    ctx.arc(sx, sy, cell * 0.05 * (1 - age), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawRound(x: number, y: number, w: number, h: number, r: number, color: string): void {
  ctx.fillStyle = color;
  drawRoundPath(x, y, w, h, r);
  ctx.fill();
}

function drawRoundPath(x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 60);
  const g = Math.min(255, ((n >> 8) & 255) + 60);
  const b = Math.min(255, (n & 255) + 60);
  return `rgb(${r},${g},${b})`;
}

function darken(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 55);
  const g = Math.max(0, ((n >> 8) & 255) - 55);
  const b = Math.max(0, (n & 255) - 55);
  return `rgb(${r},${g},${b})`;
}

function renderStats(): void {
  statsEl.innerHTML = state.players
    .map((p) => {
      const hpSlots = Math.max(state.config.playerMaxHp, p.hp);
      const hpDots = Array.from({ length: hpSlots }, (_, i) => `<i class="${i < p.hp ? 'on' : ''}"></i>`).join('');
      const badges = [
        p.invincible > 0 ? `<span class="badge inv">无敌 ${p.invincible}</span>` : '',
        p.shield > 0 ? `<span class="badge shield">护盾 ${p.shield}</span>` : '',
        p.gloves ? `<span class="badge glove">手套</span>` : '',
      ].join('');
      return `
        <div class="player-card ${p.alive ? '' : 'dead'}">
          <div class="head">
            <span class="swatch" style="background:${p.color}"></span>
            <span class="pname">${p.name}方</span>
            <span class="hp-dots">${hpDots}</span>
            <span class="prole">${bots.get(p.id)?.label ?? ''}</span>
          </div>
          <div class="pstats">
            <div class="pstat"><div class="k">得分</div><div class="v">${p.score}</div></div>
            <div class="pstat"><div class="k">炸弹</div><div class="v">${p.bombNow}/${p.bombMax}</div></div>
            <div class="pstat"><div class="k">火力</div><div class="v">${p.bombRange}</div></div>
            <div class="pstat"><div class="k">速度</div><div class="v">${p.speed}</div></div>
            <div class="pstat"><div class="k">状态</div><div class="v" style="font-size:13px">${p.alive ? '存活' : '淘汰'}</div></div>
            <div class="pstat"><div class="k">位置</div><div class="v" style="font-size:13px">${p.alive ? `${p.x},${p.y}` : '—'}</div></div>
          </div>
          <div class="badges">${badges}</div>
        </div>`;
    })
    .join('');
}

resetGame();
loop();
requestAnimationFrame(tick);
