"use client";

import { useEffect, useRef, useState } from "react";
import { PageBody } from "@/components/shell";
import {
  CRITERIA_LIMIT,
  CRITERION_MAX,
  GOAL_LIMIT,
  GOAL_MAX,
  NEXT_STEP_MAX,
  WORK_FILTERS,
  WORKSPACE_MAX,
  filterGoals,
  matchesWorkFilter,
  parseWorkInput,
  workEmptyMessage,
  workStatusLabel,
  type WorkFilterId,
  type WorkGoal,
} from "@/lib/work-profile";

export function WorkBoard() {
  const [goals, setGoals] = useState<WorkGoal[] | null>(null);
  const [filter, setFilter] = useState<WorkFilterId>("all");
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState("");
  const [criteria, setCriteria] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [maxRuns, setMaxRuns] = useState("10");
  const submitting = useRef(false);
  const pendingScroll = useRef<string | null>(null);

  async function load() {
    setLoadError("");
    try {
      const response = await fetch("/api/work", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取工作失败");
      setGoals(Array.isArray(result.goals) ? result.goals : []);
    } catch (failure) {
      setLoadError(
        failure instanceof Error ? failure.message : "无法连接服务端",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const id = pendingScroll.current;
    if (!id || !goals) return;
    const node = document.getElementById(`goal-${id}`);
    if (!node) return;
    pendingScroll.current = null;
    node.scrollIntoView({ block: "nearest" });
  }, [goals, filter]);

  const visible = goals ? filterGoals(goals, filter) : [];
  const full = (goals?.length ?? 0) >= GOAL_LIMIT;

  return (
    <PageBody kicker="MY WORK" title="我的工作">
      <p className="text-sm leading-6 text-muted">
        持续推进的目标。新建后记为计划并保存在这台机器上，还不会自动开始执行。
      </p>
      <form
        className="creation-form mb-6 mt-4 min-w-0 space-y-4"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting.current) return;
          setNotice("");
          const parsed = parseWorkInput({
            goal,
            criteria,
            workspace,
            nextStep,
            maxRuns: maxRuns.trim() === "" ? "" : Number(maxRuns),
          });
          if (!parsed.ok) {
            setFormError(parsed.error);
            return;
          }
          submitting.current = true;
          setBusy(true);
          setFormError("");
          try {
            const response = await fetch("/api/work", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(parsed.value),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "创建失败");
            setGoal("");
            setCriteria("");
            setWorkspace("");
            setNextStep("");
            setMaxRuns("10");
            setNotice(`已记下「${result.goal}」。`);
            if (!matchesWorkFilter(result.status, filter)) setFilter("all");
            pendingScroll.current = result.id;
            await load();
          } catch (failure) {
            setFormError(
              failure instanceof Error ? failure.message : "创建失败，请重试",
            );
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <div>
          <h2 className="font-medium">新建目标</h2>
          <p className="text-xs leading-5 text-muted">
            写下目标后会出现在「全部」和「计划与例行」里。
          </p>
        </div>
        <label className="block text-sm">
          目标
          <input
            className="field mt-2"
            value={goal}
            maxLength={GOAL_MAX}
            autoComplete="off"
            placeholder="例如：整理本周会议纪要"
            onChange={(event) => setGoal(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          完成条件
          <span className="ml-2 text-xs text-muted">每行一条，空行会忽略</span>
          <textarea
            className="mt-2 min-h-24 w-full rounded-xl border border-line bg-panel px-3 py-2 outline-none"
            value={criteria}
            maxLength={CRITERIA_LIMIT * (CRITERION_MAX + 1)}
            placeholder={"纪要已写好\n已发给相关的人"}
            onChange={(event) => setCriteria(event.target.value)}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block min-w-0 text-sm">
            工作区
            <input
              className="field mt-2"
              value={workspace}
              maxLength={WORKSPACE_MAX}
              autoComplete="off"
              placeholder="例如：个人"
              onChange={(event) => setWorkspace(event.target.value)}
            />
          </label>
          <label className="block min-w-0 text-sm">
            最多执行次数
            <span className="ml-2 text-xs text-muted">1–10000，默认 10</span>
            <input
              className="field mt-2"
              value={maxRuns}
              inputMode="numeric"
              autoComplete="off"
              placeholder="10"
              onChange={(event) => setMaxRuns(event.target.value)}
            />
          </label>
        </div>
        <label className="block text-sm">
          下一步
          <input
            className="field mt-2"
            value={nextStep}
            maxLength={NEXT_STEP_MAX}
            autoComplete="off"
            placeholder="例如：先列出要整理的会议"
            onChange={(event) => setNextStep(event.target.value)}
          />
        </label>
        {full ? (
          <p className="text-sm text-muted">
            已有 {GOAL_LIMIT} 个目标，暂时不能再新建。
          </p>
        ) : null}
        <button
          className="primary-button w-full sm:w-auto"
          type="submit"
          disabled={busy || full}
        >
          {busy ? "正在创建…" : "创建"}
        </button>
      </form>
      {notice ? (
        <p className="mb-3 text-sm text-accent" role="status">
          {notice}
        </p>
      ) : null}
      {formError ? (
        <p className="mb-3 break-words text-sm text-red-600" role="alert">
          {formError}
        </p>
      ) : null}
      {loadError ? (
        <p className="mb-3 text-sm text-red-600" role="alert">
          {loadError}{" "}
          <button
            className="underline"
            type="button"
            onClick={() => void load()}
          >
            重试
          </button>
        </p>
      ) : null}
      <div
        className="mt-4 flex min-w-0 flex-wrap gap-2 text-sm"
        role="tablist"
        aria-label="工作筛选"
      >
        {WORK_FILTERS.map((item) => {
          const selected = filter === item.id;
          return (
            <button
              key={item.id}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 ${selected ? "bg-accent" : "border border-line bg-panel"}`}
              style={{ color: selected ? "#fff" : "var(--muted)" }}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {!goals && !loadError ? (
        <p className="mt-4 text-sm text-muted">正在读取工作…</p>
      ) : null}
      {goals && visible.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm leading-6 text-muted">
          {workEmptyMessage(filter)}
        </div>
      ) : null}
      {goals && visible.length > 0 ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted">{visible.length} 项</p>
          {visible.map((item) => (
            <article
              key={item.id}
              id={`goal-${item.id}`}
              className="card min-w-0 p-4"
            >
              <div className="flex items-start gap-2">
                <h2 className="min-w-0 flex-1 break-words font-medium">
                  {item.goal}
                </h2>
                <span className="shrink-0 rounded-full bg-soft px-2 py-0.5 text-xs text-muted">
                  {workStatusLabel(item.status)}
                </span>
              </div>
              <p className="mt-2 break-words text-xs text-muted">
                工作区：{item.workspace}
              </p>
              <p className="mt-1 break-words text-sm">
                下一步：{item.nextStep}
              </p>
              <p className="mt-1 text-xs text-muted">
                最多执行 {item.maxRuns} 次
              </p>
              <div className="mt-3 text-xs text-muted">完成条件</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {item.criteria.map((criterion, index) => (
                  <li key={`${item.id}-${index}`} className="break-words">
                    {criterion}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : null}
    </PageBody>
  );
}
