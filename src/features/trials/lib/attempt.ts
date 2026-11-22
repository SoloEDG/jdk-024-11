import type { BaitId, BaitStock, FishId, SpotId } from "../../../shared/types";
import { water } from "../../waters/model/waters";
import type {
  CaptureCard,
  TrialAttempt,
  TrialBagItem,
  TrialStep,
  TrialVersion,
} from "../model/types";
import { BAIT_IDS } from "../model/types";
import { versionHash } from "../model/definition";
import { baitName, fishName, spotName } from "../model/labels";
import { fightSolution } from "./fight";

export interface ActionResult {
  attempt: TrialAttempt;
  message: string;
  /** 上层若需要提示“本次课程失败”，用 attempt.status 判断。 */
}

let counter = 0;
function nextAttemptId(version: TrialVersion) {
  counter += 1;
  return `attempt-${version.id}-${Date.now().toString(36)}-${counter}`;
}

function copyStock(stock: BaitStock): BaitStock {
  return { worm: stock.worm, corn: stock.corn, fly: stock.fly };
}

export function startAttempt(
  trialId: string,
  version: TrialVersion,
  options: { preview: boolean; now?: number },
): TrialAttempt {
  const now = options.now ?? Date.now();
  return {
    id: nextAttemptId(version),
    trialId,
    versionId: version.id,
    versionNumber: version.number,
    versionHash: versionHash(version),
    preview: options.preview,
    status: "active",
    stepId: version.startStepId,
    stock: copyStock(version.initial.stock),
    selectedBait: version.initial.bait,
    power: version.initial.power,
    drag: version.initial.drag,
    bag: [],
    lifetimeCatches: 0,
    cards: {},
    failures: [],
    choices: [],
    pendingCast: null,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    completedVersionValid: false,
  };
}

export function currentStep(
  version: TrialVersion,
  attempt: TrialAttempt,
): TrialStep | null {
  return version.steps.find((s) => s.id === attempt.stepId) ?? null;
}

export function cardProgress(attempt: TrialAttempt, stepId: string) {
  return (
    attempt.cards[stepId] ?? {
      count: 0,
      failures: 0,
      attempts: 0,
      claimed: false,
    }
  );
}

/** 该次试玩累计钓起的鱼数（回退与放流都不扣减），用于解锁判定。 */
export function landedCount(attempt: TrialAttempt) {
  return attempt.lifetimeCatches;
}

export function spotUnlocked(
  version: TrialVersion,
  attempt: TrialAttempt,
  spot: SpotId,
) {
  return (
    version.initial.unlocked.includes(spot) ||
    landedCount(attempt) >= water(spot).catchesRequired
  );
}

export function stepUnlockNote(version: TrialVersion, spot: SpotId) {
  return version.initial.unlocked.includes(spot)
    ? `${spotName(spot)}已在起始解锁`
    : `${spotName(spot)}需累计捕获 ${water(spot).catchesRequired} 尾`;
}

function logChoice(
  attempt: TrialAttempt,
  step: TrialStep,
  choice: string,
  detail: string,
  now: number,
) {
  return [
    ...attempt.choices,
    { at: now, stepId: step.id, stepTitle: step.title, choice, detail },
  ];
}

export function chooseBait(
  version: TrialVersion,
  attempt: TrialAttempt,
  bait: BaitId,
  now = Date.now(),
): ActionResult {
  const step = currentStep(version, attempt);
  if (!step || step.kind !== "bait" || attempt.status !== "active")
    return { attempt, message: "当前步骤不接受选饵。" };
  if (!step.options.includes(bait))
    return { attempt, message: "这个鱼饵不在本步的选项里。" };
  if (attempt.stock[bait] < 1)
    return { attempt, message: `${baitName(bait)}已经用完了。` };
  return {
    attempt: {
      ...attempt,
      selectedBait: bait,
      stepId: step.next,
      choices: logChoice(
        attempt,
        step,
        baitName(bait),
        `选定鱼饵不消耗库存；下竿时才扣 1 份，当前库存 ×${attempt.stock[bait]}。`,
        now,
      ),
      updatedAt: now,
    },
    message: `已选用${baitName(bait)}（换饵不消耗，下竿时扣 1 份）。`,
  };
}

export function setTackle(
  attempt: TrialAttempt,
  key: "power" | "drag",
  value: number,
): TrialAttempt {
  if (attempt.pendingCast) return attempt;
  return {
    ...attempt,
    [key]: Math.max(0.15, Math.min(0.95, value)),
    updatedAt: Date.now(),
  };
}

export function pickBranch(
  version: TrialVersion,
  attempt: TrialAttempt,
  optionId: string,
  now = Date.now(),
): ActionResult {
  const step = currentStep(version, attempt);
  if (!step || step.kind !== "branch" || attempt.status !== "active")
    return { attempt, message: "当前步骤不是分支。" };
  const option = step.options.find((o) => o.id === optionId);
  if (!option) return { attempt, message: "分支不存在。" };
  const req = option.requires;
  if (req?.kind === "stock" && attempt.stock[req.bait] < req.min)
    return {
      attempt,
      message: `需要${baitName(req.bait)} ×${req.min}，当前只有 ×${attempt.stock[req.bait]}。`,
    };
  if (req?.kind === "unlocked" && !spotUnlocked(version, attempt, req.spot))
    return {
      attempt,
      message: `${spotName(req.spot)}尚未解锁：需累计捕获 ${water(req.spot).catchesRequired} 尾或写入起始解锁。`,
    };
  if (req?.kind === "landed" && landedCount(attempt) < req.min)
    return { attempt, message: `需要累计捕获 ${req.min} 尾。` };
  const target = version.steps.find((s) => s.id === option.to);
  return {
    attempt: {
      ...attempt,
      stepId: option.to,
      choices: logChoice(
        attempt,
        step,
        option.label,
        target ? `前往「${target.title}」。` : "前往下一张卡。",
        now,
      ),
      updatedAt: now,
    },
    message: `已选择：${option.label}。`,
  };
}

export function goBack(
  version: TrialVersion,
  attempt: TrialAttempt,
  now = Date.now(),
): ActionResult {
  const step = currentStep(version, attempt);
  if (!step || !step.backTo || attempt.status !== "active")
    return { attempt, message: "当前步骤不能回退。" };
  const target = version.steps.find((s) => s.id === step.backTo);
  // 回退：目标卡需要重新完成（进度清零），但已消耗的鱼饵、已领补给、
  // 已放流的鱼和累计捕获都不会退回。这样“只检查连线”就无法通过验证。
  const cards = { ...attempt.cards };
  if (cards[step.id]) cards[step.id] = { ...cards[step.id], count: 0 };
  return {
    attempt: {
      ...attempt,
      stepId: step.backTo,
      cards,
      choices: logChoice(
        attempt,
        step,
        "回到上一步",
        "重新选择不会返还已花掉的鱼饵；已领补给不会重新发放。",
        now,
      ),
      updatedAt: now,
    },
    message: `已回到「${target?.title ?? step.backTo}」。已花掉的鱼饵不返还。`,
  };
}

export function claimSupply(
  version: TrialVersion,
  attempt: TrialAttempt,
  now = Date.now(),
): ActionResult {
  const step = currentStep(version, attempt);
  if (!step || step.kind !== "supply" || attempt.status !== "active")
    return { attempt, message: "当前步骤不是补给。" };
  if (cardProgress(attempt, step.id).claimed)
    return { attempt, message: "这份阶段补给已经领过了。" };
  const stock = copyStock(attempt.stock);
  for (const bait of BAIT_IDS) stock[bait] += step.grant[bait];
  const gained = BAIT_IDS.filter((b) => step.grant[b] > 0)
    .map((b) => `${baitName(b)} +${step.grant[b]}`)
    .join("、");
  return {
    attempt: {
      ...attempt,
      stock,
      cards: {
        ...attempt.cards,
        [step.id]: { ...cardProgress(attempt, step.id), claimed: true },
      },
      choices: logChoice(attempt, step, "领取阶段补给", gained, now),
      updatedAt: now,
    },
    message: `阶段补给已领取（${gained}），本次课程不会再次发放。`,
  };
}

export function advanceSupply(
  version: TrialVersion,
  attempt: TrialAttempt,
  now = Date.now(),
): ActionResult {
  const step = currentStep(version, attempt);
  if (!step || step.kind !== "supply" || attempt.status !== "active")
    return { attempt, message: "当前步骤不是补给。" };
  return {
    attempt: { ...attempt, stepId: step.next, updatedAt: now },
    message: "继续下一步。",
  };
}

export function finishTrial(
  version: TrialVersion,
  attempt: TrialAttempt,
  now = Date.now(),
): ActionResult {
  const step = currentStep(version, attempt);
  if (!step || step.kind !== "complete" || attempt.status !== "active")
    return { attempt, message: "当前步骤不是结业。" };
  return {
    attempt: {
      ...attempt,
      status: "completed",
      completedAt: now,
      choices: logChoice(
        attempt,
        step,
        "完成试炼",
        `累计钓起 ${landedCount(attempt)} 尾，结业时背包剩 ${attempt.bag.length} 尾；全部实际选择已记录。`,
        now,
      ),
      updatedAt: now,
    },
    message: "试炼完成，教学记录已保存。",
  };
}

export function abandonAttempt(
  attempt: TrialAttempt,
  now = Date.now(),
): TrialAttempt {
  return attempt.status === "active"
    ? { ...attempt, status: "abandoned", updatedAt: now }
    : attempt;
}

/* ------------------------------- 下竿与结算 ------------------------------- */

export interface CastContext {
  step: CaptureCard;
  fish: FishId;
  spot: SpotId;
  bait: BaitId;
  power: number;
  drag: number;
  biteWindow: number | null;
}

export function castContext(
  version: TrialVersion,
  attempt: TrialAttempt,
): CastContext | string {
  const step = currentStep(version, attempt);
  if (!step || (step.kind !== "catch" && step.kind !== "strike"))
    return "当前步骤不能下竿。";
  if (attempt.status !== "active") return "本次试玩已经结束。";
  if (attempt.pendingCast)
    return "上一次下竿尚未结算，请先继续或收竿。";
  if (cardProgress(attempt, step.id).count >= step.targetCount)
    return "这一步的捕获目标已经完成。";
  if (!attempt.selectedBait) return "先在鱼饵盒里选一份鱼饵。";
  if (attempt.stock[attempt.selectedBait] < 1)
    return `${baitName(attempt.selectedBait)}已经用完了。`;
  if (step.bait && attempt.selectedBait !== step.bait)
    return `这一步要求使用${baitName(step.bait)}。`;
  if (!spotUnlocked(version, attempt, step.spot))
    return `${spotName(step.spot)}尚未解锁：${stepUnlockNote(version, step.spot)}。`;
  if (!fightSolution(step.encounter))
    return `${fishName(step.encounter)}在当前搏鱼规则下无法收上岸。`;
  return {
    step,
    fish: step.encounter,
    spot: step.spot,
    bait: attempt.selectedBait,
    power: attempt.power,
    drag: attempt.drag,
    biteWindow: step.kind === "strike" ? step.biteWindow : null,
  };
}

/** 抛竿时扣除鱼饵；真实搏鱼由 UI 驱动，结束后调用 settleCast。 */
export function spendCastBait(
  attempt: TrialAttempt,
  ctx: CastContext,
  now = Date.now(),
): TrialAttempt {
  const stock = copyStock(attempt.stock);
  stock[ctx.bait] -= 1;
  return {
    ...attempt,
    stock,
    pendingCast: { stepId: ctx.step.id, bait: ctx.bait, at: now },
    updatedAt: now,
  };
}

export type Outcome =
  | "landed"
  | "missed"
  | "escaped"
  | "cancelled"
  | "interrupted";

/**
 * 结算一次实际下竿。
 * - 钓起：放入试玩背包，累计该卡进度；放流只从背包移出，不返还鱼饵。
 * - 未提竿 / 脱钩：记录失败原因与实际消耗的鱼饵，并占用一次机会。
 */
export function settleCast(
  version: TrialVersion,
  attempt: TrialAttempt,
  outcome: Outcome,
  now = Date.now(),
): ActionResult {
  const pending = attempt.pendingCast;
  if (!pending) return { attempt, message: "没有进行中的下竿。" };
  const step = version.steps.find((s) => s.id === pending.stepId);
  if (!step || (step.kind !== "catch" && step.kind !== "strike"))
    return {
      attempt: { ...attempt, pendingCast: null },
      message: "对应的步骤已不存在。",
    };
  const cleared = { ...attempt, pendingCast: null };
  if (outcome === "cancelled") return { attempt: cleared, message: "已收竿。" };

  const progress = cardProgress(attempt, step.id);
  const attempts = progress.attempts + 1;

  if (outcome === "landed") {
    const item: TrialBagItem = {
      id: `trial-catch-${attempt.id}-${now}`,
      fish: step.encounter,
      spot: step.spot,
      bait: pending.bait,
    };
    const count = progress.count + 1;
    const done = count >= step.targetCount;
    return {
      attempt: {
        ...cleared,
        bag: [item, ...attempt.bag],
        lifetimeCatches: attempt.lifetimeCatches + 1,
        cards: {
          ...attempt.cards,
          [step.id]: { ...progress, count, attempts },
        },
        choices: logChoice(
          attempt,
          step,
          `钓起${fishName(step.encounter)}`,
          `在${spotName(step.spot)}用${baitName(pending.bait)}完成固定遭遇；按正式搏鱼规则收线。`,
          now,
        ),
        // 先保留本卡，让学员看到渔获确认；点“继续”后再进入下一步。
        stepId: step.id,
        updatedAt: now,
      },
      message: done
        ? `钓起${fishName(step.encounter)}，这一步完成。`
        : `钓起${fishName(step.encounter)}，还需 ${step.targetCount - count} 尾。`,
    };
  }

  const reason =
    outcome === "interrupted"
      ? "离开页面，本次下竿中断（鱼饵不返还）"
      : outcome === "missed"
        ? step.kind === "strike"
          ? `超过 ${step.biteWindow} 秒限时未提竿`
          : "超过 4 秒未提竿"
        : step.kind === "strike"
          ? "限时内提竿，但搏鱼时脱钩"
          : "搏鱼时脱钩";
  const failures = progress.failures + 1;
  const exhausted = failures > step.retries;
  return {
    attempt: {
      ...cleared,
      status: exhausted ? "failed" : "active",
      cards: {
        ...attempt.cards,
        [step.id]: { ...progress, attempts, failures },
      },
      failures: [
        ...attempt.failures,
        {
          at: now,
          stepId: step.id,
          stepTitle: step.title,
          reason,
          baitSpent: pending.bait,
        },
      ],
      updatedAt: now,
    },
    message: exhausted
      ? `${reason}；重试机会已用尽，本次课程失败。`
      : `${reason}；鱼饵已消耗，还可以失败 ${step.retries - failures} 次。`,
  };
}

/** 捕获卡完成后的显式推进（用于展示渔获确认后再进入下一步）。 */
export function continueAfterCapture(
  version: TrialVersion,
  attempt: TrialAttempt,
  now = Date.now(),
): ActionResult {
  const step = currentStep(version, attempt);
  if (!step || (step.kind !== "catch" && step.kind !== "strike"))
    return { attempt, message: "" };
  if (cardProgress(attempt, step.id).count < step.targetCount)
    return { attempt, message: "" };
  return {
    attempt: { ...attempt, stepId: step.next, updatedAt: now },
    message: `进入下一步。`,
  };
}

/** 放流：仅试玩背包，不返还鱼饵，也不重新发放补给。 */
export function releaseFromBag(
  version: TrialVersion,
  attempt: TrialAttempt,
  itemId: string,
  now = Date.now(),
): ActionResult {
  const step = currentStep(version, attempt);
  if (!step || step.kind !== "release" || attempt.status !== "active")
    return { attempt, message: "当前步骤不是放流。" };
  const item = attempt.bag.find((i) => i.id === itemId);
  if (!item) return { attempt, message: "背包里没有这尾鱼。" };
  if (step.targetFish && item.fish !== step.targetFish)
    return { attempt, message: `这一步要求放流${fishName(step.targetFish)}。` };
  if (step.targetSpot && item.spot !== step.targetSpot)
    return { attempt, message: `这一步要求放流来自${spotName(step.targetSpot)}的鱼。` };
  const progress = cardProgress(attempt, step.id);
  const count = progress.count + 1;
  const done = count >= step.targetCount;
  return {
    attempt: {
      ...attempt,
      bag: attempt.bag.filter((i) => i.id !== itemId),
      cards: {
        ...attempt.cards,
        [step.id]: { ...progress, count },
      },
      choices: logChoice(
        attempt,
        step,
        `放流${fishName(item.fish)}`,
        `来自${spotName(item.spot)}，用${baitName(item.bait)}钓起。`,
        now,
      ),
      stepId: done ? step.next : step.id,
      updatedAt: now,
    },
    message: done ? "放流完成，进入结业。" : "已放流一尾。",
  };
}
