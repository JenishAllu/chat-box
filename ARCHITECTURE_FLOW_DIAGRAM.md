# Insta Chat System Architecture and Complete Data Flow

This file provides complete architecture diagrams and full data flow for the current working system.

## 1. High-Level Architecture

```mermaid
flowchart LR
    U1[User A Browser]
    U2[User B Browser]

    subgraph FE[Frontend React App]
      A1[Auth.js]
      A2[Chat.js]
      A3[encryption.js]
      A4[Axios REST Client]
      A5[Socket.IO Client]
      A6[localStorage]
    end

    subgraph BE[Backend Node/Express]
      B1[server.js]
      B2[Socket.IO Server]
      B3[REST Routes]
      B4[auth.js]
      B5[users.js]
      B6[groups.js]
      B7[messages.js]
    end

    subgraph DB[MongoDB]
      D1[(User Collection)]
      D2[(Group Collection)]
      D3[(Message Collection)]
    end

    U1 --> FE
    U2 --> FE

    FE -->|HTTP/REST| B3
    FE -->|WebSocket| B2

    B3 --> B4
    B3 --> B5
    B3 --> B6
    B3 --> B7

    B4 --> D1
    B5 --> D1
    B6 --> D2
    B7 --> D3

    B2 --> D1
    B2 --> D2
    B2 --> D3
```

## 2. Repository Structure Diagram

```mermaid
flowchart TD
    ROOT[FINAL_Gold_Level_Insta_Chat_System]

    ROOT --> BE[backend]
    ROOT --> FE[frontend]
    ROOT --> DOC1[DOCUMENTATION.md]
    ROOT --> DOC2[CODE_EXPLANATION.md]
    ROOT --> DOC3[ARCHITECTURE_FLOW_DIAGRAM.md]

    BE --> BE1[server.js]
    BE --> BE2[models]
    BE --> BE3[routes]

    BE2 --> M1[User.js]
    BE2 --> M2[Group.js]
    BE2 --> M3[Message.js]

    BE3 --> R1[auth.js]
    BE3 --> R2[users.js]
    BE3 --> R3[groups.js]
    BE3 --> R4[messages.js]

    FE --> FE1[src]
    FE1 --> F1[App.js]
    FE1 --> F2[index.js]
    FE1 --> FC[components]
    FE1 --> FU[utils]

    FC --> C1[Auth.js]
    FC --> C2[Chat.js]
    FC --> C3[Auth.css]
    FC --> C4[Chat.css]

    FU --> U1[encryption.js]
```

## 3. Data Model Relationship Diagram

```mermaid
erDiagram
    USER {
        string _id
        string username
        string email
        string password
        string avatar
        string displayName
        string bio
        array following
        array followers
        array blocked
        array chatRequests
        array acceptedChats
    }

    GROUP {
        string _id
        string name
        string avatar
        array members
        string admin
    }

    MESSAGE {
        string _id
        string room
        string from
        string to
        string message
        object media
        string replyTo
        boolean isGroup
        boolean seen
        array deletedBy
        boolean isEdited
        datetime createdAt
    }

    USER ||--o{ GROUP : member_of
    USER ||--o{ MESSAGE : sends
    GROUP ||--o{ MESSAGE : contains
    MESSAGE ||--o| MESSAGE : replies_to
```

## 4. Authentication Flow

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant FE as Auth.js
    participant API as auth.js Route
    participant DB as MongoDB(User)

    U->>FE: Enter email/password
    FE->>API: POST /api/auth/login
    API->>DB: Find user by email
    DB-->>API: User document
    API->>API: bcrypt.compare(password)
    API->>API: jwt.sign(token)
    API-->>FE: { token, user }
    FE->>FE: Save user to localStorage
    FE-->>U: Navigate to /chat
```

## 5. Direct Message Flow (Encrypted)

```mermaid
sequenceDiagram
    autonumber
    participant A as User A Chat.js
    participant ENC as encryption.js
    participant S as Socket.IO Server
    participant DB as MongoDB(Message)
    participant B as User B Chat.js

    A->>ENC: encryptMessage(plaintext, ENCRYPTION_KEY)
    ENC-->>A: ciphertext
    A->>S: sendMessage({ from, to, message: ciphertext })

    S->>S: Validate blocked + acceptedChats gate
    S->>DB: Message.create(ciphertext payload)
    DB-->>S: saved message

    S-->>A: receiveMessage(saved message)
    S-->>B: receiveMessage(saved message)

    B->>ENC: decryptMessage(ciphertext, ENCRYPTION_KEY)
    ENC-->>B: plaintext
    B-->>B: Render readable bubble
```

## 6. Group Message Flow

```mermaid
sequenceDiagram
    autonumber
    participant U as Sender Chat.js
    participant S as Socket.IO Server
    participant DB as MongoDB(Message)
    participant G1 as Group Member 1
    participant G2 as Group Member 2

    U->>S: joinGroup(groupId)
    U->>S: sendMessage({ to: groupId, isGroup: true, ... })
    S->>DB: Save group message (room = groupId)
    DB-->>S: saved message
    S-->>G1: receiveMessage(group message)
    S-->>G2: receiveMessage(group message)
```

## 7. Chat Request and DM Gating Flow

```mermaid
sequenceDiagram
    autonumber
    participant A as User A
    participant API as users.js
    participant B as User B
    participant S as Socket Server

    A->>API: PUT /follow or /request-chat
    API->>API: Add A to B.chatRequests
    A->>S: sendChatRequest socket event
    S-->>B: chatRequestReceived

    B->>API: PUT /accept-chat/:requesterId
    API->>API: Add both users to acceptedChats
    B->>S: chatRequestAccepted socket event
    S-->>A: chatAccepted

    Note over A,B: DM allowed only when both acceptedChats contain each other
```

## 8. Seen/Unread Data Flow

```mermaid
flowchart LR
    M1[Incoming Message saved with seen=false]
    M2[Receiver opens chat]
    M3[Client emits markSeen]
    M4[Server updates seen=true]
    M5[Server emits messageSeen/allMessagesSeen]
    M6[Sender UI updates status to Seen]
    M7[Unread aggregate endpoint updates badge]

    M1 --> M2 --> M3 --> M4 --> M5 --> M6
    M4 --> M7
```

## 9. Message Edit/Delete/Clear Flow

```mermaid
flowchart TD
    E1[User action in Chat.js]
    E2{Action Type}

    E2 -->|Edit| E3[emit editMessage]
    E2 -->|Delete Me| E4[emit deleteMessage type=me]
    E2 -->|Delete Everyone| E5[emit deleteMessage type=everyone]
    E2 -->|Clear Me| E6[emit clearChat type=me]
    E2 -->|Clear Everyone| E7[emit clearChat type=everyone]

    E3 --> E8[Server updates message text + isEdited]
    E4 --> E9[Server adds userId to deletedBy]
    E5 --> E10[Server deletes message document]
    E6 --> E11[Server adds deletedBy for room messages]
    E7 --> E12[Server deletes all room messages]

    E8 --> E13[Emit messageEdited]
    E9 --> E14[Emit messageDeleted]
    E10 --> E14
    E11 --> E15[Emit chatCleared]
    E12 --> E15
```

## 10. Presence and Typing Flow

```mermaid
sequenceDiagram
    autonumber
    participant C1 as Client 1
    participant S as Socket Server
    participant C2 as Client 2

    C1->>S: setUserId
    S-->>C2: userOnline
    S-->>C1: onlineList

    C1->>S: typing({from,to})
    S-->>C2: typing

    C1->>S: stopTyping({from,to})
    S-->>C2: stopTyping

    C1--xS: disconnect
    S-->>C2: userOffline
```

## 11. Where Encryption Happens Exactly

- Encrypt before send: frontend/src/components/Chat.js -> send()
- Encrypt before edit emit: frontend/src/components/Chat.js -> submitEdit()
- Decrypt on live receive: frontend/src/components/Chat.js -> socket receiveMessage handler
- Decrypt on history fetch: frontend/src/components/Chat.js -> openChat()
- Decrypt on edited message event: frontend/src/components/Chat.js -> messageEdited handler

Important: backend does not decrypt message body anywhere; it stores and forwards encrypted data.

## 12. Full End-to-End Summary

1. User authenticates and enters chat.
2. Frontend loads lists/history via REST and connects socket.
3. User sends encrypted message.
4. Server validates social rules and persists message.
5. Server emits message events in real-time.
6. Receiver decrypts and displays plaintext.
7. Seen, unread, typing, online states keep both clients synchronized.
8. Optional operations (reply, media, edit, delete, clear) flow through dedicated socket handlers and database updates.
