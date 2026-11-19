/**
 * PFP Gateway G-10R-2t-A (Platform KA prompt 1451, ruling K11a): the once-per-tenant Full PFP
 * plan trial. The wire contract between Rello (which starts and records the trial) and
 * PathfinderPro (which asks for it and reads its state). Spec: Agent 5's build plan a5-1450 §(b).
 *
 * Permission: `billing:plan-trial:write` (@rello-platform/permissions v0.67.0). The tenant is the
 * key's own, never a body field.
 *
 * Additive: `trial` is optional on the two plan-grants shapes, so an older Rello's body parses
 * unchanged. ABSENT means "this Rello does not say" (unknown), `null` means "the tenant has no
 * trial"; a reader must never turn an absent `trial` into `null`.
 */
import { z } from "zod";

const trialTime = z.string().datetime({ offset: true });

/**
 * A tenant's trial as the plan-grants shapes carry it. `startedAt` and `endsAt` are ISO instants.
 * Not strict, like its neighbours: a field Rello adds later is dropped, never a refusal.
 */
export const planTrialStateSchema = z.object({
  planSlug: z.string().min(1),
  startedAt: trialTime,
  endsAt: trialTime,
});
export type PlanTrialState = z.infer<typeof planTrialStateSchema>;

/**
 * Body of the trial start. Strict: no tenant, no dates; those are Rello's. `trialPlanSlug` is
 * OPTIONAL (KA amendment 1454): the trial plan is pinned by grant, so an empty body `{}` is valid and
 * Rello picks the one Plan that carries the pfp-full grant. A slug sent must match it
 * (`unknown_trial_plan` otherwise).
 */
export const planTrialStartRequestSchema = z
  .object({
    trialPlanSlug: z.string().min(1).max(100).optional(),
  })
  .strict();
export type PlanTrialStartRequest = z.infer<typeof planTrialStartRequestSchema>;

/** 200 of the trial start. `rev` is the tenant's plan-grants revision after the trial began. */
export const planTrialStartResponseSchema = z.object({
  trialId: z.string().min(1),
  trialPlanSlug: z.string().min(1),
  startedAt: trialTime,
  endsAt: trialTime,
  rev: z.number().int().nonnegative(),
});
export type PlanTrialStartResponse = z.infer<typeof planTrialStartResponseSchema>;

/**
 * Every `error` the trial start answers. `trial` rides on `trial_already_used` (the trial the tenant
 * already had). Each is a billing action refused, never a send gate.
 *  400 unknown_trial_plan (the slug sent does not match the Full plan) · invalid_body
 *  409 trial_plan_unknown (zero or several Plans carry the pfp-full grant, so the server cannot tell
 *      which is Full; KA amendment 1454) · trial_already_used · already_entitled · switch_in_progress ·
 *      switch_not_allowed
 *  not_gateway_tenant · plan_trial_unavailable as Rello answers them
 */
export const PLAN_TRIAL_START_ERROR_CODES = [
  "trial_already_used",
  "already_entitled",
  "not_gateway_tenant",
  "switch_in_progress",
  "switch_not_allowed",
  "unknown_trial_plan",
  "trial_plan_unknown",
  "invalid_body",
  "plan_trial_unavailable",
] as const;
export type PlanTrialStartErrorCode = (typeof PLAN_TRIAL_START_ERROR_CODES)[number];

/**
 * A refusal body `{ error, trial? }`. `error` is a plain non-empty string and `.loose()` keeps any extra
 * field, like the add-on charge-once and plan-switch refusals, so a code Rello adds later still parses:
 * compare it with {@link PLAN_TRIAL_START_ERROR_CODES} and treat a code not in the list as a refusal
 * you cannot name (never as "no trial"). `trial`, when present, carries its `status`.
 */
export const planTrialStartErrorSchema = z
  .object({
    error: z.string().min(1),
    trial: planTrialStateSchema.extend({ status: z.string() }).optional(),
  })
  .loose();
export type PlanTrialStartError = z.infer<typeof planTrialStartErrorSchema>;
