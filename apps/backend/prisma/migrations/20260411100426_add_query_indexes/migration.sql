-- CreateIndex
CREATE INDEX "Group_guildId_active_displayName_idx" ON "Group"("guildId", "active", "displayName");

-- CreateIndex
CREATE INDEX "LedgerEntry_guildId_createdAt_idx" ON "LedgerEntry"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LedgerEntry_guildId_externalRef_idx" ON "LedgerEntry"("guildId", "externalRef");

-- CreateIndex
CREATE INDEX "LedgerSplit_groupId_createdAt_idx" ON "LedgerSplit"("groupId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LedgerSplit_entryId_idx" ON "LedgerSplit"("entryId");

-- CreateIndex
CREATE INDEX "ShopItem_guildId_enabled_name_idx" ON "ShopItem"("guildId", "enabled", "name");

-- CreateIndex
CREATE INDEX "ShopRedemption_guildId_createdAt_idx" ON "ShopRedemption"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ShopRedemption_groupId_createdAt_idx" ON "ShopRedemption"("groupId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ShopRedemption_shopItemId_createdAt_idx" ON "ShopRedemption"("shopItemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MarketplaceListing_guildId_active_createdAt_idx" ON "MarketplaceListing"("guildId", "active", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_guildId_action_createdAt_idx" ON "AuditLog"("guildId", "action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Participant_guildId_groupId_idx" ON "Participant"("guildId", "groupId");

-- CreateIndex
CREATE INDEX "Participant_guildId_createdAt_idx" ON "Participant"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Assignment_guildId_active_sortOrder_createdAt_idx" ON "Assignment"("guildId", "active", "sortOrder", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_guildId_createdAt_idx" ON "Submission"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Submission_guildId_status_createdAt_idx" ON "Submission"("guildId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Submission_guildId_assignmentId_createdAt_idx" ON "Submission"("guildId", "assignmentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Submission_guildId_participantId_createdAt_idx" ON "Submission"("guildId", "participantId", "createdAt" DESC);
