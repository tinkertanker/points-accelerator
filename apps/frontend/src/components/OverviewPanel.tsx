import SetupWizardCard from "./SetupWizardCard";
import type { BootstrapPayload } from "../types";

type OverviewPanelProps = {
  bootstrap: BootstrapPayload;
  activeGuildId: string | null;
  onOpenGuide: () => void;
  onSetupApplied: () => Promise<void>;
};

export default function OverviewPanel({ bootstrap, activeGuildId, onOpenGuide, onSetupApplied }: OverviewPanelProps) {
  const showWizard = bootstrap.setup.isFreshInstall && activeGuildId !== null;

  return (
    <div className="panel-stack">
      {showWizard && (
        <SetupWizardCard
          guildId={activeGuildId!}
          presets={bootstrap.setup.presets}
          discordRoles={bootstrap.discord.roles}
          onApplied={onSetupApplied}
        />
      )}

      <dl className="stats-row stats-row--compact">
        <div className="stat-item">
          <dt>Groups</dt>
          <dd>{bootstrap.groups.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Participants</dt>
          <dd>{bootstrap.participants.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Assignments</dt>
          <dd>{bootstrap.assignments.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Submissions</dt>
          <dd>{bootstrap.submissions.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Shop Items</dt>
          <dd>{bootstrap.shopItems.length}</dd>
        </div>
      </dl>

      <section className="section">
        <p className="section-help">
          New here?{" "}
          <button type="button" className="guide-inline-link" onClick={onOpenGuide}>
            Open the Guide
          </button>{" "}
          for the class launch checklist, command reference, and setup help.
        </p>
      </section>
    </div>
  );
}
