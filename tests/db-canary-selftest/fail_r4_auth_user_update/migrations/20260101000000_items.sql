update auth.users set raw_user_meta_data = raw_user_meta_data || '{"copied": true}' where email like '%@example.test';
