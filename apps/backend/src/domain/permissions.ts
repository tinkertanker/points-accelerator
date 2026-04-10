import { decimalToNumber } from "../utils/decimal.js";
import { AppError } from "../utils/app-error.js";
import type { Decimal } from "@prisma/client/runtime/library";

type RoleCapabilityLike = {
  canManageDashboard: boolean;
  canAward: boolean;
  maxAward: Decimal | null;
  canDeduct: boolean;
  canMultiAward: boolean;
  canSell: boolean;
};

export type ResolvedCapabilities = {
  canManageDashboard: boolean;
  canAward: boolean;
  maxAward: number;
  canDeduct: boolean;
  canMultiAward: boolean;
  canSell: boolean;
};

export function resolveCapabilities(capabilities: RoleCapabilityLike[]): ResolvedCapabilities {
  return capabilities.reduce<ResolvedCapabilities>(
    (resolved, capability) => {
      const nextMaxAward =
        capability.canAward && capability.maxAward === null
          ? Number.POSITIVE_INFINITY
          : capability.canAward
            ? Math.max(resolved.maxAward, decimalToNumber(capability.maxAward))
            : resolved.maxAward;

      return {
        canManageDashboard: resolved.canManageDashboard || capability.canManageDashboard,
        canAward: resolved.canAward || capability.canAward,
        maxAward: nextMaxAward,
        canDeduct: resolved.canDeduct || capability.canDeduct,
        canMultiAward: resolved.canMultiAward || capability.canMultiAward,
        canSell: resolved.canSell || capability.canSell,
      };
    },
    {
      canManageDashboard: false,
      canAward: false,
      maxAward: 0,
      canDeduct: false,
      canMultiAward: false,
      canSell: false,
    },
  );
}

export function assertCanAward(params: {
  capabilities: ResolvedCapabilities;
  magnitude: number;
  targetCount: number;
  isDeduction: boolean;
}): void {
  const { capabilities, magnitude, targetCount, isDeduction } = params;

  if (isDeduction) {
    if (!capabilities.canDeduct) {
      throw new AppError("This role cannot deduct from groups.", 403);
    }
    return;
  }

  if (!capabilities.canAward) {
    throw new AppError("This role cannot award groups.", 403);
  }

  if (Number.isFinite(capabilities.maxAward) && magnitude > capabilities.maxAward) {
    throw new AppError(`This role can award at most ${capabilities.maxAward}.`, 403);
  }

  if (targetCount > 1 && !capabilities.canMultiAward) {
    throw new AppError("This role cannot target multiple groups in one action.", 403);
  }
}

export function assertCanSell(capabilities: ResolvedCapabilities): void {
  if (!capabilities.canSell) {
    throw new AppError("This role cannot create marketplace listings.", 403);
  }
}
