"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { Badge, Spinner } from "@/components/ui/Badge";
import { ConfidenceGauge } from "@/components/b2b/ConfidenceGauge";
import { NarrativeSection } from "@/components/b2b/NarrativeSection";
import { ComparablesTable } from "@/components/b2b/ComparablesTable";
import { UnauthorizedFallback, isUnauthorizedError } from "@/components/b2b/UnauthorizedFallback";

function formatEtb(value: number): string {
  return `${Math.round(value).toLocaleString()} ETB`;
}

const METHODOLOGY_LABELS: Record<string, string> = {
  comparable_sales: "Comparable sales",
  cost_approach: "Cost approach",
  hybrid: "Hybrid",
};

export default function B2BValuationReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const reportQuery = useQuery({
    queryKey: ["valuationReport", id],
    queryFn: () => apiClient.getValuationReport(id),
  });

  const aiSummaryQuery = useQuery({
    queryKey: ["aiSummary", id],
    queryFn: () => apiClient.getAiSummary(id),
    enabled: reportQuery.isSuccess,
  });

  const authError = [reportQuery.error, aiSummaryQuery.error].find(isUnauthorizedError);
  if (authError) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <UnauthorizedFallback error={authError} />
      </main>
    );
  }

  if (reportQuery.isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Spinner label="Loading valuation report…" />
      </main>
    );
  }

  if (reportQuery.isError) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p role="alert" className="text-sm text-red-700">
          {reportQuery.error instanceof ApiClientError
            ? reportQuery.error.message
            : "Something went wrong while loading this report."}
        </p>
      </main>
    );
  }

  const report = reportQuery.data!;
  const comparables = report.valuationData?.comparables;
  const narrative = aiSummaryQuery.data?.narrative ?? null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-stone-900">Valuation report</h1>
          <Badge tone="neutral">
            {METHODOLOGY_LABELS[report.methodology] ?? report.methodology}
          </Badge>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-stone-500">Property ID</dt>
          <dd className="text-right font-mono text-xs text-stone-700">{report.propertyId}</dd>
          <dt className="text-stone-500">Generated</dt>
          <dd className="text-right text-stone-700">
            {new Date(report.createdAt).toLocaleString()}
          </dd>
        </dl>
      </header>

      <section className="grid grid-cols-1 gap-4 rounded-lg border border-stone-200 bg-white p-5 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
              Low estimate
            </p>
            <p className="text-lg font-semibold text-stone-900">
              {formatEtb(report.lowEstimate)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
              Recommended market value
            </p>
            <p className="text-2xl font-bold text-[#7f3c22]">
              {formatEtb(report.estimatedValue)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
              High estimate
            </p>
            <p className="text-lg font-semibold text-stone-900">
              {formatEtb(report.highEstimate)}
            </p>
          </div>
        </div>
        <ConfidenceGauge confidenceScore={report.confidenceScore} />
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-stone-900">AI narrative report</h2>
        {aiSummaryQuery.isLoading ? (
          <Spinner label="Loading narrative…" />
        ) : (
          <NarrativeSection narrative={narrative} />
        )}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-stone-900">Comparable listings</h2>
        <ComparablesTable comparables={comparables} />
      </section>
    </main>
  );
}
