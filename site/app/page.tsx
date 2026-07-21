import Mark from "@/components/Mark";
import ThemeToggle from "@/components/ThemeToggle";
import HeroTerminal from "@/components/HeroTerminal";
import ChaosLab from "@/components/ChaosLab";
import CopyCmd from "@/components/CopyCmd";

function SecHead({ n, label }: { n: string; label: string }) {
  return (
    <div className="sec-head">
      <span className="sec-no">{n}</span>
      <span className="sec-label">{label}</span>
    </div>
  );
}

export default function Page() {
  return (
    <main>
      {/* ———— nav ———— */}
      <nav className="nav">
        <div className="wrap nav-inner">
          <a className="brand" href="#top">
            <Mark size={22} />
            ARCKIVE
          </a>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#reliability">Reliability</a>
            <a href="#benchmarks">Benchmarks</a>
            <a href="#compare">Compare</a>
            <ThemeToggle />
            <a className="nav-cta" href="#cta">
              get started
            </a>
          </div>
        </div>
      </nav>

      {/* ———— hero ———— */}
      <header className="hero" id="top">
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow">Kubernetes-native event indexer for Arc</div>
            <h1>
              Your chain events,
              <br />
              in <span className="accent">your own Postgres</span>.
            </h1>
            <p className="hero-sub">
              Give it an ABI, a contract address, and an RPC. Arckive streams
              every on-chain event into your own PostgreSQL —{" "}
              <strong>one table per event, reliable and gap-free</strong> —
              from a single YAML manifest.
            </p>
            <div className="hero-ctas">
              <a className="cta cta-primary" href="#how">
                see the one manifest
              </a>
              <a className="cta" href="#reliability">
                try to break it
              </a>
            </div>
            <div className="meta-line">
              runs in your cluster · apache-2.0 · arckive.dev/v1alpha1
            </div>
          </div>
          <HeroTerminal />
        </div>
      </header>

      {/* ———— the gap ———— */}
      <div className="gap-strip">
        <div className="wrap gap-inner">
          <span className="gap-label">The gap</span>
          <p>
            Dune is delayed and rate-limited. Raw logs leave reorgs and
            back-fill to you. The Graph means subgraphs and heavy ops. There
            was no declarative path to your events, in your Postgres, in plain
            SQL.
          </p>
        </div>
      </div>

      {/* ———— 01 how it works ———— */}
      <section id="how" className="section">
        <div className="wrap">
          <SecHead n="01" label="How it works" />
          <h2>Declare it. The operator does the rest.</h2>
          <p className="lede">
            One <code>Indexer</code> resource describes what you want. A
            Kubernetes operator keeps it true — database, schema, listener,
            optional read API.
          </p>

          <div className="steps">
            <div className="step-card">
              <div className="step-no">STEP 1</div>
              <h3>Write one manifest</h3>
              <p>
                Contracts, ABI ref, RPC pool, storage mode — the whole setup.
              </p>
              <div className="step-code">
                <pre>
                  <span className="k">kind</span>: Indexer{"\n"}
                  <span className="k">metadata</span>: {"{ "}
                  <span className="k">name</span>: usdc-arc{" }\n"}
                  <span className="k">spec</span>:{"\n"}
                  {"  "}
                  <span className="k">rpc</span>:{" "}
                  <span className="c"># health-checked failover</span>
                  {"\n"}
                  {"    - "}
                  <span className="s">https://rpc.arc.example</span>
                  {"\n"}
                  {"  "}
                  <span className="k">storage</span>: {"{ "}
                  <span className="k">mode</span>: Embedded{" }\n"}
                  {"  "}
                  <span className="k">contracts</span>:{"\n"}
                  {"    - "}
                  <span className="k">address</span>:{" "}
                  <span className="s">&quot;0xA0b8…eB48&quot;</span>
                  {"\n"}
                  {"      "}
                  <span className="k">abi</span>: {"{ "}
                  <span className="k">configMapRef</span>: usdc-abi{" }\n"}
                  {"      "}
                  <span className="k">startBlock</span>: 0
                </pre>
              </div>
            </div>

            <div className="step-card">
              <div className="step-no">STEP 2</div>
              <h3>The operator provisions</h3>
              <p>
                A reconcile loop turns the spec into running parts — and heals
                them.
              </p>
              <div className="step-flow">
                <div className="node">Indexer CR — 1 YAML</div>
                <div className="link">↓ reconciles</div>
                <div className="node hot">Arckive Operator</div>
                <div className="link">↓ provisions</div>
                <div className="node">postgres · schema · worker · read API</div>
                <div className="heal">
                  pod dies? config drifts? it converges back.
                </div>
              </div>
            </div>

            <div className="step-card">
              <div className="step-no">STEP 3</div>
              <h3>Query plain SQL</h3>
              <p>
                Each event is a table in your Postgres. No API between you and
                your data.
              </p>
              <div className="step-code">
                <pre>
                  <span className="c">-- one table per event</span>
                  {"\n"}
                  <span className="k">SELECT</span> &quot;from&quot;,
                  &quot;to&quot;, value{"\n"}
                  <span className="k">FROM</span> usdc_transfer{"\n"}
                  <span className="k">WHERE</span> value &gt; 1000000000{"\n"}
                  <span className="k">ORDER BY</span> block_number{" "}
                  <span className="k">DESC</span>;
                </pre>
                <div className="sql-rows">
                  <span className="r">
                    <span>
                      0x3786…39b3 <span className="c">→</span> 0xdbcc…38db
                    </span>
                    <b>3,020.95</b>
                  </span>
                  <span className="r">
                    <span>
                      0xb51a…159a <span className="c">→</span> 0xa7b3…5993
                    </span>
                    <b>3,454.57</b>
                  </span>
                  <span className="r">
                    <span>
                      0x9f21…c04a <span className="c">→</span> 0x53d0…b7da
                    </span>
                    <b>60,884.96</b>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <p className="steps-note">
            ABI in → tables out · empty events list = every event ·{" "}
            <code>startBlock: 0</code> backfills from genesis
          </p>
        </div>
      </section>

      {/* ———— 02 reliability ———— */}
      <section id="reliability" className="section">
        <div className="wrap">
          <SecHead n="02" label="Reliability" />
          <h2>Even if the network blips, no data is lost.</h2>

          <div className="rel-grid">
            <div>
              <p className="lede">
                A poll-based backbone chosen for loss-free, self-healing
                ingestion — not just latency. Don&apos;t take our word for it:
                break something.
              </p>
              <div className="mech-list">
                <div className="mech">
                  <b>Cursor + checkpoint</b>
                  <p>
                    The last processed block lives in Postgres. After any crash
                    it resumes exactly there.
                  </p>
                </div>
                <div className="mech">
                  <b>Gap-free backfill</b>
                  <p>
                    Event inserts and cursor advance share one transaction — a
                    commit, or nothing.
                  </p>
                </div>
                <div className="mech">
                  <b>Reorg-safe on Arc</b>
                  <p>
                    Indexes to the <code>finalized</code> tag — BFT finality
                    means finalized blocks never reorg.
                  </p>
                </div>
                <div className="mech">
                  <b>RPC failover</b>
                  <p>
                    A health-checked pool with rotation, backoff,
                    circuit-breaker. A blip never becomes a gap.
                  </p>
                </div>
              </div>
            </div>

            <ChaosLab />
          </div>
        </div>
      </section>

      {/* ———— 03 benchmarks ———— */}
      <section id="benchmarks" className="section">
        <div className="wrap">
          <SecHead n="03" label="Benchmarks" />
          <h2>Measured, not promised.</h2>
          <p className="lede">
            Every number comes from running the real worker against the public
            Arc testnet and reading only its production surface — Postgres rows
            and <code>/metrics</code>. Reproduce it with <code>pnpm bench</code>.
          </p>

          <div className="bench-grid">
            <div className="bench-tile">
              <div className="bench-label">block → SQL, p50</div>
              <div className="bench-value">395ms</div>
              <p>
                Block close to queryable row on Arc testnet — live USDC traffic,
                WebSocket <code>newHeads</code> listening, not polling. Even p99
                stays under a second (0.97s).
              </p>
            </div>
            <div className="bench-tile">
              <div className="bench-label">backfill catch-up</div>
              <div className="bench-value">92.6 blocks/s</div>
              <p>
                5,107 blocks of real USDC history caught up in 55 seconds over a
                public RPC — ~48× faster than the chain. Zero RPC errors.
              </p>
            </div>
            <div className="bench-tile">
              <div className="bench-label">burst ingest</div>
              <div className="bench-value">2,628 events/s</div>
              <p>
                The decode + transactional-SQL write ceiling, measured with WAN
                latency out of the picture.
              </p>
            </div>
          </div>

          <p className="bench-note">
            The budget is published too: the head signal is consumed straight
            from the <code>newHeads</code> payload and one parallel{" "}
            <code>eth_getLogs</code> round-trip later the row is committed —
            the engine itself adds ~40ms; the rest of the latency belongs to
            how fast the RPC announces blocks — and it shrinks further with a
            cluster-local Arc node. Full methodology and raw results:{" "}
            <a href="/benchmarks.html">benchmark report</a> ·{" "}
            <a href="https://github.com/Goguzgungor/arclight/tree/main/docs/benchmarks">
              docs/benchmarks
            </a>
            .
          </p>
        </div>
      </section>

      {/* ———— 04 compare ———— */}
      <section id="compare" className="section">
        <div className="wrap">
          <SecHead n="04" label="Compare" />
          <h2>A specific combination nobody else offers.</h2>

          <div className="compare-scroll">
            <table className="compare">
              <thead>
                <tr>
                  <th />
                  <th>Dune</th>
                  <th>The Graph</th>
                  <th>Raw RPC</th>
                  <th className="us">Arckive</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Data in your own DB</td>
                  <td className="they">No</td>
                  <td className="they">Via graph-node</td>
                  <td className="they">If you build it</td>
                  <td className="us">✓ Yes</td>
                </tr>
                <tr>
                  <td>Plain SQL access</td>
                  <td className="they">Dune SQL only</td>
                  <td className="they">GraphQL</td>
                  <td className="they">Raw JSON</td>
                  <td className="us">✓ Yes</td>
                </tr>
                <tr>
                  <td>Reorg &amp; gap handling</td>
                  <td className="they">Theirs</td>
                  <td className="they">Yes</td>
                  <td className="they">On you</td>
                  <td className="us">✓ Built-in</td>
                </tr>
                <tr>
                  <td>Setup effort</td>
                  <td className="they">Low</td>
                  <td className="they">Med–high</td>
                  <td className="they">High</td>
                  <td className="us">✓ One YAML</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="honest">
            <strong>Honest positioning:</strong> Dune stays great for ad-hoc
            analytics; The Graph for hosted multi-chain. Arckive is for teams
            that want their own Postgres, plain SQL, and K8s-native ops —
            together.
          </p>
        </div>
      </section>

      {/* ———— cta ———— */}
      <section id="cta" className="cta-band">
        <div className="wrap">
          <div className="sec-label">Get started</div>
          <h2>One YAML. A running indexer.</h2>
          <p>Runs in your cluster. Your data never leaves it.</p>
          <CopyCmd cmd="kubectl apply -f arckive.dev/install.yaml" />
          <div className="meta-line cta-meta">
            runs in your cluster · apache-2.0 · v1alpha1
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap">
          <span>ARCKIVE — Kubernetes-native event indexer for Arc</span>
          <span>© 2026 Arckive · Apache-2.0</span>
        </div>
      </footer>
    </main>
  );
}
