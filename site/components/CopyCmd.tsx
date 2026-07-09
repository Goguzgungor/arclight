"use client";

import { useRef, useState } from "react";

export default function CopyCmd({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <span className="install">
      <span>
        <span className="dollar">$ </span>
        {cmd}
      </span>
      <button
        type="button"
        className={`copy-btn${copied ? " copied" : ""}`}
        onClick={copy}
      >
        {copied ? "copied ✓" : "copy"}
      </button>
    </span>
  );
}
