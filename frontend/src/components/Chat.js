
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
  const [groups, setGroups] = useState([]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [msg, setMsg] = useState("");
  const [messages, setMessages] = useState([]); // chat history + live updates
  const [unreadCounts, setUnreadCounts] = useState({});

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  
  const compressImage = (file) => {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) {
        const r = new FileReader(); r.onload = e => resolve(e.target.result); r.readAsDataURL(file);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image(); img.src = e.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img; const MAX = 1200;
          if (width > height && width > MAX) { height *= MAX / width; width = MAX; }
          else if (height > MAX) { width *= MAX / height; height = MAX; }
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/jpeg' : file.type, 0.7));
        };
      };
      reader.readAsDataURL(file);
    });
  };

  const [selectedMedia, setSelectedMedia] = useState(null); // for sending media
  const [onlineUsers, setOnlineUsers] = useState({}); // track online status: { userId: isOnline }
  const [typingUser, setTypingUser] = useState(null); // typing state ID
  const [replyingTo, setReplyingTo] = useState(null);
  const typingTimeoutRef = useRef(null);
  const messagesEndRef = useRef(null);
  const mediaFileRef = useRef();
  const groupFileRef = useRef();

  useEffect(() => {
    axios.get("http://localhost:5000/api/users")
      .then(res => setUsers(res.data.filter(u => u._id !== localUser._id)));
    axios.get(`http://localhost:5000/api/groups/${localUser._id}`)
      .then(res => setGroups(res.data.map(g => ({ ...g, isGroup: true, username: g.name }))))
      .catch(err => console.error("failed to load groups", err));
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

  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // listen for new messages from socket; clean up on unmount to avoid duplicates
  useEffect(() => {
    const handler = (data) => {
      const currentSelected = selectedRef.current;
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
      if (data.isGroup) {
        if (data.to !== currentSelected?._id && data.from !== user._id) {
          setUnreadCounts(prev => ({ ...prev, [data.to]: (prev[data.to] || 0) + 1 }));
        }
      } else {
        if (data.to === user._id && data.from !== currentSelected?._id) {
          setUnreadCounts(prev => ({ ...prev, [data.from]: (prev[data.from] || 0) + 1 }));
        }
      }

      // always emit markSeen for incoming dm messages
      if (!data.isGroup && data.to === user._id && data.from === currentSelected?._id) {
        socket.emit('markSeen', data._id);
      }
    };

    const backgroundHandler = (data) => {
      const currentSelected = selectedRef.current;
      if (data.isGroup) {
        if (data.to !== currentSelected?._id && data.from !== user._id) {
          setUnreadCounts(prev => ({ ...prev, [data.to]: (prev[data.to] || 0) + 1 }));
        }
      } else {
        if (data.from !== currentSelected?._id) {
          setUnreadCounts(prev => ({ ...prev, [data.from]: (prev[data.from] || 0) + 1 }));
        }
      }
    };

    const seenHandler = (msgId) => {
      setMessages(prev => prev.map(m => m._id === msgId ? { ...m, seen: true } : m));
    };

    const allSeenHandler = ({ viewerId }) => {
      setMessages(prev => prev.map(m => m.to === viewerId ? { ...m, seen: true } : m));
    };

    socket.on("receiveMessage", handler);
    socket.on("backgroundMessage", backgroundHandler);
    socket.on("messageSeen", seenHandler);
    socket.on("allMessagesSeen", allSeenHandler);

    return () => {
      socket.off("receiveMessage", handler);
      socket.off("backgroundMessage", backgroundHandler);
      socket.off("messageSeen", seenHandler);
      socket.off("allMessagesSeen", allSeenHandler);
    };
  }, [user._id]);

  // fetch history and join socket room when a user is selected
  const openChat = async (u) => {
    setSelected(u);
    setMessages([]); // reset while loading
    setReplyingTo(null);
    // clear unread count for this user
    setUnreadCounts(prev => ({ ...prev, [u._id]: 0 }));

    // load previous conversation from server
    try {
      const qs = u.isGroup ? '?isGroup=true' : '';
      const res = await axios.get(`http://localhost:5000/api/messages/${user._id}/${u._id}${qs}`);
      setMessages(res.data);
    } catch (err) {
      console.error("failed to load messages", err);
    }

    if (!u.isGroup) {
      // mark existing incoming messages as seen
      try {
        await axios.post("http://localhost:5000/api/messages/seen", {
          userId: user._id,
          otherId: u._id,
        });
        setMessages(prev => prev.map(m => m.to === user._id ? { ...m, seen: true } : m));
      } catch (e) { console.error("failed to mark seen", e); }
      socket.emit("joinRoom", { userId: user._id, otherUserId: u._id });
      socket.emit("markAllSeen", { userId: user._id, otherUserId: u._id });
    } else {
      socket.emit("joinGroup", u._id);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || newGroupMembers.length === 0) {
      alert("Please provide a name and select at least one member.");
      return;
    }
    try {
      const res = await axios.post("http://localhost:5000/api/groups", {
        name: newGroupName,
        members: [...newGroupMembers, localUser._id],
        admin: localUser._id
      });
      const newGroup = { ...res.data, isGroup: true, username: res.data.name };
      setGroups(prev => [...prev, newGroup]);
      setShowGroupModal(false);
      setNewGroupName("");
      setNewGroupMembers([]);
      socket.emit("joinGroup", newGroup._id);
    } catch (e) {
      console.error(e);
      alert("Failed to create group");
    }
  };

  // avatar upload
  const fileRef = useRef();
  const onAvatarClick = () => fileRef.current && fileRef.current.click();
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const dataUrl = await compressImage(f);
      const res = await axios.put(`http://localhost:5000/api/users/${localUser._id}/avatar`, { avatar: dataUrl });
      setLocalUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
    } catch (err) {
      console.error('avatar upload failed', err);
    }
    e.target.value = null;
  };

  const onGroupAvatarClick = () => selected?.isGroup && groupFileRef.current && groupFileRef.current.click();
  const onGroupFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const dataUrl = await compressImage(f);
      const res = await axios.put(`http://localhost:5000/api/groups/${selected._id}/avatar`, { avatar: dataUrl });
      const updatedGroup = { ...res.data, isGroup: true, username: res.data.name };
      setGroups(prev => prev.map(g => g._id === updatedGroup._id ? updatedGroup : g));
      setSelected(updatedGroup);
    } catch (err) {
      console.error('group avatar upload failed', err);
    }
    e.target.value = null;
  };

  const send = () => {
    if (!msg.trim() && !selectedMedia) return;
    if (!selected) return;

    const payload = { from: user._id, to: selected._id, message: msg };
    if (selected.isGroup) {
      payload.isGroup = true;
    }
    if (selectedMedia) {
      payload.media = selectedMedia;
    }
    if (replyingTo) {
      payload.replyTo = replyingTo._id;
    }
    
    // optimistic update so UI feels snappy (no _id yet)
    const optimisticMsg = { ...payload, room: selected.isGroup ? selected._id : room(user._id, selected._id), seen: false, createdAt: new Date().toISOString() };
    if (replyingTo) {
      optimisticMsg.replyTo = replyingTo;
    }
    setMessages(prev => [...prev, optimisticMsg]);
    
    socket.emit("sendMessage", payload);
    setMsg("");
    setSelectedMedia(null);
    setReplyingTo(null);
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
    const dataUrl = await compressImage(f);
    setSelectedMedia({
      data: dataUrl.split(',')[1],
      type: f.type,
      name: f.name
    });
    e.target.value = null;
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
          <div className="avatar editable-avatar" onClick={onAvatarClick} style={{ cursor: 'pointer' }} title="Change Profile Avatar">
            {localUser.avatar ? <img src={localUser.avatar} alt="avatar" /> : initials}
            <div className="edit-overlay">✎</div>
          </div>
          <div className="user-name">{displayName}</div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
          <button className="logout-btn" onClick={logout}>Logout</button>
        </div>

        <div className="sidebar-actions">
          <h3>Chats & Groups</h3>
          <button className="create-group-btn" onClick={() => setShowGroupModal(true)} title="Create Group">+</button>
        </div>

        <div className="users-list">
          {[...groups, ...users].map(u => {
            const unread = unreadCounts[u._id] || 0;
            const isOnline = !u.isGroup && (onlineUsers[u._id] || false);
            return (
              <div key={u._id} className="user-item" onClick={() => openChat(u)}>
                <div style={{ position: 'relative' }}>
                  <div className="user-avatar" style={u.isGroup ? { borderRadius: '8px' } : {}}>
                    {u.avatar ? <img src={u.avatar} alt="u" style={u.isGroup ? { borderRadius: '8px' } : {}} /> : (u.username || 'U').slice(0, 1).toUpperCase()}
                  </div>
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
              <div 
                className={`other-avatar ${selected.isGroup ? 'editable-avatar' : ''}`} 
                style={selected.isGroup ? { borderRadius: '8px', cursor: 'pointer' } : {}}
                onClick={onGroupAvatarClick}
                title={selected.isGroup ? "Change Group Icon" : ""}
              >
                {selected.avatar ? <img src={selected.avatar} alt="u" style={{ borderRadius: 'inherit' }} /> : (selected.username || 'U').slice(0, 1).toUpperCase()}
                {selected.isGroup && <div className="edit-overlay">✎</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontWeight: 700 }}>{selected.username || 'user1'}</div>
                {selected.isGroup && selected.members && (
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {selected.members.map(m => m.username).join(', ')}
                  </div>
                )}
              </div>
            </div>
            <div className="messages">
              {messages
                .filter(m => selected.isGroup ? m.room === selected._id : ((m.room && m.room === room(user._id, selected._id)) || room(m.from, m.to) === room(user._id, selected._id)))
                .map((m, i, arr) => {
                  const timeStr = formatTime(m.createdAt || new Date());
                  let showName = false;
                  let showTime = false;
                  
                  if (i === 0) {
                    showName = selected.isGroup && m.from !== user._id;
                    showTime = true;
                  } else {
                    const prev = arr[i - 1];
                    const prevTimeStr = formatTime(prev.createdAt || new Date());
                    if (prev.from !== m.from) {
                      showName = selected.isGroup && m.from !== user._id;
                      showTime = true;
                    } else if (timeStr !== prevTimeStr) {
                      showTime = true; // same sender, different minute
                    }
                  }

                  return (
                    <div key={m._id || i} className={`message ${m.from === user._id ? 'sent' : 'received'}`}>
                      {m.from === user._id && (
                        <button className="reply-btn" onClick={() => setReplyingTo(m)} title="Reply">↩️</button>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: m.from === user._id ? 'flex-end' : 'flex-start', maxWidth: '75%' }}>
                        {showTime && (
                          <div style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: m.from === user._id ? '0' : '12px', marginRight: m.from === user._id ? '12px' : '0', marginBottom: '4px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {showName && <span>{users.find(u => u._id === m.from)?.username || 'User'}</span>}
                            {showName && <span>•</span>}
                            <span>{timeStr}</span>
                          </div>
                        )}
                        <div className={`bubble ${m.from === user._id ? 'sent' : 'received'}`} style={{ maxWidth: '100%' }}>
                    {/* Inline Replied Snippet */}
                    {m.replyTo && (
                      <div className="replied-snippet">
                        <div className="replied-from">
                          {m.replyTo.from === user._id ? 'You' : (users.find(u => u._id === m.replyTo.from)?.username || selected?.username || 'User')}
                        </div>
                        <div className="replied-text">
                            {m.replyTo.message ? m.replyTo.message : (m.replyTo.media ? 'Attachment' : '')}
                          </div>
                        </div>
                      )}
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
                  {m.from !== user._id && (
                    <button className="reply-btn" onClick={() => setReplyingTo(m)} title="Reply">↩️</button>
                  )}
                </div>
              );
            })}
              {typingUser === selected._id && (
                <div className="typing-indicator" style={{ color: '#6ee7b7', fontSize: '12px', padding: '10px', fontStyle: 'italic', animation: 'fadeInUp 0.3s forwards' }}>
                  {selected.username || 'user'} is typing...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="input-area" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              {replyingTo && (
            <div className="replying-indicator">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600, marginBottom: '2px' }}>
                  Replying to {replyingTo.from === user._id ? 'yourself' : (users.find(u => u._id === replyingTo.from)?.username || selected?.username || 'User')}
                </div>
                <span>{replyingTo.message ? replyingTo.message : (replyingTo.media ? 'Attachment' : '')}</span>
              </div>
                  <button className="close-reply" onClick={() => setReplyingTo(null)}>✖</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', width: '100%', alignItems: 'flex-end' }}>
                <textarea value={msg} onChange={handleTyping} onKeyDown={onKeyDown} placeholder="Type a message..." />
                <button className="media-btn" onClick={onMediaBtnClick} title="Send media">📎</button>
                <input ref={mediaFileRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt" style={{ display: 'none' }} onChange={onMediaFile} />
                {selectedMedia && <div className="media-preview">📤 {selectedMedia.name}</div>}
                <button className="send-button" onClick={send}>Send</button>
              </div>
            </div>
            <input ref={groupFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onGroupFile} />
          </>
        ) : (
          <div style={{ color: '#94a3b8', padding: 20 }}>Select a user to start chatting</div>
        )}
      </div>

      {showGroupModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Create Group</h2>
            <input 
              type="text" 
              placeholder="Group Name" 
              value={newGroupName} 
              onChange={e => setNewGroupName(e.target.value)} 
            />
            <div className="modal-users-list">
              {users.map(u => {
                const isSelected = newGroupMembers.includes(u._id);
                return (
                  <div 
                    key={u._id} 
                    className={`modal-user-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      if (isSelected) setNewGroupMembers(prev => prev.filter(id => id !== u._id));
                      else setNewGroupMembers(prev => [...prev, u._id]);
                    }}
                  >
                    <div className="user-avatar" style={{ transform: 'scale(0.8)', marginRight: '10px' }}>
                      {u.avatar ? <img src={u.avatar} alt="u" /> : (u.username || 'U').slice(0, 1).toUpperCase()}
                    </div>
                    {u.username || 'user1'}
                  </div>
                )
              })}
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowGroupModal(false)}>Cancel</button>
              <button className="modal-btn submit" onClick={handleCreateGroup}>Create</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
export default Chat;
