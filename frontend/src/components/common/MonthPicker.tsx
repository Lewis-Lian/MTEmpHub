import { useEffect, useRef, useState } from "react";

interface MonthPickerProps {
  value: string; // 格式 YYYY-MM
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function MonthPicker({
  value,
  onChange,
  disabled = false,
  placeholder = "选择月份",
}: MonthPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  // 面板年份状态
  const initialYear = value ? parseInt(value.split("-")[0], 10) : new Date().getFullYear();
  const [panelYear, setPanelYear] = useState(initialYear);

  // 面板内临时选中的月份（数字 1-12）
  const initialMonth = value ? parseInt(value.split("-")[1], 10) : null;
  const [tempMonth, setTempMonth] = useState<number | null>(initialMonth);

  const containerRef = useRef<HTMLDivElement>(null);

  // 监听外部点击自动关闭
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // 当外部 value 改变时，同步更新面板年份和临时选中的月份
  useEffect(() => {
    if (value) {
      const [yStr, mStr] = value.split("-");
      const year = parseInt(yStr, 10);
      const month = parseInt(mStr, 10);
      if (!isNaN(year)) setPanelYear(year);
      if (!isNaN(month)) setTempMonth(month);
    } else {
      setTempMonth(null);
    }
  }, [value]);

  const handleTriggerClick = () => {
    if (disabled) return;
    setIsOpen(!isOpen);
  };

  // 年份导航操作
  const handleDecadePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPanelYear((prev) => prev - 10);
  };

  const handleYearPrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPanelYear((prev) => prev - 1);
  };

  const handleYearNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPanelYear((prev) => prev + 1);
  };

  const handleDecadeNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPanelYear((prev) => prev + 10);
  };

  // 点选月份 (仅改变暂存状态)
  const handleMonthSelect = (monthNum: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setTempMonth(monthNum);
  };

  // 点击“确定”触发保存
  const handleConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (tempMonth === null) {
      return;
    }
    const formattedMonth = String(tempMonth).padStart(2, "0");
    const newValue = `${panelYear}-${formattedMonth}`;
    onChange(newValue);
    setIsOpen(false);
  };

  // 文本展示格式化 (比如 "2026-06" -> "2026年06月")
  const displayLabel = () => {
    if (!value) return <span className="month-picker-placeholder">{placeholder}</span>;
    const parts = value.split("-");
    if (parts.length === 2) {
      return `${parts[0]}年${parts[1]}月`;
    }
    return value;
  };

  const months = [
    { num: 1, label: "1月" },
    { num: 2, label: "2月" },
    { num: 3, label: "3月" },
    { num: 4, label: "4月" },
    { num: 5, label: "5月" },
    { num: 6, label: "6月" },
    { num: 7, label: "7月" },
    { num: 8, label: "8月" },
    { num: 9, label: "9月" },
    { num: 10, label: "10月" },
    { num: 11, label: "11月" },
    { num: 12, label: "12月" },
  ];

  return (
    <div className="month-picker-container" ref={containerRef}>
      {/* 分栏式触发输入框 */}
      <div className={`month-picker-split-trigger${isOpen ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}>
        {/* 左侧值区域 */}
        <button
          className="month-picker-split-value"
          disabled={disabled}
          onClick={handleTriggerClick}
          type="button"
        >
          {/* 日历小图标 */}
          <svg
            className="month-picker-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>{displayLabel()}</span>
        </button>

        {/* 右侧独立下拉小箭头 */}
        <button
          className="month-picker-split-arrow"
          disabled={disabled}
          onClick={handleTriggerClick}
          type="button"
          aria-label={isOpen ? "收起" : "展开"}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="none"
            style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
          >
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </button>
      </div>

      {/* 下拉面板 */}
      {isOpen && (
        <div className="month-picker-dropdown">
          <div className="month-picker-panel-body">
            {/* 年份导航栏 (<< < YYYY年 > >>) */}
            <div className="month-picker-header">
              <div className="month-picker-nav-group">
                <button
                  className="month-picker-nav-btn"
                  onClick={handleDecadePrev}
                  type="button"
                  title="上十个年份"
                >
                  «
                </button>
                <button
                  className="month-picker-nav-btn"
                  onClick={handleYearPrev}
                  type="button"
                  title="上一个年份"
                >
                  ‹
                </button>
              </div>
              <span className="month-picker-year-label">{panelYear}年</span>
              <div className="month-picker-nav-group">
                <button
                  className="month-picker-nav-btn"
                  onClick={handleYearNext}
                  type="button"
                  title="下一个年份"
                >
                  ›
                </button>
                <button
                  className="month-picker-nav-btn"
                  onClick={handleDecadeNext}
                  type="button"
                  title="下十个年份"
                >
                  »
                </button>
              </div>
            </div>

            {/* 月份 3x4 点选网格 */}
            <div className="month-picker-grid">
              {months.map((m) => (
                <button
                  className={`month-picker-cell${tempMonth === m.num ? " is-selected" : ""}`}
                  key={m.num}
                  onClick={(e) => handleMonthSelect(m.num, e)}
                  type="button"
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* 底部确定按钮操作区 */}
          <div className="month-picker-footer">
            <button
              className="month-picker-btn-confirm"
              disabled={tempMonth === null}
              onClick={handleConfirm}
              type="button"
            >
              确定
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
