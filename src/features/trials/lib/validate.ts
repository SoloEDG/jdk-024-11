import type {
  BaitId,
  BaitStock,
  FishId,
  SpotId,
} from "../../../shared/types";
import { fishCatalog } from "../../../shared/catalog";
import { water } from "../../waters/model/waters";
import { baits } from "../../tackle/model/baits";
import { fishName, spotName } from "../model/labels";
import type {
  BranchOption,
  CaptureCard,
  ExampleAction,
  ExamplePath,
  FightPlan,
  ReleaseCard,
  TrialConflict,
  StrikeCard,
  TrialStep,
  TrialVersion,
  ValidationReport,
  ValidationStatus,
} from "../model/types";
import { BAIT_IDS, FISH_IDS, SPOT_IDS } from "../model/types";
import { versionHash } from "../model/definition";
import { fightSolution } from "./fight";

const STATE_CAP = 90_000;
const BAG_KEY_SEP = "|";

interface SimState {
  stepId: string;
  prog: number;
  stock: [number, number, number];
  bag: Record<string, number>;
  catches: number;
  releases: number;
  supplies: string[];
}

interface Edge {
  label: string;
  action: ExampleAction;
  fight: FightPlan | null;
}

interface SearchResult {
  /** 是否真的走完了所有可达状态（未提前找到终点、未触顶）。 */
  exhaustive: boolean;
  capHit: boolean;
  states: SimState[];
  parents: (number | null)[];
  incoming: (Edge | null)[];
  blocked: {
    stepId: string;
    key: string;
    title: string;
    detail: string;
    best: SimState;
  }[];
}

function stockToArray(stock: BaitStock): [number, number, number] {
  return [stock.worm, stock.corn, stock.fly];
}

function stockToObject(stock: [number, number, number]): BaitStock {
  return { worm: stock[0], corn: stock[1], fly: stock[2] };
}

export function formatStock(stock: BaitStock) {
  return BAIT_IDS.map((id) => `${baitName(id)}×${stock[id]}`).join(" / ");
}

function baitName(id: BaitId) {
  return baits.find((b) => b.id === id)?.name ?? id;
}

function bagKey(fish: FishId, spot: SpotId) {
  return `${fish}${BAG_KEY_SEP}${spot}`;
}

function bagLabel(key: string) {
  const [fish, spot] = key.split(BAG_KEY_SEP) as [FishId, SpotId];
  return `${fishName(fish)}（${spotName(spot)}）`;
}

function stateKey(s: SimState) {
  const bag = Object.keys(s.bag)
    .filter((k) => s.bag[k] > 0)
    .sort()
    .map((k) => `${k}:${s.bag[k]}`)
    .join(",");
  return [
    s.stepId,
    s.prog,
    s.stock.join("/"),
    bag,
    s.catches,
    s.releases,
    [...s.supplies].sort().join(","),
  ].join(";");
}

function unlockRequirement(spot: SpotId) {
  return water(spot).catchesRequired;
}

function isUnlocked(version: TrialVersion, s: SimState, spot: SpotId) {
  return (
    version.initial.unlocked.includes(spot) ||
    s.catches >= unlockRequirement(spot)
  );
}

function stockLabel(s: SimState) {
  return formatStock(stockToObject(s.stock));
}

function conditionFailure(
  version: TrialVersion,
  s: SimState,
  option: BranchOption,
) {
  const req = option.requires;
  if (!req) return null;
  if (req.kind === "stock") {
    const index = BAIT_IDS.indexOf(req.bait);
    const have = s.stock[index];
    return have >= req.min
      ? null
      : `需要${baitName(req.bait)} ×${req.min}，当时只剩 ×${have}`;
  }
  if (req.kind === "unlocked") {
    return isUnlocked(version, s, req.spot)
      ? null
      : `${spotName(req.spot)}尚未解锁（需累计捕获 ${unlockRequirement(req.spot)} 尾）`;
  }
  return s.catches >= req.min
    ? null
    : `需要累计捕获 ${req.min} 尾，当时只有 ${s.catches} 尾`;
}

function cloneState(s: SimState): SimState {
  return {
    stepId: s.stepId,
    prog: s.prog,
    stock: [s.stock[0], s.stock[1], s.stock[2]],
    bag: { ...s.bag },
    catches: s.catches,
    releases: s.releases,
    supplies: [...s.supplies],
  };
}

/**
 * action 展示的是“执行这一步之后”的资源状态。返回的 action 用 next 状态填充，
 * 因此库存变化能在示例里被逐项核对；stepId 仍是动作发生的卡片。
 */
function edgeFor(
  s: SimState,
  type: ExampleAction["type"],
  label: string,
  detail: string,
  fight: FightPlan | null,
  after: SimState = s,
): Edge {
  return {
    label,
    fight,
    action: {
      type,
      stepId: s.stepId,
      label,
      detail,
      stockAfter: stockToObject(after.stock),
      caughtAfter: after.catches,
      releasedAfter: after.releases,
    },
  };
}

function isCompleteStep(step: TrialStep | undefined) {
  return step?.kind === "complete";
}

/**
 * 状态空间搜索：key 包含步骤、该步进度、逐项库存、背包、捕获/放流数与已领补给，
 * 因此库存不同的同一步不会被合并；回退只改变步骤，不返还饵料。
 */
function search(
  version: TrialVersion,
  steps: Map<string, TrialStep>,
  stateCap = STATE_CAP,
): SearchResult {
  const start: SimState = {
    stepId: version.startStepId,
    prog: 0,
    stock: stockToArray(version.initial.stock),
    bag: {},
    catches: 0,
    releases: 0,
    supplies: [],
  };
  const states: SimState[] = [];
  const parents: (number | null)[] = [];
  const incoming: (Edge | null)[] = [];
  const keyToIndex = new Map<string, number>();
  const blocked: SearchResult["blocked"] = [];
  const blockedIndex = new Map<string, number>();
  const stack: number[] = [];

  function noteBlocked(
    s: SimState,
    key: string,
    title: string,
    detail: string,
  ) {
    const fullKey = `${s.stepId}::${key}`;
    const existing = blockedIndex.get(fullKey);
    const better =
      !existing ||
      s.catches > blocked[existing].best.catches ||
      (s.catches === blocked[existing].best.catches &&
        s.stock.reduce((a, b) => a + b, 0) >
          blocked[existing].best.stock.reduce((a, b) => a + b, 0));
    const entry = {
      stepId: s.stepId,
      key,
      title,
      detail,
      best: cloneState(s),
    };
    if (existing === undefined) {
      blockedIndex.set(fullKey, blocked.length);
      blocked.push(entry);
    } else if (better) {
      blocked[existing] = entry;
    }
  }

  function push(state: SimState, from: number, edge: Edge | null) {
    const key = stateKey(state);
    if (keyToIndex.has(key)) return;
    keyToIndex.set(key, states.length);
    states.push(state);
    parents.push(from);
    incoming.push(edge);
    stack.push(states.length - 1);
  }

  push(start, -1, null);
  let stoppedAtComplete = false;
  let hitCap = false;

  while (stack.length) {
    if (states.length >= stateCap) {
      hitCap = true;
      break;
    }
    const index = stack.pop()!;
    const s = states[index];
    const step = steps.get(s.stepId);
    if (!step) continue;
    if (step.kind === "complete") {
      stoppedAtComplete = true;
      break;
    }

    // 回退：只回到上一张卡，不返还任何已花饵料，也不恢复已领补给。
    if (step.backTo) {
      const next = cloneState(s);
      next.stepId = step.backTo;
      next.prog = 0;
      const target = steps.get(step.backTo);
      push(
        next,
        index,
        edgeFor(
          s,
          "back",
          `回到上一步：${target?.title ?? step.backTo}`,
          "重新选择不会返还已花掉的鱼饵，目标卡需要重新完成。",
          null,
          next,
        ),
      );
    }

    if (step.kind === "bait") {
      let any = false;
      for (const option of step.options) {
        const slot = BAIT_IDS.indexOf(option);
        if (slot < 0 || s.stock[slot] < 1) continue;
        any = true;
        const next = cloneState(s);
        next.stepId = step.next;
        next.prog = 0;
        push(
          next,
          index,
          edgeFor(
            s,
            "bait",
            `选用${baitName(option)}`,
            `第「${step.title}」步选定鱼饵；换饵不消耗库存，下竿才扣 1 份。`,
            null,
            next,
          ),
        );
      }
      if (!any)
        noteBlocked(
          s,
          "bait-empty",
          "选饵卡没有可用的鱼饵",
          `当时库存为 ${stockLabel(s)}，选项中的鱼饵都已用尽。`,
        );
      continue;
    }

    if (step.kind === "branch") {
      let any = false;
      const failures: string[] = [];
      for (const option of step.options) {
        const fail = conditionFailure(version, s, option);
        if (fail) {
          failures.push(`「${option.label}」${fail}`);
          continue;
        }
        any = true;
        const next = cloneState(s);
        next.stepId = option.to;
        next.prog = 0;
        push(
          next,
          index,
          edgeFor(
            s,
            "branch",
            `选择分支：${option.label}`,
            `第「${step.title}」步二选一。`,
            null,
            next,
          ),
        );
      }
      if (!any)
        noteBlocked(
          s,
          "branch-blocked",
          "两个分支都无法选择",
          `当时 ${failures.join("；")}；库存 ${stockLabel(s)}，累计捕获 ${s.catches} 尾。`,
        );
      continue;
    }

    if (step.kind === "catch" || step.kind === "strike") {
      const card = step as CaptureCard;
      if (s.prog < card.targetCount) {
        const fish = fishCatalog.find((f) => f.id === card.encounter);
        const solution = fish ? fightSolution(card.encounter) : null;
        const windowOk = step.kind !== "strike" || step.biteWindow > 0;
        const unlocked = isUnlocked(version, s, card.spot);
        // 固定要求时只能用指定的饵；否则优先沿用起始鱼饵，减少示例里的换饵动作。
        const preferred = version.initial.bait;
        const candidates = card.bait
          ? [card.bait]
          : BAIT_IDS.filter((id) => s.stock[BAIT_IDS.indexOf(id)] > 0).sort(
              (a, b) =>
                Number(b === preferred) - Number(a === preferred),
            );
        let any = false;
        for (const bait of candidates) {
          const slot = BAIT_IDS.indexOf(bait);
          if (slot < 0 || s.stock[slot] < 1) continue;
          if (!unlocked || !solution || !windowOk) continue;
          any = true;
          const next = cloneState(s);
          next.stock[slot] -= 1;
          next.bag[bagKey(card.encounter, card.spot)] =
            (next.bag[bagKey(card.encounter, card.spot)] ?? 0) + 1;
          next.catches += 1;
          next.prog += 1;
          const strikePart =
            step.kind === "strike"
              ? `；咬钩后 ${(card as StrikeCard).biteWindow} 秒内提竿`
              : "";
          const switchNote = card.bait
            ? `先换上${baitName(bait)}（换饵不消耗），再`
            : "";
          const detail = `${switchNote}在${spotName(card.spot)}用${baitName(bait)}下竿（扣 1 份），固定遭遇${fishName(card.encounter)}${strikePart}；搏鱼力度 ${solution?.power.toFixed(2)}、泄力 ${solution?.drag.toFixed(2)}，约 ${solution?.seconds} 秒。`;
          push(
            next,
            index,
            edgeFor(
              s,
              "cast",
              `下竿：${spotName(card.spot)} / ${baitName(bait)} / ${fishName(card.encounter)}${card.targetCount > 1 ? `（${s.prog + 1}/${card.targetCount}）` : ""}`,
              detail,
              solution
                ? {
                    stepId: card.id,
                    fish: card.encounter,
                    power: solution.power,
                    drag: solution.drag,
                    seconds: solution.seconds,
                    note:
                      step.kind === "strike"
                        ? `看到咬钩后 ${(card as StrikeCard).biteWindow} 秒内提竿，再按正式规则收线。`
                        : "按正式搏鱼规则收线；张力过高时松手。",
                  }
                : null,
              next,
            ),
          );
        }
        if (!any) {
          if (!unlocked)
            noteBlocked(
              s,
              "spot-locked",
              "水域尚未解锁",
              `${spotName(card.spot)}需要累计捕获 ${unlockRequirement(card.spot)} 尾，或写入起始已解锁水域；当时累计捕获 ${s.catches} 尾。`,
            );
          else if (candidates.length === 0)
            noteBlocked(
              s,
              "bait-empty",
              "没有可用的鱼饵",
              `第「${step.title}」步要求下竿，但库存 ${stockLabel(s)} 已空。`,
            );
          else if (card.bait && s.stock[BAIT_IDS.indexOf(card.bait)] < 1)
            noteBlocked(
              s,
              "bait-locked",
              "指定鱼饵已用尽",
              `第「${step.title}」步必须使用${baitName(card.bait)}，但当时库存为 ${stockLabel(s)}；阶段补给无法回溯补上这一次消耗。`,
            );
          else if (!solution)
            noteBlocked(
              s,
              "fight-impossible",
              "固定遭遇无法收上岸",
              `${fishName(card.encounter)}在正式搏鱼规则下没有任何力度/泄力组合能在 55 秒内收上岸。`,
            );
          else if (!windowOk)
            noteBlocked(
              s,
              "window-zero",
              "提竿窗口为零",
              `限时提竿设为 ${step.kind === "strike" ? (step as StrikeCard).biteWindow : 0} 秒，任何操作都无法提竿成功。`,
            );
        }
        continue;
      }
      // 捕获目标已完成：进入下一步。
      const next = cloneState(s);
      next.stepId = step.next;
      next.prog = 0;
      push(
        next,
        index,
        edgeFor(
          s,
          "advance",
          "捕获目标完成，进入下一步",
          `第「${step.title}」步完成。`,
          null,
          next,
        ),
      );
      continue;
    }

    if (step.kind === "release") {
      const card = step as ReleaseCard;
      if (s.prog >= card.targetCount) {
        const next = cloneState(s);
        next.stepId = card.next;
        next.prog = 0;
        push(
          next,
          index,
          edgeFor(
            s,
            "advance",
            `进入下一步`,
            `第「${step.title}」步完成。`,
            null,
            next,
          ),
        );
        continue;
      }
      const keys = Object.keys(s.bag)
        .filter((k) => (s.bag[k] ?? 0) > 0)
        .filter((k) => {
          const [fish, spot] = k.split(BAG_KEY_SEP);
          if (card.targetFish && fish !== card.targetFish) return false;
          if (card.targetSpot && spot !== card.targetSpot) return false;
          return true;
        })
        .sort();
      if (keys.length === 0) {
        const need: string[] = [];
        if (card.targetFish) need.push(fishName(card.targetFish));
        if (card.targetSpot) need.push(`来自${spotName(card.targetSpot)}`);
        noteBlocked(
          s,
          "release-empty",
          "背包里没有可放流的鱼",
          `第「${step.title}」步要求放流${need.length ? need.join("、") : "任意一尾"}，但背包为空或没有符合条件的鱼。`,
        );
      }
      for (const key of keys) {
        const next = cloneState(s);
        next.bag[key] -= 1;
        if (next.bag[key] === 0) delete next.bag[key];
        next.releases += 1;
        next.prog += 1;
        push(
          next,
          index,
          edgeFor(
            s,
            "release",
            `放流：${bagLabel(key)}${card.targetCount > 1 ? `（${s.prog + 1}/${card.targetCount}）` : ""}`,
            `第「${step.title}」步的实际选择；放流不返还鱼饵。`,
            null,
            next,
          ),
        );
      }
      continue;
    }

    if (step.kind === "supply") {
      // 先入栈“不领取直接继续”，再入栈“领取补给”。DFS 后进先出，
      // 因此示例会优先演示领取一次补给，而不是无声地跳过它。
      const alreadyClaimed = s.supplies.includes(step.id);
      const skipped = cloneState(s);
      skipped.stepId = step.next;
      skipped.prog = 0;
      const skippedEdge = edgeFor(
        s,
        "advance",
        alreadyClaimed ? "补给已领，继续下一步" : "不领取补给，继续下一步",
        alreadyClaimed
          ? `第「${step.title}」步的补给已领取，直接进入下一步。`
          : `第「${step.title}」步的补给留在原地；之后回退也不能补领。`,
        null,
        skipped,
      );
      // 先入栈“不领取继续”，再入栈“领取补给”。DFS 后进先出，
      // 示例因此会走一次领取路径，而不是无声地跳过补给。
      push(skipped, index, skippedEdge);
      if (!alreadyClaimed) {
        const next = cloneState(s);
        for (const bait of BAIT_IDS)
          next.stock[BAIT_IDS.indexOf(bait)] += step.grant[bait];
        next.supplies = [...next.supplies, step.id];
        push(
          next,
          index,
          edgeFor(
            s,
            "supply",
            `领取阶段补给：${formatStock(step.grant)}`,
            `第「${step.title}」步的补给每份课程只能领取一次；之后回退也不能再领。`,
            null,
            next,
          ),
        );
      }
      continue;
    }

  }

  // exhaustive 仅表示“确实把所有可达状态都走完了”；找到终点或触顶都不算。
  return {
    exhaustive: !stoppedAtComplete && !hitCap,
    capHit: hitCap,
    states,
    parents,
    incoming,
    blocked,
  };
}

function buildExample(
  result: SearchResult,
  endIndex: number,
  _steps: Map<string, TrialStep>,
): ExamplePath {
  const chain: Edge[] = [];
  let cursor: number | null = endIndex;
  while (cursor !== null && cursor >= 0) {
    const edge = result.incoming[cursor];
    if (edge) chain.push(edge);
    cursor = result.parents[cursor];
  }
  chain.reverse();
  const actions = chain.map((e) => e.action);
  const last = result.states[endIndex];
  const fightPlans: FightPlan[] = [];
  for (const edge of chain)
    if (edge.fight && !fightPlans.some((p) => p.stepId === edge.fight?.stepId))
      fightPlans.push(edge.fight);
  return {
    actions,
    finalStock: stockToObject(last.stock),
    catches: last.catches,
    releases: last.releases,
    fightPlans,
  };
}

function structuralReach(version: TrialVersion, steps: Map<string, TrialStep>) {
  const seen = new Set<string>();
  const queue = [version.startStepId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const step = steps.get(id);
    if (!step) continue;
    if (step.kind === "bait") queue.push(step.next);
    else if (step.kind === "branch")
      for (const option of step.options) queue.push(option.to);
    else if (step.kind === "complete") continue;
    else queue.push(step.next);
  }
  return seen;
}

function staticChecks(
  version: TrialVersion,
  steps: Map<string, TrialStep>,
): TrialConflict[] {
  const conflicts: TrialConflict[] = [];
  const add = (
    severity: TrialConflict["severity"],
    stepId: string | null,
    title: string,
    detail: string,
  ) => conflicts.push({ severity, stepId, title, detail });

  if (version.steps.length === 0) {
    add("error", null, "课程没有步骤", "至少需要一张结业卡，才能验证完成路径。");
    return conflicts;
  }
  if (!steps.has(version.startStepId))
    add(
      "error",
      null,
      "起始步骤不存在",
      `课程起点指向「${version.startStepId}」，但步骤列表里没有这张卡。`,
    );

  const seen = new Set<string>();
  for (const step of version.steps) {
    if (seen.has(step.id))
      add("error", step.id, "步骤编号重复", `编号「${step.id}」被多张卡使用，状态无法区分。`);
    seen.add(step.id);
  }

  const ref = (stepId: string, fromId: string, label: string) => {
    if (!steps.has(stepId))
      add(
        "error",
        fromId,
        "引用了不存在的步骤",
        `${label}指向「${stepId}」，但步骤列表里没有这张卡。`,
      );
  };

  let completeCount = 0;
  for (const step of version.steps) {
    if (step.backTo) ref(step.backTo, step.id, "上一步");
    if (step.kind === "complete") completeCount += 1;
    else if (step.kind === "branch") {
      if (step.options.length !== 2)
        add("error", step.id, "二选一分支必须正好两个选项", `当前有 ${step.options.length} 个选项。`);
      for (const option of step.options) {
        ref(option.to, step.id, `分支「${option.label}」`);
        if (option.requires?.kind === "stock" && option.requires.min < 0)
          add("error", step.id, "分支库存条件无效", `「${option.label}」要求负数库存。`);
        if (option.requires?.kind === "landed" && option.requires.min < 0)
          add("error", step.id, "分支捕获条件无效", `「${option.label}」要求负数捕获。`);
      }
      if (step.options[0] && step.options[0].to === step.options[1]?.to)
        add(
          "warning",
          step.id,
          "两个分支通向同一张卡",
          "二选一在流程上没有区别，新手体验不到分支差异。",
        );
    } else ref(step.next, step.id, step.kind === "release" ? "下一张卡" : "下一步");

    if (step.kind === "bait") {
      if (step.options.length === 0)
        add("error", step.id, "选饵卡没有选项", "新手将无饵可选。");
      const dup = step.options.filter((b, i) => step.options.indexOf(b) !== i);
      if (dup.length)
        add("warning", step.id, "选饵选项重复", `重复的鱼饵：${dup.join("、")}。`);
    }
    if (step.kind === "supply") {
      let any = false;
      let bad = false;
      for (const bait of BAIT_IDS) {
        if (step.grant[bait] < 0) bad = true;
        if (step.grant[bait] > 0) any = true;
      }
      if (bad) add("error", step.id, "补给数量为负", "补给只能增加鱼饵。");
      if (!any) add("warning", step.id, "阶段补给为空", "这张卡不会提供任何鱼饵。");
    }
    if (step.kind === "catch" || step.kind === "strike") {
      if (step.targetCount < 1)
        add("error", step.id, "捕获目标无效", "需要至少捕获 1 尾。");
      if (step.retries < 0)
        add("error", step.id, "重试次数为负", "重试次数不能小于 0。");
      const fish = fishCatalog.find((f) => f.id === step.encounter);
      if (!fish)
        add("error", step.id, "固定遭遇不存在", `鱼类「${step.encounter}」不在图鉴里。`);
      else {
        if (!step.spot || !SPOT_IDS.includes(step.spot))
          add("error", step.id, "钓点无效", `钓点「${step.spot}」不存在。`);
        else {
          if (!fish.waters.includes(step.spot))
            add(
              "warning",
              step.id,
              "固定遭遇与水域栖息地不符",
              `${fishName(fish.id)}在图鉴中不出没于${spotName(step.spot)}；固定遭遇允许这样做，但会与正式图鉴不一致。`,
            );
          if (step.bait && !fish.baits.includes(step.bait))
            add(
              "warning",
              step.id,
              "固定遭遇与鱼饵偏好不符",
              `${fishName(fish.id)}在图鉴中不咬${baitName(step.bait)}；固定遭遇允许这样做，但教学示例可能误导新手。`,
            );
        }
        if (step.bait && !BAIT_IDS.includes(step.bait))
          add("error", step.id, "指定鱼饵无效", `鱼饵「${step.bait}」不存在。`);
        if (!fightSolution(step.encounter))
          add(
            "error",
            step.id,
            "固定遭遇无法收上岸",
            `${fishName(step.encounter)}在正式搏鱼规则下（力度与泄力均可调）没有任何组合能在 55 秒内收上岸，因此这一步无法完成。`,
          );
      }
      if (step.kind === "strike") {
        if (!((step as StrikeCard).biteWindow > 0))
          add("error", step.id, "限时提竿窗口无效", "窗口必须大于 0 秒。");
        else if ((step as StrikeCard).biteWindow < 1.5)
          add(
            "warning",
            step.id,
            "限时提竿窗口过短",
            `${(step as StrikeCard).biteWindow} 秒对新手过于苛刻，示例仍可在规则内完成，但体验可能很差。`,
          );
        else if ((step as StrikeCard).biteWindow > 10)
          add(
            "warning",
            step.id,
            "限时提竿窗口过宽",
            `${(step as StrikeCard).biteWindow} 秒几乎没有限时压力，可能达不到教学目的。`,
          );
      }
    }
    if (step.kind === "release") {
      if (step.targetCount < 1)
        add("error", step.id, "放流目标无效", "需要至少放流 1 尾。");
      if (step.targetFish && !FISH_IDS.includes(step.targetFish))
        add("error", step.id, "放流目标鱼无效", `鱼类「${step.targetFish}」不存在。`);
      if (step.targetSpot && !SPOT_IDS.includes(step.targetSpot))
        add("error", step.id, "放流目标水域无效", `水域「${step.targetSpot}」不存在。`);
    }
    if (step.kind === "complete" && step.id !== version.startStepId && !step.backTo)
      add(
        "warning",
        step.id,
        "结业卡无法回退",
        "若希望学员回看上一张卡，可以为结业卡设置上一步。",
      );
  }

  if (completeCount === 0)
    add("error", null, "没有结业步骤", "课程必须包含一张结业卡，否则没有完成终点。");

  const reachable = structuralReach(version, steps);
  for (const step of version.steps)
    if (!reachable.has(step.id))
      add(
        "warning",
        step.id,
        "步骤未连接到起点",
        `从「${version.startStepId}」出发无法通过连线到达这一步；它既不会被验收，也可能藏着冲突。`,
      );

  const initialBad = BAIT_IDS.filter((b) => !Number.isInteger(version.initial.stock[b]) || version.initial.stock[b] < 0);
  if (initialBad.length)
    add("error", null, "起始库存无效", `以下鱼饵数量不是非负整数：${initialBad.join("、")}。`);
  if (version.initial.unlocked.some((s) => !SPOT_IDS.includes(s)))
    add("error", null, "起始解锁水域无效", "起始已解锁列表包含不存在的水域。");
  if (!version.badge.name.trim())
    add("warning", null, "毕业徽章没有名称", "通关后无法向学员展示徽章名称。");
  return conflicts;
}

export function validateTrial(
  version: TrialVersion,
  options: { stateCap?: number } = {},
): ValidationReport {
  const checkedAt = Date.now();
  const contentHash = versionHash(version);
  const steps = new Map(version.steps.map((s) => [s.id, s]));
  const conflicts = staticChecks(version, steps);
  const result = search(version, steps, options.stateCap);
  const startMissing = !steps.has(version.startStepId);
  const completeIndex = result.states.findIndex((s) =>
    isCompleteStep(steps.get(s.stepId)),
  );
  const example =
    completeIndex >= 0 ? buildExample(result, completeIndex, steps) : null;

  let status: ValidationStatus;
  let message: string;

  if (startMissing) {
    status = "unsolvable";
    message = "起始步骤不存在，无法开始验证完成路径。";
  } else if (example) {
    status = "solvable";
    message = result.exhaustive
      ? `已穷尽 ${result.states.length} 个可达状态，存在一条可操作完成路径。`
      : `搜索到第 ${result.states.length} 个状态时找到了完成路径；该路径已逐步校验。`;
  } else if (!result.exhaustive) {
    status = "incomplete";
    message = `搜索达到 ${result.states.length} 个状态上限仍未找到完成路径；这不代表无解，请先简化课程或收紧库存后再验证。`;
  } else {
    status = "unsolvable";
    message = `已穷尽 ${result.states.length} 个可达状态，在给定库存与已解锁水域下无法到达结业步骤。`;
  }

  const finalConflicts = conflicts.filter((c) => c.severity === "error");
  if (status === "unsolvable") {
    for (const block of result.blocked) {
      finalConflicts.push({
        severity: "error",
        stepId: block.stepId,
        title: block.title,
        detail: `${block.detail}（可达到的最佳资源状态：${stockLabel(block.best)}，累计捕获 ${block.best.catches} 尾、放流 ${block.best.releases} 尾）`,
      });
    }
    if (finalConflicts.length === 0)
      finalConflicts.push({
        severity: "error",
        stepId: null,
        title: "没有完成路径",
        detail:
          "从起点到结业的每条路径都在资源或步骤连线上中断；请检查起始库存、阶段补给位置和分支条件。",
      });
  } else {
    for (const block of result.blocked) {
      finalConflicts.push({
        severity: "warning",
        stepId: block.stepId,
        title: block.title,
        detail: `${block.detail}（这只是在部分资源状态下卡住，当前课程仍有完成路径）`,
      });
    }
  }

  if (status === "incomplete")
    finalConflicts.push({
      severity: "warning",
      stepId: null,
      title: "验证未穷尽",
      detail:
        "搜索达到状态上限，未证明存在或不存在完成路径；不得据此判定为无解。",
    });

  const deduped: TrialConflict[] = [];
  const seen = new Set<string>();
  for (const c of finalConflicts) {
    const key = `${c.severity}|${c.stepId}|${c.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  return {
    status,
    checkedAt,
    contentHash,
    stateCount: result.states.length,
    exhaustive: result.exhaustive,
    message:
      status === "incomplete"
        ? message
        : `${message}${deduped.some((c) => c.severity === "warning") ? ` 另有 ${deduped.filter((c) => c.severity === "warning").length} 条提醒。` : ""}`,
    conflicts: deduped,
    example,
  };
}

export function versionIsValid(version: TrialVersion | null): boolean {
  return (
    !!version &&
    version.validation !== null &&
    version.validation.contentHash === versionHash(version) &&
    version.validation.status === "solvable" &&
    version.validation.example !== null
  );
}

export { baitName, bagLabel, stockToObject };
