import { useEffect, useState } from "react";

import { api } from "../services/api";
import type { GroupSuggestionResponse, SetupPresetKey, SetupPresetSummary } from "../types";

const dismissKey = (guildId: string) => `pa.setup.skipped.${guildId}`;

type SetupWizardCardProps = {
  guildId: string;
  presets: SetupPresetSummary[];
  onApplied: () => Promise<void>;
};

export default function SetupWizardCard({ guildId, presets, onApplied }: SetupWizardCardProps) {
  const [isDismissed, setIsDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(dismissKey(guildId)) === "1";
  });
  const [selectedPreset, setSelectedPreset] = useState<SetupPresetKey | null>(null);
  const [suggestions, setSuggestions] = useState<GroupSuggestionResponse | null>(null);
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
        if (next.primary) {
          setApplyGroups(true);
        }
      } catch {
        // Suggestions are optional; if discord isn't reachable the wizard
        // still works for the preset half.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDismissed]);

  if (isDismissed) {
    return null;
  }

  const primary = suggestions?.primary ?? null;
  const canApply = selectedPreset !== null || (applyGroups && primary !== null);

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
        await api.applySetupPreset(selectedPreset);
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
            This guild looks fresh. Pick a starter preset and optionally apply the detected student groups — both are
            optional and you can change anything later from Settings.
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
            {suggestions
              ? "No clean role partition detected — you can still set group roles manually under Settings."
              : "Inspecting guild roster…"}
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
