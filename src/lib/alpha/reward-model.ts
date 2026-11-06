/**
 * reward-model.ts — feedback learning.
 *
 * After every tool execution the loop computes an objective reward from the
 * observable outcome. Rewards are accumulated into MutationRewardEntry rows
 * (store + DB) and fed back to the AI in its next think payload so it can
 * do more of what helps and less of what hurts.
 */

export interface RewardInput {
  /** the tool call completed without throwing */
  toolOk: boolean;
  /** the tool call threw or returned an error payload */
  toolError: boolean;
  /** the action was blocked by the autonomy policy */
  blocked: boolean;
  /** the batch triggered a rollback */
  rolledBack: boolean;
}

/**
 * Objective reward in roughly [-3, +2].
 * Success is the only thing that pays; blocking and rollback are expensive
 * so the model learns to check before it acts.
 */
export function computeReward(input: RewardInput): number {
  let reward = 0;
  if (input.toolOk) reward += 1;
  if (input.toolError) reward -= 1;
  if (input.blocked) reward -= 2;
  if (input.rolledBack) reward -= 1.5;
  if (input.toolOk && !input.rolledBack && !input.blocked) reward += 0.5;
  return Math.round(reward * 1000) / 1000;
}

/** Whether a reward entry counts as "helped coherence" for the feed. */
export function isHelpful(delta: number): boolean {
  return delta >= 0;
}
