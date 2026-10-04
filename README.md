# Thread full-stack (React + Spring Boot + MongoDB)

    thread-fullstack/
      backend/     Spring Boot 3 (Java 17) REST API & WebSocket STOMP  -> :8080
      user-app/    React (Vite) user app                               -> :5173
      admin-app/   React (Vite) admin panel & moderation               -> :5174
      docker-compose.yml  MongoDB 7

## Run
1. `docker compose up -d`                (MongoDB on :27017)
2. `cd backend && mvn spring-boot:run`   (API on :8080)
3. `cd user-app && npm install --legacy-peer-deps && npm run dev`
4. `cd admin-app && npm install --legacy-peer-deps && npm run dev`

Admin password (default `admin123`) and JWT secret are set via env vars `ADMIN_PASSWORD`, `JWT_SECRET`, `MONGO_URI`, `CORS_ORIGINS`.
For production builds set `VITE_API_URL` to your API URL (e.g. https://api.example.com/api).

## Backend & Real-Time Architecture
- **Auth**: User sign-up & login via `/api/auth/*` (BCrypt + JWT). Admin sign-in via `/api/admin/login`.
- **MongoDB Domain Models**:
  - `users`: Registered accounts, profile details, verification ticks, premium flags.
  - `conversations`: Direct and group chat rooms with participant IDs and last message metadata.
  - `messages`: All message types (text, media, snap, voice note, poll, call log) with replies and delivery status.
  - `conversation_members`: Per-user unread counters, roles, and mute preferences.
  - `app_state`: Key-value configuration state for settings and themes.
- **REST APIs**:
  - `GET /api/conversations`: Returns user's conversations with real MongoDB messages.
  - `POST /api/conversations`: Creates a direct or group conversation.
  - `GET /api/conversations/{id}/messages`: Retrieves conversation message history.
  - `POST /api/conversations/{id}/messages`: Persists new message to MongoDB and broadcasts via WebSocket.
  - `POST /api/conversations/{id}/read`: Marks conversation as read and resets unread count.
  - `GET /api/users`: Discovers active users for starting new chats.
- **WebSocket / STOMP Real-Time Messaging**:
  - Endpoint: `/ws` with JWT authentication in STOMP headers.
  - Message broker: `/topic`, `/queue`, `/user`.
  - Topics: `/topic/conversation.{id}` (messages), `/topic/conversation.{id}.typing` (typing indicators), `/topic/user.{id}.conversations` (chat list sync).
  - App Destinations: `/app/chat.send` (send message), `/app/chat.typing` (typing updates).
- **Admin & Moderation**:
  - Real account management: `GET /api/admin/users`, `PUT /api/admin/users/{id}/status`, `DELETE /api/admin/users/{id}`, `PUT /api/admin/users/{id}/tick`, `PUT /api/admin/users/{id}/pro`.
  - Moderation APIs: `GET /api/admin/conversations`, `GET /api/admin/conversations/{id}/messages`, `DELETE /api/admin/messages/{id}`, `GET /api/admin/stats`.
  - Admin App UI includes a "Chat Moderation" tab allowing administrators to monitor live conversations and remove abusive messages directly from MongoDB.
