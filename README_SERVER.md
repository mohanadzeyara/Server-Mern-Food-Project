# Server (Express + MongoDB)

## Setup
1. Copy `.env.example` to `.env` and fill in `MONGO_URI`, `JWT_SECRET`, and `ADMIN_EMAILS` if needed.
2. Install deps: `npm install`
3. Run dev: `npm run dev`

## Routes
- `POST /auth/register` { name, email, password } — password min 5, unique email. Admin if email in ADMIN_EMAILS.
- `POST /auth/login` { email, password } — returns JWT.
- `GET /auth/me` — returns user profile and recipeCount.
- `GET /recipes?q=term` — list recipes; optional search.
- `GET /recipes/:id` — get single.
- `POST /recipes` (auth) — fields: title, description, ingredients (array or newline string), steps (array or newline string). Accepts `image` file.
- `PUT /recipes/:id` (auth) — only author or admin; accepts same fields and optional `image` file.
- `DELETE /recipes/:id` (auth) — only author or admin.

Images are served from `/images/<filename>`.
