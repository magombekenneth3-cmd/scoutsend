-- Migration: add_vector_indexes
-- Adds IVFFlat indexes on WinRecord.embedding and LossRecord.embedding for
-- cosine-similarity search performance at scale.
--
-- Index tuning notes:
--   lists = 100  →  good default up to ~1M rows (pgvector recommendation: ~sqrt(rows)).
--                   Re-evaluate and REINDEX if the table grows beyond 1M rows.
--   probes        →  NOT set here (session-level); set it at query time in the
--                   service layer:  SET LOCAL ivfflat.probes = 10
--                   Higher probes improves recall at the cost of latency.
--                   10 is a reasonable starting point; tune against your recall target.
--
-- The operator class vector_cosine_ops matches the <=> operator used in
-- memory.service.ts: ORDER BY embedding <=> $vector::vector

CREATE INDEX "WinRecord_embedding_ivfflat_idx"
    ON "WinRecord"
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX "LossRecord_embedding_ivfflat_idx"
    ON "LossRecord"
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);