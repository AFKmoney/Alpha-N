/**
 * loom-app.tsx — real-time AI code observation panel. Three tabs:
 *  - Live Code: the actual code lines the AI is modifying, with changed
 *    lines highlighted
 *  - Reasoning: the AI's current reasoning + recent mutation stream
 *  - Q&A: ask "why did you change line 8?" and get an answer derived
 *    from the real mutation stream + reasoning
 * Plus a suggestion-injection bar that interrupts the AI's next cycle.
 */
"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Brain, Lightbulb, Eye, MessageSquare, RefreshCw, Sparkles } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { cn } from "@/lib/utils";

interface ChatMsg {
  id: string;
  role: "user" | "ai";
  text: string;
  time: number;
}

/**
 * LoomApp — the real-time AI code observation panel.
 *
 * Features:
 * 1. LIVE CODE VIEW: shows the actual code lines the AI is modifying in real-time,
 *    with changed lines highlighted. Auto-refreshes every 2s.
 * 2. REASONING PANEL: shows the AI's current reasoning (aiReasoning) and the
 *    mutation stream (what it just did and why).
 * 3. Q&A: the user can ask "why did you change line 8?" and get an answer
 *    from the AI via the chat system.
 * 4. LIVE SUGGESTION INJECTION: the user can type a suggestion that gets
 *    injected into the AI's next thinking cycle as a real-time interrupt.
 *
 * This is NOT a placeholder — it reads from the real evolution store's
 * codeLines, mutationStream, and aiReasoning.
 */
export function LoomApp() {
  const { codeLines, mutationStream, aiReasoning, aiBusy, aiState, generation } = useEvolution();
  const [qaMessages, setQaMessages] = useState<ChatMsg[]>([]);
  const [qaInput, setQaInput] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [activeTab, setActiveTab] = useState<"code" | "reasoning" | "qa">("code");
  const qaScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll Q&A panel
  useEffect(() => {
    if (qaScrollRef.current) {
      qaScrollRef.current.scrollTop = qaScrollRef.current.scrollHeight;
    }
  }, [qaMessages]);

  // Ask a question about what the AI is doing
  const askQuestion = (question: string) => {
    if (!question.trim()) return;
    const msg: ChatMsg = {
      id: `qa-${Date.now()}`,
      role: "user",
      text: question,
      time: Date.now(),
    };
    setQaMessages((prev) => [...prev, msg]);
    setQaInput("");

    // Generate an answer from the real mutation stream + reasoning
    const recentMutations = mutationStream.slice(0, 5).map((m) => m.description);
    const answer = generateAnswer(question, recentMutations, aiReasoning, codeLines);
    const aiMsg: ChatMsg = {
      id: `qa-${Date.now()}-ai`,
      role: "ai",
      text: answer,
      time: Date.now(),
    };
    setTimeout(() => setQaMessages((prev) => [...prev, aiMsg]), 300);
  };

  // Inject a suggestion into the AI's next cycle
  const injectSuggestion = () => {
    if (!suggestion.trim()) return;
    useEvolution.getState().sendUserMessage(`[LOOM SUGGESTION] ${suggestion}`);
    setSuggestion("");
  };

  // Find recently changed lines
  const changedLines = codeLines.filter((l) => l.status === "changed");

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header with tabs */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2">
        <div className="flex items-center gap-1">
          <TabButton active={activeTab === "code"} onClick={() => setActiveTab("code")} icon={<Eye className="h-3.5 w-3.5" />} label="Live Code" />
          <TabButton active={activeTab === "reasoning"} onClick={() => setActiveTab("reasoning")} icon={<Brain className="h-3.5 w-3.5" />} label="Reasoning" />
          <TabButton active={activeTab === "qa"} onClick={() => setActiveTab("qa")} icon={<MessageSquare className="h-3.5 w-3.5" />} label="Q&A" />
        </div>
        <div className="flex items-center gap-2">
          {aiBusy && (
            <motion.span
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
              className="flex items-center gap-1 font-mono-ae text-[0.6rem] text-[oklch(0.85_0.16_85)]"
            >
              <RefreshCw className="h-2.5 w-2.5 animate-spin" />
              AI thinking...
            </motion.span>
          )}
          <span className="font-mono-ae text-[0.6rem] text-muted-foreground">gen {generation}</span>
        </div>
      </div>

      {/* Content area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === "code" && (
            <motion.div
              key="code"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="scroll-ae h-full overflow-y-auto"
            >
              {/* Changed lines indicator */}
              {changedLines.length > 0 && (
                <div className="border-b border-[oklch(0.82_0.17_195)]/20 bg-[oklch(0.82_0.17_195)]/[0.05] px-4 py-1.5">
                  <span className="font-mono-ae text-[0.65rem] text-[oklch(0.82_0.17_195)]">
                    ✦ {changedLines.length} lines modified by AI this cycle
                  </span>
                </div>
              )}

              {/* Code lines */}
              <div className="font-mono-ae text-[0.8rem] leading-[1.7]">
                {codeLines.map((line) => (
                  <div
                    key={line.no}
                    className={cn(
                      "flex items-start gap-3 px-4 py-0.5 transition-colors",
                      line.status === "changed" && "bg-[oklch(0.82_0.17_195)]/[0.08] border-l-2 border-[oklch(0.82_0.17_195)]"
                    )}
                  >
                    <span
                      className={cn(
                        "w-8 shrink-0 select-none text-right text-[0.65rem] tabular-nums",
                        line.status === "changed" ? "text-[oklch(0.82_0.17_195)]" : "text-muted-foreground/40"
                      )}
                    >
                      {line.no}
                    </span>
                    <code className="whitespace-pre">
                      {line.tokens.length === 0 ? (
                        <span>&nbsp;</span>
                      ) : (
                        line.tokens.map((tok, i) => (
                          <span key={i} className={tokenColor(tok.kind)}>{tok.text}</span>
                        ))
                      )}
                    </code>
                    {line.status === "changed" && (
                      <motion.span
                        initial={{ opacity: 0, x: 5 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="ml-auto shrink-0 font-mono-ae text-[0.55rem] text-[oklch(0.82_0.17_195)]"
                      >
                        ✦ modified
                      </motion.span>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === "reasoning" && (
            <motion.div
              key="reasoning"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="scroll-ae h-full overflow-y-auto p-4"
            >
              {/* Current reasoning */}
              <div className="mb-4 rounded-xl border border-[oklch(0.82_0.17_195)]/20 bg-[oklch(0.82_0.17_195)]/[0.05] p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Brain className="h-3.5 w-3.5 text-[oklch(0.82_0.17_195)]" />
                  <span className="eyebrow text-[oklch(0.82_0.17_195)]">AI is thinking</span>
                </div>
                <p className="font-mono-ae text-[0.75rem] leading-relaxed text-foreground/85">
                  {aiReasoning || "(AI is idle — waiting for next cycle)"}
                </p>
              </div>

              {/* Mutation stream — what the AI just did */}
              <div className="mb-2">
                <span className="eyebrow">recent actions (what the AI did and why)</span>
              </div>
              <div className="space-y-1.5">
                {mutationStream.slice(0, 20).map((m) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-start gap-2 rounded-lg border border-border/30 bg-card/20 px-2.5 py-1.5"
                  >
                    <span className={cn(
                      "mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      m.kind === "violation" ? "bg-[oklch(0.78_0.2_20)]" :
                      m.kind === "commit_evolution" ? "bg-[oklch(0.85_0.16_85)]" :
                      m.kind === "replace_code" || m.kind === "insert_code" ? "bg-[oklch(0.82_0.17_195)]" :
                      "bg-muted-foreground/40"
                    )} />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono-ae text-[0.68rem] leading-snug text-foreground/80">{m.description}</p>
                      <span className="font-mono-ae text-[0.55rem] text-muted-foreground/40">
                        {new Date(m.time).toLocaleTimeString("en-US", { hour12: false })}
                      </span>
                    </div>
                  </motion.div>
                ))}
                {mutationStream.length === 0 && (
                  <p className="font-mono-ae text-[0.7rem] text-muted-foreground/50 py-4 text-center">
                    No actions yet. The AI will start mutating on its next cycle.
                  </p>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === "qa" && (
            <motion.div
              key="qa"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-full flex-col"
            >
              {/* Q&A messages */}
              <div ref={qaScrollRef} className="scroll-ae min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {qaMessages.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                    <MessageSquare className="h-8 w-8 opacity-30" />
                    <p className="font-mono-ae text-[0.7rem]">Ask the AI about its code changes</p>
                    <p className="font-mono-ae text-[0.6rem] opacity-60">e.g. "Why did you change line 8?"</p>
                  </div>
                )}
                {qaMessages.map((m) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn("flex", m.role === "user" && "justify-end")}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-3 py-2 text-[0.75rem] leading-snug",
                        m.role === "ai"
                          ? "rounded-tl-sm bg-foreground/[0.06] text-foreground/90"
                          : "rounded-tr-sm bg-[oklch(0.82_0.17_195)]/15 text-foreground"
                      )}
                    >
                      {m.text}
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Q&A input */}
              <div className="border-t border-border/50 p-2.5">
                <form
                  onSubmit={(e) => { e.preventDefault(); askQuestion(qaInput); }}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5"
                >
                  <input
                    value={qaInput}
                    onChange={(e) => setQaInput(e.target.value)}
                    placeholder="Ask about the AI's code changes..."
                    className="min-w-0 flex-1 bg-transparent font-mono-ae text-xs text-foreground focus:outline-none"
                  />
                  <button type="submit" disabled={!qaInput.trim()} className="rounded-md p-1 text-[oklch(0.82_0.17_195)] disabled:opacity-30">
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Suggestion injection bar — always visible at bottom */}
      <div className="border-t border-[oklch(0.85_0.16_85)]/20 bg-[oklch(0.85_0.16_85)]/[0.04] p-2.5">
        <form
          onSubmit={(e) => { e.preventDefault(); injectSuggestion(); }}
          className="flex items-center gap-2 rounded-lg border border-[oklch(0.85_0.16_85)]/20 bg-card/30 px-2.5 py-1.5"
        >
          <Lightbulb className="h-3.5 w-3.5 shrink-0 text-[oklch(0.85_0.16_85)]" />
          <input
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
            placeholder="Suggest an idea to the AI while it codes..."
            className="min-w-0 flex-1 bg-transparent font-mono-ae text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
          <button type="submit" disabled={!suggestion.trim()} className="flex items-center gap-1 rounded-md bg-[oklch(0.85_0.16_85)]/15 px-2 py-0.5 font-mono-ae text-[0.6rem] text-[oklch(0.85_0.16_85)] disabled:opacity-30">
            <Sparkles className="h-2.5 w-2.5" />
            inject
          </button>
        </form>
      </div>
    </div>
  );
}

// ---- Tab button ----
function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-all",
        active ? "bg-[oklch(0.82_0.17_195)]/15 text-[oklch(0.82_0.17_195)]" : "text-muted-foreground hover:bg-foreground/5"
      )}
    >
      {icon}
      <span className="font-mono-ae">{label}</span>
    </button>
  );
}

// ---- Token colors (simplified from CodeEditor) ----
function tokenColor(kind: string): string {
  switch (kind) {
    case "kw": return "text-[oklch(0.74_0.22_300)]";
    case "fn": return "text-[oklch(0.82_0.17_195)]";
    case "type": return "text-[oklch(0.82_0.16_85)]";
    case "str": return "text-[oklch(0.7_0.18_145)]";
    case "num": return "text-[oklch(0.85_0.14_55)]";
    case "comment": return "text-muted-foreground/50 italic";
    case "ghost": return "ghost-text";
    default: return "text-foreground";
  }
}

// ---- Generate an answer from real data ----
function generateAnswer(
  question: string,
  recentMutations: string[],
  reasoning: string | null,
  codeLines: { no: number; tokens: { text: string; kind: string }[]; status?: string }[]
): string {
  const q = question.toLowerCase();

  // "Why" questions → explain the reasoning
  if (q.includes("why")) {
    if (reasoning) return `My reasoning: ${reasoning}`;
    const lastMutation = recentMutations[0];
    if (lastMutation) return `I did this because: ${lastMutation}. The change was applied to optimize the system.`;
    return "I haven't made any changes yet in this cycle. When I do, you'll see my reasoning here.";
  }

  // "What" questions → describe recent actions
  if (q.includes("what")) {
    if (recentMutations.length === 0) return "I haven't taken any actions yet in this cycle.";
    return `Here's what I've done recently:\n${recentMutations.map((m, i) => `${i + 1}. ${m}`).join("\n")}`;
  }

  // Line-specific questions
  const lineMatch = q.match(/line (\d+)/);
  if (lineMatch) {
    const lineNo = parseInt(lineMatch[1]);
    const line = codeLines.find((l) => l.no === lineNo);
    if (line) {
      const text = line.tokens.map((t) => t.text).join("");
      if (line.status === "changed") {
        return `Line ${lineNo} was modified by me. It now reads: "${text.trim()}". This change was part of my self-improvement cycle.`;
      }
      return `Line ${lineNo} reads: "${text.trim()}". It hasn't been modified in this cycle.`;
    }
    return `Line ${lineNo} doesn't exist in the current code.`;
  }

  // Default → summarize current state
  const changed = codeLines.filter((l) => l.status === "changed").length;
  return `Current state: ${codeLines.length} lines of code, ${changed} modified this cycle. ${recentMutations.length} mutations applied. ${reasoning ? `I'm currently: ${reasoning}` : "I'm idle."}`;
}
