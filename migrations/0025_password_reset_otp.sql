-- Password-reset OTP delivery metadata and cleanup index.
-- Existing hash/expiry/attempt columns stay the source of truth.

alter table password_reset_otps add column if not exists request_id text;
alter table password_reset_otps add column if not exists verified_at timestamptz;

create index if not exists password_reset_otps_expires_idx
  on password_reset_otps (expires_at);

create index if not exists password_reset_otps_request_idx
  on password_reset_otps (request_id);
