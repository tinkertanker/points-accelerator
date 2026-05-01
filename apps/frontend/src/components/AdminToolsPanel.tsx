import { useEffect, useMemo, useState } from "react";

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

  const run = async (dryRun: boolean) => {
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
        <header className="section-header">
          <h2>Economy reset</h2>
          <p className="section-help">
            Four modes for reining in runaway balances. All modes write append-only{" "}
            <code>CORRECTION</code> ledger entries — nothing is destroyed; everything is auditable.
            Always run a dry run first.
          </p>
        </header>

        <div className="form-row">
          <label className="field">
            <span>Mode</span>
            <select
              value={state.mode}
              onChange={(event) => {
                setResult(null);
                update({ mode: event.target.value as ResetMode });
              }}
            >
              <option value="modulo-balance">Keep last N digits (balance % modulus)</option>
              <option value="reverse-entries-since">Reverse ledger entries since…</option>
              <option value="cap-balances">Cap balances at maximum</option>
              <option value="set-balances">☢️ Nuke — set balances to a fixed value (default 0)</option>
            </select>
          </label>
        </div>

        {state.mode === "modulo-balance" && (
          <div className="form-row">
            <label className="field">
              <span>Modulus</span>
              <input
                type="number"
                min={1}
                step={1}
                value={state.modulus}
                onChange={(event) => update({ modulus: event.target.value })}
              />
              <small className="field-hint">
                Modulus 1000 keeps the last 3 digits — 999,999,999,999 → 999, 50 → 50, 4500 → 500.
                Non-positive balances are left alone.
              </small>
            </label>
          </div>
        )}
        {state.mode === "modulo-balance" && (
          <div className="form-row">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={state.applyToParticipantCurrency}
                onChange={(event) => update({ applyToParticipantCurrency: event.target.checked })}
              />
              <span>Apply to participant wallets (currency)</span>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={state.applyToGroupPoints}
                onChange={(event) => update({ applyToGroupPoints: event.target.checked })}
              />
              <span>Apply to group points</span>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={state.applyToGroupCurrency}
                onChange={(event) => update({ applyToGroupCurrency: event.target.checked })}
              />
              <span>Apply to group currency</span>
            </label>
          </div>
        )}

        {state.mode === "reverse-entries-since" && (
          <>
            <div className="form-row">
              <label className="field">
                <span>Since (UTC)</span>
                <input
                  type="datetime-local"
                  value={state.since}
                  onChange={(event) => update({ since: event.target.value })}
                />
                <small className="field-hint">
                  Reverses every targeted ledger entry created at or after this moment by writing a
                  single CORRECTION entry that mirrors the splits with negated deltas.
                </small>
              </label>
            </div>
            <div className="form-row">
              <fieldset className="field">
                <legend>Participant ledger types</legend>
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
            </div>
            <div className="form-row">
              <fieldset className="field">
                <legend>Group ledger types</legend>
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
          <div className="form-row">
            <label className="field">
              <span>Max participant currency</span>
              <input
                type="number"
                min={0}
                value={state.maxParticipantCurrency}
                onChange={(event) => update({ maxParticipantCurrency: event.target.value })}
                placeholder="leave blank to skip"
              />
            </label>
            <label className="field">
              <span>Max group points</span>
              <input
                type="number"
                min={0}
                value={state.maxGroupPoints}
                onChange={(event) => update({ maxGroupPoints: event.target.value })}
                placeholder="leave blank to skip"
              />
            </label>
            <label className="field">
              <span>Max group currency</span>
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
          <>
            <p className="section-help">
              Set every selected balance to a fixed value (default 0). Leaves untouched balances
              that already match. Use 0 across the board to nuke the economy.
            </p>
            <div className="form-row">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={state.setParticipantCurrencyEnabled}
                  onChange={(event) => update({ setParticipantCurrencyEnabled: event.target.checked })}
                />
                <span>Participant wallets to</span>
                <input
                  type="number"
                  value={state.targetParticipantCurrency}
                  onChange={(event) => update({ targetParticipantCurrency: event.target.value })}
                  disabled={!state.setParticipantCurrencyEnabled}
                />
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={state.setGroupPointsEnabled}
                  onChange={(event) => update({ setGroupPointsEnabled: event.target.checked })}
                />
                <span>Group points to</span>
                <input
                  type="number"
                  value={state.targetGroupPoints}
                  onChange={(event) => update({ targetGroupPoints: event.target.value })}
                  disabled={!state.setGroupPointsEnabled}
                />
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={state.setGroupCurrencyEnabled}
                  onChange={(event) => update({ setGroupCurrencyEnabled: event.target.checked })}
                />
                <span>Group currency to</span>
                <input
                  type="number"
                  value={state.targetGroupCurrency}
                  onChange={(event) => update({ targetGroupCurrency: event.target.value })}
                  disabled={!state.setGroupCurrencyEnabled}
                />
              </label>
            </div>
          </>
        )}

        <div className="form-row">
          <label className="field">
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
          <button type="button" onClick={() => run(true)} disabled={busy}>
            {busy ? "Working…" : "Preview (dry run)"}
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => run(false)}
            disabled={busy}
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
                  <td>{s.reason ?? "—"}</td>
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
            <code>{result.participantCorrectionEntryId ?? "—"}</code> (participant),{" "}
            <code>{result.groupCorrectionEntryId ?? "—"}</code> (group)
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
        <p className="section-help">Nothing to do — no balances or entries matched.</p>
      )}
    </section>
  );
}
