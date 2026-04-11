import { startTransition, useEffect, useState } from "react";

import ActivityPanel from "./components/ActivityPanel";
import AssignmentsPanel from "./components/AssignmentsPanel";
import GroupsPanel from "./components/GroupsPanel";
import OverviewPanel from "./components/OverviewPanel";
import SettingsPanel from "./components/SettingsPanel";
import ShopPanel from "./components/ShopPanel";
import TabBar, { type TabDefinition } from "./components/TabBar";
import ThemeToggle from "./components/ThemeToggle";
import { isDesignPreview } from "./designPreview";
import { api } from "./services/api";
import type {
  Assignment,
  AssignmentDraft,
  AuthUser,
  BootstrapPayload,
  Group,
  GroupDraft,
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

function toGroupDraft(group?: Group): GroupDraft {
  if (!group) {
    return {
      displayName: "",
      slug: "",
      mentorName: "",
      roleId: "",
      aliasesText: "",
      active: true,
    };
  }

  return {
    id: group.id,
    displayName: group.displayName,
    slug: group.slug,
    mentorName: group.mentorName,
    roleId: group.roleId,
    aliasesText: group.aliases.map((alias) => alias.value).join(", "),
    active: group.active,
  };
}

function toShopItemDraft(item?: ShopItem): ShopItemDraft {
  if (!item) {
    return {
      name: "",
      description: "",
      currencyCost: 0,
      stock: null,
      enabled: true,
      fulfillmentInstructions: "",
    };
  }

  return {
    id: item.id,
    name: item.name,
    description: item.description,
    currencyCost: item.currencyCost,
    stock: item.stock,
    enabled: item.enabled,
    fulfillmentInstructions: item.fulfillmentInstructions,
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

const DASHBOARD_TABS: TabDefinition[] = [
  { id: "overview", label: "Overview", description: "Launch checklist and current totals" },
  { id: "settings", label: "Settings", description: "Economy rules and role capabilities" },
  { id: "groups", label: "Groups", description: "Team mapping and participants" },
  { id: "shop", label: "Shop", description: "Catalogue, pricing, and fulfilment" },
  { id: "assignments", label: "Assignments", description: "Prompts and submission review" },
  { id: "activity", label: "Activity", description: "Leaderboard and ledger feed" },
];

export default function App() {
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<RoleCapability[]>([]);
  const [groupDrafts, setGroupDrafts] = useState<GroupDraft[]>([]);
  const [shopDrafts, setShopDrafts] = useState<ShopItemDraft[]>([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDraft[]>([]);
  const [status, setStatus] = useState(getInitialStatus);
  const [isBusy, setIsBusy] = useState(false);
  const [isInitialising, setIsInitialising] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const discordRoles = bootstrap?.discord.roles ?? [];
  const discordChannels = bootstrap?.discord.channels ?? [];

  const clearDashboardData = () => {
    startTransition(() => {
      setActiveTab("overview");
      setBootstrap(null);
      setSettingsDraft(null);
      setRoleDrafts([]);
      setGroupDrafts([]);
      setShopDrafts([]);
      setAssignmentDrafts([]);
    });
  };

  const hydrateDashboard = (payload: BootstrapPayload) => {
    startTransition(() => {
      setBootstrap(payload);
      setSettingsDraft(payload.settings);
      setRoleDrafts(payload.capabilities);
      setGroupDrafts([...payload.groups.map((group) => toGroupDraft(group)), toGroupDraft()]);
      setShopDrafts([...payload.shopItems.map((item) => toShopItemDraft(item)), toShopItemDraft()]);
      setAssignmentDrafts([...payload.assignments.map((assignment) => toAssignmentDraft(assignment)), toAssignmentDraft()]);
    });
  };

  const refreshBootstrap = async () => {
    const payload = await api.bootstrap();
    hydrateDashboard(payload);
  };

  const loadBootstrap = async () => {
    setIsBusy(true);
    try {
      await refreshBootstrap();
      setStatus("Dashboard synced.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load dashboard data.");
      throw error;
    } finally {
      setIsBusy(false);
    }
  };

  const withMutation = async (
    persist: () => Promise<unknown>,
    successMessage: string,
    fallbackErrorMessage: string,
  ) => {
    setIsBusy(true);
    try {
      await persist();
      await refreshBootstrap();
      setStatus(successMessage);
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : fallbackErrorMessage);
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrapDashboard = async () => {
      setIsBusy(true);
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
          setIsBusy(false);
          setIsInitialising(false);
        }
      }
    };

    void bootstrapDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = () => {
    setStatus("Redirecting to Discord...");
    api.beginDiscordLogin();
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
    const validGroups = groupDrafts.filter(
      (group) => group.displayName.trim().length > 0 && group.roleId.trim().length > 0,
    );
    await withMutation(
      () => Promise.all(validGroups.map((group) => api.saveGroup(group))),
      `Saved ${validGroups.length} group${validGroups.length === 1 ? "" : "s"}.`,
      "Failed to save groups.",
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

  const activePanel = bootstrap && settingsDraft
    ? (() => {
        switch (activeTab) {
          case "overview":
            return <OverviewPanel bootstrap={bootstrap} settingsDraft={settingsDraft} />;
          case "settings":
            return (
              <SettingsPanel
                settingsDraft={settingsDraft}
                roleDrafts={roleDrafts}
                discordRoles={discordRoles}
                discordChannels={discordChannels}
                isBusy={isBusy}
                onSettingsChange={setSettingsDraft}
                onRoleDraftsChange={setRoleDrafts}
                onSaveSettings={handleSaveSettings}
                onSaveRoles={handleSaveRoles}
              />
            );
          case "groups":
            return (
              <GroupsPanel
                participants={bootstrap.participants}
                groupDrafts={groupDrafts}
                discordRoles={discordRoles}
                isBusy={isBusy}
                createGroupDraft={() => toGroupDraft()}
                slugify={slugify}
                onGroupDraftsChange={setGroupDrafts}
                onSaveGroups={handleSaveGroups}
              />
            );
          case "shop":
            return (
              <ShopPanel
                shopDrafts={shopDrafts}
                isBusy={isBusy}
                createShopDraft={() => toShopItemDraft()}
                onShopDraftsChange={setShopDrafts}
                onSaveShop={handleSaveShop}
              />
            );
          case "assignments":
            return (
              <AssignmentsPanel
                bootstrap={bootstrap}
                assignmentDrafts={assignmentDrafts}
                isBusy={isBusy}
                createAssignmentDraft={() => toAssignmentDraft()}
                onAssignmentDraftsChange={setAssignmentDrafts}
                onSaveAssignments={handleSaveAssignments}
                onReviewSubmission={handleReviewSubmission}
              />
            );
          case "activity":
            return <ActivityPanel bootstrap={bootstrap} />;
          default:
            return null;
        }
      })()
    : null;

  const showLoadingScreen = isInitialising && !bootstrap;
  const showLoginScreen = !showLoadingScreen && (!bootstrap || !settingsDraft);
  const showDashboard = !showLoadingScreen && !showLoginScreen && !!bootstrap && !!settingsDraft;

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
            <p className="app-loading__copy">Checking your Discord session and syncing the latest admin data.</p>
          </div>
        </section>
      ) : showLoginScreen ? (
        <section className="login-page">
          <header className="login-hero">
            <h1>points accelerator</h1>
            <p className="lede">
              Group rewards, transfers, shop pricing, role capabilities, and passive chat earn rates all live here.
            </p>
          </header>

          <article className="login-card">
            <h2>Discord Sign-In</h2>
            <p>
              Use your Discord account for the configured server. Dashboard access follows your current guild
              permissions and any roles marked with <strong>manage dashboard</strong>.
            </p>
            <button onClick={handleLogin} disabled={isBusy}>
              {isBusy ? "Redirecting..." : "Sign In with Discord"}
            </button>
            <p className="status-bar">{status}</p>
          </article>
        </section>
      ) : showDashboard ? (
        <>
          {isDesignPreview() ? (
            <p className="design-preview-banner" role="status">
              Design preview: local mock data only. No backend or Discord required; saves stay in this browser
              session.
            </p>
          ) : null}
          <header className="topbar">
            <hgroup className="topbar-brand">
              <h1>{settingsDraft.appName.trim() || bootstrap.settings.appName}</h1>
              <p>Manage the class economy in focused sections instead of one endless dashboard.</p>
            </hgroup>
            <div className="topbar-right">
              {sessionUser ? (
                <p className="session-badge">
                  {sessionUser.avatarUrl ? <img src={sessionUser.avatarUrl} alt="" /> : null}
                  <strong>{sessionUser.displayName}</strong>
                </p>
              ) : null}
              <button onClick={() => void loadBootstrap().catch(() => undefined)} disabled={isBusy}>
                Refresh
              </button>
              {isDesignPreview() ? null : (
                <button onClick={() => void handleLogout()} disabled={isBusy}>
                  Sign Out
                </button>
              )}
            </div>
          </header>

          <TabBar tabs={DASHBOARD_TABS} activeTab={activeTab} onTabChange={setActiveTab} />

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
