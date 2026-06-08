import React, { useState, useEffect, useRef } from "react";

interface YearPickerProps {
  value: string; // e.g. "2026"
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function YearPicker({
  value,
  onChange,
  disabled = false,
  placeholder = "选择年份",
}: YearPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [inputValue, setInputValue] = useState(value ? `${value}年` : "");

  const initialYear = value ? parseInt(value, 10) : new Date().getFullYear();
  // We use a 12-year grid, so compute the start year of the current 12-year block
  const [panelStartYear, setPanelStartYear] = useState(Math.floor(initialYear / 12) * 12);

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

  useEffect(() => {
    if (value) {
      setInputValue(`${value}年`);
      const y = parseInt(value, 10);
      if (!isNaN(y)) {
        // Recalculate panel start year based on value
        setPanelStartYear(Math.floor(y / 12) * 12);
      }
    } else {
      setInputValue("");
    }
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputBlur = () => {
    const cleanStr = inputValue.replace(/[^\d]/g, "");
    if (cleanStr.length === 4) {
      const y = parseInt(cleanStr, 10);
      if (y >= 1900 && y <= 2100) {
        setInputValue(`${y}年`);
        onChange(String(y));
        return;
      }
    }
    // Revert if invalid or incomplete
    setInputValue(value ? `${value}年` : "");
  };

  const handleTriggerClick = () => {
    if (disabled) return;
    setIsOpen(true);
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPanelStartYear((prev) => prev - 12);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPanelStartYear((prev) => prev + 12);
  };

  const handleYearSelect = (y: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const val = String(y);
    setInputValue(`${val}年`);
    onChange(val);
    setIsOpen(false);
  };

  const years = Array.from({ length: 12 }, (_, i) => panelStartYear + i);
  const selectedYearNum = value ? parseInt(value, 10) : null;

  return (
    <div className="month-picker-container" ref={containerRef}>
      <div className={`month-picker-split-trigger${isOpen ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}>
        <div
          className="month-picker-split-value"
          onClick={handleTriggerClick}
          style={{ cursor: disabled ? "not-allowed" : "text" }}
        >
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
          <input
            type="text"
            disabled={disabled}
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            placeholder={placeholder}
            style={{
              border: "none",
              outline: "none",
              background: "transparent",
              color: "inherit",
              fontSize: "inherit",
              width: "100%",
              padding: 0,
              cursor: disabled ? "not-allowed" : "text",
            }}
          />
        </div>
      </div>

      {isOpen && (
        <div className="month-picker-dropdown">
          <div className="month-picker-panel-body">
            <div className="month-picker-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px" }}>
              <button
                className="month-picker-nav-btn"
                onClick={handlePrev}
                type="button"
                title="上一页"
              >
                «
              </button>
              <span className="month-picker-year-label" style={{ fontSize: "14px", fontWeight: "600", color: "#334155" }}>
                {panelStartYear} - {panelStartYear + 11}
              </span>
              <button
                className="month-picker-nav-btn"
                onClick={handleNext}
                type="button"
                title="下一页"
              >
                »
              </button>
            </div>

            <div className="month-picker-grid">
              {years.map((y) => (
                <button
                  className={`month-picker-cell${selectedYearNum === y ? " is-selected" : ""}`}
                  key={y}
                  onClick={(e) => handleYearSelect(y, e)}
                  type="button"
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
