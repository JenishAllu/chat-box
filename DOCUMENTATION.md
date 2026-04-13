# Advanced Real-Time Insta Chat System - Full Documentation

This document is the complete technical documentation of the current working project state, including:
- What was changed
- How the system works end-to-end
- Detailed code explanation by file
- API and Socket events reference
- Encryption design and receiver decryption fix
- Validation and testing guide

## 1. Project Overview

This is a full-stack real-time chat platform built with:
- Frontend: React, Axios, Socket.IO Client, CryptoJS
- Backend: Node.js, Express, Socket.IO Server
- Database: MongoDB with Mongoose

Core capabilities:
- Authentication (register/login)
- 1-to-1 chat and group chat
- Media attachments
- Message replies, edit, delete, clear
- Seen status and unread counts
- Typing indicators and online/offline presence
- Follow/request/accept social gating for direct messages
- Profile avatar, profile info, block/unblock users
- Client-side AES encryption/decryption for message bodies

## 2. Important Changes Implemented

### 2.1 Social and Access-Control Changes
- Added follow/follower model fields.
- Added chat request workflow:
  - Follow or request-chat can create incoming request.
  - Receiver can accept/decline.
  - Direct messages are blocked unless both users accepted each other.
- Added block/unblock behavior:
  - Blocking removes social links and accepted chat links between both users.
  - Messaging blocked when sender or receiver is blocked.

### 2.2 Chat UX and Messaging Changes
- Added real-time request notification and acceptance notification.
- Added unread counters and seen synchronization.
- Added editing and deletion options.
- Added clear chat options (for self / everyone).
- Added reply-to message support.
- Added image compression before upload.
- Added avatar upload for users and groups.

### 2.3 Encryption Changes (Current Working Model)
- Messages are encrypted on client before sending and decrypted on client after receiving.
- Server stores encrypted payload and never decrypts message text.
- Current key model in Chat.js uses deterministic shared key:
  - SECRET_SALT = INSTA_CHAT_SYSTEM_E2E_MESSAGE_ENCRYPTION_2024
  - ENCRYPTION_KEY = SHA256(SECRET_SALT)
- This model ensures both sender and receiver can decrypt the same ciphertext.
- This specifically fixes the issue where receiver previously saw encrypted text like U2FsdGVkX1...

## 3. End-to-End Runtime Flow

### 3.1 Authentication Flow
1. User submits form in Auth.js.
2. Frontend posts to /api/auth/register or /api/auth/login.
3. Backend hashes/compares password and returns JWT + user object.
4. Frontend stores user object in localStorage and navigates to /chat.

### 3.2 Real-Time Connection Flow
1. Chat.js mounts and loads user/groups/unread data using REST APIs.
2. Client emits setUserId through socket.
3. Server registers onlineUsers map, emits online list and userOnline events.
4. Client listens for presence, typing, social notifications, and message events.

### 3.3 Direct Message Send Flow
1. User types message and clicks send.
2. Chat.js encrypts message text with ENCRYPTION_KEY.
3. Client emits sendMessage with encrypted payload.
4. Server validates block and acceptedChats gating.
5. Server stores message in MongoDB and emits receiveMessage.
6. Receiver decrypts on client and sees plaintext in UI.

### 3.4 Message Seen/Unread Flow
1. If receiver has chat open, client emits markSeen for message.
2. Server updates message seen=true and emits messageSeen.
3. Client updates read indicators and unread counters.

## 4. Backend - Detailed Code Explanation

## 4.1 backend/server.js
Responsibilities:
- Initializes Express, MongoDB, and Socket.IO.
- Mounts REST routes:
  - /api/auth
  - /api/users
  - /api/groups
  - /api/messages
- Tracks online users through in-memory map.
- Handles all major socket events.

Key socket events:
- setUserId: register online socket, emit online list, auto-join user groups.
- joinRoom: join 1-to-1 deterministic room.
- joinGroup: join group room.
- sendChatRequest: notify recipient in real-time.
- chatRequestAccepted: notify original requester in real-time.
- sendMessage: validate + persist + broadcast message.
- markSeen / markAllSeen: read receipt propagation.
- editMessage: update message content + isEdited flag.
- deleteMessage: delete for everyone OR soft-delete for one user.
- clearChat: clear room for everyone OR hide for one user.
- typing / stopTyping: typing indicators.
- disconnect: remove from online map and emit offline event.

## 4.2 backend/routes/auth.js
Endpoints:
- POST /register
  - Validates required fields.
  - Hashes password with bcrypt.
  - Creates user and returns JWT + user.
- POST /login
  - Validates required fields.
  - Checks user by email and bcrypt password comparison.
  - Returns JWT + user.

## 4.3 backend/routes/users.js
Endpoints and behavior:
- GET /api/users
  - Returns all users excluding password.
- GET /api/users/:id/suggestions
  - Returns users excluding self and already-followed users.
- PUT /api/users/:id/avatar
  - Updates profile avatar.
- PUT /api/users/:id/follow/:targetId
  - Adds following and target follower.
  - Adds chatRequests entry to target.
- PUT /api/users/:id/unfollow/:targetId
  - Removes following/follower link.
- PUT /api/users/:id/request-chat/:targetId
  - Sends standalone request if not blocked.
- PUT /api/users/:id/accept-chat/:requesterId
  - Removes request and adds both users to acceptedChats.
- PUT /api/users/:id/decline-chat/:requesterId
  - Removes pending request only.
- PUT /api/users/:id/block/:targetId
  - Adds blocked user and removes social/chat links both directions.
- PUT /api/users/:id/profile
  - Updates displayName and bio.
- GET /api/users/:id/blocked
  - Returns populated blocked users.
- PUT /api/users/:id/unblock/:targetId
  - Removes user from blocked list.

## 4.4 backend/routes/groups.js
- POST /api/groups
  - Creates group with name, members, admin.
- GET /api/groups/:userId
  - Returns groups where user is a member.
- PUT /api/groups/:groupId/avatar
  - Updates group avatar.
- PUT /api/groups/:groupId/name
  - Updates group name.

## 4.5 backend/routes/messages.js
- GET /api/messages/:userId/:otherId
  - For DM: uses deterministic room ID.
  - For group: uses group ID room when isGroup=true.
  - Excludes messages hidden by deletedBy for current user.
  - Populates replyTo minimal fields.
- POST /api/messages/seen
  - Marks all incoming unseen messages in room as seen.
- GET /api/messages/unread/:userId
  - Aggregates unseen message counts by sender.

## 4.6 Data Models

### backend/models/User.js
Fields:
- username, email unique
- password
- avatar, displayName, bio
- following, followers, blocked
- chatRequests, acceptedChats

### backend/models/Group.js
Fields:
- name, avatar
- members[]
- admin

### backend/models/Message.js
Fields:
- room, from, to, message
- media { data, type, name }
- replyTo reference
- isGroup, seen, deletedBy[], isEdited
- Compound index on room + createdAt for history reads

## 5. Frontend - Detailed Code Explanation

## 5.1 frontend/src/App.js
- Defines two routes:
  - / => Auth screen
  - /chat => Chat screen

## 5.2 frontend/src/components/Auth.js
- Handles login/register form state.
- Performs client-side required-field checks.
- Calls backend auth endpoints.
- Stores user in localStorage on success.
- Redirects to /chat.

## 5.3 frontend/src/components/Chat.js
Main responsibilities:
- Initializes full chat UI state and social state.
- Loads users, groups, requests, unread counts.
- Manages socket listeners and cleanup.
- Handles chat opening and history fetch/decrypt.
- Handles send/edit/delete/clear actions.
- Handles social actions (follow/request/accept/decline/block/unblock).
- Handles avatar upload, profile modal, and discover tab.

Important implementation points:
- Deterministic room function for DM room consistency.
- Optimistic message append before server confirmation.
- Incoming message deduplication by _id and optimistic match.
- Decrypt on receive, decrypt on history load, decrypt on edit update.
- Typing indicator with timeout cleanup.

## 5.4 frontend/src/utils/encryption.js
Utility functions available:
- generateSharedEncryptionKey(roomId)
- generateEncryptionKey(userId) (legacy compatibility helper)
- encryptMessage(message, key)
- decryptMessage(cipher, key)
- encryptMessages(array, key)
- decryptMessages(array, key)
- isValidEncryptionKey(key)

Note:
- Chat.js currently computes ENCRYPTION_KEY directly from SECRET_SALT.
- Encryption utility remains reusable for future per-room key migration.

## 6. API Reference (Quick)

Auth:
- POST /api/auth/register
- POST /api/auth/login

Users:
- GET /api/users
- GET /api/users/:id/suggestions
- PUT /api/users/:id/avatar
- PUT /api/users/:id/follow/:targetId
- PUT /api/users/:id/unfollow/:targetId
- PUT /api/users/:id/request-chat/:targetId
- PUT /api/users/:id/accept-chat/:requesterId
- PUT /api/users/:id/decline-chat/:requesterId
- PUT /api/users/:id/block/:targetId
- PUT /api/users/:id/unblock/:targetId
- PUT /api/users/:id/profile
- GET /api/users/:id/blocked

Groups:
- POST /api/groups
- GET /api/groups/:userId
- PUT /api/groups/:groupId/avatar
- PUT /api/groups/:groupId/name

Messages:
- GET /api/messages/:userId/:otherId?isGroup=true|false
- POST /api/messages/seen
- GET /api/messages/unread/:userId

## 7. Socket Event Reference

Client -> Server:
- setUserId
- joinRoom
- joinGroup
- sendChatRequest
- chatRequestAccepted
- sendMessage
- markSeen
- markAllSeen
- editMessage
- deleteMessage
- clearChat
- typing
- stopTyping

Server -> Client:
- userOnline
- userOffline
- onlineList
- chatRequestReceived
- chatAccepted
- errorMessage
- receiveMessage
- backgroundMessage
- messageSeen
- allMessagesSeen
- messageEdited
- messageDeleted
- chatCleared
- typing
- stopTyping

## 8. Encryption Validation Checklist

To verify encryption and receiver decryption are working:
1. Start backend and frontend.
2. Login from two users.
3. Send message A -> B.
4. Confirm network/websocket payload contains encrypted string (starts like U2FsdGVkX1...).
5. Confirm User B chat UI shows original readable text, not ciphertext.
6. Refresh User B and reopen chat; history still decrypts correctly.

## 9. Setup and Run

Prerequisites:
- Node.js installed
- MongoDB URI

Install:
1. backend folder: npm install
2. frontend folder: npm install

Environment file backend/.env:
- MONGO_URI=your_mongodb_uri
- JWT_SECRET=your_jwt_secret
- PORT=5000

Run:
1. backend: node server.js
2. frontend: npm start

## 10. Production Issue Fix (EC2 Login/Register)

### Problem observed
- App opened the login page on EC2.
- Register and login API calls failed.

### Root cause
- Frontend had hardcoded backend URL values using localhost.
- In browser context on EC2 deployment, localhost points to the browser host itself, not the remote backend service endpoint expected by users.

### What was changed

Updated frontend API and socket URLs to environment-aware values with safe fallback:

1. Auth component update in frontend/src/components/Auth.js
- Added API_BASE constant:
  - process.env.REACT_APP_API_URL
  - fallback to protocol + hostname + :5000
- Replaced auth request URL with API_BASE.

2. Chat component update in frontend/src/components/Chat.js
- Added API_BASE constant using same fallback logic.
- Added SOCKET_URL constant:
  - process.env.REACT_APP_SOCKET_URL
  - fallback to API_BASE
- Replaced socket initialization to use SOCKET_URL.
- Replaced all axios calls from hardcoded localhost to API_BASE.

### Why this fix works
- Frontend now targets your deployed backend host/IP instead of localhost.
- Register and login endpoints are reachable in EC2/browser deployment.
- Socket connection also points to the correct host.

### Environment variables for deployment (recommended)

Create frontend/.env (or set in your frontend runtime environment):
- REACT_APP_API_URL=http://YOUR_EC2_PUBLIC_IP:5000
- REACT_APP_SOCKET_URL=http://YOUR_EC2_PUBLIC_IP:5000

### EC2 checklist
1. Backend running on port 5000.
2. Frontend running on port 3000 (or served build).
3. EC2 Security Group allows inbound ports 3000 and 5000.
4. Backend .env has valid MONGO_URI and JWT_SECRET.
5. Restart frontend after changing REACT_APP_* variables.

### Quick verification steps
1. Open browser devtools network tab.
2. Attempt register/login.
3. Confirm request URL points to EC2 host:5000, not localhost:5000.
4. Confirm response returns token and user.
5. Confirm successful navigation to chat page.

## 11. Known Limitations and Next Improvements

Current limitations:
- Shared static key in frontend is functional but not strongest cryptographic model.
- Key rotation is not implemented.
- True per-conversation secure key exchange (RSA/ECDH) not yet implemented.

Recommended roadmap:
1. Move to per-conversation keys.
2. Add secure key exchange between peers.
3. Add key rotation and forward secrecy.
4. Add robust message signature verification.

## 12. Conclusion

The project is currently working with:
- Real-time messaging
- Social-gated DM access
- Presence/read receipts/typing
- Media and profile/group enhancements
- Client-side AES encryption with correct receiver decryption

This documentation reflects the current source code behavior and the latest encryption/decryption fix.
