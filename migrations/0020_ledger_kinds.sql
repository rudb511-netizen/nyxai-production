-- Allow conversion rows in the treasury ledger.

alter table ledger_entries drop constraint if exists ledger_entries_kind_check;
alter table ledger_entries add constraint ledger_entries_kind_check
  check (kind in (
    'store_gross', 'platform_fee', 'tax', 'net_proceeds', 'refund', 'settlement',
    'fx_mark', 'usdt_credit', 'withdrawal', 'withdrawal_fee', 'reversal', 'conversion'
  ));
