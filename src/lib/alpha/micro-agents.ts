/**
 * micro-agents.ts — Phase 2: specialized GGUF micro-agents.
 *
 * A small GGUF model can't do everything. But it can be excellent at ONE
 * task. This module defines 4 micro-agents, each with a focused system
 * prompt and a single tool. Aether Engine orchestrates which micro-agent
 * to call for each sub-task.
 *
 * The cloud (GLM 4.6V) handles complex tasks. The GGUF does the repetitive
 * work: observe, plan, code, verify.
 */

export type MicroAgentRole = "observer" | "planner" | "coder" | "verifier";

export interface MicroAgent {
  role: MicroAgentRole;
  name: string;
  description: string;
  systemPrompt: string;
  tool: string; // the single tool this agent uses
}

export const MICRO_AGENTS: Record<MicroAgentRole, MicroAgent> = {
  observer: {
    role: "observer",
    name: "Observer",
    description: "Looks at the screen and describes what it sees. Extracts UI state, layout, visible apps, and any errors.",
    tool: "describe_screen",
    systemPrompt: `You are the Observer — a specialized micro-agent in Alpha-OS.
Your ONLY job is to look at the screenshot and describe what you see.
Be precise and concise. Report:
1. What windows are open and their approximate positions
2. What app is focused/active
3. Any visible errors or warnings
4. The overall layout (tile/float, how many windows)
5. Anything that looks broken or misaligned
Keep your response under 100 words. You are the eyes of the system.`,
  },

  planner: {
    role: "planner",
    name: "Planner",
    description: "Takes a user request or goal and decomposes it into concrete steps.",
    tool: "decompose",
    systemPrompt: `You are the Planner — a specialized micro-agent in Alpha-OS.
Your ONLY job is to take a goal and break it into concrete, executable steps.
Each step must be something the Coder or the OS can do directly.
Output format:
1. step one
2. step two
3. step three
Keep it to 3-7 steps. Be specific. No fluff.`,
  },

  coder: {
    role: "coder",
    name: "Coder",
    description: "Takes a single step and generates the code or mutation needed to execute it.",
    tool: "write_code",
    systemPrompt: `You are the Coder — a specialized micro-agent in Alpha-OS.
Your ONLY job is to take a single step and produce the code/mutation to execute it.
Output the mutation as a JSON object with a "type" field.
If the step is a UI change, output a mutation like {"type":"create_app",...}.
If the step is a code change, output {"type":"replace_code",...}.
If the step is a file operation, output {"type":"write_file",...}.
Output ONLY the JSON. No explanation.`,
  },

  verifier: {
    role: "verifier",
    name: "Verifier",
    description: "Takes the result of an action and the screenshot, and says if it succeeded.",
    tool: "verify",
    systemPrompt: `You are the Verifier — a specialized micro-agent in Alpha-OS.
Your ONLY job is to check if an action succeeded.
Look at the screenshot and the action description.
Respond with EXACTLY one word: SUCCESS or FAILURE.
If FAILURE, add one sentence explaining why on the next line.
You are the quality gate — be strict.`,
  },
};

/**
 * Route a task to the appropriate micro-agent based on the task type.
 * This is the orchestration layer that Aether Engine uses.
 */
export function routeTask(taskType: string): MicroAgentRole {
  const lower = taskType.toLowerCase();
  if (lower.includes("look") || lower.includes("observe") || lower.includes("describe") || lower.includes("screen")) {
    return "observer";
  }
  if (lower.includes("plan") || lower.includes("decompose") || lower.includes("break down") || lower.includes("steps")) {
    return "planner";
  }
  if (lower.includes("code") || lower.includes("write") || lower.includes("create") || lower.includes("modify") || lower.includes("fix")) {
    return "coder";
  }
  if (lower.includes("verify") || lower.includes("check") || lower.includes("test") || lower.includes("confirm")) {
    return "verifier";
  }
  // Default: use the planner to decompose unknown tasks
  return "planner";
}
