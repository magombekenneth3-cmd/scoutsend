import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Models that contain an explicit `orgId` field in `schema.prisma`.
 */

export const ORG_SCOPED_MODELS = new Set<string>([
  "OrganizationMember",
  "OrganizationInvitation",
  "ApiKey",
  "Campaign",
  "BrandSettings",
  "CrmIntegration",
  "SenderDomain",
  "SenderMailbox",
  "LinkedInAccount",
  "LearningEvent",
  "Suppression",
  "CompetitorInsight",
  "ConsentRecord",
  "LeadAgentColumn",
  "Notification",
  "Subscription",
]);


export function forTenant(orgId: string) {
  if (!orgId) {
    throw new Error("[prisma-tenant] orgId is required for tenant scoping");
  }

  return prisma.$extends({
    name: `tenant-scope-${orgId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !ORG_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const modelArgs = (args ?? {}) as Record<string, any>;

          if (
            operation === "findMany" ||
            operation === "findFirst" ||
            operation === "count" ||
            operation === "aggregate" ||
            operation === "groupBy" ||
            operation === "updateMany" ||
            operation === "deleteMany"
          ) {
            modelArgs.where = {
              ...(modelArgs.where ?? {}),
              orgId,
            };
          } else if (operation === "create") {
            modelArgs.data = {
              ...(modelArgs.data ?? {}),
              orgId,
            };
          } else if (operation === "createMany" || operation === "createManyAndReturn") {
            if (Array.isArray(modelArgs.data)) {
              modelArgs.data = modelArgs.data.map((item: any) => ({
                ...item,
                orgId,
              }));
            } else if (modelArgs.data && typeof modelArgs.data === "object") {
              modelArgs.data = { ...modelArgs.data, orgId };
            }
          } else if (operation === "upsert") {
            modelArgs.where = {
              ...(modelArgs.where ?? {}),
              orgId,
            };
            if (modelArgs.create) {
              modelArgs.create = { ...modelArgs.create, orgId };
            }
          }

          return query(modelArgs);
        },
      },
    },
  });
}

export const forOrg = forTenant;
