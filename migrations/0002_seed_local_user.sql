INSERT INTO users (id, email, created_at)
VALUES ('local-user', 'local@jobfit.dev', unixepoch());

INSERT INTO search_prefs (user_id) VALUES ('local-user');
