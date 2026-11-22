import type { BaitId, FishId, SpotId } from "../../../shared/types";
import { species } from "../../../shared/catalog";
import { water } from "../../waters/model/waters";
import { baits } from "../../tackle/model/baits";

export function fishName(id: FishId) {
  return species(id).name;
}

export function spotName(id: SpotId) {
  return water(id).name;
}

export function baitName(id: BaitId) {
  return baits.find((b) => b.id === id)?.name ?? id;
}

export function fishRarity(id: FishId) {
  return species(id).rarity;
}
