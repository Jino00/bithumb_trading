// 달력 날짜 범위 선택기 — 팝오버 형태, 같은 날 선택 지원
import { useState, useRef, useEffect } from "react";
import { DayPicker, DateRange } from "react-day-picker";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Calendar } from "lucide-react";
import { CustomDateRange } from "../lib/api";
import "react-day-picker/style.css";

interface Props {
  value: CustomDateRange | null;
  onChange: (range: CustomDateRange) => void;
  disabled?: boolean;
  isActive: boolean; // "custom" 기간이 선택된 상태인지
}

export default function DateRangePicker({ value, onChange, disabled, isActive }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<DateRange | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // value prop이 바뀌면 달력 내부 상태도 동기화
  useEffect(() => {
    if (value) {
      setSelected({
        from: new Date(value.since + "T00:00:00"),
        to: new Date(value.until + "T00:00:00"),
      });
    } else {
      setSelected(undefined);
    }
  }, [value]);

  // 외부 클릭 시 팝오버 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const handleSelect = (range: DateRange | undefined) => {
    if (!range?.from) {
      setSelected(undefined);
      return;
    }
    // 같은 날 선택 지원: from만 있고 to가 없으면 since=until
    setSelected(range);
  };

  const handleApply = () => {
    if (!selected?.from) return;
    const since = format(selected.from, "yyyy-MM-dd");
    const until = selected.to ? format(selected.to, "yyyy-MM-dd") : since;
    onChange({ since, until });
    setOpen(false);
  };

  // 버튼에 표시할 텍스트
  const buttonLabel = (() => {
    if (value) {
      const s = new Date(value.since + "T00:00:00");
      const u = new Date(value.until + "T00:00:00");
      if (value.since === value.until) {
        return format(s, "M/d", { locale: ko });
      }
      return `${format(s, "M/d", { locale: ko })} ~ ${format(u, "M/d", { locale: ko })}`;
    }
    return "직접 선택";
  })();

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors ${
          isActive
            ? "bg-blue-600 text-white border-blue-600 font-medium"
            : "text-gray-600 border-gray-200 bg-white hover:bg-gray-100"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <Calendar className="w-3.5 h-3.5" />
        {buttonLabel}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-3">
          <DayPicker
            mode="range"
            selected={selected}
            onSelect={handleSelect}
            locale={ko}
            numberOfMonths={1}
            disabled={{ after: new Date() }}
            defaultMonth={selected?.from || new Date()}
          />
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              {selected?.from
                ? selected.to && selected.from.getTime() !== selected.to.getTime()
                  ? `${format(selected.from, "M/d")} ~ ${format(selected.to, "M/d")}`
                  : format(selected.from, "M/d")
                : "날짜를 선택하세요"}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded"
              >
                취소
              </button>
              <button
                onClick={handleApply}
                disabled={!selected?.from}
                className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
              >
                적용
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
