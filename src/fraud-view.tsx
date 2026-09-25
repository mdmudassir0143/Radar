import { ClockBars, DelayHist, DegreeBars } from "./charts";
import { fraudReport } from "./fraud";
import type { Analysis } from "./api";

const KIND: Record<string, string> = {
  human: "Looks human",
  script: "Looks scripted",
  engine: "Looks like an engine",
  keeper: "Looks like a keeper",
};

export function FraudView({ analysis }: { analysis: Analysis }) {
  const report = fraudReport(analysis);
  const tickets = [...analysis.tickets].sort((a, b) => b.count - a.count).slice(0, 6);

  return (
    <div className="fraud">
      <section className={`verdict ${report.kind}`}>
        <p className="meta">{KIND[report.kind]}</p>
        <b>{report.score}</b>
        <span>machine score</span>
        <p>{report.summary}</p>
      </section>

      <section className="kpis six">
        {report.signals.map((signal) => (
          <div key={signal.label} className={`kpi${signal.hot ? " hot" : ""}`}>
            <b>{signal.value}</b>
            <span>{signal.label}</span>
          </div>
        ))}
      </section>
      <p className="meta">
        Hot cells are the parameters that pushed this toward script, engine, or keeper. This is a
        pattern read of on-chain USDC, not a legal finding.
      </p>

      <section className="instruments">
        <DelayHist title="Delay between inbound settles" stats={report.delays} />
        <DegreeBars
          title="Repeated ticket sizes"
          rows={tickets.map((row) => ({
            label: `$${row.amount.toFixed(row.amount < 0.01 ? 4 : 2)}`,
            value: row.count,
          }))}
        />
        <ClockBars title="Inbound activity by UTC hour" hours={analysis.hours} />
      </section>
    </div>
  );
}
