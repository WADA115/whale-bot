// QQ ↔ DeepSeek Harness 桥接主程序。
//
// 链路：
//   QQ 消息 → SnowLuma (OneBot v11 WS) → 本进程 → DSH Web API session.prompt
//   DSH agent 回复/提问/审批 → events.mux 事件流 → 本进程 → send_msg → QQ
//
// 用法：node src/bridge.js （先编辑 ../config.json）
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { extractPresetPrefix, presetPromptBlockers, presetPromptWarnings, renderPresetPromptYaml } from './preset-prompt.js';
import { GEN1_ROLE_LINE_RE, parseRoleSections, roleCharStats, roleSectionReport, selectRoleText } from './role-card.js';
import { fileURLToPath } from 'node:url';
// 网关层：具体协议（SnowLuma 扩展 / 标准 OneBot v11）由 src/gateway/ 决定
import { createGateway, text } from './gateway/index.mjs';
import { NodeApiClient, unwrap, createTurnCollector, discoverDshLaunchToken } from './dsh-client.js';
import { mdToPlain, splitForQQ, truncateText, truncateTextTail } from './md-to-plain.js';
import { SENSITIVE_RE } from './sensitive.js';
import { looksLikeUnfinished } from './v2-wait.js';
import { compactModelMessage, describeAge } from './qq-model-view.js';
import { safeFetchBuffer, looksLikeImageBuffer } from './safe-fetch.js';
// 群聊「是不是在跟我说话」的判断器要复用联网搜索那份 DeepSeek 凭据。
// 注意：webSearch 不在 loadConfig() 的结果里，它是 web-search.js 自己读 config.json 的。
import { loadSearchConfig, resolveSearchApiKey } from './web-search.js';
// 记忆内核：长期（设定/晋升事实）+ 短期（TTL 淘汰）+ 会话摘要
import { createMemoryCore, createMemoryStore } from './memory-core.js';
import { judge as judgeAutoMemory } from './auto-memory.js';
import { BUILTIN_PLUGINS } from './plugin-verify.js';
import { createPluginHost } from './plugin-host.js';
import { loadPlugins as loadPluginsFromDir, runPluginHook as runPluginHookOn } from './plugins/runtime.js';
import { createPromptQueue } from './dsh/queue.js';
import { appendWakeSnapshot, buildDeliveryContent, deliveryErrorText } from './dsh/deliver.js';
import { deliverPromptNow as runDeliverPromptNow } from './dsh/deliver-run.js';
import { clampLevel, autoEmotionLevel, emotionPrompt } from './emotion.js';
import { readInfluence, emotionWeightWithGrowth, memoryBudgetWithGrowth, chanceWithGrowth } from './growth-influence.js';
import { reviewNarrative } from './narrative-guard.js';
import { guardIncomingText, buildPersonaAnchor } from './persona-guard.js';
import { buildClosedAgentPrompt } from './prompt/assemble.js';
import { parseClassifyAnswer } from './group-classify.js';
import { formatRecentLine, formatCurrentLine } from './group-history.js';
import { appendTurnLog } from './dialogue/turn-log.js';
import { appendEvent } from './dialogue/events.js';
import { orchestrateDialog } from './orchestrator/index.js';
import { checkStandards } from './orchestrator/standards.js';
import { buildTransactionPrompt, parseTransaction, raceTransactions } from './dialogue/hedged.js';
import { runHedgedDialogue as runHedgedDialogueModule } from './dialogue/hedged-runner.js';
import { createDialogueContext } from './dialogue/context-builder.js';
import { createInitiativeScheduler } from './orchestrator/initiative-scheduler.js';
import { callChat, callOllama, callOllamaEmbed } from './dialogue/model.js';
import { readReady } from './knowledge/ready.js';
import { readSecret } from './secrets.js';
import { createTurnLedger } from './kernel/turn-ledger.js';
import { createGroupRuntime } from './group/runtime.js';
import { createGroupBatcher } from './group/batcher.js';
import { createOneBotSender } from './transport/onebot.js';
import { createMediaFetcher } from './transport/media-fetch.js';
import { createFaceMedia } from './transport/face-media.js';
import { createMediaData } from './transport/media-data.js';
import { createMediaResolver } from './transport/media-resolve.js';
import { createVideoFetch } from './transport/video-fetch.js';
import { createVoicePaths } from './transport/voice-paths.js';
import { createVoiceBudget } from './transport/voice-budget.js';
import { createVoiceSender } from './transport/voice-send.js';
import { createSnowlumaHealth } from './transport/snowluma-health.js';
import { createMediaRefs } from './transport/media-refs.js';
import { createAdminAuth } from './admin/auth.js';
import { createConfigLoader } from './config/load.js';
import { createAdminStatus } from './admin/status.js';
import { createConsoleServer } from './admin/console.js';
import { createHandleIncoming } from './runtime/handle-incoming.js';
import { createPumpMux } from './runtime/pump-mux.js';
import { createRuntimeSocial } from './runtime/generated/social.js';
import { createRuntimeSupport } from './runtime/generated/support.js';
import { createRuntimeMemory } from './runtime/generated/memory.js';
import { createRuntimeSend } from './runtime/generated/send.js';
import { createRuntimeDialogue } from './runtime/generated/dialogue.js';
import { createComposeInjection } from './dialogue/injection.js';
import { mimeFromBuffer, mimeFromUrl, getImageDimensions, base64FromMaybe, isProbablySafeImageFileRef } from './transport/media-utils.js';
import { createKnowledgeQuery } from './knowledge/query.js';
import { createThreadStore } from './dialogue/thread-store.js';
import { createExecutionGateway } from './execution/gateway.js';
import { createTransport } from './execution/transport.js';
import { createSecurityNotifier } from './execution/security.js';
import { SILENT_MARKER } from './prompt/context.js';
import { selfIdentityText, buildWakeReasonSuffix } from './prompt/wake.js';
import { renderWakePromptV2 } from './prompt/wake-render.js';
import { sanitizeMediaSummary, extractMediaFromSegments, isDirectedAtAi, isDirectAddress, isMustReplyText, isSelfMessage } from './message/parse.js';
import { singleLineForQQ, splitLongSegment, splitByCjkSpaces, splitReplyIntoBubbles, planSocialTimeline } from './send/pipeline.js';
import { normalizeReplyShape, pickGapMs } from './reply-shape.js';
import { resolveWeights, memoryBudget, memoryHitLimit } from './weights.js';
// 语境引擎：追踪每个会话的在场人、当前话题、还没回应的问句
import { createContextEngine } from './context-engine.js';
// 出站内容审核（最后一道闸）
import { createContentFilter } from './content-filter.js';
// 表达引擎：润色 / 情绪 / 自主配表情
import { createMood, pickSticker, pickFace, decideExtras } from './expression.js';
import { pickKaomoji } from './kaomoji.js';
// QQ 系统表情 id → 中文名（face 段没有可下载图片，只能靠名字表达）
import { faceName, faceLabel } from './qq-face.js';
// 视频理解：抽帧（当图片）+ 抽音轨（交给本地 ASR）
import { sampleFrames, extractAudio } from './video-sample.js';
import { normalizeImageForModel } from './media-normalize.js';
import { AUDIO_EXTS, cleanupTemp, describeAudio, formatBytes, formatDuration, inspectAudio, listAudioFiles, parseTargetKey, processAudioVolume, resolveAudioProcessing, resolveAudioSource, safeJoinLibrary } from './send-voice-lib.js';
import { discoverSnowLumaConnection, persistSnowLumaEndpoint, persistToken } from './snowluma-conn.js';
import { hardenDir, manualDirCommand } from './state-acl.mjs';
import { extractForwardIds, forwardIdFromData, sanitizeForwardId, formatForwardResponse } from './forward.js';
import { resolvePriceTable } from './model-prices.js';
import { createTokenLedger } from './token-ledger.js';
import {
  loadSlang,
  saveSlang,
  upsertSlangEntry,
  buildSlangContext,
  buildExtractionPrompt,
  buildResearchPrompt,
  parseExtractionJson,
  parseResearchJson,
  createSlangEntry,
  mergeEvidence,
  SLANG_STATUS,
  SLANG_MAX_ENTRIES
} from './slang-learner.js';
import {
  loadStickerStore,
  saveStickerStore,
  mergeStickerLibrary,
  findSticker,
  formatStickerList,
  buildStickerContext,
  buildStickerStrategyHint,
  applyStickerNote,
  markStickerUsed
} from './sticker-lib.js';
import { createRuntimeTop } from './runtime/generated/top.js';
import { rememberPerson, peopleLine } from './memory/people.js';
import { identityLine, syncPeopleDirectory } from './memory/people-sync.js';
import { buildGlobalDigest } from './dialogue/global-context.js';

function resolveTopName(name) {
  try { return eval(name); } catch { return globalThis[name]; }
}
function makeTopScope(ignored = []) {
  const blocked = new Set(ignored);
  return new Proxy({}, {
    has: (_target, name) => !blocked.has(name),
    get: (_target, name) => name === Symbol.unscopables ? undefined : resolveTopName(name),
    set: (_target, name, value) => {
      if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error('invalid top scope name');
      try { eval(name + ' = value'); return true; }
      catch { throw new Error('top scope is read-only: ' + name); }
    }
  });
}
const lastCompressAt = new Map();
const topScopeFactory = (ignored = []) => makeTopScope([...ignored, 'arguments']);
const runtimeTop = createRuntimeTop(topScopeFactory);
const { profileForSender, isProfileTrusted, withProfile, normalizeModeInput, settingFromDshNamespace, readJsonSafe, readConfigObject, renameWithRetry, atomicWriteJson, atomicWriteText, loadOrCreateConsoleToken, hardenStateDirAcl, readActivityTail, listRoles, applyRoleInjectLimit, roleFilePath, firstMeaningfulLine, roleWarnings, roleSummaries, validateRoleName, validateRoleContent, readRoleContent, writeRoleContent, knownPresetName, presetSourceYaml, dshHomeDir, installedPresetYaml, readPresetPromptText, presetBackupPrefix, backupPresetFile, listPresetBackups, presetStatus, isSilentMarker, isSendToolName, rememberAgentToken, forgetAgentToken, normalizeReasoningEffort, redactSensitiveText, escapeCqText, appendActivity, readRoleState, writeRoleState, sanitizeRoleName, developerIds, resolveFfmpegLoose, normalizeOwnerQQ, normalizeIdList, resolveConfigName, loadState, saveState, consolePortInUse, acquireLock, releaseLock, createCappedLogger, localClock, log, withTimeout, segmentsToText, allowed, canonicalV2Key } = runtimeTop;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATE_DIR = path.join(ROOT, 'state');
const STATE_FILE = path.join(STATE_DIR, 'sessions.json');
const DIALOGUE_DIR = path.join(STATE_DIR, 'dialogue');
const threadStore = createThreadStore({ dir: DIALOGUE_DIR });
const ROLE_STATE_FILE = path.join(STATE_DIR, 'current-role.json');
// ── 账户档案：state/profiles/<user>.json，按 qq 绑定。只影响绑定的人。──
const PROFILE_DIR = path.join(STATE_DIR, 'profiles');
let profileCache = { at: 0, map: new Map(), trustedSet: new Set() };


/** 这个 QQ 是否出现在某个普通账户的受信名单里（群聊免 @ 用）。 */


/** 把档案里的行为参数叠到这份 cfg 副本上；不动全局 cfg。 */

let activeProfile = null;
const SLANG_FILE = path.join(STATE_DIR, 'slang.json');
const SLANG_SESSION_FILE = path.join(STATE_DIR, 'slang-session.json');
const SOCIAL_V2_FILE = path.join(STATE_DIR, 'social-v2.json');
// 操作者为每个会话预写的「初始提示词」（见 main() 里的 initialPrompts）。
// 单独一个文件：它属于操作者配置，不能随 social-v2.json 的会话状态一起被重置清掉。
const INITIAL_PROMPTS_FILE = path.join(STATE_DIR, 'initial-prompts.json');
const STICKER_FILE = path.join(STATE_DIR, 'stickers.json');
const FEEDBACK_FILE = path.join(STATE_DIR, 'feedback.json');
const TOOL_LOG_FILE = path.join(STATE_DIR, 'tool-calls.jsonl');
const TOKEN_USAGE_FILE = path.join(STATE_DIR, 'token-usage.jsonl');
const ACTIVITY_LOG = path.join(STATE_DIR, 'qq-activity.log');
// 日志隔离：桥接日志单独放 state/logs/（与面板日志、守护日志分开）
try { fs.mkdirSync(path.join(STATE_DIR, 'logs'), { recursive: true }); } catch {}
const BRIDGE_LOG = path.join(STATE_DIR, 'logs', 'bridge.log');

/**
 * 模式拼写的**唯一**归一入口（输入边界）。
 *
 * `simulation` 是规范名（QSH_PLAN.md §2.1：对用户只暴露 `closed-agent` / `simulation`），
 * `chat` / `reserved` / `reserved2` 是历史拼写 —— 必须继续被**接受**（线上桥接持久化的全局值
 * 就是 `reserved2`），但进程内部一律用历史拼写存储与比较：`currentMode === 'reserved2'` 这类
 * 判断遍布发送闸门、定时器与 preset 解析，把规范名直接塞进 `currentMode` 会让它们全部变成假。
 *
 * 旧写法是 `VALID_MODES = ['chat','closed-agent','reserved','reserved2']`，控制台那处还抄了
 * 一份同样的字面量数组。后果是：在 DSH 设置或 `state/mode.json` 里写 `simulation` 会被**静默
 * 忽略**，`currentMode` 保持上一次的值（进程刚起来时是 `chat`，即一代仿真 —— preset 与工具面
 * 都和二代不同，`v2ToolEnabled` 之类的闸门也不生效）。用户以为切到了仿真，实际跑的是另一套，
 * 而且没有任何日志。规范名与历史名必须在这里收敛成同一个内部值。
 */
const MODE_INPUT_ALIASES = Object.freeze({
  chat: 'chat',
  reserved: 'reserved',
  reserved2: 'reserved2',
  simulation: 'reserved2',
  'closed-agent': 'closed-agent'
});
/** 内部合法模式集合（由别名表派生，避免"两份名单各自漂移"）。 */
const VALID_MODES = Object.freeze([...new Set(Object.values(MODE_INPUT_ALIASES))]);

/** 输入侧归一：返回内部拼写；无法识别返回 null，由调用方 fail-closed。 */


/**
 * 从 DSH `settings.describe` 的一个命名空间里读某个键，**user 层优先、value 回退**。
 *
 * 为什么不能只读 `value`：DSH 0.2.0-rc.2 的 `settings/update` 写入的是 user 层
 * （profile patch 的显式 config），当次进程内 `describe().value`（取自插件 fiber 的
 * 运行配置）**不会更新**，要重启 DSH 才变。控制台切模式后 5 秒一次的 `refreshMode()`
 * 会读回旧 `value`，把刚选的模式改回去（issue #22，实测复现）。
 * 写哪读哪：`user` 里有显式值就用它，否则回退 `value`（从没写过时 `user` 是空对象，
 * 老行为不变；DSH 以后修好热更新也继续正确）。
 */


// 读取 JSON 文件并容错：Windows 下常见 UTF-8 BOM（\uFEFF）会令 JSON.parse 失败。
// required=true 时文件缺失或解析失败直接抛错（用于启动必需配置，fail-fast）。


/**
 * 读取 config.json，并保证拿到一个**可安全改写的普通对象**。
 *
 * 为什么不是 `readJsonSafe(file, null, true) ?? {}`：控制台这些端点都是
 * 「读整份 config → 改一个字段 → 原子写回」。JSON.parse 对字面量 `null` 是**成功**的，
 * 于是 `file` 可能是 null：`file.socialV2` 直接 TypeError（保存接口 500，且错误信息
 * 完全指不出"配置文件顶层是 null"）；而用 `?? {}` 兜底更糟 —— 回写会把整份配置替换成
 * 只含本次提交字段的新对象，用户的白名单、令牌、模式全被抹掉。
 * 所以：不是普通对象就抛错，让调用方的 try/catch 返回 500（与各端点注释里
 * "配置文件损坏时直接 500，绝不回写" 的既有约定一致）。
 */


/**
 * 原子替换：`fs.renameSync` 覆盖一个「正被别人打开」的目标，在 Windows 上会抛 EPERM
 * （Defender / 编辑器 / 资源管理器预览 / 云同步都可能在这个窗口里碰它）。
 * 实测本机可复现。这里退避重试几次；实在不行才抛，让调用方决定怎么提示。
 */


// 原子写 JSON 文件：先写唯一临时文件再 rename，避免进程中断写坏配置，也避免固定临时名被并发/符号链接攻击利用。


// 原子写文本文件。


// 控制台鉴权 token：未配置时自动生成并持久化到 state/console-token，避免默认无鉴权。


/**
 * 收紧 state/ 的访问权限。
 *
 * **Windows 上 `mode: 0o600` 是空操作**（实测：chmod 之后 ACL 不变），文件继承父目录 ACL ——
 * 本机 state/console-token 实测为 `NT AUTHORITY\Authenticated Users:(M)`，也就是任何能登录
 * 这台机器的用户都能读走控制台令牌、Snowluma accessToken、各会话 agentToken 和全部 QQ 聊天记录。
 * 这里用 icacls 切断 state/ 的继承链，只保留「当前用户 + SYSTEM + Administrators」。
 *
 * ⚠️ 具体实现已抽到 `src/state-acl.mjs`（与 scripts/harden-state-acl.mjs 共用同一份）。
 * 这里原本自带一份**会破坏数据**的实现：
 *   · `icacls DIR /inheritance:r /grant:r "u:(OI)(CI)F" /T` —— (OI)(CI) 是目录专用标志，
 *     套到 /T 展开的文件上会失败，而 /inheritance:r 已摘掉文件的继承 ACE，净结果是
 *     **子文件 DACL 被清空、连属主都读不了**（实测 state/ 下 50 个文件变空，桥接读不到
 *     自己的控制台令牌）；启动日志只报「未能收紧」，看不出已经造成破坏。
 *   · 回读自检用 `/\(I\)/` 扫全文，而 DSH 沙箱的 Low 完整性标签行永远带 (I) ——
 *     于是「已收紧」被误判成「未收紧」，**每次启动都重跑一遍那个破坏性命令**。
 * 两处逻辑各写一份正是漂移的根源，故合并。失败时不能只说"可能可读"就完事，
 * 要给出一条**安全**的可复制命令，并把结果回报到控制台（/api/security 的 stateDirHardened）。
 * 宁可明确报"没做成"，也不要假装已经安全。
 */






// ── 人格文件读写 ────────────────────────────────────────────────────────────
// 人格提示词 = roles/<名称>.md，由桥接在每条消息前注入（热生效，无需重启 DSH）。
const ROLES_DIR = path.join(ROOT, 'roles');
const ROLE_NAME_MAX = 40;
const ROLE_CONTENT_MAX_BYTES = 64 * 1024;
// 注入上限：**按模式筛完小节之后**再截断，避免另一模式的专属内容白白占掉预算。
// 默认 8000（2026-10 起：小鲸鱼卡补了形象/圈层/白饭-token/开发事件梗，6000 会把
// 末尾「你的样子」整段截掉——截断点落在卡尾而不是卡中，比调大预算更危险），
// 仍是每条约 6~8k token 的成本护栏；可用 config.json 的 role.maxInjectChars 调整
// （1000~20000）；启动时由 applyRoleInjectLimit() 写入。
const ROLE_INJECT_MAX_CHARS_DEFAULT = 8000;
let roleInjectMaxChars = ROLE_INJECT_MAX_CHARS_DEFAULT;

const ROLE_RESERVED_NAMES = new Set(['README']);
// Windows 保留设备名：roles/CON.md 这类路径会被系统当成设备而不是文件，
// 写入会失败甚至挂起，因此在人格名层面直接拒绝。
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

















// ── 二代仿真预设提示词（「仿真」层）────────────────────────────────────────
// 与「人格」层的边界：
//   仿真提示词 = 预设内置，规定 AI 怎么调工具、怎么参与群聊（行为与协议）
//   人格提示词 = roles/<名称>.md，规定 AI 是谁、什么性格（人设与语气）
// 仿真层改完需要重启 DSH 才生效（preset 由 DSH 在会话创建时装配）；
// 人格层由桥接每条消息注入，保存即生效。
// 两代仿真各自有独立的预设提示词：一代 qq-chat（空格分条 / [SILENT]），
// 二代 qq-chat-v2（一切皆工具）。控制台可分别查看与修改。
const PRESET_NAMES = { v1: 'qq-chat', v2: 'qq-chat-v2' };
const PRESET_BACKUP_DIR = path.join(STATE_DIR, 'preset-backups');
const PRESET_BACKUP_KEEP = 10;

/**
 * 控制台的 preset 参数校验：只接受本项目这两个预置名（缺省 = 二代）。
 *
 * 为什么必须在拼路径**之前**校验：main() 里的 resolvePresetName() 在「DSH preset 清单为空」
 * （DSH 还没连上 / 正在启动）时会把调用方给的字符串**原样返回**。那四个 preset 控制台路由
 * 都拿它去 path.join(ROOT, 'dsh', 'agent-presets', name, 'agent.cordis.yml')，
 * 于是 `preset=..\..\..\x` 会读写/备份 <x>/agent.cordis.yml，越出仓库。
 * 返回 null 由调用方回 400。
 */








// 这里**没有**模块级的 resolvePresetName —— 曾经有一个，但它被 main() 内部同名函数完全遮蔽
// （函数声明提升到 main 作用域，main 里所有调用点都落到内部那个），是纯死代码。
// 而且它的语义是错的：未知名字静默回退到 qq-chat-v2，等于 fail-OPEN —— 一旦哪天有人把它
// "复活"成真正生效的实现，群聊会话就会在 preset 清单校验失败时照样建起来。
// 真正在用的那个（main() 内，带 strict 开关）在名字不可用时返回 '' 让调用方拒绝建会话。
// 同理不再保留 PRESET_NAME_SET：它只服务于那个死函数，留着只会诱惑下一个人去用它。



// 备份文件名带上预设名：两个预设的主文件名都叫 agent.cordis.yml，
// 不加前缀会让「还原」列到另一个预设的备份。








// 回复审计：agent 回复若命中以下特征（本机路径/凭据），硬性拦截不发送。
// 宁可误拦，不可泄露。
// 社交模式“静默标记”：模型输出该标记时，桥接不把内容发到 QQ。
// 用于让 AI 在“不想接话/潜水”时有合法沉默出口，而不是写“（内心戏）”被当成消息发出去。


// DSH MCP 发送类工具：一旦 AI 在回合里调用过这些工具，说明消息已经由工具发出，
// 桥接应跳过该回合的自动转发，避免“工具发一条 + 自动转发一条”的重复。
const SEND_TOOL_RE = /^mcp__snowluma__qq_(send_group_message|send_private_message|reply|send_burst|send_message)$/;


// 分句规则提示：真人聊天不会主动用空格，因此空格被桥接当作“分条信号”。
// 中英文/数字之间的空格同样会分条，所以不想分条就不要加空格。
// 群聊指向性提示：引用/回复段表示“这句话是在对被引用的人说”，避免 AI 把群友之间的对话误当成指向自己。

// 已知的二代 agent token 集合：日志/活动/出站文本统一脱敏，防止令牌被模型泄露到 QQ。
const KNOWN_AGENT_TOKENS = new Set();

// 会话 → 该会话「当前代 + 上一代」agentToken 的索引（见 rememberAgentToken）。
//
// 为什么必须有这份索引：retireSession() 每次轮换 token 都会把**新** token 塞进
// KNOWN_AGENT_TOKENS，而 reconcileSessionPolicies() 在**任何**策略变化（切模式、改白名单、
// preset 清单变动）时都会退役全部会话 —— 于是每切一次模式，每个会话就在集合里永久多留一个
// token，且只有 /reset、/api/session/reset、/api/socialV2/reset 会删。集合只增不减，而
// redactSensitiveText()（每写一行日志）和 redactKnownTokensOnly()/onebotSend()（每条出站消息）
// 都要先复制整个集合再线性扫，长期运行后这两条热路径会被拖垮。
//
// 选择「按会话替换」而不是硬性 LRU 上限：硬上限在会话多的时候会淘汰掉**仍然有效**的 token，
// 那等于把活令牌漏到 QQ，属于削弱安全边界。按会话记账时集合大小 ≈ 会话数 × 2，且每个会话
// 一定保留当前代（活令牌必然可脱敏）与上一代（模型上下文里最可能残留的那一个）；会话被删除
// 时用 forgetAgentToken() 整体摘除。第三代已经在两次轮换之前，不可能还在上下文里，直接丢弃。
const CONVERSATION_TOKENS = new Map();
const MAX_KNOWN_AGENT_TOKENS = 512;

/**
 * 记录某会话的当前 agentToken：丢掉它两代之前的旧 token，避免集合无界增长。
 * 另加一层上限兜底（防止异常路径下会话 key 无界增多），淘汰顺序是「先扔非活代」。
 */


/** 会话被彻底移除（重置/清空工作区/退订）时，连同它的 token 一起从脱敏集合摘掉。 */


// 读取 DSH 模型能力的在途 Promise：withTimeout 只做 Promise.race，不会取消底层 RPC，
// 因此并发刷新会各自留下一个不可取消的请求。这里做去重，同一时刻只发一个。
let modelCatalogInFlight = null;
// DSH 思考强度（reasoningEffort）热切换代号。
// 控制台改强度后递增它，让已在运行的会话在下一条消息重新 selectModel；
// 放在模块级是为了不依赖 main() 内部声明的执行顺序（避免 TDZ）。
let modelSelectionEpoch = 0;
// DeepSeek provider 明确支持的取值（见 dsh-llm-deepseek：其它值会抛 UNSUPPORTED_REASONING_EFFORT）。
// 'off' 虽然合法（关闭思考），但 QQ 聊天助手依赖思考，控制台不提供该档。
const REASONING_EFFORT_OPTIONS = ['low', 'high', 'max'];
const REASONING_EFFORT_DEFAULT = 'max';


// 敏感文本脱敏：把 SENSITIVE_RE 命中的片段替换为 ***，供日志/反馈/活动记录写入前使用。
// SENSITIVE_RE 未带 g 标志，这里动态补 g 以替换所有命中片段。


// 防止底层网关把文本中的 [CQ: 当作 CQ 码解析：替换为全角冒号。


// 兼容模型把单条消息序列化成 JSON 字符串的情况，例如 "\"你好\"" → "你好"。


// QQ 活动日志：每次收发都追加一行，供 WebUI 侧 agent 汇报 QQ 动态。
const appendActivityLog = createCappedLogger(ACTIVITY_LOG, 500);


// 读取角色/模式状态：{"role": "傲娇助手", "mode": "active"|"silent"}




// 管理员 QQ（ownerQQ）规范化：空值=未设置；必须是正整数 QQ 号。

/** 开发者白名单：config.role.developers 里的 QQ 号（只认数字，最多 20 个）。
 *  注意：这个函数在模块作用域，不能直接引用 main() 里的 cfg，必须由调用方传进来
 *  （之前写死引用 cfg，导致非管理员的群消息全部抛 "cfg is not defined"）。 */



/** ffmpeg 路径解析：绝对路径原样用；相对路径按安装根目录解析（迁移后不用改配置）。 */




// 白名单/黑名单值规范化：只接受字符串或数字数组，非数组按空列表处理（fail-closed 语义由调用方决定）。


// ── 配置 ────────────────────────────────────────────────────────────────────

const configScope = new Proxy({}, {
  has: () => true,
  get: (_target, name) => name === Symbol.unscopables ? undefined : resolveConfigName(name)
});
const loadConfig = createConfigLoader(configScope);

// ── 状态持久化（QQ 会话 ↔ DSH 会话映射） ─────────────────────────────────────
let state = { sessions: {} };
// sessions.json 读不动/读坏时必须**大声失败**，不能静默回落成空映射：
// 那会让每个 QQ 会话都拿到一个全新的 DSH 会话（上下文全丢），而紧接着的
// saveState() 会把这份空映射原子写回磁盘 —— 一次截断/占用/写满就变成永久丢失。
// 与表情库、黑话库一样走「只读不写」降级：保留原文件，等人来处理。
let stateWritable = true;



// ── 单实例锁 ─────────────────────────────────────────────────────────────────
// 防止多个桥接进程同时运行（双实例会抢消息、互相覆盖映射）。
// 锁文件存 PID；启动时若该 PID 仍存活则退出（exit 2 = 已有实例），
// 否则接管。进程退出/崩溃后锁自动失效（PID 校验）。
const LOCK_FILE = path.join(STATE_DIR, 'bridge.lock');

// 媒体临时目录：统一放在工作区 state/media-tmp。
// 原因：本机 %TEMP% 对"桥接派生出来的 ffmpeg"写权限不稳定（实测 Permission denied / -13），
// 压图、抽帧、抽音轨全都会失败；工作区内的目录则一直可写。
const MEDIA_TMP_DIR = path.join(STATE_DIR, 'media-tmp');
try {
  fs.mkdirSync(MEDIA_TMP_DIR, { recursive: true });
  process.env.QQB_MEDIA_TMP = MEDIA_TMP_DIR;
} catch {}

/**
 * 控制台端口是否已被占用 —— 用来判断「是不是真的还有一个桥接在跑」。
 *
 * 为什么需要它：锁文件只存了 PID，而 Windows 会回收 PID。`process.kill(pid, 0)` 成功
 * 只能证明「有进程占着这个号」，EPERM 更是连这一点都证明不了（受保护进程）。
 * 但桥接一定绑定控制台端口（绑不上会自己 exit 2），所以端口占用是一个可靠的判据。
 * 同步探测一次，只在启动期的可疑分支里跑，不影响正常运行。
 */





// ── 工具 ────────────────────────────────────────────────────────────────────
// 日志同时输出到 stdout 与 state/bridge.log（守护窗口不可见时也能排查）

/** 单条日志的最大长度：一条异常巨大的错误对象不能把整个日志文件变成 5MB。 */
const LOG_LINE_MAX = 1000;

/**
 * 带行数上限的追加写日志。
 *
 * 为什么不能「append 之后再读回整个文件数行数」：那样每写一行都要同步读一遍整个文件，
 * 到上限后还要整文件重写一次。实测 bridge.log 到了 2000 行（约 200KB）时，
 * 单次 log() 要 17ms 左右，而每条 QQ 消息会打 2~4 条日志 —— 每条消息白扔几十毫秒的
 * 事件循环。这里改成**内存计数器**：只在启动时数一次，之后 O(1) 追加，
 * 到上限才轮转，轮转用 rename 到 `.1`（不是整文件重写，也不会写坏）。
 */


/** 本地时间 HH:MM:SS。此前用的是 toISOString()，写进日志的是 UTC，和本地时间差 8 小时。 */


const appendBridgeLog = createCappedLogger(BRIDGE_LOG, 2000);


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const convKey = (kind, id) => `${kind}:${id}`;
const SEND_TIMEOUT_MS = 15000;
// DSH 控制类调用（停任务/归档会话）的超时。这些 await 以前是裸的：DSH 接受了连接但
// 不返回响应时，HTTP handler 永不返回，控制台与群消息一起失去响应（issue #32）。
// 超时后走各自的 catch 记日志，最坏情况只是「这一次重置没做成」，而不是整体挂死。
const DSH_CONTROL_TIMEOUT_MS = 15000;




/**
 * 媒体摘要（QQ 表情的 `summary`）会进入模型上下文、也会被拼进「[表情:…]」这类单行标注。
 * 压掉换行/控制字符并限长：否则一条群消息可以用摘要里的换行伪造出新的提示词段落。
 */


// 二代会话 key 规范化：只接受 group:正整数 / private:正整数，并去掉前导零，避免同一会话出现多个别名。


const APPROVE_WORDS = new Set(['通过', '同意', '允许', '批准', 'yes', 'y', 'approve', 'ok']);
const REJECT_WORDS = new Set(['拒绝', '不同意', '不允许', '驳回', 'no', 'n', 'reject', 'deny']);

// state/ 的 ACL 是否已收紧（hardenStateDirAcl 的结果；控制台「访问与安全」页会显示，
// 未收紧时给出可复制的提权命令）。null = 还没跑/平台不适用。
let stateDirHardened = null;

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  const scopeFactory = (ignored = []) => makeRuntimeScope([...ignored, 'arguments']);
  const runtimeSocial = createRuntimeSocial(scopeFactory);
  const { saveStickerStoreSafe, dedupeFactsWithModel, syncStickerLibrary, sendStickerV2, saveSlangStore, queueSlangTask, ensureSlangLearnerSession, invalidateSlangLearnerSession, runSlangExtraction, runSlangResearch, maybeLearnSlangFromQuestion, maybeQueueSlangExtraction, feedSlangWindow, withSlangContext, detectLiveDshUrl, healDshUrlIfDrifted, fetchModelCatalog, rememberModel, recordSessionUsage, recordSessionSnapshot, armPendingWakeLease, disarmPendingWakeLease, clearAllPendingWakeLeases, socialToolsModeAllowed, socialWakeAllowed, refreshMode, refreshPresetList, modeAllowed, resolvePresetName, modePreset, isSessionAllowedInCurrentMode, sessionPolicy, isCurrentSession, stopRetiredSessionWork, retireSession, reconcileSessionPolicies, startDshWatch, toModelMedia, ensureChatModel, ensureSession, pickWakeTriggersV2, defaultWakeConfigV2, refreshDefaultWakeConfigV2, ensureWakeableV2, getSocialV2State, loadSocialV2State, saveSocialV2State, socialState, enterActive, cancelSocialTimers, cancelAllSocialTimers, cleanupSocialForModeChange, leaveActive, runInitiative, startInitiativeScheduler, roleRawContent, roleHintForMode, currentRoleHint, appendSocialV2Poke, noteModelMessagesV2, wakeReasonSeq, buildWakeSnapshotV2, buildWakePromptV2, buildWakeReminderPromptV2, sendWakePromptV2, wakePriorityV2, isTimerWakeReason, scheduleWakeV2, replayPendingWakeReasonsV2, scheduleProactiveCheckV2, clearSocialV2Timers, clearAllSocialV2Timers, handlePokeNotice } = runtimeSocial;
  const runtimeSupport = createRuntimeSupport(scopeFactory);
  const { onebotHttpAction, loadPlugins, runPluginHook, backupState, startJanitor, firstJsonArray, loadSilkModule, rebuildInFlightCollector, forgetConversationCaches, normalizeSpeakerIdsV2, appendRecentMessage, flushSummaries, isQuoteTargetSelf, redactSensitive, readThroughSeqV2, localClockText, findV2MessageBySeq, selfIdentityTextV2, busyReasonV2, isConversationBusyV2, setupSleepTimerV2 } = runtimeSupport;
  const runtimeMemory = createRuntimeMemory(scopeFactory);
  const { setMemoryOwner, refreshTopic, compressConversation, maybeExtractMemory, getGroupRecentLines, rememberGroupLine, classifyGroupMessage, moodFor, formatParticipationV2, suggestQuietMsV2, formatMemoryV2, buildContextBlock, fetchGroupHistoryLines, pruneGroupMemberNameCache, resolveGroupMemberName, timeSenseCfg, buildTimeSenseLine } = runtimeMemory;
  const runtimeSend = createRuntimeSend(scopeFactory);
  const { voiceMessageToText, transcribeVoiceMessage, assertOutboundAuditOk, maybeSendExpression, sendFaceSegment, v2ToolEnabled, redactKnownTokensOnly, sendToQQ, lastSendSucceeded, isSafeLocalMediaPath, emojiCdnCandidates, emojiIdFromFileName, acceptImageBuffer, shouldAuditKey, captureSendGuard, auditAndSend, describeImages, sendSystem, sendCommand, sendSpeakerPlan, appendToolLog, sanitizeToolArgs, applyHealedTokens, syncTokenToFile, healTokenIfStale } = runtimeSend;
  const runtimeDialogue = createRuntimeDialogue(scopeFactory);
  const { recordDialogueTurn, dialogueAsks, waitLearnerTurn, initialPromptMaxChars, normalizeInitialPromptText, loadInitialPrompts, getInitialPrompt, formatInitialPromptV2, runHedgedDialogue, deliverPromptNow, deliverPrompt, pruneReplyInfoCache, resolveReplyInfo, replyTimingV2, cancelReplyCheckV2, scheduleReplyCheckV2, drainPromptQueue, drainAllPromptQueues, cancelPendingEntry, handlePendingAnswer, registerPending, trackTurnEvent } = runtimeDialogue;
  const cfg = loadConfig();
  const mediaRefs = createMediaRefs({ getMode: () => currentMode, getSocialV2State, hasV2Conversation: (key) => socialV2.conversations.has(key), getMessageMediaStore: () => messageMediaStore });
  const snowlumaHealth = createSnowlumaHealth({ getCfg: () => cfg, log, pollMs: 60000, silenceWarnMs: Math.max(60000, Number(cfg.snowluma?.silenceWarnMs) || 600000) });
  const voiceBudget = createVoiceBudget();
  const voiceSender = createVoiceSender({
    getCfg: () => cfg, voiceCfg: () => voicePaths.voiceCfg(), assertOutboundAuditOk,
    inspectAudio, processAudioVolume, cleanupTemp, describeAudio, captureSendGuard,
    enqueue: (fn) => { sendChain = sendChain.then(fn); return sendChain; }, log
  });
  const voicePaths = createVoicePaths({ root: ROOT, getCfg: () => cfg, listAudioFiles, resolveAudioSource, safeJoinLibrary, audioExts: AUDIO_EXTS });
  const oneBotSender = createOneBotSender({ getCfg: () => cfg, knownTokens: KNOWN_AGENT_TOKENS, log });
  try {
    const httpSecret = readSecret(ROOT, 'snowlumaAccessToken');
    const wsSecret = readSecret(ROOT, 'snowlumaWsAccessToken');
    if (httpSecret) cfg.snowluma.accessToken = httpSecret;
    if (wsSecret) cfg.snowluma.wsAccessToken = wsSecret;
  } catch {}
const knowledgeReady = readReady(STATE_DIR);
const knowledgeDbPath = cfg.knowledge?.dbPath || path.join(STATE_DIR, 'knowledge', 'knowledge.db');
const learningMode = cfg.knowledge?.enabled === true && cfg.knowledge?.learningBlocks !== false && !knowledgeReady;
const knowledgeQuery = cfg.knowledge?.enabled === true && knowledgeReady
  ? createKnowledgeQuery({
    dbPath: knowledgeDbPath,
    log,
    embed: async (text) => (await callOllamaEmbed({ model: 'bge-m3', input: text, timeoutMs: 20000 }))[0]
  })
  : null;
let lastLearningNoticeAt = 0;
let turnLedger = null;
try { turnLedger = createTurnLedger({ dbPath: path.join(STATE_DIR, 'runtime.db') }); } catch (error) { log('[ledger] 初始化失败：' + (error?.message ?? error)); }
let groupRuntime = null;
try { if (cfg.groupRuntime?.enabled !== false) groupRuntime = createGroupRuntime({ dbPath: path.join(STATE_DIR, 'group-runtime.db'), cfg }); } catch (error) { log('[group] 初始化失败：' + (error?.message ?? error)); }
const groupBatcher = createGroupBatcher({ log });
if (cfg.knowledge?.enabled) log(`[knowledge] ${knowledgeReady ? 'READY ' + (knowledgeReady.stats?.chunks ?? '?') + ' chunks' : '学习中：无 READY'}`);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  hardenStateDirAcl();
  acquireLock();
  loadState();

  // ── 群聊黑话/网络用语学习（slang） ──────────────────────────────────────
  let slangEntries = [];
  const dialogueContext = createDialogueContext({ threadStore, buildContextBlock, buildSlangContext, getSlangEntries: () => slangEntries, moodFor, cfg });
  // 读失败时（被占用 / 权限 / JSON 损坏）必须**暂停写入**：否则内存里的空数组
  // 会在下一次 saveSlangStore() 时覆盖掉磁盘上那份数据，学到的词条全丢。
  let slangStoreWritable = true;
  try {
    slangEntries = loadSlang(SLANG_FILE, { onCorrupt: (message) => log(`⚠️ ${message}`) });
  } catch (error) {
    slangStoreWritable = false;
    log(`⚠️ 黑话库加载失败，已暂停写入以免覆盖磁盘数据（修好后重启即可恢复）：${error?.message ?? error}`);
  }
  const slangWindows = new Map();       // key -> [{sender,text,time}]：待学习消息窗口
  const slangAskCooldowns = new Map();  // key -> 上次“问梗”学习时间
  const slangExtractionCooldowns = new Map(); // key -> timestamp
  const slangSubmitTimes = new Map();   // key -> [timestamp]：AI 提交黑话候选限频（内存态）
  const feedbackTimes = new Map();      // key -> [timestamp]：AI 反馈限频（内存态）
  const slangResearchingIds = new Set(); // 正在研究中的候选 id，防止重复排队
  const learnerSessions = new Set();    // sessionId -> 学习会话（不映射 QQ，不发送）
  const learnerCollectors = new Map();  // sessionId -> turn collector
  const learnerWaiters = new Map();     // sessionId -> [{resolve,reject,timer}]
  let slangLearnerSessionId = null;
  let slangTaskChain = Promise.resolve();

  // ── 表情包体系（二代仿真）本地知识库 ────────────────────────────────────
  // 库文件损坏/读不动时**不能当成空库继续**：下面任何一次 saveStickerStoreSafe 都会把
  // 「空库」写回去，把 AI 学到的 localNote/tags/usage 永久清零。读失败就显式降级为
  // 「只读不写」，并留下醒目日志（与 loadSlang 的 slangStoreWritable 同一套路）。
  let stickerEntries = [];
  let stickerStoreWritable = true;
  try {
    stickerEntries = loadStickerStore(STICKER_FILE);
  } catch (error) {
    stickerStoreWritable = false;
    log(`⚠️ 表情库读取失败，已降级为「只读不写」（不会覆盖原文件）：${error?.message ?? error}`);
  }
  let stickerSyncedAt = 0; // 上次从 SnowLuma 拉取收藏表情的时间戳（毫秒）
  let lastForcedAgentStickerSync = 0; // AI 强制刷新表情库的最小间隔保护

  

  

  // 从 SnowLuma OneBot 拉取 QQ 账号收藏表情（fetch_custom_face_detail），并合并进本地库。
  // ── 读接口的 HTTP 兜底：WS 挂了不等于网关挂了 ──────────────────────────────
  //
  // 为什么要有：`fetch_custom_face_detail` 原来只走 SnowLuma 的 WS action，于是
  // 「WS 正在重连」这段时间里表情库同步必然失败。日志实测 33 次同步里 16 次失败（≈48%），
  // 全是 `SnowLuma WebSocket closed before opening`；表现就是操作者说的
  // 「有时读群友的表情包会失败」——库里没有新收藏 ⇒ qq_get_sticker_image 直接报「找不到表情」。
  //
  // 而**同一个网关的 HTTP 口一直是可用的**（onebotSend 发消息、fetch_ptt_text 转写都直接用它）。
  // 读接口没有理由单点依赖 WS。这里只在 WS 失败时兜底，不改变正常路径的延迟。
  

  // ── 收到的语音转写（本地新增 2026-10-25）────────────────────────────────
  // 链路：get_msg 拿 record 段 → get_record 拿下载 URL → 下载 SILK v3 →
  //       silk-wasm（纯 WASM）解码成 PCM16 24kHz → 本地 ASR 服务（sherpa-onnx
  //       paraformer-zh-small）识别 → 文本。
  //
  // 为什么不用 OneBot 的 fetch_ptt_text：实测 SnowLuma 那条路拿不到结果
  // （「语音转文字超时（未收到结果推送）」/ error=9），QQ 侧转写在私有协议里。
  // 失败一律静默回退成 [语音]，不阻塞消息投递。
  const voiceTranscriptCache = new Map(); // messageId -> 转写文本（'' 表示不可用）

  // ── 长期记忆（本地新增 2026-10-25）────────────────────────────────────────
  // 两件事：
  //   1) 注入：每轮把「和这条消息相关的记忆」贴进 prompt，模型自然带进对话；
  //   2) 提取：回合结束后用便宜模型从这轮对话里抽事实/偏好/黑话，冷却期内只跑一次。

// ── 插件加载器（本地新增 2026-10-26）──────────────────────────────────────
// 约定：plugins/<名字>/manifest.json + index.mjs，导出可选钩子：
//   onInbound(ctx) —— 收到消息时（可返回 {skip:true} 吃掉这条）
//   onReply(ctx)   —— 生成回复后（可返回 {text:'替换后的文本'}）
//   onMemory(ctx)  —— 写完记忆后（观察用）
// 约定 ctx = { key, sender, text, reply, cfg, log }
// 每个钩子独立 try/catch + 3 秒超时，插件炸了不影响主流程。


/** 依次调用插件的某个钩子；返回最后一个非空结果（用于 onReply 改写）。 */


  // ── 记忆多租户 ────────────────────────────────────────────────────────────
// 开发者：state/memory.json；普通用户：state/profiles/<用户名>/memory.json
const memoryStore = createMemoryStore({
  stateDir: STATE_DIR,
  log,
  embed: async (texts) => {
    if (cfg.local?.enabled === false || !cfg.local?.baseURL) return [];
    return callOllamaEmbed({
      baseURL: cfg.local.baseURL,
      model: cfg.local.embeddingModel || 'bge-m3',
      input: texts
    });
  }
});
let activeMemoryOwner = 'developer';   // 当前这条消息该读写谁的记忆
/** 把所有 memory.xxx() 调用转发给"当前身份"的记忆库，旧代码不用改。 */
const memory = new Proxy({}, {
  get(_t, prop) {
    const core = memoryStore.for(activeMemoryOwner);
    const value = core[prop];
    return typeof value === 'function' ? value.bind(core) : value;
  }
});

  // 长期记忆里先种下"自己的设定"：这几条永不自动删除，每轮都会注入。
  try {
    for (const s of [
      '你是「小鲸鱼」，DeepSeek 的鲸鱼形象；傲娇嘴硬但心软，不是客服也不是助手。',
      '说话像人打字：口语、短句、能一次说清也可以多说几句；不用列表/标题/加粗。',
      '群聊里只接跟你有关的话；闲聊少插嘴，被点名或明显在问你再回。',
      '被要求唱歌就老实说不会，别硬凑。',
      '不冒充官方，不说自己是 DeepSeek 官方机器人。'
    ]) memory.addSetting(s);
  } catch (error) {
    log(`[mem] 设定初始化失败（忽略）：${error?.message ?? error}`);
  }
  // 插件：启动时加载一次（失败不影响主流程）
  const pluginList = await loadPlugins();
process.on('exit', () => { for (const p of pluginList) { try { p.host?.kill?.(); } catch {} } });

  // 语境引擎：谁在场、在聊什么、哪句还没回
  const ctxEngine = createContextEngine({ file: path.join(STATE_DIR, 'context.json'), log });
  // 出站内容审核：按 config.safety 的规则拦明显违规内容
  const contentFilter = createContentFilter(cfg.safety ?? {});

  // ── 定期清理（本地新增 2026-10-25）───────────────────────────────────────
  // 三样东西会无限长大：媒体临时文件、TTS 生成的音频、会话语境。
  // 每小时扫一次，按配置的 TTL 删旧的；只删"本程序生成的"文件名，不碰语音库里的成品。
  /**
   * 每日数据备份：把 state 里"丢了会心疼"的几个 JSON 复制到 state/backup/YYYYMMDD/。
   * 一天只做一次；超过 keepDays 的旧备份自动删。失败只记日志，不影响主流程。
   */
  

  
  startJanitor();
  /** 用一次便宜的 flash 调用把最近对话压成一句话题摘要。 */
  
  // 退出时把未落盘的记忆写掉（store 内部有 debounce）
  process.on('exit', () => { try { memory.flush(); } catch {} });
  const memoryExtractAt = new Map(); // key -> 上次提取时间
  const lastInboundForMemory = new Map(); // key -> 本轮对方说的话（提取时用）
const lastActivity = new Map(); // key -> 最后一条入站/出站时间（主动发言用）
const deepseekHealth = { failures: 0, downUntil: 0 }; // 连续失败后短暂熔断，避免每条消息都等超时
let initiativeScheduler = null;


  /**
   * 上下文压缩：会话变长后，把较早的发言 + 旧摘要合并成一段新摘要，
   * 然后只保留最近几条原文。这样既不会丢信息，也不会让 prompt 越滚越大。
   */
  

  /** 出站清理：给"记忆去重"用的模型调用——判断新信息是否与已有记忆重复。 */  

  /** 从模型输出里取第一个完整的 JSON 数组，忽略数组之后的解释/第二个数组。 */
  

  /** 从一轮对话里提取值得长期记住的信息；失败/无内容都不影响主链路。 */
  
  const SILK_LIB_PATH = path.join(ROOT, 'tools', 'silk', 'package', 'lib', 'index.mjs');
  let silkModulePromise = null;
  

  /** 把一条语音消息识别成文字；任何一步失败都返回 ''。 */
  

  

  // ── 群聊"这句是不是在跟我说话"的判断（本地新增 2026-10-25）────────────────
  // 用便宜的 flash 模型做二分类，省掉主模型一次完整回合；
  // 判断依据里带最近几条群聊上下文，不然"它怎么不动了"这种话没法判断指向谁。
  const groupRecentLines = new Map(); // groupId -> [{ name, text }]
  const lastBotReplyAt = new Map(); // key -> 上次机器人发言时间
  const classifyRate = { windowStart: 0, count: 0 }; // 判断器每分钟限流
  

  
  

  

  

  // force=true 时忽略 TTL 强制刷新；失败时返回 null（调用方决定是否使用缓存）。
  

  // 返回给 AI 的表情列表（带本地认知）。
  

  // 取单个表情的图片字节（多模态用）。
  

  // ── 语音发送（把准备好的音频当 QQ 语音条发出） ──────────────────────────────
  //
  // 链路：本地音频文件 → SnowLuma 的 record 段 → 网关自带 SILK 编码 → QQ 语音条。
  // 网关侧事实（v1.14.9 源码确认）：record 段的 file 接受本地路径 / file:// / http(s):// / base64://，
  // 非 SILK 的音频由网关的 native ffmpeg addon 自动转成 NT SILK，所以这里不做预转码。
  //
  // 两条通道，闸门不同（与 /api/send/* 的既有分层一致）：
  //   - agent=true ：QQ 群里的 AI 调用。必须带有效 agent token，且只能发它自己那个会话。
  //   - agent=false：操作者（CLI / 控制台，凭 consoleToken）。跳过会话/模式闸门，
  //                  但仍强制白名单 + 语音限流 + 敏感词审计。

  /**
   * 出站语音的内容审计：与文本一致，凡是「疑似敏感信息 / 含会话令牌」的**文件名**
   * 都不允许外发（语音的音频内容本身无法审计，但文件名同样会泄露路径与项目信息）。
   */
  

  /**
   * 底层发送：把音频作为 record 段交给 SnowLuma。
   * guard=true（agent 通道）时，发送前必须通过 captureSendGuard —— 会话/模式/白名单任一变
   * 就放弃发送；guard=false（操作者通道）时不套会话闸门（操作者可能不在任何会话里）。
   *
   * audio 可传音量设置 { volume, normalize, loudness }：SnowLuma 的 record 段没有增益字段，
   * 所以音量必须在本地用 ffmpeg 调好再发（临时文件发完即删）。
   */
  /** 把「我发了条语音」写进二代会话的 recentMessages，让 AI 自己知道刚发过什么。 */
  

  /**
   * 发完语音后的**落地验证**：把这条消息从网关读回来，确认它真的带着 record 段。
   *
   * 为什么不用 fetch_ptt_text 做这件事：那个动作依赖 QQ 侧的语音转写结果，
   * 而**自己发出去的**语音根本不会产生转写（实测 retcode=100「消息中不包含语音」）。
   * 想让 AI 确认「语音真的发出去了」，唯一可靠的证据是 get_msg 回读到的 record 段。
   * 返回 { confirmed, file, duration } 或 null（读不回来不影响"已发送"这个事实）。
   */
  

  /**
   * AI 通道入口：解析引用 → 限流 → 发送 → 记账 → 回读校验。
   * 返回 { messageId, detail, verified, readback }。
   */
  

  // ── 表达层运行时（本地新增 2026-10-26）─────────────────────────────────
  // 情绪：每个会话一个带衰减的心情值，喂的是对方说的话，影响措辞和要不要发表情。
  // 额外消息：文字发完后按概率补一个表情包/小黄脸；有冷却，失败静默。
  const moods = new Map();
  const extraState = new Map();
  

  /** 表情/颜文字：只产出 Gateway action，不直接发 QQ。 */
  

  /** 发一个小黄脸（face 段，不依赖 CDN，必达）。 */
  

  /**
   * 把这条消息需要的背景拼成一段：记忆（设定/长短期/摘要）+ 语境（群聊）+ 心情。
   * 三段各自兜底，任何一段抛错都只是少一段提示，不影响回复。
   */
  
  // 发送一个收藏表情（按 emoji_id/url/md5 解析，发图片段）。
  

  // 更新本地 AI 认知（含义/标签/用法）。
  

  // 修改 QQ 账号里的收藏表情备注（modify_custom_face），并同步本地 desc。
  

  // 收藏聊天里的一张表情（add_custom_face），并按 AI 看到的含义写简短备注（modify_custom_face）。
  

  

  

  

  

  

  

  

  // 用户在问“这是什么意思/什么梗/谐音”时，才主动学；10 分钟内同一会话只触发一次。
  

  

  // 黑话学习素材入口：群聊普通消息进入滚动窗口（命令/角色控制语不学；
  // 只学当前消息自己的文字，不学引用原文）。一代/二代共用。
  

  // AI 提交黑话候选的限频：防止单个会话在短时间内刷大量候选。
  

  // 返回给 AI 的“公开黑话条目”（只含安全展示字段，不泄露内部字段）。
  //
  // 刻意**不含 evidence**：证据行的形状是 `{ key, sender, text, time }`，
  // 其中 text 是提交该词条的那个会话里的消息片段、key 是那个会话的名字。
  // 黑话库是全群共享的，带上 evidence 就等于让 A 群的 AI 读到 B 群的会话名和原话。
  // 控制台要证据走 `GET /api/slang`（原始条目，含 evidence，仅控制台可达）。
  

  // 已确认黑话的公开列表（按出现次数排序，最多 injectMax 条）。
  

  

  if (!cfg.allow.private.length && !cfg.allow.groups.length && cfg.allowAllWhenEmpty) {
    log('⚠️  白名单为空且 allowAllWhenEmpty=true：将转发所有私聊/群聊消息给 agent');
  } else if (!cfg.allow.private.length && !cfg.allow.groups.length) {
    // 否则这是一个「静默无响应」陷阱：消息全被丢弃，用户只看到 QQ 上毫无反应。
    log(`⚠️  白名单为空且 allowAllWhenEmpty=false：不会响应任何 QQ 消息。请在 config.json 填 allow.private / allow.groups，或在控制台 http://127.0.0.1:${cfg.consolePort} 填写白名单`);
  }
  // 未配置管理员 QQ 时，一串功能会「静默失灵」：审批永远无法被回答（agent 一直等到超时）、
  // 管理命令全部被拒、封闭 agent 模式实际不可达。这里在启动日志里说清楚，避免排查时误判。
  if (!cfg.ownerQQ) {
    log('⚠️  未配置 ownerQQ：审批/管理命令/封闭 agent 模式将全部不可用。请在 config.json 或控制台「访问与安全」页填写管理员 QQ');
  }
  if (cfg.socialV2?.voice?.allowAbsolutePath === true) {
    // 该开关曾经允许 AI 发送语音库之外的任意本机音频文件（prompt injection 可用来外发文件）。
    // 现在无论开关如何，AI 通道都只接受语音库内的文件；这里提示它已经不再放宽边界。
    log('ℹ️  socialV2.voice.allowAbsolutePath=true 已不再放宽 AI 通道：AI 发的语音始终只允许来自语音库（库外文件请用语音工具/CLI 发送）');
  }

  // DSH 侧
  const api = new NodeApiClient(cfg.dsh.baseUrl, undefined, {
    token: cfg.dsh.authToken,
    // true=用户在 config.json 里显式填的；false=从日志猜的。猜来的不优先于离线铸造。
    tokenExplicit: cfg.dsh.authTokenExplicit === true,
    header: cfg.dsh.authHeader,
    prefix: cfg.dsh.authPrefix,
    // 默认只允许把 launch token 交给回环地址；远程 DSH 需要显式 opt-in（见 dsh-client.ensureAuth）。
    allowRemote: cfg.dsh.allowRemote === true
  });

  // ── DSH 端口漂移自愈（本地适配 2026-10-25）────────────────────────────
  // 桌面版 DSH 每次重启都会换随机端口，而桥接只在启动时读一次 cfg.dsh.baseUrl，
  // 于是重启后表现为「事件流连上又立刻结束（0 帧）」空转，QQ 那头完全没反应。
  // 这里在连续 3 次空流之后，主动探测 DeepSeek Harness 进程的监听端口并热切换。
  let dshHealAttempts = 0;
  
  
  // DSH 的模型目录 RPC：0.1.5 是 `session/modelCatalog`。**不能走基类门面**
  // `api.sessions.modelCatalog` —— 桥接钉住的 `@deepseek-ai/dsh-host-apiproxy@0.1.1-rc.2`
  // 的 sessions 门面里根本没有这个方法（只有 `models` → 已下线的 `session/models`），
  // 调用会抛 “api.sessions.modelCatalog is not a function”，让思考强度档位静默退回内置清单。
  // 这里直接用桥接自己覆写的 callUnary（它本来就是为「不依赖旧版客户端域方法」而存在的），
  // 并保留一次 `session/models` 回落以兼容更老的 DSH。
  const modelCatalogErrorLogged = new Set();
  
  const collectors = new Map(); // sessionId -> turn collector
  const visionWaiters = new Map(); // sessionId -> { resolve, timer }
  const visionCollectors = new Map(); // sessionId -> turn collector
  const sendToolSucceededSessions = new Set(); // sessionId：当前 turn 内 MCP 发送类工具至少成功一次
  const v2TurnStartAt = new Map(); // sessionId -> timestamp：reserved2 turn 开始时间，用于判断是否“无行动”
  const toolCallNames = new Map(); // sessionId -> Map<callId, toolName>：用于结果日志关联工具名
  const pendingSendToolCalls = new Map(); // sessionId -> Set<callId>：等待 tool/result 的发送类调用
  // reserved2 防“忘记设置唤醒条件”：key -> 当前是否等待 AI 处理唤醒回合 / 本回合已更新唤醒配置 / 连续未设置次数
  const pendingWakeKeys = new Set();
  // key -> 开始等待的时间戳（带租约）：正在执行 qq_wait_for_messages 长轮询的会话，防止同一会话并发挂起。
  // 存时间戳而不是单纯放进 Set，是因为 handler 中间任何异常都会跳过 finishWait ——
  // 那样这个 key 会被永远 429 掉（DSH 的 fetch 不会主动断开连接，req 'close' 也不会触发）。
  const activeWaits = new Map();
  /**
   * 单次等待的租约上限：正常等待最长 = timeout 预算 + 静默窗口 + 5s 余量，
   * 这里给足余量；超过就认为上一次是异常退出留下的残留，允许新的等待接管。
   */
  const ACTIVE_WAIT_LEASE_MS = 15 * 60 * 1000;
  /**
   * 回合判忙租约：只要 `turn/start` 的结束信号（turn/end）丢了，会话就会**永久**判忙，
   * 之后所有唤醒只进 pendingWakeReasons、QQ 上表现为「它不理我了」，只能重启（issue #11/#23/#26/#19）。
   * 正常回合 1~3 分钟，最长工具调用（DSH 的 toolCallTimeoutMs）≈12 分钟，15 分钟足以覆盖任何
   * **还活着**的回合。过期只是不再判忙：collector 本身保留，真回复照常 flush，只是允许新唤醒排队。
   */
  const TURN_BUSY_LEASE_MS = 15 * 60 * 1000;
  const turnLeaseNoted = new Set(); // 租约过期的日志去重（每个 session 只记一次）
  const pendingWakeLeaseTimers = new Map(); // key -> timeout：防止 accepted 但无 turn/end 的唤醒把 key 永久标记为 busy
// 【本地适配 2026-10-25】非仿真模式的「回合进行中」标记。
// 作用：回合还没结束时到达的新消息，用 session/prompt 的 steer 模式**并入当前回合**，
// 让 agent 一次读到多条消息、只回一次；否则每条消息在 DSH 侧各排一个回合，
// 表现就是「一句一句回」。
const steerInflight = new Map(); // key -> 最后一次投递时间
const STEER_LEASE_MS = 10 * 60 * 1000; // 超过 10 分钟视为丢失 turn/end，退回 queue
  const wakeConfigUpdatedKeys = new Set();
  const markReadCalledKeys = new Set();
  const wakeConfigMissCount = new Map();
  const reverse = new Map(); // sessionId -> conv key
  for (const [key, sessionId] of Object.entries(state.sessions)) reverse.set(sessionId, key);
  // 新版 DSH 事件流需要显式 follow；启动时为已持久化的 QQ 会话补上。
  for (const sessionId of Object.values(state.sessions)) api.events.follow(sessionId);
  const sessionPromises = new Map(); // key -> create promise（防并发重复创建）

  // ── Token 用量账本（控制台「令牌与花费」） ───────────────────────────────
  // 权威总量取 DSH 的 tokenUsage 投影（整条会话日志累计，含桥接启动前的历史），
  // 逐轮明细由 assistant/message 的 usage 折叠而来；花费在读取时按价目表折算。
  const priceTable = resolvePriceTable(cfg.pricing);
  const tokenLedger = createTokenLedger({
    file: TOKEN_USAGE_FILE,
    log: (...args) => log(...args),
    priceTable,
    // 会话 → QQ 会话归属：学习会话单独记账，其余未知会话归入「未归属」。
    resolveKey: (sessionId) => reverse.get(sessionId)
      ?? (learnerSessions.has(sessionId) || (slangLearnerSessionId && sessionId === slangLearnerSessionId)
        ? 'internal:黑话学习'
        : undefined)
  });

  /** sessionId -> 最近一次已知的实际模型。切换模型会让单价差好几倍，所以按会话记。 */
  const sessionModels = new Map();
  const nominalModel = () => cfg.dsh?.model || 'deepseek-flash';

  

  /** 摄入一条会话事件到 token 账本；任何异常都不能影响 QQ 主链路。 */
  

  /**
   * 处理会话开场快照：
   * 1. `projections.tokenUsage` 是**整条会话日志**的权威累计桶（含桥接启动前的历史）；
   * 2. `records` 是最近若干条历史事件，用来回填「逐轮花费」。
   * 重连时该帧会重新下发，账本内部按 (turn, step, retry) + seq 做幂等折叠，不会翻倍。
   */
  

  /**
   * 重连后重建「断线时正在跑的那个回合」的 collector。
   *
   * 为什么必须有这一步：`pumpMux` 的 finally 会在断线时清空 `collectors`（否则重连后
   * 旧状态会让回复重复累加）。而重连时 DSH **只**通过开场快照重放历史 —— 快照被刻意
   * 排除在事件通道之外（否则历史回合会被当成新回合重复发送）。于是断线前发出的
   * `turn/start` 再也补不回来：重连后到达的 live `turn/end` 找不到对应回合，
   * `createTurnCollector.push()` 返回 null ⇒ **这一轮的回复被静默丢弃**（QQ 上没消息、
   * 日志里没记录、token 却照付）。
   *
   * 修法：只把「有 turn/start 但没有 turn/end」的回合重放进 collector ——
   * 这些正是断线那一刻仍在进行的回合。已结束的回合一律不喂，所以不会重复回复。
   */
  

  // 唤醒“防卡死”租约：正常应在 turn/end 时删除 pendingWakeKeys；若 DSH 接受了但一直没回合结束，
  // 30 分钟后强制解除 busy 标记，避免该会话永久无法被唤醒。
  
  
  

  // DSH 可用性探活 + 重启容错队列：
  // DSH 重启期间收到的 QQ 消息先入队（不丢），DSH 恢复后按序补投。
  let dshReady = false;
  let dshCheckStarted = false;
  let snowlumaWatchStarted = false; // SnowLuma 上游健康探测只启动一次（见 snowlumaHealth.start）
  let currentMode = 'chat'; // chat | closed-agent | reserved（仿真模式，由 DSH settings / state/mode.json 驱动）

  /**
   * 二代专用接口（表情库 / 图片 / 合并转发 / 会话状态）当前是否可用。
   * 【本地适配 2026-10-25】原实现只认 reserved2，导致 owner 私聊（closed-agent）里
   * 表情、图片、转发一律 403「该接口仅 reserved2 模式可用」。
   * closed-agent 的 agent 本身就有完整本地权限，HTTP 层再挡一次不构成边界。
   */
  

  /**
   * 后台唤醒 / 主动发言 / replyCheck 这类「仿真专用」调度是否允许。
   * 【本地适配 2026-10-25】只认 reserved2：closed-agent 只放开了 HTTP 工具面
   * （表情库、图片、转发可用），但**不该**被每 30~45 秒一次的后台唤醒循环打扰——
   * 那既白烧模型调用，又和用户消息抢队列，表现为「很卡」。
   */
  
  let lastMode = currentMode;
  // closed-agent 模式使用的 DSH agent preset：留空表示「用 DSH 自己声明的默认 preset」。
  // 旧版本这里硬编码 'router-standard'，但 DSH 0.1.5 已移除该 preset，硬编码会导致
  // 创建出的会话挂不上 preset，进而被 DSH 套上 standard（含本地工具）。
  let closedAgentPreset = '';
  // DSH 侧真实的 preset 清单与默认 preset：旧版本这里是硬编码的 'router-standard'，
  // 但 DSH 0.1.5 已不存在该 preset，硬编码会让 closed-agent 模式永远挂不上 preset。
  let dshPresetIds = [];        // 当前 DSH 可用的 preset id 列表（agentPresets/list）
  let dshDefaultPreset = '';    // DSH settings `agent-presets.default`，取不到时用列表里的 isDefault
  const queued = new Map(); // key -> { promptText }[]
  const queuedHintAt = new Map(); // key -> timestamp（冷却提示）
  const QUEUE_MAX = 50;
  const QUEUE_HINT_COOLDOWN_MS = 30_000;
  const queueRetries = new Map();
  const recallAt = new Map();        // key -> 上次「忽然想起」的时间
  const recentRecalls = new Map();   // key -> 最近用过的记忆 id（避免重复） // key -> 连续补投失败次数（用于退避/暂停恢复）

  // reset 竞态导致 ensureSession 抛「会话创建期间已重置」时，把消息放回队列稍后重试。
  // 已在队列中的相同文本不重复入队。
  const enqueueForRetry = (key, promptText, opts = {}) => {
    const items = queued.get(key) ?? [];
    if (!items.some((it) => it.promptText === promptText)) {
      if (items.length >= QUEUE_MAX) {
        items.shift();
        log(`队列满（${QUEUE_MAX}），丢弃最旧消息 (${key})`);
      }
      items.push({ promptText, farewell: !!opts.farewell, silent: !!opts.silent, media: opts.media ?? [], wakeReason: opts.wakeReason });
      queued.set(key, items);
    }
    queueRetries.delete(key); // 新消息入队视为新的机会，重置退避计数
    setTimeout(() => { flushQueue(); }, 3000);
  };

  // 从 DSH settings 读取桥接模式；命名空间未注册时回退本地 state/mode.json
  

  /** 拉取 DSH 当前可用的 agent preset 清单（供控制台下拉与 closed-agent 兜底使用）。 */
  

  /** 当前模式是否允许该会话进入 */
  

  /**
   * 解析一个 preset 名。
   *
   * strict=false（closed-agent，仅 owner 私聊）：名字不可用时回退到 DSH 默认 preset ——
   *   那里本来就用完整工具面，回退不构成提权。
   * strict=true（chat / reserved / reserved2，会话可能属于 QQ 群）：名字不可用时返回 ''，
   *   表示「没有可安全使用的 preset」，由调用方拒绝建会话（fail-closed）。
   *   **绝不能回退到 DSH 默认 preset（standard）**：standard 含 bash/文件读写等本地工具，
   *   一旦套在群聊会话上，群友即可驱动一个能操作本机的 agent（见 RULES.md「无本地工具」）。
   */
  

  /** 当前模式下的会话预设；返回 undefined 表示「该模式下没有可安全使用的 preset」 */
  

  /** 判断一个会话 key 是否仍被当前模式/白名单允许（供唤醒调度与 HTTP 路由共用）。 */
  

  

  

  /**
   * 让 DSH 停下一个已经不再属于桥接的会话：先清队列再取消在途 turn，最后归档。
   * 拆出来是因为所有「撤销映射」的路径都必须做同样的事（retireSession / session-reset /
   * workspace-reset / reset，以及控制台的二代状态重置）—— 少一处就会留下
   * 「DSH 还在烧 token、桥接已经收不到也发不出」的静默黑洞。
   */
  

  /**
   * 清掉「按会话 key 记账」的内存态。
   *
   * 为什么单独抽出来：这些 Map/Set 分散在文件各处，退役路径（retireSession）、
   * 手动重置（/api/session/reset、/reset、workspace reset）、二代状态重置
   * 各自只清了其中一部分 —— 于是「哪个 key 清哪个不清」完全靠人记。
   * 结果是有界但真实的慢性泄漏：被移出白名单的会话，其 lastSendFailed、
   * 限流时间戳会一直留在内存里。所有撤销会话映射的路径都必须调用这里。
   */
  

  

  

  let flushingQueue = false;
  let flushQueueAgain = false;
  const flushQueue = async () => {
    // 尾沿重跑：单飞锁只是「别并发跑」，不能把后来的请求直接丢掉。
    // 旧写法在 flush 正在 await 时（一次失败可能卡上 60 秒）把重试定时器的调用直接 return，
    // 于是**再也没有人重新排一次 flush**，队列里的消息会一直躺到下次收到新消息为止。
    if (flushingQueue) { flushQueueAgain = true; return; }
    flushingQueue = true;
    try {
      const entries = [...queued.entries()];
      queued.clear();
      for (const [key, items] of entries) {
        let sent = 0;
        let failed = 0;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          try {
            const [kind, idStr] = key.split(':');
            const id = Number(idStr);
            if (!modeAllowed(key, kind, id, cfg, currentMode)) {
              log(`补投跳过未授权会话 ${key}（当前模式 ${currentMode}）`);
              continue;
            }
            const result = await deliverPrompt(key, item.promptText, { farewell: item.farewell, silent: item.silent, media: item.media ?? [], wakeReason: item.wakeReason });
            if (!result.ok) {
              log(`补投失败 ${key}: ${result.error || '未知错误'}`);
              failed += 1;
              const rest = items.slice(i);
              const existing = queued.get(key) ?? [];
              queued.set(key, rest.concat(existing));
              break;
            }
            queueRetries.delete(key);
            sent += 1;
          } catch (error) {
            log(`补投异常 ${key}: ${error?.message ?? error}`);
            failed += 1;
            // 当前项 + 剩余项整体放回，避免丢失；旧消息优先
            const rest = items.slice(i);
            const existing = queued.get(key) ?? [];
            queued.set(key, rest.concat(existing));
            break;
          }
        }
        log(`已补投 ${key}: 成功 ${sent} 条，失败 ${failed} 条`);
        if (failed > 0) {
          const retries = (queueRetries.get(key) ?? 0) + 1;
          queueRetries.set(key, retries);
          if (retries > 5) {
            log(`补投持续失败，暂停快速重试，队列保留 (${key})，60 秒后恢复一次`);
            setTimeout(() => {
              queueRetries.delete(key);
              flushQueue();
            }, 60000);
          } else {
            const delay = Math.min(3000 * Math.pow(2, retries - 1), 60000);
            setTimeout(() => { flushQueue(); }, delay);
          }
        }
      }
    } finally {
      flushingQueue = false;
      if (flushQueueAgain) {
        flushQueueAgain = false;
        // 队列里还有东西才继续；用 setTimeout 让出一次事件循环，避免同步递归。
        if (queued.size > 0) setTimeout(() => { flushQueue(); }, 200);
      }
    }
  };
  const checkDsh = async () => {
    let ok = false;
    try {
      await api.settings.describe({});
      ok = true;
    } catch {}
    if (ok) {
      await refreshMode();
      // DSH 起来后拉一次 preset 清单；DSH 重启（dshReady 由 false 变 true）时再拉一次。
      if (!dshReady || dshPresetIds.length === 0) {
        try { await refreshPresetList(); } catch {}
      }
      reconcileSessionPolicies();
      if (!dshReady) {
        dshReady = true;
        lastMode = currentMode;
        log(`DSH 已就绪（模式: ${currentMode}）`);
        if (currentMode === 'reserved2') {
          // 首次确定模式为 reserved2 后再恢复持久化的有限睡眠定时器，
          // 避免在 initial chat 模式下设置定时器导致 timeout 唤醒被模式守卫吞掉。
          for (const key of socialV2.conversations.keys()) {
            setupSleepTimerV2(key);
            scheduleProactiveCheckV2(key);
          }
          log('桥接模式已确定为 reserved2，恢复有限睡眠定时器');
        }
        try { await flushQueue(); } catch (error) { log('补投队列异常:', error?.message ?? error); }
        // DSH 恢复后，把离线期间攒下的黑话学习窗口补触发
        for (const key of [...slangWindows.keys()]) maybeQueueSlangExtraction(key);
      } else if (currentMode !== lastMode) {
        if (lastMode === 'reserved' && currentMode !== 'reserved') {
          cleanupSocialForModeChange();
          log('桥接模式已离开一代仿真模式，清理社交状态');
        }
        if (lastMode === 'reserved2' && !socialToolsModeAllowed()) {
          clearAllSocialV2Timers();
          drainAllPromptQueues('模式切换，已取消排队中的投递');
          log('桥接模式已离开二代仿真模式，清理 reserved2 定时器与排队投递');
        }
        if (currentMode === 'reserved2' && lastMode !== 'reserved2') {
          for (const key of socialV2.conversations.keys()) {
            setupSleepTimerV2(key);
            scheduleProactiveCheckV2(key);
          }
          log('桥接模式已进入二代仿真模式，重建有限睡眠定时器');
        }
        log(`桥接模式已切换为: ${currentMode}`);
        lastMode = currentMode;
      }
    } else if (dshReady) {
      dshReady = false;
      log('⚠️ DSH 不可用（重启中？），QQ 消息将入队等待');
    }
  };
  

  // ── SnowLuma 上游健康：**连上了 ≠ 收得到** ──────────────────────────────────
  //
  // 为什么必须有这一段（这是一个真实存在的、被误诊过的失败形态）：
  // SnowLuma 用原生组件（`native/snowluma-win32-x64.{dll,node}`）挂进 QQ 客户端进程
  // 才能拿到消息，它自己的日志里管这层叫 `[Hook]`。这层会退化：
  //     WARN [Hook] receive path stale: ... silentFor=136193ms; reporting good=false
  // 而 **SnowLuma 进程与它的 OneBot WebSocket 都还活着**。于是桥接这边一切正常：
  // WebSocket 是通的、`bot.on('open')` 打过「SnowLuma 已连接」，控制台没有任何异常，
  // 但群里一条消息都不来 —— 运维看到的现象是「接了但没反应」，而**没有任何证据指向
  // SnowLuma 的 hook**，于是被报成「qq-bridge 注入失败」。
  //
  // 桥接本身**不可能**造成这种失败：它没有任何原生/注入面（依赖全纯 JS，源码里
  // 没有 .dll/.node/FFI/进程注入），也不启动、不控制 SnowLuma 与 QQ。它能做、也应该做的
  // 是**把这个失败变得可诊断**。
  //
  // 信号从哪来（**两处都实测核对过 SnowLuma 1.14.9 的运行时源码，别凭直觉改**）：
  //
  //   ① **心跳载荷里的 `status.good`** —— 权威信号，且是免费的。
  //      SnowLuma 每 30s 由**自己的定时器无条件**发一个 heartbeat
  //      （`index.mjs` 的 `HEARTBEAT_INTERVAL = 3e4` / `startHeartbeat()`），
  //      载荷里带 `status: { online, good: online && bridge.receiveHealthy }`。
  //      `receiveHealthy` 是它**对「QQ → hook → 我」这条接收链路**的自评，
  //      静默约 105s 就翻 false。所以：读心跳里的 good 就等于拿到了 hook 的健康度。
  //      ⚠️ 注意它**不经过** QQ 事件流水线 —— 心跳是本地生成的，所以"没有事件包"
  //      **不能**用来判断 hook 死活（见下方 ② 的措辞）。
  //
  //   ② `get_status` 的 `good`/`online` —— 与 ① 同源，用于①长期收不到时的兜底轮询。
  //      ⚠️ **不要用 `get_login_info` 取 good**：它只返回 `{ user_id, nickname }`。
  //      取错字段不会报错（SDK 只校验 status/retcode 信封，不校验 data 载荷），
  //      good 会永远停在 null —— 本文件第一版就是这么写的，等于权威信号整条是死代码。
  //      `src/mcp-snowluma-safe.js` 的 snowluma_status 工具是对的取法（get_login_info
  //      拿昵称 + get_status 拿 online/good），可对照。
  //
  //   ③ `bot_status`（账号会话上下线）—— SnowLuma 1.14.17 起才有，老运行时永不触发，
  //      所以只是加分项，不能作为唯一依据。
  //
  //   ④ 「距最近一个事件包的时长」—— 只能证明**SnowLuma 进程与 WS 链路还活着**，
  //      **不能**证明 hook 收得到 QQ 数据（心跳会一直来）。所以它只作为兜底提示，
  //      阈值取很宽，措辞必须留余地。
  // ── 本地控制台（独立 Web 面板，不依赖 DSH WebUI） ───────────────────────────
  // 模式/角色/静默状态都存 state/*.json，桥接即时感知；此服务只读写这些文件。
  

    function resolveAdminName(name) {
    try { return eval(name); } catch { return globalThis[name]; }
  }
  function setRuntimeVar(name, value) {
    switch (name) {
      case 'currentMode': currentMode = value; return true;
      case 'closedAgentPreset': closedAgentPreset = value; return true;
      case 'dshReady': dshReady = value; return true;
      case 'selfUserId': selfUserId = value; return true;
      case 'selfDisplayName': selfDisplayName = value; return true;
      case 'roleInjectMaxChars': roleInjectMaxChars = value; return true;
      case 'dshCheckStarted': dshCheckStarted = value; return true;
      default: return false;
    }
  }
  function makeRuntimeScope(ignored = []) {
    const blocked = new Set(ignored);
    return new Proxy({}, {
      has: (_target, name) => !blocked.has(name),
      get: (_target, name) => name === Symbol.unscopables ? undefined : resolveAdminName(name),
      set: (_target, name, value) => {
        if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error('invalid runtime scope name');
        try { eval(name + ' = value'); return true; }
        catch { throw new Error('runtime scope is read-only: ' + name); }
      }
    });
  }
  const adminScope = makeRuntimeScope();
  const handleScope = makeRuntimeScope(['kind', 'id', 'event', 'cfg']);
  const injectionScope = makeRuntimeScope(['args']);
  const composeInjection = createComposeInjection(injectionScope);
  const startConsoleServer = createConsoleServer(adminScope);

  // 会话代际：reset/清空工作区时递增，防止在途 ensureSession 把旧会话"复活"
  let sessionEpoch = 0;

  // 待应答的提问/审批：convKey -> pending
  const pending = new Map(); // key -> { kind, rpcId, sessionId, ... }

  // QQ 发送队列（顺序发送 + 间隔，避免触发频率限制）
  let sendChain = Promise.resolve();
  

  // 最近一次发送是否全部成功（按 key）。调用方据此决定要不要刷新「我发过言了」的时间戳 ——
  // 旧实现把发送失败吞成一行日志后**照常 resolve**，于是调用方以为发言成功，
  // 更新 lastAiReplyAt / 活跃调度，实际群里什么都没收到，而且只有一行滚动日志能看出问题。
  const lastSendFailed = new Map(); // key -> true（下一次成功即清除）

  

  /** 上一批发往该会话的消息是否全部成功。 */
  

  // 分条发送：与 sendToQQ 共用同一 sendChain，严格顺序；条间随机间隔，
  // 有概率使用长间隔（错落感）；最后一条后不再 sleep。
  


  // ── 图片/表情字节解析（供一代自动内联与二代按需工具） ────────────────────
  // 媒体上限（config.json 可调，但必须收敛到安全区间）：
  //   maxBytes  —— 单条消息里图片/表情的总字节上限。8MB 能覆盖绝大多数动图表情；
  //                太大会让 base64 常驻内存（×1.33）并拖慢 DSH 上传。
  //   maxPixels —— 单张图解码像素上限（防图片炸弹），与 DSH 的 64MP 默认一致。
  //   maxCount  —— 单条消息最多处理几张（防止一次 @ 带 20 张图把模型上下文撑爆）。
  const maxMediaBytesLimit = (() => {
    const n = Number(cfg.socialV2?.media?.maxBytes);
    return Number.isFinite(n) && n > 0 ? Math.min(20 * 1024 * 1024, Math.max(256 * 1024, Math.round(n))) : 8 * 1024 * 1024;
  })();
  const MAX_MEDIA_COUNT = (() => {
    const n = Number(cfg.socialV2?.media?.maxCount);
    return Number.isFinite(n) && n > 0 ? Math.min(8, Math.max(1, Math.round(n))) : 5;
  })();
  const MAX_MEDIA_BYTES = maxMediaBytesLimit; // 单条消息图片总字节上限
  const MAX_MEDIA_PIXELS = (() => {
    const n = Number(cfg.socialV2?.media?.maxPixels);
    return Number.isFinite(n) && n > 0 ? Math.min(64_000_000, Math.max(1_000_000, Math.round(n))) : 64_000_000;
  })(); // 单张图片像素上限，防止“图片炸弹”解码拖垮 DSH
  const MAX_MEDIA_STORE_PER_KEY = 500; // 每个会话最多缓存多少条消息的媒体元数据，防止无限增长

  // ── 喂给模型的那一份：体积与动图形态归一化 ────────────────────────────────
  //
  // 为什么必须在这里动手（而不是"让 DSH 自己处理"）：
  //   ① DSH 的 MCP 图片入口用正则校验 base64，实测量级 ≥4,474,880 字符（原始字节 ≥3.20 MiB）
  //      必抛 RangeError: Maximum call stack size exceeded，工具结果被降级成
  //      `[image unavailable: image/gif; Maximum call stack size exceeded; …]` —— 模型只看到一行错误。
  //      而下面的 MAX_MEDIA_BYTES 是**抓取**上限（默认 8 MiB），故意留着不动：
  //      得先把大图抓下来，才有机会压小它。
  //   ② DSH 对 image/gif 一律归一化成单帧，模型永远只看第一帧，且不知道那是动图。
  //      动图在桥接侧抽帧拼图后，信息量反而更高（实测 4.83MB/200 帧 → 92KB/269ms）。
  //
  // 上限默认值见 media-normalize.js 的 MEDIA_DEFAULTS；config.json 的 socialV2.media 可覆盖。
  // ⚠️ 只用于**喂模型**的出口。collectStickerV2 走 fetchOneBotImage 的原始字节，不能经过这里，
  //    否则收藏下来的表情会变成拼图/降采样版本。
  const modelMediaLimits = (() => {
    const m = cfg.socialV2?.media ?? {};
    return {
      enabled: m.normalize !== false,
      maxModelBytes: m.maxModelBytes,
      maxLongEdge: m.maxLongEdge,
      gifFrames: m.gifFrames,
      gifTile: m.gifTile,
      timeoutMs: m.normalizeTimeoutMs,
      ffmpegPath: resolveFfmpegLoose(process.env.FFMPEG_PATH || cfg.socialV2?.voice?.ffmpegPath)
    };
  })();

  /**
   * 把一张已抓到的图片整理成模型可安全消费的形态。
   * @returns {Promise<{ok:boolean, buffer?:Buffer, mimeType?:string, note?:string, error?:string}>}
   *          ok=false 表示"压不到可用体积"——调用方必须把它变成一句可读的失败原因，
   *          绝不发注定被 DSH 丢掉的字节（那样模型只会看到看不懂的英文错误）。
   */
  

  

  // OneBot 图片 file 字段只应接受简单缓存文件名；拒绝路径、URL、盘符、协议前缀等，
  // 防止把任意本地路径/内网 URL 交给网关 get_image 造成 SSRF/任意文件读取。
  // QQ 表情包 CDN 的地址可以只靠 emoji_id 推出来（实测形态：
  // https://gxh.vip.qq.com/club/item/parcel/item/<id 前两位>/<id>/raw300.gif）。
  // 市场表情不在网关缓存里（get_image 返回 image not found in cache），url 又可能缺失，
  // 这条兜底能救回这一类；只接受纯十六进制 id，绝不把任意字符串拼进 URL。
  

  // 有些网关不带 emoji_id，但 file 名里就嵌着它（实测 "f9-<32 位 hex>.gif" 或完整 resId）。
  

  /** 校验一张图片字节：格式、大小（调用方已限）、像素上限；不通过返回 null。 */
  

  /** 取视频原始字节：优先用段里带的直链，其次走 OneBot get_file / get_video。 */
  // 审计范围：closed-agent 仅对 owner 私聊跳过；其余模式/会话一律审计
  

  // 入队校验无法约束排队等待期间的权限变化，每条消息临近实际发送时再次校验。
  

  // 静默模式：除 owner 私聊外，不发送任何在途 AI 回复。
  

  const rawTransport = createTransport({ sendToQQ });
  const securityNotifier = createSecurityNotifier({ sendRaw: rawTransport.sendRaw, log });

  // 统一出站消息：先完整文本审计，再发送。返回是否真的发出。
  

  // 会话模型应用去重：每个 DSH 会话在本进程内只 selectModel 一次；
  // 控制台热切换思考强度时递增 modelSelectionEpoch，使旧记录失效并在下一条消息重新应用。
  // 四种 QQ 模式共用 DSH 会话，统一强制使用多模态模型 DeepSeek-V41-Flash（id: deepseek-flash）；
  // 它同时支持 text/image 输入，取代已下线的 deepseek-v4-flash-vision-exp。
  const modelAppliedSessions = new Map(); // sessionId -> 已应用的 modelSelectionEpoch
  // 返回 'applied' | 'not-found' | 'failed'。
  // 'not-found' 表示 DSH 侧会话已经不存在（DSH 重启、异常退出、归档竞态），
  // 本地映射已失效，调用方必须退役重建，否则每条消息都会对着一个不存在的会话重试。
  

  

  // ── 仿真群友社交引擎（仿真模式，内部标识 reserved） ────────────────────────
  const randInt = (min, max) => {
    if (min > max) [min, max] = [max, min];
    return Math.floor(min + Math.random() * (max - min + 1));
  };
  let selfNickname = 'deepseek'; // 机器人昵称（小写；启动时从网关获取，识别"被提到"用）
  // 给 agent 看的身份（保留原始大小写）与机器人自己的 QQ 号。
  // 为什么必须单独存：消息里只有 "@樰" 这一串文本，agent 没有任何途径知道"樰"就是它自己，
  // 于是会把 @自己 当成 @别人、已读不回（issue #29）。昵称与 QQ 号要显式写进 prompt。
  let selfDisplayName = '';
  let selfUserId = '';
  const SILENT_TURN_TIMEOUT_MS = 300000; // 摘要静默名额 5 分钟未消费则作废，避免吞掉后续正常回复
  const social = {
    states: new Map(),             // key -> { phase: 'idle'|'active'|'probing'|'exiting', lastCheckAt, nextCheckAt, lastActiveMessageAt, activeEnteredAt, activeDeadlineAt, activeExitAt, probeDeadline }
    recentMessages: new Map(),     // key -> [{sender, text, time}]（最近消息窗口，AI 的"持续感知"）
    pendingSummaries: new Map(),   // key -> { items: [{sender, text, time}], since }（观望期未参与消息）
    silentContext: new Map(),      // key -> [{sender, text, time}]：选择性沉默但"已看到未回应"的消息，下次投递时带给模型
    loopTimer: null,
    silentTurns: new Map(),        // sessionId -> { id, ts }[]：待静默的摘要 turn 队列（FIFO + 超时回收）
    pendingTimers: new Map(),      // key -> Set<timerId>：社交排程中尚未触发的定时器
    exitingSessions: new Set()     // sessionId：当前正在等待“活跃超时退场”发言完成的 DSH 会话
  };

  // ── 二代仿真模式（reserved2）运行时状态与唤醒配置 ────────────────────────
  const adminStatus = createAdminStatus({ getCfg: () => cfg, getMode: () => currentMode, getClosedAgentPreset: () => closedAgentPreset, readRoleState, isDshReady: () => dshReady, isPaused: () => socialV2.paused, getInitiativeStats: () => initiativeScheduler?.stats?.() ?? null, getSnowlumaSnapshot: () => snowlumaHealth.snapshot(), readActivityTail });
  const adminAuth = createAdminAuth({ getConversations: () => socialV2.conversations, canonicalKey: canonicalV2Key });
  const socialV2 = {
    conversations: new Map(), // key -> state
    paused: false, // 控制台可暂停整个二代 AI 活动（停止唤醒/等待）
  };

  // 一代/普通模式的图片/表情元数据存储：key -> Map<messageId/seq, media[]>
  // 二代模式则直接存在 socialV2 会话的 recentMessages/unread 消息对象上。
  const messageMediaStore = new Map();
const lastImageDesc = new Map();
  // 二代会话见过的 forward id（有界，避免 recentMessages 滚动淘汰后无法读取刚见过的转发）
  const seenForwardIds = new Map(); // key -> Set<string>

  // 归一化“指定群友发言唤醒”名单：
  // - 只保留正整数 QQ 号（字符串形式），拒绝 null/对象/“null”/非法字符等脏数据；
  // - 去重并限制最多 20 个，避免唤醒名单无限膨胀/被恶意塞入异常值；
  // - undefined/null 都视为“不启用”（空数组）。
  

  // triggers 的**唯一**合法字段集合。写入与加载都按它过滤：
  // 旧写法 `{...current.triggers, ...inputTriggers}` 会把模型传来的任意键原样并入、
  // 持久化、再由 qq_get_prompt 原样回给模型（每次请求都带着），等于给了一个
  // 「用 1MB 垃圾键把状态文件与每轮 prompt 撑大」的入口。
  const WAKE_TRIGGER_KEYS = Object.freeze(['atMention', 'nameMention', 'speakerIds', 'keywords', 'question', 'poke', 'anyMessage', 'probability']);
  

  

  // 把“仍使用默认唤醒配置”的会话刷新为当前推荐/默认参数。
  // 只有 confirmedBy === 'default' 的会话才会被刷新；AI 或管理员显式设置过的（set_wake_config / mark_read）不会被覆盖。
  

  // 保存推荐/默认参数后，把所有仍使用默认配置的会话同步到新默认值。
  

  // 沉睡前强制观察窗口：防止 AI 聊两句就立刻潜水。
  // 新规则：每次设置潜水/下一次唤醒前，AI 必须先进入一次“沉睡前观察”（qq_wait_for_messages(timeoutMs=preSleepWaitMs)）。
  // - 观察期间没人说话 → 可以设置唤醒并沉睡（preSleepWaitSatisfiedAt）。
  // - 观察期间有人发了新消息 → 等待工具会把新消息带回给 AI（preSleepWaitObservedAt）；
  //   AI 看过新消息后若判断没必要参与，可以直接沉睡；若参与了（发送/拍一拍），则下次想睡需重新观察。
  const EXPLICIT_END_RE = /(?:不聊了|不说了|晚安|睡了|先睡了|下了|先下了|拜拜|再见|走了|先走|撤了|去忙|忙了|下次再聊|下次聊|散了吧|结束|就到这|先这样|就这样吧|886|88|睡觉了|下班了|去洗澡|去吃饭了)/i;

  

  

  

  

  // 防“永眠”：检查当前 WakeConfig 是否至少有一个可触发唤醒的途径；没有则重置为默认配置。
  // opts.skipSave=true 用于加载状态阶段，避免中途落盘覆盖尚未加载的会话。
  

  

  

  

  // ── 二代仿真：操作者预写的「初始提示词」（每个会话一份，只在首次唤醒时注入） ──────
  //
  // 用途：让操作者在控制台提前告诉 AI「这个群是什么圈子、什么氛围、有什么忌讳」。
  // 为什么单独一个文件、而不是塞进 social-v2.json 的会话状态：
  //   · 会话状态会被 /api/session/reset 与 /api/socialV2/reset 整体删除，而这份是操作者
  //     手写的配置 —— 重置一次 AI 上下文不该把它一起清掉；
  //   · 控制台需要能在群还没说过话（连会话状态都还不存在）时就写好。
  // 为什么只在首次唤醒（bootstrap）注入：这是一份「接入这个群时的背景介绍」，每轮都塞
  // 既白烧 token，又会让 AI 把它当成新指令；首次唤醒后它已在 DSH 会话上下文里。
  const initialPrompts = new Map(); // key -> { text, createdAt, updatedAt }
  let initialPromptsWritable = true;

  

  /** 归一化操作者输入：统一行尾、去掉 BOM 与控制字符，只裁首尾空白（保留段落换行）。 */
  

  /**
   * 读取 state/initial-prompts.json。
   * 读不动/读坏时降级为「只读不写」（与 sessions.json、表情库、黑话库同一口径）：
   * 否则内存里的空映射会在下一次保存时把原文件覆盖掉，操作者写的内容永久丢失。
   */
  

  

  

  /**
   * 保存/删除一份初始提示词。空内容 = 删除。
   * 写入失败时把内存改动回滚，保证「接口说失败」与「内存里确实没变」一致。
   * @returns {{ok: boolean, statusCode?: number, error?: string, key?: string, deleted?: boolean, chars?: number, entry?: object|null}}
   */
  

  /**
   * 首次唤醒时插入的环境段；没有配置就返回空串（不影响原有 prompt）。
   * 超长内容按上限截断后注入（文件可能被手工改过），并在截断处留省略号。
   */
  

  

  

  

  

  loadSocialV2State();
  // 操作者预写的会话初始提示词（与控制台入口同样在 main() 里；损坏时只读降级，不阻塞启动）。
  loadInitialPrompts();

  

  

  // 启动阶段的"明确与 AI 有关"：@ / 提到名字 / 必回关键词 / 管理员私聊
  

  

  // 触发进入活跃（启动阶段 → 活跃阶段）
  

  

  

  // 离开仿真模式时清理全部社交运行时状态，避免旧定时器/状态残留。
  

  

  // 活跃阶段：只贴"没给过 AI 的新消息"（上下文在会话历史里，不重复贴，不贴人格）
  // allowSilent=false 表示这条必须回（被 @/点名/私聊等），不提供 [SILENT] 出口。
  // E5：主动开话题统一走 runInitiative → Orchestrator，不再拼旧 DSH prompt。
  

  

  

  


  

  const executionGateway = createExecutionGateway({
    sendOne: async (chat, msg, action) => {
      const ok = await auditAndSend(chat, msg, action);
      if (!ok) throw new Error('audit-blocked');
    },
    sendExpression: async (chat, action) => {
      const ex = action.expression ?? {};
      if (ex.kind === 'sticker') {
        await sendStickerV2(chat, ex.value);
        return;
      }
      if (ex.kind === 'face') {
        await sendFaceSegment(chat, Number(ex.value));
        return;
      }
      if (ex.kind === 'kaomoji') {
        const ok = await auditAndSend(chat, ex.value);
        if (!ok) throw new Error('audit-blocked');
        return;
      }
      throw new Error('unsupported expression: ' + ex.kind);
    },
    now: () => Date.now(),
    log: (m) => log(m)
  });

  

  

  


  

  const promptQueue = createPromptQueue({
    deliver: (key, promptText, opts) => deliverPromptNow(key, promptText, opts)
  });

  // 每个 QQ 会话串行投递 DSH prompt，保证 turn 完成顺序与提交顺序一致。
  

  

  // 旧社交循环已退役，不再启动定时器。

  // 当前角色扮演提示：读 state/current-role.json + roles/<角色>.md，
  // 由桥接注入到 QQ 群消息（群友无法通过对话修改，只能由管理端写该文件）。
  // 缓存 key 为两个文件的 mtime，mtime 未变时直接返回，避免每次同步读文件。
  let roleHintCache = { key: '', raw: '' };
  // 原始人格卡（按 mtime 缓存，不截断）。
  
  // 按仿真模式取用：先用标题里的 〔一代〕/〔二代〕 标记筛掉另一模式的专属小节，
  // **再**按上限截断——这样另一模式的内容不会白白占掉本次的注入预算。
  
  

  // 二代仿真模式专用角色提示：去掉一代的 [SILENT] / 空格分句等状态机指令，避免与工具协议冲突。
  // 为了不削减原角色卡内容，示例节不整体删除，而是把“用空格分条”的示范改写成“用逗号表示停顿”，
  // 让二代 AI 既保留原有人格示例，又不会照抄单条消息里的中文空格。
  

  // 仅用于二代角色卡“回复示例”节：把示例里用于分条的中文空格改写成中文逗号。
  // 空格两侧只要有一侧是中文/中文标点，且另一侧不是 / \ ( ) [ ] { } " ' < > | 等符号，就转成逗号。
  // 这样能保留示例内容，同时避免把英文/URL/斜杠周围的空间改坏。
  

  // 检测二代发送内容里“中文之间用空格”的不自然写法，用于给 AI 返回软提醒。
  // 只检测空格两侧都是中文/中文标点的情况，避免误伤英文单词间隔（如 DeepSeek V3）。
  

  // 检测二代发送内容里“分条断点不自然”的情况：某条消息以逗号/顿号等非终止标点结尾，
  // 或以“的/了/吗/呢/吧/是/在/把/被/让/给”等通常需要接后续成分的词结尾，下一条又紧跟中文内容，
  // 说明 AI 很可能把同一句话拆到了两条消息里。这里只做软提醒，不拦截、不改写。
  

  

  // QQ 群成员名片/昵称缓存：@ 段解析用，避免每条消息都调一次 OneBot API。
  const groupMemberNameCache = new Map(); // `groupId:userId` -> { name, ts }
  const GROUP_MEMBER_NAME_TTL_MS = 5 * 60 * 1000;
  
  // 群成员集合缓存：用于「拍一拍目标必须是本群成员」的校验。
  // 不校验的话，群友只要让 AI 传一个任意 QQ 号，桥接就会向网关发 group_poke，
  // 等于把机器人账号变成任意 QQ 号的探测/骚扰工具（工具描述里承诺了白名单约束）。
  const groupMemberIdsCache = new Map(); // groupId -> { ids:Set<string>, ts }
  const GROUP_MEMBER_IDS_TTL_MS = 60 * 1000;
  

  

  // QQ 引用/回复解析缓存：messageId -> { sender, text, ts }，避免每条引用都调一次 OneBot API。
  const replyInfoCache = new Map(); // `kind:convId:messageId` -> { info, ts }
  const REPLY_INFO_TTL_MS = 10 * 60 * 1000;
  const REPLY_NEGATIVE_TTL_MS = 5 * 1000; // 失败/归属缺失只短缓存，避免一次瞬时抖动导致长时间解析失败
  
  

  // 发送引用时解析目标：支持真实 QQ message_id，也支持 recentMessages 里的 seq（自动映射到真实 messageId）。
  

  // 判断当前消息是否“引用/回复了机器人自己”：若是，则桥接层也把它当作直接对 AI 说。
  

  // ── 二代仿真模式（reserved2）唤醒调度 ──────────────────────────────────
  

  // 二代拍一拍事件写入最近/未读消息流，让 AI 能看到“谁拍了拍谁/拍了拍我”。
  

  

  

  

  

  const appendToolLogFile = createCappedLogger(TOOL_LOG_FILE, 2000);

  

  const SENSITIVE_ARG_KEYS = new Set(['token', 'authorization', 'password', 'passwd', 'secret', 'apikey', 'api_key', 'accesskey', 'access_key', 'accesstoken', 'access_token', 'cookie', 'session', 'privatekey', 'private_key', 'clientsecret', 'client_secret', 'refreshtoken', 'refresh_token', 'x-agent-token', 'x_agent_token']);
  

  

  

  // Only messages actually offered to the model authorize cursor-based acknowledgement.
  // Keep this receipt in memory: after a restart the model must fetch unread again.
  

  

  

  

  // ── 时间观念（沉睡后醒来最容易犯的错） ────────────────────────────────────
  //
  // 现象（操作者报告 + 会话实证）：AI 沉睡很久后被唤醒，看到一小时前的话仍然当成"刚发的"去接，
  // 甚至抢进早已散场的话题。根因有两层：
  //   ① 模型看到的时间是裸 epoch（`time: 1792294529471`），它根本算不出"这是 38 分钟前"
  //      → 已由 qq-model-view.js 换成 `at`/`ago`；
  //   ② 提示词里**没有任何一条规则**告诉它"旧消息不该按实时对话接"。
  // 这里补第二层：把「现在 / 最新一条多旧 / 唤醒原因那条多旧」算好直接写进去，并给分档规则。
  // 阈值可调（config.json 的 socialV2.wake.staleChatMinutes / staleSilentMinutes）。
  const pad2 = (n) => (n < 10 ? `0${n}` : String(n));

  /** 本地 HH:MM（与消息 at 字段同一口径）。 */
  

  

  /** 唤醒原因里带的本地 seq（形如 `atMention@seq194`），没有就 null。 */
  

  

  /**
   * 【时间感】规则块。没有可判断的消息时返回空串（引导/定时唤醒不必背这段）。
   *
   * 注意阈值必须和 §timeSenseCfg 一致，否则模型会看到自相矛盾的两档。
   */
  

  

  

  // 机器人自己的身份（昵称 + QQ 号）。**必须显式写进 prompt**：
  // agent 能看到的消息里只有 "@樰" 这串文本，没人告诉它"樰"就是它自己，于是它会把
  // @自己 当成 @别人、已读不回（issue #29）。群名片可能与昵称不同，但 at/引用段里
  // 带的是 QQ 号，所以两条都给。
  

  

  

  

  

  

  /** 会话此刻算忙的具体原因（只用于日志，避免排查时只能反复重启加猜）。 */
  

  

  const WAKE_PRIORITY = {
    private: 100,
    atMention: 90,
    question: 80,
    speaker: 75,
    nameMention: 70,
    keyword: 60,
    anyMessage: 50,
    replyCheck: 40,
    timeout: 30,
    proactiveCheck: 20
  };

  // 唤醒原因可能带子类型（如 keyword:小鲸鱼、speaker:昵称），取冒号前的基名计算优先级。
  

  // 与「未读消息」无关的唤醒原因（定时器/引导）。这些原因在会话繁忙时被暂存后，
  // 不能用「unread 里还有没有对应 seq」来判断是否还要补发 —— 那一轮很可能已经把
  // 未读全部标读了，结果就是 timeout 定时器被静默丢掉、会话停在无定时器的静默态。
  const TIMER_WAKE_REASONS = new Set(['timeout', 'replyCheck', 'proactiveCheck', 'bootstrap', 'admin']);
  

  

  /**
   * 回合结束后补发「繁忙期间暂存」的唤醒原因。
   *
   * 两类原因必须分开处理：
   *   · 消息类（@/关键词/提问/私聊/拍一拍…）只有在那条消息还没被本回合处理掉时才补发
   *     （unread 里还能找到它的 seq）；
   *   · 定时器类（timeout/replyCheck/proactiveCheck/bootstrap/admin）与未读水位无关：
   *     那一轮很可能已经把未读全部标读，用 unread 判断会让「到点唤醒」被静默吞掉 ——
   *     timeout 时 sleepTimer 已被清空，结果是会话停在「sleepUntil 已过期、无任何定时器」。
   */
  

  

  

  

  

  

  

  

  // QQ 消息 → DSH prompt
  /** 自己发的消息不要拿去记记忆。 */
    const handleIncoming = createHandleIncoming(handleScope);

  // 取消/拒绝一个挂起的提问或审批，并给 DSH 回执（超时、被新请求覆盖时使用）
  

  // 回答挂起的提问/审批
  

  // 二代拍一拍（notify/poke）事件处理：写入消息流并按需唤醒。
  

  

  // DSH 事件流 → QQ

  /**
   * 把一条 session/event 喂给该会话的 turn collector，并维护 collectors 的生命周期。
   *
   * 两条不变量（都曾被真实故障踩过）：
   *   ① 只为 turn/start 建 collector —— 任何事件都建的话，一条重连后补发的
   *      assistant/message 就会留下永不结束的空 collector，而「会话是否繁忙」正是按
   *      collectors.has() 判断的 ⇒ 这个会话从此再也收不到唤醒；
   *   ② turn/end 即使没有匹配的 turn/start（重连快照没带上）也要清掉已成空壳的
   *      collector，否则同样会永久繁忙。
   */
  

    const pumpMux = createPumpMux(adminScope);

  // QQ 侧（SnowLuma OneBot WebSocket 客户端）
  // 网关实例：具体协议由 src/gateway/ 适配器决定（SnowLuma 扩展 / 标准 OneBot v11）
  const bot = createGateway(cfg, log);
  const faceMedia = createFaceMedia({ stateDir: STATE_DIR, bot, log });
  const mediaFetcher = createMediaFetcher({
    bot, getSelfUserId: () => selfUserId, safeFetchBuffer, acceptImageBuffer,
    emojiCdnCandidates, emojiIdFromFileName, mimeFromUrl, isProbablySafeImageFileRef,
    base64FromMaybe, isSafeLocalMediaPath, log, maxBytes: MAX_MEDIA_BYTES
  });
  const mediaData = createMediaData({ faceMedia, toModelMedia, mediaFetcher, maxCount: MAX_MEDIA_COUNT, maxBytes: MAX_MEDIA_BYTES });
  const videoFetch = createVideoFetch({ getCfg: () => cfg, onebotHttpAction, log });
  const mediaResolver = createMediaResolver({
    faceMedia, toModelMedia, mediaFetcher, fetchOneBotVideo: videoFetch.fetchOneBotVideo, resolveFfmpegPath: videoFetch.resolveFfmpegPath,
    getCfg: () => cfg, getStickerEntries: () => stickerEntries, emojiIdFromFileName, log,
    maxCount: MAX_MEDIA_COUNT, maxBytes: MAX_MEDIA_BYTES
  });

  bot.onPrivateMessage(async (event) => {
    // 统一按字符串比较：网关可能把 id 序列化成 number/string 混用，
    // 用 `===` 漏掉自己发的消息会进入正常处理（reserved2 下 AI 会回答自己 / chat 下可能回复循环）。
    if (String(event?.user_id ?? '') === String(event?.self_id ?? '')) return;
    try { await handleIncoming('private', event.user_id, event, withProfile(cfg, event.user_id, 'private')); } catch (error) { log('处理私聊消息出错:', error?.message ?? error); }
  });
  bot.onGroupMessage(async (event) => {
    if (String(event?.sender?.user_id ?? '') === String(event?.self_id ?? '')
      || String(event?.user_id ?? '') === String(event?.self_id ?? '')) return;
    try { await handleIncoming('group', event.group_id, event, withProfile(cfg, event.sender?.user_id ?? event.user_id, 'group')); } catch (error) { log('处理群消息出错:', error?.message ?? error); if (error?.stack) log('[stack] ' + String(error.stack).split('\n').slice(0, 4).join(' | ')); }  });
  bot.onNotice('notify', async (event) => {
    try { await handlePokeNotice(event); } catch (error) { log('处理拍一拍事件出错:', error?.message ?? error); }
  });

  // ── 上游健康：任何事件包都算「SnowLuma 还活着」，心跳还额外带接收链路健康度 ──
  // 用 onEvent 挂一个**旁路**订阅（不影响主链路）：
  //   · 任意事件包 → 记账（证明 SnowLuma 进程 + WS 链路还在）；
  //   · `meta_event/heartbeat` → 读载荷里的 `status.good`。**这是主信号**：
  //     SnowLuma 每 30 秒无条件发一次心跳，而 good = online && receiveHealthy 是它对
  //     「QQ → hook → 我」这条接收链路的自评（实测核对过 1.14.9 运行时源码）。
  //     免费、及时，且**不依赖较新的运行时**。
  // 注册失败不影响主链路（不同 SDK 版本的订阅方法可能不同），所以整体包在 try 里。
  try {
    bot.onEvent((event) => {
      const post = event?.post_type;
      snowlumaHealth.noteUpstreamPacket(post
        ? `${post}${event.notice_type ? `/${event.notice_type}` : ''}${event.meta_event_type ? `/${event.meta_event_type}` : ''}${event.message_type ? `/${event.message_type}` : ''}`
        : 'event');
      if (post === 'meta_event' && event?.meta_event_type === 'heartbeat') {
        // status 未在 SDK 类型里声明（OneBotMetaEvent 只声明 meta_event_type），
        // 但 OneBotBaseEvent 是 JsonObject，读取合法。
        snowlumaHealth.noteReceiveHealth(event.status?.good, 'heartbeat');
        if (typeof event.status?.online === 'boolean') snowlumaHealth.state.accountOnline = event.status.online;
        snowlumaHealth.report();
      }
    });
  } catch (error) {
    log(`（上游事件旁路订阅不可用，健康检测退化：${error?.message ?? error}）`);
  }

  // SnowLuma 1.14.17 起新增 bot_status（账号会话边沿）。老运行时不会发这个事件，
  // 所以它只是加分项：收到就记下来，收不到不影响其它判断。
  try {
    bot.onBotStatus((event) => {
      snowlumaHealth.noteUpstreamPacket('notice/bot_status');
      const sub = String(event?.sub_type ?? '');
      snowlumaHealth.state.accountOnline = sub === 'online';
      if (sub === 'offline') {
        log('⚠️ SnowLuma 报告 QQ 账号会话已离线（bot_status: offline）—— QQ 侧掉线或被顶号，'
          + '在重新登录之前群里不会有任何消息进来。');
      } else if (sub === 'online') {
        log('SnowLuma 报告 QQ 账号会话已上线（bot_status: online）');
      }
    });
  } catch (error) {
    log(`（bot_status 订阅不可用（SnowLuma 运行时较旧？）：${error?.message ?? error}）`);
  }

  bot.on('open', () => {
    // 用实际连接地址（自愈后可能与 config 里的初值不同，别打印过期的那个）
    const connectedUrl = bot.url ?? cfg.snowluma.wsUrl;
    snowlumaHealth.state.connected = true;
    log(`SnowLuma 已连接：${connectedUrl}`);
    // 「已连接」只说明与 SnowLuma 的 WebSocket 通了，**不说明 QQ 侧收得到消息** ——
    // 这个区别见 snowlumaHealth.start 的说明。这里顺手把上游健康快照刷一次。
    void snowlumaHealth.poll();
    // 读取机器人昵称（用于社交模式"被提到"识别）；重连后也会刷新
    bot.getLoginInfo().then((login) => {
      if (login?.nickname) {
        selfNickname = String(login.nickname).toLowerCase();
        selfDisplayName = String(login.nickname).trim();
        log(`机器人昵称: ${login.nickname}`);
      }
      if (login?.user_id != null) selfUserId = String(login.user_id);
    }).catch(() => {});
    // 连接成功后顺手确认一下 token 是否已跟当前账号对齐；不一致就写回 config.json，
    // 让 MCP 工具（另一个进程）也能拿到正确的 token。
    void syncTokenToFile();
  });

  /**
   * SnowLuma 恢复连接时自愈 accessToken。
   *
   * 为什么需要：SnowLuma 的 OneBot 配置按账号分文件（config/onebot_<QQ号>.json），
   * 每个账号 token 不同。换账号登录后，config.json 里的旧 token 会 401/连不上，
   * 而 SDK 的重连会一直用**构造时**那个 token 无限重试 —— 表现为"桥接活着但收发全废"。
   * 这里在每次重连失败时重新发现当前账号的 token 并热更新，随后自愈。
   */
  /**
   * 应用自愈结果：**HTTP token 与 WS token 是两个不同的值**。
   *   - cfg.snowluma.accessToken → HTTP 调用（发语音、fetch_ptt_text、get_msg 等）与写回 config.json
   *   - bot.accessToken          → WebSocket 连接（桥接的主链路，端口 3001）
   * 只修其中一个的话，桥接仍会以 1006 反复重连（实测踩过）。
   */
  

  /** 只写文件、不动物件（连接已成功时用）。 */
  

  let tokenHealAt = 0;
  

  bot.on('close', (info) => {
    snowlumaHealth.state.connected = false;
    log(`SnowLuma 连接断开（code=${info?.code ?? '?'}），重连中…`);
    // 连不上时最常见的原因就是换了 QQ 账号 → token 变了；顺手自愈。
    // 注意 1006 在**每次启动**都可能出现一次：HTTP token 与 WS token 是两个不同的值，
    // config.json 里存的是前者，WS 需要用自愈发现的那个（详见 bot.connect() 处的说明）。
    void healTokenIfStale(`close code=${info?.code ?? '?'}`);
  });
  bot.on('error', (error) => {
    // SDK 在 WS 升级被拒（401 / 建连失败）时可能**只 emit error、不 emit close**，
    // 于是挂在 close 上的 token 自愈永远不会触发 —— 表现为「桥接活着但收发全废」，
    // 用户只能靠手工改 token 绕过去（issue #19）。这里同样尝试一次（内部有 10s 节流）。
    const detail = error && typeof error === 'object'
      ? [error.code, error.message, error.reason, error.type].filter(Boolean).join(' | ') || JSON.stringify(error)
      : String(error ?? '');
    log(`SnowLuma 错误：${detail || '(无详情)'}`);
    void healTokenIfStale(`error ${detail}`.trim().slice(0, 200));
  });

  // SnowLuma 尚未就绪时不阻塞桥接启动：SDK 自带后台重连，DSH 侧照常连接。
  bot.connect().catch((error) => {
    // 说明为什么"第一次连不上"在这里几乎是**必然**的，避免用户把它当成故障：
    // SnowLuma 的 **HTTP token（默认 3000）与 WS token（默认 3001）是两个不同的值**
    // （实测：同一个账号，两者不同；config.json 只能存一个，存的是 HTTP 那个）。
    // 所以 WS 首次连接通常会被拒 → close(1006) → 触发 token 自愈（重新发现 WS token）
    // → 重连成功后才是「SnowLuma 已连接」。若 homeDir 没配/被移动/读不到 SnowLuma 的
    // config/onebot_<QQ>.json，自愈就无从下手，这时才会一直连不上 —— 那种情况请查
    // 日志里的「token 自愈失败」与 config.json 的 snowluma.homeDir。
    log(`SnowLuma 首次连接未成功（将在后台自动重连并尝试自愈 WS token）: ${error?.message ?? error}`);
  });
  log('桥接已启动。按 Ctrl+C 退出。');
  // 预热表情库：启动时同步一次 QQ 收藏表情，失败不阻塞（AI 首次调用工具时还会再试）。
  if (cfg.socialV2?.sticker?.enabled !== false) {
    syncStickerLibrary(true).catch((error) => log('启动预热表情库失败:', error?.message ?? error));
  }
  startDshWatch();
  snowlumaHealth.start();
  startConsoleServer();
  startInitiativeScheduler();

  const peopleFile = path.join(STATE_DIR, 'people.json');
  const syncPeopleNow = () => syncPeopleDirectory({
    file: peopleFile,
    groups: cfg.allow?.groups ?? [],
    ownerQQ: cfg.ownerQQ,
    selfUserId,
    selfName: selfDisplayName,
    fetchMembers: async (gid) => {
      const body = await onebotHttpAction('get_group_member_list', { group_id: Number(gid) }, { timeoutMs: 15000 });
      return body?.data ?? [];
    },
    log
  }).catch((error) => log('[people] 自动同步失败（忽略）：' + (error?.message ?? error)));
  setTimeout(() => { void syncPeopleNow(); }, 5000).unref?.();
  setInterval(() => { void syncPeopleNow(); }, 10 * 60 * 1000).unref?.();

  await pumpMux();
}

process.on('SIGINT', () => {
  log('退出中…');
  saveState();
  releaseLock();
  process.exit(0);
});
process.on('SIGTERM', () => {
  saveState();
  releaseLock();
  process.exit(0);
});
process.on('unhandledRejection', (error) => {
  // 打出 stack：只记 message 的话，「偶发一次」和「已经坏了六小时」看起来一模一样。
  log('未处理异常:', error?.stack ?? error?.message ?? error);
});
/**
 * 未捕获异常兜底。
 *
 * 为什么必须有：`log()` 是从 SnowLuma SDK 的 socket 事件回调里被调用的，而 SDK 的
 * emitter 逐个调用监听器、不做任何保护。stdout 的读者（守护 cmd 窗口）一旦消失，
 * `console.log` 会抛 EPIPE —— 这个异常会一路穿过 log() → 监听器 → emit → socket 回调，
 * 变成 uncaughtException。没有兜底的话整个 24/7 进程直接死掉且不留堆栈，
 * 在 start.bat 的重启循环里就变成「每 5 秒崩一次」。
 */
process.on('uncaughtException', (error) => {
  try { log('致命异常（进程即将退出）:', error?.stack ?? error?.message ?? error); } catch {}
  try { saveState(); } catch {}
  releaseLock();
  process.exit(1);
});
process.on('exit', () => releaseLock());


export { main };
