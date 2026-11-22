import type { TrialLibrary, TrialVersion } from "../model/types";
import { emptyLibrary } from "../model/definition";

const key = "stillwater-trials-v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validVersion(value: unknown): value is TrialVersion {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.number === "number" &&
    typeof value.title === "string" &&
    Array.isArray(value.steps) &&
    isRecord(value.initial) &&
    isRecord(value.badge)
  );
}

function validLibrary(value: unknown): value is TrialLibrary {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  const trial = value.trial;
  if (!isRecord(trial)) return false;
  if (!validVersion(trial.draft)) return false;
  if (!Array.isArray(trial.versions) || !trial.versions.every(validVersion))
    return false;
  if (!Array.isArray(value.attempts)) return false;
  if (!Array.isArray(value.badges)) return false;
  return value.attempts.every(
    (a) =>
      isRecord(a) &&
      typeof a.id === "string" &&
      typeof a.versionId === "string" &&
      typeof a.stepId === "string" &&
      isRecord(a.stock) &&
      Array.isArray(a.bag) &&
      Array.isArray(a.failures) &&
      Array.isArray(a.choices),
  );
}

export function loadTrials(): { library: TrialLibrary; notice: string } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { library: emptyLibrary(), notice: "" };
    const parsed: unknown = JSON.parse(raw);
    if (!validLibrary(parsed))
      return {
        library: emptyLibrary(),
        notice: "本地教学试炼记录格式无法读取，已重置为示例课程。",
      };
    return {
      library: { ...parsed, lastAttemptId: parsed.lastAttemptId ?? null },
      notice: "",
    };
  } catch {
    return {
      library: emptyLibrary(),
      notice: "无法读取本地教学试炼记录，本次试玩不会自动保存。",
    };
  }
}

export function saveTrials(library: TrialLibrary): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
}

export { key as trialStorageKey };
