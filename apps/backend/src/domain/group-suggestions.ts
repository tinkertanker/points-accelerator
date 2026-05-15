// Pure functions for inferring likely student-group roles from a guild's
// role/member graph. Lives in domain/ so it has zero Discord or Prisma
// dependencies and stays trivially unit-testable.

export type RoleMembership = {
  id: string;
  name: string;
  memberIds: string[];
};

export type GroupSuggestionInput = {
  roles: RoleMembership[];
  totalHumanMembers: number;
};

export type GroupSuggestion = {
  kind: "naming-family" | "size-cluster";
  label: string;
  roleIds: string[];
  coverage: number;
  exclusivity: number;
  uniformity: number;
  score: number;
};

export type GroupSuggestionResult = {
  primary: GroupSuggestion | null;
  alternatives: GroupSuggestion[];
  totalHumanMembers: number;
  evaluatedRoleCount: number;
};

const MIN_MEMBERS_PER_ROLE = 2;
const MAX_COVERAGE_FRACTION = 0.85;
const SIZE_CLUSTER_RATIO = 0.5;
const MIN_SCORE = 0.2;
const MAX_SUGGESTIONS = 3;

// Each entry recognises a way that parallel groups tend to be named. The
// first matching pattern wins for a given role, and roles sharing a family
// key cluster together as a candidate partition.
const FAMILY_PATTERNS: Array<{
  regex: RegExp;
  key: (match: RegExpExecArray) => string;
}> = [
  // "1am", "2pm", "8am" — number + am/pm timeslot
  { regex: /^\d+\s*(am|pm)$/i, key: () => "timeslot" },
  // "Group 1", "Team 2", "Period 3", "Session A" — requires a separator and a
  // numeric or single uppercase enumerator so plain role names like "Admin"
  // do not get misread as a family of one.
  {
    regex: /^(.+?)[\s_-]+(?:\d+|[A-Z])$/,
    key: (match) => `prefix:${match[1].trim().toLowerCase()}`,
  },
  // Bare numerals: "1", "2", "3"
  { regex: /^\d+$/, key: () => "bare-number" },
];

export function suggestGroupRoles(input: GroupSuggestionInput): GroupSuggestionResult {
  const eligible = input.roles.filter((role) => {
    if (role.memberIds.length < MIN_MEMBERS_PER_ROLE) {
      return false;
    }
    if (input.totalHumanMembers === 0) {
      return false;
    }
    return role.memberIds.length / input.totalHumanMembers <= MAX_COVERAGE_FRACTION;
  });

  const candidates: GroupSuggestion[] = [
    ...buildNamingFamilyCandidates(eligible, input.totalHumanMembers),
    ...buildSizeClusterCandidates(eligible, input.totalHumanMembers),
  ];

  const deduped = dedupeOverlapping(candidates);
  const ranked = deduped
    .filter((candidate) => candidate.score >= MIN_SCORE)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_SUGGESTIONS);

  return {
    primary: ranked[0] ?? null,
    alternatives: ranked.slice(1),
    totalHumanMembers: input.totalHumanMembers,
    evaluatedRoleCount: eligible.length,
  };
}

function buildNamingFamilyCandidates(
  roles: RoleMembership[],
  totalHumanMembers: number,
): GroupSuggestion[] {
  const families = new Map<string, RoleMembership[]>();
  for (const role of roles) {
    const family = familyKey(role.name);
    if (!family) {
      continue;
    }
    const bucket = families.get(family) ?? [];
    bucket.push(role);
    families.set(family, bucket);
  }

  const suggestions: GroupSuggestion[] = [];
  for (const [family, members] of families) {
    if (members.length < 2) {
      continue;
    }
    const score = scoreCandidate(members, totalHumanMembers, 1);
    if (!score) {
      continue;
    }
    suggestions.push({
      kind: "naming-family",
      label: namingFamilyLabel(family, members),
      roleIds: members.map((role) => role.id),
      ...score,
    });
  }
  return suggestions;
}

function namingFamilyLabel(family: string, members: RoleMembership[]): string {
  const sample = members.slice(0, 3).map((role) => role.name).join(", ");
  if (family === "timeslot") {
    return `Timeslot-style roles (${sample})`;
  }
  if (family === "bare-number") {
    return `Numbered roles (${sample})`;
  }
  if (family.startsWith("prefix:")) {
    const prefix = family.slice("prefix:".length);
    return prefix ? `Roles named "${prefix}…" (${sample})` : `Named roles (${sample})`;
  }
  return `Named roles (${sample})`;
}

function buildSizeClusterCandidates(
  roles: RoleMembership[],
  totalHumanMembers: number,
): GroupSuggestion[] {
  if (roles.length < 2) {
    return [];
  }

  const sorted = [...roles].sort((left, right) => left.memberIds.length - right.memberIds.length);
  const counts = sorted.map((role) => role.memberIds.length);
  const median = counts[Math.floor(counts.length / 2)];
  const lowerBound = Math.max(MIN_MEMBERS_PER_ROLE, Math.floor(median * (1 - SIZE_CLUSTER_RATIO)));
  const upperBound = Math.ceil(median * (1 + SIZE_CLUSTER_RATIO));

  const cluster = sorted.filter(
    (role) => role.memberIds.length >= lowerBound && role.memberIds.length <= upperBound,
  );
  if (cluster.length < 2) {
    return [];
  }

  const score = scoreCandidate(cluster, totalHumanMembers, 0.5);
  if (!score) {
    return [];
  }
  return [
    {
      kind: "size-cluster",
      label: `${cluster.length} similarly-sized roles`,
      roleIds: cluster.map((role) => role.id),
      ...score,
    },
  ];
}

function scoreCandidate(
  roles: RoleMembership[],
  totalHumanMembers: number,
  namingBoost: number,
): Pick<GroupSuggestion, "coverage" | "exclusivity" | "uniformity" | "score"> | null {
  if (roles.length < 2 || totalHumanMembers === 0) {
    return null;
  }

  const memberRoleCount = new Map<string, number>();
  for (const role of roles) {
    for (const memberId of role.memberIds) {
      memberRoleCount.set(memberId, (memberRoleCount.get(memberId) ?? 0) + 1);
    }
  }

  const unionSize = memberRoleCount.size;
  if (unionSize === 0) {
    return null;
  }
  let exclusiveCount = 0;
  for (const count of memberRoleCount.values()) {
    if (count === 1) {
      exclusiveCount += 1;
    }
  }

  const coverage = unionSize / totalHumanMembers;
  const exclusivity = exclusiveCount / unionSize;
  const uniformity = computeUniformity(roles.map((role) => role.memberIds.length));
  const score = coverage * (0.6 + 0.4 * exclusivity) * (0.5 + 0.5 * uniformity) * namingBoost;

  return { coverage, exclusivity, uniformity, score };
}

function computeUniformity(counts: number[]): number {
  if (counts.length === 0) {
    return 0;
  }
  const mean = counts.reduce((sum, value) => sum + value, 0) / counts.length;
  if (mean === 0) {
    return 0;
  }
  const variance = counts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / counts.length;
  const stdDev = Math.sqrt(variance);
  return Math.max(0, Math.min(1, 1 - stdDev / mean));
}

function familyKey(roleName: string): string | null {
  const trimmed = roleName.trim();
  if (!trimmed) {
    return null;
  }
  for (const pattern of FAMILY_PATTERNS) {
    const match = pattern.regex.exec(trimmed);
    if (match) {
      return pattern.key(match);
    }
  }
  return null;
}

function dedupeOverlapping(candidates: GroupSuggestion[]): GroupSuggestion[] {
  const sorted = [...candidates].sort((left, right) => right.score - left.score);
  const kept: GroupSuggestion[] = [];
  const claimedRoles = new Set<string>();
  for (const candidate of sorted) {
    const overlaps = candidate.roleIds.some((roleId) => claimedRoles.has(roleId));
    if (overlaps) {
      continue;
    }
    kept.push(candidate);
    for (const roleId of candidate.roleIds) {
      claimedRoles.add(roleId);
    }
  }
  return kept;
}
