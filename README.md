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

Fallback behavior:

- Uses current host with port 5000 when env vars are not provided.

Example environment settings:

- REACT_APP_API_URL=http://YOUR_SERVER_IP:5000
- REACT_APP_SOCKET_URL=http://YOUR_SERVER_IP:5000

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

Frontend expected variables:

- REACT_APP_API_URL
- REACT_APP_SOCKET_URL

## 13. Security Notes

- Passwords are hashed with bcrypt.
- JWT is used for authentication.
- Message body is encrypted before storage.
- blocked relationships are enforced during message send and request actions.

## 14. Documentation Files

Additional project docs:

- DOCUMENTATION.md (deep technical documentation)
- CODE_EXPLANATION.md (beginner-friendly explanation)
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

For full architecture and deep implementation details, see DOCUMENTATION.md and ARCHITECTURE_FLOW_DIAGRAM.md.
