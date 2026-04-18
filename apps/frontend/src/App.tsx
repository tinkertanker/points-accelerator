import { startTransition, useCallback, useEffect, useState } from "react";

import ActivityPanel from "./components/ActivityPanel";
import AssignmentsPanel from "./components/AssignmentsPanel";
import FulfilmentPanel from "./components/FulfilmentPanel";
import GroupsPanel from "./components/GroupsPanel";
import GuidePanel from "./components/GuidePanel";
import OverviewPanel from "./components/OverviewPanel";
import SettingsPanel from "./components/SettingsPanel";
import ShopPanel from "./components/ShopPanel";
import TabBar, { type TabDefinition } from "./components/TabBar";
import ThemeToggle from "./components/ThemeToggle";
import { getDesignPreviewSession, isDesignPreview, setDesignPreviewAccessLevel } from "./designPreview";
import { api } from "./services/api";
import type {
  Assignment,
  AssignmentDraft,
  AuthUser,
  BootstrapPayload,
  DashboardAccessLevel,
  Group,
  GroupDraft,
  ShopRedemption,
  RoleCapability,
  Settings,
  ShopItem,
  ShopItemDraft,
  Submission,
  TabId,
} from "./types";
import "./styles/app.css";

function getInitialStatus() {
  if (typeof window === "undefined") {
    return "Sign in with Discord to configure the bot.";
  }

  const url = new URL(window.location.href);
  const authError = url.searchParams.get("auth_error");
  if (!authError) {
    return "Sign in with Discord to configure the bot.";
  }

  url.searchParams.delete("auth_error");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  return authError;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toGroupDraft(group: Group | undefined, capability: RoleCapability): GroupDraft {
  return {
    id: group?.id,
    displayName: group?.displayName ?? capability.roleName,
    slug: group?.slug ?? slugify(capability.roleName),
    mentorName: group?.mentorName ?? "",
    roleId: capability.roleId,
    aliasesText: group?.aliases.map((alias) => alias.value).join(", ") ?? "",
    active: group?.active ?? true,
  };
}

function toSyncedGroupDrafts(groups: Group[], capabilities: RoleCapability[]): GroupDraft[] {
  const groupsByRoleId = new Map(groups.map((group) => [group.roleId, group]));

  return capabilities
    .filter((capability) => capability.isGroupRole && capability.canReceiveAwards)
    .sort((left, right) => left.roleName.localeCompare(right.roleName))
    .map((capability) => toGroupDraft(groupsByRoleId.get(capability.roleId), capability));
}

function toShopItemDraft(item?: ShopItem): ShopItemDraft {
  if (!item) {
    return {
      name: "",
      description: "",
      audience: "INDIVIDUAL",
      cost: 0,
      stock: null,
      enabled: true,
      fulfillmentInstructions: "",
      ownerUserId: null,
      ownerUsername: null,
    };
  }

  return {
    id: item.id,
    name: item.name,
    description: item.description,
    audience: item.audience,
    cost: item.cost,
    stock: item.stock,
    enabled: item.enabled,
    fulfillmentInstructions: item.fulfillmentInstructions,
    ownerUserId: item.ownerUserId,
    ownerUsername: item.ownerUsername,
  };
}

function toAssignmentDraft(assignment?: Assignment): AssignmentDraft {
  if (!assignment) {
    return {
      title: "",
      description: "",
      baseCurrencyReward: 0,
      basePointsReward: 0,
      bonusCurrencyReward: 0,
      bonusPointsReward: 0,
      deadline: null,
      active: true,
      sortOrder: 0,
    };
  }

  return {
    id: assignment.id,
    title: assignment.title,
    description: assignment.description,
    baseCurrencyReward: assignment.baseCurrencyReward,
    basePointsReward: assignment.basePointsReward,
    bonusCurrencyReward: assignment.bonusCurrencyReward,
    bonusPointsReward: assignment.bonusPointsReward,
    deadline: assignment.deadline,
    active: assignment.active,
    sortOrder: assignment.sortOrder,
  };
}

const ALL_TAB_IDS = new Set<string>(["overview", "settings", "groups", "shop", "fulfilment", "assignments", "activity", "guide"]);

function tabFromHash(): TabId | null {
  const raw = window.location.hash.replace("#", "");
  return ALL_TAB_IDS.has(raw) ? (raw as TabId) : null;
}

const DASHBOARD_TABS: TabDefinition[] = [
  { id: "overview", label: "Overview", description: "At-a-glance totals" },
  { id: "settings", label: "Settings", description: "Economy rules and role capabilities" },
  { id: "groups", label: "Groups", description: "Aliases and participants" },
  { id: "shop", label: "Shop", description: "Catalogue, pricing, and fulfilment" },
  { id: "fulfilment", label: "Fulfilment", description: "Redemption queue and handover status" },
  { id: "assignments", label: "Assignments", description: "Prompts and submission review" },
  { id: "activity", label: "Activity", description: "Leaderboard and ledger feed" },
];

const MENTOR_TABS: TabDefinition[] = [
  DASHBOARD_TABS[3]!,
  DASHBOARD_TABS[4]!,
  DASHBOARD_TABS[5]!,
  { id: "activity", label: "Leaderboard", description: "Current standings" },
];

const VIEWER_TABS: TabDefinition[] = [{ id: "activity", label: "Leaderboard", description: "Current standings" }];

function getAvailableTabs(sessionUser: AuthUser | null): TabDefinition[] {
  if (!sessionUser) {
    return [];
  }

  switch (sessionUser.dashboardAccessLevel) {
    case "admin":
      return DASHBOARD_TABS;
    case "mentor":
      return MENTOR_TABS;
    case "viewer":
      return VIEWER_TABS;
    default:
      return VIEWER_TABS;
  }
}

function getDefaultTab(accessLevel?: DashboardAccessLevel): TabId {
  if (accessLevel === "admin") {
    return "overview";
  }

  if (accessLevel === "mentor") {
    return "shop";
  }

  return "activity";
}

function getDashboardSubtitle(accessLevel?: DashboardAccessLevel): string {
  if (accessLevel === "admin") {
    return "Manage the class economy in focused sections instead of one endless dashboard.";
  }

  if (accessLevel === "mentor") {
    return "Update the shop, track fulfilment, and review class submissions.";
  }

  return "Check the latest leaderboard standings for your Discord server.";
}

function getPreviewAccessLabel(accessLevel?: DashboardAccessLevel): string {
  if (accessLevel === "admin") {
    return "Admin";
  }

  if (accessLevel === "mentor") {
    return "Mentor";
  }

  return "Member";
}

export default function App() {
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [redemptions, setRedemptions] = useState<ShopRedemption[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<RoleCapability[]>([]);
  const [groupDrafts, setGroupDrafts] = useState<GroupDraft[]>([]);
  const [shopDrafts, setShopDrafts] = useState<ShopItemDraft[]>([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDraft[]>([]);
  const [status, setStatus] = useState(getInitialStatus);
  const [isInitialising, setIsInitialising] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [isLoadingRedemptions, setIsLoadingRedemptions] = useState(false);
  const [hasLoadedRedemptions, setHasLoadedRedemptions] = useState(false);
  const [activeTab, setActiveTabRaw] = useState<TabId>(() => tabFromHash() ?? getDefaultTab());

  const setActiveTab = useCallback((tab: TabId) => {
    setActiveTabRaw(tab);
    window.history.pushState(null, "", `#${tab}`);
  }, []);

  const discordRoles = bootstrap?.discord.roles ?? [];
  const discordChannels = bootstrap?.discord.channels ?? [];
  const availableTabs = getAvailableTabs(sessionUser);

  const clearDashboardData = () => {
    startTransition(() => {
      setActiveTab(getDefaultTab());
      setBootstrap(null);
      setRedemptions([]);
      setSettingsDraft(null);
      setRoleDrafts([]);
      setGroupDrafts([]);
      setShopDrafts([]);
      setAssignmentDrafts([]);
      setHasLoadedRedemptions(false);
      setIsLoadingRedemptions(false);
    });
  };

  const hydrateDashboard = (payload: BootstrapPayload) => {
    startTransition(() => {
      setBootstrap(payload);
      setSettingsDraft(payload.settings);
      setRoleDrafts(payload.capabilities);
      setGroupDrafts(toSyncedGroupDrafts(payload.groups, payload.capabilities));
      setShopDrafts([...payload.shopItems.map((item) => toShopItemDraft(item)), toShopItemDraft()]);
      setAssignmentDrafts([...payload.assignments.map((assignment) => toAssignmentDraft(assignment)), toAssignmentDraft()]);
    });
  };

  const refreshBootstrap = async () => {
    const payload = await api.bootstrap();
    hydrateDashboard(payload);
  };

  const hydrateRedemptions = (queue: ShopRedemption[]) => {
    startTransition(() => {
      setRedemptions(queue);
    });
  };

  const refreshRedemptions = async () => {
    const queue = await api.listShopRedemptions();
    hydrateRedemptions(queue);
    setHasLoadedRedemptions(true);
  };

  const loadBootstrap = async () => {
    setIsMutating(true);
    try {
      await refreshBootstrap();
      setStatus("Dashboard synced.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load dashboard data.");
      throw error;
    } finally {
      setIsMutating(false);
    }
  };

  const withMutation = async (
    persist: () => Promise<unknown>,
    successMessage: string,
    fallbackErrorMessage: string,
    refresh: () => Promise<void> = refreshBootstrap,
  ) => {
    setIsMutating(true);
    try {
      await persist();
      await refresh();
      setStatus(successMessage);
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : fallbackErrorMessage);
      return false;
    } finally {
      setIsMutating(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrapDashboard = async () => {
      try {
        const session = await api.session();
        if (!session.authenticated || !session.user) {
          if (!cancelled) {
            setSessionUser(null);
            clearDashboardData();
          }
          return;
        }

        if (!cancelled) {
          setSessionUser(session.user);
          if (!tabFromHash()) {
            setActiveTab(getDefaultTab(session.user.dashboardAccessLevel));
          }
        }

        const payload = await api.bootstrap();
        if (!cancelled) {
          hydrateDashboard(payload);
          setStatus("Dashboard synced.");
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Could not load the dashboard.");
          setSessionUser(null);
          clearDashboardData();
        }
      } finally {
        if (!cancelled) {
          setIsInitialising(false);
        }
      }
    };

    void bootstrapDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const tab = tabFromHash();
      if (tab) setActiveTabRaw(tab);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!bootstrap || !sessionUser?.canManageShop || activeTab !== "fulfilment" || hasLoadedRedemptions) {
      return;
    }

    let cancelled = false;

    const loadRedemptions = async () => {
      setIsLoadingRedemptions(true);
      try {
        const queue = await api.listShopRedemptions();
        if (!cancelled) {
          hydrateRedemptions(queue);
          setHasLoadedRedemptions(true);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Failed to load the fulfilment queue.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRedemptions(false);
        }
      }
    };

    void loadRedemptions();

    return () => {
      cancelled = true;
    };
  }, [activeTab, bootstrap, hasLoadedRedemptions, sessionUser?.canManageShop]);

  const handleLogin = () => {
    setStatus("Redirecting to Discord...");
    api.beginDiscordLogin();
  };

  const handlePreviewAccessChange = (accessLevel: DashboardAccessLevel) => {
    setDesignPreviewAccessLevel(accessLevel);
    const nextSession = getDesignPreviewSession(accessLevel);

    if (!nextSession.user) {
      return;
    }

    setSessionUser(nextSession.user);
    setActiveTab(getDefaultTab(accessLevel));
    setStatus(`Previewing the ${getPreviewAccessLabel(accessLevel).toLowerCase()} dashboard.`);
  };

  const renderActivePanel = () => {
    if (!bootstrap || !sessionUser) {
      return null;
    }

    switch (activeTab) {
      case "overview":
        if (!sessionUser.canManageSettings) {
          return null;
        }
        return <OverviewPanel bootstrap={bootstrap} onOpenGuide={() => setActiveTab("guide")} />;
      case "settings":
        if (!settingsDraft || !sessionUser.canManageSettings) {
          return null;
        }
        return (
          <SettingsPanel
            settingsDraft={settingsDraft}
            roleDrafts={roleDrafts}
            discordRoles={discordRoles}
            discordChannels={discordChannels}
            isBusy={isMutating}
            onSettingsChange={setSettingsDraft}
            onRoleDraftsChange={setRoleDrafts}
            onSaveSettings={handleSaveSettings}
            onSaveRoles={handleSaveRoles}
          />
        );
      case "groups":
        if (!sessionUser.canManageGroups) {
          return null;
        }
        return (
          <GroupsPanel
            participants={bootstrap.participants}
            groupDrafts={groupDrafts}
            isBusy={isMutating}
            onGroupDraftsChange={setGroupDrafts}
            onSaveGroups={handleSaveGroups}
          />
        );
      case "shop":
        if (!sessionUser.canManageShop) {
          return null;
        }
        return (
          <ShopPanel
            shopDrafts={shopDrafts}
            isBusy={isMutating}
            participants={bootstrap.participants}
            createShopDraft={() => toShopItemDraft()}
            onShopDraftsChange={setShopDrafts}
            onSaveShop={handleSaveShop}
          />
        );
      case "fulfilment":
        if (!sessionUser.canManageShop) {
          return null;
        }
        return (
          <FulfilmentPanel
            redemptions={redemptions}
            isBusy={isMutating || isLoadingRedemptions}
            isLoading={isLoadingRedemptions && !hasLoadedRedemptions}
            onUpdateRedemptionStatus={handleUpdateRedemptionStatus}
          />
        );
      case "assignments":
        if (!sessionUser.canManageAssignments) {
          return null;
        }
        return (
          <AssignmentsPanel
            bootstrap={bootstrap}
            assignmentDrafts={assignmentDrafts}
            isBusy={isMutating}
            createAssignmentDraft={() => toAssignmentDraft()}
            onAssignmentDraftsChange={setAssignmentDrafts}
            onSaveAssignments={handleSaveAssignments}
            onReviewSubmission={handleReviewSubmission}
          />
        );
      case "activity":
        return (
          <ActivityPanel
            bootstrap={bootstrap}
            canViewLedger={sessionUser.canManageSettings}
          />
        );
      case "guide":
        return <GuidePanel />;
      default:
        return null;
    }
  };

  const handleLogout = async () => {
    await api.logout().catch(() => undefined);
    setSessionUser(null);
    clearDashboardData();
    setStatus("Signed out.");
  };

  const handleSaveSettings = async () => {
    if (!settingsDraft) return;

    await withMutation(() => api.saveSettings(settingsDraft), "Settings saved.", "Failed to save settings.");
  };

  const handleSaveRoles = async () => {
    const validRoles = roleDrafts.filter((role) => role.roleId.trim().length > 0 && role.roleName.trim().length > 0);
    await withMutation(() => api.saveCapabilities(validRoles), "Role capabilities saved.", "Failed to save role capabilities.");
  };

  const handleSaveGroups = async () => {
    const validGroups = groupDrafts.filter((group) => group.roleId.trim().length > 0);
    await withMutation(
      () => Promise.all(validGroups.map((group) => api.saveGroup(group))),
      "Aliases saved.",
      "Failed to save aliases.",
    );
  };

  const handleSaveShop = async () => {
    const validItems = shopDrafts.filter(
      (item) => item.name.trim().length > 0 && item.description.trim().length > 0,
    );
    await withMutation(
      () => Promise.all(validItems.map((item) => api.saveShopItem(item))),
      `Saved ${validItems.length} shop item${validItems.length === 1 ? "" : "s"}.`,
      "Failed to save shop items.",
    );
  };

  const handleSaveAssignments = async () => {
    const validAssignments = assignmentDrafts.filter((assignment) => assignment.title.trim().length > 0);
    await withMutation(
      () => Promise.all(validAssignments.map((assignment) => api.saveAssignment(assignment))),
      `Saved ${validAssignments.length} assignment${validAssignments.length === 1 ? "" : "s"}.`,
      "Failed to save assignments.",
    );
  };

  const handleReviewSubmission = async (
    submission: Submission,
    nextStatus: Exclude<Submission["status"], "PENDING">,
  ) => {
    const submitter = submission.participant.discordUsername ?? submission.participant.indexId;

    if (nextStatus === "APPROVED") {
      return withMutation(
        () => api.reviewSubmission(submission.id, { status: nextStatus }),
        `Approved submission from ${submitter}.`,
        "Failed to approve.",
      );
    }

    if (nextStatus === "OUTSTANDING") {
      return withMutation(
        () => api.reviewSubmission(submission.id, { status: nextStatus }),
        `Marked outstanding: ${submitter}.`,
        "Failed to mark outstanding.",
      );
    }

    return withMutation(
      () => api.reviewSubmission(submission.id, { status: nextStatus }),
      `Rejected submission from ${submitter}.`,
      "Failed to reject.",
    );
  };

  const handleUpdateRedemptionStatus = async (
    redemption: ShopRedemption,
    nextStatus: "FULFILLED" | "CANCELED",
  ) => {
    const actionLabel = nextStatus === "FULFILLED" ? "Marked fulfilled" : "Canceled";
    return withMutation(
      () => api.updateShopRedemptionStatus(redemption.id, { status: nextStatus }),
      `${actionLabel} ${redemption.shopItem.name}.`,
      "Failed to update the redemption.",
      refreshRedemptions,
    );
  };

  const activePanel = renderActivePanel();

  const showLoadingScreen = isInitialising && !bootstrap;
  const showLoginScreen = !showLoadingScreen && !bootstrap;
  const showDashboard = !showLoadingScreen && !!bootstrap;
  const isDashboardBusy = isInitialising || isMutating;

  return (
    <main className="shell">
      <div className="shell-toolbar">
        <ThemeToggle />
      </div>
      {showLoadingScreen ? (
        <section className="app-loading" aria-live="polite">
          <div className="app-loading__panel">
            <p className="app-loading__eyebrow">points accelerator</p>
            <h1>Loading your dashboard...</h1>
            <p className="app-loading__copy">Checking your Discord session and syncing the latest dashboard data.</p>
          </div>
        </section>
      ) : showLoginScreen ? (
        <section className="login-page">
          <header className="login-hero">
            <h1>points accelerator</h1>
            <p className="lede">
              Group points, personal wallets, shop pricing, role capabilities, and passive chat earn rates all live
              here.
            </p>
          </header>

          <article className="login-card">
            <h2>Discord Sign-In</h2>
            <p>
              Use your Discord account for the configured server. Anyone in the guild can view the leaderboard, while
              admin and mentor roles unlock extra sections.
            </p>
            <button onClick={handleLogin}>Sign In with Discord</button>
            <p className="status-bar">{status}</p>
          </article>
        </section>
      ) : showDashboard ? (
        <>
          {isDesignPreview() ? (
            <p className="design-preview-banner" role="status">
              Design preview: local mock data only. No backend or Discord required; saves stay in this browser
              session. Use <strong>Preview as</strong> to switch between admin, mentor, and member layouts.
            </p>
          ) : null}
          <header className="topbar">
            <hgroup className="topbar-brand">
              <h1>{settingsDraft?.appName.trim() || bootstrap.settings.appName}</h1>
              <p>{getDashboardSubtitle(sessionUser?.dashboardAccessLevel)}</p>
            </hgroup>
            <div className="topbar-right">
              {isDesignPreview() && sessionUser ? (
                <label className="preview-access-picker">
                  <span>Preview as</span>
                  <select
                    value={sessionUser.dashboardAccessLevel}
                    onChange={(event) => handlePreviewAccessChange(event.target.value as DashboardAccessLevel)}
                  >
                    <option value="admin">Admin</option>
                    <option value="mentor">Mentor</option>
                    <option value="viewer">Member</option>
                  </select>
                </label>
              ) : null}
              <button
                type="button"
                className={`topbar-guide-link${activeTab === "guide" ? " is-active" : ""}`}
                onClick={() => setActiveTab("guide")}
              >
                Guide
              </button>
              {sessionUser ? (
                <p className="session-badge">
                  {sessionUser.avatarUrl ? <img src={sessionUser.avatarUrl} alt="" /> : null}
                  <strong>{sessionUser.displayName}</strong>
                </p>
              ) : null}
              <button onClick={() => void loadBootstrap().catch(() => undefined)} disabled={isDashboardBusy}>
                Refresh
              </button>
              {isDesignPreview() ? null : (
                <button onClick={() => void handleLogout()} disabled={isDashboardBusy}>
                  Sign Out
                </button>
              )}
            </div>
          </header>

          <TabBar tabs={availableTabs} activeTab={activeTab} onTabChange={setActiveTab} />

          <section
            id={`panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`tab-${activeTab}`}
            className="dashboard-panel-view"
          >
            {activePanel}
          </section>

          <footer className="status-bar">{status}</footer>
        </>
      ) : null}
    </main>
  );
}
