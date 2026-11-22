import type {
  BaitId,
  BaitStock,
  FishId,
  SpotId,
} from "../../../shared/types";
import type {
  BranchCard,
  CatchCard,
  CompleteCard,
  ReleaseCard,
  StrikeCard,
  SupplyCard,
  Trial,
  TrialLibrary,
  TrialStep,
  TrialVersion,
} from "./types";

export function stepLabel(step: TrialStep) {
  const names: Record<TrialStep["kind"], string> = {
    bait: "选饵",
    branch: "分支",
    catch: "捕获",
    strike: "限时提竿",
    release: "放流",
    supply: "补给",
    complete: "结业",
  };
  return `${names[step.kind]} · ${step.title}`;
}

/** 结构化、可做内容指纹的序列化：忽略对象键顺序，省略 undefined。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function hashString(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 只对影响玩法的字段做指纹；校验时间与校验结论不参与。 */
export function versionHash(
  version: Pick<
    TrialVersion,
    "title" | "summary" | "startStepId" | "initial" | "steps" | "badge"
  >,
) {
  return hashString(
    stableStringify({
      title: version.title,
      summary: version.summary,
      startStepId: version.startStepId,
      initial: version.initial,
      steps: version.steps,
      badge: version.badge,
    }),
  );
}



function stepCommon(
  id: string,
  title: string,
  instruction: string,
  backTo: string | null,
) {
  return { id, title, instruction, backTo };
}

export function createDefaultSteps(): TrialStep[] {
  const chooseBait: TrialStep = {
    ...stepCommon(
      "choose-bait",
      "挑一枚合适的饵",
      "先看看鱼饵盒。玉米能引来锦鲤；蚯蚓更均衡。",
      null,
    ),
    kind: "bait",
    options: ["corn", "worm"],
    next: "catch-carp",
  };
  const catchCarp: CatchCard = {
    ...stepCommon(
      "catch-carp",
      "在芦苇浅湾钓起锦鲤",
      "锦鲤偏爱玉米。把鱼饵换成玉米，在芦苇浅湾下一竿。",
      "choose-bait",
    ),
    kind: "catch",
    spot: "reed",
    bait: "corn",
    encounter: "carp",
    targetCount: 1,
    retries: 1,
    next: "branch-water",
  };
  const branch: BranchCard = {
    ...stepCommon(
      "branch-water",
      "今天去哪里练手？",
      "两条路都通向结业。选一条，也可以回来重选。",
      "catch-carp",
    ),
    kind: "branch",
    prompt: "去青石溪流追虹鳟，还是留在芦苇湾练限时提竿？",
    options: [
      {
        id: "brook-trout",
        label: "去青石溪流追虹鳟",
        to: "catch-trout",
        requires: { kind: "unlocked", spot: "brook" },
      },
      {
        id: "reed-perch",
        label: "留在芦苇湾练提竿",
        to: "strike-perch",
        requires: { kind: "stock", bait: "worm", min: 1 },
      },
    ],
  };
  const catchTrout: CatchCard = {
    ...stepCommon(
      "catch-trout",
      "在青石溪流钓虹鳟",
      "虹鳟在含氧充足的溪流里。用羽毛拟蝇，耐心等浮漂下沉。",
      "branch-water",
    ),
    kind: "catch",
    spot: "brook",
    bait: "fly",
    encounter: "trout",
    targetCount: 1,
    retries: 1,
    next: "supply",
  };
  const strikePerch: StrikeCard = {
    ...stepCommon(
      "strike-perch",
      "三秒内提竿",
      "河鲈咬钩很轻。看到浮漂下沉后，三秒内必须提竿。",
      "branch-water",
    ),
    kind: "strike",
    spot: "reed",
    bait: "worm",
    encounter: "perch",
    targetCount: 1,
    retries: 1,
    biteWindow: 3,
    next: "supply",
  };
  const supply: SupplyCard = {
    ...stepCommon(
      "supply",
      "领一份阶段补给",
      "课程中途只补一次：鲜活蚯蚓 ×2、羽毛拟蝇 ×1。",
      "branch-water",
    ),
    kind: "supply",
    grant: { worm: 2, corn: 0, fly: 1 },
    next: "release-catch",
  };
  const release: ReleaseCard = {
    ...stepCommon(
      "release-catch",
      "放流一尾鱼",
      "从试玩背包里挑一尾放回水里。放流也会留在教学记录里。",
      "supply",
    ),
    kind: "release",
    targetCount: 1,
    targetFish: null,
    targetSpot: null,
    next: "graduation",
  };
  const complete: CompleteCard = {
    ...stepCommon(
      "graduation",
      "完成试炼",
      "你已经走完选饵、捕获、限时提竿与放流的完整流程。",
      "release-catch",
    ),
    kind: "complete",
    badgeText: "新手引路人",
  };
  return [
    chooseBait,
    catchCarp,
    branch,
    catchTrout,
    strikePerch,
    supply,
    release,
    complete,
  ];
}

export function createDefaultVersion(now = Date.now()): TrialVersion {
  return {
    id: "draft",
    number: 0,
    createdAt: now,
    title: "第一课：读懂浮漂",
    summary:
      "从选饵开始，学会辨认固定遭遇、在限时内提竿、按正式规则搏鱼，并完成一次放流。",
    startStepId: "choose-bait",
    initial: {
      stock: { worm: 3, corn: 2, fly: 1 },
      unlocked: ["reed", "brook"],
      bait: "worm",
      power: 0.65,
      drag: 0.7,
    },
    steps: createDefaultSteps(),
    badge: {
      name: "新手引路人",
      description: "完整走完一节教学试炼，掌握选饵、提竿与放流。",
    },
    validation: null,
  };
}

export function cloneVersion(version: TrialVersion): TrialVersion {
  return JSON.parse(JSON.stringify(version)) as TrialVersion;
}

export function emptyTrial(now = Date.now()): Trial {
  const draft = createDefaultVersion(now);
  return {
    id: "trial-first-cast",
    draft,
    versions: [],
    activeVersionId: null,
    updatedAt: now,
  };
}

export function emptyLibrary(now = Date.now()): TrialLibrary {
  return {
    version: 1,
    trial: emptyTrial(now),
    attempts: [],
    badges: [],
    lastAttemptId: null,
  };
}

export function nextVersionNumber(trial: Trial) {
  return trial.versions.reduce((n, v) => Math.max(n, v.number), 0) + 1;
}

export function activeVersion(trial: Trial): TrialVersion | null {
  return (
    trial.versions.find((v) => v.id === trial.activeVersionId) ?? null
  );
}

export type { BaitId, BaitStock, FishId, SpotId };
