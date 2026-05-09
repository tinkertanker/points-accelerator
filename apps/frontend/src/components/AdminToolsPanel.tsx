import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

import { api } from "../services/api";
import type {
  EconomyResetRequest,
  EconomyResetResult,
  GroupLedgerEntryType,
  Participant,
  ParticipantLedgerEntryType,
  ParticipantSanction,
  ParticipantSanctionFlag,
} from "../types";

const SANCTION_FLAGS: ParticipantSanctionFlag[] = [
  "CANNOT_BET",
  "CANNOT_EARN_PASSIVE",
  "CANNOT_BUY",
  "CANNOT_TRANSFER",
  "CANNOT_RECEIVE_REWARDS",
];

const FLAG_LABEL: Record<ParticipantSanctionFlag, string> = {
  CANNOT_BET: "No betting",
  CANNOT_EARN_PASSIVE: "No passive earnings",
  CANNOT_BUY: "No shop purchases",
  CANNOT_TRANSFER: "No transfers",
  CANNOT_RECEIVE_REWARDS: "No rewards (lucky draw, reactions)",
};

type ResetMode = EconomyResetRequest["mode"];

const RESET_MODE_OPTIONS: Array<{
  id: ResetMode;
  title: string;
  summary: string;
  detail: string;
}> = [
  {
    id: "modulo-balance",
    title: "Keep last digits",
    summary: "Trim huge balances while preserving a small remainder.",
    detail: "Best for runaway numbers. Example: 12,345 with a 1,000 modulus becomes 345.",
  },
  {
    id: "cap-balances",
    title: "Cap balances",
    summary: "Only reduce balances above a maximum.",
    detail: "Useful when the economy is mostly fine but outliers need a ceiling.",
  },
  {
    id: "reverse-entries-since",
    title: "Reverse entries",
    summary: "Undo selected ledger entry types since a date.",
    detail: "Best when you know exactly which recent reward or event caused the problem.",
  },
  {
    id: "set-balances",
    title: "Set balances",
    summary: "Move selected buckets to a fixed value.",
    detail: "The blunt reset option. Use zero to wipe a selected bucket.",
  },
];

const MODULUS_PRESETS = ["10", "100", "1000", "10000"];

type EconomyBucketId = "participant-currency" | "group-points" | "group-currency";

type EconomyBucket = {
  id: EconomyBucketId;
  title: string;
  label: string;
  description: string;
};

const ECONOMY_BUCKET_BY_ID = {
  "participant-currency": {
    id: "participant-currency",
    title: "Participant wallet currency",
    label: "Student wallet currency",
    description: "Personal spendable balance used for transfers, personal shop buys, bets and donations.",
  },
  "group-points": {
    id: "group-points",
    title: "Group points",
    label: "Leaderboard group points",
    description: "Shared group score shown on the leaderboard and spent by group purchases.",
  },
  "group-currency": {
    id: "group-currency",
    title: "Group currency",
    label: "Legacy shared group currency",
    description: "Shared group ledger currency used by group-to-group transfers and older group currency flows.",
  },
} satisfies Record<EconomyBucketId, EconomyBucket>;

const ECONOMY_BUCKETS: EconomyBucket[] = [
  ECONOMY_BUCKET_BY_ID["participant-currency"],
  ECONOMY_BUCKET_BY_ID["group-points"],
  ECONOMY_BUCKET_BY_ID["group-currency"],
];

const PARTICIPANT_LEDGER_TYPES: ParticipantLedgerEntryType[] = [
  "MESSAGE_REWARD",
  "MANUAL_AWARD",
  "MANUAL_DEDUCT",
  "CORRECTION",
  "TRANSFER",
  "DONATION",
  "SHOP_REDEMPTION",
  "SUBMISSION_REWARD",
  "BET_WIN",
  "BET_LOSS",
  "LUCKYDRAW_WIN",
  "REACTION_REWARD",
];

const GROUP_LEDGER_TYPES: GroupLedgerEntryType[] = [
  "MESSAGE_REWARD",
  "MANUAL_AWARD",
  "MANUAL_DEDUCT",
  "CORRECTION",
  "TRANSFER",
  "DONATION",
  "SHOP_REDEMPTION",
  "ADJUSTMENT",
  "SUBMISSION_REWARD",
  "BET_WIN",
  "BET_LOSS",
  "LUCKYDRAW_WIN",
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
}

function formatDelta(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

type ResetState = {
  mode: ResetMode;
  // reverse-entries-since
  since: string;
  participantTypes: Set<ParticipantLedgerEntryType>;
  groupTypes: Set<GroupLedgerEntryType>;
  // cap-balances
  maxParticipantCurrency: string;
  maxGroupPoints: string;
  maxGroupCurrency: string;
  // modulo-balance
  modulus: string;
  applyToParticipantCurrency: boolean;
  applyToGroupPoints: boolean;
  applyToGroupCurrency: boolean;
  // set-balances
  targetParticipantCurrency: string;
  targetGroupPoints: string;
  targetGroupCurrency: string;
  setParticipantCurrencyEnabled: boolean;
  setGroupPointsEnabled: boolean;
  setGroupCurrencyEnabled: boolean;
  // shared
  note: string;
};

function defaultState(): ResetState {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return {
    mode: "modulo-balance",
    since: local.toISOString().slice(0, 16),
    participantTypes: new Set<ParticipantLedgerEntryType>(["LUCKYDRAW_WIN"]),
    groupTypes: new Set<GroupLedgerEntryType>(),
    maxParticipantCurrency: "1000",
    maxGroupPoints: "",
    maxGroupCurrency: "",
    modulus: "1000",
    applyToParticipantCurrency: true,
    applyToGroupPoints: true,
    applyToGroupCurrency: true,
    targetParticipantCurrency: "0",
    targetGroupPoints: "0",
    targetGroupCurrency: "0",
    setParticipantCurrencyEnabled: true,
    setGroupPointsEnabled: true,
    setGroupCurrencyEnabled: true,
    note: "",
  };
}

function buildRequest(state: ResetState, dryRun: boolean): EconomyResetRequest {
  const note = state.note.trim() || undefined;
  if (state.mode === "reverse-entries-since") {
    const sinceDate = new Date(state.since);
    return {
      mode: "reverse-entries-since",
      since: sinceDate.toISOString(),
      participantTypes: state.participantTypes.size ? Array.from(state.participantTypes) : undefined,
      groupTypes: state.groupTypes.size ? Array.from(state.groupTypes) : undefined,
      note,
      dryRun,
    };
  }
  if (state.mode === "cap-balances") {
    const parse = (raw: string) => (raw.trim() === "" ? undefined : Number(raw));
    return {
      mode: "cap-balances",
      maxParticipantCurrency: parse(state.maxParticipantCurrency),
      maxGroupPoints: parse(state.maxGroupPoints),
      maxGroupCurrency: parse(state.maxGroupCurrency),
      note,
      dryRun,
    };
  }
  if (state.mode === "modulo-balance") {
    return {
      mode: "modulo-balance",
      modulus: Number(state.modulus),
      applyToParticipantCurrency: state.applyToParticipantCurrency,
      applyToGroupPoints: state.applyToGroupPoints,
      applyToGroupCurrency: state.applyToGroupCurrency,
      note,
      dryRun,
    };
  }
  return {
    mode: "set-balances",
    targetParticipantCurrency: state.setParticipantCurrencyEnabled
      ? Number(state.targetParticipantCurrency)
      : undefined,
    targetGroupPoints: state.setGroupPointsEnabled ? Number(state.targetGroupPoints) : undefined,
    targetGroupCurrency: state.setGroupCurrencyEnabled
      ? Number(state.targetGroupCurrency)
      : undefined,
    note,
    dryRun,
  };
}

type AdminToolsPanelProps = {
  participants: Participant[];
};

export default function AdminToolsPanel({ participants }: AdminToolsPanelProps) {
  const [state, setState] = useState<ResetState>(defaultState);
  const [result, setResult] = useState<EconomyResetResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const update = (patch: Partial<ResetState>) => setState((prev) => ({ ...prev, ...patch }));

  const toggleParticipantType = (type: ParticipantLedgerEntryType) => {
    setState((prev) => {
      const next = new Set(prev.participantTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { ...prev, participantTypes: next };
    });
  };
  const toggleGroupType = (type: GroupLedgerEntryType) => {
    setState((prev) => {
      const next = new Set(prev.groupTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { ...prev, groupTypes: next };
    });
  };
  const setParticipantTypes = (types: ParticipantLedgerEntryType[]) => {
    setState((prev) => ({ ...prev, participantTypes: new Set(types) }));
  };
  const setGroupTypes = (types: GroupLedgerEntryType[]) => {
    setState((prev) => ({ ...prev, groupTypes: new Set(types) }));
  };

  const selectedMode = RESET_MODE_OPTIONS.find((option) => option.id === state.mode)!;
  const participantCurrencyBucket = ECONOMY_BUCKET_BY_ID["participant-currency"];
  const groupPointsBucket = ECONOMY_BUCKET_BY_ID["group-points"];
  const groupCurrencyBucket = ECONOMY_BUCKET_BY_ID["group-currency"];
  const modulusValue = Number(state.modulus);
  const modulusIsValid =
    state.mode !== "modulo-balance" ||
    (state.modulus.trim() !== "" && Number.isInteger(modulusValue) && modulusValue >= 1);
  const selectedTargetCount = [
    state.mode === "set-balances" ? state.setParticipantCurrencyEnabled : state.applyToParticipantCurrency,
    state.mode === "set-balances" ? state.setGroupPointsEnabled : state.applyToGroupPoints,
    state.mode === "set-balances" ? state.setGroupCurrencyEnabled : state.applyToGroupCurrency,
  ].filter(Boolean).length;

  const selectMode = (mode: ResetMode) => {
    setResult(null);
    update({ mode });
  };

  const moveModeSelection = (currentMode: ResetMode, offset: number) => {
    const currentIndex = RESET_MODE_OPTIONS.findIndex((option) => option.id === currentMode);
    const nextIndex = (currentIndex + offset + RESET_MODE_OPTIONS.length) % RESET_MODE_OPTIONS.length;
    const nextMode = RESET_MODE_OPTIONS[nextIndex].id;
    selectMode(nextMode);
    return nextMode;
  };

  const focusModeButton = (mode: ResetMode) => {
    window.requestAnimationFrame(() => {
      const selector = `[data-reset-mode="${mode}"]`;
      document.querySelector<HTMLButtonElement>(selector)?.focus();
    });
  };

  const handleModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, mode: ResetMode) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusModeButton(moveModeSelection(mode, 1));
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusModeButton(moveModeSelection(mode, -1));
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      selectMode(mode);
    }
  };

  const run = async (dryRun: boolean) => {
    if (!modulusIsValid) {
      setError("Enter a whole-number modulus of at least 1 before previewing or executing.");
      return;
    }
    setBusy(true);
    setError(null);
    if (!dryRun) {
      const confirmed = window.confirm(
        "This writes CORRECTION ledger entries that change real balances. Run a dry run first if you have not. Continue?",
      );
      if (!confirmed) {
        setBusy(false);
        return;
      }
    }
    try {
      const payload = buildRequest(state, dryRun);
      const response = await api.economyReset(payload);
      setResult(response);
      setStatusMessage(
        dryRun
          ? "Dry run complete. Review the impact below; no changes were written."
          : "Economy reset executed. CORRECTION ledger entries written.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-stack">
      <section className="section">
        <header className="section-header economy-reset-header">
          <div>
            <p className="section-kicker">Admin tools</p>
            <h2>Economy reset</h2>
            <p className="section-help">
              Choose the balance bucket, preview the impact, then execute only after the dry run
              looks right. Resets write append-only correction ledger entries, so the audit trail is
              preserved.
            </p>
          </div>
          <div className="reset-safety-note" aria-label="Reset safety note">
            <strong>Dry run first</strong>
            <span>No balances change until you press Execute.</span>
          </div>
        </header>

        <div className="reset-explainer-grid" aria-label="Economy balance buckets">
          {ECONOMY_BUCKETS.map((bucket) => (
            <article className="reset-explainer" key={bucket.id}>
              <h3>{bucket.title}</h3>
              <p>{bucket.description}</p>
            </article>
          ))}
        </div>

        <div className="reset-mode-grid" role="radiogroup" aria-label="Economy reset mode">
          {RESET_MODE_OPTIONS.map((option) => (
            <button
              type="button"
              className="reset-mode-card"
              aria-checked={state.mode === option.id}
              role="radio"
              tabIndex={state.mode === option.id ? 0 : -1}
              key={option.id}
              data-reset-mode={option.id}
              onClick={() => selectMode(option.id)}
              onKeyDown={(event) => handleModeKeyDown(event, option.id)}
            >
              <span className="reset-mode-card__title">{option.title}</span>
              <span className="reset-mode-card__summary">{option.summary}</span>
            </button>
          ))}
        </div>

        <div className="reset-workspace">
          <div className="reset-workspace__intro">
            <h3>{selectedMode.title}</h3>
            <p>{selectedMode.detail}</p>
            {(state.mode === "modulo-balance" || state.mode === "set-balances") && (
              <span className="reset-target-count">{selectedTargetCount} bucket(s) selected</span>
            )}
          </div>

          {state.mode === "modulo-balance" && (
            <>
              <div className="reset-control-grid">
                <label className="field reset-number-field">
                  <span>Modulus</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={state.modulus}
                    onChange={(event) => update({ modulus: event.target.value })}
                  />
                  <small className="field-hint">
                    Enter 1,000 to keep the last 3 digits. Non-positive balances are left alone.
                  </small>
                  {!modulusIsValid && (
                    <small className="field-error">Enter a whole-number modulus of at least 1.</small>
                  )}
                </label>
                <div className="reset-presets" aria-label="Common modulus presets">
                  {MODULUS_PRESETS.map((preset) => (
                    <button
                      type="button"
                      className="button button--small"
                      key={preset}
                      onClick={() => update({ modulus: preset })}
                    >
                      {formatNumber(Number(preset))}
                    </button>
                  ))}
                </div>
              </div>

              <div className="reset-target-grid" aria-label="Modulo reset targets">
                <label className="reset-target-card">
                  <input
                    type="checkbox"
                    checked={state.applyToParticipantCurrency}
                    onChange={(event) => update({ applyToParticipantCurrency: event.target.checked })}
                  />
                  <span>
                    <strong>{participantCurrencyBucket.label}</strong>
                    <small>{participantCurrencyBucket.description}</small>
                  </span>
                </label>
                <label className="reset-target-card">
                  <input
                    type="checkbox"
                    checked={state.applyToGroupPoints}
                    onChange={(event) => update({ applyToGroupPoints: event.target.checked })}
                  />
                  <span>
                    <strong>{groupPointsBucket.label}</strong>
                    <small>{groupPointsBucket.description}</small>
                  </span>
                </label>
                <label className="reset-target-card">
                  <input
                    type="checkbox"
                    checked={state.applyToGroupCurrency}
                    onChange={(event) => update({ applyToGroupCurrency: event.target.checked })}
                  />
                  <span>
                    <strong>{groupCurrencyBucket.label}</strong>
                    <small>{groupCurrencyBucket.description}</small>
                  </span>
                </label>
              </div>
            </>
          )}

          {state.mode === "reverse-entries-since" && (
            <>
              <div className="form-row">
                <label className="field">
                  <span>Reverse entries since</span>
                  <input
                    type="datetime-local"
                    value={state.since}
                    onChange={(event) => update({ since: event.target.value })}
                  />
                  <small className="field-hint">
                    The browser date is converted to UTC before sending. The reset writes one
                    correction entry per affected ledger.
                  </small>
                </label>
              </div>
              <div className="reset-ledger-grid">
                <fieldset className="reset-ledger-fieldset">
                  <legend>Participant wallet entry types</legend>
                  <div className="reset-fieldset-actions">
                    <button
                      type="button"
                      className="button button--small"
                      onClick={() => setParticipantTypes(PARTICIPANT_LEDGER_TYPES)}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="button button--small"
                      onClick={() => setParticipantTypes([])}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="checkbox-grid">
                    {PARTICIPANT_LEDGER_TYPES.map((type) => (
                      <label className="checkbox-field" key={`p-${type}`}>
                        <input
                          type="checkbox"
                          checked={state.participantTypes.has(type)}
                          onChange={() => toggleParticipantType(type)}
                        />
                        <span>{type}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="reset-ledger-fieldset">
                  <legend>Group ledger entry types</legend>
                  <div className="reset-fieldset-actions">
                    <button
                      type="button"
                      className="button button--small"
                      onClick={() => setGroupTypes(GROUP_LEDGER_TYPES)}
                    >
                      Select all
                    </button>
                    <button type="button" className="button button--small" onClick={() => setGroupTypes([])}>
                      Clear
                    </button>
                  </div>
                  <div className="checkbox-grid">
                    {GROUP_LEDGER_TYPES.map((type) => (
                      <label className="checkbox-field" key={`g-${type}`}>
                        <input
                          type="checkbox"
                          checked={state.groupTypes.has(type)}
                          onChange={() => toggleGroupType(type)}
                        />
                        <span>{type}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </>
          )}

          {state.mode === "cap-balances" && (
            <div className="reset-target-grid">
              <label className="field reset-target-card reset-target-card--stacked">
                <span>{participantCurrencyBucket.label}</span>
                <small>{participantCurrencyBucket.description}</small>
                <input
                  type="number"
                  min={0}
                  value={state.maxParticipantCurrency}
                  onChange={(event) => update({ maxParticipantCurrency: event.target.value })}
                  placeholder="leave blank to skip"
                />
              </label>
              <label className="field reset-target-card reset-target-card--stacked">
                <span>{groupPointsBucket.label}</span>
                <small>{groupPointsBucket.description}</small>
                <input
                  type="number"
                  min={0}
                  value={state.maxGroupPoints}
                  onChange={(event) => update({ maxGroupPoints: event.target.value })}
                  placeholder="leave blank to skip"
                />
              </label>
              <label className="field reset-target-card reset-target-card--stacked">
                <span>{groupCurrencyBucket.label}</span>
                <small>{groupCurrencyBucket.description}</small>
                <input
                  type="number"
                  min={0}
                  value={state.maxGroupCurrency}
                  onChange={(event) => update({ maxGroupCurrency: event.target.value })}
                  placeholder="leave blank to skip"
                />
              </label>
            </div>
          )}

          {state.mode === "set-balances" && (
            <div className="reset-target-grid">
              <label className="reset-target-card reset-target-card--stacked">
                <span className="reset-target-card__heading">
                  <input
                    type="checkbox"
                    checked={state.setParticipantCurrencyEnabled}
                    onChange={(event) => update({ setParticipantCurrencyEnabled: event.target.checked })}
                  />
                  <strong>{participantCurrencyBucket.label}</strong>
                </span>
                <small>{participantCurrencyBucket.description}</small>
                <input
                  type="number"
                  value={state.targetParticipantCurrency}
                  onChange={(event) => update({ targetParticipantCurrency: event.target.value })}
                  disabled={!state.setParticipantCurrencyEnabled}
                />
              </label>
              <label className="reset-target-card reset-target-card--stacked">
                <span className="reset-target-card__heading">
                  <input
                    type="checkbox"
                    checked={state.setGroupPointsEnabled}
                    onChange={(event) => update({ setGroupPointsEnabled: event.target.checked })}
                  />
                  <strong>{groupPointsBucket.label}</strong>
                </span>
                <small>{groupPointsBucket.description}</small>
                <input
                  type="number"
                  value={state.targetGroupPoints}
                  onChange={(event) => update({ targetGroupPoints: event.target.value })}
                  disabled={!state.setGroupPointsEnabled}
                />
              </label>
              <label className="reset-target-card reset-target-card--stacked">
                <span className="reset-target-card__heading">
                  <input
                    type="checkbox"
                    checked={state.setGroupCurrencyEnabled}
                    onChange={(event) => update({ setGroupCurrencyEnabled: event.target.checked })}
                  />
                  <strong>{groupCurrencyBucket.label}</strong>
                </span>
                <small>{groupCurrencyBucket.description}</small>
                <input
                  type="number"
                  value={state.targetGroupCurrency}
                  onChange={(event) => update({ targetGroupCurrency: event.target.value })}
                  disabled={!state.setGroupCurrencyEnabled}
                />
              </label>
            </div>
          )}
        </div>

        <div className="form-row">
          <label className="field reset-note-field">
            <span>Note (optional)</span>
            <input
              type="text"
              value={state.note}
              onChange={(event) => update({ note: event.target.value })}
              placeholder="Stored as the CORRECTION entry description and audit log payload"
              maxLength={500}
            />
          </label>
        </div>

        <div className="form-actions">
          <button type="button" onClick={() => run(true)} disabled={busy || !modulusIsValid}>
            {busy ? "Working…" : "Preview (dry run)"}
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => run(false)}
            disabled={busy || !modulusIsValid}
          >
            {busy ? "Working…" : "Execute"}
          </button>
        </div>

        {error && <p className="field-error">{error}</p>}
        {statusMessage && !error && <p className="field-hint">{statusMessage}</p>}
      </section>

      {result && <ResetResultView result={result} />}
      <SanctionsSection participants={participants} />
    </div>
  );
}

type SanctionDraft = {
  participantId: string;
  flag: ParticipantSanctionFlag;
  reason: string;
  expiresAt: string;
};

function defaultSanctionDraft(participantId: string): SanctionDraft {
  return { participantId, flag: "CANNOT_BET", reason: "", expiresAt: "" };
}

function describeParticipant(p: Participant): string {
  return `${p.discordUsername ?? p.discordUserId} · ${p.group.displayName}`;
}

function isSanctionActive(s: ParticipantSanction, now = Date.now()): boolean {
  if (s.revokedAt) return false;
  if (s.expiresAt && new Date(s.expiresAt).getTime() <= now) return false;
  return true;
}

function SanctionsSection({ participants }: { participants: Participant[] }) {
  const [sanctions, setSanctions] = useState<ParticipantSanction[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SanctionDraft>(() =>
    defaultSanctionDraft(participants[0]?.id ?? ""),
  );

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api.listSanctions();
      setSanctions(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!draft.participantId && participants.length > 0) {
      setDraft(defaultSanctionDraft(participants[0]!.id));
    }
  }, [participants, draft.participantId]);

  const participantById = useMemo(
    () => new Map(participants.map((p) => [p.id, p])),
    [participants],
  );

  const apply = async () => {
    if (!draft.participantId) {
      setError("Pick a participant first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.applySanction(draft.participantId, {
        flag: draft.flag,
        reason: draft.reason.trim() || undefined,
        expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
      });
      setDraft((prev) => ({ ...prev, reason: "", expiresAt: "" }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (sanctionId: string) => {
    if (!window.confirm("Revoke this sanction?")) return;
    setBusy(true);
    setError(null);
    try {
      await api.revokeSanction(sanctionId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const sortedSanctions = useMemo(() => {
    return [...sanctions].sort((a, b) => {
      const aActive = isSanctionActive(a);
      const bActive = isSanctionActive(b);
      if (aActive !== bActive) return aActive ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [sanctions]);

  return (
    <section className="section">
      <header className="section-header">
        <h2>Sanctions</h2>
        <p className="section-help">
          Restrict specific participants from particular activities. Sanctions optionally expire
          (e.g. a 24-hour timeout). All sanction events are audit-logged.
        </p>
      </header>

      <div className="form-row">
        <label className="field">
          <span>Participant</span>
          <select
            value={draft.participantId}
            onChange={(event) => setDraft((prev) => ({ ...prev, participantId: event.target.value }))}
          >
            {participants.length === 0 && <option value="">No participants</option>}
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {describeParticipant(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Flag</span>
          <select
            value={draft.flag}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, flag: event.target.value as ParticipantSanctionFlag }))
            }
          >
            {SANCTION_FLAGS.map((flag) => (
              <option key={flag} value={flag}>
                {FLAG_LABEL[flag]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="form-row">
        <label className="field">
          <span>Reason (optional)</span>
          <input
            type="text"
            value={draft.reason}
            onChange={(event) => setDraft((prev) => ({ ...prev, reason: event.target.value }))}
            maxLength={500}
            placeholder="e.g. Repeatedly placed huge bets to drain other students"
          />
        </label>
        <label className="field">
          <span>Expires (optional, leave blank for indefinite)</span>
          <input
            type="datetime-local"
            value={draft.expiresAt}
            onChange={(event) => setDraft((prev) => ({ ...prev, expiresAt: event.target.value }))}
          />
        </label>
      </div>

      <div className="form-actions">
        <button type="button" onClick={apply} disabled={busy || !draft.participantId}>
          {busy ? "Working…" : "Apply sanction"}
        </button>
        <button type="button" onClick={refresh} disabled={loading || busy}>
          Refresh
        </button>
      </div>

      {error && <p className="field-error">{error}</p>}

      {sortedSanctions.length === 0 ? (
        <p className="section-help">No sanctions yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Participant</th>
              <th>Flag</th>
              <th>Reason</th>
              <th>Expires</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedSanctions.map((s) => {
              const active = isSanctionActive(s);
              const participant = participantById.get(s.participantId);
              const status = s.revokedAt
                ? "Revoked"
                : s.expiresAt && new Date(s.expiresAt).getTime() <= Date.now()
                  ? "Expired"
                  : "Active";
              return (
                <tr key={s.id} style={active ? undefined : { opacity: 0.6 }}>
                  <td>{status}</td>
                  <td>
                    {participant ? describeParticipant(participant) : <code>{s.participantId}</code>}
                  </td>
                  <td>{FLAG_LABEL[s.flag]}</td>
                  <td>{s.reason ?? "None"}</td>
                  <td>{s.expiresAt ? new Date(s.expiresAt).toLocaleString() : "indefinite"}</td>
                  <td>{new Date(s.createdAt).toLocaleString()}</td>
                  <td>
                    {active && (
                      <button
                        type="button"
                        className="button button--small"
                        onClick={() => revoke(s.id)}
                        disabled={busy}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ResetResultView({ result }: { result: EconomyResetResult }) {
  return (
    <section className="section">
      <header className="section-header">
        <h2>{result.dryRun ? "Dry run preview" : "Result"}</h2>
        <p className="section-help">
          {result.mode === "reverse-entries-since" && (
            <>
              Scanned {result.scannedParticipantEntries} participant entries and{" "}
              {result.scannedGroupEntries} group entries.
            </>
          )}
          {result.mode === "cap-balances" && <>Capped any balance over the configured maximum.</>}
          {result.mode === "modulo-balance" && (
            <>Trimmed positive balances using modulus {result.modulus}.</>
          )}
          {result.mode === "set-balances" && <>Set selected balances to fixed targets.</>}{" "}
          Total currency delta: <strong>{formatDelta(result.totalCurrencyDelta)}</strong>. Total
          points delta: <strong>{formatDelta(result.totalPointsDelta)}</strong>.
        </p>
        {!result.dryRun && (
          <p className="field-hint">
            CORRECTION entry IDs:{" "}
            <code>{result.participantCorrectionEntryId ?? "None"}</code> (participant),{" "}
            <code>{result.groupCorrectionEntryId ?? "None"}</code> (group)
          </p>
        )}
      </header>

      {result.participantImpact.length > 0 && (
        <div className="section">
          <h3>Participant wallets affected ({result.participantImpact.length})</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Before</th>
                <th>Delta</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {result.participantImpact.map((row) => (
                <tr key={row.participantId}>
                  <td>
                    {row.discordUsername ?? row.discordUserId} <code>{row.discordUserId}</code>
                  </td>
                  <td>{formatNumber(row.balanceBefore)}</td>
                  <td>{formatDelta(row.delta)}</td>
                  <td>{formatNumber(row.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.groupImpact.length > 0 && (
        <div className="section">
          <h3>Groups affected ({result.groupImpact.length})</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Points before</th>
                <th>Points delta</th>
                <th>Points after</th>
                <th>Currency before</th>
                <th>Currency delta</th>
                <th>Currency after</th>
              </tr>
            </thead>
            <tbody>
              {result.groupImpact.map((row) => (
                <tr key={row.groupId}>
                  <td>{row.displayName}</td>
                  <td>{formatNumber(row.pointsBefore)}</td>
                  <td>{formatDelta(row.pointsDelta)}</td>
                  <td>{formatNumber(row.pointsAfter)}</td>
                  <td>{formatNumber(row.currencyBefore)}</td>
                  <td>{formatDelta(row.currencyDelta)}</td>
                  <td>{formatNumber(row.currencyAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.participantImpact.length === 0 && result.groupImpact.length === 0 && (
        <p className="section-help">Nothing to do. No balances or entries matched.</p>
      )}
    </section>
  );
}
