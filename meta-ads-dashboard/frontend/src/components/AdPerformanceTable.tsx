// 광고 캠페인 성과 테이블 — KPI 색상 코딩 + 정렬 + AI 판정
import { useState } from "react";
import { ArrowUpDown, Play, Pause, AlertTriangle, CheckCircle, Pencil } from "lucide-react";
import { Campaign } from "../lib/api";
import { formatCurrency, formatPercent, formatNumber, getKpiStatus, getStatusColor, getVerdictColor } from "../lib/utils";

interface Props {
  campaigns: Campaign[];
  onEdit: (campaign: Campaign) => void;
  loading: boolean;
}

type SortKey = "name" | "ctr" | "roas" | "cpc" | "frequency" | "total_spend" | "ai_verdict";

function KpiBadge({ metric, value }: { metric: string; value: number }) {
  const status = getKpiStatus(metric, value);
  const colorClass = getStatusColor(status);
  const display = metric === "cpc" ? formatCurrency(value) : metric === "ctr" ? formatPercent(value) : `${value.toFixed(1)}x`;
  if (metric === "frequency") return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>{value.toFixed(1)}</span>;
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>{display}</span>;
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="text-xs text-gray-400">Not analyzed</span>;
  const colorClass = getVerdictColor(verdict);
  const icon =
    verdict === "MAINTAIN" ? <CheckCircle className="w-3 h-3" /> :
    verdict === "PAUSE" ? <Pause className="w-3 h-3" /> :
    <AlertTriangle className="w-3 h-3" />;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${colorClass}`}>
      {icon} {verdict}
    </span>
  );
}

export default function AdPerformanceTable({ campaigns, onEdit, loading }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const sorted = [...campaigns].sort((a, b) => {
    const aVal = a[sortKey] ?? "";
    const bVal = b[sortKey] ?? "";
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortAsc ? aVal - bVal : bVal - aVal;
    }
    return sortAsc ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
  });

  const SortHeader = ({ label, keyName }: { label: string; keyName: SortKey }) => (
    <th
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
      onClick={() => handleSort(keyName)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className="w-3 h-3" />
      </div>
    </th>
  );

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
        Loading campaigns...
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <SortHeader label="Campaign" keyName="name" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <SortHeader label="CTR" keyName="ctr" />
              <SortHeader label="ROAS" keyName="roas" />
              <SortHeader label="CPC" keyName="cpc" />
              <SortHeader label="Freq" keyName="frequency" />
              <SortHeader label="Spend" keyName="total_spend" />
              <SortHeader label="AI Verdict" keyName="ai_verdict" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sorted.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900 text-sm">{c.name}</div>
                  <div className="text-xs text-gray-500">{formatNumber(c.impressions)} impressions</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 text-xs ${c.status === "active" ? "text-green-600" : "text-gray-400"}`}>
                    {c.status === "active" ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3"><KpiBadge metric="ctr" value={c.ctr} /></td>
                <td className="px-4 py-3"><KpiBadge metric="roas" value={c.roas} /></td>
                <td className="px-4 py-3"><KpiBadge metric="cpc" value={c.cpc} /></td>
                <td className="px-4 py-3"><KpiBadge metric="frequency" value={c.frequency} /></td>
                <td className="px-4 py-3 text-sm text-gray-700">{formatCurrency(c.total_spend)}</td>
                <td className="px-4 py-3"><VerdictBadge verdict={c.ai_verdict} /></td>
                <td className="px-4 py-3">
                  <button onClick={() => onEdit(c)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="Edit campaign">
                    <Pencil className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {campaigns.length === 0 && (
        <div className="p-8 text-center text-gray-500">No campaigns found. Add your first campaign to get started.</div>
      )}
    </div>
  );
}
