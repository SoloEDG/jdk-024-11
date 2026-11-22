import type { FishId, Session } from "../../../shared/types";
import { fishCatalog, species } from "../../../shared/catalog";
import { fightStep } from "../../fishing/lib/physics";

const DT = 0.05;

export interface FightSolution {
  power: number;
  drag: number;
  seconds: number;
}

const cache = new Map<string, FightSolution | null>();

function simulate(fish: FishId, power: number, drag: number): number | null {
  let s: Session = {
    id: "sim",
    phase: "fighting",
    clock: 0,
    charge: 0,
    castPower: 0,
    spot: "reed",
    bait: "worm",
    fish,
    weight: 1,
    biteAt: 0,
    progress: 0,
    tension: 0.35,
    energy: 1,
    slackTime: 0,
    overload: 0,
    peak: 0,
    reeling: false,
    duration: 0,
    message: "",
  };
  const target = species(fish);
  for (let t = 0; t < 60; t += DT) {
    s = {
      ...s,
      reeling: s.tension > 0.8 ? false : s.tension < 0.52 ? true : s.reeling,
    };
    s = fightStep(s, { power, drag }, target, DT);
    if (s.phase === "landed") return s.duration;
    if (s.phase === "escaped") return null;
  }
  return null;
}

/**
 * 在正式搏鱼规则下寻找能把固定遭遇收上岸的力度/泄力组合。
 * 教学试炼允许玩家自调力度与泄力，只要存在一条操作路径即为可完成。
 */
export function fightSolution(fish: FishId): FightSolution | null {
  if (cache.has(fish)) return cache.get(fish) ?? null;
  if (!fishCatalog.some((f) => f.id === fish)) {
    cache.set(fish, null);
    return null;
  }
  let best: FightSolution | null = null;
  for (let power = 0.15; power <= 0.951; power += 0.05) {
    for (let drag = 0.15; drag <= 0.951; drag += 0.05) {
      const seconds = simulate(fish, power, drag);
      if (seconds !== null && (!best || seconds < best.seconds))
        best = {
          power: Math.round(power * 100) / 100,
          drag: Math.round(drag * 100) / 100,
          seconds: Math.round(seconds * 10) / 10,
        };
    }
  }
  cache.set(fish, best);
  return best;
}

export const solverNote =
  "示例中的搏鱼按正式物理逐步模拟；力度与泄力在试玩中可调，因此只要存在一组可行设置即可通关。";
