/**
 * UPGRADE-TO-RELLO (Platform KA prompt 1545; design §D3(ii) G-1, KA ruling 1541): whether the tenant's plan
 * is a Rello plan (`features ? rello`) or a single app's plan. Rello sends it as `planClass` on the
 * plan-grants shapes (the enable push's `planGrants` and `GET /api/v1/billing/plan-grants`) and on
 * `billing.plan_grants_changed`.
 *
 * What PathfinderPro does with it (the A4 contract): a gateway tenant whose grant state carries
 * `planClass: "rello"` resolves to full mode. An ABSENT `planClass` keeps today's meaning, and a value not in
 * {@link PLAN_CLASSES} is UNKNOWN (never "app", never "rello").
 *
 * On the wire it is a plain string, like `cause` on the same shapes: a class Rello adds later must never make
 * an older receiver refuse the whole grant push. Compare with {@link isPlanClass}.
 */
export const PLAN_CLASSES = ["rello", "app"] as const;
export type PlanClass = (typeof PLAN_CLASSES)[number];

const KNOWN: ReadonlySet<unknown> = new Set(PLAN_CLASSES);

/** True only for a class this release knows. Anything else (a later class, "", null, a number) is unknown. */
export function isPlanClass(value: unknown): value is PlanClass {
  return KNOWN.has(value);
}
