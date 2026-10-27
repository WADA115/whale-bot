// qq-owner 专用护栏：owner 私聊的 agent 拥有**完整工具面**（pwsh/read/write/edit），
// 这意味着它理论上可以改掉桥接自己的源码、改掉鉴权逻辑、甚至删掉整个仓库。
//
// 本守卫只做一件事：**禁止写改 qq-bridge 仓库**（源码、脚本、配置、状态）。
// 例外：允许写 `audio/`（语音库是运行时素材，不是代码）。
//
// 读操作不拦：排查问题时读日志/读源码是合理的；被拦的是「改」。
// 想临时放开：把 qq-owner-guard 行从 dsh/agent-presets/qq-owner/agent.cordis.yml 删掉，
// 再跑 `node scripts/build-agent-preset-patches.mjs` 并重启 DSH。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'qq-owner-guard'

export const inject = ['tools']

/**
 * 定位仓库根。
 *
 * 注意：DSH 通过 profile 的 node_modules **junction** 加载本包，所以 import.meta.url
 * 可能是 `~/.dsh/plugins/qq-agent-presets/...` 而不是仓库真实路径。先用 realpathSync
 * 解开 junction，再逐级向上找「package.json 里 name === qq-bridge」的目录；
 * 都不行时退回「包含 src/bridge.js 的目录」，最后退回 cwd。
 */
function findRepoRoot() {
  const candidates = []
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    candidates.push(fs.realpathSync(here))
    candidates.push(here)
  } catch {}
  candidates.push(process.cwd())

  for (const start of candidates) {
    let dir = start
    for (let i = 0; i < 6; i += 1) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
        if (pkg?.name === 'qq-bridge') return dir
      } catch {}
      if (fs.existsSync(path.join(dir, 'src', 'bridge.js'))) return dir
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return null
}

const REPO_ROOT = findRepoRoot()

const norm = (p) => String(p ?? '').replace(/\//g, '\\').toLowerCase()
const REPO_NORM = REPO_ROOT ? norm(REPO_ROOT) : null
const AUDIO_NORM = REPO_ROOT ? norm(path.join(REPO_ROOT, 'audio')) + '\\' : null

/** 该路径是否落在仓库内（且不是 audio/）。 */
function isProtectedPath(p) {
  if (!REPO_NORM || !p) return false
  let abs = String(p)
  try { abs = path.resolve(abs) } catch { return false }
  const n = norm(abs)
  if (!n.startsWith(REPO_NORM + '\\') && n !== REPO_NORM) return false
  if (AUDIO_NORM && n.startsWith(AUDIO_NORM)) return false
  return true
}

/** 写类工具里，从参数中挑出「目标路径」。 */
function targetPaths(toolName, args) {
  const a = args ?? {}
  const out = []
  const push = (v) => { if (typeof v === 'string' && v) out.push(v) }
  switch (toolName) {
    case 'write':
    case 'edit':
    case 'read':
      push(a.file_path)
      break
    case 'str_replace_editor':
      push(a.path)
      break
    default:
      // 其它工具：常见字段一并检查，宁可多拦一次
      for (const k of ['file_path', 'path', 'file', 'target', 'to', 'from']) push(a[k])
  }
  return out
}

/** pwsh 命令里是否「对仓库路径做了写/删操作」。保守启发式：命中即拒绝。 */
const MUTATING = /\b(del|erase|rd|rmdir|rm|mv|cp|copy|move|ren|rename|remove-item|move-item|copy-item|rename-item|set-content|add-content|out-file|new-item|clear-content|tee-object|invoke-expression|iex|npm\s+install|pnpm|git\s+(reset|checkout|clean|apply|stash))\b/i

// 只写 audio/ 的固定入口：唱歌渲染脚本（产出 audio/*.wav），放行。
const AUDIO_ONLY_TOOLS = /(?:^|[\\\s"'/])sing-now\.ps1/i

function pwshTouchesRepo(command) {
  if (!REPO_NORM) return false
  const raw = String(command ?? '')
  if (!raw) return false
  // 只写 audio/ 的白名单脚本直接放行（它不碰源码）
  if (AUDIO_ONLY_TOOLS.test(raw)) return false
  // 去掉 `2>&1` / `2>$null` 这类"重定向到流"的语法：它们不是写文件，
  // 但会被下面的 `>` 规则误判（曾是 sing-now.ps1 被拦的真实原因）。
  const cmd = raw
    .replace(/\d?>\s*&\s*\d/g, ' ')
    .replace(/\d?>\s*\$null/g, ' ')
    .replace(/2>&1/g, ' ')
  const variants = [REPO_NORM, REPO_NORM.replace(/\\/g, '/')]
  const mentionsRepo = variants.some((v) => cmd.toLowerCase().includes(v))
  if (!mentionsRepo) return false
  // 重定向到仓库内（audio/ 除外）才算写
  const redirectTargets = [...cmd.matchAll(/\d?>{1,2}\s*"?([^"\s|;)]+)/g)].map((m) => m[1])
  if (redirectTargets.some((t) => isProtectedPath(t))) return true
  return MUTATING.test(cmd)
}

export function apply(ctx) {
  if (!REPO_ROOT) {
    console.error('[qq-owner-guard] ⚠️ 未能定位 qq-bridge 仓库根，写保护未生效（仅提示，不阻断会话）')
  }
  ctx.tools.guard((exec) => {
    const toolName = exec?.name
    const args = exec?.arguments

    if (toolName === 'pwsh' || toolName === 'bash') {
      if (pwshTouchesRepo(args?.command)) {
        return `命令看起来会修改 qq-bridge 仓库（${REPO_ROOT}），已拒绝。只读排查请改用 read / grep；确需改动请让人类自己动手。`
      }
      return
    }

    if (toolName === 'write' || toolName === 'edit' || toolName === 'str_replace_editor'
      || toolName === 'move' || toolName === 'delete' || toolName === 'apply_patch') {
      for (const p of targetPaths(toolName, args)) {
        if (isProtectedPath(p)) {
          return `禁止修改 qq-bridge 仓库内的文件（${p}）。这里放的是桥接自身源码/脚本/配置，改坏了整个 QQ 链路会断。需要改动请让人类来做。`
        }
      }
    }
    return
  })
}
