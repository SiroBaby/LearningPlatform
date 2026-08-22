"use client";

import { useMemo, useState } from "react";
import { Badge, Button } from "@/components/ui";
import type { Job } from "@/lib/types";
import { AdminMockActionButton } from "./admin-mock-action-button";

type JobFilter = "all" | Job["status"];

const filters: readonly JobFilter[] = [
  "all",
  "running",
  "pending",
  "completed",
  "failed",
] as const;

function getStatusTone(status: Job["status"]): "brand" | "success" | "warning" | "error" {
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "pending") return "warning";
  return "brand";
}

function getFilterCount(jobs: readonly Job[], filter: JobFilter): number {
  if (filter === "all") return jobs.length;
  return jobs.filter((job) => job.status === filter).length;
}

export function AdminJobsBoard({ jobs }: { jobs: readonly Job[] }) {
  const [activeFilter, setActiveFilter] = useState<JobFilter>("all");

  const filteredJobs = useMemo(() => {
    if (activeFilter === "all") return jobs;
    return jobs.filter((job) => job.status === activeFilter);
  }, [activeFilter, jobs]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => (
          <Button
            key={filter}
            type="button"
            size="sm"
            variant={activeFilter === filter ? "secondary" : "ghost"}
            className={activeFilter === filter ? "bg-white text-ink-900" : "text-ink-300 hover:bg-white/10 hover:text-white"}
            onClick={() => setActiveFilter(filter)}
          >
            {filter} ({getFilterCount(jobs, filter)})
          </Button>
        ))}
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="border-b border-white/10 px-4 py-3 text-left font-semibold text-ink-300">
                Document / owner
              </th>
              <th className="border-b border-white/10 px-4 py-3 text-left font-semibold text-ink-300">
                Status
              </th>
              <th className="border-b border-white/10 px-4 py-3 text-left font-semibold text-ink-300">
                Step
              </th>
              <th className="border-b border-white/10 px-4 py-3 text-left font-semibold text-ink-300">
                Correlation ID
              </th>
              <th className="border-b border-white/10 px-4 py-3 text-left font-semibold text-ink-300">
                Cost
              </th>
              <th className="border-b border-white/10 px-4 py-3 text-left font-semibold text-ink-300">
                Error reason
              </th>
              <th className="border-b border-white/10 px-4 py-3 text-left font-semibold text-ink-300">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.map((job) => (
              <tr key={job.id} className="align-top">
                <td className="border-b border-white/10 px-4 py-4 text-white">
                  <p className="font-semibold">{job.documentTitle}</p>
                  <p className="mt-1 text-xs text-ink-400">owner {job.owner}</p>
                </td>
                <td className="border-b border-white/10 px-4 py-4">
                  <Badge tone={getStatusTone(job.status)}>{job.status}</Badge>
                </td>
                <td className="border-b border-white/10 px-4 py-4 text-ink-200">{job.step}</td>
                <td className="border-b border-white/10 px-4 py-4 font-mono text-xs text-ink-300">
                  {job.correlationId}
                </td>
                <td className="border-b border-white/10 px-4 py-4 text-ink-200">{job.costEstimate}</td>
                <td className="border-b border-white/10 px-4 py-4 text-ink-300">
                  {job.errorReason ?? "—"}
                </td>
                <td className="border-b border-white/10 px-4 py-4">
                  {job.status === "failed" ? (
                    <AdminMockActionButton
                      label="Retry mock"
                      message={`Đã mock retry cho ${job.documentTitle}. Main agent nên verify lại copy và trạng thái failed/running.`}
                    />
                  ) : (
                    <span className="text-xs text-ink-500">No action</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 lg:hidden">
        {filteredJobs.map((job) => (
          <div key={job.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={getStatusTone(job.status)}>{job.status}</Badge>
              <span className="text-xs text-ink-400">{job.step}</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-white">{job.documentTitle}</p>
            <p className="mt-1 text-sm text-ink-300">owner {job.owner}</p>
            <p className="mt-2 font-mono text-xs text-ink-400">{job.correlationId}</p>
            {job.errorReason ? (
              <p className="mt-2 text-sm text-error-200">{job.errorReason}</p>
            ) : null}
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-sm text-ink-300">{job.costEstimate}</span>
              {job.status === "failed" ? (
                <AdminMockActionButton
                  label="Retry mock"
                  message={`Đã mock retry cho ${job.documentTitle}.`}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
