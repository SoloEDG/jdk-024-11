import type { BaitId, BaitStock, FishId, SpotId } from "../../../shared/types";

export type TrialStepKind =
  | "bait"
  | "branch"
  | "catch"
  | "strike"
  | "release"
  | "supply"
  | "complete";

export interface TrialInitial {
  stock: BaitStock;
  unlocked: SpotId[];
  bait: BaitId | null;
  power: number;
  drag: number;
}

/** 二选一分支上的可执行条件；编辑器可留空表示无条件。 */
export type TrialCondition =
  | { kind: "stock"; bait: BaitId; min: number }
  | { kind: "unlocked"; spot: SpotId }
  | { kind: "landed"; min: number };

export interface BranchOption {
  id: string;
  label: string;
  to: string;
  requires?: TrialCondition | null;
}

interface StepCommon {
  id: string;
  title: string;
  instruction: string;
  /** 回到上一张卡的目标；null 表示这是课程起点。 */
  backTo: string | null;
}

export interface BaitCard extends StepCommon {
  kind: "bait";
  options: BaitId[];
  next: string;
}

export interface BranchCard extends StepCommon {
  kind: "branch";
  prompt: string;
  options: [BranchOption, BranchOption];
}

interface CaptureCardCommon extends StepCommon {
  spot: SpotId;
  /** 必须选中的鱼饵；null 表示任意已有鱼饵。 */
  bait: BaitId | null;
  /** 明示的固定遭遇；试玩中的实际搏鱼仍走正式物理。 */
  encounter: FishId;
  targetCount: number;
  /** 失败后允许重试的次数；0 表示只给一次机会。 */
  retries: number;
  next: string;
}

export interface CatchCard extends CaptureCardCommon {
  kind: "catch";
}

export interface StrikeCard extends CaptureCardCommon {
  kind: "strike";
  /** 咬钩后的限时提竿窗口（秒）。 */
  biteWindow: number;
}

export interface ReleaseCard extends StepCommon {
  kind: "release";
  targetCount: number;
  targetFish: FishId | null;
  targetSpot: SpotId | null;
  next: string;
}

export interface SupplyCard extends StepCommon {
  kind: "supply";
  grant: BaitStock;
  next: string;
}

export interface CompleteCard extends StepCommon {
  kind: "complete";
  badgeText: string;
}

export type TrialStep =
  | BaitCard
  | BranchCard
  | CatchCard
  | StrikeCard
  | ReleaseCard
  | SupplyCard
  | CompleteCard;

export type CaptureCard = CatchCard | StrikeCard;
export type CaptureCardLike = CaptureCard;

export type ConflictSeverity = "error" | "warning";

export interface TrialConflict {
  severity: ConflictSeverity;
  /** 关联的步骤；没有具体步骤时为 null。 */
  stepId: string | null;
  title: string;
  detail: string;
}

export interface ExampleAction {
  type: "back" | "bait" | "branch" | "supply" | "advance" | "cast" | "release";
  stepId: string;
  label: string;
  detail: string;
  stockAfter?: BaitStock;
  caughtAfter?: number;
  releasedAfter?: number;
}

export interface FightPlan {
  stepId: string;
  fish: FishId;
  power: number;
  drag: number;
  seconds: number;
  note: string;
}

export interface ExamplePath {
  actions: ExampleAction[];
  finalStock: BaitStock;
  catches: number;
  releases: number;
  fightPlans: FightPlan[];
}

export type ValidationStatus = "solvable" | "unsolvable" | "incomplete";

export interface ValidationReport {
  status: ValidationStatus;
  checkedAt: number;
  contentHash: string;
  stateCount: number;
  exhaustive: boolean;
  message: string;
  conflicts: TrialConflict[];
  example: ExamplePath | null;
}

export interface TrialBadge {
  name: string;
  description: string;
}

export interface TrialVersion {
  id: string;
  number: number;
  createdAt: number;
  title: string;
  summary: string;
  startStepId: string;
  initial: TrialInitial;
  steps: TrialStep[];
  badge: TrialBadge;
  validation: ValidationReport | null;
}

export interface Trial {
  id: string;
  draft: TrialVersion;
  versions: TrialVersion[];
  activeVersionId: string | null;
  updatedAt: number;
}

export interface TrialLibrary {
  version: 1;
  trial: Trial;
  attempts: TrialAttempt[];
  badges: TrialBadgeRecord[];
  /** 教师工作台最近一次打开的试玩（用于刷新后恢复，不影响徽章判定）。 */
  lastAttemptId: string | null;
}

export interface ChoiceRecord {
  at: number;
  stepId: string;
  stepTitle: string;
  choice: string;
  detail: string;
}

export interface FailureRecord {
  at: number;
  stepId: string;
  stepTitle: string;
  reason: string;
  baitSpent: BaitId | null;
}

export interface TrialBagItem {
  id: string;
  fish: FishId;
  spot: SpotId;
  bait: BaitId;
}

export interface CardProgress {
  count: number;
  failures: number;
  attempts: number;
  claimed: boolean;
}

export type AttemptStatus =
  | "active"
  | "completed"
  | "failed"
  | "abandoned"
  | "preview";

export interface PendingCast {
  stepId: string;
  bait: BaitId;
  at: number;
}

export interface TrialAttempt {
  id: string;
  trialId: string;
  versionId: string;
  versionNumber: number;
  /** 开始试玩时的内容指纹：草稿被修改后，进行中的预览立即失效。 */
  versionHash: string;
  /** 试玩草稿不产生毕业徽章，也不影响正式版本。 */
  preview: boolean;
  status: AttemptStatus;
  stepId: string;
  stock: BaitStock;
  selectedBait: BaitId | null;
  power: number;
  drag: number;
  bag: TrialBagItem[];
  /** 累计钓起数（只增不减，回退不清零），用于解锁与“累计捕获”条件。 */
  lifetimeCatches: number;
  cards: Record<string, CardProgress>;
  failures: FailureRecord[];
  choices: ChoiceRecord[];
  pendingCast: PendingCast | null;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  /** 结业时记为当时有效的版本；徽章判定会复核。 */
  completedVersionValid: boolean;
}

/** 一枚毕业徽章：记录首次达成“有效版本 + 完整通关”的那次试玩。 */
export interface TrialBadgeRecord {
  trialId: string;
  versionId: string;
  versionNumber: number;
  attemptId: string;
  earnedAt: number;
}

export const BAIT_IDS: BaitId[] = ["worm", "corn", "fly"];
export const SPOT_IDS: SpotId[] = ["reed", "brook", "deep"];
export const FISH_IDS: FishId[] = [
  "crucian",
  "perch",
  "carp",
  "trout",
  "bass",
  "pike",
];
