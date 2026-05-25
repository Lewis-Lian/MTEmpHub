export interface AppTabItem {
  href: string;
  label: string;
}

interface AppTabsProps {
  currentPath: string;
  tabs: AppTabItem[];
  onCloseTab: (href: string) => void;
  onNavigate: (href: string) => void;
  onRefreshTab: (href: string) => void;
}

export default function AppTabs({
  currentPath,
  tabs,
  onCloseTab,
  onNavigate,
  onRefreshTab,
}: AppTabsProps) {
  return (
    <section className="app-tab-bar" aria-label="已打开页面">
      <div className="app-tab-list" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.href === currentPath;

          return (
            <div
              className={`app-tab-button${isActive ? " is-active" : ""}`}
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
                <span className="app-tab-label">{tab.label}</span>
              </button>
              <span className="app-tab-actions">
                <button
                  aria-label={`刷新${tab.label}`}
                  className="app-tab-refresh"
                  onClick={() => onRefreshTab(tab.href)}
                  type="button"
                >
                  ↻
                </button>
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
    </section>
  );
}
