
import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import "./Chat.css";

// create a single socket connection once per app load
const socket = io("http://localhost:5000");

// helper to compute conversation room id
function room(a, b) { return [a, b].sort().join("_"); }

function Chat() {
  const user = JSON.parse(localStorage.getItem("user")) || {};
  const nav = useNavigate();
  const [localUser, setLocalUser] = useState(user || {});
  const displayName = (localUser && localUser.username) ? localUser.username : 'user1';
  const initials = displayName.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [msg, setMsg] = useState("");
  const [messages, setMessages] = useState([]); // chat history + live updates
  const [unreadCounts, setUnreadCounts] = useState({}); // track unread per user
  const [selectedMedia, setSelectedMedia] = useState(null); // for sending media
  const [onlineUsers, setOnlineUsers] = useState({}); // track online status: { userId: isOnline }
  const [typingUser, setTypingUser] = useState(null); // typing state ID
  const typingTimeoutRef = useRef(null);
  const messagesEndRef = useRef(null);
  const mediaFileRef = useRef();

  useEffect(() => {
    axios.get("http://localhost:5000/api/users")
      .then(res => setUsers(res.data.filter(u => u._id !== localUser._id)));
    // load unread counts from server (persists across refresh)
    axios.get(`http://localhost:5000/api/messages/unread/${localUser._id}`)
      .then(res => setUnreadCounts(res.data))
      .catch(err => console.error("failed to load unread counts", err));
    // emit our userId to server so it marks us as online
    socket.emit("setUserId", localUser._id);
  }, [localUser._id]);

  // listen for online/offline status updates
  useEffect(() => {
    const onOnline = (data) => {
      setOnlineUsers(prev => ({ ...prev, [data.userId]: true }));
      // dynamically add new users to list if encountered via socket
      if (data.user && data.user._id !== localUser._id) {
        setUsers(prev => {
          if (!prev.find(u => u._id === data.user._id)) {
            return [...prev, data.user];
          }
          return prev;
        });
      }
    };
    const onOffline = (data) => {
      setOnlineUsers(prev => ({ ...prev, [data.userId]: false }));
    };
    const onList = (map) => {
      // server sends { userId: true }
      setOnlineUsers(map || {});
    };
    socket.on("userOnline", onOnline);
    socket.on("userOffline", onOffline);
    socket.on("onlineList", onList);
    socket.on("typing", (data) => {
      setTypingUser(data.from);
      // auto-clear after 3s as fallback
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
    });
    socket.on("stopTyping", () => {
      setTypingUser(null);
      clearTimeout(typingTimeoutRef.current);
    });

    return () => {
      socket.off("userOnline", onOnline);
      socket.off("userOffline", onOffline);
      socket.off("onlineList", onList);
      socket.off("typing");
      socket.off("stopTyping");
      clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  // listen for new messages from socket; clean up on unmount to avoid duplicates
  useEffect(() => {
    const handler = (data) => {
      // if server already sent this message (has _id), ignore duplicate
      setMessages(prev => {
        if (data._id && prev.some(m => m._id === data._id)) return prev;

        // try to find a matching optimistic message (no _id) and replace it
        const idx = prev.findIndex(m => !m._id && m.from === data.from && m.to === data.to && m.message === data.message);
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = data; // replace optimistic entry with server-confirmed message
          return next;
        }

        return [...prev, data];
      });

      // update unread count only if not from selected user
      if (data.to === user._id && data.from !== selected?._id) {
        setUnreadCounts(prev => ({
          ...prev,
          [data.from]: (prev[data.from] || 0) + 1
        }));
      }

      // always emit markSeen for incoming messages
      if (data.to === user._id && data.from === selected?._id) {
        socket.emit('markSeen', data._id);
      }
    };

    const backgroundHandler = (data) => {
      // Only increment if we aren't currently chatting with them
      if (data.from !== selected?._id) {
        setUnreadCounts(prev => ({
          ...prev,
          [data.from]: (prev[data.from] || 0) + 1
        }));
      }
    };

    socket.on("receiveMessage", handler);
    socket.on("backgroundMessage", backgroundHandler);

    return () => {
      socket.off("receiveMessage", handler);
      socket.off("backgroundMessage", backgroundHandler);
    };
  }, [user._id, selected]);

  // fetch history and join socket room when a user is selected
  const openChat = async (u) => {
    setSelected(u);
    setMessages([]); // reset while loading
    // clear unread count for this user
    setUnreadCounts(prev => ({ ...prev, [u._id]: 0 }));

    // load previous conversation from server
    try {
      const res = await axios.get(`http://localhost:5000/api/messages/${user._id}/${u._id}`);
      setMessages(res.data);
    } catch (err) {
      console.error("failed to load messages", err);
    }

    // mark existing incoming messages as seen
    try {
      await axios.post("http://localhost:5000/api/messages/seen", {
        userId: user._id,
        otherId: u._id,
      });
      // update local copy so UI shows ticks
      setMessages(prev => prev.map(m => m.to === user._id ? { ...m, seen: true } : m));
    } catch (e) {
      console.error("failed to mark seen", e);
    }

    socket.emit("joinRoom", { userId: user._id, otherUserId: u._id });
  };

  // avatar upload
  const fileRef = useRef();
  const onAvatarClick = () => fileRef.current && fileRef.current.click();
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;

    // limit avatar size to 500KB to prevent localStorage QuotaExceededError
    if (f.size > 500 * 1024) {
      alert("Avatar image must be smaller than 500KB");
      e.target.value = null;
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      try {
        const res = await axios.put(`http://localhost:5000/api/users/${localUser._id}/avatar`, { avatar: dataUrl });
        setLocalUser(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
      } catch (err) {
        console.error('avatar upload failed', err);
      }
    };
    reader.readAsDataURL(f);
  };

  const send = () => {
    if (!msg.trim() && !selectedMedia || !selected) return;

    const payload = { from: user._id, to: selected._id, message: msg };
    if (selectedMedia) {
      payload.media = selectedMedia;
    }
    // optimistic update so UI feels snappy (no _id yet)
    setMessages(prev => [...prev, { ...payload, room: room(user._id, selected._id), seen: false }]);
    socket.emit("sendMessage", payload);
    setMsg("");
    setSelectedMedia(null);
  };

  const handleTyping = (e) => {
    setMsg(e.target.value);
    if (!selected) return;

    socket.emit("typing", { from: user._id, to: selected._id });

    // reset debounce timer
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("stopTyping", { from: user._id, to: selected._id });
    }, 2000);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
      clearTimeout(typingTimeoutRef.current);
      socket.emit("stopTyping", { from: user._id, to: selected._id });
    }
  };

  // media upload handler
  const onMediaBtnClick = () => mediaFileRef.current && mediaFileRef.current.click();
  const onMediaFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;

    // limit size to ~5MB to prevent socket crash
    if (f.size > 5 * 1024 * 1024) {
      alert("File size exceeds 5MB limit.");
      e.target.value = null; // clear selection
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSelectedMedia({
        data: reader.result.split(',')[1], // remove data:image/...;base64, prefix
        type: f.type,
        name: f.name
      });
      // automatically clear file input so same file can be selected again
      e.target.value = null;
    };
    reader.readAsDataURL(f);
  };

  // scroll to bottom whenever messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const logout = () => {
    socket.disconnect();
    localStorage.removeItem("user");
    nav("/");
  };

  return (
    <div className="chat-root">
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="avatar" onClick={onAvatarClick} style={{ cursor: 'pointer' }}>
            {localUser.avatar ? <img src={localUser.avatar} alt="avatar" /> : initials}
          </div>
          <div className="user-name">{displayName}</div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
          <button className="logout-btn" onClick={logout}>Logout</button>
        </div>
        <div className="users-list">
          {users.map(u => {
            const unread = unreadCounts[u._id] || 0;
            const isOnline = onlineUsers[u._id] || false;
            return (
              <div key={u._id} className="user-item" onClick={() => openChat(u)}>
                <div style={{ position: 'relative' }}>
                  <div className="user-avatar">{u.avatar ? <img src={u.avatar} alt="u" /> : (u.username || 'U').slice(0, 1).toUpperCase()}</div>
                  {isOnline && <div className="online-indicator"></div>}
                </div>
                <div className="user-meta"><div className="user-name">{u.username || 'user1'}</div></div>
                {unread > 0 && <div className="badge">{unread > 99 ? '99+' : unread}</div>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="chat-area">
        {selected ? (
          <>
            <div className="chat-top">
              <div className="other-avatar">{(selected.username || 'U').slice(0, 1).toUpperCase()}</div>
              <div style={{ fontWeight: 700 }}>{selected.username || 'user1'}</div>
            </div>
            <div className="messages">
              {messages
                .filter(m => (m.room && m.room === room(user._id, selected._id)) || room(m.from, m.to) === room(user._id, selected._id))
                .map((m, i) => (
                  <div key={m._id || i} className={`message ${m.from === user._id ? 'sent' : 'received'}`}>
                    <div className={`bubble ${m.from === user._id ? 'sent' : 'received'}`}>
                      {m.media ? (
                        <div>
                          {m.media.type?.startsWith('image/') ? (
                            <img src={`data:${m.media.type};base64,${m.media.data}`} alt="media" style={{ maxWidth: '300px', maxHeight: '400px', borderRadius: '8px' }} />
                          ) : m.media.type?.startsWith('video/') ? (
                            <video controls style={{ maxWidth: '300px', borderRadius: '8px' }}>
                              <source src={`data:${m.media.type};base64,${m.media.data}`} type={m.media.type} />
                            </video>
                          ) : m.media.type?.startsWith('audio/') ? (
                            <audio controls style={{ maxWidth: '300px' }}>
                              <source src={`data:${m.media.type};base64,${m.media.data}`} type={m.media.type} />
                            </audio>
                          ) : (
                            <a href={`data:${m.media.type};base64,${m.media.data}`} download={m.media.name} style={{ color: '#6ee7b7', textDecoration: 'underline' }}>📁 {m.media.name}</a>
                          )}
                          {m.message && <div style={{ marginTop: '6px' }}>{m.message}</div>}
                        </div>
                      ) : (
                        m.message
                      )}
                      <div className="meta">{m.from === user._id ? (m.seen ? 'Seen' : 'Sent') : ''}</div>
                    </div>
                  </div>
                ))}
              {typingUser === selected._id && (
                <div className="typing-indicator" style={{ color: '#6ee7b7', fontSize: '12px', padding: '10px', fontStyle: 'italic', animation: 'fadeInUp 0.3s forwards' }}>
                  {selected.username || 'user'} is typing...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="input-area">
              <textarea value={msg} onChange={handleTyping} onKeyDown={onKeyDown} placeholder="Type a message..." />
              <button className="media-btn" onClick={onMediaBtnClick} title="Send media">📎</button>
              <input ref={mediaFileRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt" style={{ display: 'none' }} onChange={onMediaFile} />
              {selectedMedia && <div className="media-preview">📤 {selectedMedia.name}</div>}
              <button className="send-button" onClick={send}>Send</button>
            </div>
          </>
        ) : (
          <div style={{ color: '#94a3b8', padding: 20 }}>Select a user to start chatting</div>
        )}
      </div>
    </div>
  );
}
export default Chat;
