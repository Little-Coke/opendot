"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DotMark } from "@/components/dot-mark";
import { DotFace, PageBody } from "@/components/shell";
import {
  DOT_COLORS,
  DOT_LIMIT,
  DOT_NAME_MAX,
  DOT_ROLE_MAX,
  DOT_SHAPES,
  SHAPE_LABELS,
  type CustomDot,
  type DotColor,
  type DotShape,
  parseDotInput,
  roleLabel,
} from "@/lib/dot-profile";

type TeamPayload = {
  defaultModel: string;
  recent: string;
  dots: CustomDot[];
};

export function TeamBoard() {
  const [team, setTeam] = useState<TeamPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [shape, setShape] = useState<DotShape>("rounded");
  const [color, setColor] = useState<DotColor>(DOT_COLORS[1].value);
  const [role, setRole] = useState("");

  async function load() {
    setLoadError("");
    try {
      const response = await fetch("/api/dots", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取团队失败");
      setTeam(result);
    } catch (failure) {
      setLoadError(failure instanceof Error ? failure.message : "无法连接服务端");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const full = (team?.dots.length ?? 0) >= DOT_LIMIT;

  return (
    <PageBody kicker="MY TEAM" title="我的 Dot">
      <p className="mb-4 text-sm leading-6 text-muted">
        小点仍是主 Dot，对话方式不变。自定义 Dot 会记下形状、颜色、名字和角色，保存在这台机器的数据卷里。
      </p>
      <form
        className="card mb-6 space-y-4 p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setNotice("");
          const parsed = parseDotInput({ name, shape, color, role });
          if (!parsed.ok) {
            setFormError(parsed.error);
            return;
          }
          setBusy(true);
          setFormError("");
          try {
            const response = await fetch("/api/dots", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(parsed.value),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "创建失败");
            setName("");
            setRole("");
            setNotice(`已创建「${result.name}」。`);
            await load();
          } catch (failure) {
            setFormError(failure instanceof Error ? failure.message : "创建失败，请重试");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex items-center gap-3">
          <DotMark shape={shape} color={color} size={40} />
          <div>
            <h2 className="font-medium">新建 Dot</h2>
            <p className="text-xs text-muted">先选外形，再写名字。角色说明可以留空。</p>
          </div>
        </div>
        <label className="block text-sm">
          名字
          <input
            className="field mt-2"
            value={name}
            maxLength={DOT_NAME_MAX}
            autoComplete="off"
            placeholder="例如：资料员"
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <fieldset>
          <legend className="text-sm">形状</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {DOT_SHAPES.map((item) => (
              <label
                key={item}
                className={`flex items-center gap-2 rounded-full border px-2 py-1 text-sm ${shape === item ? "border-accent bg-accent-soft" : "border-line bg-panel"}`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="dot-shape"
                  value={item}
                  checked={shape === item}
                  onChange={() => setShape(item)}
                />
                <DotMark shape={item} color={color} />
                {SHAPE_LABELS[item]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm">颜色</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {DOT_COLORS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-label={item.label}
                aria-pressed={color === item.value}
                className={`grid h-9 w-9 place-items-center rounded-full border ${color === item.value ? "border-ink" : "border-transparent"}`}
                onClick={() => setColor(item.value)}
              >
                <span className="h-6 w-6 rounded-full" style={{ backgroundColor: item.value }} />
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm">
          角色说明
          <span className="ml-2 text-xs text-muted">可选</span>
          <textarea
            className="mt-2 w-full min-h-20 rounded-xl border border-line bg-panel px-3 py-2 outline-none"
            value={role}
            maxLength={DOT_ROLE_MAX}
            placeholder="这个 Dot 负责什么"
            onChange={(event) => setRole(event.target.value)}
          />
        </label>
        {full ? <p className="text-sm text-muted">已有 {DOT_LIMIT} 个自定义 Dot，先删除一个再创建。</p> : null}
        <button
          className="rounded-full bg-ink px-4 py-2 text-sm text-panel disabled:opacity-60"
          type="submit"
          disabled={busy || full}
        >
          {busy ? "正在创建…" : "创建"}
        </button>
      </form>
      {notice ? <p className="mb-3 text-sm text-accent" role="status">{notice}</p> : null}
      {formError ? <p className="mb-3 text-sm text-red-600" role="alert">{formError}</p> : null}
      {loadError ? (
        <p className="mb-3 text-sm text-red-600" role="alert">
          {loadError}{" "}
          <button className="underline" type="button" onClick={() => void load()}>重试</button>
        </p>
      ) : null}
      {!team && !loadError ? <p className="mb-3 text-sm text-muted">正在读取团队…</p> : null}
      <article className="flex items-center gap-3 border-b border-line py-4">
        <DotFace />
        <div className="min-w-0 flex-1">
          <div className="font-medium">小点</div>
          <div className="text-xs text-muted">你的个人协调员 · 默认模型</div>
          <div className="text-xs text-muted">技能未配置 · 外部连接未配置</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">暂无团队任务</div>
          <Link className="mt-1 inline-block text-sm text-accent" href="/c/xiaodian">开始对话</Link>
        </div>
      </article>
      {team?.dots.map((dot) => (
        <article key={dot.id} className="flex gap-3 border-b border-line py-4">
          <span className="mt-0.5 shrink-0">
            <DotMark shape={dot.shape} color={dot.color} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{dot.name}</div>
            <div className="text-xs text-muted">角色：{roleLabel(dot.role)}</div>
            <div className="text-xs text-muted">{team.defaultModel}</div>
            <div className="text-xs text-muted">最近对话：{team.recent}</div>
            <Link className="mt-1 inline-block text-sm text-accent" href={`/team/${dot.id}`}>
              开始对话
            </Link>
          </div>
        </article>
      ))}
      {team && team.dots.length === 0 ? (
        <p className="py-4 text-sm text-muted">还没有自定义 Dot。</p>
      ) : null}
    </PageBody>
  );
}
