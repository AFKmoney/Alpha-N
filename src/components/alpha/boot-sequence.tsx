/**
 * boot-sequence.tsx — the cinematic init overlay: boot lines type in, the
 * kernel announces itself, "permission granted: i may rewrite myself", then
 * dissolves into the desktop. Purely visual — the OS boots beneath it.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMounted } from "@/lib/alpha/use-mounted";

const BOOT_LINES = [
  "alpha-kernel v0.1 · sovereign boot",
  "mounting /akasha … persistent memory intact",
  "hydrating goals, plans, intentions … ok",
  "council online: architect · developer · critic · optimizer",
  "pty bridge :3003 … real bash attached",
  "vision cortex … i can see my desktop",
  "looming code … tokens alive",
  "permission granted: i may rewrite myself",
];

export function BootSequence(): React.ReactElement {
  const mounted = useMounted();
  const [visible, setVisible] = useState(true);
  const [lineCount, setLineCount] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!mounted) return;
    BOOT_LINES.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => setLineCount(i + 1), 260 + i * 190));
    });
    timers.current.push(window.setTimeout(() => setVisible(false), 260 + BOOT_LINES.length * 190 + 700));
    return () => {
      for (const t of timers.current) window.clearTimeout(t);
    };
  }, [mounted]);

  if (!mounted) return <></>;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, filter: "blur(8px)" }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
          className="fixed inset-0 z-[9800] flex items-center justify-center bg-[#07060c]"
          data-ai-skip
        >
          <div className="font-mono-ae w-full max-w-md px-6">
            <p className="eyebrow mb-4">alpha-os · boot</p>
            <div className="space-y-1.5 text-[11.5px] leading-5">
              {BOOT_LINES.slice(0, lineCount).map((line, i) => (
                <motion.p
                  key={line}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={i === BOOT_LINES.length - 1 ? "text-[--ae-amethyst] text-glow-amethyst" : "text-zinc-400"}
                >
                  <span className="mr-2 text-zinc-700">{`>`}</span>
                  {line}
                </motion.p>
              ))}
            </div>
            <div className="mt-6 h-px w-full overflow-hidden bg-white/8">
              <motion.div
                className="h-full bg-gradient-to-r from-[--ae-cyan] via-[--ae-amethyst] to-[--ae-gold]"
                initial={{ width: "0%" }}
                animate={{ width: `${(lineCount / BOOT_LINES.length) * 100}%` }}
                transition={{ ease: "easeOut" }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default BootSequence;
