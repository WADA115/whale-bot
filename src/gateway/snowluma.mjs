// SnowLuma 适配器：包住官方 SDK，保持和 OneBot 适配器同一套接口。
//
// 它比标准 OneBot 多一个能力：fetchFaceEntity（取 QQ 小黄脸的实体信息）。
// 桥接里对它是"有就用、没有就降级"，所以换网关不会坏。
import { SnowLumaWebSocketClient, text } from '@snowluma/sdk';

export class SnowLumaGateway {
  constructor({ url, accessToken, reconnect = true }) {
    this.sdk = new SnowLumaWebSocketClient({ url, accessToken, reconnect });
    this.kind = 'snowluma';
  }

  connect() { return this.sdk.connect(); }
  close() { return this.sdk.close(); }

  onEvent(cb) { return this.sdk.onEvent(cb); }
  onGroupMessage(cb) { return this.sdk.onGroupMessage(cb); }
  onPrivateMessage(cb) { return this.sdk.onPrivateMessage(cb); }
  onNotice(type, cb) { return this.sdk.onNotice(type, cb); }
  onBotStatus(cb) { return this.sdk.onBotStatus?.(cb); }

  /** 通用事件订阅：桥接里有直接用 bot.on(...) 的地方，SDK 支持就透传。 */
  on(event, cb) { return this.sdk.on(event, cb); }

  sendGroupMessage(groupId, message) { return this.sdk.sendGroupMessage(groupId, message); }
  sendPrivateMessage(userId, message) { return this.sdk.sendPrivateMessage(userId, message); }

  getLoginInfo() { return this.sdk.getLoginInfo(); }
  getGroupMemberInfo(groupId, userId) { return this.sdk.getGroupMemberInfo(groupId, userId); }
  getGroupMemberList(groupId) { return this.sdk.getGroupMemberList(groupId); }
  getImage(params) { return this.sdk.getImage(params); }
  getMessage(messageId) { return this.sdk.getMessage(messageId); }

  /** 通用动作：SDK 的 request 与 raw 是同一个东西，这里都给。 */
  request(action, params) { return this.sdk.request(action, params); }
  raw(action, params) { return this.sdk.raw(action, params); }

  /** SnowLuma 专有：取表情实体。标准 OneBot 没有，见 onebot.mjs。 */
  fetchFaceEntity(faceId) { return this.sdk.fetchFaceEntity(faceId); }
}

export { text };
