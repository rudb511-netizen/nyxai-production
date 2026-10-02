-- Coin SKUs are not store_products. Allow them on price lists and web checkout sessions.
do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and a.attname = 'product_id'
      and c.conrelid::regclass::text in ('market_prices', 'web_checkout_sessions')
  loop
    execute format('alter table %s drop constraint if exists %I', r.tbl, r.conname);
  end loop;
end $$;
