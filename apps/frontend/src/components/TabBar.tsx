import type { TabId } from "../types";

export type TabDefinition = {
  id: TabId;
  label: string;
  description: string;
};

type TabBarProps = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  tabs: TabDefinition[];
};

export default function TabBar({ activeTab, onTabChange, tabs }: TabBarProps) {
  return (
    <nav className="tab-bar" aria-label="Dashboard sections">
      <div className="tab-bar__scroller" role="tablist" aria-orientation="horizontal">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;

          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              type="button"
              role="tab"
              aria-controls={`panel-${tab.id}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`tab-bar__tab${isActive ? " is-active" : ""}`}
              onClick={() => onTabChange(tab.id)}
            >
              <span className="tab-bar__label">{tab.label}</span>
              <span className="tab-bar__description">{tab.description}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
