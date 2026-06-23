-- Durable store for daily-quiz engagement events.
-- One row per tracked client event; see lib/analytics-store.ts for the writer.
CREATE TABLE IF NOT EXISTS analytics_events (
  id            BIGSERIAL PRIMARY KEY,
  event_name    TEXT        NOT NULL,
  user_id       TEXT        NOT NULL,
  puzzle_number INTEGER,
  seed          TEXT,
  is_daily_quiz BOOLEAN     NOT NULL DEFAULT FALSE,
  -- hint_revealed only
  player_index  INTEGER,
  hint_key      TEXT,
  -- quiz_completed only
  score         INTEGER,
  max_score     INTEGER,
  correct_count INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Filters used by the admin dashboard: date range, event type, quiz type, puzzle #.
CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_event_name_idx ON analytics_events (event_name);
CREATE INDEX IF NOT EXISTS analytics_events_is_daily_quiz_idx ON analytics_events (is_daily_quiz);
CREATE INDEX IF NOT EXISTS analytics_events_puzzle_number_idx ON analytics_events (puzzle_number);
