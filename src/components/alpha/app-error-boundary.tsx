/**
 * app-error-boundary.tsx — isolates a single app's render errors so a crash
 * in one window (e.g. a malformed AI-generated app) never brings down the
 * whole desktop. Each WindowFrame wraps its content in this boundary; on
 * error it shows a compact fallback with a retry button and the stack.
 *
 * Previously, an exception thrown during render of any app would propagate
 * up and blank the entire OS. This is the safety net.
 */
"use client";

import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  /** A friendly name for the app, shown in the fallback. */
  appName: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  retryNonce: number;
}

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, retryNonce: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the console so the AI's compile/observation loop can see it.
    console.error(`[alpha-n] app "${this.props.appName}" crashed:`, error, info.componentStack);
  }

  private retry = () => {
    // Bump the key so the subtree remounts fresh.
    this.setState((s) => ({ error: null, retryNonce: s.retryNonce + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background/60 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-[oklch(0.7_0.22_40)]" />
          <div>
            <p className="font-mono-ae text-sm text-foreground">
              {this.props.appName} — erreur d&apos;exécution
            </p>
            <p className="mt-1 max-w-md text-[0.7rem] text-muted-foreground">
              Cette fenêtre a crashé mais le reste de l&apos;OS continue de tourner.
              L&apos;erreur est isolée.
            </p>
          </div>
          <pre className="max-h-32 w-full max-w-md overflow-auto rounded-lg border border-border/50 bg-card/40 p-2 text-left font-mono-ae text-[0.6rem] text-[oklch(0.72_0.18_40)]">
            {this.state.error.message.slice(0, 400)}
          </pre>
          <button
            onClick={this.retry}
            className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-xs transition-all hover:bg-card/70"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="font-mono-ae">relancer</span>
          </button>
        </div>
      );
    }
    return <div key={this.state.retryNonce} className="h-full w-full">{this.props.children}</div>;
  }
}
