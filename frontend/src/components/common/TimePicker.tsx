import React, { useState, useEffect, useRef } from "react";

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
}

export default function TimePicker({ value, onChange, placeholder = "选择时间", style, className }: TimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [hour, min] = (value || ":").split(":");
  const selectedHour = hour || "00";
  const selectedMin = min || "00";

  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputBlur = () => {
    const cleanStr = inputValue.replace(/[^\d:]/g, "");
    let formattedStr = cleanStr;
    
    // Auto-insert colon if omitted (e.g. 0930 -> 09:30, 930 -> 09:30)
    if (cleanStr.length === 4 && !cleanStr.includes(":")) {
      formattedStr = `${cleanStr.substring(0, 2)}:${cleanStr.substring(2, 4)}`;
    } else if (cleanStr.length === 3 && !cleanStr.includes(":")) {
      formattedStr = `0${cleanStr.substring(0, 1)}:${cleanStr.substring(1, 3)}`;
    }

    const timeRegex = /^([0-1]?[0-9]|2[0-3]):?([0-5][0-9])$/;
    const match = formattedStr.match(timeRegex);
    
    if (match) {
      const h = match[1].padStart(2, "0");
      const m = match[2];
      const validTime = `${h}:${m}`;
      setInputValue(validTime);
      onChange(validTime);
    } else {
      setInputValue(value);
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

  const handleHourSelect = (h: string) => {
    onChange(`${h}:${selectedMin}`);
  };

  const handleMinSelect = (m: string) => {
    onChange(`${selectedHour}:${m}`);
  };

  return (
    <div ref={containerRef} style={{ position: "relative", ...style }} className={className}>
      <div
        onClick={() => setIsOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          border: isOpen ? "1px solid #3b82f6" : "1px solid #cbd5e1",
          borderRadius: "6px",
          background: "#fff",
          cursor: "pointer",
          minHeight: "38px",
          boxSizing: "border-box",
          boxShadow: isOpen ? "0 0 0 2px rgba(59, 130, 246, 0.1)" : "none",
          transition: "all 0.2s ease",
        }}
      >
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          placeholder={placeholder}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            color: inputValue ? "#1e293b" : "#94a3b8",
            fontSize: "14px",
            width: "100%",
            padding: 0,
            cursor: "text",
          }}
        />
        <svg
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#64748b"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: isOpen ? "rotate(180deg)" : "none",
            transition: "transform 0.2s ease",
          }}
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
            display: "flex",
            height: "200px",
            zIndex: 1600,
            overflow: "hidden",
          }}
        >
          {/* Hours column */}
          <ul
            className="time-picker-list"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              width: "60px",
              overflowY: "auto",
              borderRight: "1px solid #e2e8f0",
              scrollbarWidth: "none", // for Firefox
            }}
          >
            {hours.map((h) => (
              <li
                key={`h-${h}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleHourSelect(h);
                }}
                style={{
                  padding: "8px 0",
                  textAlign: "center",
                  cursor: "pointer",
                  fontSize: "14px",
                  background: h === selectedHour ? "#eff6ff" : "transparent",
                  color: h === selectedHour ? "#2563eb" : "#334155",
                  fontWeight: h === selectedHour ? "600" : "400",
                }}
                onMouseEnter={(e) => {
                  if (h !== selectedHour) e.currentTarget.style.background = "#f8fafc";
                }}
                onMouseLeave={(e) => {
                  if (h !== selectedHour) e.currentTarget.style.background = "transparent";
                }}
              >
                {h}
              </li>
            ))}
          </ul>

          {/* Minutes column */}
          <ul
            className="time-picker-list"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              width: "60px",
              overflowY: "auto",
              scrollbarWidth: "none", // for Firefox
            }}
          >
            {minutes.map((m) => (
              <li
                key={`m-${m}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleMinSelect(m);
                }}
                style={{
                  padding: "8px 0",
                  textAlign: "center",
                  cursor: "pointer",
                  fontSize: "14px",
                  background: m === selectedMin ? "#eff6ff" : "transparent",
                  color: m === selectedMin ? "#2563eb" : "#334155",
                  fontWeight: m === selectedMin ? "600" : "400",
                }}
                onMouseEnter={(e) => {
                  if (m !== selectedMin) e.currentTarget.style.background = "#f8fafc";
                }}
                onMouseLeave={(e) => {
                  if (m !== selectedMin) e.currentTarget.style.background = "transparent";
                }}
              >
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
