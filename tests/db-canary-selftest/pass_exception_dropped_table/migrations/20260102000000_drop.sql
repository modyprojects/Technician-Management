-- ... and a later migration that drops it while it is empty: the exception applied to the first
-- step, so it is not stale (review round 1, C5).
drop table public.job_queue;
