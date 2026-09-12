import { useEffect, useRef, useState } from "react";
import type { QueryNavigationModule } from "../../types/query";
import { getEntryIcon, getModuleIcon } from "../icons";

import "../../styles/components/app-tabs.css";

export interface AppTabItem {
  href: string;
  label: string;
}

export function reorderTabs(tabs: AppTabItem[], draggedHref: string, targetHref: string): AppTabItem[] {
  const draggedIndex = tabs.findIndex((tab) => tab.href === draggedHref);
  const targetIndex = tabs.findIndex((tab) => tab.href === targetHref);

  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
    return tabs;
  }

  const nextTabs = [...tabs];
  const [draggedTab] = nextTabs.splice(draggedIndex, 1);
  nextTabs.splice(targetIndex, 0, draggedTab);
  return nextTabs;
}

interface AppTabsProps {
  currentPath: string;
  extra?: React.ReactNode;
  modules?: QueryNavigationModule[];
  onCloseAllTabs?: () => void;
  onCloseLeftTabs?: (href: string) => void;
  onCloseOtherTabs?: (href: string) => void;
  onCloseRightTabs?: (href: string) => void;
  onCloseTab: (href: string) => void;
  onNavigate: (href: string) => void;
  onRefreshTab: (href: string) => void;
  onReorderTab: (draggedHref: string, targetHref: string) => void;
  tabs: AppTabItem[];
}

export default function AppTabs({
  currentPath,
  extra,
  modules,
  onCloseAllTabs,
  onCloseLeftTabs,
  onCloseOtherTabs,
  onCloseRightTabs,
  onCloseTab,
  onNavigate,
  onRefreshTab,
  onReorderTab,
  tabs = [],
}: AppTabsProps) {
  const tabListRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const draggedHrefRef = useRef<string | null>(null);
  const [draggedHref, setDraggedHref] = useState<string | null>(null);
  const [dragOverHref, setDragOverHref] = useState<string | null>(null);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    const el = tabListRef.current;
    if (!el) {
      return;
    }

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".app-tab-button")) {
        isDown = false;
        return;
      }
      isDown = true;
      startX = e.pageX - el.offsetLeft;
      scrollLeft = el.scrollLeft;
    };

    const handleMouseLeave = () => {
      isDown = false;
    };

    const handleMouseUp = () => {
      isDown = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDown) {
        return;
      }
      e.preventDefault();
      const x = e.pageX - el.offsetLeft;
      const walk = (x - startX) * 1.5;
      el.scrollLeft = scrollLeft - walk;
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener("mousedown", handleMouseDown);
    el.addEventListener("mouseleave", handleMouseLeave);
    el.addEventListener("mouseup", handleMouseUp);
    el.addEventListener("mousemove", handleMouseMove);
    el.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      el.removeEventListener("mousedown", handleMouseDown);
      el.removeEventListener("mouseleave", handleMouseLeave);
      el.removeEventListener("mouseup", handleMouseUp);
      el.removeEventListener("mousemove", handleMouseMove);
      el.removeEventListener("wheel", handleWheel);
    };
  }, []);

  function handleRefresh(href: string) {
    onRefreshTab(href);
  }

  function handleDragStart(href: string, event: React.DragEvent<HTMLDivElement>) {
    draggedHrefRef.current = href;
    setDraggedHref(href);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", href);
  }

  function handleDragOver(href: string, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (draggedHrefRef.current !== href) {
      setDragOverHref(href);
    }
  }

  function handleDrop(href: string, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const dragged = draggedHrefRef.current;
    if (dragged && dragged !== href) {
      onReorderTab(dragged, href);
    }
    handleDragEnd();
  }

  function handleDragEnd() {
    draggedHrefRef.current = null;
    setDraggedHref(null);
    setDragOverHref(null);
  }

  function getTabIconComponent(href: string) {
    if (modules) {
      for (const mod of modules) {
        const entry = mod.entries.find((e) => e.href === href);
        if (entry) {
          const EntryIcon = getEntryIcon(entry.key);
          if (EntryIcon) return EntryIcon;
        }
        if (mod.home_href === href) {
          const ModIcon = getModuleIcon(mod.slug);
          if (ModIcon) return ModIcon;
        }
      }
    }
    return null;
  }

  return (
    <section className="app-tab-bar" aria-label="已打开页面">
      <div className="app-tab-list" ref={tabListRef} role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.href === currentPath;
          const IconComp = getTabIconComponent(tab.href);

          return (
            <div
              className={`app-tab-button${isActive ? " is-active" : ""}${draggedHref === tab.href ? " is-dragging" : ""}${dragOverHref === tab.href ? " is-drag-over" : ""}`}
              draggable
              onDragEnd={handleDragEnd}
              onDragOver={(event) => handleDragOver(tab.href, event)}
              onDragStart={(event) => handleDragStart(tab.href, event)}
              onDrop={(event) => handleDrop(tab.href, event)}
              key={tab.href}
              role="presentation"
            >
              <button
                aria-selected={isActive}
                className="app-tab-trigger"
                onClick={() => onNavigate(tab.href)}
                role="tab"
                type="button"
              >
                <span className="app-tab-icon" aria-hidden="true">
                  {IconComp ? (
                    <IconComp />
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="12" height="12" rx="2" />
                      <line x1="5" y1="8" x2="11" y2="8" />
                      <line x1="5" y1="5" x2="11" y2="5" />
                      <line x1="5" y1="11" x2="9" y2="11" />
                    </svg>
                  )}
                </span>
                <span className="app-tab-label">{tab.label}</span>
              </button>
              <span className="app-tab-actions">
                {tabs.length > 1 ? (
                  <button
                    aria-label={`关闭${tab.label}`}
                    className="app-tab-close"
                    onClick={() => onCloseTab(tab.href)}
                    type="button"
                  >
                    ×
                  </button>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>

      <div className="app-tab-more-wrap" ref={moreMenuRef}>
        <button
          aria-expanded={isMoreMenuOpen}
          aria-label="页签操作菜单"
          className="app-tab-more-btn"
          onClick={() => setIsMoreMenuOpen((prev) => !prev)}
          title="页签操作"
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </button>

        {isMoreMenuOpen && (
          <div className="app-tab-more-menu" role="menu">
            <button
              className="app-tab-menu-item"
              onClick={() => {
                handleRefresh(currentPath);
                setIsMoreMenuOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              <span>↻</span>
              <span>刷新当前</span>
            </button>
            {onCloseOtherTabs && tabs.length > 1 && (
              <button
                className="app-tab-menu-item"
                onClick={() => {
                  onCloseOtherTabs(currentPath);
                  setIsMoreMenuOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                <span>✕</span>
                <span>关闭其他</span>
              </button>
            )}
            {onCloseLeftTabs && (
              <button
                className="app-tab-menu-item"
                onClick={() => {
                  onCloseLeftTabs(currentPath);
                  setIsMoreMenuOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                <span>⇤</span>
                <span>关闭左侧</span>
              </button>
            )}
            {onCloseRightTabs && (
              <button
                className="app-tab-menu-item"
                onClick={() => {
                  onCloseRightTabs(currentPath);
                  setIsMoreMenuOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                <span>⇥</span>
                <span>关闭右侧</span>
              </button>
            )}
            {onCloseAllTabs && tabs.length > 1 && (
              <button
                className="app-tab-menu-item"
                onClick={() => {
                  onCloseAllTabs();
                  setIsMoreMenuOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                <span>⊗</span>
                <span>关闭全部</span>
              </button>
            )}
          </div>
        )}
      </div>

      {extra && <div className="app-tab-extra">{extra}</div>}
    </section>
  );
}
