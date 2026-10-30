// 网关抽象层：把"QQ 协议怎么实现的"从桥接里拆出去。
//
// 背景：SnowLuma 的 SDK 有自己的扩展协议（比如 fetchFaceEntity），而标准 OneBot v11
// 网关（NapCat / LLOneBot / Lagrange）没有。桥接只该依赖下面这组方法，
// 具体怎么实现由 src/gateway/ 下的适配器决定。
//
// 统一接口（桥接只用这些）：
//   connect() close()
//   onEvent(cb) onGroupMessage(cb) onPrivateMessage(cb) onNotice(type, cb) onBotStatus(cb)
//   sendGroupMessage(id, message) sendPrivateMessage(id, message)
//   getLoginInfo() getGroupMemberInfo(groupId, userId) getGroupMemberList(groupId)
//   getImage({ file }) getMessage(id)
//   request(action, params)   ← 通用动作（raw 是它的别名）
//   fetchFaceEntity(faceId)   ← 可选能力，不支持的网关抛错，调用方自行降级
import { SnowLumaGateway } from './snowluma.mjs';
import { OneBotGateway } from './onebot.mjs';

/** 消息段构造：text('abc') → { type: 'text', data: { text: 'abc' } } */
export function text(content) {
  return { type: 'text', data: { text: String(content ?? '') } };
}

/**
 * 按配置创建网关。
 * config.gateway = { type: 'snowluma' | 'onebot', httpUrl, wsUrl, accessToken, reconnect }
 * 没写 gateway 时按 snowluma 处理（兼容老配置）。
 */
export function createGateway(cfg, log = console.log) {
  const gw = cfg.gateway ?? {};
  const type = String(gw.type ?? 'snowluma').toLowerCase();
  const accessToken = gw.accessToken || cfg.snowluma?.accessToken || undefined;

  if (type === 'onebot') {
    const httpUrl = gw.httpUrl || cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000';
    const wsUrl = gw.wsUrl || cfg.snowluma?.wsUrl || 'ws://127.0.0.1:3001';
    log(`[gateway] 使用标准 OneBot v11：http=${httpUrl} ws=${wsUrl}`);
    return new OneBotGateway({ httpUrl, wsUrl, accessToken, wsAccessToken: gw.wsAccessToken || cfg.snowluma?.wsAccessToken || undefined });
  }

  if (type !== 'snowluma') {
    log(`[gateway] 未知网关类型 "${type}"，回退到 snowluma`);
  }
  // SnowLuma 的 WS 服务器和 HTTP 服务器令牌是分开的：WS 用 wsAccessToken，没配就退回 accessToken
  const wsToken = gw.wsAccessToken || cfg.snowluma?.wsAccessToken || accessToken;
  log(`[gateway] 使用 SnowLuma 扩展协议：${cfg.snowluma?.wsUrl ?? ''}`);
  return new SnowLumaGateway({
    url: cfg.snowluma?.wsUrl,
    accessToken: wsToken,
    reconnect: true
  });
}

export { SnowLumaGateway, OneBotGateway };
