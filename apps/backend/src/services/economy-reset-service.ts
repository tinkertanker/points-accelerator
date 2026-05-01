import {
  Prisma,
  type LedgerEntryType,
  type ParticipantCurrencyEntryType,
  type PrismaClient,
} from "@prisma/client";

import { AppError } from "../utils/app-error.js";
import { decimal, decimalToNumber } from "../utils/decimal.js";

import type { AuditService } from "./audit-service.js";

export type ResetActor = {
  userId: string;
  username: string;
};

export type ParticipantImpact = {
  participantId: string;
  discordUserId: string;
  discordUsername: string | null;
  balanceBefore: number;
  delta: number;
  balanceAfter: number;
};

export type GroupImpact = {
  groupId: string;
  displayName: string;
  pointsBefore: number;
  pointsDelta: number;
  pointsAfter: number;
  currencyBefore: number;
  currencyDelta: number;
  currencyAfter: number;
};

export type ReverseEntriesResult = {
  mode: "reverse-entries-since";
  dryRun: boolean;
  scannedParticipantEntries: number;
  scannedGroupEntries: number;
  participantImpact: ParticipantImpact[];
  groupImpact: GroupImpact[];
  totalCurrencyDelta: number;
  totalPointsDelta: number;
  participantCorrectionEntryId: string | null;
  groupCorrectionEntryId: string | null;
};

export type CapBalancesResult = {
  mode: "cap-balances";
  dryRun: boolean;
  participantImpact: ParticipantImpact[];
  groupImpact: GroupImpact[];
  totalCurrencyDelta: number;
  totalPointsDelta: number;
  participantCorrectionEntryId: string | null;
  groupCorrectionEntryId: string | null;
};

export type ModuloBalancesResult = {
  mode: "modulo-balance";
  dryRun: boolean;
  modulus: number;
  participantImpact: ParticipantImpact[];
  groupImpact: GroupImpact[];
  totalCurrencyDelta: number;
  totalPointsDelta: number;
  participantCorrectionEntryId: string | null;
  groupCorrectionEntryId: string | null;
};

export type SetBalancesResult = {
  mode: "set-balances";
  dryRun: boolean;
  participantImpact: ParticipantImpact[];
  groupImpact: GroupImpact[];
  totalCurrencyDelta: number;
  totalPointsDelta: number;
  participantCorrectionEntryId: string | null;
  groupCorrectionEntryId: string | null;
};

const PARTICIPANT_REVERSAL_TYPE: ParticipantCurrencyEntryType = "CORRECTION";
const GROUP_REVERSAL_TYPE: LedgerEntryType = "CORRECTION";
// Decimal(18,6) columns can hold up to 999_999_999_999.999999 in absolute
// value (precision 18, scale 6 → 12 integer digits). Splits with a magnitude
// exceeding this overflow Postgres on insert, so we chunk them before write.
const MAX_SPLIT_MAGNITUDE = 999_999_999_999;

export class EconomyResetService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Reverse every ledger entry of the given types created since `since`,
   * by writing a single CORRECTION entry on each ledger that mirrors the
   * original splits with negated deltas. Bypasses the usual non-negative
   * balance check — a wallet may go negative if the abuser already spent
   * the abused amount.
   */
  public async reverseEntriesByTypeSince(params: {
    guildId: string;
    actor: ResetActor;
    participantTypes?: ParticipantCurrencyEntryType[];
    groupTypes?: LedgerEntryType[];
    since: Date;
    dryRun: boolean;
    note?: string;
  }): Promise<ReverseEntriesResult> {
    if (!params.participantTypes?.length && !params.groupTypes?.length) {
      throw new AppError("Specify at least one entry type to reverse.", 400);
    }
    if (!Number.isFinite(params.since.getTime())) {
      throw new AppError("`since` must be a valid date.", 400);
    }

    return this.prisma.$transaction(async (tx) => {
      const participantImpactMap = new Map<string, ParticipantImpact>();
      const groupImpactMap = new Map<string, GroupImpact>();
      let scannedParticipantEntries = 0;
      let scannedGroupEntries = 0;
      const participantSplitsToWrite: Array<{ participantId: string; currencyDelta: number }> = [];
      const groupSplitsToWrite: Array<{ groupId: string; pointsDelta: number; currencyDelta: number }> = [];
      const reversedParticipantEntryIds: string[] = [];
      const reversedGroupEntryIds: string[] = [];

      if (params.participantTypes?.length) {
        const entries = await tx.participantCurrencyEntry.findMany({
          where: {
            guildId: params.guildId,
            type: { in: params.participantTypes },
            createdAt: { gte: params.since },
          },
          include: { splits: { include: { participant: true } } },
        });
        scannedParticipantEntries = entries.length;
        for (const entry of entries) {
          reversedParticipantEntryIds.push(entry.id);
          for (const split of entry.splits) {
            const delta = -decimalToNumber(split.currencyDelta);
            if (delta === 0) continue;
            participantSplitsToWrite.push({ participantId: split.participantId, currencyDelta: delta });
            const existing = participantImpactMap.get(split.participantId);
            if (existing) {
              existing.delta += delta;
            } else {
              participantImpactMap.set(split.participantId, {
                participantId: split.participantId,
                discordUserId: split.participant.discordUserId,
                discordUsername: split.participant.discordUsername,
                balanceBefore: 0,
                delta,
                balanceAfter: 0,
              });
            }
          }
        }
      }

      if (params.groupTypes?.length) {
        const entries = await tx.ledgerEntry.findMany({
          where: {
            guildId: params.guildId,
            type: { in: params.groupTypes },
            createdAt: { gte: params.since },
          },
          include: { splits: { include: { group: true } } },
        });
        scannedGroupEntries = entries.length;
        for (const entry of entries) {
          reversedGroupEntryIds.push(entry.id);
          for (const split of entry.splits) {
            const pointsDelta = -decimalToNumber(split.pointsDelta);
            const currencyDelta = -decimalToNumber(split.currencyDelta);
            if (pointsDelta === 0 && currencyDelta === 0) continue;
            groupSplitsToWrite.push({ groupId: split.groupId, pointsDelta, currencyDelta });
            const existing = groupImpactMap.get(split.groupId);
            if (existing) {
              existing.pointsDelta += pointsDelta;
              existing.currencyDelta += currencyDelta;
            } else {
              groupImpactMap.set(split.groupId, {
                groupId: split.groupId,
                displayName: split.group.displayName,
                pointsBefore: 0,
                pointsDelta,
                pointsAfter: 0,
                currencyBefore: 0,
                currencyDelta,
                currencyAfter: 0,
              });
            }
          }
        }
      }

      const participantImpact = Array.from(participantImpactMap.values());
      const groupImpact = Array.from(groupImpactMap.values());

      await this.fillParticipantBalances(tx, participantImpact);
      await this.fillGroupBalances(tx, groupImpact);

      let participantCorrectionEntryId: string | null = null;
      let groupCorrectionEntryId: string | null = null;
      let totalCurrencyDelta = participantImpact.reduce((sum, row) => sum + row.delta, 0);
      let totalPointsDelta = groupImpact.reduce((sum, row) => sum + row.pointsDelta, 0);
      totalCurrencyDelta += groupImpact.reduce((sum, row) => sum + row.currencyDelta, 0);

      if (!params.dryRun) {
        const description = params.note?.trim()
          ? params.note.trim()
          : `Economy reset — reversed entries since ${params.since.toISOString()}`;

        if (participantSplitsToWrite.length > 0) {
          const merged = chunkParticipantSplits(mergeParticipantSplits(participantSplitsToWrite));
          const created = await tx.participantCurrencyEntry.create({
            data: {
              guildId: params.guildId,
              type: PARTICIPANT_REVERSAL_TYPE,
              description,
              createdByUserId: params.actor.userId,
              createdByUsername: params.actor.username,
              splits: {
                create: merged.map((split) => ({
                  participantId: split.participantId,
                  currencyDelta: decimal(split.currencyDelta),
                })),
              },
            },
          });
          participantCorrectionEntryId = created.id;
        }

        if (groupSplitsToWrite.length > 0) {
          const merged = chunkGroupSplits(mergeGroupSplits(groupSplitsToWrite));
          const created = await tx.ledgerEntry.create({
            data: {
              guildId: params.guildId,
              type: GROUP_REVERSAL_TYPE,
              description,
              createdByUserId: params.actor.userId,
              createdByUsername: params.actor.username,
              splits: {
                create: merged.map((split) => ({
                  groupId: split.groupId,
                  pointsDelta: decimal(split.pointsDelta),
                  currencyDelta: decimal(split.currencyDelta),
                })),
              },
            },
          });
          groupCorrectionEntryId = created.id;
        }

        await this.auditService.record({
          guildId: params.guildId,
          actorUserId: params.actor.userId,
          actorUsername: params.actor.username,
          action: "economy.reset.reverse_entries_since",
          entityType: "EconomyReset",
          payload: {
            since: params.since.toISOString(),
            participantTypes: params.participantTypes ?? [],
            groupTypes: params.groupTypes ?? [],
            reversedParticipantEntryIds,
            reversedGroupEntryIds,
            participantCorrectionEntryId,
            groupCorrectionEntryId,
            totalCurrencyDelta,
            totalPointsDelta,
            note: params.note ?? null,
          },
          executor: tx,
        });
      }

      return {
        mode: "reverse-entries-since",
        dryRun: params.dryRun,
        scannedParticipantEntries,
        scannedGroupEntries,
        participantImpact,
        groupImpact,
        totalCurrencyDelta,
        totalPointsDelta,
        participantCorrectionEntryId,
        groupCorrectionEntryId,
      };
    });
  }

  /**
   * Cap every balance above the configured maximum down to that maximum
   * by writing a single CORRECTION entry on each ledger.
   */
  public async capBalances(params: {
    guildId: string;
    actor: ResetActor;
    maxParticipantCurrency?: number;
    maxGroupPoints?: number;
    maxGroupCurrency?: number;
    dryRun: boolean;
    note?: string;
  }): Promise<CapBalancesResult> {
    if (
      params.maxParticipantCurrency === undefined &&
      params.maxGroupPoints === undefined &&
      params.maxGroupCurrency === undefined
    ) {
      throw new AppError("At least one cap value is required.", 400);
    }
    for (const [name, value] of [
      ["maxParticipantCurrency", params.maxParticipantCurrency] as const,
      ["maxGroupPoints", params.maxGroupPoints] as const,
      ["maxGroupCurrency", params.maxGroupCurrency] as const,
    ]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new AppError(`${name} must be a non-negative finite number.`, 400);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const participantImpact: ParticipantImpact[] = [];
      const groupImpact: GroupImpact[] = [];
      const participantSplits: Array<{ participantId: string; currencyDelta: number }> = [];
      const groupSplits: Array<{ groupId: string; pointsDelta: number; currencyDelta: number }> = [];

      if (params.maxParticipantCurrency !== undefined) {
        const cap = params.maxParticipantCurrency;
        const grouped = await tx.participantCurrencySplit.groupBy({
          by: ["participantId"],
          _sum: { currencyDelta: true },
          where: { participant: { guildId: params.guildId } },
        });
        const exceedingIds = grouped
          .map((row) => ({ id: row.participantId, balance: decimalToNumber(row._sum.currencyDelta) }))
          .filter((row) => row.balance > cap);
        if (exceedingIds.length > 0) {
          const participants = await tx.participant.findMany({
            where: { id: { in: exceedingIds.map((row) => row.id) } },
            select: { id: true, discordUserId: true, discordUsername: true },
          });
          const participantById = new Map(participants.map((p) => [p.id, p]));
          for (const row of exceedingIds) {
            const participant = participantById.get(row.id);
            if (!participant) continue;
            const delta = cap - row.balance;
            participantSplits.push({ participantId: row.id, currencyDelta: delta });
            participantImpact.push({
              participantId: row.id,
              discordUserId: participant.discordUserId,
              discordUsername: participant.discordUsername,
              balanceBefore: row.balance,
              delta,
              balanceAfter: cap,
            });
          }
        }
      }

      if (params.maxGroupPoints !== undefined || params.maxGroupCurrency !== undefined) {
        const grouped = await tx.ledgerSplit.groupBy({
          by: ["groupId"],
          _sum: { pointsDelta: true, currencyDelta: true },
          where: { group: { guildId: params.guildId } },
        });
        const groupIds = grouped.map((row) => row.groupId);
        const groups = groupIds.length
          ? await tx.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, displayName: true } })
          : [];
        const groupById = new Map(groups.map((g) => [g.id, g]));

        for (const row of grouped) {
          const group = groupById.get(row.groupId);
          if (!group) continue;
          const pointsBefore = decimalToNumber(row._sum.pointsDelta);
          const currencyBefore = decimalToNumber(row._sum.currencyDelta);
          let pointsDelta = 0;
          let currencyDelta = 0;
          if (params.maxGroupPoints !== undefined && pointsBefore > params.maxGroupPoints) {
            pointsDelta = params.maxGroupPoints - pointsBefore;
          }
          if (params.maxGroupCurrency !== undefined && currencyBefore > params.maxGroupCurrency) {
            currencyDelta = params.maxGroupCurrency - currencyBefore;
          }
          if (pointsDelta === 0 && currencyDelta === 0) continue;
          groupSplits.push({ groupId: row.groupId, pointsDelta, currencyDelta });
          groupImpact.push({
            groupId: row.groupId,
            displayName: group.displayName,
            pointsBefore,
            pointsDelta,
            pointsAfter: pointsBefore + pointsDelta,
            currencyBefore,
            currencyDelta,
            currencyAfter: currencyBefore + currencyDelta,
          });
        }
      }

      let participantCorrectionEntryId: string | null = null;
      let groupCorrectionEntryId: string | null = null;
      const totalCurrencyDelta =
        participantImpact.reduce((sum, row) => sum + row.delta, 0) +
        groupImpact.reduce((sum, row) => sum + row.currencyDelta, 0);
      const totalPointsDelta = groupImpact.reduce((sum, row) => sum + row.pointsDelta, 0);

      if (!params.dryRun) {
        const description = params.note?.trim()
          ? params.note.trim()
          : `Economy reset — capped balances`;

        const chunkedParticipantSplits = chunkParticipantSplits(participantSplits);
        if (chunkedParticipantSplits.length > 0) {
          const created = await tx.participantCurrencyEntry.create({
            data: {
              guildId: params.guildId,
              type: PARTICIPANT_REVERSAL_TYPE,
              description,
              createdByUserId: params.actor.userId,
              createdByUsername: params.actor.username,
              splits: {
                create: chunkedParticipantSplits.map((split) => ({
                  participantId: split.participantId,
                  currencyDelta: decimal(split.currencyDelta),
                })),
              },
            },
          });
          participantCorrectionEntryId = created.id;
        }

        const chunkedGroupSplits = chunkGroupSplits(groupSplits);
        if (chunkedGroupSplits.length > 0) {
          const created = await tx.ledgerEntry.create({
            data: {
              guildId: params.guildId,
              type: GROUP_REVERSAL_TYPE,
              description,
              createdByUserId: params.actor.userId,
              createdByUsername: params.actor.username,
              splits: {
                create: chunkedGroupSplits.map((split) => ({
                  groupId: split.groupId,
                  pointsDelta: decimal(split.pointsDelta),
                  currencyDelta: decimal(split.currencyDelta),
                })),
              },
            },
          });
          groupCorrectionEntryId = created.id;
        }

        await this.auditService.record({
          guildId: params.guildId,
          actorUserId: params.actor.userId,
          actorUsername: params.actor.username,
          action: "economy.reset.cap_balances",
          entityType: "EconomyReset",
          payload: {
            maxParticipantCurrency: params.maxParticipantCurrency ?? null,
            maxGroupPoints: params.maxGroupPoints ?? null,
            maxGroupCurrency: params.maxGroupCurrency ?? null,
            participantCorrectionEntryId,
            groupCorrectionEntryId,
            totalCurrencyDelta,
            totalPointsDelta,
            note: params.note ?? null,
          },
          executor: tx,
        });
      }

      return {
        mode: "cap-balances",
        dryRun: params.dryRun,
        participantImpact,
        groupImpact,
        totalCurrencyDelta,
        totalPointsDelta,
        participantCorrectionEntryId,
        groupCorrectionEntryId,
      };
    });
  }

  /**
   * Trim every positive balance down to its remainder modulo `modulus`
   * (e.g. modulus=1000 keeps the last 3 digits). Non-positive balances
   * are untouched. Useful for nuking abuse that has inflated balances
   * by orders of magnitude while preserving small legit balances.
   */
  public async moduloBalances(params: {
    guildId: string;
    actor: ResetActor;
    modulus: number;
    applyToParticipantCurrency?: boolean;
    applyToGroupPoints?: boolean;
    applyToGroupCurrency?: boolean;
    dryRun: boolean;
    note?: string;
  }): Promise<ModuloBalancesResult> {
    if (!Number.isFinite(params.modulus) || !Number.isInteger(params.modulus) || params.modulus < 1) {
      throw new AppError("`modulus` must be a positive integer.", 400);
    }
    const anyTarget =
      params.applyToParticipantCurrency || params.applyToGroupPoints || params.applyToGroupCurrency;
    if (!anyTarget) {
      throw new AppError("Select at least one target (participant currency / group points / group currency).", 400);
    }

    return this.prisma.$transaction(async (tx) => {
      const participantImpact: ParticipantImpact[] = [];
      const groupImpact: GroupImpact[] = [];
      const participantSplits: Array<{ participantId: string; currencyDelta: number }> = [];
      const groupSplits: Array<{ groupId: string; pointsDelta: number; currencyDelta: number }> = [];

      if (params.applyToParticipantCurrency) {
        const grouped = await tx.participantCurrencySplit.groupBy({
          by: ["participantId"],
          _sum: { currencyDelta: true },
          where: { participant: { guildId: params.guildId } },
        });
        const positive = grouped
          .map((row) => ({ id: row.participantId, balance: decimalToNumber(row._sum.currencyDelta) }))
          .filter((row) => row.balance > 0);
        const trimmed = positive
          .map((row) => ({ id: row.id, before: row.balance, after: row.balance % params.modulus }))
          .filter((row) => row.before !== row.after);
        if (trimmed.length > 0) {
          const participants = await tx.participant.findMany({
            where: { id: { in: trimmed.map((row) => row.id) } },
            select: { id: true, discordUserId: true, discordUsername: true },
          });
          const participantById = new Map(participants.map((p) => [p.id, p]));
          for (const row of trimmed) {
            const participant = participantById.get(row.id);
            if (!participant) continue;
            const delta = row.after - row.before;
            participantSplits.push({ participantId: row.id, currencyDelta: delta });
            participantImpact.push({
              participantId: row.id,
              discordUserId: participant.discordUserId,
              discordUsername: participant.discordUsername,
              balanceBefore: row.before,
              delta,
              balanceAfter: row.after,
            });
          }
        }
      }

      if (params.applyToGroupPoints || params.applyToGroupCurrency) {
        const grouped = await tx.ledgerSplit.groupBy({
          by: ["groupId"],
          _sum: { pointsDelta: true, currencyDelta: true },
          where: { group: { guildId: params.guildId } },
        });
        const groupIds = grouped.map((row) => row.groupId);
        const groups = groupIds.length
          ? await tx.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, displayName: true } })
          : [];
        const groupById = new Map(groups.map((g) => [g.id, g]));

        for (const row of grouped) {
          const group = groupById.get(row.groupId);
          if (!group) continue;
          const pointsBefore = decimalToNumber(row._sum.pointsDelta);
          const currencyBefore = decimalToNumber(row._sum.currencyDelta);
          let pointsDelta = 0;
          let currencyDelta = 0;
          if (params.applyToGroupPoints && pointsBefore > 0) {
            const after = pointsBefore % params.modulus;
            if (after !== pointsBefore) pointsDelta = after - pointsBefore;
          }
          if (params.applyToGroupCurrency && currencyBefore > 0) {
            const after = currencyBefore % params.modulus;
            if (after !== currencyBefore) currencyDelta = after - currencyBefore;
          }
          if (pointsDelta === 0 && currencyDelta === 0) continue;
          groupSplits.push({ groupId: row.groupId, pointsDelta, currencyDelta });
          groupImpact.push({
            groupId: row.groupId,
            displayName: group.displayName,
            pointsBefore,
            pointsDelta,
            pointsAfter: pointsBefore + pointsDelta,
            currencyBefore,
            currencyDelta,
            currencyAfter: currencyBefore + currencyDelta,
          });
        }
      }

      let participantCorrectionEntryId: string | null = null;
      let groupCorrectionEntryId: string | null = null;
      const totalCurrencyDelta =
        participantImpact.reduce((sum, row) => sum + row.delta, 0) +
        groupImpact.reduce((sum, row) => sum + row.currencyDelta, 0);
      const totalPointsDelta = groupImpact.reduce((sum, row) => sum + row.pointsDelta, 0);

      if (!params.dryRun) {
        const description = params.note?.trim()
          ? params.note.trim()
          : `Economy reset — kept balances modulo ${params.modulus}`;

        const chunkedParticipantSplits = chunkParticipantSplits(participantSplits);
        if (chunkedParticipantSplits.length > 0) {
          const created = await tx.participantCurrencyEntry.create({
            data: {
              guildId: params.guildId,
              type: PARTICIPANT_REVERSAL_TYPE,
              description,
              createdByUserId: params.actor.userId,
              createdByUsername: params.actor.username,
              splits: {
                create: chunkedParticipantSplits.map((split) => ({
                  participantId: split.participantId,
                  currencyDelta: decimal(split.currencyDelta),
                })),
              },
            },
          });
          participantCorrectionEntryId = created.id;
        }

        const chunkedGroupSplits = chunkGroupSplits(groupSplits);
        if (chunkedGroupSplits.length > 0) {
          const created = await tx.ledgerEntry.create({
            data: {
              guildId: params.guildId,
              type: GROUP_REVERSAL_TYPE,
              description,
              createdByUserId: params.actor.userId,
              createdByUsername: params.actor.username,
              splits: {
                create: chunkedGroupSplits.map((split) => ({
                  groupId: split.groupId,
                  pointsDelta: decimal(split.pointsDelta),
                  currencyDelta: decimal(split.currencyDelta),
                })),
              },
            },
          });
          groupCorrectionEntryId = created.id;
        }

        await this.auditService.record({
          guildId: params.guildId,
          actorUserId: params.actor.userId,
          actorUsername: params.actor.username,
          action: "economy.reset.modulo_balances",
          entityType: "EconomyReset",
          payload: {
            modulus: params.modulus,
            applyToParticipantCurrency: params.applyToParticipantCurrency ?? false,
            applyToGroupPoints: params.applyToGroupPoints ?? false,
            applyToGroupCurrency: params.applyToGroupCurrency ?? false,
            participantCorrectionEntryId,
            groupCorrectionEntryId,
            totalCurrencyDelta,
            totalPointsDelta,
            note: params.note ?? null,
          },
          executor: tx,
        });
      }

      return {
        mode: "modulo-balance",
        dryRun: params.dryRun,
        modulus: params.modulus,
        participantImpact,
        groupImpact,
        totalCurrencyDelta,
        totalPointsDelta,
        participantCorrectionEntryId,
        groupCorrectionEntryId,
      };
    });
  }

  /**
   * Set every balance in the selected buckets to a fixed target value
   * (default 0 — i.e. nuke). Writes a single CORRECTION entry per ledger
   * containing one split per affected entity with delta = target - balance.
   */
  public async setBalances(params: {
    guildId: string;
    actor: ResetActor;
    targetParticipantCurrency?: number;
    targetGroupPoints?: number;
    targetGroupCurrency?: number;
    dryRun: boolean;
    note?: string;
  }): Promise<SetBalancesResult> {
    const enabled = [
      ["targetParticipantCurrency", params.targetParticipantCurrency],
      ["targetGroupPoints", params.targetGroupPoints],
      ["targetGroupCurrency", params.targetGroupCurrency],
    ] as const;
    if (enabled.every(([, value]) => value === undefined)) {
      throw new AppError("Select at least one bucket to set.", 400);
    }
    for (const [name, value] of enabled) {
      if (value !== undefined && !Number.isFinite(value)) {
        throw new AppError(`${name} must be a finite number.`, 400);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const participantImpact: ParticipantImpact[] = [];
      const groupImpact: GroupImpact[] = [];
      const participantSplits: Array<{ participantId: string; currencyDelta: number }> = [];
      const groupSplits: Array<{ groupId: string; pointsDelta: number; currencyDelta: number }> = [];

      if (params.targetParticipantCurrency !== undefined) {
        const target = params.targetParticipantCurrency;
        const grouped = await tx.participantCurrencySplit.groupBy({
          by: ["participantId"],
          _sum: { currencyDelta: true },
          where: { participant: { guildId: params.guildId } },
        });
        const drift = grouped
          .map((row) => ({ id: row.participantId, balance: decimalToNumber(row._sum.currencyDelta) }))
          .filter((row) => row.balance !== target);
        if (drift.length > 0) {
          const participants = await tx.participant.findMany({
            where: { id: { in: drift.map((row) => row.id) } },
            select: { id: true, discordUserId: true, discordUsername: true },
          });
          const byId = new Map(participants.map((p) => [p.id, p]));
          for (const row of drift) {
            const p = byId.get(row.id);
            if (!p) continue;
            const delta = target - row.balance;
            participantSplits.push({ participantId: row.id, currencyDelta: delta });
            participantImpact.push({
              participantId: row.id,
              discordUserId: p.discordUserId,
              discordUsername: p.discordUsername,
              balanceBefore: row.balance,
              delta,
              balanceAfter: target,
            });
          }
        }
      }

      if (
        params.targetGroupPoints !== undefined ||
        params.targetGroupCurrency !== undefined
      ) {
        const grouped = await tx.ledgerSplit.groupBy({
          by: ["groupId"],
          _sum: { pointsDelta: true, currencyDelta: true },
          where: { group: { guildId: params.guildId } },
        });
        const groupIds = grouped.map((row) => row.groupId);
        const groups = groupIds.length
          ? await tx.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, displayName: true } })
          : [];
        const byId = new Map(groups.map((g) => [g.id, g]));
        for (const row of grouped) {
          const group = byId.get(row.groupId);
          if (!group) continue;
          const pointsBefore = decimalToNumber(row._sum.pointsDelta);
          const currencyBefore = decimalToNumber(row._sum.currencyDelta);
          const pointsDelta =
            params.targetGroupPoints !== undefined ? params.targetGroupPoints - pointsBefore : 0;
          const currencyDelta =
            params.targetGroupCurrency !== undefined ? params.targetGroupCurrency - currencyBefore : 0;
          if (pointsDelta === 0 && currencyDelta === 0) continue;
          groupSplits.push({ groupId: row.groupId, pointsDelta, currencyDelta });
          groupImpact.push({
            groupId: row.groupId,
            displayName: group.displayName,
            pointsBefore,
            pointsDelta,
            pointsAfter: pointsBefore + pointsDelta,
            currencyBefore,
            currencyDelta,
            currencyAfter: currencyBefore + currencyDelta,
          });
        }
      }

      let participantCorrectionEntryId: string | null = null;
      let groupCorrectionEntryId: string | null = null;
      const totalCurrencyDelta =
        participantImpact.reduce((sum, row) => sum + row.delta, 0) +
        groupImpact.reduce((sum, row) => sum + row.currencyDelta, 0);
      const totalPointsDelta = groupImpact.reduce((sum, row) => sum + row.pointsDelta, 0);

      if (!params.dryRun) {
        const description = params.note?.trim()
          ? params.note.trim()
          : `Economy reset — set balances`;

        const chunkedParticipantSplits = chunkParticipantSplits(participantSplits);
        if (chunkedParticipantSplits.length > 0) {
          const created = await tx.participantCurrencyEntry.create({
            data: {
              guildId: params.guildId,
              type: PARTICIPANT_REVERSAL_TYPE,
              description,
              createdByUserId: params.actor.userId,
              createdByUsername: params.actor.username,
              splits: {
                create: chunkedParticipantSplits.map((split) => ({
                  participantId: split.participantId,
                  currencyDelta: decimal(split.currencyDelta),
                })),
              },
            },
          });
          participantCorrectionEntryId = created.id;
        }

        const chunkedGroupSplits = chunkGroupSplits(groupSplits);
        if (chunkedGroupSplits.length > 0) {
          const created = await tx.ledgerEntry.create({
            data: {
              guildId: params.guildId,
              type: GROUP_REVERSAL_TYPE,
              description,
              createdByUserId: params.actor.userId,
              createdByUsername: params.actor.username,
              splits: {
                create: chunkedGroupSplits.map((split) => ({
                  groupId: split.groupId,
                  pointsDelta: decimal(split.pointsDelta),
                  currencyDelta: decimal(split.currencyDelta),
                })),
              },
            },
          });
          groupCorrectionEntryId = created.id;
        }

        await this.auditService.record({
          guildId: params.guildId,
          actorUserId: params.actor.userId,
          actorUsername: params.actor.username,
          action: "economy.reset.set_balances",
          entityType: "EconomyReset",
          payload: {
            targetParticipantCurrency: params.targetParticipantCurrency ?? null,
            targetGroupPoints: params.targetGroupPoints ?? null,
            targetGroupCurrency: params.targetGroupCurrency ?? null,
            participantCorrectionEntryId,
            groupCorrectionEntryId,
            totalCurrencyDelta,
            totalPointsDelta,
            note: params.note ?? null,
          },
          executor: tx,
        });
      }

      return {
        mode: "set-balances",
        dryRun: params.dryRun,
        participantImpact,
        groupImpact,
        totalCurrencyDelta,
        totalPointsDelta,
        participantCorrectionEntryId,
        groupCorrectionEntryId,
      };
    });
  }

  private async fillParticipantBalances(
    tx: Prisma.TransactionClient,
    impact: ParticipantImpact[],
  ): Promise<void> {
    if (impact.length === 0) return;
    const grouped = await tx.participantCurrencySplit.groupBy({
      by: ["participantId"],
      _sum: { currencyDelta: true },
      where: { participantId: { in: impact.map((row) => row.participantId) } },
    });
    const balances = new Map(grouped.map((row) => [row.participantId, decimalToNumber(row._sum.currencyDelta)]));
    for (const row of impact) {
      row.balanceBefore = balances.get(row.participantId) ?? 0;
      row.balanceAfter = row.balanceBefore + row.delta;
    }
  }

  private async fillGroupBalances(
    tx: Prisma.TransactionClient,
    impact: GroupImpact[],
  ): Promise<void> {
    if (impact.length === 0) return;
    const grouped = await tx.ledgerSplit.groupBy({
      by: ["groupId"],
      _sum: { pointsDelta: true, currencyDelta: true },
      where: { groupId: { in: impact.map((row) => row.groupId) } },
    });
    const balances = new Map(
      grouped.map((row) => [
        row.groupId,
        { points: decimalToNumber(row._sum.pointsDelta), currency: decimalToNumber(row._sum.currencyDelta) },
      ]),
    );
    for (const row of impact) {
      const before = balances.get(row.groupId) ?? { points: 0, currency: 0 };
      row.pointsBefore = before.points;
      row.pointsAfter = before.points + row.pointsDelta;
      row.currencyBefore = before.currency;
      row.currencyAfter = before.currency + row.currencyDelta;
    }
  }
}

function mergeParticipantSplits(
  splits: Array<{ participantId: string; currencyDelta: number }>,
): Array<{ participantId: string; currencyDelta: number }> {
  const merged = new Map<string, number>();
  for (const split of splits) {
    merged.set(split.participantId, (merged.get(split.participantId) ?? 0) + split.currencyDelta);
  }
  return Array.from(merged, ([participantId, currencyDelta]) => ({ participantId, currencyDelta })).filter(
    (row) => row.currencyDelta !== 0,
  );
}

function mergeGroupSplits(
  splits: Array<{ groupId: string; pointsDelta: number; currencyDelta: number }>,
): Array<{ groupId: string; pointsDelta: number; currencyDelta: number }> {
  const merged = new Map<string, { pointsDelta: number; currencyDelta: number }>();
  for (const split of splits) {
    const existing = merged.get(split.groupId) ?? { pointsDelta: 0, currencyDelta: 0 };
    existing.pointsDelta += split.pointsDelta;
    existing.currencyDelta += split.currencyDelta;
    merged.set(split.groupId, existing);
  }
  return Array.from(merged, ([groupId, deltas]) => ({ groupId, ...deltas })).filter(
    (row) => row.pointsDelta !== 0 || row.currencyDelta !== 0,
  );
}

function chunkSigned(value: number): number[] {
  if (value === 0) return [];
  if (Math.abs(value) <= MAX_SPLIT_MAGNITUDE) return [value];
  const chunks: number[] = [];
  let remaining = value;
  const sign = remaining > 0 ? 1 : -1;
  while (Math.abs(remaining) > MAX_SPLIT_MAGNITUDE) {
    chunks.push(sign * MAX_SPLIT_MAGNITUDE);
    remaining -= sign * MAX_SPLIT_MAGNITUDE;
  }
  if (remaining !== 0) chunks.push(remaining);
  return chunks;
}

export function chunkParticipantSplits(
  splits: Array<{ participantId: string; currencyDelta: number }>,
): Array<{ participantId: string; currencyDelta: number }> {
  const out: Array<{ participantId: string; currencyDelta: number }> = [];
  for (const split of splits) {
    for (const currencyDelta of chunkSigned(split.currencyDelta)) {
      out.push({ participantId: split.participantId, currencyDelta });
    }
  }
  return out;
}

export function chunkGroupSplits(
  splits: Array<{ groupId: string; pointsDelta: number; currencyDelta: number }>,
): Array<{ groupId: string; pointsDelta: number; currencyDelta: number }> {
  const out: Array<{ groupId: string; pointsDelta: number; currencyDelta: number }> = [];
  for (const split of splits) {
    let pointsRemaining = split.pointsDelta;
    let currencyRemaining = split.currencyDelta;
    while (
      Math.abs(pointsRemaining) > MAX_SPLIT_MAGNITUDE ||
      Math.abs(currencyRemaining) > MAX_SPLIT_MAGNITUDE
    ) {
      const pointsChunk =
        Math.abs(pointsRemaining) > MAX_SPLIT_MAGNITUDE
          ? (pointsRemaining > 0 ? MAX_SPLIT_MAGNITUDE : -MAX_SPLIT_MAGNITUDE)
          : pointsRemaining;
      const currencyChunk =
        Math.abs(currencyRemaining) > MAX_SPLIT_MAGNITUDE
          ? (currencyRemaining > 0 ? MAX_SPLIT_MAGNITUDE : -MAX_SPLIT_MAGNITUDE)
          : currencyRemaining;
      out.push({ groupId: split.groupId, pointsDelta: pointsChunk, currencyDelta: currencyChunk });
      pointsRemaining -= pointsChunk;
      currencyRemaining -= currencyChunk;
    }
    if (pointsRemaining !== 0 || currencyRemaining !== 0) {
      out.push({
        groupId: split.groupId,
        pointsDelta: pointsRemaining,
        currencyDelta: currencyRemaining,
      });
    }
  }
  return out;
}
