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
      return value >= 3 ? "good" : value >= 2 ? "warning" : "poor";
    case "cpc":
      return value <= 1.5 ? "good" : value <= 3 ? "warning" : "poor";
    case "frequency":
      return value <= 3 ? "good" : value <= 5 ? "warning" : "poor";
    default:
      return "warning";
  }
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
