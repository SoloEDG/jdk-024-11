import { useCallback, useEffect, useRef, useState } from "react";
import type { TrialAttempt, TrialLibrary } from "../model/types";
import { loadTrials, saveTrials } from "../lib/storage";
import {
  abandonStalePreviews,
  grantBadgeOnCompletion,
  updateAttempt,
  versionForAttempt,
} from "../lib/versions";
import { continueAfterCapture, currentStep } from "../lib/attempt";
import type { TrialMode } from "../ui/TrialCenter";

export function useTrials() {
  const loaded = useRef<ReturnType<typeof loadTrials> | null>(null);
  if (!loaded.current) loaded.current = loadTrials();
  const [library, setLibrary] = useState<TrialLibrary>(loaded.current.library);
  const [notice, setNotice] = useState(loaded.current.notice);
  const [mode, setMode] = useState<TrialMode>({ screen: "hall" });
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    setSaved(saveTrials(library));
  }, [library]);

  const update = useCallback(
    (next: TrialLibrary, flash?: string) => {
      setLibrary(abandonStalePreviews(next));
      if (flash) setNotice(flash);
    },
    [],
  );

  /**
   * 试玩状态推进。基于最新状态做函数式更新，避免连续操作（结算 → 继续）
   * 用渲染时捕获的旧 library 互相覆盖。结业时在同一事务里结算徽章。
   */
  const advanceAttempt = useCallback(
    (attempt: TrialAttempt, flash?: string) => {
      let reason = "";
      setLibrary((prev) => {
        const withAttempt = abandonStalePreviews(
          updateAttempt({ ...prev, lastAttemptId: attempt.id }, attempt),
        );
        if (attempt.status !== "completed") return withAttempt;
        const result = grantBadgeOnCompletion(withAttempt, attempt);
        reason = result.reason;
        return result.library;
      });
      if (flash || reason) setNotice(flash ? `${flash} ${reason}` : reason);
    },
    [],
  );

  /** “继续”在最新状态上推进，避免捕获结算与点击继续之间的竞态。 */
  const continueCapture = useCallback((attemptId: string) => {
    setLibrary((prev) => {
      const attempt = prev.attempts.find((a) => a.id === attemptId);
      if (!attempt) return prev;
      const version = versionForAttempt(prev, attempt);
      if (!version) return prev;
      const step = currentStep(version, attempt);
      if (!step || (step.kind !== "catch" && step.kind !== "strike"))
        return prev;
      const next = continueAfterCapture(version, attempt);
      if (next.attempt === attempt) return prev;
      return updateAttempt(prev, next.attempt);
    });
  }, []);

  return {
    library,
    update,
    advanceAttempt,
    continueCapture,
    mode,
    setMode,
    notice,
    setNotice,
    saved,
  };
}
