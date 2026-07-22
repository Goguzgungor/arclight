"use client";

import { useEffect, useRef, useState } from "react";

const CMD = "kubectl apply -f indexer.yaml";
const START_HEAD = 8_123_456;
const BACKFILL_FROM = 8_101_338;

type Phase = "typing" | "created" | "provisioning" | "backfilling" | "live";
type Row = { bn: number; from: string; to: string; value: string };

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGen(seed: number) {
  const rng = mulberry32(seed);
  const hex = (n: number) =>
    Array.from({ length: n }, () =>
      "0123456789abcdef".charAt(Math.floor(rng() * 16))
    ).join("");
  const addr = () => `0x${hex(4)}…${hex(4)}`;
  const value = () => {
    const v = rng() < 0.18 ? rng() * 240_000 + 10_000 : rng() * 4_800 + 12;
    return v.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };
  return (bn: number): Row => ({ bn, from: addr(), to: addr(), value: value() });
}

const fmt = (n: number) => n.toLocaleString("en-US");

export default function HeroTerminal() {
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("typing");
  const [current, setCurrent] = useState(BACKFILL_FROM);
  const [head, setHead] = useState(START_HEAD);
  const [rows, setRows] = useState<Row[]>([]);
  const genRef = useRef(makeGen(20260701));

  useEffect(() => {
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => alive && fn(), ms);
      timers.push(t);
    };
    const gen = genRef.current;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setTyped(CMD);
      setPhase("live");
      setCurrent(START_HEAD);
      setRows(Array.from({ length: 4 }, (_, i) => gen(START_HEAD - i)));
      return;
    }

    for (let i = 1; i <= CMD.length; i++) {
      later(() => setTyped(CMD.slice(0, i)), 350 + i * 34);
    }
    const t0 = 350 + CMD.length * 34;

    later(() => setPhase("created"), t0 + 450);
    later(() => setPhase("provisioning"), t0 + 1250);
    later(() => setPhase("backfilling"), t0 + 2600);

    const STEPS = 26;
    for (let i = 1; i <= STEPS; i++) {
      const e = 1 - Math.pow(1 - i / STEPS, 3);
      later(
        () =>
          setCurrent(
            Math.round(BACKFILL_FROM + (START_HEAD - BACKFILL_FROM) * e)
          ),
        t0 + 2600 + i * 95
      );
    }

    later(() => {
      setPhase("live");
      setRows([gen(START_HEAD)]);
      let h = START_HEAD;
      const tick = setInterval(() => {
        if (!alive) return;
        h += 1;
        setHead(h);
        setCurrent(h);
        setRows((r) => [gen(h), ...r].slice(0, 4));
      }, 1200);
      timers.push(tick as unknown as ReturnType<typeof setTimeout>);
    }, t0 + 2600 + STEPS * 95 + 500);

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, []);

  const lag = head - current;
  const kubePhase =
    phase === "provisioning"
      ? "Provisioning"
      : phase === "backfilling"
        ? "Backfilling"
        : "Live";

  return (
    <div className="term">
      <div className="term-bar">
        <span className="term-dot" />
        <span className="term-dot" />
        <span className="term-dot" />
        <span className="term-title">arckive — usdc-arc</span>
        {phase === "live" && (
          <span className="status-live term-title" style={{ marginLeft: "auto" }}>
            <span className="pulse-dot" />
            streaming
          </span>
        )}
      </div>
      <div className="term-body" aria-live="off">
        <div>
          <span className="dim">$ </span>
          {typed}
          {phase === "typing" && <span className="caret" />}
        </div>
        {phase !== "typing" && (
          <div className="ok">indexer.arckive.org/usdc-arc created</div>
        )}
        {phase !== "typing" && phase !== "created" && (
          <>
            <div>
              <span className="dim">$ </span>kubectl get indexers usdc-arc -w
            </div>
            <pre className="dim">
              {"NAME       PHASE          CURRENT      HEAD         LAG"}
            </pre>
            <pre>
              {"usdc-arc   "}
              <span
                className={
                  phase === "live"
                    ? "ok"
                    : phase === "backfilling"
                      ? "warn"
                      : "blue"
                }
              >
                {kubePhase.padEnd(15)}
              </span>
              {phase === "provisioning"
                ? "—            —            —"
                : `${fmt(current).padEnd(13)}${fmt(head).padEnd(13)}${fmt(lag)}`}
            </pre>
            {phase === "live" && (
              <>
                <pre className="dim">
                  {"\n-- idx_usdc_arc.usdc_transfer  (your postgres)"}
                </pre>
                {rows.map((r, i) => (
                  <pre key={r.bn} className={i === 0 ? "row-fresh" : ""}>
                    <span className="blue">{fmt(r.bn)}</span>
                    {"  "}
                    {r.from} <span className="dim">→</span> {r.to}
                    {"  "}
                    <span className="ok">{r.value.padStart(11)}</span>
                  </pre>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
