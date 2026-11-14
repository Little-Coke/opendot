"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageBody } from "@/components/shell";
import {
  EVIDENCE_MAX,
  currentRun,
  evidenceKindLabel,
  executionBudgetLabel,
  runLimitLabel,
  runStatusLabel,
  workStatusLabel,
  type EvidenceKind,
  type WorkAction,
  type WorkDetail,
} from "@/lib/work-profile";

export function WorkDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const submitting = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setNotice("");
    setError("");
    async function load() {
      try {
        const response = await fetch(`/api/work/${id}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "读取委托失败");
        if (!cancelled) setDetail(result);
      } catch (failure) {
        if (!cancelled) {
          setError(failure instanceof Error ? failure.message : "无法连接服务端");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  async function act(action: WorkAction, success: string) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/work/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "操作失败");
      setDetail(result);
      if (action.action === "evidence") setNote("");
      setNotice(success);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作失败，请重试");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function addEvidence(kind: EvidenceKind) {
    const text = note.trim();
    if (!text) {
      setNotice("");
      setError("请填写证据");
      return;
    }
    await act(
      { action: "evidence", kind, note: text },
      kind === "device" ? "已记下设备证据。" : "已记下证据。",
    );
  }

  const goal = detail?.goal;
  const active = detail ? currentRun(detail.runs) : undefined;
  const done = goal?.status === "done";
  const deviceEvidence = detail?.evidence.some((item) => item.kind === "device") ?? false;
  const hasEvidence = (detail?.evidence.length ?? 0) > 0;

  return (
    <PageBody kicker="MY WORK" title="委托详情">
      <Link className="mb-4 inline-block text-sm text-muted" href="/work">
        ← 我的工作
      </Link>
      {!detail && !error ? <p className="text-sm text-muted">正在读取委托…</p> : null}
      {error ? (
        <p className="mb-3 break-words text-sm text-red-600" role="alert">
          {error}{" "}
          {!detail ? (
            <button className="underline" type="button" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </button>
          ) : null}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-3 text-sm text-accent" role="status">
          {notice}
        </p>
      ) : null}
      {goal && detail ? (
        <div className="min-w-0 space-y-4">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 break-words text-xl font-medium">{goal.goal}</h2>
            <span className="shrink-0 rounded-full bg-soft px-2 py-0.5 text-xs text-muted">
              {workStatusLabel(goal.status)}
            </span>
          </div>
          <p className="break-words text-sm text-muted">工作区：{goal.workspace}</p>

          <section className="card min-w-0 p-4">
            <h3 className="font-medium">执行预算</h3>
            <p className="mt-2 text-sm">{executionBudgetLabel(goal)}</p>
            <p className="mt-1 text-sm">{runLimitLabel(active)}</p>
            <p className="mt-2 text-xs leading-5 text-muted">
              单次运行最多 12 步，默认最长 30 分钟。这些先记在这次执行上，还不会调用模型。
            </p>
            {goal.requiresDevice ? (
              <p className="mt-2 text-sm">这个委托需要设备。标记完成时还要有设备证据。</p>
            ) : (
              <p className="mt-2 text-sm text-muted">没有证据不能标记完成。</p>
            )}
          </section>

          <section className="card min-w-0 p-4">
            <h3 className="font-medium">下一步</h3>
            <p className="mt-2 break-words text-sm">{goal.nextStep}</p>
          </section>

          <section className="card min-w-0 p-4">
            <h3 className="font-medium">完成条件</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {goal.criteria.map((criterion, index) => (
                <li key={`${goal.id}-${index}`} className="break-words">
                  {criterion}
                </li>
              ))}
            </ul>
          </section>

          <section className="card min-w-0 p-4">
            <h3 className="font-medium">这次执行</h3>
            {active ? (
              <div className="mt-2 text-sm">
                <p>
                  {runStatusLabel(active.status)}
                  <span className="ml-2 break-all font-mono text-xs text-muted">{active.id}</span>
                </p>
                <p className="mt-1 text-muted">{runLimitLabel(active)}</p>
                {active.status === "paused" ? (
                  <p className="mt-1 text-xs text-muted">继续会沿用这一次执行，不会新建。</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">
                {detail.runs.length === 0 ? "还没有开始。" : "当前没有进行中的执行。"}
              </p>
            )}
            {detail.runs.length > 0 ? (
              <ul className="mt-3 space-y-2 text-xs text-muted">
                {detail.runs.map((run) => (
                  <li key={run.id} className="break-all">
                    <span className="font-mono">{run.id}</span>
                    {` · ${runStatusLabel(run.status)} · ${runLimitLabel(run)}`}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {!done && !active && goal.runsUsed < goal.maxRuns ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ action: "start" }, "已开始执行。")}
                >
                  开始执行
                </button>
              ) : null}
              {active?.status === "running" ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ action: "pause" }, "已暂停。继续时仍是这一次执行。")}
                >
                  暂停
                </button>
              ) : null}
              {active?.status === "paused" ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ action: "resume" }, "已继续同一次执行。")}
                >
                  继续
                </button>
              ) : null}
              {active ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ action: "cancel" }, "已取消这次执行。")}
                >
                  取消
                </button>
              ) : null}
              {active?.status === "running" ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy || active.steps >= active.maxSteps}
                  onClick={() => void act({ action: "step" }, "已记下一步。")}
                >
                  记录一步
                </button>
              ) : null}
              {!done ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ action: "complete" }, "已标记完成。")}
                >
                  标记完成
                </button>
              ) : null}
            </div>
            {!done && !active && goal.runsUsed >= goal.maxRuns ? (
              <p className="mt-3 text-sm text-muted">执行次数已用完，最多 {goal.maxRuns} 次。</p>
            ) : null}
          </section>

          <section className="card min-w-0 p-4">
            <h3 className="font-medium">证据</h3>
            <p className="mt-2 text-sm text-muted">
              {hasEvidence
                ? `已有 ${detail.evidence.length} 条证据${deviceEvidence ? "，其中包含设备证据" : ""}。`
                : "还没有证据。"}
              {goal.requiresDevice && !deviceEvidence ? " 还缺少设备证据。" : ""}
            </p>
            {detail.evidence.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm">
                {detail.evidence.map((item) => (
                  <li key={item.id} className="break-words">
                    <span className="mr-2 text-xs text-muted">{evidenceKindLabel(item.kind)}</span>
                    {item.note}
                  </li>
                ))}
              </ul>
            ) : null}
            {!done ? (
              <form
                className="mt-4 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addEvidence("note");
                }}
              >
                <label className="block text-sm">
                  证据内容
                  <input
                    className="field mt-2"
                    value={note}
                    maxLength={EVIDENCE_MAX}
                    autoComplete="off"
                    placeholder="例如：纪要已写好并核对过"
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button className="secondary-button" type="submit" disabled={busy}>
                    记下证据
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void addEvidence("device")}
                  >
                    记下设备证据
                  </button>
                </div>
              </form>
            ) : (
              <p className="mt-3 text-sm">这个委托已标记完成。</p>
            )}
          </section>
        </div>
      ) : null}
    </PageBody>
  );
}
