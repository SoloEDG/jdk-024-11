import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  GitBranch,
  GripVertical,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { BaitId, BaitStock, FishId, SpotId } from "../../../shared/types";
import { fishCatalog } from "../../../shared/catalog";
import { waters } from "../../waters/model/waters";
import { baits } from "../../tackle/model/baits";
import type {
  BranchCard,
  CaptureCard,
  CompleteCard,
  ExampleAction,
  SupplyCard,
  TrialConflict,
  TrialLibrary,
  TrialStep,
  TrialVersion,
  ValidationReport,
} from "../model/types";
import { BAIT_IDS, SPOT_IDS } from "../model/types";
import { versionHash, stepLabel } from "../model/definition";
import { baitName, fishName, spotName } from "../model/labels";

interface EditorProps {
  library: TrialLibrary;
  onDraft: (mutate: (draft: TrialVersion) => TrialVersion) => void;
  onValidate: () => void;
  onPublish: () => void;
  onBack: () => void;
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return list;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function patchStep(
  draft: TrialVersion,
  id: string,
  patch: Partial<TrialStep>,
): TrialVersion {
  return {
    ...draft,
    steps: draft.steps.map((s) =>
      s.id === id ? ({ ...s, ...patch } as TrialStep) : s,
    ),
  };
}

function newStepId(draft: TrialVersion, prefix: string) {
  let n = draft.steps.length + 1;
  while (draft.steps.some((s) => s.id === `${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

/**
 * 插入一张练习卡，并把它接进现有链路：
 * 若存在结业卡，则插在结业卡之前（让新卡成为真实流程的一步），
 * 并把原本通向结业卡的那一步改接到新卡。
 */
function insertPracticeStep(draft: TrialVersion): TrialStep[] {
  const complete = draft.steps.find((s) => s.kind === "complete");
  const insertAt = complete
    ? draft.steps.findIndex((s) => s.id === complete.id)
    : draft.steps.length;
  const baseId = newStepId(draft, "fc");
  const previous = draft.steps[insertAt - 1];
  const base: CaptureCard = {
    id: baseId,
    kind: "catch",
    title: "自由练习：钓一尾鱼",
    instruction: "用任意鱼饵在已解锁水域完成一次固定遭遇。",
    backTo: previous?.id ?? null,
    spot: draft.initial.unlocked[0] ?? "reed",
    bait: null,
    encounter: "crucian",
    targetCount: 1,
    retries: 1,
    next: complete?.id ?? baseId,
  };
  const rewired = draft.steps.map((step) => {
    if (step.id === baseId) return step;
    if (complete && step.id === complete.id)
      return { ...step, backTo: baseId };
    if (previous && step.id === previous.id && "next" in step)
      return { ...step, next: baseId };
    // 任何原本直接指向结业卡的步骤也改指向新的练习卡。
    if (complete && "next" in step && step.next === complete.id)
      return { ...step, next: baseId };
    return step;
  });
  const result = [...rewired];
  result.splice(insertAt, 0, base);
  return result;
}

export function TrialEditor({
  library,
  onDraft,
  onValidate,
  onPublish,
  onBack,
}: EditorProps) {
  const draft = library.trial.draft;
  const [openId, setOpenId] = useState<string | null>(draft.steps[0]?.id ?? null);
  const [showJson, setShowJson] = useState(false);
  const [busyCheck, setBusyCheck] = useState(false);
  const report = draft.validation;
  const stale =
    !!report && report.contentHash !== versionHash(draft);
  const active = library.trial.versions.find(
    (v) => v.id === library.trial.activeVersionId,
  );

  const stepOptions = useMemo(
    () => draft.steps.map((s) => ({ id: s.id, label: stepLabel(s) })),
    [draft.steps],
  );
  const startIsFirst = draft.startStepId === (draft.steps[0]?.id ?? "");

  function runValidation() {
    setBusyCheck(true);
    // 让浏览器先绘制“验证中”状态，再同步跑完状态搜索。
    window.setTimeout(() => {
      onValidate();
      setBusyCheck(false);
    }, 20);
  }

  return (
    <section className="trial-editor">
      <div className="trial-editor-head">
        <button className="text-btn" onClick={onBack}>
          <ArrowLeft size={13} />
          返回大厅
        </button>
        <div>
          <small>教师工作台 · 草稿</small>
          <h3>{draft.title || "未命名课程"}</h3>
        </div>
        <div className="trial-editor-actions">
          <button className="ghost" disabled={busyCheck} onClick={runValidation}>
            <ShieldCheck size={15} />
            {busyCheck ? "验证中…" : "重新验证"}
          </button>
          <button
            className="primary"
            onClick={onPublish}
            disabled={
              busyCheck ||
              stale ||
              report?.status !== "solvable" ||
              !report?.example
            }
          >
            <Send size={15} />
            发布为新版本
          </button>
        </div>
      </div>

      <p className="trial-editor-note">
        编辑后验证结论会立即失效，必须重新验证才能发布。已开始的学员会继续沿发布时
        的版本练习，发布新版不会重置他们的进度。
        {active && ` 当前线上版本：第 ${active.number} 版。`}
      </p>

      <div className="trial-editor-grid">
        <div className="trial-editor-main">
          <div className="trial-field">
            <label>
              课程名称
              <input
                value={draft.title}
                onChange={(e) =>
                  onDraft((d) => ({ ...d, title: e.target.value, validation: null }))
                }
              />
            </label>
            <label>
              课程简介
              <textarea
                value={draft.summary}
                rows={2}
                onChange={(e) =>
                  onDraft((d) => ({ ...d, summary: e.target.value, validation: null }))
                }
              />
            </label>
          </div>

          <div className="trial-field">
            <h4>起始库存（试玩独立背包）</h4>
            <div className="trial-inline">
              {BAIT_IDS.map((b) => (
                <label key={b} className="trial-mini">
                  {baitName(b)}
                  <input
                    type="number"
                    min={0}
                    value={draft.initial.stock[b]}
                    onChange={(e) => {
                      const value = Math.max(0, Math.floor(+e.target.value || 0));
                      onDraft((d) => ({
                        ...d,
                        initial: {
                          ...d.initial,
                          stock: { ...d.initial.stock, [b]: value },
                        },
                        validation: null,
                      }));
                    }}
                  />
                </label>
              ))}
            </div>
            <div className="trial-inline">
              {SPOT_IDS.map((spot) => (
                <label key={spot} className="trial-check">
                  <input
                    type="checkbox"
                    checked={draft.initial.unlocked.includes(spot)}
                    onChange={(e) =>
                      onDraft((d) => ({
                        ...d,
                        initial: {
                          ...d.initial,
                          unlocked: e.target.checked
                            ? [...new Set([...d.initial.unlocked, spot])]
                            : d.initial.unlocked.filter((s) => s !== spot),
                        },
                        validation: null,
                      }))
                    }
                  />
                  已解锁 {spotName(spot)}
                </label>
              ))}
            </div>
            <div className="trial-inline">
              <label className="trial-mini">
                起始鱼饵
                <select
                  value={draft.initial.bait ?? ""}
                  onChange={(e) =>
                    onDraft((d) => ({
                      ...d,
                      initial: {
                        ...d.initial,
                        bait: (e.target.value || null) as BaitId | null,
                      },
                      validation: null,
                    }))
                  }
                >
                  <option value="">不预选</option>
                  {BAIT_IDS.map((b) => (
                    <option key={b} value={b}>
                      {baitName(b)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="trial-mini">
                结业徽章
                <input
                  value={draft.badge.name}
                  onChange={(e) =>
                    onDraft((d) => ({
                      ...d,
                      badge: { ...d.badge, name: e.target.value },
                      validation: null,
                    }))
                  }
                />
              </label>
            </div>
          </div>

          <div className="trial-steps">
            <div className="trial-steps-head">
              <h4>步骤卡（{draft.steps.length}）</h4>
              <button
                className="text-btn"
                onClick={() =>
                  onDraft((d) => ({
                    ...d,
                    steps: insertPracticeStep(d),
                    validation: null,
                  }))
                }
              >
                <Plus size={13} />
                添加练习卡
              </button>
            </div>
            {draft.steps.map((step, index) => (
              <div
                key={step.id}
                className={"trial-step-card " + (openId === step.id ? "open" : "")}
              >
                <div className="trial-step-summary">
                  <GripVertical size={14} />
                  <button
                    className="trial-step-title"
                    onClick={() => setOpenId(openId === step.id ? null : step.id)}
                    aria-expanded={openId === step.id}
                  >
                    <strong>{stepLabel(step)}</strong>
                    <small>
                      #{index + 1} · 上一步：
                      {step.backTo ? step.backTo : "无（起点）"}
                    </small>
                  </button>
                  <div className="trial-step-tools">
                    <button
                      className="icon-btn"
                      aria-label="上移"
                      onClick={() =>
                        onDraft((d) => ({
                          ...d,
                          steps: move(d.steps, index, -1),
                          validation: null,
                        }))
                      }
                    >
                      <ArrowDown size={13} className="flip" />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="下移"
                      onClick={() =>
                        onDraft((d) => ({
                          ...d,
                          steps: move(d.steps, index, 1),
                          validation: null,
                        }))
                      }
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="删除步骤"
                      disabled={step.kind === "complete" && draft.steps.length === 1}
                      onClick={() =>
                        onDraft((d) => ({
                          ...d,
                          steps: d.steps.filter((s) => s.id !== step.id),
                          startStepId:
                            d.startStepId === step.id
                              ? (d.steps.find((s) => s.id !== step.id)?.id ?? "")
                              : d.startStepId,
                          validation: null,
                        }))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {openId === step.id && (
                  <StepForm
                    step={step}
                    stepOptions={stepOptions}
                    onStep={(patch) =>
                      onDraft((d) => ({ ...patchStep(d, step.id, patch), validation: null }))
                    }
                  />
                )}
              </div>
            ))}
          </div>

          <div className="trial-field">
            <label className="trial-check">
              <input
                type="radio"
                checked={startIsFirst}
                onChange={() =>
                  onDraft((d) => ({
                    ...d,
                    startStepId: d.steps[0]?.id ?? "",
                    validation: null,
                  }))
                }
              />
              从第一张卡开始
            </label>
            <label className="trial-mini">
              指定起点
              <select
                value={draft.startStepId}
                onChange={(e) =>
                  onDraft((d) => ({
                    ...d,
                    startStepId: e.target.value,
                    validation: null,
                  }))
                }
              >
                {stepOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button className="text-btn" onClick={() => setShowJson(!showJson)}>
            <ChevronDown size={13} />
            {showJson ? "收起" : "查看"}课程 JSON（可直接导入校验）
          </button>
          {showJson && <pre className="trial-json">{JSON.stringify(draft, null, 2)}</pre>}
        </div>

        <aside className="trial-editor-side">
          <ValidationPanel
            draft={draft}
            report={report}
            stale={stale}
            onValidate={runValidation}
            validating={busyCheck}
          />
        </aside>
      </div>
    </section>
  );
}

function StepForm({
  step,
  stepOptions,
  onStep,
}: {
  step: TrialStep;
  stepOptions: { id: string; label: string }[];
  onStep: (patch: Partial<TrialStep>) => void;
}) {
  const linkOptions = stepOptions.filter((s) => s.id !== step.id);
  return (
    <div className="trial-step-form">
      <div className="trial-field">
        <label>
          卡片标题
          <input
            value={step.title}
            onChange={(e) => onStep({ title: e.target.value })}
          />
        </label>
        <label>
          给新手的说明
          <textarea
            rows={2}
            value={step.instruction}
            onChange={(e) => onStep({ instruction: e.target.value })}
          />
        </label>
        <label>
          上一步（允许回退重新选择）
          <select
            value={step.backTo ?? ""}
            onChange={(e) => onStep({ backTo: e.target.value || null })}
          >
            <option value="">无（课程起点）</option>
            {linkOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {step.kind === "bait" && (
        <div className="trial-field">
          <h4>可选鱼饵</h4>
          {BAIT_IDS.map((b) => (
            <label key={b} className="trial-check">
              <input
                type="checkbox"
                checked={step.options.includes(b)}
                onChange={(e) =>
                  onStep({
                    options: e.target.checked
                      ? [...step.options, b]
                      : step.options.filter((x) => x !== b),
                  })
                }
              />
              {baitName(b)}
            </label>
          ))}
          <LinkField label="下一步" value={step.next} options={linkOptions} onChange={(v) => onStep({ next: v })} />
        </div>
      )}

      {(step.kind === "catch" || step.kind === "strike") && (
        <CaptureForm step={step as CaptureCard} linkOptions={linkOptions} onStep={onStep} />
      )}

      {step.kind === "branch" && (
        <BranchForm step={step} linkOptions={linkOptions} onStep={onStep} />
      )}

      {step.kind === "supply" && (
        <div className="trial-field">
          <h4>阶段补给（整个课程只领一次）</h4>
          <div className="trial-inline">
            {BAIT_IDS.map((b) => (
              <label key={b} className="trial-mini">
                {baitName(b)}
                <input
                  type="number"
                  min={0}
                  value={step.grant[b]}
                  onChange={(e) =>
                    onStep({
                      grant: {
                        ...(step as SupplyCard).grant,
                        [b]: Math.max(0, Math.floor(+e.target.value || 0)),
                      } as BaitStock,
                    })
                  }
                />
              </label>
            ))}
          </div>
          <LinkField label="下一步" value={step.next} options={linkOptions} onChange={(v) => onStep({ next: v })} />
        </div>
      )}

      {step.kind === "release" && (
        <div className="trial-field">
          <label className="trial-mini">
            放流数量
            <input
              type="number"
              min={1}
              value={step.targetCount}
              onChange={(e) => onStep({ targetCount: Math.max(1, Math.floor(+e.target.value || 1)) })}
            />
          </label>
          <label className="trial-mini">
            指定鱼种
            <select
              value={step.targetFish ?? ""}
              onChange={(e) => onStep({ targetFish: (e.target.value || null) as FishId | null })}
            >
              <option value="">任意</option>
              {fishCatalog.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="trial-mini">
            限定来源水域
            <select
              value={step.targetSpot ?? ""}
              onChange={(e) => onStep({ targetSpot: (e.target.value || null) as SpotId | null })}
            >
              <option value="">任意</option>
              {waters.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <LinkField label="下一步" value={step.next} options={linkOptions} onChange={(v) => onStep({ next: v })} />
        </div>
      )}

      {step.kind === "complete" && (
        <label className="trial-mini">
          结业徽章文案
          <input
            value={(step as CompleteCard).badgeText}
            onChange={(e) => onStep({ badgeText: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}

function LinkField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="trial-mini">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CaptureForm({
  step,
  linkOptions,
  onStep,
}: {
  step: CaptureCard;
  linkOptions: { id: string; label: string }[];
  onStep: (patch: Partial<TrialStep>) => void;
}) {
  const fish = fishCatalog.find((f) => f.id === step.encounter);
  return (
    <div className="trial-field">
      <h4>{step.kind === "strike" ? "指定水域捕获 · 限时提竿" : "指定水域捕获"}</h4>
      <label className="trial-mini">
        水域
        <select
          value={step.spot}
          onChange={(e) => onStep({ spot: e.target.value as SpotId })}
        >
          {waters.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
              {w.catchesRequired > 0 ? `（正式解锁需 ${w.catchesRequired} 尾）` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="trial-mini">
        固定遭遇
        <select
          value={step.encounter}
          onChange={(e) => onStep({ encounter: e.target.value as FishId })}
        >
          {fishCatalog.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      {fish && (
        <p className="trial-hint">
          图鉴：出没于 {fish.waters.map(spotName).join("、")}；偏好{" "}
          {fish.baits.map(baitName).join("、")}。固定遭遇可偏离图鉴，但会给出提醒。
        </p>
      )}
      <label className="trial-mini">
        指定鱼饵
        <select
          value={step.bait ?? ""}
          onChange={(e) => onStep({ bait: (e.target.value || null) as BaitId | null })}
        >
          <option value="">任意（有库存即可）</option>
          {BAIT_IDS.map((b) => (
            <option key={b} value={b}>
              {baitName(b)}
            </option>
          ))}
        </select>
      </label>
      <div className="trial-inline">
        <label className="trial-mini">
          捕获数量
          <input
            type="number"
            min={1}
            value={step.targetCount}
            onChange={(e) => onStep({ targetCount: Math.max(1, Math.floor(+e.target.value || 1)) })}
          />
        </label>
        <label className="trial-mini">
          失败重试次数
          <input
            type="number"
            min={0}
            value={step.retries}
            onChange={(e) => onStep({ retries: Math.max(0, Math.floor(+e.target.value || 0)) })}
          />
        </label>
        {step.kind === "strike" && (
          <label className="trial-mini">
            提竿窗口（秒）
            <input
              type="number"
              min={0}
              step={0.5}
              value={step.biteWindow}
              onChange={(e) => onStep({ biteWindow: Math.max(0, +e.target.value || 0) })}
            />
          </label>
        )}
      </div>
      <LinkField label="下一步" value={step.next} options={linkOptions} onChange={(v) => onStep({ next: v })} />
    </div>
  );
}

function BranchForm({
  step,
  linkOptions,
  onStep,
}: {
  step: BranchCard;
  linkOptions: { id: string; label: string }[];
  onStep: (patch: Partial<TrialStep>) => void;
}) {
  return (
    <div className="trial-field">
      <label className="trial-mini">
        分支问题
        <input value={step.prompt} onChange={(e) => onStep({ prompt: e.target.value })} />
      </label>
      {step.options.map((option, index) => (
        <div className="trial-branch-option" key={option.id}>
          <label className="trial-mini">
            选项 {index + 1}
            <input
              value={option.label}
              onChange={(e) => {
                const options = [...step.options] as BranchCard["options"];
                options[index] = { ...options[index], label: e.target.value };
                onStep({ options });
              }}
            />
          </label>
          <label className="trial-mini">
            条件
            <select
              value={option.requires?.kind ?? "none"}
              onChange={(e) => {
                const kind = e.target.value;
                const requires =
                  kind === "stock"
                    ? { kind: "stock" as const, bait: "worm" as BaitId, min: 1 }
                    : kind === "unlocked"
                      ? { kind: "unlocked" as const, spot: "reed" as SpotId }
                      : kind === "landed"
                        ? { kind: "landed" as const, min: 1 }
                        : null;
                const options = [...step.options] as BranchCard["options"];
                options[index] = { ...options[index], requires };
                onStep({ options });
              }}
            >
              <option value="none">无</option>
              <option value="stock">库存至少</option>
              <option value="unlocked">水域已解锁</option>
              <option value="landed">累计捕获至少</option>
            </select>
          </label>
          {option.requires?.kind === "stock" && (
            <>
              <label className="trial-mini">
                鱼饵
                <select
                  value={option.requires.bait}
                  onChange={(e) => {
                    const options = [...step.options] as BranchCard["options"];
                    const current = option.requires;
                    options[index] = {
                      ...options[index],
                      requires: {
                        kind: "stock",
                        bait: e.target.value as BaitId,
                        min: current?.kind === "stock" ? current.min : 1,
                      },
                    };
                    onStep({ options });
                  }}
                >
                  {BAIT_IDS.map((b) => (
                    <option key={b} value={b}>
                      {baitName(b)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="trial-mini">
                数量
                <input
                  type="number"
                  min={0}
                  value={option.requires.min}
                  onChange={(e) => {
                    const options = [...step.options] as BranchCard["options"];
                    const current = option.requires;
                    options[index] = {
                      ...options[index],
                      requires: {
                        kind: "stock",
                        bait: current?.kind === "stock" ? current.bait : "worm",
                        min: Math.max(0, Math.floor(+e.target.value || 0)),
                      },
                    };
                    onStep({ options });
                  }}
                />
              </label>
            </>
          )}
          {option.requires?.kind === "unlocked" && (
            <label className="trial-mini">
              水域
              <select
                value={option.requires.spot}
                onChange={(e) => {
                  const options = [...step.options] as BranchCard["options"];
                  options[index] = {
                    ...options[index],
                    requires: { kind: "unlocked", spot: e.target.value as SpotId },
                  };
                  onStep({ options });
                }}
              >
                {waters.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {option.requires?.kind === "landed" && (
            <label className="trial-mini">
              捕获数
              <input
                type="number"
                min={0}
                value={option.requires.min}
                onChange={(e) => {
                  const options = [...step.options] as BranchCard["options"];
                  options[index] = {
                    ...options[index],
                    requires: { kind: "landed", min: Math.max(0, Math.floor(+e.target.value || 0)) },
                  };
                  onStep({ options });
                }}
              />
            </label>
          )}
          <label className="trial-mini">
            去向
            <select
              value={option.to}
              onChange={(e) => {
                const options = [...step.options] as BranchCard["options"];
                options[index] = { ...options[index], to: e.target.value };
                onStep({ options });
              }}
            >
              {linkOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ))}
      <p className="trial-hint">
        <GitBranch size={12} /> 分支条件在验证时会按其资源状态求值；条件不满足只封死这一条路线。
      </p>
    </div>
  );
}

function ValidationPanel({
  report,
  stale,
  validating,
  onValidate,
}: {
  draft: TrialVersion;
  report: TrialVersion["validation"];
  stale: boolean;
  validating: boolean;
  onValidate: () => void;
}) {
  return (
    <div className="trial-validation">
      <div className="trial-validation-head">
        <ShieldCheck size={16} />
        <h4>完成路径检查</h4>
        <button className="text-btn" disabled={validating} onClick={onValidate}>
          <RefreshCw size={12} />
          验证
        </button>
      </div>
      {validating && (
        <p className="trial-hint">
          正在按真实消耗、回退与补给规则穷尽搜索状态空间…
        </p>
      )}
      {!report && (
        <p className="trial-warn">
          <AlertTriangle size={14} />
          尚未验证。发布前必须得到“存在完成路径”的结论。
        </p>
      )}
      {stale && (
        <p className="trial-warn">
          <AlertTriangle size={14} />
          验证后课程已被修改，旧结论已失效，请重新验证。
        </p>
      )}
      {report && !stale && (
        <>
          <StatusPill report={report} />
          <p className="trial-hint">{report.message}</p>
          <p className="trial-hint">
            检查时间：{new Date(report.checkedAt).toLocaleString("zh-CN")} · 状态数{" "}
            {report.stateCount}
            {report.exhaustive
              ? "（已穷尽全部可达状态）"
              : report.status === "solvable"
                ? "（找到即停，未穷尽）"
                : "（未穷尽）"}
          </p>
          {report.example && <ExampleView report={report} />}
          {report.conflicts.length > 0 && (
            <div className="trial-conflicts">
              <h4>冲突与提醒</h4>
              {report.conflicts.map((c, i) => (
                <ConflictRow key={`${c.stepId}-${c.title}-${i}`} conflict={c} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatusPill({ report }: { report: ValidationReport }) {
  const map = {
    solvable: { text: "存在完成路径", cls: "ok" },
    unsolvable: { text: "无法完成", cls: "bad" },
    incomplete: { text: "验证未穷尽", cls: "warn" },
  }[report.status];
  return (
    <div className={"trial-status " + map.cls}>
      {report.status === "solvable" ? <Check size={15} /> : <AlertTriangle size={15} />}
      <strong>{map.text}</strong>
    </div>
  );
}

function ConflictRow({ conflict }: { conflict: TrialConflict }) {
  return (
    <div className={"trial-conflict " + conflict.severity}>
      <strong>
        {conflict.severity === "error" ? "冲突" : "提醒"} · {conflict.title}
      </strong>
      <p>{conflict.detail}</p>
      {conflict.stepId && <small>步骤：{conflict.stepId}</small>}
    </div>
  );
}

function actionText(action: ExampleAction) {
  switch (action.type) {
    case "back":
      return `回退 · ${action.label}`;
    case "bait":
      return action.label;
    case "branch":
      return action.label;
    case "supply":
      return action.label;
    case "cast":
      return action.label;
    case "release":
      return action.label;
    default:
      return action.label;
  }
}

function ExampleView({ report }: { report: ValidationReport }) {
  const example = report.example;
  if (!example) return null;
  return (
    <div className="trial-example">
      <h4>
        <ArrowRight size={13} /> 可操作示例路径（{example.actions.length} 步）
      </h4>
      <ol>
        {example.actions.map((action, i) => (
          <li key={i}>
            <span className="trial-example-label">{actionText(action)}</span>
            <small>{action.detail}</small>
            {action.stockAfter && (
              <small className="trial-example-stock">
                库存：{baits.map((b) => `${b.name}×${action.stockAfter![b.id]}`).join(" ")}
              </small>
            )}
          </li>
        ))}
      </ol>
      <div className="trial-example-end">
        结束时库存：
        {baits.map((b) => `${b.name}×${example.finalStock[b.id]}`).join(" ")} ·
        钓起 {example.catches} 尾 · 放流 {example.releases} 尾
      </div>
      {example.fightPlans.length > 0 && (
        <details>
          <summary>搏鱼操作（正式物理）</summary>
          <ul>
            {example.fightPlans.map((plan) => (
              <li key={plan.stepId}>
                {fishName(plan.fish)}：力度 {plan.power.toFixed(2)} · 泄力{" "}
                {plan.drag.toFixed(2)} · 约 {plan.seconds} 秒。{plan.note}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="trial-hint">
        示例从课程的起始库存与已解锁水域出发逐项模拟；试玩中可自行调整力度与泄力。
      </p>
    </div>
  );
}
