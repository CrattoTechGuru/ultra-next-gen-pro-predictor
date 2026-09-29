-- SOUTH AFRICAN PREDICTOR ARCHITECTURE LAYER EXTENSIONS
-- Non-destructive additions to track upcoming matches, live telemetry, and ZAR bet slips.

CREATE TABLE IF NOT EXISTS live_fixtures (
    fixture_id VARCHAR(50) PRIMARY KEY,
    league_name VARCHAR(100),
    home_team VARCHAR(100),
    away_team VARCHAR(100),
    home_score INT DEFAULT 0,
    away_score INT DEFAULT 0,
    elapsed_minute INT DEFAULT 0,
    possession_home INT,
    corners_total INT,
    live_predicted_outcome VARCHAR(50),
    live_confidence_percentage NUMERIC(5,2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS automated_bet_slips (
    slip_id VARCHAR(50) PRIMARY KEY,
    combined_odds NUMERIC(6,2),
    avg_confidence NUMERIC(5,2),
    raw_selections_json TEXT,
    recommended_stake_zar INT DEFAULT 100,
    potential_payout_zar NUMERIC(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
