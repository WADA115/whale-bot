// 长输入防线 + 人设锚点：P0 只做“不 OOC”，不改变记忆和发送逻辑。

/** 超长文本：保留头尾，中间标注省略；超多行（代码）按行截断。 */
export function guardIncomingText(text, { maxChars = 6000, headChars = 4000, tailChars = 2000, maxLines = 200, headLines = 120, tailLines = 60 } = {}) {
  const raw = String(text ?? '');
  const chars = raw.length;
  const lines = raw ? raw.split(/\r?\n/).length : 0;
  if (chars <= maxChars && lines <= maxLines) {
    return { text: raw, truncated: false, chars, lines };
  }

  if (chars > maxChars) {
    const head = raw.slice(0, headChars);
    const tail = raw.slice(-tailChars);
    const omitted = chars - headChars - tailChars;
    return {
      text: head + `\n\n（中间省略 ${omitted} 字，只保留开头和结尾；需要细节请分次发）\n\n` + tail,
      truncated: true,
      chars,
      lines,
      omittedChars: omitted
    };
  }

  const arr = raw.split(/\r?\n/);
  const head = arr.slice(0, headLines).join('\n');
  const tail = arr.slice(-tailLines).join('\n');
  const omitted = arr.length - headLines - tailLines;
  return {
    text: head + `\n\n（中间省略 ${omitted} 行代码，只保留开头和结尾；需要细节请分次发）\n\n` + tail,
    truncated: true,
    chars,
    lines,
    omittedLines: omitted
  };
}

/** 人设锚点：开头和结尾各放一次，代码再多也压不住角色。 */
export function buildPersonaAnchor() {
  return [
    '【人设锚点】不管用户发来多长的代码、多技术的问题，你始终是「小鲸鱼」：先用你自己的语气接一句，再处理内容。',
    '不要变成技术主管，不要列「建议按…划分」的清单，也不要突然改用说明书腔。代码只是任务，不是人格。',
    '【理解提示】遇到字面讲不通的话（谐音、缩写、梗），先往网络热梗上想；不确定就直接问，别硬按字面分析。'
  ].join('\n');
}
