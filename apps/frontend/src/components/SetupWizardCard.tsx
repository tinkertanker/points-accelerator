import { useEffect, useMemo, useState } from "react";

import { api } from "../services/api";
import type {
  DiscordOption,
  GroupSuggestionResponse,
  SetupPresetKey,
  SetupPresetSummary,
} from "../types";

const dismissKey = (guildId: string) => `pa.setup.skipped.${guildId}`;

type SetupWizardCardProps = {
  guildId: string;
  presets: SetupPresetSummary[];
  discordRoles: DiscordOption[];
  onApplied: () => Promise<void>;
};

export default function SetupWizardCard({ guildId, presets, discordRoles, onApplied }: SetupWizardCardProps) {
  const [isDismissed, setIsDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(dismissKey(guildId)) === "1";
  });
  const [selectedPreset, setSelectedPreset] = useState<SetupPresetKey | null>(null);
  const [staffRoleAssignments, setStaffRoleAssignments] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<GroupSuggestionResponse | null>(null);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [applyGroups, setApplyGroups] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isDismissed) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await api.fetchGroupSuggestions();
        if (cancelled) return;
        setSuggestions(next);
        setSuggestionsError(null);
        if (next.primary) {
          setApplyGroups(true);
        }
      } catch {
        // Suggestions are optional; if discord isn't reachable the wizard
        // still works for the preset half.
        if (cancelled) return;
        setSuggestions({
          totalHumanMembers: 0,
          evaluatedRoleCount: 0,
          primary: null,
          alternatives: [],
        });
        setSuggestionsError("Could not inspect the Discord roster. You can still set group roles manually under Settings.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDismissed]);

  const activePreset = useMemo(
    () => presets.find((preset) => preset.key === selectedPreset) ?? null,
    [presets, selectedPreset],
  );

  // Rebuild staff-role state whenever the preset changes: drop tier keys that
  // don't exist on the new preset (otherwise switching Classroom→Community
  // would still POST `mentor`/`alumni`, which the backend rejects), preserve
  // selections for tiers that exist in both, and pre-fill by name match.
  useEffect(() => {
    if (!activePreset) {
      setStaffRoleAssignments({});
      return;
    }
    setStaffRoleAssignments((current) => {
      const next: Record<string, string> = {};
      for (const tier of activePreset.staffTiers) {
        const existing = current[tier.key];
        if (existing) {
          next[tier.key] = existing;
          continue;
        }
        const match = discordRoles.find((role) => role.name.toLowerCase() === tier.label.toLowerCase());
        if (match) {
          next[tier.key] = match.id;
        }
      }
      return next;
    });
  }, [activePreset, discordRoles]);

  if (isDismissed) {
    return null;
  }

  const primary = suggestions?.primary ?? null;
  const hasDuplicateAssignment = (() => {
    const seen = new Set<string>();
    for (const value of Object.values(staffRoleAssignments)) {
      if (!value) continue;
      if (seen.has(value)) return true;
      seen.add(value);
    }
    return false;
  })();
  const canApply =
    !hasDuplicateAssignment &&
    (selectedPreset !== null || (applyGroups && primary !== null));

  const handleSkip = () => {
    window.localStorage.setItem(dismissKey(guildId), "1");
    setIsDismissed(true);
  };

  const handleApply = async () => {
    if (!canApply) return;
    setIsApplying(true);
    setError(null);
    try {
      if (selectedPreset) {
        const staff = Object.fromEntries(
          Object.entries(staffRoleAssignments).filter(([, value]) => value.length > 0),
        );
        await api.applySetupPreset(selectedPreset, Object.keys(staff).length > 0 ? staff : undefined);
      }
      if (applyGroups && primary) {
        await api.applyGroupSuggestion(primary.roleIds);
      }
      window.localStorage.setItem(dismissKey(guildId), "1");
      await onApplied();
      setIsDismissed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply starter setup.");
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <article className="section setup-wizard">
      <header className="section-header">
        <div>
          <h2>Quick start</h2>
          <p className="section-help">
            This guild looks fresh. Pick a starter preset, map your staff roles, and optionally apply the detected
            student groups — every section is optional and you can change anything later from Settings.
          </p>
        </div>
      </header>

      <fieldset className="setup-wizard__fieldset">
        <legend className="setup-wizard__legend">Starter settings</legend>
        <div className="setup-wizard__options">
          {presets.map((preset) => (
            <label key={preset.key} className="setup-wizard__option">
              <input
                type="radio"
                name="setup-preset"
                value={preset.key}
                checked={selectedPreset === preset.key}
                onChange={() => setSelectedPreset(preset.key)}
              />
              <div>
                <strong>{preset.label}</strong>
                <p className="section-help">{preset.description}</p>
              </div>
            </label>
          ))}
          <label className="setup-wizard__option">
            <input
              type="radio"
              name="setup-preset"
              value=""
              checked={selectedPreset === null}
              onChange={() => setSelectedPreset(null)}
            />
            <div>
              <strong>Keep current settings</strong>
              <p className="section-help">Don't touch the points/currency/betting defaults.</p>
            </div>
          </label>
        </div>
      </fieldset>

      {activePreset && activePreset.staffTiers.length > 0 && (
        <fieldset className="setup-wizard__fieldset">
          <legend className="setup-wizard__legend">Staff roles</legend>
          <p className="section-help">
            Map each tier to one of your Discord roles. Leave any tier on "(skip)" if the role doesn't exist yet — you
            can always wire it up later in Settings.
          </p>
          <div className="setup-wizard__staff-grid">
            {activePreset.staffTiers.map((tier) => (
              <label key={tier.key} className="setup-wizard__staff-row">
                <div>
                  <strong>{tier.label}</strong>
                  <p className="section-help">{tier.description}</p>
                </div>
                <select
                  value={staffRoleAssignments[tier.key] ?? ""}
                  onChange={(event) =>
                    setStaffRoleAssignments((current) => ({ ...current, [tier.key]: event.target.value }))
                  }
                >
                  <option value="">(skip)</option>
                  {discordRoles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {hasDuplicateAssignment && (
            <p className="section-help section-help--warning">
              Each Discord role can only be mapped to one staff tier — pick distinct roles.
            </p>
          )}
        </fieldset>
      )}

      <fieldset className="setup-wizard__fieldset">
        <legend className="setup-wizard__legend">Detected student groups</legend>
        {primary ? (
          <label className="setup-wizard__option">
            <input
              type="checkbox"
              checked={applyGroups}
              onChange={(event) => setApplyGroups(event.target.checked)}
            />
            <div>
              <strong>{primary.label}</strong>
              <div className="suggestion-row__roles">
                {primary.roles.map((role) => (
                  <span key={role.id} className="suggestion-chip">
                    {role.name}
                  </span>
                ))}
              </div>
              <p className="section-help">
                Apply will mark these roles as Group role + Receivable so the bot treats them as point-receiving groups.
              </p>
            </div>
          </label>
        ) : (
          <p className="section-help">
            {suggestionsError ??
            (suggestions
              ? "No clean role partition detected — you can still set group roles manually under Settings."
              : "Inspecting guild roster…")}
          </p>
        )}
      </fieldset>

      {error && <p className="section-help section-help--warning">{error}</p>}

      <div className="setup-wizard__actions">
        <button type="button" className="primary-action" onClick={() => void handleApply()} disabled={!canApply || isApplying}>
          {isApplying ? "Applying…" : "Apply selected"}
        </button>
        <button type="button" className="setup-wizard__skip" onClick={handleSkip} disabled={isApplying}>
          Skip for now
        </button>
      </div>
    </article>
  );
}
