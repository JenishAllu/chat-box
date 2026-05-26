# Welcome! A Complete Beginner's Guide to Our Chat App

If you have **absolutely zero programming knowledge**, you are in the perfect place. This document will walk you through every single file in our project and explain what the code does using simple, real-world analogies.

Imagine our Chat Application is like a **Busy Restaurant**:
- **Frontend (React)**: The dining area, menus, and waiters. This is what you (the user) see, click, and interact with on your screen.
- **Backend (Node.js/Express)**: The kitchen and the manager. They receive your orders (messages), process them, and figure out who gets what.
- **Database (MongoDB)**: The giant filing cabinet in the back office. It safely stores everyone's accounts, chat history, and group lists forever.
- **WebSockets (Socket.IO)**: A lightning-fast set of walkie-talkies. Instead of a waiter walking to the kitchen to ask if your food is ready, the kitchen instantly radios you the moment it is done (real-time chat).

Let's explore every file in the system!

---

## Part 1: The Front Door (Starting the App)

### `frontend/src/index.js`
This is the absolute very first file that runs when someone opens the website.
- **`import React...`**: We are telling the browser, "Go get the React toolkit so we can build a website."
- **`const root = ReactDOM.createRoot(...)`**: We tell the website to find a blank canvas on the screen (called "root") where we will paint our entire application.
- **`root.render(<App/>);`**: We take our main application blueprint (named `App`) and finally paint it onto the screen for the user to see.

### `frontend/src/App.js`
If `index.js` is the blank canvas, `App.js` is the map that directs people to different rooms.
- **`<BrowserRouter>`**: Think of this as the GPS system. It looks at the website URL (like `www.website.com/chat`) to know where the user wants to go.
- **`<Routes>` and `<Route>`**: These are the actual street signs. 
  - `path="/"` tells the GPS: "If the user is at the home page, show them the `<Auth/>` (Log In) screen."
  - `path="/chat"` tells the GPS: "If they go to /chat, show them the `<Chat/>` screen."

---

## Part 2: The User Interface (What you click on)

### `frontend/src/components/Auth.js`
This file is the security guard at the front door. It handles Logging In and Creating Accounts.
- **`const [isLogin, setIsLogin] = useState(true);`**: A mental switch. We tell the app to remember if the user is looking at the "Log In" form or the "Sign Up" form.
- **`const [form, setForm] = useState(...)`**: A digital notepad. Every time you type a letter into the email or password box, the app writes it down here.
- **`if (!form.email... || !form.password...)`**: The security guard checking your ID. If you left a box blank, it stops you and says "All fields are required" before even bothering the kitchen (backend).
- **`axios.post(".../api/auth", form)`**: The waiter taking your filled-out notepad (form) to the kitchen (backend) to see if your password is correct.
- **`localStorage.setItem("user"...)`**: If you logged in successfully, the app stamps your hand. This hand-stamp is saved in your browser so if you close the tab and come back, you are still logged in.
- **`nav("/chat")`**: The guard opens the door and physically moves you into the Chat Room.

### `frontend/src/components/Chat.js`
This is the massive main dining hall where all the magic, texting, and image sharing happens.
- **`const [messages, setMessages] = useState([])`**: A massive list keeping track of every single chat bubble currently drawn on your screen.
- **`useEffect(...)`**: A built-in React robot that automatically runs tasks in the background when the page loads. It connects your personal walkie-talkie (WebSocket) to the server.
- **`socket.on("receiveMessage", ...)`**: Your walkie-talkie listening. When a friend sends a message, your walkie-talkie crackles, receives the text, and instantly draws a new chat bubble on your screen without you having to refresh the page.
- **`CryptoJS.AES.encrypt(...)` (Security Vault)**: Before handing your message to the manager, the frontend locks it with AES encryption. The filing cabinet stores encrypted strings only. When your friend receives the message, the frontend decrypts it back to readable text using the same shared deterministic key used by sender and receiver.
- **`compressImage(file)` function**: If you try to send a giant 10-Megabyte photo, this function secretly shrinks it down to a tiny size in the background so it sends instantly without crashing the network.
- **`if (timeStr !== prevTimeStr)`**: A smart design feature. If you send 5 messages in the exact same minute, it only prints "10:05 AM" once at the top, instead of printing it 5 times which would look messy (just like Instagram).

---

## Part 3: The Brain of the Kitchen (The Backend)

### `backend/server.js`
This is the restaurant manager. It listens for requests, connects the walkie-talkies, and talks to the filing cabinet (Database).
- **`const express = require("express");`**: We hire the Express Framework to act as our head waiter, routing requests to the right places.
- **`mongoose.connect(...)`**: The manager unlocks the giant filing cabinet (MongoDB) so we can save data safely in the cloud.
- **`const io = new Server(server...)`**: The manager hands out the walkie-talkies (WebSockets) to every user who joins the website.
- **`socket.on("joinRoom", ...)`**: When you click on a friend's name, the manager creates a secret, soundproof room just for the two of you. Any messages sent in this room cannot be heard by anyone else.
- **`socket.on("sendMessage", ...)`**: The manager hears you speak into the walkie-talkie. They receive encrypted message payload, write it into MongoDB, and instantly echo it into your friend's walkie-talkie so they see it after client-side decryption.
- **`socket.on("editMessage", ...)` and `socket.on("deleteMessage", ...)`**: The manager's eraser and correction pen. It allows users to retroactively reach into the filing cabinet to edit or destroy old messages.
- **Unblocking Users**: If you've previously blocked someone, you can use the **Unblock** button in your Profile or the Explore tab. The manager hears this, finds that person in the "Blocked" folder of the filing cabinet, and tears up the block record, allowing you to follow or chat with them again.

---

## Part 4: The Filing Cabinet Blueprints (Database Models)

Before we save data, we need to tell the filing cabinet exactly what a "User" or a "Message" looks like, so it stays organized.

### `backend/models/User.js`
- **`username: { type: String, unique: true }`**: We tell the cabinet that every user MUST have a name, and `unique: true` means no two people can have the exact same username.
- **`password: String`**: We make a space to store the password. (Don't worry, it's scrambled into a secret code before saving!)

### `backend/models/Message.js`
- **`room: String`**: The secret ID of the soundproof room where this message was sent.
- **`from:` and `to:`**: It strictly writes down exactly who sent the message, and exactly who is supposed to read it.
- **`seen: { type: Boolean, default: false }`**: A tiny checkbox. When the message is sent, it's marked `false` (Unread). When your friend opens the chat, it flips to `true` (Seen!).

### `backend/models/Group.js`
- **`members: [ ... ]`**: Instead of a 1-on-1 chat, this is a massive list storing the ID of *every single person* allowed inside the group chat.
- **`admin:`**: A VIP badge given only to the creator, letting them control the group.

---

## Part 5: The Traffic Cops (API Routes)

These files are like traffic cops. When a waiter (Frontend) brings a request (like "Log me in!" or "Give me my old messages!"), the traffic cops direct the request to the right filing cabinet folder.

### `backend/routes/auth.js` (Logging In & Registering)
- **`router.post("/register", ...)`**: The traffic cop for creating accounts. It checks if the email is taken.
- **`bcrypt.hash(password, 10)`**: The scrambler! Before saving a user's password to the database, it scrambles it into a random mix of letters and numbers (like `x7#k9@qP`) so hackers can never read it.
- **`jwt.sign(...)`**: Once logged in, the cop gives the user a VIP Wristband (JWT Token). The user shows this wristband to the app to prove they are safely logged in.

### `backend/routes/users.js` (Finding Friends)
- **`router.get("/", ...)`**: The cop that handles the "Search for users" feature. 
- **`.select("-password")`**: A massive security feature! This tells the cabinet: "Go get the list of all users, but **DO NOT** bring back their hidden passwords." It protects everyone's data.

### `backend/routes/messages.js` (Loading Chat History)
- **`getRoom(a, b)`**: A little trick. If User A and User B talk, we combine their names alphabetically (like `A_B`) to always find their shared secret room history.
- **`router.get('/:userId/:otherId')`**: When you open a chat, this cop grabs your shared secret room name and runs to the filing cabinet to grab all your old text logs so you can read your past conversations.
- **`router.post('/seen')`**: The Read Receipt cop. When you look at a message, this cop runs to the cabinet and aggressively checks off "Seen!" on every unread message from your friend.

### `backend/routes/groups.js` (Group Chats)
- **`router.post('/', ...)`**: The cop that helps you create a group. You hand it a Name and a list of Friends, and it permanently carves a new Group folder into the filing cabinet.
- **`router.get('/:userId')`**: The cop that checks which groups you are allowed to be inside, making sure you don't sneak into groups you weren't invited to.

---

### You Did It!
That is exactly how our application flows! The **Frontend React code (Waiters)** takes your button clicks, the **Traffic Cop Routes** direct your requests, the **Database Models** save your data neatly in the filing cabinet, and the **Walkie-Talkies (WebSockets)** keep the chat bubbling in real-time!

---

## Part 6: Example Flow — The Lifecycle of a Single Message

To truly understand how everything connects, let's trace *exactly* what happens step-by-step when you type "Hello" to a friend and hit send.

**1. The Button Click (`frontend/src/components/Chat.js`)**
- You type "Hello" and hit the "Send" button.
- The **`send()`** function is instantly triggered inside the React app.
- *Bonus Feature (Optimistic Updates):* Before even talking to the server, the app instantly draws a green "Hello" bubble on your screen using **`setMessages(prev => [...prev, optimisticMsg])`**. This makes the app feel lightning fast because you aren't waiting on the internet connection to confirm anything.
- Finally, your walkie-talkie (Socket.IO) takes the message data and throws it silently to the server by calling **`socket.emit("sendMessage", payload)`**.

**2. The Manager Catches It (`backend/server.js`)**
- The server manager is constantly listening. It hears the `sendMessage` alert through the **`socket.on("sendMessage", async (data) => { ... })`** function.
- It immediately receives encrypted text (ciphertext), then talks to the Database Model (**`Message.create()`**). A brand new, permanent, timestamped encrypted record of this message is safely locked into MongoDB.

**3. Blasting the Walkie-Talkie (`backend/server.js`)**
- Once the text is securely saved in the database, the server manager looks at the unique, soundproof room you share with your friend.
- It broadcasts the confirmed message directly to your friend's exact walkie-talkie line by running **`io.to(room).emit("receiveMessage", savedMessage)`**.

**4. The Friend Receives It (`frontend/src/components/Chat.js`)**
- Your friend's browser is quietly listening in the background. Their **`socket.on("receiveMessage", handler)`** function suddenly fires because their walkie-talkie just crackled!
- The app catches the incoming "Hello" object and immediately adds a grey bubble to their screen list (**`setMessages(prev => [...prev, data])`**).

**5. The "Seen" Receipt Backflip (Other Features)**
- If your friend already has your specific chat physically open on their screen when the message lands, their app knows they read it instantly!
- Their app whispers back out to the server: **`socket.emit('markSeen')`**.
- The server hears this and updates the database tracking status to `seen: true`.
- The server then echoes **`receiveSeen`** specifically back to *you*. Your screen magically catches it and flips the tiny label under your green bubble from "Sent" to "Seen".

All 5 of these steps happen in a fraction of a second, completely bypassing traditional, slow webpage loading. That is the ultimate power of this Real-Time modern architecture!

---

## Part 7: New Changes Added Recently

### Google OAuth Login
- The login/register screen now includes a Google sign-in button.
- If the Google account already exists, the app logs the user in immediately.
- If it is a new Google account, the app asks for a username before creating the account.

### OTP Email Delivery
- Registration still sends a verification code to email.
- The backend now supports more mail environment variable names so OTP email delivery works even if the config uses `SMTP_*`, `EMAIL_*`, or `MAIL_*` names.

### Safe Registration Retry
- If registration fails after the account is created, the app deletes that partial user record.
- This lets the user try again with the same username and email.

### Important Project Settings
- Google OAuth uses the frontend origin `http://localhost:3000` in this workspace.
- The current Google flow uses a popup/button style sign-in, so redirect URIs are not required for this setup.

### Forget Password and Reset Password
- The login screen now has a "Forgot password?" link.
- When someone types their email, the backend sends a reset link to that email.
- The reset link opens a reset page where the user chooses a new password.
- The app checks the reset token so old or fake links cannot be used.
- The backend stores only a hashed version of the reset token, not the raw token itself.
