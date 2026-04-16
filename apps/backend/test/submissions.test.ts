import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestApp, resetDatabase } from "./helpers/test-app.js";
import { ensureTestDatabase } from "./helpers/test-database.js";

let cleanupDatabase = () => undefined;
let ctx: Awaited<ReturnType<typeof createTestApp>>;

const GUILD_ID = "guild-test";
const AUTH_HEADER = () => ({ "x-admin-token": ctx.env.ADMIN_TOKEN });

/** Helper: ensure guild config exists and create a group with award capability. */
async function seedGroupWithCapability() {
  await ctx.services.configService.getOrCreate(GUILD_ID);

  await ctx.app.inject({
    method: "PUT",
    url: "/api/capabilities",
    headers: AUTH_HEADER(),
    payload: [
      {
        roleId: "role-admin",
        roleName: "Admin",
        canManageDashboard: true,
        canAward: true,
        maxAward: 1000,
        canDeduct: true,
        canMultiAward: true,
        canSell: true,
        canReceiveAwards: true,
        isGroupRole: false,
      },
      {
        roleId: "role-team-a",
        roleName: "Team A",
        canManageDashboard: false,
        canAward: false,
        maxAward: null,
        canDeduct: false,
        canMultiAward: false,
        canSell: false,
        canReceiveAwards: true,
        isGroupRole: true,
      },
    ],
  });

  const groupResponse = await ctx.app.inject({
    method: "POST",
    url: "/api/groups",
    headers: AUTH_HEADER(),
    payload: {
      displayName: "Team A",
      slug: "team-a",
      mentorName: "Alice",
      roleId: "role-team-a",
      aliases: [],
      active: true,
    },
  });

  return groupResponse.json() as { id: string; displayName: string };
}

describe("participants, assignments and submissions", () => {
  beforeAll(async () => {
    const managed = ensureTestDatabase();
    cleanupDatabase = managed.cleanup;
    ctx = await createTestApp(managed.url);
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.app.close();
      await ctx.prisma.$disconnect();
    }
    cleanupDatabase();
  });

  // -------------------------------------------------------------------
  // Participants
  // -------------------------------------------------------------------

  describe("participants", () => {
    it("registers a participant and lists them", async () => {
      const group = await seedGroupWithCapability();

      const registerResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/participants",
        headers: AUTH_HEADER(),
        payload: {
          discordUserId: "user-001",
          discordUsername: "student1",
          indexId: " s001 ",
          groupId: group.id,
        },
      });

      expect(registerResponse.statusCode).toBe(200);
      const participant = registerResponse.json() as { id: string; indexId: string };
      expect(participant.indexId).toBe("S001");

      const listResponse = await ctx.app.inject({
        method: "GET",
        url: "/api/participants",
        headers: AUTH_HEADER(),
      });

      expect(listResponse.statusCode).toBe(200);
      const participants = listResponse.json() as Array<{ id: string }>;
      expect(participants).toHaveLength(1);
      expect(participants[0]).toMatchObject({ id: participant.id, indexId: "S001" });
    });

    it("rejects non-alphanumeric index IDs", async () => {
      const group = await seedGroupWithCapability();

      const registerResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/participants",
        headers: AUTH_HEADER(),
        payload: {
          discordUserId: "user-003",
          discordUsername: "student3",
          indexId: "S-003",
          groupId: group.id,
        },
      });

      expect(registerResponse.statusCode).toBe(400);
      expect(registerResponse.json()).toMatchObject({
        message: "Index ID must be alphanumeric.",
      });
    });

    it("rejects duplicate registration for the same Discord user", async () => {
      const group = await seedGroupWithCapability();

      await ctx.app.inject({
        method: "POST",
        url: "/api/participants",
        headers: AUTH_HEADER(),
        payload: {
          discordUserId: "user-001",
          discordUsername: "student1",
          indexId: "S001",
          groupId: group.id,
        },
      });

      const duplicateResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/participants",
        headers: AUTH_HEADER(),
        payload: {
          discordUserId: "user-001",
          discordUsername: "student1",
          indexId: "S002",
          groupId: group.id,
        },
      });

      expect(duplicateResponse.statusCode).toBe(409);
    });

    it("rejects duplicate index ID", async () => {
      const group = await seedGroupWithCapability();

      await ctx.app.inject({
        method: "POST",
        url: "/api/participants",
        headers: AUTH_HEADER(),
        payload: {
          discordUserId: "user-001",
          discordUsername: "student1",
          indexId: "S001",
          groupId: group.id,
        },
      });

      const duplicateResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/participants",
        headers: AUTH_HEADER(),
        payload: {
          discordUserId: "user-002",
          discordUsername: "student2",
          indexId: "S001",
          groupId: group.id,
        },
      });

      expect(duplicateResponse.statusCode).toBe(409);
    });

    it("deletes a participant", async () => {
      const group = await seedGroupWithCapability();

      const registerResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/participants",
        headers: AUTH_HEADER(),
        payload: {
          discordUserId: "user-001",
          discordUsername: "student1",
          indexId: "S001",
          groupId: group.id,
        },
      });
      const participant = registerResponse.json() as { id: string };

      const deleteResponse = await ctx.app.inject({
        method: "DELETE",
        url: `/api/participants/${participant.id}`,
        headers: AUTH_HEADER(),
      });

      expect(deleteResponse.statusCode).toBe(200);

      const listResponse = await ctx.app.inject({
        method: "GET",
        url: "/api/participants",
        headers: AUTH_HEADER(),
      });
      expect((listResponse.json() as Array<unknown>)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------
  // Assignments
  // -------------------------------------------------------------------

  describe("assignments", () => {
    it("creates and lists assignments", async () => {
      await ctx.services.configService.getOrCreate(GUILD_ID);

      const createResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/assignments",
        headers: AUTH_HEADER(),
        payload: {
          title: "Week 1 Reflection",
          description: "Write about your first week.",
          baseCurrencyReward: 5,
          basePointsReward: 10,
          bonusCurrencyReward: 3,
          bonusPointsReward: 5,
          active: true,
        },
      });

      expect(createResponse.statusCode).toBe(200);
      const assignment = createResponse.json() as { id: string; title: string };
      expect(assignment.title).toBe("Week 1 Reflection");

      const listResponse = await ctx.app.inject({
        method: "GET",
        url: "/api/assignments",
        headers: AUTH_HEADER(),
      });

      expect(listResponse.statusCode).toBe(200);
      const assignments = listResponse.json() as Array<{ id: string }>;
      expect(assignments).toHaveLength(1);
    });

    it("updates an existing assignment via upsert", async () => {
      await ctx.services.configService.getOrCreate(GUILD_ID);

      const createResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/assignments",
        headers: AUTH_HEADER(),
        payload: {
          title: "Draft",
          description: "",
          baseCurrencyReward: 1,
          basePointsReward: 1,
          bonusCurrencyReward: 0,
          bonusPointsReward: 0,
          active: true,
        },
      });
      const created = createResponse.json() as { id: string };

      const updateResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/assignments",
        headers: AUTH_HEADER(),
        payload: {
          id: created.id,
          title: "Final Title",
          description: "Updated description",
          baseCurrencyReward: 10,
          basePointsReward: 20,
          bonusCurrencyReward: 5,
          bonusPointsReward: 10,
          active: true,
        },
      });

      expect(updateResponse.statusCode).toBe(200);
      expect(updateResponse.json()).toMatchObject({
        id: created.id,
        title: "Final Title",
        baseCurrencyReward: 10,
      });
    });
  });

  // -------------------------------------------------------------------
  // Submissions + review + reward flow
  // -------------------------------------------------------------------

  describe("submissions", () => {
    it("creates a submission and lists it", async () => {
      const group = await seedGroupWithCapability();

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Task 1",
        baseCurrencyReward: 5,
        basePointsReward: 10,
        bonusCurrencyReward: 2,
        bonusPointsReward: 5,
        active: true,
      });

      const submission = await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: "Here is my work",
      });

      expect(submission.status).toBe("PENDING");

      const listResponse = await ctx.app.inject({
        method: "GET",
        url: "/api/submissions",
        headers: AUTH_HEADER(),
      });

      expect(listResponse.statusCode).toBe(200);
      const submissions = listResponse.json() as Array<{ id: string; status: string }>;
      expect(submissions).toHaveLength(1);
      expect(submissions[0]!.status).toBe("PENDING");
    });

    it("keeps the original group on past submissions after a participant moves groups", async () => {
      const group = await seedGroupWithCapability();
      const otherGroupResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/groups",
        headers: AUTH_HEADER(),
        payload: {
          displayName: "Team B",
          slug: "team-b",
          mentorName: "Bob",
          roleId: "role-team-b",
          aliases: [],
          active: true,
        },
      });
      const otherGroup = otherGroupResponse.json() as { id: string };

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-history",
        discordUsername: "student-history",
        indexId: "S999",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "History Test",
        baseCurrencyReward: 1,
        basePointsReward: 2,
        bonusCurrencyReward: 0,
        bonusPointsReward: 0,
        active: true,
      });

      await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: "original group snapshot",
      });

      await ctx.prisma.participant.update({
        where: { id: participant.id },
        data: { groupId: otherGroup.id },
      });

      const submissions = await ctx.services.submissionService.list(GUILD_ID);
      expect(submissions).toHaveLength(1);
      expect(submissions[0]?.participant.group.displayName).toBe("Team A");
    });

    it("prevents duplicate submissions for the same assignment", async () => {
      const group = await seedGroupWithCapability();

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Task 1",
        baseCurrencyReward: 5,
        basePointsReward: 10,
        bonusCurrencyReward: 0,
        bonusPointsReward: 0,
        active: true,
      });

      await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: "First attempt",
      });

      await expect(
        ctx.services.submissionService.create({
          guildId: GUILD_ID,
          assignmentId: assignment.id,
          participantId: participant.id,
          text: "Second attempt",
        }),
      ).rejects.toThrow(/already submitted/i);
    });

    it("rejects empty submissions with no text and no image", async () => {
      const group = await seedGroupWithCapability();

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Task 1",
        baseCurrencyReward: 5,
        basePointsReward: 10,
        bonusCurrencyReward: 0,
        bonusPointsReward: 0,
        active: true,
      });

      await expect(
        ctx.services.submissionService.create({
          guildId: GUILD_ID,
          assignmentId: assignment.id,
          participantId: participant.id,
          text: "   ",
        }),
      ).rejects.toThrow(/add some text or an image/i);
    });

    it("approves a submission and awards base rewards to the group", async () => {
      const group = await seedGroupWithCapability();

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Reflection 1",
        baseCurrencyReward: 5,
        basePointsReward: 10,
        bonusCurrencyReward: 3,
        bonusPointsReward: 5,
        active: true,
      });

      const submission = await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: "My reflection",
      });

      // Review via the API (uses the session userId/username)
      const reviewResponse = await ctx.app.inject({
        method: "POST",
        url: `/api/submissions/${submission.id}/review`,
        headers: AUTH_HEADER(),
        payload: {
          status: "APPROVED",
          reviewNote: "Good work",
        },
      });

      expect(reviewResponse.statusCode).toBe(200);
      const reviewed = reviewResponse.json() as {
        status: string;
        currencyAwarded: number | null;
        pointsAwarded: number | null;
      };
      expect(reviewed.status).toBe("APPROVED");
      expect(reviewed.currencyAwarded).toBe(5);
      expect(reviewed.pointsAwarded).toBe(10);

      // Verify the group balance was updated
      const leaderboard = await ctx.services.economyService.getLeaderboard(GUILD_ID);
      const teamA = leaderboard.find((g) => g.displayName === "Team A");
      expect(teamA).toBeDefined();
      expect(teamA!.pointsBalance).toBe(10);
      await expect(ctx.services.participantCurrencyService.getParticipantBalance(participant.id)).resolves.toBe(5);
    });

    it("marks a submission as outstanding and awards base + bonus rewards", async () => {
      const group = await seedGroupWithCapability();

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Challenge",
        baseCurrencyReward: 5,
        basePointsReward: 10,
        bonusCurrencyReward: 3,
        bonusPointsReward: 5,
        active: true,
      });

      const submission = await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: "Exceptional work",
      });

      const reviewed = await ctx.services.submissionService.review({
        guildId: GUILD_ID,
        submissionId: submission.id,
        status: "OUTSTANDING",
        reviewedByUserId: "admin-1",
        reviewedByUsername: "Admin",
      });

      expect(reviewed.status).toBe("OUTSTANDING");

      // base + bonus: currency = 5 + 3 = 8, points = 10 + 5 = 15
      const balance = await ctx.services.economyService.getGroupBalance(group.id);
      expect(balance.currencyBalance).toBe(0);
      expect(balance.pointsBalance).toBe(15);
      await expect(ctx.services.participantCurrencyService.getParticipantBalance(participant.id)).resolves.toBe(8);
    });

    it("rejects a submission without awarding anything", async () => {
      const group = await seedGroupWithCapability();

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Task",
        baseCurrencyReward: 5,
        basePointsReward: 10,
        bonusCurrencyReward: 0,
        bonusPointsReward: 0,
        active: true,
      });

      const submission = await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: "Incomplete",
      });

      const reviewed = await ctx.services.submissionService.review({
        guildId: GUILD_ID,
        submissionId: submission.id,
        status: "REJECTED",
        reviewNote: "Needs more detail",
        reviewedByUserId: "admin-1",
        reviewedByUsername: "Admin",
      });

      expect(reviewed.status).toBe("REJECTED");

      const balance = await ctx.services.economyService.getGroupBalance(group.id);
      expect(balance.currencyBalance).toBe(0);
      expect(balance.pointsBalance).toBe(0);
    });

    it("prevents reviewing an already-reviewed submission", async () => {
      const group = await seedGroupWithCapability();

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Task",
        baseCurrencyReward: 5,
        basePointsReward: 10,
        bonusCurrencyReward: 0,
        bonusPointsReward: 0,
        active: true,
      });

      const submission = await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: "Done",
      });

      await ctx.services.submissionService.review({
        guildId: GUILD_ID,
        submissionId: submission.id,
        status: "APPROVED",
        reviewedByUserId: "admin-1",
      });

      await expect(
        ctx.services.submissionService.review({
          guildId: GUILD_ID,
          submissionId: submission.id,
          status: "REJECTED",
          reviewedByUserId: "admin-1",
        }),
      ).rejects.toThrow(/already been reviewed/i);
    });

    it("awards a submission only once when concurrent reviews race", async () => {
      const group = await seedGroupWithCapability();

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Race-safe task",
        baseCurrencyReward: 5,
        basePointsReward: 10,
        bonusCurrencyReward: 0,
        bonusPointsReward: 0,
        active: true,
      });

      const submission = await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: "Done",
      });

      const results = await Promise.allSettled([
        ctx.services.submissionService.review({
          guildId: GUILD_ID,
          submissionId: submission.id,
          status: "APPROVED",
          reviewedByUserId: "admin-1",
          reviewedByUsername: "Admin",
        }),
        ctx.services.submissionService.review({
          guildId: GUILD_ID,
          submissionId: submission.id,
          status: "APPROVED",
          reviewedByUserId: "admin-2",
          reviewedByUsername: "Reviewer",
        }),
      ]);

      const fulfilled = results.filter((result): result is PromiseFulfilledResult<{ status: string }> => result.status === "fulfilled");
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(fulfilled[0]!.value.status).toBe("APPROVED");
      expect(String((rejected[0]!.reason as Error).message)).toMatch(/already been reviewed/i);

      const balance = await ctx.services.economyService.getGroupBalance(group.id);
      expect(balance.currencyBalance).toBe(0);
      expect(balance.pointsBalance).toBe(10);
      await expect(ctx.services.participantCurrencyService.getParticipantBalance(participant.id)).resolves.toBe(5);

      const ledger = await ctx.services.economyService.getLedger(GUILD_ID);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]!.type).toBe("SUBMISSION_REWARD");
    });

    it("returns completion summary showing missing participants", async () => {
      const group = await seedGroupWithCapability();

      const participant1 = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-002",
        discordUsername: "student2",
        indexId: "S002",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Task 1",
        baseCurrencyReward: 0,
        basePointsReward: 0,
        bonusCurrencyReward: 0,
        bonusPointsReward: 0,
        active: true,
      });

      // Only participant1 submits
      await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant1.id,
        text: "Done",
      });

      const completionResponse = await ctx.app.inject({
        method: "GET",
        url: "/api/submissions/completion",
        headers: AUTH_HEADER(),
      });

      expect(completionResponse.statusCode).toBe(200);
      const summary = completionResponse.json() as Array<{
        assignmentTitle: string;
        totalParticipants: number;
        submittedCount: number;
        missingParticipants: Array<{ indexId: string }>;
      }>;

      expect(summary).toHaveLength(1);
      expect(summary[0]!.totalParticipants).toBe(2);
      expect(summary[0]!.submittedCount).toBe(1);
      expect(summary[0]!.missingParticipants).toHaveLength(1);
      expect(summary[0]!.missingParticipants[0]!.indexId).toBe("S002");
    });

    it("filters submissions by assignment and status", async () => {
      const group = await seedGroupWithCapability();

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      const assignment1 = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Task A",
        baseCurrencyReward: 0,
        basePointsReward: 0,
        bonusCurrencyReward: 0,
        bonusPointsReward: 0,
        active: true,
      });

      const assignment2 = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Task B",
        baseCurrencyReward: 0,
        basePointsReward: 0,
        bonusCurrencyReward: 0,
        bonusPointsReward: 0,
        active: true,
      });

      await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment1.id,
        participantId: participant.id,
        text: "Task A work",
      });

      await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment2.id,
        participantId: participant.id,
        text: "Task B work",
      });

      // Filter by assignment
      const filteredResponse = await ctx.app.inject({
        method: "GET",
        url: `/api/submissions?assignmentId=${assignment1.id}`,
        headers: AUTH_HEADER(),
      });
      expect(filteredResponse.statusCode).toBe(200);
      const filtered = filteredResponse.json() as Array<{ assignment: { title: string } }>;
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.assignment.title).toBe("Task A");

      // Filter by status
      const pendingResponse = await ctx.app.inject({
        method: "GET",
        url: `/api/submissions?status=PENDING`,
        headers: AUTH_HEADER(),
      });
      expect((pendingResponse.json() as Array<unknown>)).toHaveLength(2);
    });

    it("creates SUBMISSION_REWARD ledger entry with correct type", async () => {
      const group = await seedGroupWithCapability();

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Tracked Task",
        baseCurrencyReward: 3,
        basePointsReward: 7,
        bonusCurrencyReward: 0,
        bonusPointsReward: 0,
        active: true,
      });

      const submission = await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: "Done",
      });

      await ctx.services.submissionService.review({
        guildId: GUILD_ID,
        submissionId: submission.id,
        status: "APPROVED",
        reviewedByUserId: "admin-1",
      });

      const ledger = await ctx.services.economyService.getLedger(GUILD_ID);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]!.type).toBe("SUBMISSION_REWARD");
      expect(ledger[0]!.splits[0]!.pointsDelta).toBe(7);
      expect(ledger[0]!.splits[0]!.currencyDelta).toBe(0);
      await expect(ctx.services.participantCurrencyService.getParticipantBalance(participant.id)).resolves.toBe(3);
    });

    it("createOrReplace creates a new submission when none exists", async () => {
      const group = await seedGroupWithCapability();

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Reply Task",
        baseCurrencyReward: 5,
        basePointsReward: 10,
        bonusCurrencyReward: 0,
        bonusPointsReward: 0,
        active: true,
      });

      const result = await ctx.services.submissionService.createOrReplace({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: "My work",
        imageUrl: "https://example.com/image.png",
      });

      expect(result.replaced).toBe(false);
      expect(result.submission.status).toBe("PENDING");
      expect(result.submission.imageUrl).toBe("https://example.com/image.png");
    });

    it("createOrReplace replaces a PENDING submission", async () => {
      const group = await seedGroupWithCapability();

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Reply Task",
        baseCurrencyReward: 5,
        basePointsReward: 10,
        bonusCurrencyReward: 0,
        bonusPointsReward: 0,
        active: true,
      });

      await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: "First version",
        imageUrl: "https://example.com/old-image.png",
        imageKey: "submissions/guild-test/old-image.png",
      });

      const result = await ctx.services.submissionService.createOrReplace({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: "Updated version",
        imageUrl: "https://example.com/new-image.png",
        imageKey: "submissions/guild-test/new-image.png",
      });

      expect(result.replaced).toBe(true);
      expect(result.previousImageKey).toBe("submissions/guild-test/old-image.png");
      expect(result.submission.text).toBe("Updated version");
      expect(result.submission.imageUrl).toBe("https://example.com/new-image.png");

      // Should still be only one submission total
      const listResponse = await ctx.app.inject({
        method: "GET",
        url: "/api/submissions",
        headers: AUTH_HEADER(),
      });
      expect((listResponse.json() as Array<unknown>)).toHaveLength(1);
    });

    it("createOrReplace refuses to replace an already-reviewed submission", async () => {
      const group = await seedGroupWithCapability();

      const participant = await ctx.services.participantService.register({
        guildId: GUILD_ID,
        discordUserId: "user-001",
        discordUsername: "student1",
        indexId: "S001",
        groupId: group.id,
      });

      const assignment = await ctx.services.assignmentService.upsert(GUILD_ID, {
        title: "Reply Task",
        baseCurrencyReward: 5,
        basePointsReward: 10,
        bonusCurrencyReward: 0,
        bonusPointsReward: 0,
        active: true,
      });

      const submission = await ctx.services.submissionService.create({
        guildId: GUILD_ID,
        assignmentId: assignment.id,
        participantId: participant.id,
        text: "My work",
      });

      await ctx.services.submissionService.review({
        guildId: GUILD_ID,
        submissionId: submission.id,
        status: "APPROVED",
        reviewedByUserId: "admin-1",
      });

      await expect(
        ctx.services.submissionService.createOrReplace({
          guildId: GUILD_ID,
          assignmentId: assignment.id,
          participantId: participant.id,
          text: "Trying to replace",
        }),
      ).rejects.toThrow(/already been reviewed/i);
    });
  });
});
