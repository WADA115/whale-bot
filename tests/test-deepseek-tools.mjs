import { normalizeSearchResults } from '../src/web/deepseek-tools.js';
import { buildQueries, isRelevant, canonicalUrl } from '../src/knowledge/crawl/deepseek.js';

let pass = 0;
const ok = (name, cond) => { if (cond) { pass += 1; console.log('  ✅ ' + name); } else { console.log('  ❌ ' + name); process.exitCode = 1; } };

const rows = normalizeSearchResults({
  results: [
    { title: 'A', url: 'https://a', snippet: 's', summary: 'm', content: 'c', rerank_score: 2.2, authority: 3 },
    { title: 'B', url: '', content: 'x' }
  ]
}, 5);
ok('过滤空 URL', rows.length === 1);
ok('字段映射', rows[0].title === 'A' && rows[0].score === 2.2 && rows[0].authority === 3 && rows[0].content === 'c');

const empty = normalizeSearchResults({ results: [] }, 5);
ok('空结果', Array.isArray(empty) && empty.length === 0);

ok('明确查询', buildQueries('小鲸鱼').some((q) => q.includes('QQ机器人')));
ok('项目相关性', isRelevant('小鲸鱼', { title: 'DeepSeek 小鲸鱼 QQ 机器人', content: '项目说明' }));
ok('过滤无关 VTuber', !isRelevant('小鲸鱼', { title: '小鲸鱼 VTuber 直播', content: '今天唱歌' }));
ok('URL 规范化', canonicalUrl('https://a.com/x/#1') === 'https://a.com/x');

console.log(`\n${pass} 项 DeepSeek 工具测试通过`);
