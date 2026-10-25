import Link from "next/link";

import { createApiClient, readApiBaseUrl } from "@/lib/api/client";
import { loadStatus, type CheckState, type StatusReport } from "@/lib/status";

// Each request checks the live API. Nothing is cached.
export const dynamic = "force-dynamic";

const LABELS: Record<CheckState, string> = {
  ok: "Working",
  unreachable: "Not reachable",
  unknown: "Not checked",
  "not-configured": "Not configured",
};

export const metadata = {
  title: "System status",
  description: "Live status of the Holoraa API and database.",
};

export default async function StatusPage() {
  const baseUrl = readApiBaseUrl();
  const report = await loadStatus(baseUrl === null ? null : createApiClient(baseUrl));

  return (
    <main className="page">
      <header>
        <h1>Holoraa status</h1>
        <p className="lede">Live check of the API and database. Nothing is cached.</p>
      </header>

      <section className="checks" aria-label="System checks">
        <StatusCard title="API" state={report.api.state} />
        <StatusCard
          title="Database"
          state={report.database.state}
          detail={report.database.state === "unreachable" ? report.database.detail : undefined}
        />
      </section>

      <p className="meta">
        Checked <time dateTime={report.checkedAt}>{formatTime(report)}</time>
      </p>
      <p className="meta">
        <Link href="/">Back to Holoraa</Link>
      </p>
    </main>
  );
}

function StatusCard({ title, state, detail }: { title: string; state: CheckState; detail?: string }) {
  return (
    <article className={`card card--${state}`}>
      <h2>{title}</h2>
      <p className="state">{LABELS[state]}</p>
      {detail ? <p className="detail">{detail.slice(0, 200)}</p> : null}
    </article>
  );
}

function formatTime(report: StatusReport): string {
  return new Date(report.checkedAt).toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false }) + " UTC";
}
