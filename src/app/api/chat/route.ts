import {
  errorResponse,
  readJson,
  requireAccess,
  requireSameOrigin,
} from "@/lib/auth";
import { ChatError, getStore } from "@/lib/chat-store";
import { publicModelSettings, readModelConfig } from "@/lib/settings";
import { readCompletionStream } from "@/lib/provider";
import type { ChatEvent } from "@/lib/chat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    requireAccess(request);
    return Response.json(
      { turns: getStore().history(), settings: publicModelSettings() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireAccess(request);
    requireSameOrigin(request);
    const input = await readJson(request);
    if (
      !input ||
      typeof input.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id) ||
      typeof input.content !== "string" ||
      !input.content.trim() ||
      input.content.length > 8000
    ) {
      throw new ChatError("消息不能为空，且不能超过 8000 字");
    }
    const store = getStore();
    const config = readModelConfig();
    const turn = store.begin(
      input.id,
      input.content.trim(),
      input.retry === true,
    );
    const context = store.context();
    let connected = true;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const emit = (event: ChatEvent) => {
          if (!connected) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            connected = false;
          }
        };
        emit({ type: "snapshot", turns: store.history() });
        if (!turn.started) {
          controller.close();
          return;
        }
        let reply = "";
        let lastSaved = 0;
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 90_000);
        const heartbeat = setInterval(
          () => store.partial(turn.id, turn.attempt, reply),
          10_000,
        );
        try {
          if (!config.apiKey) {
            reply = `这是演示模式。我收到了你的消息：“${turn.content}”。在设置中配置模型后，小点就能开始真实对话。`;
            emit({ type: "delta", id: turn.id, text: reply });
            store.complete(turn.id, turn.attempt, reply, "演示模式", {});
          } else {
            const response = await fetch(`${config.baseUrl}/chat/completions`, {
              method: "POST",
              signal: abort.signal,
              redirect: "error",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.apiKey}`,
              },
              body: JSON.stringify({
                model: config.model,
                stream: true,
                stream_options: { include_usage: true },
                max_tokens: 4096,
                messages: [
                  {
                    role: "system",
                    content:
                      "你是小点，用户的个人 AI 助手。默认用简体中文清晰回答，根据对话历史保持上下文。目前只能进行文字对话，没有文件、浏览器或外部操作工具。不要声称已执行工具操作。",
                  },
                  ...context,
                  { role: "user", content: turn.content },
                ],
              }),
            });
            if (!response.ok || !response.body) {
              await response.body?.cancel();
              const message =
                response.status === 401 || response.status === 403
                  ? "模型认证失败，请检查 API Key"
                  : response.status === 402
                    ? "模型账户余额不足，请检查服务商账户"
                    : response.status === 429
                      ? "模型请求过于频繁，请稍后重试"
                      : `模型服务暂时不可用（HTTP ${response.status}），请检查地址与模型名`;
              throw new ChatError(message);
            }
            const result = await readCompletionStream(
              response.body,
              (delta) => {
                reply += delta;
                if (Date.now() - lastSaved > 250) {
                  store.partial(turn.id, turn.attempt, reply);
                  lastSaved = Date.now();
                }
                emit({ type: "delta", id: turn.id, text: delta });
              },
            );
            store.complete(
              turn.id,
              turn.attempt,
              result.text,
              result.model || config.model,
              result.usage,
            );
          }
          emit({ type: "done", turns: store.history() });
        } catch (error) {
          // Never return upstream response bodies or exception messages containing credentials.
          const message = abort.signal.aborted
            ? "模型回复超时，请重试"
            : error instanceof ChatError
              ? error.message
              : "模型回复中断或格式异常，请重试并检查配置";
          store.partial(turn.id, turn.attempt, reply);
          store.fail(turn.id, turn.attempt, message);
          emit({ type: "error", error: message, turns: store.history() });
        } finally {
          clearTimeout(timeout);
          clearInterval(heartbeat);
          if (connected) controller.close();
        }
      },
      // Generation continues and persists when navigation disconnects the browser.
      cancel() {
        connected = false;
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
