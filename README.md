# Insta Chat System (Gold Level)

A full-stack real-time chat application with direct messages, group chats, media sharing, social graph controls, and client-side encryption.

## 1. Tech Stack

- Frontend: React, Axios, Socket.IO Client, CryptoJS
- Backend: Node.js, Express, Socket.IO Server
- Database: MongoDB (Mongoose)
- Auth: JWT + bcrypt

## 2. Main Features

- Register and login
- One-to-one chat and group chat
- Real-time messaging over Socket.IO
- Online and offline presence
- Typing indicators
- Message seen status and unread counters
- Reply to message
- Edit message
- Delete message (self or everyone)
- Clear chat (self or everyone)
- Image and media sharing
- User profile (avatar, display name, bio)
- Follow and unfollow with pending requests
- Chat request and message request send, accept, decline
- Block and unblock users
- Request history with statuses

## 3. Encryption (Current Working Model)

- Messages are encrypted in frontend before sending.
- Messages are stored encrypted in database.
- Decryption happens in frontend when displaying messages.
- Current implementation uses a deterministic shared key:
  - SECRET_SALT = INSTA_CHAT_SYSTEM_E2E_MESSAGE_ENCRYPTION_2024
  - ENCRYPTION_KEY = SHA256(SECRET_SALT)

Why this was used:
- It ensures sender and receiver can both decrypt the same ciphertext.
- It fixed the issue where receiver saw ciphertext values (like U2FsdGVkX1...) instead of readable text.

## 4. Project Structure

- backend
  - server.js
  - models
    - User.js
    - Message.js
    - Group.js
  - routes
    - auth.js
    - users.js
    - messages.js
    - groups.js
- frontend
  - src
    - App.js
    - index.js
    - components
      - Auth.js
      - Chat.js
      - Auth.css
      - Chat.css
    - utils
      - encryption.js

## 5. API Endpoints

### Auth

- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/forgot-password
- POST /api/auth/reset-password
- POST /api/auth/google
- POST /api/auth/verify-otp
- POST /api/auth/resend-otp

### Users

- GET /api/users
- GET /api/users/:id/suggestions
- GET /api/users/:id/request-history
- GET /api/users/:id/blocked
- PUT /api/users/:id/avatar
- PUT /api/users/:id/profile
- PUT /api/users/:id/follow/:targetId
- PUT /api/users/:id/unfollow/:targetId
- PUT /api/users/:id/request-chat/:targetId
- PUT /api/users/:id/accept-chat/:requesterId
- PUT /api/users/:id/decline-chat/:requesterId
- PUT /api/users/:id/block/:targetId
- PUT /api/users/:id/unblock/:targetId

### Groups

- POST /api/groups
- GET /api/groups/:userId
- PUT /api/groups/:groupId/name
- PUT /api/groups/:groupId/avatar

### Messages

- GET /api/messages/:userId/:otherId
- POST /api/messages/seen
- GET /api/messages/unread/:userId
- GET /api/messages/requests/:userId

## 6. Socket Events

### Client to server

- setUserId
- joinRoom
- joinGroup
- sendMessage
- editMessage
- deleteMessage
- clearChat
- markSeen
- markAllSeen
- typing
- stopTyping
- sendChatRequest
- chatRequestAccepted

### Server to client

- receiveMessage
- backgroundMessage
- messageSeen
- allMessagesSeen
- messageEdited
- messageDeleted
- chatCleared
- typing
- stopTyping
- userOnline
- userOffline
- onlineList
- chatRequestReceived
- chatAccepted
- errorMessage

## 7. User Model and History Tracking

The user model includes social and request fields:

- following
- followers
- blocked
- chatRequests
- acceptedChats
- requestHistory

requestHistory stores event records with:

- from
- status: pending, accepted, declined, followed, unfollowed
- requestedAt
- respondedAt

Current behavior:

- Follow sends a pending request until the receiver accepts it.
- Unfollow cancels the follow link and pending request state.
- Accept updates latest pending to accepted.
- Decline updates latest pending to declined.

## 8. Requests Tab Behavior

Requests tab now has two sections:

- Pending Requests
- Request History

Request History keeps accepted, declined, followed, and unfollowed events visible so they do not disappear after action.

The Requests tab also shows pending message requests separately from follow requests.

## 9. Performance Improvements Implemented

- Memoized derived lists and maps in chat rendering
- Reduced repeated lookups with sets/maps
- Optimized visible message computation
- Throttled typing emits to reduce socket noise

## 10. Deployment Notes (EC2 and Production)

Hardcoded localhost was removed from frontend API calls.

Frontend now uses:

- REACT_APP_API_URL
- REACT_APP_SOCKET_URL
- REACT_APP_GOOGLE_CLIENT_ID

Fallback behavior:

- Uses current host with port 5000 when env vars are not provided.

Hosted deployment behavior:

- The frontend reads a runtime config file served by the Node process, so Render and AWS can inject URLs without rebuilding the browser bundle.
- The backend accepts `CLIENT_ORIGIN` or `CLIENT_ORIGINS` as a comma-separated allowlist for CORS and Socket.IO.

Example environment settings:

- REACT_APP_API_URL=http://YOUR_SERVER_IP:5000
- REACT_APP_SOCKET_URL=http://YOUR_SERVER_IP:5000
- REACT_APP_GOOGLE_CLIENT_ID=your-google-client-id
- CLIENT_ORIGIN=https://your-frontend-domain.com
- CLIENT_ORIGINS=https://your-frontend-domain.com,https://your-second-domain.com

Render checklist:

- Set backend env vars in the Render dashboard, not only in local `.env` files.
- If frontend and backend are separate Render services, point `REACT_APP_API_URL` and `REACT_APP_SOCKET_URL` to the backend service URL.
- Set `FRONTEND_URL` to the frontend domain so password reset links open the correct site.

Two-service Render note:

- Backend env vars are not automatically visible to the browser.
- If you run frontend and backend as two separate Render services, the frontend must still know the backend URL either through its own Render env vars or by being served from the same origin as the backend.
- If you do not want any frontend env vars, the backend must serve the built frontend and both app and API must share one origin.

AWS/EC2 checklist:

- Run the backend on `PORT` from the environment and allow the port in the security group.
- If hosting the frontend on the same Node server, keep `frontend/serve-build.js` as the entrypoint for the built UI.
- If hosting frontend separately, make sure the domain is included in `CLIENT_ORIGIN` or `CLIENT_ORIGINS`.

## 11. Run Locally

### Prerequisites

- Node.js 18+
- npm
- MongoDB running locally or remote URI

### Backend

1. Go to backend folder
2. Install dependencies
3. Set environment variables
4. Start backend server

Example:

- cd backend
- npm install
- npm start

### Frontend

1. Go to frontend folder
2. Install dependencies
3. Set REACT_APP_API_URL and REACT_APP_SOCKET_URL if needed
4. Start frontend

Example:

- cd frontend
- npm install
- npm start

## 12. Environment Variables

Backend expected variables:

- MONGO_URI
- JWT_SECRET
- PORT (optional, default 5000)
- SMTP_HOST or SMTP_SERVICE
- SMTP_PORT (optional, default 587)
- SMTP_SECURE (optional, true/false)
- SMTP_USER
- SMTP_PASS
- SMTP_FROM (optional)

Mail variable aliases also supported:

- EMAIL_HOST / EMAIL_SERVICE / EMAIL_PORT / EMAIL_SECURE / EMAIL_USER / EMAIL_PASS / EMAIL_FROM
- MAIL_HOST / MAIL_SERVICE / MAIL_PORT / MAIL_SECURE / MAIL_USER / MAIL_PASS / MAIL_FROM

Example (Gmail):

- SMTP_SERVICE=gmail
- SMTP_USER=your_email@gmail.com
- SMTP_PASS=your_gmail_app_password
- SMTP_FROM=your_email@gmail.com

Frontend expected variables:

- REACT_APP_API_URL
- REACT_APP_SOCKET_URL
- REACT_APP_GOOGLE_CLIENT_ID

Optional frontend/base URL used in password reset emails:

- FRONTEND_URL
- CLIENT_ORIGIN

Google sign-in:

- The login page renders a Google button when `REACT_APP_GOOGLE_CLIENT_ID` is set.
- Existing Google users are signed in directly.
- New Google users are prompted to choose a username before the account is created.

Email OTP / verification on Render:

- Render does not read local `.env` files from your machine.
- You must set `SMTP_SERVICE` or `SMTP_HOST`, plus `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in the Render service environment variables.
- If those variables are missing, OTP verification and reset emails will fail with a clear `SMTP_NOT_CONFIGURED` message.

Completely free setup option:

- Set `OTP_PREVIEW_ONLY=true` in the backend service environment.
- In preview mode, the app will still generate verification OTPs and password-reset codes without SMTP.
- The OTP or reset link is returned in the API response for development/testing, so you can use the app without any paid email provider.
- This is useful on free Render plans, but it is not private production email delivery.

## 13. Security Notes

- Passwords are hashed with bcrypt.
- JWT is used for authentication.
- Message body is encrypted before storage.
- blocked relationships are enforced during message send and request actions.

## 14. Documentation Files

Additional project docs:

## 14.1 Local vs Production Startup Note

The app can behave differently in local development compared with the Render deployment.

Problem:
- On Render, the app worked because it was running as a production deployment with managed ports and environment variables.
- Locally, the frontend dev server printed a successful compile, but `localhost:3000` still refused the connection, so the browser had nothing reachable to load.

What worked on Render:
- Render runs the app as a production deployment with managed environment variables and ports.
- The frontend is served from a built bundle, so the browser reaches a real HTTP server.

What was happening locally:
- The original frontend dev server command reported a successful compile, but the browser still got `ERR_CONNECTION_REFUSED` on `localhost:3000`.
- The backend was already healthy on port 5000, so the main issue was the frontend not binding a reachable local listener.

How we overcame it:
- We changed the frontend start path so it first builds the app and then serves the production bundle from `0.0.0.0:3000`.
- This made the local setup behave like a normal reachable web server instead of relying on the unstable dev-server bind in this workspace.

Current local workaround:
- The frontend `start` script now builds the app and serves the production build on `0.0.0.0:3000`.
- This makes local behavior closer to the Render deployment and keeps the site reachable in this workspace.

- DOCUMENTATION.md (deep technical documentation)
- CODE_EXPLANATION.md (beginner-friendly explanation)
- FULL_PROJECT_DEEP_DIVE.md (clean all-in-one handoff guide)
- ARCHITECTURE_FLOW_DIAGRAM.md (architecture and data flow diagrams)

## 15. Latest Change Summary

Recently completed:

- Receiver-side message readability fix (encryption key compatibility)
- EC2 login/register fix via environment-based URLs
- Requests top-level history view in UI
- Persistent request history API
- Follow and unfollow history tracking
- Chat performance optimizations
- Header menu UX updates and profile click enhancements

---

For full architecture and deep implementation details, see DOCUMENTATION.md, FULL_PROJECT_DEEP_DIVE.md, and ARCHITECTURE_FLOW_DIAGRAM.md.

## 16. Recent Change Log (Yesterday and Today)

### Yesterday

- Added Google OAuth backend support in `backend/routes/auth.js` using `google-auth-library`.
- Added `googleId` to the `User` model so Google accounts can be linked safely.
- Added backend SMTP fallback support so OTPs can be sent with either `SMTP_*`, `EMAIL_*`, or `MAIL_*` environment variables.
- Updated registration flow so failed registrations roll back the created user record, freeing username and email for reuse.
- Documented backend mail environment variables and Google auth settings.

### Today

- Added a visible Google OAuth sign-in button to the auth screen on both login and register pages.
- Added the Google client ID to backend and frontend env files for this workspace.
- Kept the Google OAuth flow login-first, then prompt for a username only when the Google account is new.
- Fixed a frontend CSS compile issue in `Auth.css` after adding the OAuth button UI.
- Clarified the exact Google Cloud Console settings for this project: JavaScript origin `http://localhost:3000` and no redirect URI for the popup flow.
- Added a full password recovery flow with `forgot-password` and `reset-password` routes.
- Added email-based password reset links and a dedicated reset screen in the frontend.
