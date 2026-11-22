import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Fish,
  Flame,
  Gift,
  Lock,
  RefreshCw,
  RotateCcw,
  Undo2,
} from "lucide-react";
import type { BaitId, GameDocument, Session } from "../../../shared/types";
import { isBusy, idleSession } from "../../../shared/initial";
import { newDocument } from "../../../shared/initial";
import { species } from "../../../shared/catalog";
import { LakeScene } from "../../fishing/ui/LakeScene";
import { tickSession } from "../../fishing/model/session";
import { baits } from "../../tackle/model/baits";
import { water } from "../../waters/model/waters";
import type {
  CaptureCard,
  TrialAttempt,
  TrialVersion,
} from "../model/types";
import {
  advanceSupply,
  cardProgress,
  castContext,
  claimSupply,
  chooseBait,
  currentStep,
  finishTrial,
  goBack,
  pickBranch,
  releaseFromBag,
  setTackle,
  settleCast,
  spendCastBait,
  spotUnlocked,
  stepUnlockNote,
} from "../lib/attempt";
import type { CastContext, Outcome } from "../lib/attempt";
import { baitName, fishName, spotName } from "../model/labels";
import { fightSolution } from "../lib/fight";

interface PlayProps {
  attempt: TrialAttempt;
  version: TrialVersion;
  onAttempt: (next: TrialAttempt, flash?: string) => void;
  onContinue: () => void;
  onRestart: () => void;
  onExit: () => void;
}

function biteDelay(attempt: TrialAttempt, stepId: string) {
  let hash = 0;
  const source = `${attempt.id}:${stepId}`;
  for (let i = 0; i < source.length; i += 1)
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  return 1.4 + (hash % 1000) / 1000 * 1.6;
}

function statusLabel(status: TrialAttempt["status"]) {
  return {
    active: "进行中",
    completed: "已完成",
    failed: "已失败",
    abandoned: "已放弃",
    preview: "预览",
  }[status];
}

export function TrialPlay({
  attempt,
  version,
  onAttempt,
  onContinue,
  onRestart,
  onExit,
}: PlayProps) {
  const step = currentStep(version, attempt);
  const [session, setSession] = useState<Session | null>(null);
  const [flash, setFlash] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const settled = useRef(false);
  const biteWindowRef = useRef(4);
  const docRef = useRef<GameDocument>(newDocument());
  const pendingOutcome = useRef<Outcome>("escaped");
  const latest = useRef({ attempt, session, settled: false });
  latest.current = { attempt, session, settled: settled.current };
  const onAttemptRef = useRef(onAttempt);
  onAttemptRef.current = onAttempt;

  useEffect(() => {
    docRef.current = {
      ...docRef.current,
      power: attempt.power,
      drag: attempt.drag,
    };
  }, [attempt.power, attempt.drag]);

  useEffect(() => {
    if (!session) return;
    if (
      session.phase !== "waiting" &&
      session.phase !== "bite" &&
      session.phase !== "fighting"
    )
      return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setSession((prev) => {
        if (!prev) return prev;
        if (
          prev.phase !== "waiting" &&
          prev.phase !== "bite" &&
          prev.phase !== "fighting"
        )
          return prev;
        const next = tickSession(prev, docRef.current, 0.05, {
          biteWindow: biteWindowRef.current,
        });
        if (next.phase === "landed") pendingOutcome.current = "landed";
        if (next.phase === "escaped")
          pendingOutcome.current =
            prev.phase === "bite" ? "missed" : "escaped";
        return next;
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [session !== null, session?.phase]);

  useEffect(() => {
    if (!session) return;
    if (session.phase !== "landed" && session.phase !== "escaped") return;
    if (settled.current) return;
    settled.current = true;
    const result = settleCast(version, attempt, pendingOutcome.current);
    setOutcome(pendingOutcome.current);
    setFlash(result.message);
    onAttempt(result.attempt, result.message);
  }, [session?.phase]);

  // 离开页面/刷新时，进行中的下竿按“中断”结算：饵料已花掉，不返还。
  const versionRef = useRef(version);
  versionRef.current = version;
  useEffect(
    () => () => {
      const snap = latest.current;
      if (!snap.attempt.pendingCast || snap.settled) return;
      if (
        !snap.session ||
        !["waiting", "bite", "fighting"].includes(snap.session.phase)
      )
        return;
      const result = settleCast(
        versionRef.current,
        snap.attempt,
        "interrupted",
      );
      onAttemptRef.current(result.attempt, result.message);
    },
    [],
  );

  function startCast() {
    const ctx = castContext(version, attempt);
    if (typeof ctx === "string") {
      setFlash(ctx);
      return;
    }
    if (!attempt.selectedBait) return;
    const fish = species(ctx.fish);
    biteWindowRef.current =
      ctx.step.kind === "strike" ? ctx.step.biteWindow : 4;
    settled.current = false;
    setOutcome(null);
    setFlash("");
    const spent = spendCastBait(attempt, ctx);
    onAttempt(spent);
    const weight =
      Math.round((fish.min + (fish.max - fish.min) * 0.62) * 100) / 100;
    const castPower = 0.7;
    setSession({
      ...idleSession(),
      id: `${attempt.id}-${ctx.step.id}-${Date.now()}`,
      phase: "waiting",
      spot: ctx.spot,
      bait: ctx.bait,
      castPower,
      fish: ctx.fish,
      weight,
      biteAt: biteDelay(attempt, ctx.step.id) + (1 - castPower) * 0.8,
      message: "固定遭遇已就位：浮漂落水，留意它下沉的瞬间。",
    });
  }

  function strikeNow() {
    if (!session || session.phase !== "bite") return;
    setSession((prev) =>
      prev
        ? { ...prev, phase: "fighting", clock: 0, reeling: false, message: "按住收线；张力过高时松开。" }
        : prev,
    );
  }

  function cancelCast() {
    setSession(null);
    settled.current = true;
    const result = settleCast(version, attempt, "cancelled");
    setFlash("已收竿，消耗的鱼饵不会返还。");
    onAttempt(result.attempt, "已收竿，消耗的鱼饵不会返还。");
  }

  function clearSession() {
    setSession(null);
    setOutcome(null);
    setFlash("");
    // 捕获目标完成后，点“继续”才推进到下一张卡；推进交给上层基于最新状态处理。
    onContinue();
  }

  function act(result: { attempt: TrialAttempt; message: string }) {
    setFlash(result.message);
    onAttempt(result.attempt, result.message);
  }

  const busy = session ? isBusy(session) : false;
  const progress = step ? cardProgress(attempt, step.id) : null;

  if (attempt.status !== "active") {
    return (
      <section className="trial-play">
        <div className="trial-outcome">
          <strong>
            {attempt.preview
              ? "草稿预览已结束"
              : attempt.status === "completed"
                ? "试炼完成"
                : attempt.status === "failed"
                  ? "本次试炼失败"
                  : "试玩已结束"}
          </strong>
          <p>
            累计钓起 {attempt.lifetimeCatches} 尾，背包剩余 {attempt.bag.length}{" "}
            尾；失败 {attempt.failures.length} 次。全部实际选择已写入教学记录。
          </p>
          <div className="trial-actions">
            <button className="primary" onClick={onRestart}>
              <RotateCcw size={15} />
              再试一次
            </button>
            <button className="ghost" onClick={onExit}>
              查看教学记录
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="trial-play">
      <div className="trial-banner">
        <span className={"trial-dot " + attempt.status} />
        <span>
          {attempt.preview
            ? "草稿预览 · 不发放徽章，也不写入正式进度"
            : `第 ${attempt.versionNumber} 版 · ${statusLabel(attempt.status)}`}
        </span>
        <span className="trial-stock">
          {baits
            .map((b) => `${b.name} ×${attempt.stock[b.id]}`)
            .join(" · ")}
        </span>
      </div>

      {!step && <p className="trial-error">当前步骤不存在，无法继续。</p>}

      {step && (
        <>
          <div className="trial-step-head">
            <div>
              <small>
                当前步骤 · {step.id}
                {progress && progress.failures > 0
                  ? ` · 本步失败 ${progress.failures} 次`
                  : ""}
              </small>
              <h3>{step.title}</h3>
              <p>{step.instruction}</p>
            </div>
            {step.backTo && !busy && (
              <button
                className="text-btn"
                onClick={() => act(goBack(version, attempt))}
              >
                <Undo2 size={13} />
                回到上一步
              </button>
            )}
          </div>

          {step.kind === "bait" && (
            <div className="trial-choice-grid">
              {step.options.map((id) => (
                <button
                  key={id}
                  className="trial-choice"
                  disabled={attempt.stock[id] < 1}
                  onClick={() => act(chooseBait(version, attempt, id))}
                >
                  <strong>{baitName(id)}</strong>
                  <small>库存 ×{attempt.stock[id]}</small>
                </button>
              ))}
            </div>
          )}

          {step.kind === "branch" && (
            <>
              <p className="trial-prompt">{step.prompt}</p>
              <div className="trial-choice-grid">
                {step.options.map((option) => {
                  const blockedReason =
                    option.requires?.kind === "stock" &&
                    attempt.stock[option.requires.bait] < option.requires.min
                      ? `需要${baitName(option.requires.bait)} ×${option.requires.min}`
                      : option.requires?.kind === "unlocked" &&
                          !spotUnlocked(version, attempt, option.requires.spot)
                        ? stepUnlockNote(version, option.requires.spot)
                        : option.requires?.kind === "landed" &&
                            attempt.lifetimeCatches < option.requires.min
                          ? `需要累计捕获 ${option.requires.min} 尾`
                          : null;
                  return (
                    <button
                      key={option.id}
                      className="trial-choice"
                      disabled={!!blockedReason}
                      onClick={() => act(pickBranch(version, attempt, option.id))}
                    >
                      <strong>{option.label}</strong>
                      <small>
                        {blockedReason ??
                          `前往「${version.steps.find((s) => s.id === option.to)?.title ?? option.to}」`}
                      </small>
                      {blockedReason && <Lock size={13} />}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step.kind === "supply" && (
            <div className="trial-supply">
              <div>
                <Gift size={18} />
                <span>
                  补给：{baits.map((b) => `${b.name} +${step.grant[b.id]}`).join(" · ")}
                </span>
              </div>
              {progress?.claimed ? (
                <span className="trial-ok">
                  <Check size={14} />
                  已领取（每份课程只发一次）
                </span>
              ) : (
                <button
                  className="primary small"
                  onClick={() => act(claimSupply(version, attempt))}
                >
                  领取补给
                </button>
              )}
              <button
                className="ghost"
                onClick={() => act(advanceSupply(version, attempt))}
              >
                <ArrowRight size={14} />
                继续
              </button>
            </div>
          )}

          {step.kind === "release" && (
            <div className="trial-release">
              <p className="trial-prompt">
                从试玩背包放流
                {step.targetFish ? fishName(step.targetFish) : "任意一尾"}
                {step.targetSpot ? `（${spotName(step.targetSpot)}）` : ""}。
              </p>
              {attempt.bag.length === 0 && (
                <p className="trial-error">背包里还没有可放流的鱼。</p>
              )}
              <div className="trial-bag">
                {attempt.bag.map((item) => (
                  <div className="trial-bag-item" key={item.id}>
                    <Fish size={18} />
                    <span>
                      <strong>{fishName(item.fish)}</strong>
                      <small>
                        {spotName(item.spot)} · {baitName(item.bait)}
                      </small>
                    </span>
                    <button
                      className="text-btn"
                      onClick={() =>
                        act(releaseFromBag(version, attempt, item.id))
                      }
                    >
                      放流
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step.kind === "complete" && (
            <div className="trial-complete">
              <p>{step.badgeText}</p>
              <button
                className="primary"
                onClick={() => {
                  const result = finishTrial(version, attempt);
                  setFlash(result.message);
                  onAttempt(result.attempt, result.message);
                }}
              >
                <Check size={16} />
                完成并领取徽章
              </button>
            </div>
          )}

          {(step.kind === "catch" || step.kind === "strike") && (
            <FishingCard
              version={version}
              attempt={attempt}
              step={step}
              session={session}
              outcome={outcome}
              busy={busy}
              flash={flash}
              onBait={(bait) =>
                act({
                  attempt: { ...attempt, selectedBait: bait },
                  message: `已换用${baitName(bait)}（换饵不消耗，下竿扣 1 份）。`,
                })
              }
              onTackle={(key, value) =>
                onAttempt(setTackle(attempt, key, value))
              }
              onCast={startCast}
              onStrike={strikeNow}
              onReel={(held) =>
                setSession((prev) => (prev ? { ...prev, reeling: held } : prev))
              }
              onCancel={cancelCast}
              onContinue={clearSession}
            />
          )}
        </>
      )}

      <div className="trial-meta">
        <span>
          试玩背包 {attempt.bag.length} 尾 · 累计钓起 {attempt.lifetimeCatches}{" "}
          尾（与正式背包隔离）
        </span>
        <span>失败 {attempt.failures.length} 次</span>
        <span>
          实际选择 {attempt.choices.length} 条 · 均写入教学记录
        </span>
      </div>

      {flash && !session && <p className="trial-flash">{flash}</p>}

      {attempt.failures.length > 0 && (
        <details className="trial-log">
          <summary>失败原因（{attempt.failures.length}）</summary>
          <ul>
            {attempt.failures.map((f, i) => (
              <li key={`${f.at}-${i}`}>
                {f.stepTitle}：{f.reason}
                {f.baitSpent ? `（消耗${baitName(f.baitSpent)}）` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      <button className="text-btn trial-exit" onClick={onExit}>
        <ArrowLeft size={13} />
        返回试炼大厅
      </button>
    </section>
  );
}

function FishingCard({
  version,
  attempt,
  step,
  session,
  outcome,
  busy,
  flash,
  onBait,
  onTackle,
  onCast,
  onStrike,
  onReel,
  onCancel,
  onContinue,
}: {
  version: TrialVersion;
  attempt: TrialAttempt;
  step: CaptureCard;
  session: Session | null;
  outcome: Outcome | null;
  busy: boolean;
  flash: string;
  onBait: (bait: BaitId) => void;
  onTackle: (key: "power" | "drag", value: number) => void;
  onCast: () => void;
  onStrike: () => void;
  onReel: (held: boolean) => void;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const ctx = castContext(version, attempt);
  const ctxValue = typeof ctx === "string" ? null : (ctx as CastContext);
  const biteWindow = step.kind === "strike" ? step.biteWindow : 4;
  const remaining =
    session && session.phase === "bite"
      ? Math.max(0, session.biteAt + biteWindow - session.clock)
      : null;
  // 只有结算 effect 已写入结果后才显示“继续”，避免在钓获尚未落账时提前推进。
  const finished =
    !!session &&
    (session.phase === "landed" || session.phase === "escaped") &&
    outcome !== null;
  const solution = fightSolution(step.encounter);

  return (
    <div className="trial-fishing">
      <div className="trial-cast-meta">
        <span>
          <strong>{spotName(step.spot)}</strong>
          {spotUnlocked(version, attempt, step.spot)
            ? " · 已解锁"
            : " · 尚不可下竿"}
        </span>
        <span>
          固定遭遇 <strong>{fishName(step.encounter)}</strong>
        </span>
        <span>
          咬钩后 {biteWindow} 秒内提竿
          {step.kind === "strike" ? "（本步限时）" : "（正式规则）"}
        </span>
        {step.targetCount > 1 && (
          <span>
            本步进度 {cardProgress(attempt, step.id).count}/{step.targetCount}
          </span>
        )}
      </div>

      <div className="trial-lake">
        <LakeScene
          session={
            session ?? {
              ...idleSession(),
              spot: step.spot,
              bait: attempt.selectedBait ?? "worm",
              fish: step.encounter,
            }
          }
          spot={step.spot}
        />
      </div>

      <div className="trial-bait-row">
        {baits.map((b) => {
          const allowed = !step.bait || step.bait === b.id;
          return (
            <button
              key={b.id}
              className={"trial-bait " + (attempt.selectedBait === b.id ? "active" : "")}
              disabled={busy || !allowed || attempt.stock[b.id] < 1}
              onClick={() => onBait(b.id)}
            >
              <strong>{b.name}</strong>
              <small>
                ×{attempt.stock[b.id]}
                {!allowed && b.id !== step.bait ? " · 本步不可用" : ""}
              </small>
            </button>
          );
        })}
      </div>

      <div className="trial-tackle">
        <label>
          收线力度 <output>{Math.round(attempt.power * 100)}%</output>
          <input
            type="range"
            min="15"
            max="95"
            value={attempt.power * 100}
            disabled={busy}
            onChange={(e) => onTackle("power", +e.target.value / 100)}
          />
        </label>
        <label>
          泄力设置 <output>{Math.round(attempt.drag * 100)}%</output>
          <input
            type="range"
            min="15"
            max="95"
            value={attempt.drag * 100}
            disabled={busy}
            onChange={(e) => onTackle("drag", +e.target.value / 100)}
          />
        </label>
      </div>

      {!session && (
        <div className="trial-actions">
          <button className="primary" disabled={!ctxValue} onClick={onCast}>
            <Fish size={16} />
            下竿（消耗 1 份{attempt.selectedBait ? baitName(attempt.selectedBait) : "鱼饵"}）
          </button>
          {!ctxValue && (
            <span className="trial-error">
              {typeof ctx === "string" ? ctx : "当前不能下竿。"}
            </span>
          )}
          {solution && (
            <span className="trial-hint">
              规则提示（仅供新手参考）：该固定遭遇在力度{" "}
              {solution.power.toFixed(2)} / 泄力 {solution.drag.toFixed(2)}{" "}
              下约 {solution.seconds} 秒可收上岸；可自行调整。
            </span>
          )}
        </div>
      )}

      {session && (
        <div className="trial-live">
          <div className="live-status">
            <span className={"status-dot " + session.phase} />
            <span>{session.message}</span>
          </div>
          {session.phase === "waiting" && (
            <button className="primary" disabled>
              等待咬钩…
            </button>
          )}
          {session.phase === "bite" && (
            <button className="primary bite-button" onClick={onStrike}>
              提竿！剩余 {remaining?.toFixed(1)} 秒
            </button>
          )}
          {session.phase === "fighting" && (
            <>
              <div className="fight-meters">
                <label>
                  鱼线张力 <strong>{Math.round(session.tension * 100)}%</strong>
                  <meter
                    aria-label="鱼线张力"
                    min="0"
                    max="1"
                    low={0.25}
                    high={0.8}
                    optimum={0.55}
                    value={session.tension}
                  />
                </label>
                <label>
                  距离上岸 <strong>{Math.round(session.progress * 100)}%</strong>
                  <progress aria-label="收线进度" max="1" value={session.progress} />
                </label>
                <small>
                  体力 {Math.round(session.energy * 100)}% · 松线{" "}
                  {session.slackTime.toFixed(1)} / 5 秒
                </small>
              </div>
              <div className="trial-actions">
                <button
                  className={"primary reel-button " + (session.reeling ? "held" : "")}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    onReel(true);
                  }}
                  onPointerUp={() => onReel(false)}
                  onPointerCancel={() => onReel(false)}
                  onLostPointerCapture={() => onReel(false)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      onReel(true);
                    }
                  }}
                  onKeyUp={() => onReel(false)}
                  onBlur={() => onReel(false)}
                >
                  <Flame size={16} />
                  按住收线（空格）
                </button>
                <button className="ghost" onClick={onCancel}>
                  收竿
                </button>
              </div>
            </>
          )}
          {finished && (
            <div className="trial-actions">
              <strong className={outcome === "landed" ? "trial-ok" : "trial-error"}>
                {outcome === "landed"
                  ? `已钓起 ${fishName(step.encounter)}`
                  : outcome === "missed"
                    ? "错过提竿时机"
                    : "搏鱼脱钩"}
              </strong>
              <button className="primary" onClick={onContinue}>
                继续
              </button>
            </div>
          )}
          {(session.phase === "waiting" || session.phase === "bite") && (
            <button className="ghost" onClick={onCancel}>
              <RefreshCw size={13} />
              收竿（饵料不退）
            </button>
          )}
          {flash && <p className="trial-flash">{flash}</p>}
        </div>
      )}

      <p className="trial-rule-note">
        水域解锁、鱼饵消耗与搏鱼规则与正式玩法一致；只有固定遭遇是试炼明示的。
        本步重试次数 {step.retries}，失败会记录实际原因，消耗的饵料不返还。
      </p>
      <p className="trial-hint">
        当前水域：{water(step.spot).name} · 正式解锁需累计捕获{" "}
        {water(step.spot).catchesRequired} 尾
      </p>
    </div>
  );
}
