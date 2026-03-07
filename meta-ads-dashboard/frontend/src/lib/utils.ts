// 유틸리티 함수 모음
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW" }).format(Math.round(value));
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function getKpiStatus(metric: string, value: number): "good" | "warning" | "poor" {
  switch (metric) {
    case "ctr":
      return value >= 2 ? "good" : value >= 1 ? "warning" : "poor";
    case "roas":
      // KRW 기준: 2x+ 양호, 1~2x 주의, 1x 미만 적자
      return value >= 2 ? "good" : value >= 1 ? "warning" : "poor";
    case "cpc":
      // KRW 기준: ~₩1,000 우수, ₩1,000~₩2,000 주의, ₩2,000+ 위험
      return value <= 1000 ? "good" : value <= 2000 ? "warning" : "poor";
    case "frequency":
      return value <= 3 ? "good" : value <= 5 ? "warning" : "poor";
    case "cpa":
      // KRW 기준: ~₩20,000 우수, ₩20,000~₩40,000 주의, ₩40,000+ 위험
      return value <= 20000 ? "good" : value <= 40000 ? "warning" : "poor";
    default:
      return "warning";
  }
}

/** ROAS 값에 따른 판정 라벨 + 색상 */
export function getRoasVerdict(roas: number): { label: string; color: string } {
  if (roas >= 3) return { label: "우수", color: "text-green-600" };
  if (roas >= 2) return { label: "양호", color: "text-blue-600" };
  if (roas >= 1) return { label: "손익분기", color: "text-yellow-600" };
  if (roas > 0) return { label: "적자", color: "text-red-600" };
  return { label: "데이터 없음", color: "text-gray-400" };
}

export function getStatusColor(status: "good" | "warning" | "poor"): string {
  switch (status) {
    case "good":
      return "bg-green-100 text-green-800";
    case "warning":
      return "bg-yellow-100 text-yellow-800";
    case "poor":
      return "bg-red-100 text-red-800";
  }
}

export function getVerdictColor(verdict: string): string {
  switch (verdict) {
    case "SCALE":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "MAINTAIN":
      return "bg-green-100 text-green-800 border-green-200";
    case "MODIFY":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "PAUSE":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
  }
}
