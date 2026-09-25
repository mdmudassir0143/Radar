import {
  ClockBars,
  DelayHist,
  DegreeBars,
  Gauge,
  Meter,
  MixBars,
  ShareRing,
  Spark,
  VolumeBars,
} from "./charts";
import { fraudReport, POLICY_GUIDE, SUBCENT_QUOTA } from "./fraud";
import type { Analysis } from "./api";

const KIND: Record<string, string> = {
  human: "Looks human",
  script: "Looks scripted",
  engine: "Looks like an engine",
  keeper: "Looks like a keeper",
};

const USE: Record<string, string> = {
  micro: "Looks like x402 micros",
  mixed: "Mixed — some tickets too big",
  inflate: "Volume inflate — not micros",
  plain: "Missing x402 notes",
};

const POLICY: Record<string, string> = {
  clear: "Within facilitator policy",
  watch: "Some money-path signals",
  synthetic: "Synthetic traffic pattern",
  quota: "Sub-cent allowance at risk",
};

function money(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

const TICKET = [
  "var(--in)",
  "var(--ice)",
  "var(--peer)",
  "var(--out)",
  "var(--share-5)",
  "var(--mute)",
];

export function FraudView({ analysis }: { analysis: Analysis }) {
  const report = fraudReport(analysis);
  const tickets = [...analysis.tickets].sort((a, b) => b.count - a.count).slice(0, 6);
  const cronHits = report.cronBuckets.filter((row) => row.label !== "other").reduce((sum, row) => sum + row.count, 0);
  const cronOther = report.cronBuckets.find((row) => row.label === "other")?.count ?? 0;

  const use = report.use;
  const microUsdc = use.bands[0]?.usdc ?? 0;
  const midUsdc = (use.bands[1]?.usdc ?? 0) + (use.bands[2]?.usdc ?? 0);
  const macroUsdc = use.bands[3]?.usdc ?? 0;

  const policy = report.policy;
  const pathHits = policy.selfPay + policy.fundedBack;
  const realHits = Math.max(0, policy.settleCount - pathHits);
  const priced = Math.max(0, policy.settleCount - policy.subcent);

  return (
    <div className="fraud">
      <section className="kind-row use-row">
        {(["clear", "watch", "synthetic", "quota"] as const).map((kind) => (
          <div key={kind} className={`kind-chip${policy.kind === kind ? ` on ${kind}` : ""}`}>
            <span className="kind-bar" />
            <b>{kind}</b>
            <span>{POLICY[kind]}</span>
          </div>
        ))}
      </section>

      <section className="instruments">
        <Gauge title="Policy risk" value={policy.risk} cap={policy.kind} warn="low" />
        <DegreeBars title="What the facilitator actually weighs" rows={policy.parts} />
        <Meter
          title="Self-pay"
          value={policy.selfPay}
          max={Math.max(policy.selfPay, policy.settleCount, 4)}
          hint={`${policy.selfPay} inbound from the receiving address itself`}
          hot={policy.selfPay >= 3}
        />
        <Meter
          title="Funded, then paid back"
          value={policy.fundedBack}
          max={Math.max(policy.fundedBack, policy.settleCount, 4)}
          hint={`${policy.fundedBack} settles from wallets this payTo funded first`}
          hot={policy.settleCount > 0 && policy.fundedBack / policy.settleCount >= 0.4}
        />
        <Meter
          title="Money sent back to payers"
          value={policy.sentBack}
          max={Math.max(policy.sentBack, policy.settleCount, 4)}
          hint={`${policy.sentBack} inbound from wallets that also received outbound`}
          hot={policy.settleCount > 0 && policy.sentBack / policy.settleCount >= 0.4}
        />
        <Meter
          title="New-wallet fleet"
          value={policy.newFleet}
          max={Math.max(policy.newFleet, policy.settleCount, 4)}
          hint={`${policy.newFleet} late, thin payers — fleets that pay only you`}
          hot={policy.settleCount > 0 && policy.newFleet / policy.settleCount >= 0.45}
        />
        <Meter
          title="Sub-cent vs 1,000 / month"
          value={policy.subcentMonth}
          max={SUBCENT_QUOTA}
          hint={`${policy.subcentMonth} of ${SUBCENT_QUOTA} free MainNet sub-cent settles this UTC month`}
          hot={policy.subcentMonth >= SUBCENT_QUOTA * 0.9}
        />
        <Meter
          title="Still running"
          value={policy.continuous ? 1 : 0}
          max={1}
          hint={
            policy.continuous
              ? "Last settle is recent — continuity counts toward a block"
              : "Traffic has stopped — merchants who stop are not blocked"
          }
          hot={policy.continuous && policy.kind === "synthetic"}
        />
        <Meter
          title="Settle count — not dollars"
          value={policy.settleCount}
          max={Math.max(policy.settleCount, 40)}
          hint={`${policy.settleCount} inbound — policy weighs count and continuity, not USDC volume`}
          hot={policy.settleCount >= 40 && policy.pathShare >= 0.25}
        />
        <MixBars
          title="Independent vs synthetic money path"
          inbound={realHits}
          outbound={pathHits}
          peer={0}
          names={{ inbound: "independent", outbound: "self / funded", peer: "" }}
        />
        <MixBars
          title="At least $0.01 vs sub-cent"
          inbound={priced}
          outbound={policy.subcent}
          peer={0}
          names={{ inbound: "≥ $0.01", outbound: "< $0.01", peer: "" }}
        />
      </section>
      {policy.blocked ? (
        <p className="status bad">
          Already blocked on the facilitator: {policy.blocked}. Payer wallets are never blocked.
        </p>
      ) : null}
      <p className="meta">
        From the{" "}
        <a href={POLICY_GUIDE} target="_blank" rel="noreferrer">
          GoPlausible merchant policy
        </a>
        : synthetic means the payer is the merchant, a wallet it funded, or a fleet whose money it
        sends back. Automation, low prices, high volume, and a single endpoint are not held against
        you. Machine timing never decides a block on its own.
      </p>

      <section className="kind-row use-row">
        {(["micro", "mixed", "inflate", "plain"] as const).map((kind) => (
          <div key={kind} className={`kind-chip${use.kind === kind ? ` on ${kind}` : ""}`}>
            <span className="kind-bar" />
            <b>{kind}</b>
            <span>{USE[kind]}</span>
          </div>
        ))}
      </section>

      <section className="instruments">
        <Gauge title="x402 use-case fit — not a block reason" value={use.fit} cap={use.kind} warn="low" />
        <DegreeBars title="Ticket mix — policy does not weigh volume" rows={use.parts} />
        <Meter
          title="Median ticket"
          value={use.medianTicket}
          max={Math.max(use.medianTicket, 10)}
          hint={`${money(use.medianTicket)} — x402 is cents to a few dollars`}
          hot={use.medianTicket >= 10}
        />
        <Meter
          title="Average ticket"
          value={use.avgTicket}
          max={Math.max(use.avgTicket, 10)}
          hint={`${money(use.avgTicket)} across ${use.settles} inbound`}
          hot={use.avgTicket >= 10}
        />
        <Meter
          title="x402 notes on inbound"
          value={use.x402Share * 100}
          max={100}
          hint={`${(use.x402Share * 100).toFixed(0)}% of inbound carry an x402 note`}
          hot={use.x402Share < 0.25}
        />
        <Meter
          title="USDC per settle"
          value={use.dollarsPerSettle}
          max={Math.max(use.dollarsPerSettle, 10)}
          hint={`${money(use.volume)} / ${use.settles} settles — high $ few hits is inflate`}
          hot={use.dollarsPerSettle >= 20}
        />
        <Meter
          title="Leaderboard mismatch"
          value={Math.max(0, use.macroVolShare - use.macroCountShare) * 100}
          max={100}
          hint={`${(use.macroVolShare * 100).toFixed(0)}% of USDC from ${(use.macroCountShare * 100).toFixed(0)}% of settles`}
          hot={use.macroVolShare - use.macroCountShare >= 0.4}
        />
        {use.volume ? (
          <ShareRing
            title="Volume by ticket size — micros vs $100+"
            slices={use.bands
              .filter((row) => row.usdc > 0)
              .map((row, i) => ({
                label: row.label,
                value: row.usdc,
                color: TICKET[i] ?? "var(--mute)",
              }))}
          />
        ) : null}
        <DegreeBars
          title="USDC sitting in each ticket band"
          rows={use.bands.map((row) => ({ label: row.label, value: Number(row.usdc.toFixed(2)) }))}
        />
        <DegreeBars
          title="Settle count in each ticket band"
          rows={use.bands.map((row) => ({ label: row.label, value: row.count }))}
        />
        <MixBars
          title="Where the USDC actually is"
          inbound={microUsdc}
          outbound={midUsdc}
          peer={macroUsdc}
          names={{ inbound: "<$1", outbound: "$1–100", peer: "$100+" }}
        />
      </section>

      <section className="kind-row">
        {(["human", "script", "engine", "keeper"] as const).map((kind) => (
          <div key={kind} className={`kind-chip${report.kind === kind ? ` on ${kind}` : ""}`}>
            <span className="kind-bar" />
            <b>{kind}</b>
            <span>{KIND[kind]}</span>
          </div>
        ))}
      </section>

      <section className="instruments">
        <Gauge title="Machine timing — never decides alone" value={report.score} cap={report.kind} />
        <DegreeBars title="Cadence clues only" rows={report.parts} />
        <Meter
          title="Delay spread"
          value={report.delays.gaps.length ? Math.max(0, 1.2 - report.delays.cv) : 0}
          max={1.2}
          hint={
            report.delays.gaps.length
              ? `spread ${report.delays.cv.toFixed(2)} — low is a metronome`
              : "not enough settles"
          }
          hot={report.signals.find((s) => s.label === "delay spread")?.hot}
        />
        <Meter
          title="Top ticket share"
          value={report.topTicketShare * 100}
          max={100}
          hint={`${(report.topTicketShare * 100).toFixed(0)}% of inbound at one price`}
          hot={report.topTicketShare >= 0.55}
        />
        <Meter
          title="UTC hours used"
          value={report.hourCoverage * 24}
          max={24}
          hint={`${Math.round(report.hourCoverage * 24)} of 24 hours have inbound`}
          hot={report.hourCoverage >= 0.5}
        />
        <Meter
          title="Cron-like gaps"
          value={report.intervalSnap * 100}
          max={100}
          hint={`${(report.intervalSnap * 100).toFixed(0)}% of gaps sit on 1m / 5m / 1h`}
          hot={report.intervalSnap >= 0.25}
        />
        <Meter
          title="Same-second stacks"
          value={report.sameSecond}
          max={Math.max(report.sameSecond, report.uniqueSeconds * 0.2, 4)}
          hint={`${report.sameSecond} stacked vs ${report.uniqueSeconds} unique seconds`}
          hot={report.sameSecond >= 4}
        />
        <Meter
          title="Settles per day"
          value={report.settlesPerDay}
          max={Math.max(report.settlesPerDay, 50)}
          hint={`${report.settlesPerDay.toFixed(1)} inbound / day`}
          hot={report.settlesPerDay >= 20}
        />
      </section>

      {report.cadence.length ? (
        <Spark
          title="Cadence — gap before each inbound settle"
          values={report.cadence}
          hint="A flat line is a keeper. Spikes are human pauses."
        />
      ) : null}

      <section className="instruments">
        <DelayHist title="How long between settles" stats={report.delays} />
        <DegreeBars
          title="Gaps that match cron ticks"
          rows={report.cronBuckets.map((row) => ({ label: row.label, value: row.count }))}
        />
        <MixBars
          title="Cron-like vs irregular gaps"
          inbound={cronHits}
          outbound={cronOther}
          peer={0}
          names={{ inbound: "cron", outbound: "irregular", peer: "" }}
        />
        {tickets.length ? (
          <ShareRing
            title="Ticket mix — why one price looks scripted"
            slices={tickets.map((row, i) => ({
              label: `$${row.amount.toFixed(row.amount < 0.01 ? 4 : 2)}`,
              value: row.count,
              color: TICKET[i] ?? "var(--mute)",
            }))}
          />
        ) : null}
        <DegreeBars
          title="Repeated ticket sizes"
          rows={tickets.map((row) => ({
            label: `$${row.amount.toFixed(row.amount < 0.01 ? 4 : 2)}`,
            value: row.count,
          }))}
        />
        <ClockBars title="Which UTC hours fire" hours={analysis.hours} />
        {analysis.daily.length ? (
          <VolumeBars
            title="Inbound USDC by day"
            labels={analysis.daily.map((d) => d.day.slice(5))}
            values={analysis.daily.map((d) => d.usdc)}
          />
        ) : null}
        {analysis.daily.length ? (
          <VolumeBars
            title="Inbound settles by day"
            labels={analysis.daily.map((d) => d.day.slice(5))}
            values={analysis.daily.map((d) => d.settles)}
          />
        ) : null}
        <MixBars
          title="Unique seconds vs stacked hits"
          inbound={Math.max(report.uniqueSeconds - report.sameSecond, 0)}
          outbound={report.sameSecond}
          peer={0}
          names={{ inbound: "unique", outbound: "stacked", peer: "" }}
        />
      </section>
      <p className="meta">
        Policy first, then ticket mix and cadence. A block is only for continuous, large-scale
        synthetic traffic, or a sub-cent quota refuse. This is a pattern read against the published
        guide, not a facilitator decision.
      </p>
    </div>
  );
}
