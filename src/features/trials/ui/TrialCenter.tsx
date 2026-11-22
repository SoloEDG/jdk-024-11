import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpenCheck,
  ChevronDown,
  Eye,
  Flag,
  PencilLine,
  Play,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { TrialAttempt, TrialLibrary } from "../model/types";
import { versionHash } from "../model/definition";
import {
  attemptUsesActiveVersion,
  badgeFor,
  findAttempt,
  previewMatchesDraft,
  publishTrial,
  versionForAttempt,
} from "../lib/versions";
import { validateTrial, versionIsValid } from "../lib/validate";
import { startAttempt } from "../lib/attempt";
import { fishName, spotName } from "../model/labels";
import { TrialEditor } from "./TrialEditor";
import { TrialPlay } from "./TrialPlay";

export type TrialMode =
  | { screen: "hall" }
  | { screen: "edit" }
  | { screen: "play"; attemptId: string };

interface Props {
  library: TrialLibrary;
  onLibrary: (next: TrialLibrary, flash?: string) => void;
  onAttempt: (attempt: TrialAttempt, flash?: string) => void;
  onContinue: (attemptId: string) => void;
  mode: TrialMode;
  setMode: (mode: TrialMode) => void;
}

function timeText(at: number) {
  return new Date(at).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusText(attempt: TrialAttempt) {
  return (
    {
      active: "进行中",
      completed: "已完成",
      failed: "失败",
      abandoned: "已放弃",
      preview: "预览",
    } as const
  )[attempt.status];
}

export function TrialCenter({
  library,
  onLibrary,
  onAttempt,
  onContinue,
  mode,
  setMode,
}: Props) {
  const trial = library.trial;
  const draft = trial.draft;
  const activeVersion = useMemo(
    () => trial.versions.find((v) => v.id === trial.activeVersionId) ?? null,
    [trial],
  );
  const badge = badgeFor(library);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
    library.lastAttemptId,
  );
  const selectedAttempt = findAttempt(library, selectedAttemptId);
  const [showHistory, setShowHistory] = useState(false);
  const draftStale =
    !!draft.validation && draft.validation.contentHash !== versionHash(draft);
  const draftPlayable =
    !!draft.validation &&
    !draftStale &&
    draft.validation.status === "solvable" &&
    draft.validation.example !== null;

  const inFlight = library.attempts.filter(
    (a) => a.status === "active" && !a.preview,
  );
  const previews = library.attempts.filter((a) => a.preview);
  const saved = library.attempts.filter((a) => !a.preview).slice(0, 12);

  const playing = findAttempt(
    library,
    mode.screen === "play" ? mode.attemptId : null,
  );
  const previewStale =
    !!playing && playing.preview && !previewMatchesDraft(library, playing);

  function beginAttempt(preview: boolean) {
    // 正式试玩只能沿用已发布版本；预览只针对已验证的草稿。
    const version = preview ? draft : activeVersion;
    if (!version) return;
    const existing = library.attempts.find(
      (a) => a.status === "active" && a.preview === preview,
    );
    if (existing) {
      setMode({ screen: "play", attemptId: existing.id });
      return;
    }
    const attempt = startAttempt(trial.id, version, { preview });
    onLibrary({ ...library, attempts: [attempt, ...library.attempts] });
    setMode({ screen: "play", attemptId: attempt.id });
  }

  if (mode.screen === "edit")
    return (
      <TrialEditor
        library={library}
        onDraft={(mutate) =>
          onLibrary(
            {
              ...library,
              trial: {
                ...trial,
                draft: mutate(trial.draft),
                updatedAt: Date.now(),
              },
            },
          )
        }
        onValidate={() => {
          const next = validateTrial(trial.draft);
          onLibrary(
            {
              ...library,
              trial: {
                ...trial,
                draft: { ...trial.draft, validation: next },
                updatedAt: Date.now(),
              },
            },
            next.status === "solvable"
              ? "验证通过：已找到可操作完成路径。"
              : next.status === "unsolvable"
                ? "验证未通过：当前课程无法完成。"
                : "验证未穷尽：不能据此判定无解。",
          );
        }}
        onPublish={() => {
          const result = publishTrial(library);
          onLibrary(result.library, result.message);
          if (result.ok) setMode({ screen: "hall" });
        }}
        onBack={() => setMode({ screen: "hall" })}
      />
    );

  if (mode.screen === "play") {
    const attempt = playing;
    const version = attempt ? versionForAttempt(library, attempt) : null;
    if (!attempt || !version) {
      return (
        <section className="trial-hall">
          <p className="trial-error">找不到进行中的试玩。</p>
          <button className="ghost" onClick={() => setMode({ screen: "hall" })}>
            返回大厅
          </button>
        </section>
      );
    }
    if (previewStale) {
      return (
        <section className="trial-hall">
          <div className="trial-card">
            <p className="trial-warn">
              <AlertTriangle size={14} />
              这节草稿在预览开始后被修改，预览已与当前草稿不一致。请返回大厅重新开始预览。
            </p>
            <button className="primary" onClick={() => setMode({ screen: "hall" })}>
              返回大厅
            </button>
          </div>
        </section>
      );
    }
    return (
      <TrialPlay
        attempt={attempt}
        version={version}
        onAttempt={(next, flash) => onAttempt(next, flash)}
        onContinue={() => onContinue(attempt.id)}
        onRestart={() => {
          const base = {
            ...library,
            attempts: library.attempts.map((a) =>
              a.id === attempt.id
                ? { ...a, status: "abandoned" as const }
                : a,
            ),
          };
          const fresh = startAttempt(trial.id, version, {
            preview: attempt.preview,
          });
          onLibrary({ ...base, attempts: [fresh, ...base.attempts] });
          setMode({ screen: "play", attemptId: fresh.id });
        }}
        onExit={() => {
          setSelectedAttemptId(attempt.id);
          setMode({ screen: "hall" });
        }}
      />
    );
  }

  return (
    <section className="trial-hall">
      <div className="trial-hall-head">
        <div>
          <span className="eyebrow">TEACHING TRIALS</span>
          <h2>教学试炼</h2>
          <p>
            老师用步骤卡搭一条可验证的学习路径；新手先在试玩里走一遍，再决定是否发布。
          </p>
        </div>
        <div className="trial-hall-actions">
          <button className="ghost" onClick={() => setMode({ screen: "edit" })}>
            <PencilLine size={15} />
            编辑课程
          </button>
          <button
            className="primary"
            disabled={!activeVersion}
            title={
              activeVersion
                ? "使用当前线上版本开始试玩"
                : "需要先发布一个通过验证的版本"
            }
            onClick={() => beginAttempt(false)}
          >
            <Play size={15} />
            正式试玩
          </button>
        </div>
      </div>

      <div className="trial-hall-grid">
        <article className="trial-card trial-course">
          <div className="trial-card-head">
            <BookOpenCheck size={17} />
            <h3>{activeVersion?.title ?? "尚未发布课程"}</h3>
            {activeVersion && <span>第 {activeVersion.number} 版</span>}
          </div>
          <p>
            {activeVersion?.summary ??
              "先编辑并验证草稿，确认存在可操作完成路径后再发布。"}
          </p>
          <div className="trial-chip-row">
            {(activeVersion ?? draft).steps.slice(0, 5).map((s) => (
              <span className="trial-chip" key={s.id}>
                {s.title}
              </span>
            ))}
          </div>
          <div className="trial-course-state">
            {activeVersion ? (
              <span className="trial-ok">
                <ShieldCheck size={13} />
                {versionIsValid(activeVersion)
                  ? "已发布版本验证有效"
                  : "已发布版本已失效"}
              </span>
            ) : (
              <span className="trial-warn">
                <AlertTriangle size={13} />
                还没有发布版本
              </span>
            )}
            {badge ? (
              <span className="trial-badge">
                <Award size={14} />
                已获徽章：{activeVersion?.badge.name ?? draft.badge.name}（第{" "}
                {badge.versionNumber} 版）
              </span>
            ) : (
              <span className="trial-hint">毕业徽章：{draft.badge.name}（未获得）</span>
            )}
          </div>
          <div className="trial-card-foot">
            <button
              className="text-btn"
              disabled={!draftPlayable}
              onClick={() => beginAttempt(true)}
              title={draftPlayable ? "只预览草稿，不发徽章" : "草稿需先通过验证"}
            >
              <Eye size={13} />
              预览草稿
            </button>
            <button className="text-btn" onClick={() => setMode({ screen: "edit" })}>
              <PencilLine size={13} />
              修改并重新验证
            </button>
          </div>
          {!draftPlayable && (
            <p className="trial-hint">
              草稿尚未通过“存在完成路径”的验证，预览与发布都被锁住。
            </p>
          )}
        </article>

        <article className="trial-card">
          <div className="trial-card-head">
            <Flag size={17} />
            <h3>进行中的学员</h3>
            <span>{inFlight.length}</span>
          </div>
          {inFlight.length === 0 && (
            <p className="trial-hint">还没有学员正在试玩。</p>
          )}
          {inFlight.slice(0, 5).map((a) => {
            const v = versionForAttempt(library, a);
            return (
              <button
                key={a.id}
                className="trial-attempt-row"
                onClick={() => setMode({ screen: "play", attemptId: a.id })}
              >
                <span>
                  <strong>第 {a.versionNumber} 版 · {v?.title ?? "未知课程"}</strong>
                  <small>
                    当前步骤 {a.stepId} · 已钓 {a.bag.length} 尾 · 失败{" "}
                    {a.failures.length} 次
                  </small>
                </span>
                <span
                  className={
                    "trial-version-tag " +
                    (attemptUsesActiveVersion(library, a) ? "" : "old")
                  }
                >
                  {attemptUsesActiveVersion(library, a) ? "现行版" : "沿旧版"}
                </span>
                <ArrowRight size={14} />
              </button>
            );
          })}
        </article>

        <article className="trial-card">
          <div className="trial-card-head">
            <ScrollText size={17} />
            <h3>教学记录</h3>
            <span>{saved.length}</span>
          </div>
          {saved.length === 0 && (
            <p className="trial-hint">
              新手完成或失败后，实际选择与失败原因会保存在这里。
            </p>
          )}
          {saved.slice(0, 5).map((a) => (
            <button
              key={a.id}
              className="trial-attempt-row"
              onClick={() => setSelectedAttemptId(a.id)}
            >
              <span>
                <strong>
                  {statusText(a)} · 第 {a.versionNumber} 版
                </strong>
                <small>
                  {timeText(a.updatedAt)} · 钓起 {a.bag.length} 尾 · 失败{" "}
                  {a.failures.length} 次 · 选择 {a.choices.length} 条
                </small>
              </span>
              <ArrowRight size={14} />
            </button>
          ))}
          {saved.length > 5 && (
            <button className="text-btn" onClick={() => setShowHistory(!showHistory)}>
              <ChevronDown size={12} />
              {showHistory ? "收起" : `查看全部 ${saved.length} 条`}
            </button>
          )}
          {showHistory && (
            <div className="trial-history">
              {saved.slice(5).map((a) => (
                <button key={a.id} className="trial-attempt-row" onClick={() => setSelectedAttemptId(a.id)}>
                  <span>
                    <strong>
                      {statusText(a)} · 第 {a.versionNumber} 版
                    </strong>
                    <small>
                      {timeText(a.updatedAt)} · 失败 {a.failures.length} 次
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="trial-card">
          <div className="trial-card-head">
            <Sparkles size={17} />
            <h3>版本与徽章</h3>
          </div>
          <div className="trial-versions">
            {trial.versions.length === 0 && (
              <p className="trial-hint">发布第一版后，这里会列出历史版本。</p>
            )}
            {[...trial.versions].reverse().map((v) => (
              <div className="trial-version-row" key={v.id}>
                <span>
                  <strong>第 {v.number} 版</strong>
                  <small>
                    {timeText(v.createdAt)} ·{" "}
                    {versionIsValid(v) ? "验证有效" : "验证失效"}
                  </small>
                </span>
                {v.id === trial.activeVersionId && (
                  <span className="trial-version-tag">现行</span>
                )}
              </div>
            ))}
          </div>
          <p className="trial-hint">
            徽章只在“有效版本的完整通关”后领取一次；旧版学员沿用原版继续，发布新版不会重置其进度。
          </p>
          {previews.length > 0 && (
            <p className="trial-hint">
              <Eye size={12} /> 另有 {previews.length} 次草稿预览，不计入正式进度、不发徽章。
            </p>
          )}
        </article>
      </div>

      {selectedAttempt && (
        <AttemptDetail
          attempt={selectedAttempt}
          library={library}
          onClose={() => setSelectedAttemptId(null)}
        />
      )}
    </section>
  );
}

function AttemptDetail({
  attempt,
  library,
  onClose,
}: {
  attempt: TrialAttempt;
  library: TrialLibrary;
  onClose: () => void;
}) {
  const version = versionForAttempt(library, attempt);
  return (
    <article className="trial-detail">
      <div className="trial-card-head">
        <ScrollText size={16} />
        <h3>教学记录 · 第 {attempt.versionNumber} 版</h3>
        <button className="text-btn" onClick={onClose}>
          <ArrowLeft size={12} />
          关闭
        </button>
      </div>
      <div className="trial-detail-meta">
        <span>状态：{statusText(attempt)}</span>
        <span>{attempt.preview ? "草稿预览（无徽章）" : "正式试玩"}</span>
        <span>开始 {timeText(attempt.startedAt)}</span>
        <span>更新 {timeText(attempt.updatedAt)}</span>
        <span>课程：{version?.title ?? "（版本缺失）"}</span>
        <span>当前步骤：{attempt.stepId}</span>
      </div>
      <div className="trial-detail-cols">
        <div>
          <h4>实际选择</h4>
          {attempt.choices.length === 0 && <p className="trial-hint">还没有记录。</p>}
          <ol className="trial-choice-log">
            {attempt.choices.map((c, i) => (
              <li key={`${c.at}-${i}`}>
                <strong>{c.stepTitle}</strong> · {c.choice}
                <small>{c.detail}</small>
                <small>{timeText(c.at)}</small>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h4>失败原因</h4>
          {attempt.failures.length === 0 && (
            <p className="trial-hint">没有失败记录。</p>
          )}
          <ul className="trial-failure-log">
            {attempt.failures.map((f, i) => (
              <li key={`${f.at}-${i}`}>
                <strong>{f.stepTitle}</strong>：{f.reason}
                {f.baitSpent && <small>消耗 {f.baitSpent}</small>}
                <small>{timeText(f.at)}</small>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>试玩背包（隔离）</h4>
          {attempt.bag.length === 0 && <p className="trial-hint">空。</p>}
          <ul className="trial-bag-list">
            {attempt.bag.map((item) => (
              <li key={item.id}>
                {fishName(item.fish)} · {spotName(item.spot)}
              </li>
            ))}
          </ul>
          <h4>库存</h4>
          <p className="trial-hint">
            蚯蚓 ×{attempt.stock.worm} · 玉米 ×{attempt.stock.corn} · 拟蝇 ×
            {attempt.stock.fly}
          </p>
        </div>
      </div>
      {attempt.status === "completed" && !attempt.preview && (
        <p className="trial-hint">
          所沿用版本：
          {library.trial.versions.some((v) => v.id === attempt.versionId)
            ? versionIsValid(
                library.trial.versions.find((v) => v.id === attempt.versionId) ??
                  library.trial.versions[0],
              )
              ? "已发布且验证有效"
              : "已发布但验证失效"
            : "未发布（草稿）"}
          ；徽章
          {library.badges.some((b) => b.attemptId === attempt.id)
            ? "已发放"
            : "未发放"}
          。
        </p>
      )}
    </article>
  );
}


