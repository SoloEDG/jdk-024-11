import type {
  Trial,
  TrialAttempt,
  TrialBadgeRecord,
  TrialLibrary,
  TrialVersion,
  ValidationReport,
} from "../model/types";
import {
  cloneVersion,
  nextVersionNumber,
  versionHash,
} from "../model/definition";
import { versionIsValid } from "./validate";

export interface PublishResult {
  library: TrialLibrary;
  ok: boolean;
  message: string;
}



/**
 * 发布草稿为新版本。要求：草稿已通过“可完成”验证，且验证指纹与当前草稿一致。
 * 已开始的学员保留其 attempt.versionId，继续沿原课程版本进行。
 */
export function publishTrial(
  library: TrialLibrary,
  now = Date.now(),
): PublishResult {
  const trial = library.trial;
  const draft = trial.draft;
  if (!draft.validation || draft.validation.contentHash !== versionHash(draft))
    return {
      library,
      ok: false,
      message: "课程在最近一次验证后被修改，请先重新验证再发布。",
    };
  if (draft.validation.status !== "solvable" || !draft.validation.example)
    return {
      library,
      ok: false,
      message:
        draft.validation.status === "unsolvable"
          ? "验证发现该课程无法完成，不能发布。"
          : "验证未穷尽，不能把“尚未找到”当作“可完成”发布。",
    };
  const number = nextVersionNumber(trial);
  const snapshot: TrialVersion = {
    ...cloneVersion(draft),
    id: `v${number}-${now.toString(36)}`,
    number,
    createdAt: now,
  };
  const nextTrial: Trial = {
    ...trial,
    versions: [...trial.versions, snapshot],
    activeVersionId: snapshot.id,
    updatedAt: now,
  };
  return {
    library: { ...library, trial: nextTrial },
    ok: true,
    message: `已发布第 ${number} 版。已开始的学员继续沿原版本练习，新学员使用这一版。`,
  };
}

/** 仅用于把当前草稿标记为验证结果；不改动任何已发布版本或进行中的试玩。 */
export function attachValidation(
  library: TrialLibrary,
  report: ValidationReport,
): TrialLibrary {
  return {
    ...library,
    trial: {
      ...library.trial,
      draft: { ...library.trial.draft, validation: report },
      updatedAt: Date.now(),
    },
  };
}

export function bumpDraft(
  library: TrialLibrary,
  mutate: (draft: TrialVersion) => TrialVersion,
): TrialLibrary {
  const trial = library.trial;
  const draft = mutate({ ...cloneVersion(trial.draft), validation: null });
  return {
    ...library,
    trial: { ...trial, draft, updatedAt: Date.now() },
  };
}

export function versionForAttempt(
  library: TrialLibrary,
  attempt: TrialAttempt,
): TrialVersion | null {
  const trial = library.trial;
  // 预览绑定开始时的草稿内容；若草稿已改，模板不再视为当前尝试的版本。
  if (attempt.versionId === trial.draft.id) return trial.draft;
  return trial.versions.find((v) => v.id === attempt.versionId) ?? null;
}

/** 预览是否仍与开始时的草稿一致。 */
export function previewMatchesDraft(
  library: TrialLibrary,
  attempt: TrialAttempt,
) {
  if (!attempt.preview || attempt.versionId !== library.trial.draft.id)
    return true;
  return versionHash(library.trial.draft) === attempt.versionHash;
}

/** 编辑草稿时，把失效的预览标记为放弃（正式试玩不受影响）。 */
export function abandonStalePreviews(library: TrialLibrary): TrialLibrary {
  const stale = library.attempts.some(
    (a) =>
      a.preview &&
      a.status === "active" &&
      !previewMatchesDraft(library, a),
  );
  if (!stale) return library;
  return {
    ...library,
    attempts: library.attempts.map((a) =>
      a.preview &&
      a.status === "active" &&
      !previewMatchesDraft(library, a)
        ? { ...a, status: "abandoned", updatedAt: Date.now() }
        : a,
    ),
  };
}

/**
 * 结业时判定毕业徽章：
 * - 必须是非预览、状态为 completed 的完整通关；
 * - 所沿用的课程版本在结业时仍是“有效版本”（发布过且验证有效）；
 * - 同一课程只发一次。
 */
export function grantBadgeOnCompletion(
  library: TrialLibrary,
  attempt: TrialAttempt,
  now = Date.now(),
): { library: TrialLibrary; granted: boolean; reason: string } {
  if (attempt.preview)
    return { library, granted: false, reason: "试玩预览不发放毕业徽章。" };
  if (attempt.status !== "completed")
    return { library, granted: false, reason: "尚未完成试玩。" };
  const version = versionForAttempt(library, attempt);
  if (!version)
    return { library, granted: false, reason: "找不到这次试玩对应的课程版本。" };
  const published = library.trial.versions.some((v) => v.id === version.id);
  if (!published)
    return {
      library,
      granted: false,
      reason: "这次试玩来自尚未发布的草稿，不能领取毕业徽章。",
    };
  if (!versionIsValid(version))
    return {
      library,
      granted: false,
      reason: "所沿用的课程版本已被判定为无效，无法领取毕业徽章。",
    };
  if (library.badges.some((b) => b.trialId === library.trial.id))
    return { library, granted: false, reason: "毕业徽章已经领取过，不会重复发放。" };
  const record: TrialBadgeRecord = {
    trialId: library.trial.id,
    versionId: version.id,
    versionNumber: version.number,
    attemptId: attempt.id,
    earnedAt: now,
  };
  return {
    library: {
      ...library,
      badges: [...library.badges, record],
      attempts: library.attempts.map((a) =>
        a.id === attempt.id
          ? { ...a, completedVersionValid: true }
          : a,
      ),
    },
    granted: true,
    reason: `已领取毕业徽章「${version.badge.name}」。`,
  };
}

/**
 * 徽章的“唯一来源”：该课程是否已有一枚有效通关徽章。
 * 版本有效性在每次读取时复核，因此课程被标记失效不会遗留旧徽章。
 */
export function badgeFor(library: TrialLibrary) {
  const record =
    library.badges.find((b) => b.trialId === library.trial.id) ?? null;
  if (!record) return null;
  const version = library.trial.versions.find((v) => v.id === record.versionId);
  if (!version || !versionIsValid(version)) return null;
  return record;
}

export function attemptUsesActiveVersion(
  library: TrialLibrary,
  attempt: TrialAttempt,
) {
  return attempt.versionId === library.trial.activeVersionId;
}

export function updateAttempt(
  library: TrialLibrary,
  attempt: TrialAttempt,
): TrialLibrary {
  return {
    ...library,
    attempts: library.attempts.some((a) => a.id === attempt.id)
      ? library.attempts.map((a) => (a.id === attempt.id ? attempt : a))
      : [attempt, ...library.attempts],
  };
}

export function findAttempt(library: TrialLibrary, id: string | null) {
  return id ? library.attempts.find((a) => a.id === id) ?? null : null;
}
