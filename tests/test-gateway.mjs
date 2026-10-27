// 网关层单测：OneBot 适配器的动作调用与事件分类（不依赖真实 QQ）。
import assert from 'node:assert/strict';
import http from 'node:http';

import { OneBotGateway } from '../src/gateway/onebot.mjs';

// ── 假 OneBot HTTP 服务：记录收到的动作，回固定数据 ────────────────────
const calls = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const action = String(req.url ?? '/').replace(/^\//, '');
    let params = {};
    try { params = JSON.parse(body || '{}'); } catch {}
    calls.push({ action, params, auth: req.headers.authorization ?? '' });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (action === 'get_login_info') return res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 123, nickname: '测试' } }));
    if (action === 'send_group_msg') return res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 9001 } }));
    if (action === 'fail_action') return res.end(JSON.stringify({ status: 'failed', retcode: 1404, wording: '没权限' }));
    return res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { echo: action } }));
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const gw = new OneBotGateway({ httpUrl: `http://127.0.0.1:${port}`, wsUrl: 'ws://127.0.0.1:1', accessToken: 'tok' });

// 1. 动作调用
const login = await gw.getLoginInfo();
assert.equal(login.nickname, '测试');
assert.equal(calls.at(-1).action, 'get_login_info');
assert.equal(calls.at(-1).auth, 'Bearer tok', '应带 Bearer token');
console.log('OK getLoginInfo →', login.nickname);

// 2. 发消息：参数结构要符合 OneBot v11
const sent = await gw.sendGroupMessage(978815624, [{ type: 'text', data: { text: 'hi' } }]);
assert.equal(sent.message_id, 9001);
const sendCall = calls.find((c) => c.action === 'send_group_msg');
assert.equal(sendCall.params.group_id, 978815624);
assert.deepEqual(sendCall.params.message[0], { type: 'text', data: { text: 'hi' } });
console.log('OK sendGroupMessage → message_id', sent.message_id);

// 3. 失败响应要抛错
await assert.rejects(() => gw.request('fail_action'), /没权限/);
console.log('OK 失败响应会抛错');

// 4. 事件分类
const seen = [];
gw.onEvent(() => seen.push('event'));
gw.onGroupMessage((e) => seen.push('group:' + e.group_id));
gw.onPrivateMessage((e) => seen.push('private:' + e.user_id));
gw.onNotice('notify', (e) => seen.push('notice:' + e.notice_type));
gw.onBotStatus((s) => seen.push('status:' + (s.connected ? 'on' : 'off')));

gw._onFrame(JSON.stringify({ post_type: 'message', message_type: 'group', group_id: 1, user_id: 2 }));
gw._onFrame(JSON.stringify({ post_type: 'message', message_type: 'private', user_id: 3 }));
gw._onFrame(JSON.stringify({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke' }));
gw._onFrame(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'heartbeat', status: { good: true, online: true } }));

assert.ok(seen.includes('group:1'), '群消息应分发');
assert.ok(seen.includes('private:3'), '私聊应分发');
assert.ok(seen.includes('notice:notify'), '通知应按类型分发');
assert.ok(seen.includes('status:on'), '心跳应转成状态');
assert.equal(seen.filter((s) => s === 'event').length, 4, 'onEvent 应收到全部 4 个包');
console.log('OK 事件分发 →', seen.join(' / '));

// 5. SnowLuma 专有能力要明确拒绝（让调用方降级）
await assert.rejects(() => gw.fetchFaceEntity(14), (e) => e.code === 'UNSUPPORTED');
console.log('OK fetchFaceEntity → UNSUPPORTED（调用方会降级）');

// 6. 关掉
await gw.close();
server.close();
console.log('\n全部通过');
