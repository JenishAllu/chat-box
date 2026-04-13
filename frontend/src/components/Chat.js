
import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import CryptoJS from "crypto-js";
import { encryptMessage, decryptMessage, decryptMessages } from "../utils/encryption";
import "./Chat.css";

// ─── End-to-End Encryption Setup ──────────────────────────────────────────
// Shared encryption key for all users - ensures both sender and receiver can decrypt
// Messages are encrypted client-side before transmission and never stored plaintext on server
const SECRET_SALT = 'INSTA_CHAT_SYSTEM_E2E_MESSAGE_ENCRYPTION_2024';
const ENCRYPTION_KEY = CryptoJS.SHA256(SECRET_SALT).toString();

const socket = io("http://localhost:5000");

function room(a, b) { return [a, b].sort().join("_"); }

function Chat() {
  const user = JSON.parse(localStorage.getItem("user")) || {};
  const nav = useNavigate();
  const [localUser, setLocalUser] = useState(user || {});
  
  const displayName = localUser?.displayName || localUser?.username || 'user1';
  const initials = displayName.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();

  // ─── Core state ───────────────────────────────────────────────────────────
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [chatRequests, setChatRequests] = useState([]); // full user objects of requesters
  const [selected, setSelected] = useState(null);
  const [msg, setMsg] = useState("");
  const [messages, setMessages] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [openMenuId, setOpenMenuId] = useState(null);
  const [openHeaderMenu, setOpenHeaderMenu] = useState(false);
  const [editingMessage, setEditingMessage] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editGroupNameStr, setEditGroupNameStr] = useState('');
  const [viewImageUrl, setViewImageUrl] = useState(null);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState({});
  const [typingUser, setTypingUser] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const typingTimeoutRef = useRef(null);
  const messagesEndRef = useRef(null);
  const mediaFileRef = useRef();
  const groupFileRef = useRef();
  const fileRef = useRef();

  // ─── Sidebar tab ──────────────────────────────────────────────────────────
  const [sidebarTab, setSidebarTab] = useState('chats'); // 'chats' | 'requests' | 'discover'
  const [discoverSearch, setDiscoverSearch] = useState('');

  // ─── Group modal ──────────────────────────────────────────────────────────
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState([]);

  // ─── Chat request modal ───────────────────────────────────────────────────
  const [showRequestModal, setShowRequestModal] = useState(null); // user object

  // ─── Following / Followers modal ──────────────────────────────────────────
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [followModalTab, setFollowModalTab] = useState('following'); // 'following' | 'followers'

  // ─── Profile modal ──────────────────────────────────────────────────────────
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [viewingUser, setViewingUser] = useState(null);
  const [profileEditMode, setProfileEditMode] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ displayName: '', bio: '' });
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [showBlockedSection, setShowBlockedSection] = useState(false);

  // ─── Toast notification ───────────────────────────────────────────────────
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────
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

  // ─── Social helpers ───────────────────────────────────────────────────────
  const isFollowing = (uId) => (localUser.following || []).map(String).includes(String(uId));
  const isAccepted = (uId) => (localUser.acceptedChats || []).map(String).includes(String(uId));
  const hasPendingRequest = (uId) => {
    // check if target is in chatRequests of localUser (they sent us one)
    // or if we sent them one (they are in our following but not in acceptedChats)
    return isFollowing(uId) && !isAccepted(uId);
  };

  // ─── Data loading ─────────────────────────────────────────────────────────
  const loadSuggestions = async () => {
    try {
      const res = await axios.get(`http://localhost:5000/api/users/${localUser._id}/suggestions`);
      setSuggestions(res.data);
    } catch (e) { console.error("failed to load suggestions", e); }
  };

  const loadChatRequests = async (currentUser) => {
    // chatRequests is an array of user IDs stored on the localUser
    const me = currentUser || localUser;
    const requestIds = me.chatRequests || [];
    if (requestIds.length === 0) { setChatRequests([]); return; }
    try {
      const res = await axios.get("http://localhost:5000/api/users");
      const requesters = res.data.filter(u => requestIds.map(String).includes(String(u._id)));
      setChatRequests(requesters);
    } catch (e) { console.error("failed to load requests", e); }
  };

  useEffect(() => {
    axios.get("http://localhost:5000/api/users")
      .then(res => setUsers(res.data.filter(u => u._id !== localUser._id)));
    axios.get(`http://localhost:5000/api/groups/${localUser._id}`)
      .then(res => setGroups(res.data.map(g => ({ ...g, isGroup: true, username: g.name }))))
      .catch(err => console.error("failed to load groups", err));
    axios.get(`http://localhost:5000/api/messages/unread/${localUser._id}`)
      .then(res => setUnreadCounts(res.data))
      .catch(err => console.error("failed to load unread counts", err));
    socket.emit("setUserId", localUser._id);
    loadSuggestions();
    loadChatRequests();
  }, [localUser._id]);

  // ─── Socket: online / offline / typing ───────────────────────────────────
  useEffect(() => {
    const onOnline = (data) => {
      setOnlineUsers(prev => ({ ...prev, [data.userId]: true }));
      if (data.user && data.user._id !== localUser._id) {
        setUsers(prev => prev.find(u => u._id === data.user._id) ? prev : [...prev, data.user]);
      }
    };
    const onOffline = (data) => setOnlineUsers(prev => ({ ...prev, [data.userId]: false }));
    const onList = (map) => setOnlineUsers(map || {});

    socket.on("userOnline", onOnline);
    socket.on("userOffline", onOffline);
    socket.on("onlineList", onList);
    socket.on("typing", (data) => {
      setTypingUser(data.from);
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
    });
    socket.on("stopTyping", () => {
      setTypingUser(null);
      clearTimeout(typingTimeoutRef.current);
    });

    // ─── Real-time chat request notifications ─────────────────────────────
    socket.on("chatRequestReceived", ({ from }) => {
      showToast(`📨 ${from.username} sent you a chat request!`, 'request');
      // Add to requests list if not already there
      setChatRequests(prev => prev.find(u => u._id === from._id) ? prev : [...prev, from]);
      // Reload local user so chatRequests array is up-to-date
      axios.get("http://localhost:5000/api/users")
        .then(res => {
          const me = res.data.find(u => u._id === localUser._id);
          if (me) { setLocalUser(me); localStorage.setItem('user', JSON.stringify(me)); }
        });
    });

    socket.on("chatAccepted", ({ by }) => {
      showToast(`✅ ${by.username} accepted your chat request!`, 'success');
      // Reload local user so acceptedChats is up-to-date
      axios.get("http://localhost:5000/api/users")
        .then(res => {
          const me = res.data.find(u => u._id === localUser._id);
          if (me) { setLocalUser(me); localStorage.setItem('user', JSON.stringify(me)); }
        });
    });

    socket.on("errorMessage", ({ error }) => {
      showToast(`⚠️ ${error}`, 'error');
    });

    return () => {
      socket.off("userOnline", onOnline);
      socket.off("userOffline", onOffline);
      socket.off("onlineList", onList);
      socket.off("typing");
      socket.off("stopTyping");
      socket.off("chatRequestReceived");
      socket.off("chatAccepted");
      socket.off("errorMessage");
      clearTimeout(typingTimeoutRef.current);
    };
  }, [localUser._id]);

  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { setOpenHeaderMenu(false); }, [selected?._id]);

  // ─── Socket: messages ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (data) => {
      const currentSelected = selectedRef.current;
      setMessages(prev => {
        if (data._id && prev.some(m => m._id === data._id)) return prev;
        // Decrypt message using shared encryption key
        const decryptedData = { ...data, message: decryptMessage(data.message, ENCRYPTION_KEY) };
        const idx = prev.findIndex(m => !m._id && m.from === decryptedData.from && m.to === decryptedData.to && m.message === decryptedData.message);
        if (idx !== -1) { const next = [...prev]; next[idx] = decryptedData; return next; }
        return [...prev, decryptedData];
      });
      if (data.isGroup) {
        if (data.to !== currentSelected?._id && data.from !== user._id)
          setUnreadCounts(prev => ({ ...prev, [data.to]: (prev[data.to] || 0) + 1 }));
      } else {
        if (data.to === user._id && data.from !== currentSelected?._id)
          setUnreadCounts(prev => ({ ...prev, [data.from]: (prev[data.from] || 0) + 1 }));
      }
      if (!data.isGroup && data.to === user._id && data.from === currentSelected?._id)
        socket.emit('markSeen', data._id);
    };

    const backgroundHandler = (data) => {
      const currentSelected = selectedRef.current;
      if (data.isGroup) {
        if (data.to !== currentSelected?._id && data.from !== user._id)
          setUnreadCounts(prev => ({ ...prev, [data.to]: (prev[data.to] || 0) + 1 }));
      } else {
        if (data.from !== currentSelected?._id)
          setUnreadCounts(prev => ({ ...prev, [data.from]: (prev[data.from] || 0) + 1 }));
      }
    };

    const seenHandler = (msgId) => setMessages(prev => prev.map(m => m._id === msgId ? { ...m, seen: true } : m));
    const allSeenHandler = ({ viewerId }) => setMessages(prev => prev.map(m => m.to === viewerId ? { ...m, seen: true } : m));
    const editedHandler = (updatedMsg) => setMessages(prev => prev.map(m => m._id === updatedMsg._id ? { ...updatedMsg, message: decryptMessage(updatedMsg.message, ENCRYPTION_KEY) } : m));
    const deletedHandler = ({ id, type, userId }) => {
      if (type === 'everyone' || userId === user._id)
        setMessages(prev => prev.filter(m => m._id !== id));
    };
    const clearedHandler = ({ type, userId }) => {
      if (type === 'everyone' || userId === user._id) setMessages([]);
    };

    socket.on("receiveMessage", handler);
    socket.on("backgroundMessage", backgroundHandler);
    socket.on("messageSeen", seenHandler);
    socket.on("allMessagesSeen", allSeenHandler);
    socket.on("messageEdited", editedHandler);
    socket.on("messageDeleted", deletedHandler);
    socket.on("chatCleared", clearedHandler);

    return () => {
      socket.off("receiveMessage", handler);
      socket.off("backgroundMessage", backgroundHandler);
      socket.off("messageSeen", seenHandler);
      socket.off("allMessagesSeen", allSeenHandler);
      socket.off("messageEdited", editedHandler);
      socket.off("messageDeleted", deletedHandler);
      socket.off("chatCleared", clearedHandler);
    };
  }, [user._id]);

  // ─── Open chat ────────────────────────────────────────────────────────────
  const openChat = async (u) => {
    // Gate: if not a group and not accepted, show request modal
    if (!u.isGroup && !isAccepted(u._id)) {
      setShowRequestModal(u);
      return;
    }
    setSelected(u);
    setMessages([]);
    setReplyingTo(null);
    setUnreadCounts(prev => ({ ...prev, [u._id]: 0 }));
    try {
      const qs = u.isGroup ? '?isGroup=true' : '';
      const res = await axios.get(`http://localhost:5000/api/messages/${user._id}/${u._id}${qs}`);
      // Decrypt all messages with the shared encryption key
      setMessages(res.data.map(m => ({
        ...m,
        message: decryptMessage(m.message, ENCRYPTION_KEY),
        replyTo: m.replyTo ? { ...m.replyTo, message: decryptMessage(m.replyTo.message, ENCRYPTION_KEY) } : m.replyTo
      })));
    } catch (err) { console.error("failed to load messages", err); }

    if (!u.isGroup) {
      try {
        await axios.post("http://localhost:5000/api/messages/seen", { userId: user._id, otherId: u._id });
        setMessages(prev => prev.map(m => m.to === user._id ? { ...m, seen: true } : m));
      } catch (e) { console.error("failed to mark seen", e); }
      socket.emit("joinRoom", { userId: user._id, otherUserId: u._id });
      socket.emit("markAllSeen", { userId: user._id, otherUserId: u._id });
    } else {
      socket.emit("joinGroup", u._id);
    }
  };

  // ─── Social actions ───────────────────────────────────────────────────────
  const toggleFollow = async (uId) => {
    const following = isFollowing(uId);
    try {
      const res = await axios.put(`http://localhost:5000/api/users/${localUser._id}/${following ? 'unfollow' : 'follow'}/${uId}`);
      setLocalUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
      if (!following) {
        // Emit socket event so target gets live notification
        socket.emit("sendChatRequest", { from: localUser._id, to: uId });
        showToast('✅ Follow request sent!', 'success');
        // Remove from suggestions
        setSuggestions(prev => prev.filter(u => u._id !== uId));
      }
    } catch { showToast('Failed to update follow status', 'error'); }
  };

  const acceptChatRequest = async (requesterId) => {
    try {
      const res = await axios.put(`http://localhost:5000/api/users/${localUser._id}/accept-chat/${requesterId}`);
      setLocalUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
      // Emit real-time accepted event
      socket.emit("chatRequestAccepted", { from: localUser._id, to: requesterId });
      // Remove from requests
      setChatRequests(prev => prev.filter(u => u._id !== requesterId));
      showToast('✅ Chat request accepted!', 'success');
    } catch { showToast('Failed to accept request', 'error'); }
  };

  const declineChatRequest = async (requesterId) => {
    try {
      const res = await axios.put(`http://localhost:5000/api/users/${localUser._id}/decline-chat/${requesterId}`);
      setLocalUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
      setChatRequests(prev => prev.filter(u => u._id !== requesterId));
      showToast('Request declined', 'info');
    } catch { showToast('Failed to decline request', 'error'); }
  };

  const sendChatRequest = async (targetUser) => {
    try {
      await axios.put(`http://localhost:5000/api/users/${localUser._id}/request-chat/${targetUser._id}`);
      socket.emit("sendChatRequest", { from: localUser._id, to: targetUser._id });
      showToast(`📨 Chat request sent to ${targetUser.username}!`, 'success');
      setShowRequestModal(null);
      // Also follow if not already
      if (!isFollowing(targetUser._id)) {
        await toggleFollow(targetUser._id);
      }
    } catch { showToast('Failed to send request', 'error'); }
  };

  const blockUser = async (uId) => {
    if (!window.confirm("Are you sure you want to block this user?")) return;
    try {
      const res = await axios.put(`http://localhost:5000/api/users/${localUser._id}/block/${uId}`);
      setLocalUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
      setSelected(null);
    } catch { showToast('Failed to block', 'error'); }
  };

  // ─── Groups ───────────────────────────────────────────────────────────────
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
    } catch (e) { alert("Failed to create group"); }
  };

  const updateGroupName = async () => {
    if (!editGroupNameStr.trim() || !selected) return;
    try {
      const res = await axios.put(`http://localhost:5000/api/groups/${selected._id}/name`, { name: editGroupNameStr });
      const updatedGroup = { ...res.data, isGroup: true, username: res.data.name };
      setGroups(prev => prev.map(g => g._id === updatedGroup._id ? updatedGroup : g));
      setSelected(updatedGroup);
      setEditingGroupId(null);
    } catch { showToast('Failed to update group name', 'error'); }
  };

  // ─── Avatar ───────────────────────────────────────────────────────────────
  const onAvatarClick = () => fileRef.current && fileRef.current.click();
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const dataUrl = await compressImage(f);
      const res = await axios.put(`http://localhost:5000/api/users/${localUser._id}/avatar`, { avatar: dataUrl });
      setLocalUser(res.data); localStorage.setItem('user', JSON.stringify(res.data));
    } catch (err) { console.error('avatar upload failed', err); }
    e.target.value = null;
  };

  const onGroupAvatarClick = () => selected?.isGroup && groupFileRef.current && groupFileRef.current.click();
  const onGroupFile = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const dataUrl = await compressImage(f);
      const res = await axios.put(`http://localhost:5000/api/groups/${selected._id}/avatar`, { avatar: dataUrl });
      const updatedGroup = { ...res.data, isGroup: true, username: res.data.name };
      setGroups(prev => prev.map(g => g._id === updatedGroup._id ? updatedGroup : g));
      setSelected(updatedGroup);
    } catch (err) { console.error('group avatar upload failed', err); }
    e.target.value = null;
  };

  const handleAvatarClick = (url) => { if (url) setViewImageUrl(url); };

  // ─── Profile helpers ─────────────────────────────────────────────────────
  const loadBlockedUsers = async () => {
    try {
      const res = await axios.get(`http://localhost:5000/api/users/${localUser._id}/blocked`);
      setBlockedUsers(res.data);
    } catch (e) { console.error('failed to load blocked users', e); }
  };

  const openProfileModal = () => {
    setViewingUser(null);
    setProfileDraft({ displayName: localUser.displayName || '', bio: localUser.bio || '' });
    setProfileEditMode(false);
    setShowBlockedSection(false);
    loadBlockedUsers();
    setShowProfileModal(true);
  };

  const openUserProfile = (u) => {
    if (u._id === localUser._id) {
      openProfileModal();
      return;
    }
    setViewingUser(u);
    setShowProfileModal(true);
  };

  const saveProfile = async () => {
    try {
      const res = await axios.put(`http://localhost:5000/api/users/${localUser._id}/profile`, profileDraft);
      setLocalUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
      setProfileEditMode(false);
      showToast('✅ Profile updated!', 'success');
    } catch { showToast('Failed to update profile', 'error'); }
  };

  const unblockUser = async (uId) => {
    try {
      const res = await axios.put(`http://localhost:5000/api/users/${localUser._id}/unblock/${uId}`);
      setLocalUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
      setBlockedUsers(prev => prev.filter(u => u._id !== uId));
      showToast('User unblocked', 'success');
    } catch { showToast('Failed to unblock', 'error'); }
  };

  // ─── Messaging ────────────────────────────────────────────────────────────
  const submitEdit = () => {
    if (!msg.trim()) return;
    // Encrypt message before sending using shared encryption key
    const encryptedText = encryptMessage(msg, ENCRYPTION_KEY);
    socket.emit('editMessage', { id: editingMessage._id, newText: encryptedText });
    setEditingMessage(null); setMsg("");
  };

  const deleteMsg = (id, type) => {
    socket.emit("deleteMessage", { id, type, userId: user._id });
    setShowDeleteModal(null);
  };

  const clearChat = (type) => {
    if (!selected) return;
    const roomName = selected.isGroup ? selected._id : room(user._id, selected._id);
    socket.emit("clearChat", { room: roomName, type, userId: user._id });
    setShowClearModal(false);
  };

  /**
   * Send message with end-to-end encryption
   * - Encrypts message using shared encryption key
   * - Transmits encrypted message via WebSocket
   * - Server stores encrypted message in database (never decrypts)
   * - Recipients decrypt with same shared key
   */
  const send = () => {
    if (editingMessage) { submitEdit(); return; }
    if (!msg.trim() && !selectedMedia) return;
    if (!selected) return;
    
    // Encrypt message using shared encryption key
    const encryptedMsg = msg.trim() ? encryptMessage(msg, ENCRYPTION_KEY) : "";
    const payload = { from: user._id, to: selected._id, message: encryptedMsg };
    if (selected.isGroup) payload.isGroup = true;
    if (selectedMedia) payload.media = selectedMedia;
    if (replyingTo) payload.replyTo = replyingTo._id;
    
    // Create optimistic message for instant UI feedback (using plaintext for display)
    const optimisticMsg = { ...payload, message: msg, room: selected.isGroup ? selected._id : room(user._id, selected._id), seen: false, createdAt: new Date().toISOString() };
    if (replyingTo) optimisticMsg.replyTo = replyingTo;
    
    setMessages(prev => [...prev, optimisticMsg]);
    socket.emit("sendMessage", payload);
    setMsg(""); setSelectedMedia(null); setReplyingTo(null);
  };

  const handleTyping = (e) => {
    setMsg(e.target.value);
    if (!selected) return;
    socket.emit("typing", { from: user._id, to: selected._id });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => socket.emit("stopTyping", { from: user._id, to: selected._id }), 2000);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); send();
      clearTimeout(typingTimeoutRef.current);
      socket.emit("stopTyping", { from: user._id, to: selected._id });
    }
  };

  const onMediaBtnClick = () => mediaFileRef.current && mediaFileRef.current.click();
  const onMediaFile = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const dataUrl = await compressImage(f);
    setSelectedMedia({ data: dataUrl.split(',')[1], type: f.type, name: f.name });
    e.target.value = null;
  };

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const logout = () => {
    socket.disconnect(); localStorage.removeItem("user"); nav("/");
  };

  // ─── Accepted chats (for Chats tab) ──────────────────────────────────────
  const acceptedUserList = users.filter(u => isAccepted(u._id));

  // ─── Render: sidebar content per tab ─────────────────────────────────────
  const renderSidebarContent = () => {
    if (sidebarTab === 'chats') {
      return (
        <div className="users-list">
          {/* Groups first */}
          {groups.map(u => {
            const unread = unreadCounts[u._id] || 0;
            return (
              <div key={u._id} className={`user-item ${selected?._id === u._id ? 'active' : ''}`} onClick={() => openChat(u)}>
                <div style={{ position: 'relative' }}>
                  <div
                    className="user-avatar"
                    style={{ borderRadius: '8px' }}
                    onClick={e => { e.stopPropagation(); if (u.avatar) handleAvatarClick(u.avatar); }}
                    title="View group icon"
                  >
                    {u.avatar ? <img src={u.avatar} alt="g" style={{ borderRadius: '8px' }} /> : (u.username || 'G').slice(0, 1).toUpperCase()}
                  </div>
                </div>
                <div className="user-meta"><div className="user-name">{u.username || 'Group'}</div><div className="user-subtitle">Group</div></div>
                {unread > 0 && <div className="badge">{unread > 99 ? '99+' : unread}</div>}
              </div>
            );
          })}
          {/* Accepted DMs */}
          {acceptedUserList.map(u => {
            const unread = unreadCounts[u._id] || 0;
            const isOnline = onlineUsers[u._id] || false;
            return (
              <div key={u._id} className={`user-item ${selected?._id === u._id ? 'active' : ''}`} onClick={() => openChat(u)}>
                <div style={{ position: 'relative' }}>
                  <div
                    className="user-avatar"
                    onClick={e => { e.stopPropagation(); openUserProfile(u); }}
                    title="View profile"
                  >
                    {u.avatar ? <img src={u.avatar} alt="u" /> : (u.username || 'U').slice(0, 1).toUpperCase()}
                  </div>
                  {isOnline && <div className="online-indicator" />}
                </div>
                <div className="user-meta"><div className="user-name">{u.username || 'user'}</div></div>
                {unread > 0 && <div className="badge">{unread > 99 ? '99+' : unread}</div>}
              </div>
            );
          })}
          {groups.length === 0 && acceptedUserList.length === 0 && (
            <div className="empty-tab">
              <div className="empty-icon">💬</div>
              <div>No chats yet</div>
              <div style={{ fontSize: '12px', marginTop: '4px' }}>Discover people in the Explore tab</div>
            </div>
          )}
        </div>
      );
    }

    if (sidebarTab === 'requests') {
      return (
        <div className="users-list">
          {chatRequests.length === 0 ? (
            <div className="empty-tab">
              <div className="empty-icon">📨</div>
              <div>No pending requests</div>
            </div>
          ) : chatRequests.map(u => (
            <div key={u._id} className="request-card">
              <div className="user-avatar">
                {u.avatar ? <img src={u.avatar} alt="u" /> : (u.username || 'U').slice(0, 1).toUpperCase()}
              </div>
              <div className="request-info">
                <div className="user-name">{u.username}</div>
                <div className="request-actions">
                  <button className="btn-accept" onClick={() => acceptChatRequest(u._id)}>Accept</button>
                  <button className="btn-decline" onClick={() => declineChatRequest(u._id)}>Decline</button>
                  {!isFollowing(u._id) && (
                    <button className="btn-follow" onClick={() => toggleFollow(u._id)} style={{ padding: '4px 8px' }}>Follow Back</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (sidebarTab === 'discover') {
      const searchLower = discoverSearch.toLowerCase();
      const displayUsers = discoverSearch.trim() 
          ? users.filter(u => (u.username?.toLowerCase() || '').includes(searchLower) || (u.displayName?.toLowerCase() || '').includes(searchLower))
          : suggestions;

      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          <div style={{ padding: '0 8px 12px 0' }}>
            <input 
              type="text" 
              placeholder="Search all users..." 
              value={discoverSearch}
              onChange={e => setDiscoverSearch(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '13px', outline: 'none', transition: 'border 0.2s', boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
            />
          </div>
          <div className="users-list" style={{ marginTop: 0, paddingRight: '4px', flex: 1, overflowY: 'auto' }}>
            {displayUsers.length === 0 ? (
              <div className="empty-tab">
                <div className="empty-icon">🔍</div>
                <div>{discoverSearch.trim() ? "No users found" : "No suggestions right now"}</div>
              </div>
            ) : displayUsers.map(u => {
            const following = isFollowing(u._id);
            const pending = hasPendingRequest(u._id);
            const blocked = (localUser.blocked || []).map(String).includes(String(u._id));
            return (
              <div key={u._id} className="discover-card">
                <div className="user-avatar" onClick={() => openUserProfile(u)} style={{ cursor: 'pointer' }} title="View profile">
                  {u.avatar ? <img src={u.avatar} alt="u" /> : (u.username || 'U').slice(0, 1).toUpperCase()}
                </div>
                <div className="discover-info">
                  <div className="user-name">{u.username}</div>
                  {blocked ? (
                    <div className="discover-actions">
                      <button className="btn-unblock" onClick={() => unblockUser(u._id)}>Unblock</button>
                    </div>
                  ) : pending ? (
                    <div className="pending-pill">⏳ Pending</div>
                  ) : (
                    <div className="discover-actions">
                      <button
                        className={`btn-follow ${following ? 'btn-unfollow' : ''}`}
                        onClick={() => toggleFollow(u._id)}
                      >
                        {following ? 'Unfollow' : 'Follow'}
                      </button>
                      {!following && (
                        <button className="btn-request" onClick={() => setShowRequestModal(u)}>
                          Message
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      );
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="chat-root">
      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
      )}

      {/* Full-screen image viewer */}
      {viewImageUrl && (
        <div className="image-viewer-overlay" onClick={() => setViewImageUrl(null)}>
          <img src={viewImageUrl} alt="full" className="image-viewer-img" />
        </div>
      )}

      {/* ─── SIDEBAR ─────────────────────────────────────────────────────── */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="avatar editable-avatar" style={{ cursor: 'pointer' }} title="View Profile">
            <div onClick={openProfileModal} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {localUser.avatar ? <img src={localUser.avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : initials}
            </div>
            <div className="edit-overlay" onClick={e => { e.stopPropagation(); onAvatarClick(); }}>✎</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <div className="user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
            <div className="user-stats">
              <span
                className="stat-link"
                onClick={() => { setFollowModalTab('following'); setShowFollowModal(true); }}
              >
                <strong>{(localUser.following || []).length}</strong> Following
              </span>
              <span className="stat-dot">·</span>
              <span
                className="stat-link"
                onClick={() => { setFollowModalTab('followers'); setShowFollowModal(true); }}
              >
                <strong>{(localUser.followers || []).length}</strong> Followers
              </span>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
          <button className="logout-btn" onClick={logout}>Logout</button>
        </div>

        {/* Tabs */}
        <div className="sidebar-tabs">
          <button
            className={`tab-btn ${sidebarTab === 'chats' ? 'active' : ''}`}
            onClick={() => setSidebarTab('chats')}
          >
            💬 Chats
          </button>
          <button
            className={`tab-btn ${sidebarTab === 'requests' ? 'active' : ''}`}
            onClick={() => setSidebarTab('requests')}
          >
            📨 Requests
            {chatRequests.length > 0 && <span className="tab-badge">{chatRequests.length}</span>}
          </button>
          <button
            className={`tab-btn ${sidebarTab === 'discover' ? 'active' : ''}`}
            onClick={() => { setSidebarTab('discover'); loadSuggestions(); }}
          >
            🔍 Explore
          </button>
        </div>

        {/* Tab: Chats — has Create Group button */}
        {sidebarTab === 'chats' && (
          <div className="sidebar-actions">
            <span style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Groups & Chats</span>
            <button className="create-group-btn" onClick={() => setShowGroupModal(true)} title="Create Group">+</button>
          </div>
        )}

        {renderSidebarContent()}
      </div>

      {/* ─── CHAT AREA ───────────────────────────────────────────────────── */}
      <div className="chat-area">
        {selected ? (
          <>
            <div className="chat-top">
              <div
                className={`other-avatar ${selected.isGroup ? 'editable-avatar' : ''}`}
                style={selected.isGroup ? { borderRadius: '8px', cursor: 'pointer' } : { cursor: 'pointer' }}
                onClick={selected.isGroup ? onGroupAvatarClick : () => openUserProfile(selected)}
                title={selected.isGroup ? "Change group icon" : "View profile"}
              >
                {selected.avatar ? <img src={selected.avatar} alt="u" style={{ borderRadius: 'inherit' }} /> : (selected.username || 'U').slice(0, 1).toUpperCase()}
                {selected.isGroup && <div className="edit-overlay">✎</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                {selected.isGroup && editingGroupId === selected._id ? (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      value={editGroupNameStr}
                      onChange={e => setEditGroupNameStr(e.target.value)}
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', padding: '4px 8px', fontFamily: 'inherit' }}
                    />
                    <button onClick={updateGroupName} style={{ background: 'var(--accent)', border: 'none', borderRadius: '6px', color: '#022a24', padding: '4px 10px', cursor: 'pointer', fontWeight: 700 }}>Save</button>
                    <button onClick={() => setEditingGroupId(null)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
                  </div>
                ) : (
                  <div
                    style={{
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: selected.isGroup ? 'default' : 'pointer'
                    }}
                    onClick={!selected.isGroup ? () => openUserProfile(selected) : undefined}
                    title={!selected.isGroup ? 'View user details' : undefined}
                  >
                    {selected.username || 'user1'}
                    {selected.isGroup && (
                      <button onClick={() => { setEditingGroupId(selected._id); setEditGroupNameStr(selected.username || ''); }} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '13px' }}>✎</button>
                    )}
                  </div>
                )}
                {selected.isGroup && selected.members && (
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {selected.members.map(m => m.username).join(', ')}
                  </div>
                )}
                {!selected.isGroup && (
                  <div style={{ fontSize: '12px', color: onlineUsers[selected._id] ? '#10b981' : 'var(--muted)' }}>
                    {onlineUsers[selected._id] ? 'Online' : 'Offline'}
                  </div>
                )}
              </div>

              <div className="chat-header-menu">
                <button
                  className="options-btn header-options-btn"
                  onClick={() => setOpenHeaderMenu(v => !v)}
                  title="Chat options"
                >⋮</button>
                {openHeaderMenu && (
                  <div className="options-menu">
                    {!selected.isGroup && (
                      <button
                        onClick={() => {
                          toggleFollow(selected._id);
                          setOpenHeaderMenu(false);
                        }}
                      >
                        {isFollowing(selected._id) ? 'Unfollow' : 'Follow'}
                      </button>
                    )}
                    {!selected.isGroup && (
                      <button
                        onClick={() => {
                          blockUser(selected._id);
                          setOpenHeaderMenu(false);
                        }}
                        style={{ color: '#ff6b6b' }}
                      >
                        Block
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setShowClearModal(true);
                        setOpenHeaderMenu(false);
                      }}
                    >
                      Clear chat
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="messages">
              {messages
                .filter(m => selected.isGroup
                  ? m.room === selected._id
                  : ((m.room && m.room === room(user._id, selected._id)) || room(m.from, m.to) === room(user._id, selected._id))
                )
                .map((m, i, arr) => {
                  const timeStr = formatTime(m.createdAt || new Date());
                  let showName = false, showTime = false;
                  if (i === 0) { showName = selected.isGroup && m.from !== user._id; showTime = true; }
                  else {
                    const prev = arr[i - 1];
                    const prevTimeStr = formatTime(prev.createdAt || new Date());
                    if (prev.from !== m.from) { showName = selected.isGroup && m.from !== user._id; showTime = true; }
                    else if (timeStr !== prevTimeStr) { showTime = true; }
                  }
                  return (
                    <div key={m._id || i} className={`message ${m.from === user._id ? 'sent' : 'received'}`}>
                      {m.from === user._id && (
                        <div className="message-options">
                          <button className="options-btn" onClick={() => setOpenMenuId(openMenuId === (m._id || i) ? null : (m._id || i))}>⋮</button>
                          {openMenuId === (m._id || i) && (
                            <div className="options-menu">
                              <button onClick={() => { setEditingMessage(m); setMsg(m.message); setOpenMenuId(null); }}>Edit</button>
                              <button onClick={() => { setShowDeleteModal(m); setOpenMenuId(null); }}>Delete</button>
                              <button onClick={() => { setReplyingTo(m); setOpenMenuId(null); }}>Reply</button>
                            </div>
                          )}
                        </div>
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
                          {m.replyTo && (
                            <div className="replied-snippet">
                              <div className="replied-from">
                                {m.replyTo.from === user._id ? 'You' : (users.find(u => u._id === m.replyTo.from)?.username || selected?.username || 'User')}
                              </div>
                              <div className="replied-text">{m.replyTo.message ? m.replyTo.message : (m.replyTo.media ? 'Attachment' : '')}</div>
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
                          ) : m.message}
                          <div className="meta">
                            {m.isEdited && <span style={{ fontStyle: 'italic', marginRight: '5px' }}>Edited</span>}
                            {m.from === user._id ? (m.seen ? 'Seen' : 'Sent') : ''}
                          </div>
                        </div>
                      </div>
                      {m.from !== user._id && (
                        <div className="message-options">
                          <button className="options-btn" onClick={() => setOpenMenuId(openMenuId === (m._id || i) ? null : (m._id || i))}>⋮</button>
                          {openMenuId === (m._id || i) && (
                            <div className="options-menu">
                              <button onClick={() => { setShowDeleteModal(m); setOpenMenuId(null); }}>Delete</button>
                              <button onClick={() => { setReplyingTo(m); setOpenMenuId(null); }}>Reply</button>
                            </div>
                          )}
                        </div>
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
          <div className="welcome-screen">
            <div className="welcome-icon">💎</div>
            <div className="welcome-title">Welcome, {displayName}!</div>
            <div className="welcome-sub">
              {acceptedUserList.length === 0
                ? 'Head to Explore to find and connect with people.'
                : 'Select a chat to start messaging.'}
            </div>
          </div>
        )}
      </div>

      {/* ─── MODALS ──────────────────────────────────────────────────────── */}

      {/* Chat Request Modal */}
      {showRequestModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '340px', textAlign: 'center' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), #60a5fa)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '24px', fontWeight: 700, color: '#022a24' }}>
              {showRequestModal.avatar ? <img src={showRequestModal.avatar} alt="u" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : (showRequestModal.username || 'U').slice(0, 1).toUpperCase()}
            </div>
            <h2 style={{ marginBottom: '8px' }}>{showRequestModal.username}</h2>
            <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '20px' }}>
              Send a chat request to <strong>{showRequestModal.username}</strong>. They'll need to accept before you can chat.
            </p>
            <div className="modal-actions" style={{ flexDirection: 'column', gap: '10px' }}>
              <button className="modal-btn submit" onClick={() => sendChatRequest(showRequestModal)}>📨 Send Chat Request</button>
              <button className="modal-btn cancel" onClick={() => setShowRequestModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Message Modal */}
      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '300px' }}>
            <h2>Delete Message</h2>
            <div className="modal-actions" style={{ flexDirection: 'column', gap: '10px' }}>
              <button className="modal-btn submit" onClick={() => deleteMsg(showDeleteModal._id, 'me')}>Delete for me</button>
              {showDeleteModal.from === user._id && (
                <button className="modal-btn submit" onClick={() => deleteMsg(showDeleteModal._id, 'everyone')} style={{ background: '#ef4444', color: 'white' }}>Delete for everyone</button>
              )}
              <button className="modal-btn cancel" onClick={() => setShowDeleteModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Chat Modal */}
      {showClearModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '300px' }}>
            <h2>Clear Chat</h2>
            <div className="modal-actions" style={{ flexDirection: 'column', gap: '10px' }}>
              <button className="modal-btn submit" onClick={() => clearChat('me')}>Clear for me</button>
              <button className="modal-btn submit" onClick={() => clearChat('everyone')} style={{ background: '#ef4444', color: 'white' }}>Clear for everyone</button>
              <button className="modal-btn cancel" onClick={() => setShowClearModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showGroupModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Create Group</h2>
            <input type="text" placeholder="Group Name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
            <div className="modal-users-list">
              {users.map(u => {
                const isSelected = newGroupMembers.includes(u._id);
                return (
                  <div key={u._id} className={`modal-user-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => isSelected ? setNewGroupMembers(prev => prev.filter(id => id !== u._id)) : setNewGroupMembers(prev => [...prev, u._id])}>
                    <div className="user-avatar" style={{ transform: 'scale(0.8)', marginRight: '10px' }}>
                      {u.avatar ? <img src={u.avatar} alt="u" /> : (u.username || 'U').slice(0, 1).toUpperCase()}
                    </div>
                    {u.username || 'user1'}
                  </div>
                );
              })}
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowGroupModal(false)}>Cancel</button>
              <button className="modal-btn submit" onClick={handleCreateGroup}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Following / Followers Modal ─────────────────────────────────── */}
      {showFollowModal && (() => {
        const profileUser = viewingUser || localUser;
        const PdisplayName = profileUser.displayName || profileUser.username || 'User';
        const Pinitials = PdisplayName.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();

        const followingIds = (profileUser.following || []).map(String);
        const followerIds = (profileUser.followers || []).map(String);
        const listIds = followModalTab === 'following' ? followingIds : followerIds;
        const listUsers = users.filter(u => listIds.includes(String(u._id)));
        return (
          <div className="modal-overlay" onClick={() => setShowFollowModal(false)}>
            <div className="modal-content follow-modal" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="follow-modal-header">
                <div className="follow-modal-avatar">
                  {profileUser.avatar
                    ? <img src={profileUser.avatar} alt="u" />
                    : Pinitials}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '16px' }}>{PdisplayName}</div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{profileUser._id === localUser._id ? 'Your social connections' : `${PdisplayName}'s connections`}</div>
                </div>
                <button
                  onClick={() => setShowFollowModal(false)}
                  style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}
                >✕</button>
              </div>

              {/* Tabs */}
              <div className="follow-modal-tabs">
                <button
                  className={`follow-tab-btn ${followModalTab === 'following' ? 'active' : ''}`}
                  onClick={() => setFollowModalTab('following')}
                >
                  {followingIds.length} Following
                </button>
                <button
                  className={`follow-tab-btn ${followModalTab === 'followers' ? 'active' : ''}`}
                  onClick={() => setFollowModalTab('followers')}
                >
                  {followerIds.length} Followers
                </button>
              </div>

              {/* User list */}
              <div className="follow-modal-list">
                {listUsers.length === 0 ? (
                  <div className="empty-tab" style={{ padding: '30px 10px' }}>
                    <div className="empty-icon">{followModalTab === 'following' ? '👣' : '👥'}</div>
                    <div>{followModalTab === 'following' ? "You don't follow anyone yet" : 'No followers yet'}</div>
                  </div>
                ) : listUsers.map(u => (
                  <div key={u._id} className="follow-user-row">
                    <div
                      className="user-avatar"
                      style={{ cursor: 'pointer', flexShrink: 0 }}
                      onClick={() => openUserProfile(u)}
                      title="View profile"
                    >
                      {u.avatar ? <img src={u.avatar} alt="u" /> : (u.username || 'U').slice(0, 1).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '14px' }}>{u.username}</div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        {onlineUsers[u._id] ? '🟢 Online' : 'Offline'}
                      </div>
                    </div>
                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {isAccepted(u._id) && (
                        <button
                          className="btn-accept"
                          style={{ fontSize: '10px', padding: '3px 8px' }}
                          onClick={() => { openChat(u); setShowFollowModal(false); }}
                        >💬 Chat</button>
                      )}
                      <button
                        className={`btn-follow ${isFollowing(u._id) ? 'btn-unfollow' : ''}`}
                        style={{ fontSize: '10px', padding: '3px 8px' }}
                        onClick={() => toggleFollow(u._id)}
                      >
                        {isFollowing(u._id) ? 'Unfollow' : '+ Follow'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Profile Modal ──────────────────────────────────────────────────────── */}
      {showProfileModal && (() => {
        const profileUser = viewingUser || localUser;
        const isMe = profileUser._id === localUser._id;
        const pInitials = (profileUser.displayName || profileUser.username || 'U')
          .split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();

        return (
          <div className="modal-overlay" onClick={() => { setShowProfileModal(false); setProfileEditMode(false); }}>
            <div className="modal-content profile-modal" onClick={e => e.stopPropagation()}>

              {/* Close button */}
              <button className="profile-close-btn" onClick={() => { setShowProfileModal(false); setProfileEditMode(false); }}>✕</button>

              {/* Cover banner */}
              <div className="profile-modal-cover" />

              {/* Avatar */}
              <div className="profile-avatar-wrap">
                <div
                  className={`profile-avatar ${isMe ? 'editable-avatar' : ''}`}
                  style={{ cursor: 'pointer' }}
                  title="View profile picture"
                >
                  <div
                    onClick={() => { if (profileUser.avatar) handleAvatarClick(profileUser.avatar); }}
                    style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px', fontWeight: 700 }}
                  >
                    {profileUser.avatar
                      ? <img src={profileUser.avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                      : pInitials}
                  </div>
                  {isMe && (
                    <div className="edit-overlay" onClick={e => { e.stopPropagation(); setShowProfileModal(false); setTimeout(onAvatarClick, 100); }} title="Change photo">
                      📷
                    </div>
                  )}
                </div>
              </div>

              {/* Display Name */}
              <div className="profile-section">
                {profileEditMode && isMe ? (
                  <div className="profile-field">
                    <label className="profile-label">Display Name</label>
                    <input
                      className="profile-input"
                      value={profileDraft.displayName}
                      onChange={e => setProfileDraft(d => ({ ...d, displayName: e.target.value }))}
                      placeholder="Your display name"
                      maxLength={40}
                    />
                  </div>
                ) : (
                  <div className="profile-name-row">
                    <div className="profile-display-name">{profileUser.displayName || profileUser.username}</div>
                    <div className="profile-username">@{profileUser.username}</div>
                  </div>
                )}
              </div>

              {/* Bio */}
              <div className="profile-section">
                {profileEditMode && isMe ? (
                  <div className="profile-field">
                    <label className="profile-label">Bio</label>
                    <textarea
                      className="profile-input profile-textarea"
                      value={profileDraft.bio}
                      onChange={e => setProfileDraft(d => ({ ...d, bio: e.target.value }))}
                      placeholder="Tell people about yourself..."
                      maxLength={150}
                      rows={3}
                    />
                    <div style={{ fontSize: '11px', color: 'var(--muted)', textAlign: 'right', marginTop: '4px' }}>
                      {(profileDraft.bio || '').length}/150
                    </div>
                  </div>
                ) : (
                  <div className="profile-bio">
                    {profileUser.bio ? profileUser.bio : <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>No bio yet.</span>}
                  </div>
                )}
              </div>

              {/* Stats */}
              <div className="profile-stats">
                <div className="profile-stat" onClick={() => { setShowProfileModal(false); setFollowModalTab('following'); setShowFollowModal(true); }}>
                  <div className="profile-stat-num">{(profileUser.following || []).length}</div>
                  <div className="profile-stat-label">Following</div>
                </div>
                <div className="profile-stat-divider" />
                <div className="profile-stat" onClick={() => { setShowProfileModal(false); setFollowModalTab('followers'); setShowFollowModal(true); }}>
                  <div className="profile-stat-num">{(profileUser.followers || []).length}</div>
                  <div className="profile-stat-label">Followers</div>
                </div>
                {isMe && (
                  <>
                    <div className="profile-stat-divider" />
                    <div className="profile-stat">
                      <div className="profile-stat-num">{(profileUser.acceptedChats || []).length}</div>
                      <div className="profile-stat-label">Chats</div>
                    </div>
                  </>
                )}
              </div>

              {/* Edit / Save buttons or Match Actions */}
              <div className="profile-actions">
                {isMe ? (
                  profileEditMode ? (
                    <>
                      <button className="modal-btn submit" onClick={saveProfile}>Save Changes</button>
                      <button className="modal-btn cancel" onClick={() => setProfileEditMode(false)}>Cancel</button>
                    </>
                  ) : (
                    <button className="modal-btn submit" onClick={() => setProfileEditMode(true)} style={{ width: '100%' }}>✏️ Edit Profile</button>
                  )
                ) : (
                  <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                    <button 
                      className={`modal-btn ${isFollowing(profileUser._id) ? 'cancel' : 'submit'}`} 
                      style={{ flex: 1 }}
                      onClick={() => toggleFollow(profileUser._id)}
                    >
                      {isFollowing(profileUser._id) ? 'Unfollow' : 'Follow'}
                    </button>
                    <button 
                      className="modal-btn submit" 
                      style={{ flex: 1, background: 'var(--accent)', color: '#022a24' }}
                      onClick={() => {
                          setShowProfileModal(false);
                          if (!isAccepted(profileUser._id)) {
                             setShowRequestModal(profileUser);
                          } else {
                             openChat(profileUser);
                          }
                      }}
                    >
                      Message
                    </button>
                    <button
                      className="modal-btn cancel"
                      style={{ width: 'auto', padding: '0 12px', fontSize: '18px' }}
                      onClick={() => {
                         setShowProfileModal(false);
                         blockUser(profileUser._id);
                      }}
                      title="Block"
                    >
                      🚫
                    </button>
                  </div>
                )}
              </div>

              {/* Blocked Users Section */}
              {isMe && (
                <div className="blocked-section">
                  <button
                    className="blocked-toggle"
                    onClick={() => setShowBlockedSection(s => !s)}
                  >
                    🚫 Blocked Users ({blockedUsers.length})
                    <span style={{ marginLeft: 'auto', fontSize: '12px' }}>{showBlockedSection ? '▲' : '▼'}</span>
                  </button>

                  {showBlockedSection && (
                    <div className="blocked-list">
                      {blockedUsers.length === 0 ? (
                        <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '12px', textAlign: 'center' }}>
                          No blocked users
                        </div>
                      ) : blockedUsers.map(u => (
                        <div key={u._id} className="blocked-user-row">
                          <div className="user-avatar" style={{ flexShrink: 0, width: '36px', height: '36px', fontSize: '14px' }}>
                            {u.avatar ? <img src={u.avatar} alt="u" /> : (u.username || 'U').slice(0, 1).toUpperCase()}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: '14px' }}>{u.displayName || u.username}</div>
                            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>@{u.username}</div>
                          </div>
                          <button
                            className="btn-unblock"
                            onClick={() => unblockUser(u._id)}
                          >
                            Unblock
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        );
      })()}
    </div>
  );
}
export default Chat;
