-- ============================================================================
-- 34_suivitess_no_subjects_status.sql
-- Add a 'no_subjects' status to the inbox proposal lifecycle.
--
-- Why this exists
-- ---------------
-- Before this change, when the cron's tier-1 extractor returned 0 subjects
-- for a (channel, date) digest, the scheduler just `continue`d without
-- persisting anything. Next tick (5 min later), the same digest was
-- enumerated, the dedup check (`inboxProposalAlreadyExistsForUser`) found
-- nothing in inbox_proposals and re-fired T1, which returned 0 again, and so
-- on indefinitely. A typical day with 45 Slack DMs (mostly social) burned
-- ~1500 redundant T1 calls (~$3-5/day, ~$100/month).
--
-- Fix : the scheduler now writes a row with status='no_subjects' whenever
-- T1 returns an empty array. This row participates in the standard dedup
-- check so the same `source_id` is never re-extracted. Day-based digests
-- already carry a count-based fingerprint (`slack:<channel>:<date>:<count>`),
-- so when new messages arrive the source_id changes and a fresh T1 fires
-- legitimately.
--
-- UI impact : the inbox list endpoint filters out 'no_subjects' by default,
-- so the user never sees these caching markers. Only admin / debug tooling
-- can opt in via an explicit `status=no_subjects` filter.
-- ============================================================================

ALTER TABLE suivitess_inbox_proposals
  DROP CONSTRAINT IF EXISTS suivitess_inbox_proposals_status_check;

ALTER TABLE suivitess_inbox_proposals
  ADD CONSTRAINT suivitess_inbox_proposals_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'no_subjects'::text]));
