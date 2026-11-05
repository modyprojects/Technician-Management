-- Review round 1, C7 and F9: rewrites that to_jsonb normalizes away (json text, array lower bound).
update public.docs set body = '{"a":"dup","b":1}'::json, tags = '[7:7]={canary}'::text[];
