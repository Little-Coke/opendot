export function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("请填写不含凭据、查询参数的 HTTP(S) API 地址");
  }
  return url.toString().replace(/\/+$/, "");
}

type Usage = { prompt_tokens?: number; completion_tokens?: number };
export async function readCompletionStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let model = "";
  let usage: Usage = {};
  let finished = false;
  let doneMarker = false;
  function frame(line: string) {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") {
      doneMarker = true;
      return;
    }
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error("模型返回的流式数据格式异常");
    }
    if (event.error) throw new Error("模型服务返回错误");
    if (typeof event.model === "string") model = event.model;
    if (event.usage) {
      usage = {
        prompt_tokens:
          Number.isSafeInteger(event.usage.prompt_tokens) &&
          event.usage.prompt_tokens >= 0
            ? event.usage.prompt_tokens
            : undefined,
        completion_tokens:
          Number.isSafeInteger(event.usage.completion_tokens) &&
          event.usage.completion_tokens >= 0
            ? event.usage.completion_tokens
            : undefined,
      };
    }
    const choice = event.choices?.[0];
    if (choice?.finish_reason) finished = true;
    const delta = choice?.delta?.content;
    if (typeof delta === "string") {
      text += delta;
      if (text.length > 128000)
        throw new Error("回复过长，请缩小问题范围后重试");
      onText(delta);
    }
  }
  try {
    while (!doneMarker) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 256000) throw new Error("模型返回的数据过大");
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        frame(line);
      }
      if (chunk.done) {
        if (buffer.trim()) frame(buffer);
        break;
      }
    }
    if (!text.trim()) throw new Error("模型未返回文字，请检查模型配置后重试");
    if (!finished && !doneMarker) throw new Error("模型连接提前中断，请重试");
    return { text, model, usage };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
