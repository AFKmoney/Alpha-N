/**
 * chat-panel.tsx — the floating conversation overlay with N-Core.
 * Shows the full message history (with collapsible reasoning), a live
 * "thinking" indicator, and an autonomy-mode toggle. Also exports
 * ChatToggle — a standalone floating button that opens the panel.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Send, Sparkles, User, ChevronDown, X } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useMounted } from "@/lib/alpha/use-mounted";
import { cn } from "@/lib/utils";

export function ChatPanel() {
  const {
    chat,
    chatOpen,
    toggleChat,
    sendUserMessage,
    aiBusy,
    aiReasoning,
    autonomyMode,
    toggleAutonomy,
  } = useEvolution();

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat, aiBusy]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendUserMessage(text);
    setInput("");
  };

  return (
    <AnimatePresence>
      {chatOpen && (
        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ type: "spring", stiffness: 280, damping: 28 }}
          className="glass-strong pointer-events-auto fixed bottom-16 right-3 z-40 flex h-[38vh] w-[min(88vw,340px)] flex-col overflow-hidden rounded-2xl glow-amethyst sm:bottom-20 sm:right-4"
          data-ai-skip="true"
        >
          {/* header */}
          <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Bot className="h-4 w-4 text-[oklch(0.74_0.22_300)]" />
                {aiBusy && (
                  <motion.span
                    animate={{ scale: [1, 1.6, 1], opacity: [0.6, 0, 0.6] }}
                    transition={{ duration: 1.6, repeat: Infinity }}
                    className="absolute inset-0 rounded-full bg-[oklch(0.74_0.22_300)]"
                  />
                )}
              </div>
              <h3 className="font-mono-ae text-sm font-semibold">N-Core</h3>
              <span className="eyebrow text-muted-foreground">
                {aiBusy ? "thinking…" : "listening"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={toggleAutonomy}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono-ae text-[0.6rem] transition-all",
                  autonomyMode === "active"
                    ? "border-[oklch(0.85_0.16_85)]/40 bg-[oklch(0.85_0.16_85)]/10 text-[oklch(0.85_0.16_85)]"
                    : "border-border/60 bg-card/40 text-muted-foreground"
                )}
                title="Toggle autonomous mode"
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", autonomyMode === "active" ? "bg-[oklch(0.85_0.16_85)] neural-dot" : "bg-muted-foreground")} />
                {autonomyMode === "active" ? "active" : "standby"}
              </button>
              <button
                onClick={toggleChat}
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                aria-label="Close chat"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* messages */}
          <div ref={scrollRef} className="scroll-ae min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {chat.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex gap-2", m.role === "user" && "flex-row-reverse")}
              >
                <div
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                    m.role === "ai"
                      ? "border-[oklch(0.74_0.22_300)]/40 bg-[oklch(0.74_0.22_300)]/10 text-[oklch(0.74_0.22_300)]"
                      : "border-[oklch(0.82_0.17_195)]/40 bg-[oklch(0.82_0.17_195)]/10 text-[oklch(0.82_0.17_195)]"
                  )}
                >
                  {m.role === "ai" ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                </div>
                <div className={cn("min-w-0 max-w-[78%]", m.role === "user" && "text-right")}>
                  <div
                    className={cn(
                      "inline-block rounded-2xl px-3 py-2 text-[0.78rem] leading-snug",
                      m.role === "ai"
                        ? "rounded-tl-sm bg-foreground/[0.06] text-foreground/90"
                        : "rounded-tr-sm bg-[oklch(0.82_0.17_195)]/15 text-foreground"
                    )}
                  >
                    {m.content}
                  </div>
                  {m.reasoning && (
                    <details className="mt-1 group">
                      <summary className="flex cursor-pointer list-none items-center gap-1 font-mono-ae text-[0.58rem] text-muted-foreground/70 hover:text-muted-foreground">
                        <ChevronDown className="h-2.5 w-2.5 transition-transform group-open:rotate-180" />
                        reasoning
                      </summary>
                      <p className="mt-1 rounded-lg bg-foreground/[0.03] px-2 py-1.5 text-[0.68rem] italic leading-snug text-muted-foreground">
                        {m.reasoning}
                      </p>
                    </details>
                  )}
                  <div className="mt-0.5 font-mono-ae text-[0.55rem] text-muted-foreground/40">
                    {mounted ? new Date(m.time).toLocaleTimeString("en-US", { hour12: false }) : "—"}
                  </div>
                </div>
              </motion.div>
            ))}

            {aiBusy && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex gap-2"
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[oklch(0.74_0.22_300)]/40 bg-[oklch(0.74_0.22_300)]/10 text-[oklch(0.74_0.22_300)]">
                  <Bot className="h-3 w-3" />
                </div>
                <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-foreground/[0.06] px-3 py-2.5">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      animate={{ opacity: [0.2, 1, 0.2], y: [0, -2, 0] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                      className="h-1.5 w-1.5 rounded-full bg-[oklch(0.74_0.22_300)]"
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </div>

          {/* reasoning live banner */}
          {aiBusy && aiReasoning && (
            <div className="border-t border-border/40 bg-[oklch(0.74_0.22_300)]/[0.05] px-3 py-1.5">
              <p className="font-mono-ae text-[0.62rem] italic leading-snug text-muted-foreground">
                {aiReasoning.slice(0, 120)}…
              </p>
            </div>
          )}

          {/* input */}
          <form onSubmit={submit} className="border-t border-border/50 p-2.5">
            <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/50 px-2 py-1 focus-within:border-[oklch(0.74_0.22_300)]/50">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-[oklch(0.74_0.22_300)]" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Tell N-Core what to optimise…"
                className="min-w-0 flex-1 bg-transparent py-1.5 font-mono-ae text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[oklch(0.74_0.22_300)]/20 text-[oklch(0.74_0.22_300)] transition-colors hover:bg-[oklch(0.74_0.22_300)]/30 disabled:opacity-30"
                aria-label="Send"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ChatToggle() {
  const { chatOpen, toggleChat } = useEvolution();
  return (
    <button
      onClick={toggleChat}
      className={cn(
        "fixed bottom-16 right-3 z-30 flex h-11 w-11 items-center justify-center rounded-full border transition-all sm:bottom-20 sm:right-4",
        chatOpen
          ? "border-transparent glow-amethyst bg-card/80"
          : "border-border/60 bg-card/60 hover:bg-card/80 backdrop-blur"
      )}
      aria-label="Toggle chat with N-Core"
      data-ai-skip="true"
    >
      <Bot className={cn("h-5 w-5", chatOpen ? "text-[oklch(0.74_0.22_300)]" : "text-foreground/70")} />
    </button>
  );
}
