-- Add CANCELLED value to ResearchStatus enum (additive migration)
ALTER TYPE "ResearchStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
