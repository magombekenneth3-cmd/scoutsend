/**
 * Universal Pagination Helper
 *
 * Provides consistent, validated pagination across all list endpoints.
 * Uses Zod for type-safe coercion of query string parameters.
 *
 * Usage:
 *   import { paginationSchema, paginate, paginatedResponse } from "../../lib/pagination";
 *
 *   // In a route handler:
 *   const { page, limit } = paginationSchema.parse(req.query);
 *   const { skip, take } = paginate({ page, limit });
 *   const [items, total] = await Promise.all([
 *     prisma.campaign.findMany({ where, skip, take }),
 *     prisma.campaign.count({ where }),
 *   ]);
 *   res.json(paginatedResponse(items, total, { page, limit }));
 */

import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

export function paginate(params: PaginationParams) {
  return {
    skip: (params.page - 1) * params.limit,
    take: params.limit,
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  params: PaginationParams,
): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / params.limit);
  return {
    data,
    meta: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages,
      hasNextPage: params.page < totalPages,
      hasPreviousPage: params.page > 1,
    },
  };
}
