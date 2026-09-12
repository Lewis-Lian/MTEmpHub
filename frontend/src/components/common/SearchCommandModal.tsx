import { useEffect, useMemo, useRef, useState } from "react";
import type { QueryNavigationModule } from "../../types/query";
import { getEntryIcon, getModuleIcon } from "../icons";
import "../../styles/components/search-command.css";

interface SearchCommandModalProps {
  isOpen: boolean;
  modules: QueryNavigationModule[];
  onClose: () => void;
  onNavigate: (href: string) => void;
}

interface SearchItem {
  href: string;
  id: string;
  key: string;
  moduleName: string;
  moduleSlug: string;
  title: string;
}

export default function SearchCommandModal({
  isOpen,
  modules,
  onClose,
  onNavigate,
}: SearchCommandModalProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const allItems: SearchItem[] = useMemo(() => {
    const list: SearchItem[] = [];
    modules.forEach((mod) => {
      if (mod.entries.length === 0) {
        list.push({
          href: mod.home_href,
          id: mod.slug,
          key: mod.slug,
          moduleName: mod.label,
          moduleSlug: mod.slug,
          title: mod.label,
        });
      } else {
        mod.entries.forEach((entry) => {
          list.push({
            href: entry.href,
            id: `${mod.slug}-${entry.key}`,
            key: entry.key,
            moduleName: mod.label,
            moduleSlug: mod.slug,
            title: entry.label,
          });
        });
      }
    });
    return list;
  }, [modules]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return allItems;
    }
    return allItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.moduleName.toLowerCase().includes(q) ||
        item.href.toLowerCase().includes(q)
    );
  }, [allItems, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (filteredItems.length === 0 ? 0 : (prev + 1) % filteredItems.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (filteredItems.length === 0 ? 0 : (prev - 1 + filteredItems.length) % filteredItems.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = filteredItems[selectedIndex];
        if (selected) {
          onNavigate(selected.href);
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onNavigate, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      aria-modal="true"
      className="search-command-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
    >
      <div className="search-command-modal">
        <div className="search-command-header">
          <span className="search-command-icon">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="4.5" />
              <line x1="10.5" y1="10.5" x2="14" y2="14" />
            </svg>
          </span>
          <input
            aria-label="搜索页面或功能"
            className="search-command-input"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入关键词搜索页面或功能..."
            ref={inputRef}
            type="text"
            value={query}
          />
          <kbd className="search-command-esc-badge" onClick={onClose}>
            ESC
          </kbd>
        </div>

        <div className="search-command-body">
          {filteredItems.length === 0 ? (
            <div className="search-command-empty">未找到相关页面</div>
          ) : (
            filteredItems.map((item, index) => {
              const isSelected = index === selectedIndex;
              const EntryIcon = getEntryIcon(item.key) ?? getModuleIcon(item.moduleSlug);

              return (
                <button
                  className={`search-command-item${isSelected ? " is-selected" : ""}`}
                  key={item.id}
                  onClick={() => {
                    onNavigate(item.href);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  type="button"
                >
                  <div className="search-command-item-left">
                    <span className="search-command-item-icon">
                      {EntryIcon ? (
                        <EntryIcon />
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="2" y="2" width="12" height="12" rx="2" />
                        </svg>
                      )}
                    </span>
                    <span className="search-command-item-title">{item.title}</span>
                  </div>
                  <div className="search-command-item-right">
                    <span className="search-command-item-module">{item.moduleName}</span>
                    <span className="search-command-item-enter">↵</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="search-command-footer">
          <div className="search-command-hints">
            <span className="search-command-hint">
              <kbd>↑</kbd> <kbd>↓</kbd> 切换
            </span>
            <span className="search-command-hint">
              <kbd>↵</kbd> 跳转
            </span>
            <span className="search-command-hint">
              <kbd>ESC</kbd> 退出
            </span>
          </div>
          <span>共 {filteredItems.length} 个页面</span>
        </div>
      </div>
    </div>
  );
}
