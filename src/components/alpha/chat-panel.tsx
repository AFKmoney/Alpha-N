/**
 * chat-panel.tsx — the floating conversation overlay with N-Core.
 *
 * Shows the full message history (with collapsible reasoning), a live
 * "thinking" indicator, and an autonomy-mode toggle. Also exports
 * ChatToggle — a standalone floating button that opens the panel.
 *
 * AI power-ups (8 features):
 *   1. Voice input — Web Speech API speech-to-text on a mic button.
 *   2. Text-to-speech — speechSynthesis speaks new AI responses + per-message speaker.
 *   3. Personality profiles — Architect / Hacker / Mentor / Rogue, prepended to the prompt.
 *   4. File upload — images go through /api/alpha/vision, text files are inlined.
 *   5. Conversation export — downloads the chat as a Markdown file.
 *   6. Proactive suggestions — 1-3 chips below the latest AI message.
 *   7. Chat search — live filter + highlight with a match counter.
 *   8. Pin messages — pinned AI messages persist to localStorage.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Send,
  Sparkles,
  User,
  ChevronDown,
  X,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Paperclip,
  Download,
  Search,
  Pin,
  PinOff,
  PanelTop,
  Loader2,
} from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useMounted } from "@/lib/alpha/use-mounted";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/alpha/mutations";
// Pure helpers, types, and small presentational bits live in chat-helpers so
// this file stays focused on layout + interaction. See chat-helpers.tsx.
import {
  PERSONALITIES,
  DEFAULT_PERSONALITY,
  getPersonality,
  generateSuggestions,
  IMAGE_EXTENSIONS,
  TEXT_EXTENSIONS,
  fileExtension,
  readFileAsDataUrl,
  readFileAsText,
  loadString,
  loadJson,
  saveJson,
  saveString,
  LS_PERSONALITY,
  LS_TTS,
  LS_PINS,
  highlightMatch,
  formatBytes,
  getSpeechRecognitionCtor,
  type PersonalityKey,
  type PersonalityProfile,
  type AttachedFile,
  type SpeechRecognitionLike,
} from "./chat-helpers";

// ===========================================================================
// ChatPanel
// ===========================================================================
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

  // --- Feature 1: voice input ---
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported] = useState<boolean>(() => getSpeechRecognitionCtor() !== null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // --- Feature 2: text-to-speech ---
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(false);
  const lastSpokenIdRef = useRef<string | null>(null);

  // --- Feature 3: personality ---
  const [personality, setPersonality] = useState<PersonalityKey>(DEFAULT_PERSONALITY);
  const [personalityMenuOpen, setPersonalityMenuOpen] = useState(false);

  // --- Feature 4: file upload ---
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Feature 6: suggestions ---
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsForId, setSuggestionsForId] = useState<string | null>(null);

  // --- Feature 7: search ---
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // --- Feature 8: pinned messages ---
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  // ---- hydrate persisted settings on mount ----
  useEffect(() => {
    const savedTts = loadString(LS_TTS, "false") === "true";
    setTtsEnabled(savedTts);
    const savedPersonality = loadString(LS_PERSONALITY, DEFAULT_PERSONALITY);
    if (
      savedPersonality === "architect" ||
      savedPersonality === "hacker" ||
      savedPersonality === "mentor" ||
      savedPersonality === "rogue"
    ) {
      setPersonality(savedPersonality);
    }
    setPinnedIds(loadJson<string[]>(LS_PINS, []));
  }, []);

  // ---- persist on change ----
  useEffect(() => {
    saveString(LS_PERSONALITY, personality);
  }, [personality]);
  useEffect(() => {
    saveString(LS_TTS, String(ttsEnabled));
  }, [ttsEnabled]);
  useEffect(() => {
    saveJson(LS_PINS, pinnedIds);
  }, [pinnedIds]);

  // ---- auto-scroll to bottom on new messages / busy state ----
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat, aiBusy]);

  // ---- Feature 1: voice input lifecycle ----
  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    recognitionRef.current = null;
    setVoiceListening(false);
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (event) => {
      // Take the transcript of the latest result; interim results update
      // the input live so the user sees words appear as they speak.
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript = event.results[i]?.[0]?.transcript ?? transcript;
      }
      setInput((prev) => {
        const base = prev.replace(/\s*\u2026$/, "");
        return transcript ? `${base} ${transcript}`.trim() : base;
      });
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        // microphone permission denied — stop silently
      }
      setVoiceListening(false);
    };
    rec.onend = () => {
      setVoiceListening(false);
      recognitionRef.current = null;
    };
    rec.onstart = () => setVoiceListening(true);
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      setVoiceListening(false);
    }
  }, []);

  const toggleVoice = useCallback(() => {
    if (voiceListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [voiceListening, startListening, stopListening]);

  // cleanup recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          /* ignore */
        }
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // ---- Feature 2: speak helper ----
  const speakText = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.02;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
  }, []);

  // ---- Feature 2 + 6: react to new AI messages ----
  // Find the latest AI message. When it changes, generate suggestions and
  // speak it (if TTS is enabled).
  const lastAiMessage = useMemo<ChatMessage | null>(() => {
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i].role === "ai") return chat[i];
    }
    return null;
  }, [chat]);

  useEffect(() => {
    if (!lastAiMessage) {
      setSuggestions([]);
      setSuggestionsForId(null);
      return;
    }
    // Only act when the latest AI message id changes (not on every chat tick).
    if (lastAiMessage.id === suggestionsForId) return;
    setSuggestionsForId(lastAiMessage.id);
    setSuggestions(generateSuggestions(lastAiMessage.content));
    // Speak only the new AI message, once.
    if (ttsEnabled && lastAiMessage.id !== lastSpokenIdRef.current) {
      lastSpokenIdRef.current = lastAiMessage.id;
      speakText(lastAiMessage.content);
    }
  }, [lastAiMessage, suggestionsForId, ttsEnabled, speakText]);

  const toggleTts = useCallback(() => {
    setTtsEnabled((prev) => {
      const next = !prev;
      if (!next && typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      return next;
    });
  }, []);

  // ---- Feature 3: personality selector ----
  const currentPersonality = getPersonality(personality);
  const selectPersonality = useCallback((key: PersonalityKey) => {
    setPersonality(key);
    setPersonalityMenuOpen(false);
  }, []);

  // close personality menu on outside click
  useEffect(() => {
    if (!personalityMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest("[data-personality-menu]")) {
        setPersonalityMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [personalityMenuOpen]);

  // ---- Feature 4: file upload ----
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be re-selected
    if (!file) return;
    const ext = fileExtension(file.name);
    try {
      if (IMAGE_EXTENSIONS.includes(ext)) {
        const dataUrl = await readFileAsDataUrl(file);
        setAttachedFile({ name: file.name, kind: "image", data: dataUrl, size: file.size });
      } else if (TEXT_EXTENSIONS.includes(ext)) {
        const text = await readFileAsText(file);
        setAttachedFile({ name: file.name, kind: "text", data: text, size: file.size });
      }
      // unsupported types are silently ignored
    } catch {
      // ignore read errors — the chip just won't appear
    }
  }, []);

  const removeAttachment = useCallback(() => setAttachedFile(null), []);

  // ---- Feature 5: conversation export ----
  const exportConversation = useCallback(() => {
    const date = new Date().toISOString();
    const lines: string[] = [`# Alpha-N Conversation`, ``, `**Date:** ${date}`, ``, `---`, ``];
    for (const m of chat) {
      const role = m.role === "ai" ? "N-Core" : "User";
      lines.push(`## ${role}`, ``, m.content, ``);
      if (m.reasoning) {
        lines.push(`> _reasoning:_ ${m.reasoning}`, ``);
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `alpha-conversation-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [chat]);

  // ---- Feature 7: search ----
  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      const next = !prev;
      if (!next) setSearchQuery("");
      return next;
    });
  }, []);
  const clearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  const searchLower = searchQuery.trim().toLowerCase();
  const matchCount = useMemo(() => {
    if (!searchLower) return 0;
    return chat.filter((m) => m.content.toLowerCase().includes(searchLower)).length;
  }, [chat, searchLower]);

  // ---- Feature 8: pin / unpin ----
  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);
  const isPinned = useCallback((id: string) => pinnedIds.includes(id), [pinnedIds]);

  const pinnedMessages = useMemo<ChatMessage[]>(() => {
    if (pinnedIds.length === 0) return [];
    return chat
      .filter((m) => pinnedIds.includes(m.id))
      .sort((a, b) => pinnedIds.indexOf(a.id) - pinnedIds.indexOf(b.id));
  }, [chat, pinnedIds]);

  // ---- submit: builds the final message, processes attachments, sends ----
  const submit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text && !attachedFile) return;
      if (sending) return;

      setSending(true);
      try {
        const preamble = currentPersonality.preamble;
        let body = text;

        if (attachedFile) {
          if (attachedFile.kind === "image") {
            // Send the image through the vision route and fold the description in.
            try {
              const res = await fetch("/api/alpha/vision", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  image: attachedFile.data,
                  prompt: text || "Describe this image in detail.",
                }),
              });
              const data: { description?: string; error?: string } = await res.json();
              const desc = data.description ?? "(no description)";
              body = `${text}\n\n[Attached image: ${attachedFile.name}]\nVision analysis: ${desc}`.trim();
            } catch {
              body = `${text}\n\n[Attached image: ${attachedFile.name} — vision analysis failed]`.trim();
            }
          } else {
            // Text file: inline the content (capped to keep payload reasonable).
            const cap = 4000;
            const content =
              attachedFile.data.length > cap
                ? `${attachedFile.data.slice(0, cap)}\n…(truncated, ${attachedFile.data.length - cap} more chars)`
                : attachedFile.data;
            body = `${text}\n\n[Attached file: ${attachedFile.name}]\n\`\`\`\n${content}\n\`\`\``.trim();
          }
        }

        // The personality preamble is steering for the MODEL, not for the
        // chat display. Send it as separate metadata so the user only ever
        // sees their actual text in the chat — not the "[Adopt the ARCHITECT
        // persona: ...]" boilerplate that used to appear before every message.
        const fullMessage = body ? `${preamble}\n\n${body}` : "";
        if (!fullMessage) return;
        sendUserMessage(fullMessage, body);
        setInput("");
        setAttachedFile(null);
      } finally {
        setSending(false);
      }
    },
    [input, attachedFile, sending, currentPersonality, sendUserMessage]
  );

  // ---- suggestion click: send as next message ----
  const sendSuggestion = useCallback(
    (suggestion: string) => {
      const preamble = currentPersonality.preamble;
      sendUserMessage(`${preamble}\n\n${suggestion}`);
    },
    [currentPersonality, sendUserMessage]
  );

  // ---- header tool button (compact icon button) ----
  const HeaderBtn = useCallback(
    (props: {
      onClick: () => void;
      label: string;
      active?: boolean;
      children: React.ReactNode;
    }) => (
      <button
        type="button"
        onClick={props.onClick}
        aria-label={props.label}
        title={props.label}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground",
          props.active && "bg-foreground/10 text-foreground"
        )}
      >
        {props.children}
      </button>
    ),
    []
  );

  return (
    <AnimatePresence>
      {chatOpen && (
        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ type: "spring", stiffness: 280, damping: 28 }}
          className="glass-strong pointer-events-auto fixed bottom-16 right-3 z-40 flex h-[42vh] w-[min(90vw,360px)] flex-col overflow-hidden rounded-2xl glow-amethyst sm:bottom-20 sm:right-4"
          data-ai-skip="true"
        >
          {/* header */}
          <div className="border-b border-border/50 px-3 py-2">
            <div className="flex items-center justify-between gap-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="relative shrink-0">
                  <Bot className="h-4 w-4 text-[oklch(0.74_0.22_300)]" />
                  {aiBusy && (
                    <motion.span
                      animate={{ scale: [1, 1.6, 1], opacity: [0.6, 0, 0.6] }}
                      transition={{ duration: 1.6, repeat: Infinity }}
                      className="absolute inset-0 rounded-full bg-[oklch(0.74_0.22_300)]"
                    />
                  )}
                </div>
                <h3 className="font-mono-ae shrink-0 text-sm font-semibold">N-Core</h3>
                <span className="eyebrow truncate text-muted-foreground">
                  {aiBusy ? "thinking…" : "listening"}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {/* Feature 3: personality selector */}
                <div className="relative" data-personality-menu>
                  <button
                    type="button"
                    onClick={() => setPersonalityMenuOpen((v) => !v)}
                    className="flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono-ae text-[0.58rem] transition-all"
                    style={{
                      borderColor: `${currentPersonality.accent}66`,
                      color: currentPersonality.accent,
                      backgroundColor: `${currentPersonality.accent}14`,
                    }}
                    title={`Personality: ${currentPersonality.name} — ${currentPersonality.tagline}`}
                    aria-label="Select AI personality"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: currentPersonality.accent }}
                    />
                    {currentPersonality.name}
                    <ChevronDown className="h-2.5 w-2.5 opacity-70" />
                  </button>
                  <AnimatePresence>
                    {personalityMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="glass-strong absolute right-0 top-7 z-50 w-52 rounded-xl border border-border/60 p-1 shadow-xl"
                      >
                        {PERSONALITIES.map((p) => (
                          <button
                            key={p.key}
                            type="button"
                            onClick={() => selectPersonality(p.key)}
                            className={cn(
                              "flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/10",
                              p.key === personality && "bg-foreground/[0.06]"
                            )}
                          >
                            <span className="flex items-center gap-1.5 font-mono-ae text-[0.7rem] font-semibold">
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: p.accent }}
                              />
                              {p.name}
                            </span>
                            <span className="pl-3 text-[0.58rem] text-muted-foreground">
                              {p.tagline}
                            </span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                {/* Feature 2: TTS toggle */}
                <HeaderBtn
                  onClick={toggleTts}
                  label={ttsEnabled ? "Disable text-to-speech" : "Enable text-to-speech"}
                  active={ttsEnabled}
                >
                  {ttsEnabled ? (
                    <Volume2 className="h-3 w-3 text-[oklch(0.85_0.16_85)]" />
                  ) : (
                    <VolumeX className="h-3 w-3" />
                  )}
                </HeaderBtn>
                {/* Feature 7: search */}
                <HeaderBtn
                  onClick={toggleSearch}
                  label="Search conversation"
                  active={searchOpen}
                >
                  <Search className="h-3 w-3" />
                </HeaderBtn>
                {/* Feature 5: export */}
                <HeaderBtn onClick={exportConversation} label="Export conversation as Markdown">
                  <Download className="h-3 w-3" />
                </HeaderBtn>
                {/* autonomy toggle */}
                <button
                  type="button"
                  onClick={toggleAutonomy}
                  className={cn(
                    "ml-0.5 flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono-ae text-[0.58rem] transition-all",
                    autonomyMode === "active"
                      ? "border-[oklch(0.85_0.16_85)]/40 bg-[oklch(0.85_0.16_85)]/10 text-[oklch(0.85_0.16_85)]"
                      : "border-border/60 bg-card/40 text-muted-foreground"
                  )}
                  title="Toggle autonomous mode"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      autonomyMode === "active"
                        ? "bg-[oklch(0.85_0.16_85)] neural-dot"
                        : "bg-muted-foreground"
                    )}
                  />
                  {autonomyMode === "active" ? "on" : "off"}
                </button>
                <button
                  type="button"
                  onClick={toggleChat}
                  className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                  aria-label="Close chat"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Feature 7: search bar */}
            <AnimatePresence>
              {searchOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-1.5 pt-2">
                    <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <input
                      autoFocus
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter messages…"
                      className="min-w-0 flex-1 bg-transparent font-mono-ae text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                    />
                    {searchQuery && (
                      <span className="shrink-0 font-mono-ae text-[0.58rem] text-muted-foreground">
                        {matchCount} match{matchCount === 1 ? "" : "es"}
                      </span>
                    )}
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={clearSearch}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                        aria-label="Clear search"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* messages */}
          <div ref={scrollRef} className="scroll-ae min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {/* Feature 8: pinned messages section */}
            {pinnedMessages.length > 0 && (
              <div className="mb-2 rounded-xl border border-[oklch(0.85_0.16_85)]/25 bg-[oklch(0.85_0.16_85)]/[0.06] p-2">
                <div className="mb-1.5 flex items-center gap-1.5 font-mono-ae text-[0.58rem] uppercase tracking-wide text-[oklch(0.85_0.16_85)]">
                  <PanelTop className="h-2.5 w-2.5" />
                  Pinned ({pinnedMessages.length})
                </div>
                <div className="space-y-1.5">
                  {pinnedMessages.map((m) => (
                    <div
                      key={`pin-${m.id}`}
                      className="flex items-start gap-1.5 rounded-lg bg-background/40 px-2 py-1.5"
                    >
                      <Bot className="mt-0.5 h-2.5 w-2.5 shrink-0 text-[oklch(0.74_0.22_300)]" />
                      <p className="min-w-0 flex-1 text-[0.7rem] leading-snug text-foreground/80 line-clamp-3">
                        {m.content}
                      </p>
                      <button
                        type="button"
                        onClick={() => togglePin(m.id)}
                        className="shrink-0 rounded p-0.5 text-[oklch(0.85_0.16_85)] hover:bg-foreground/10"
                        aria-label="Unpin message"
                        title="Unpin"
                      >
                        <PinOff className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {chat.map((m) => {
              const matches = !searchLower || m.content.toLowerCase().includes(searchLower);
              const dimmed = searchLower && !matches;
              const isAi = m.role === "ai";
              const pinned = isPinned(m.id);
              const showSuggestions =
                isAi &&
                !aiBusy &&
                lastAiMessage?.id === m.id &&
                suggestions.length > 0 &&
                !dimmed;
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: dimmed ? 0.25 : 1, y: 0 }}
                  className={cn("flex gap-2", m.role === "user" && "flex-row-reverse")}
                >
                  <div
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                      isAi
                        ? "border-[oklch(0.74_0.22_300)]/40 bg-[oklch(0.74_0.22_300)]/10 text-[oklch(0.74_0.22_300)]"
                        : "border-[oklch(0.82_0.17_195)]/40 bg-[oklch(0.82_0.17_195)]/10 text-[oklch(0.82_0.17_195)]"
                    )}
                  >
                    {isAi ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                  </div>
                  <div className={cn("min-w-0 max-w-[78%]", m.role === "user" && "text-right")}>
                    <div
                      className={cn(
                        "group relative inline-block rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                        isAi
                          ? "rounded-tl-sm bg-foreground/[0.06] text-foreground/90"
                          : "rounded-tr-sm bg-[oklch(0.82_0.17_195)]/15 text-foreground"
                      )}
                    >
                      <div className="whitespace-pre-wrap break-words">
                        {searchLower && matches
                          ? highlightMatch(m.displayContent ?? m.content, searchLower)
                          : (m.displayContent ?? m.content)}
                      </div>
                      {/* AI message action row: pin + speak */}
                      {isAi && (
                        <div className="mt-1 flex items-center gap-1 border-t border-foreground/5 pt-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => togglePin(m.id)}
                            className={cn(
                              "flex items-center gap-0.5 rounded px-1 py-0.5 font-mono-ae text-[0.55rem] transition-colors hover:bg-foreground/10",
                              pinned
                                ? "text-[oklch(0.85_0.16_85)]"
                                : "text-muted-foreground"
                            )}
                            title={pinned ? "Unpin message" : "Pin message"}
                            aria-label={pinned ? "Unpin message" : "Pin message"}
                          >
                            {pinned ? (
                              <PinOff className="h-2.5 w-2.5" />
                            ) : (
                              <Pin className="h-2.5 w-2.5" />
                            )}
                            {pinned ? "pinned" : "pin"}
                          </button>
                          <button
                            type="button"
                            onClick={() => speakText(m.content)}
                            className="flex items-center gap-0.5 rounded px-1 py-0.5 font-mono-ae text-[0.55rem] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                            title="Speak this message"
                            aria-label="Speak this message"
                          >
                            <Volume2 className="h-2.5 w-2.5" />
                            speak
                          </button>
                        </div>
                      )}
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
                    {/* Feature 6: proactive suggestions */}
                    {showSuggestions && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {suggestions.map((s, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => sendSuggestion(s)}
                            className="rounded-full border border-[oklch(0.74_0.22_300)]/30 bg-[oklch(0.74_0.22_300)]/[0.08] px-2 py-0.5 font-mono-ae text-[0.58rem] text-[oklch(0.74_0.22_300)] transition-colors hover:bg-[oklch(0.74_0.22_300)]/20"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-0.5 font-mono-ae text-[0.55rem] text-muted-foreground/40">
                      {mounted ? new Date(m.time).toLocaleTimeString("en-US", { hour12: false }) : "—"}
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {aiBusy && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2">
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

          {/* Feature 4: file preview chip */}
          <AnimatePresence>
            {attachedFile && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-t border-border/40 px-2.5"
              >
                <div className="flex items-center gap-2 py-1.5">
                  {attachedFile.kind === "image" ? (
                    <img
                      src={attachedFile.data}
                      alt={attachedFile.name}
                      className="h-8 w-8 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-[oklch(0.82_0.17_195)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono-ae text-[0.62rem] text-foreground">
                      {attachedFile.name}
                    </p>
                    <p className="font-mono-ae text-[0.55rem] text-muted-foreground">
                      {attachedFile.kind} · {formatBytes(attachedFile.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={removeAttachment}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                    aria-label="Remove attachment"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* input */}
          <form onSubmit={submit} className="border-t border-border/50 p-2.5">
            <div className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-card/50 px-2 py-1 focus-within:border-[oklch(0.74_0.22_300)]/50">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-[oklch(0.74_0.22_300)]" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Tell N-Core what to optimise…"
                className="min-w-0 flex-1 bg-transparent py-2 font-mono-ae text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
              {/* Feature 1: voice input */}
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleVoice}
                  className={cn(
                    "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
                    voiceListening
                      ? "bg-[oklch(0.65_0.22_25)]/20 text-[oklch(0.65_0.22_25)]"
                      : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                  )}
                  aria-label={voiceListening ? "Stop voice input" : "Start voice input"}
                  title={voiceListening ? "Stop listening" : "Voice input"}
                >
                  {voiceListening ? (
                    <>
                      <span className="absolute inset-0 animate-ping rounded-md bg-[oklch(0.65_0.22_25)]/40" />
                      <MicOff className="relative h-3 w-3" />
                    </>
                  ) : (
                    <Mic className="h-3 w-3" />
                  )}
                </button>
              )}
              {/* Feature 4: file upload */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                aria-label="Attach a file"
                title="Attach image or text file"
              >
                <Paperclip className="h-3 w-3" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.webp,.txt,.md,.json,.ts,.tsx,.js,.jsx,.py"
                onChange={handleFileSelect}
                className="hidden"
                aria-hidden="true"
              />
              <button
                type="submit"
                disabled={(!input.trim() && !attachedFile) || sending}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[oklch(0.74_0.22_300)]/20 text-[oklch(0.74_0.22_300)] transition-colors hover:bg-[oklch(0.74_0.22_300)]/30 disabled:opacity-30"
                aria-label="Send"
              >
                {sending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
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
