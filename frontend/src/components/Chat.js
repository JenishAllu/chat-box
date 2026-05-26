
import React, { useEffect, useMemo, useState, useRef } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import CryptoJS from "crypto-js";
import { encryptMessage, decryptMessage, decryptMessages } from "../utils/encryption";
import VerifiedBadge from "./VerifiedBadge";
import "./Chat.css";
import "./ThemeLight.css";
import EmojiPicker from 'emoji-picker-react';

const runtimeConfig = window.__APP_CONFIG__ || {};
const API_BASE = runtimeConfig.REACT_APP_API_URL || process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:5000`;
const SOCKET_URL = runtimeConfig.REACT_APP_SOCKET_URL || process.env.REACT_APP_SOCKET_URL || API_BASE;

// ─── End-to-End Encryption Setup ──────────────────────────────────────────
// Shared encryption key for all users - ensures both sender and receiver can decrypt
// Messages are encrypted client-side before transmission and never stored plaintext on server
const SECRET_SALT = 'INSTA_CHAT_SYSTEM_E2E_MESSAGE_ENCRYPTION_2024';
const ENCRYPTION_KEY = CryptoJS.SHA256(SECRET_SALT).toString();
const TYPING_EMIT_INTERVAL_MS = 300;

const socket = io(SOCKET_URL, { autoConnect: false });

function room(a, b) { return [a, b].sort().join("_"); }

function isMobileViewport() {
  return window.matchMedia('(max-width: 820px)').matches;
}

function getStoredUser() {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed._id ? parsed : null;
  } catch {
    return null;
  }
}

const showBrowserNotification = (title, options) => {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, options);
  }
};

function syncAuthHeader(token) {
  if (token) {
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common.Authorization;
  }
}

function Chat({ onLogout }) {
  const initialUser = useMemo(() => getStoredUser(), []);
  const nav = useNavigate();
  const [localUser, setLocalUser] = useState(initialUser || {});
  const user = localUser;

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      syncAuthHeader(token);
    }

    if (!user?._id) {
      nav('/', { replace: true });
      return;
    }

    let isMounted = true;

    const bootstrapUser = async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/users/${user._id}`);
        if (!isMounted) return;
        setLocalUser(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));

        if (res.data.isBlocked) {
          showToast('Your account is blocked. Please contact support.', 'error');
          socket.disconnect();
          nav('/', { replace: true });
          return;
        }

        socket.auth = { token };
        if (!socket.connected) {
          socket.connect();
        }
      } catch (err) {
        if (!isMounted) return;
        if (err.response?.status === 403) {
          localStorage.removeItem('user');
          localStorage.removeItem('token');
          syncAuthHeader(null);
          socket.disconnect();
          nav('/', { replace: true });
          return;
        }
        console.error('failed to refresh user', err);
        if (token) {
          socket.auth = { token };
          if (!socket.connected) {
            socket.connect();
          }
        }
      }
    };

    bootstrapUser();

    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
      Notification.requestPermission();
    }

    return () => {
      isMounted = false;
    };
  }, [user?._id, nav]);

  const displayName = localUser?.displayName || localUser?.username || 'user1';
  const initials = displayName.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();

  // ─── Core state ───────────────────────────────────────────────────────────
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [chatRequests, setChatRequests] = useState([]); // full user objects of requesters
  const [messageRequests, setMessageRequests] = useState([]);
  const [requestHistory, setRequestHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [msg, setMsg] = useState("");
  const [messages, setMessages] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [openMenuId, setOpenMenuId] = useState(null);
  const [openHeaderMenu, setOpenHeaderMenu] = useState(false);
  const [isLightMode, setIsLightMode] = useState(() => {
    const saved = localStorage.getItem('chat_theme');
    return saved ? saved === 'light' : true;
  });
  const [showNavMenu, setShowNavMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => isMobileViewport());
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  useEffect(() => {
    localStorage.setItem('chat_theme', isLightMode ? 'light' : 'dark');
    if (isLightMode) {
      document.body.classList.add('light-theme-body');
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    } else {
      document.body.classList.remove('light-theme-body');
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
    }
  }, [isLightMode]);

  const [editingMessage, setEditingMessage] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editGroupNameStr, setEditGroupNameStr] = useState('');
  const [viewImageUrl, setViewImageUrl] = useState(null);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState({});
  const [typingUser, setTypingUser] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const typingTimeoutRef = useRef(null);
  const lastTypingEmitRef = useRef(0);
  const messagesEndRef = useRef(null);
  const mediaFileRef = useRef();
  const groupFileRef = useRef();
  const fileRef = useRef();

  // ─── Sidebar tab ──────────────────────────────────────────────────────────
  const [sidebarTab, setSidebarTab] = useState('chats'); // 'chats' | 'requests' | 'discover'
  const [discoverSearch, setDiscoverSearch] = useState('');
  const [discoverSearchResults, setDiscoverSearchResults] = useState([]);
  const [expandedSections, setExpandedSections] = useState({
    messageRequests: false,
    pendingRequests: false,
    followBack: false
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // ─── Group modal ──────────────────────────────────────────────────────────
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState([]);

  // ─── Chat request modal ───────────────────────────────────────────────────
  const [showRequestModal, setShowRequestModal] = useState(null); // user object

  // ─── Following / Followers modal ──────────────────────────────────────────
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [followModalTab, setFollowModalTab] = useState('following'); // 'following' | 'followers' | 'pending'

  // ─── Profile modal ──────────────────────────────────────────────────────────
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileModalMode, setProfileModalMode] = useState('profile'); // 'profile' | 'settings'
  const [viewingUser, setViewingUser] = useState(null);
  const [profileEditMode, setProfileEditMode] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ displayName: '', bio: '' });
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [showGroupDetailModal, setShowGroupDetailModal] = useState(false);
  const [showGroupAddPanel, setShowGroupAddPanel] = useState(false);
  const [groupAddMemberIds, setGroupAddMemberIds] = useState([]);
  const [groupAddSearch, setGroupAddSearch] = useState('');
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [showBlockedSection, setShowBlockedSection] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [deletePassword, setDeletePassword] = useState('');
  const [accountActionBusy, setAccountActionBusy] = useState(false);

  // ─── Toast notification ───────────────────────────────────────────────────
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const isAccountBlocked = Boolean(localUser?.isBlocked);

  const followingSet = useMemo(() => new Set((localUser.following || []).map(String)), [localUser.following]);
  const pendingFollowingSet = useMemo(() => new Set((localUser.pendingFollowing || []).map(String)), [localUser.pendingFollowing]);
  const acceptedSet = useMemo(() => new Set((localUser.acceptedChats || []).map(String)), [localUser.acceptedChats]);
  const blockedSet = useMemo(() => new Set((localUser.blocked || []).map(String)), [localUser.blocked]);
  const messageRequestSenderIdSet = useMemo(() => new Set((messageRequests || []).map(item => String(item?.from?._id || item?.from || ''))), [messageRequests]);
  const requestBadgeCount = useMemo(() => {
    return new Set([
      ...chatRequests.map(u => String(u._id)),
      ...messageRequests.map(item => String(item?.from?._id || item?.from || ''))
    ]).size;
  }, [chatRequests, messageRequests]);

  const selectedGroupAdminIds = useMemo(() => {
    if (!selected?.isGroup) return [];
    if (Array.isArray(selected.admins) && selected.admins.length > 0) {
      return selected.admins.map(a => String(a?._id || a));
    }
    return selected?.admin ? [String(selected.admin?._id || selected.admin)] : [];
  }, [selected]);

  const isSelectedGroupAdmin = useMemo(() => {
    if (!selected?.isGroup || !localUser?._id) return false;
    return selectedGroupAdminIds.includes(String(localUser._id));
  }, [selected, localUser?._id, selectedGroupAdminIds]);

  const selectedGroupMemberIdSet = useMemo(() => {
    if (!selected?.isGroup) return new Set();
    return new Set((selected.members || []).map(m => String(m._id || m)));
  }, [selected]);

  const availableUsersToAdd = useMemo(() => {
    if (!selected?.isGroup) return [];
    return users.filter(u => !selectedGroupMemberIdSet.has(String(u._id)));
  }, [users, selected, selectedGroupMemberIdSet]);

  const filteredUsersToAdd = useMemo(() => {
    const q = groupAddSearch.trim().toLowerCase();
    if (!q) return availableUsersToAdd;
    return availableUsersToAdd.filter(u => (u.username || '').toLowerCase().includes(q));
  }, [availableUsersToAdd, groupAddSearch]);

  const suggestionIdSet = useMemo(() => new Set((suggestions || []).map(u => String(u._id))), [suggestions]);

  const followedUsersToAdd = useMemo(() => {
    return filteredUsersToAdd.filter(u => followingSet.has(String(u._id)));
  }, [filteredUsersToAdd, followingSet]);

  const suggestedUsersToAdd = useMemo(() => {
    return filteredUsersToAdd
      .filter(u => !followingSet.has(String(u._id)))
      .sort((a, b) => {
        const aSuggested = suggestionIdSet.has(String(a._id)) ? 1 : 0;
        const bSuggested = suggestionIdSet.has(String(b._id)) ? 1 : 0;
        return bSuggested - aSuggested;
      });
  }, [filteredUsersToAdd, followingSet, suggestionIdSet]);

  const visibleMessages = useMemo(() => {
    if (!selected) return [];
    const filtered = selected.isGroup
      ? messages.filter(m => m.room === selected._id)
      : (() => {
          const targetRoom = room(user._id, selected._id);
          return messages.filter(m => ((m.room && m.room === targetRoom) || room(m.from, m.to) === targetRoom));
        })();

    return filtered.slice().sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      if (aTime !== bTime) return aTime - bTime;
      return String(a._id || '').localeCompare(String(b._id || ''));
    });
  }, [messages, selected, user._id]);

  const conversationActivityMap = useMemo(() => {
    const map = {};

    messages.forEach(m => {
      const roomId = m.room || (m.isGroup ? m.to : room(m.from, m.to));
      const timestamp = new Date(m.createdAt || 0).getTime();
      if (!map[roomId] || timestamp > map[roomId]) {
        map[roomId] = timestamp;
      }
    });

    return map;
  }, [messages]);

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => {
      const aTime = conversationActivityMap[a._id] || 0;
      const bTime = conversationActivityMap[b._id] || 0;
      if (aTime !== bTime) return bTime - aTime;
      return String(a.username || '').localeCompare(String(b.username || ''));
    });
  }, [groups, conversationActivityMap]);

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getMediaSrc = (media) => {
    if (!media || !media.data) return '';
    if (typeof media.data === 'string' && media.data.startsWith('data:')) {
      return media.data;
    }
    const type = media.type || 'application/octet-stream';
    return `data:${type};base64,${media.data}`;
  };

  const getMessagePreview = (message) => {
    if (!message) return 'No text';
    const trimmed = String(message).trim();
    return trimmed.length > 90 ? `${trimmed.slice(0, 90)}…` : trimmed;
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
  const isFollowing = (uId) => followingSet.has(String(uId));
  const isAccepted = (uId) => acceptedSet.has(String(uId));
  const hasPendingRequest = (uId) => pendingFollowingSet.has(String(uId));

  // ─── Data loading ─────────────────────────────────────────────────────────
  const loadSuggestions = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/users/${localUser._id}/suggestions`);
      setSuggestions(res.data);
    } catch (e) { console.error("failed to load suggestions", e); }
  };

  const loadChatRequests = async (currentUser) => {
    const me = currentUser || localUser;
    if (!me?._id) return;
    try {
      const res = await axios.get(`${API_BASE}/api/users/${me._id}/chat-requests`);
      setChatRequests(res.data);
    } catch (e) { console.error("failed to load requests", e); }
  };

  const loadMessageRequests = async (currentUser) => {
    try {
      const me = currentUser || localUser;
      if (!me?._id) return;
      const res = await axios.get(`${API_BASE}/api/messages/requests/${me._id}`);
      setMessageRequests((Array.isArray(res.data) ? res.data : []).map(item => ({
        ...item,
        latestMessage: item.latestMessage ? decryptMessage(item.latestMessage, ENCRYPTION_KEY) : item.latestMessage,
      })));
    } catch (e) {
      console.error("failed to load message requests", e);
      setMessageRequests([]);
    }
  };

  const loadRequestHistory = async (currentUser) => {
    try {
      const me = currentUser || localUser;
      if (!me?._id) return;
      const res = await axios.get(`${API_BASE}/api/users/${me._id}/request-history`);
      setRequestHistory(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error("failed to load request history", e);
      setRequestHistory([]);
    }
  };

  useEffect(() => {
    axios.get(`${API_BASE}/api/users/${localUser._id}/accepted-chats`)
      .then(res => setUsers(res.data));
    axios.get(`${API_BASE}/api/groups/${localUser._id}`)
      .then(res => setGroups(res.data.map(g => ({ ...g, isGroup: true, username: g.name }))))
      .catch(err => console.error("failed to load groups", err));
    axios.get(`${API_BASE}/api/messages/unread/${localUser._id}`)
      .then(res => setUnreadCounts(res.data))
      .catch(err => console.error("failed to load unread counts", err));
    socket.emit("setUserId", localUser._id);
    loadSuggestions();
    loadChatRequests();
    loadMessageRequests();
    loadRequestHistory();
  }, [localUser._id]);

  useEffect(() => {
    if (!discoverSearch.trim()) {
      setDiscoverSearchResults([]);
      return;
    }
    const delay = setTimeout(() => {
      axios.get(`${API_BASE}/api/users/search?q=${discoverSearch.trim()}&excludeId=${localUser._id}`)
        .then(res => setDiscoverSearchResults(res.data))
        .catch(err => console.error("Search failed", err));
    }, 400);
    return () => clearTimeout(delay);
  }, [discoverSearch, localUser._id]);

  // ─── Socket: online / offline / typing ───────────────────────────────────
  useEffect(() => {
    const onOnline = (data) => {
      setOnlineUsers(prev => ({ ...prev, [data.userId]: true }));
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
      showBrowserNotification('New Chat Request', { body: `${from.username} sent you a chat request!`, icon: from.avatar });
      // Add to requests list if not already there
      setChatRequests(prev => prev.find(u => u._id === from._id) ? prev : [...prev, from]);
      setRequestHistory(prev => {
        const alreadyPending = prev.some(h => String(h?.from?._id || h?.from) === String(from._id) && h.status === 'pending');
        if (alreadyPending) return prev;
        return [{ from, status: 'pending', requestedAt: new Date().toISOString() }, ...prev];
      });
      // Reload local user so chatRequests array is up-to-date
      axios.get(`${API_BASE}/api/users/${localUser._id}`)
        .then(res => {
          const me = res.data;
          if (me) { setLocalUser(me); localStorage.setItem('user', JSON.stringify(me)); }
        });
    });

    socket.on("messageRequestReceived", ({ from, message }) => {
      showToast(`📩 Message request from ${from.username}`, 'request');
      showBrowserNotification('Message Request', { body: `New message request from ${from.username}`, icon: from.avatar });
      setMessageRequests(prev => {
        const existing = prev.find(item => String(item?.from?._id) === String(from._id));
        const nextEntry = {
          from,
          latestMessage: message?.message ? decryptMessage(message.message, ENCRYPTION_KEY) : '',
          latestCreatedAt: message?.createdAt || new Date().toISOString(),
          messageCount: existing ? (existing.messageCount + 1) : 1,
          latestMedia: message?.media || null,
        };
        if (existing) {
          return prev.map(item => String(item?.from?._id) === String(from._id) ? nextEntry : item);
        }
        return [nextEntry, ...prev];
      });
      setChatRequests(prev => prev.find(u => u._id === from._id) ? prev : [...prev, from]);
    });

    socket.on("chatAccepted", ({ by }) => {
      showToast(`✅ ${by.username} accepted your chat request!`, 'success');
      // Reload local user so acceptedChats is up-to-date
      axios.get(`${API_BASE}/api/users/${localUser._id}`)
        .then(res => {
          const me = res.data;
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
      socket.off("messageRequestReceived");
      socket.off("chatAccepted");
      socket.off("errorMessage");
      clearTimeout(typingTimeoutRef.current);
    };
  }, [localUser._id]);

  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { setOpenHeaderMenu(false); }, [selected?._id]);

  useEffect(() => {
    if (!openHeaderMenu && openMenuId == null && !showEmojiPicker) return;

    const handleOutsideMenuClick = (event) => {
      if (!(event.target instanceof Element)) return;

      const clickedMessageMenu = event.target.closest('.message-options');
      const clickedHeaderMenu = event.target.closest('.chat-header-menu');
      const clickedEmojiPicker = event.target.closest('.emoji-picker-container');

      if (!clickedMessageMenu) {
        setOpenMenuId(null);
      }
      if (!clickedHeaderMenu) {
        setOpenHeaderMenu(false);
      }
      if (!clickedEmojiPicker) {
        setShowEmojiPicker(false);
      }
    };

    document.addEventListener('pointerdown', handleOutsideMenuClick);
    return () => document.removeEventListener('pointerdown', handleOutsideMenuClick);
  }, [openHeaderMenu, openMenuId, showEmojiPicker]);

  useEffect(() => {
    if (!isMobileViewport()) return;

    if (!window.history.state || !window.history.state.instaChatView) {
      window.history.replaceState({ ...(window.history.state || {}), instaChatView: 'list' }, '');
    }

    const onPopState = () => {
      if (selectedRef.current) {
        setSelected(null);
        setReplyingTo(null);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // ─── Visibility: mark seen when tab comes back into focus ─────────────────
  useEffect(() => {
    const handleVisibilityChange = () => {
      const currentSelected = selectedRef.current;
      if (!document.hidden && currentSelected && !currentSelected.isGroup) {
        // Tab became visible — mark current chat as seen now
        axios.post(`${API_BASE}/api/messages/seen`, { userId: user._id, otherId: currentSelected._id })
          .then(() => {
            setMessages(prev => prev.map(m => m.to === user._id ? { ...m, seen: true } : m));
          })
          .catch(() => {});
        socket.emit('markAllSeen', { userId: user._id, otherUserId: currentSelected._id });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [user._id]);

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
        if (data.to !== currentSelected?._id && data.from !== user._id) {
          setUnreadCounts(prev => ({ ...prev, [data.to]: (prev[data.to] || 0) + 1 }));
          showBrowserNotification('New Group Message', { body: `New message in group` });
        }
      } else {
        if (data.to === user._id && data.from !== currentSelected?._id) {
          setUnreadCounts(prev => ({ ...prev, [data.from]: (prev[data.from] || 0) + 1 }));
          showBrowserNotification('New Message', { body: `New message received` });
        }
      }
      if (!data.isGroup && data.to === user._id && data.from === currentSelected?._id) {
        // Only mark seen if the tab is actually visible (not minimized/backgrounded)
        if (!document.hidden) {
          socket.emit('markSeen', data._id);
        }
      }
    };

    const backgroundHandler = (data) => {
      const currentSelected = selectedRef.current;
      if (data.isGroup) {
        if (data.to !== currentSelected?._id && data.from !== user._id) {
          setUnreadCounts(prev => ({ ...prev, [data.to]: (prev[data.to] || 0) + 1 }));
          showBrowserNotification('New Group Message', { body: `New message in group` });
        }
      } else {
        if (data.from !== currentSelected?._id) {
          setUnreadCounts(prev => ({ ...prev, [data.from]: (prev[data.from] || 0) + 1 }));
          showBrowserNotification('New Message', { body: `New message received` });
        }
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

    if (isMobileViewport()) {
      window.history.pushState(
        { ...(window.history.state || {}), instaChatView: 'chat', chatId: u._id },
        ''
      );
    }

    setSelected(u);
    setMessages([]);
    setReplyingTo(null);
    setUnreadCounts(prev => ({ ...prev, [u._id]: 0 }));
    try {
      const qs = u.isGroup ? '?isGroup=true' : '';
      const res = await axios.get(`${API_BASE}/api/messages/${user._id}/${u._id}${qs}`);
      // Decrypt all messages with the shared encryption key
      setMessages(res.data.map(m => ({
        ...m,
        message: decryptMessage(m.message, ENCRYPTION_KEY),
        replyTo: m.replyTo ? { ...m.replyTo, message: decryptMessage(m.replyTo.message, ENCRYPTION_KEY) } : m.replyTo
      })));
    } catch (err) { console.error("failed to load messages", err); }

    if (!u.isGroup) {
      // Only mark all messages as seen if the tab is currently visible
      if (!document.hidden) {
        try {
          await axios.post(`${API_BASE}/api/messages/seen`, { userId: user._id, otherId: u._id });
          setMessages(prev => prev.map(m => m.to === user._id ? { ...m, seen: true } : m));
        } catch (e) { console.error("failed to mark seen", e); }
        socket.emit("joinRoom", { userId: user._id, otherUserId: u._id });
        socket.emit("markAllSeen", { userId: user._id, otherUserId: u._id });
      } else {
        socket.emit("joinRoom", { userId: user._id, otherUserId: u._id });
      }
    } else {
      socket.emit("joinGroup", u._id);
    }
  };

  // ─── Social actions ───────────────────────────────────────────────────────
  const toggleFollow = async (uId) => {
    const following = isFollowing(uId);
    const pending = hasPendingRequest(uId);
    try {
      const res = await axios.put(`${API_BASE}/api/users/${localUser._id}/${(following || pending) ? 'unfollow' : 'follow'}/${uId}`);
      setLocalUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
      if (!following && !pending) {
        // Emit socket event so target gets live notification
        socket.emit("sendChatRequest", { from: localUser._id, to: uId });
        showToast('✅ Follow request sent (pending approval)!', 'success');
        // Remove from suggestions
        setSuggestions(prev => prev.filter(u => u._id !== uId));
      } else if (pending) {
        showToast('Pending request cancelled', 'info');
      }
    } catch { showToast('Failed to update follow status', 'error'); }
  };

  const acceptChatRequest = async (requesterId) => {
    try {
      const res = await axios.put(`${API_BASE}/api/users/${localUser._id}/accept-chat/${requesterId}`);
      setLocalUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
      // Emit real-time accepted event
      socket.emit("chatRequestAccepted", { from: localUser._id, to: requesterId });
      // Remove from requests
      setChatRequests(prev => prev.filter(u => u._id !== requesterId));
      setMessageRequests(prev => prev.filter(item => String(item?.from?._id) !== String(requesterId)));
      loadRequestHistory(res.data);
      loadMessageRequests(res.data);
      showToast('✅ Chat request accepted!', 'success');
    } catch { showToast('Failed to accept request', 'error'); }
  };

  const declineChatRequest = async (requesterId) => {
    try {
      const res = await axios.put(`${API_BASE}/api/users/${localUser._id}/decline-chat/${requesterId}`);
      setLocalUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
      setChatRequests(prev => prev.filter(u => u._id !== requesterId));
      setMessageRequests(prev => prev.filter(item => String(item?.from?._id) !== String(requesterId)));
      loadRequestHistory(res.data);
      loadMessageRequests(res.data);
      showToast('Request declined', 'info');
    } catch { showToast('Failed to decline request', 'error'); }
  };

  const sendChatRequest = async (targetUser) => {
    try {
      await axios.put(`${API_BASE}/api/users/${localUser._id}/request-chat/${targetUser._id}`);
      socket.emit("sendChatRequest", { from: localUser._id, to: targetUser._id });
      showToast(`📨 Chat request sent to ${targetUser.username}!`, 'success');
      setShowRequestModal(null);
    } catch { showToast('Failed to send request', 'error'); }
  };

  const blockUser = async (uId) => {
    if (!window.confirm("Are you sure you want to block this user?")) return;
    try {
      const res = await axios.put(`${API_BASE}/api/users/${localUser._id}/block/${uId}`);
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
      const res = await axios.post(`${API_BASE}/api/groups`, {
        name: newGroupName,
        members: [...newGroupMembers, localUser._id],
        creatorId: localUser._id
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
      const res = await axios.put(`${API_BASE}/api/groups/${selected._id}/name`, { name: editGroupNameStr });
      const updatedGroup = { ...res.data, isGroup: true, username: res.data.name };
      setGroups(prev => prev.map(g => g._id === updatedGroup._id ? updatedGroup : g));
      setSelected(updatedGroup);
      setEditingGroupId(null);
    } catch { showToast('Failed to update group name', 'error'); }
  };

  const syncUpdatedGroup = (groupData) => {
    if (!groupData) return;
    const updatedGroup = { ...groupData, isGroup: true, username: groupData.name };
    setGroups(prev => prev.map(g => g._id === updatedGroup._id ? updatedGroup : g));
    setSelected(prev => (prev && prev._id === updatedGroup._id ? updatedGroup : prev));
  };

  const addMembersToGroup = async () => {
    if (!selected?.isGroup || groupAddMemberIds.length === 0) return;
    try {
      const payload = { requesterId: localUser._id, memberIds: groupAddMemberIds };
      const endpoints = [
        { method: 'put', url: `${API_BASE}/api/groups/${selected._id}/members/add` },
        { method: 'post', url: `${API_BASE}/api/groups/${selected._id}/members/add` },
        { method: 'put', url: `${API_BASE}/api/groups/${selected._id}/members` },
        { method: 'post', url: `${API_BASE}/api/groups/${selected._id}/members` },
        { method: 'put', url: `${API_BASE}/api/groups/${selected._id}/add-members` },
        { method: 'post', url: `${API_BASE}/api/groups/${selected._id}/add-members` },
        { method: 'put', url: `${API_BASE}/api/groups/${selected._id}/member/add` },
        { method: 'post', url: `${API_BASE}/api/groups/${selected._id}/member/add` }
      ];

      let res = null;
      let lastErr = null;
      for (const ep of endpoints) {
        try {
          res = await axios({ method: ep.method, url: ep.url, data: payload });
          break;
        } catch (err) {
          lastErr = err;
          if (err?.response?.status && err.response.status !== 404) {
            throw err;
          }
        }
      }

      if (!res) {
        throw lastErr || new Error('All add-member endpoints returned 404');
      }

      syncUpdatedGroup(res.data);
      setGroupAddMemberIds([]);
      setGroupAddSearch('');
      setShowGroupAddPanel(false);
      showToast('Members added to group', 'success');
    } catch (err) {
      const serverError = err?.response?.data?.error || err?.response?.data?.msg;
      showToast(serverError || `Failed to add members (${err?.response?.status || 'network'})`, 'error');
    }
  };

  const toggleGroupAddMember = (memberId) => {
    setGroupAddMemberIds(prev => {
      const id = String(memberId);
      if (prev.includes(id)) {
        return prev.filter(v => v !== id);
      }
      return [...prev, id];
    });
  };

  const removeGroupMember = async (memberId) => {
    if (!selected?.isGroup) return;
    try {
      const res = await axios.put(`${API_BASE}/api/groups/${selected._id}/members/remove`, {
        requesterId: localUser._id,
        memberId
      });
      syncUpdatedGroup(res.data);
      showToast('Member removed', 'info');
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to remove member', 'error');
    }
  };

  const makeGroupAdmin = async (memberId) => {
    if (!selected?.isGroup) return;
    try {
      const res = await axios.put(`${API_BASE}/api/groups/${selected._id}/admin`, {
        requesterId: localUser._id,
        newAdminId: memberId
      });
      syncUpdatedGroup(res.data);
      showToast('Admin role transferred', 'success');
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to transfer admin', 'error');
    }
  };

  // ─── Avatar ───────────────────────────────────────────────────────────────
  const onAvatarClick = () => fileRef.current && fileRef.current.click();
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const dataUrl = await compressImage(f);
      const res = await axios.put(`${API_BASE}/api/users/${localUser._id}/avatar`, { avatar: dataUrl });
      setLocalUser(res.data); 
      if (viewingUser && viewingUser._id === localUser._id) setViewingUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
    } catch (err) { console.error('avatar upload failed', err); }
    e.target.value = null;
  };

  const removeAvatar = async () => {
    if (!window.confirm("Are you sure you want to remove your profile picture?")) return;
    try {
      const res = await axios.put(`${API_BASE}/api/users/${localUser._id}/avatar`, { avatar: "" });
      setLocalUser(res.data); 
      if (viewingUser && viewingUser._id === localUser._id) setViewingUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
      showToast('Profile picture removed', 'success');
    } catch (err) { console.error('avatar remove failed', err); showToast('Failed to remove picture', 'error'); }
  };

  const onGroupAvatarClick = () => selected?.isGroup && groupFileRef.current && groupFileRef.current.click();
  const onGroupFile = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const dataUrl = await compressImage(f);
      const res = await axios.put(`${API_BASE}/api/groups/${selected._id}/avatar`, { avatar: dataUrl });
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
      const res = await axios.get(`${API_BASE}/api/users/${localUser._id}/blocked`);
      setBlockedUsers(res.data);
    } catch (e) { console.error('failed to load blocked users', e); }
  };

  const openSettingsModal = () => {
    setViewingUser(null);
    setProfileDraft({ displayName: localUser.displayName || '', bio: localUser.bio || '' });
    setProfileEditMode(false);
    setShowBlockedSection(false);
    setPasswordDraft({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setDeletePassword('');
    loadBlockedUsers();
    setProfileModalMode('settings');
    setShowProfileModal(true);
  };

  const openProfileModal = () => {
    setViewingUser(null);
    setProfileDraft({ displayName: localUser.displayName || '', bio: localUser.bio || '' });
    setProfileEditMode(false);
    setProfileModalMode('profile');
    setShowProfileModal(true);
  };

  const openReportModal = (targetUser) => {
    if (!targetUser?._id || String(targetUser._id) === String(localUser._id)) {
      showToast('You cannot report this account', 'error');
      return;
    }
    setReportTarget(targetUser);
    setReportReason('');
    setReportDetails('');
    setShowReportModal(true);
  };

  const submitReport = async () => {
    if (!reportTarget?._id || !reportReason.trim()) {
      showToast('Select a report reason', 'error');
      return;
    }

    try {
      await axios.post(`${API_BASE}/api/users/report`, {
        targetId: reportTarget._id,
        reason: reportReason.trim(),
        details: reportDetails.trim(),
      });
      showToast('Report submitted', 'success');
      setShowReportModal(false);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to submit report', 'error');
    }
  };

  const openUserProfile = (u) => {
    const normalizedUser = typeof u === 'string' ? { _id: u } : u;
    if (!normalizedUser?._id) {
      showToast('User details not available yet', 'info');
      return;
    }
    if (normalizedUser._id === localUser._id) {
      openProfileModal();
      return;
    }
    setViewingUser(normalizedUser);
    setShowProfileModal(true);
  };

  const openGroupDetails = () => {
    if (!selected?.isGroup) return;
    loadSuggestions();
    setShowGroupAddPanel(false);
    setGroupAddMemberIds([]);
    setGroupAddSearch('');
    setShowGroupDetailModal(true);
  };

  const saveProfile = async () => {
    try {
      const res = await axios.put(`${API_BASE}/api/users/${localUser._id}/profile`, profileDraft);
      setLocalUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
      setProfileEditMode(false);
      showToast('✅ Profile updated!', 'success');
    } catch { showToast('Failed to update profile', 'error'); }
  };

  const updatePassword = async () => {
    if (!passwordDraft.newPassword || !passwordDraft.confirmPassword || (!localUser?.googleId && !passwordDraft.currentPassword)) {
      showToast('Fill all password fields', 'error');
      return;
    }
    if (passwordDraft.newPassword !== passwordDraft.confirmPassword) {
      showToast('New passwords do not match', 'error');
      return;
    }
    setAccountActionBusy(true);
    try {
      await axios.put(`${API_BASE}/api/users/${localUser._id}/password`, {
        currentPassword: passwordDraft.currentPassword,
        newPassword: passwordDraft.newPassword,
      });
      setPasswordDraft({ currentPassword: '', newPassword: '', confirmPassword: '' });
      showToast('Password updated', 'success');
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to update password', 'error');
    } finally {
      setAccountActionBusy(false);
    }
  };

  const sendPasswordResetLink = async () => {
    if (!localUser?.email) {
      showToast('No email address is available for this account', 'error');
      return;
    }
    if (!window.confirm(`Send a password reset link to ${localUser.email}?`)) return;
    setAccountActionBusy(true);
    try {
      const res = await axios.post(`${API_BASE}/api/auth/forgot-password`, {
        email: localUser.email,
      });
      showToast(res?.data?.msg || 'Reset link sent', 'success');
    } catch (err) {
      showToast(err?.response?.data?.msg || 'Failed to send reset link', 'error');
    } finally {
      setAccountActionBusy(false);
    }
  };

  const endSession = () => {
    socket.disconnect();
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    syncAuthHeader(null);
    if (onLogout) {
      onLogout();
    }
    nav('/', { replace: true });
  };

  const deleteAccount = async () => {
    if (!window.confirm('Delete this account permanently? This cannot be undone.')) return;
    setAccountActionBusy(true);
    try {
      await axios.delete(`${API_BASE}/api/users/${localUser._id}`, {
        data: { currentPassword: deletePassword }
      });
      showToast('Account deleted', 'success');
      endSession();
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to delete account', 'error');
    } finally {
      setAccountActionBusy(false);
    }
  };

  const unblockUser = async (uId) => {
    try {
      const res = await axios.put(`${API_BASE}/api/users/${localUser._id}/unblock/${uId}`);
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

  const openForwardModal = (message) => {
    setForwardingMessage(message);
    setForwardSearch('');
    setOpenMenuId(null);
    setShowForwardModal(true);
  };

  const sendForwardedMessage = (target) => {
    if (!forwardingMessage || !target) return;
    if (isAccountBlocked) {
      showToast('Your account is blocked', 'error');
      return;
    }

    const payload = {
      from: user._id,
      to: target._id,
      message: forwardingMessage.message ? encryptMessage(forwardingMessage.message, ENCRYPTION_KEY) : '',
      forwardedFrom: forwardingMessage._id,
    };

    if (target.isGroup) payload.isGroup = true;
    if (forwardingMessage.media) payload.media = forwardingMessage.media;

    const optimisticMsg = {
      ...payload,
      message: forwardingMessage.message || '',
      media: forwardingMessage.media || undefined,
      isForwarded: true,
      room: target.isGroup ? target._id : room(user._id, target._id),
      seen: false,
      createdAt: new Date().toISOString(),
    };

    setMessages(prev => [...prev, optimisticMsg]);
    socket.emit('sendMessage', payload);
    setShowForwardModal(false);
    setForwardingMessage(null);
  };

  const clearChat = (type) => {
    if (!selected) return;
    if (isAccountBlocked) {
      showToast('Your account is blocked', 'error');
      return;
    }
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
    if (isAccountBlocked) {
      showToast('Your account is blocked', 'error');
      return;
    }
    
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
    if (isAccountBlocked) return;
    const now = Date.now();
    if (now - lastTypingEmitRef.current > TYPING_EMIT_INTERVAL_MS) {
      socket.emit("typing", { from: user._id, to: selected._id });
      lastTypingEmitRef.current = now;
    }
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
    if (messagesEndRef.current && messagesEndRef.current.parentNode) {
      messagesEndRef.current.parentNode.scrollTo({
        top: messagesEndRef.current.parentNode.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages]);

  const logout = () => {
    endSession();
  };

  // ─── Accepted chats (for Chats tab) ──────────────────────────────────────
  const acceptedUserList = useMemo(() => {
    return users
      .filter(u => isAccepted(u._id))
      .sort((a, b) => {
        const aRoom = room(user._id, a._id);
        const bRoom = room(user._id, b._id);
        const aTime = conversationActivityMap[aRoom] || 0;
        const bTime = conversationActivityMap[bRoom] || 0;
        if (aTime !== bTime) return bTime - aTime;
        return String(a.username || '').localeCompare(String(b.username || ''));
      });
  }, [users, acceptedSet, conversationActivityMap, user._id]);

  const forwardTargets = useMemo(() => {
    const currentId = selected?._id ? String(selected._id) : '';
    return [
      ...sortedGroups.filter(item => String(item._id) !== currentId),
      ...acceptedUserList.filter(item => String(item._id) !== currentId),
    ];
  }, [sortedGroups, acceptedUserList, selected?._id]);

  const filteredForwardTargets = useMemo(() => {
    const query = forwardSearch.trim().toLowerCase();
    if (!query) return forwardTargets;
    return forwardTargets.filter(item => {
      const name = (item.username || item.name || '').toLowerCase();
      const label = item.isGroup ? 'group' : 'chat';
      return name.includes(query) || label.includes(query);
    });
  }, [forwardTargets, forwardSearch]);

  // ─── Render: sidebar content per tab ─────────────────────────────────────
  const renderSidebarContent = () => {
    if (sidebarTab === 'chats') {
      return (
        <>
          {/* Groups first */}
          {sortedGroups.filter(u => !discoverSearch.trim() || (u.username || u.name || '').toLowerCase().includes(discoverSearch.trim().toLowerCase())).map(u => {
            const unread = unreadCounts[u._id] || 0;
            return (
              <div key={u._id} className={`chat-list-item-active flex items-center gap-4 p-4 rounded-2xl group cursor-pointer ${selected?._id === u._id ? 'bg-primary-container/10 border-l-4 border-primary' : 'hover:bg-surface-container-high'}`} onClick={() => openChat(u)}>
                <div className="relative">
                  <div className="w-12 h-12 rounded-full bg-tertiary-container flex items-center justify-center text-on-tertiary-container font-bold text-headline-sm overflow-hidden" onClick={e => { e.stopPropagation(); if (u.avatar) handleAvatarClick(u.avatar); }}>
                    {u.avatar ? <img src={u.avatar} alt="g" className="w-full h-full object-cover" /> : (u.username || 'G').slice(0, 1).toUpperCase()}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <p className="text-label-md font-label-md text-on-surface truncate">{u.username || 'Group'}</p>
                    <span className="text-label-sm font-label-sm text-on-surface-variant">Group</span>
                  </div>
                </div>
                {unread > 0 && <div className="bg-primary text-white text-[10px] font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">{unread > 99 ? '99+' : unread}</div>}
              </div>
            );
          })}
          {/* Accepted DMs */}
          {acceptedUserList.filter(u => !discoverSearch.trim() || (u.username || '').toLowerCase().includes(discoverSearch.trim().toLowerCase())).map(u => {
            const unread = unreadCounts[u._id] || 0;
            const isOnline = onlineUsers[u._id] || false;
            return (
              <div key={u._id} className={`chat-list-item-active flex items-center gap-4 p-4 rounded-2xl group cursor-pointer ${selected?._id === u._id ? 'bg-primary-container/10 border-l-4 border-primary' : 'hover:bg-surface-container-high'}`} onClick={() => openChat(u)}>
                <div className="relative" onClick={e => { e.stopPropagation(); openUserProfile(u); }}>
                  <div className="w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container font-bold text-headline-sm overflow-hidden">
                    {u.avatar ? <img src={u.avatar} alt="u" className="w-full h-full object-cover" /> : (u.username || 'U').slice(0, 1).toUpperCase()}
                  </div>
                  {isOnline && <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-surface rounded-full"></span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <p className="text-label-md font-label-md text-on-surface truncate">{u.username || 'user'}</p>
                  </div>
                </div>
                {unread > 0 && <div className="bg-primary text-white text-[10px] font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">{unread > 99 ? '99+' : unread}</div>}
              </div>
            );
          })}
          {groups.length === 0 && acceptedUserList.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-on-surface-variant opacity-70">
              <span className="material-symbols-outlined text-[40px] mb-2">chat</span>
              <div>No chats yet</div>
            </div>
          )}
        </>
      );
    }

    if (sidebarTab === 'requests') {
      const searchStr = discoverSearch.trim().toLowerCase();
      const pendingRequestUsers = chatRequests.filter(u => !messageRequestSenderIdSet.has(String(u._id)) && (!searchStr || (u.username || '').toLowerCase().includes(searchStr)));
      const acceptedFollowBackRequests = requestHistory.filter(h => h?.status === 'accepted');
      const filteredMessageRequests = messageRequests.filter(req => !searchStr || (req.from?.username || '').toLowerCase().includes(searchStr));

      return (
        <div className="flex flex-col gap-2 py-2" style={{ minHeight: 0 }}>
          {/* Message Requests Collapsible */}
          <div className="overflow-hidden">
            <button 
              className="w-full flex items-center justify-between p-4 hover:bg-surface-container-high transition-colors rounded-xl"
              onClick={() => toggleSection('messageRequests')}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">mark_email_unread</span>
                <h3 className="text-label-md font-label-md text-on-surface">Message Requests</h3>
                {filteredMessageRequests.length > 0 && <span className="w-2 h-2 rounded-full bg-primary"></span>}
              </div>
              <span className="material-symbols-outlined text-on-surface-variant transition-transform duration-200" style={{ transform: expandedSections.messageRequests ? 'rotate(180deg)' : '' }}>expand_more</span>
            </button>
            
            {expandedSections.messageRequests && (
              <div className="px-2 pb-2">
                {filteredMessageRequests.length === 0 ? (
                  <div className="text-center py-6 text-on-surface-variant">
                    <span className="material-symbols-outlined block text-[32px] opacity-50 mb-2">drafts</span>
                    <span className="text-body-sm">No message requests</span>
                  </div>
                ) : filteredMessageRequests.map((req, idx) => {
                  const from = req?.from || {};
                  const preview = req?.latestMedia ? (req.latestMedia.name || 'Attachment') : (req?.latestMessage || 'Message request');
                  return (
                    <div key={`${from?._id || idx}-${req?.latestCreatedAt || idx}`} className="flex flex-col gap-2 p-3 rounded-xl hover:bg-surface-container transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-bold shrink-0 overflow-hidden">
                          {from?.avatar ? <img src={from.avatar} alt="u" className="w-full h-full object-cover" /> : (from?.username || 'U').slice(0, 1).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-label-md font-label-md text-on-surface truncate">{from?.username || 'Unknown user'}</div>
                          <div className="text-body-sm text-on-surface-variant truncate">{preview}</div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-1">
                        <button className="flex-1 bg-primary text-on-primary hover:bg-primary/90 px-3 py-1.5 rounded-lg text-label-sm font-label-sm font-bold transition-colors" onClick={() => acceptChatRequest(from._id)}>Accept</button>
                        <button className="flex-1 bg-transparent border border-outline text-on-surface hover:bg-surface-container px-3 py-1.5 rounded-lg text-label-sm font-label-sm font-bold transition-colors" onClick={() => declineChatRequest(from._id)}>Decline</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pending Requests Collapsible */}
          <div className="overflow-hidden">
            <button 
              className="w-full flex items-center justify-between p-4 hover:bg-surface-container-high transition-colors rounded-xl"
              onClick={() => toggleSection('pendingRequests')}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">schedule</span>
                <h3 className="text-label-md font-label-md text-on-surface">Pending Requests</h3>
                {pendingRequestUsers.length > 0 && <span className="w-2 h-2 rounded-full bg-primary"></span>}
              </div>
              <span className="material-symbols-outlined text-on-surface-variant transition-transform duration-200" style={{ transform: expandedSections.pendingRequests ? 'rotate(180deg)' : '' }}>expand_more</span>
            </button>
            
            {expandedSections.pendingRequests && (
              <div className="px-2 pb-2">
                {pendingRequestUsers.length === 0 ? (
                  <div className="text-center py-6 text-on-surface-variant">
                    <span className="material-symbols-outlined block text-[32px] opacity-50 mb-2">hourglass_empty</span>
                    <span className="text-body-sm">No pending requests</span>
                  </div>
                ) : pendingRequestUsers.map(u => (
                  <div key={u._id} className="flex flex-col gap-2 p-3 rounded-xl hover:bg-surface-container transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-bold shrink-0 overflow-hidden">
                        {u.avatar ? <img src={u.avatar} alt="u" className="w-full h-full object-cover" /> : (u.username || 'U').slice(0, 1).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-label-md font-label-md text-on-surface truncate">{u.username}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <button className="flex-1 bg-primary text-on-primary hover:bg-primary/90 px-3 py-1.5 rounded-lg text-label-sm font-label-sm font-bold transition-colors" onClick={() => acceptChatRequest(u._id)}>Accept</button>
                      <button className="flex-1 bg-transparent border border-outline text-on-surface hover:bg-surface-container px-3 py-1.5 rounded-lg text-label-sm font-label-sm font-bold transition-colors" onClick={() => declineChatRequest(u._id)}>Decline</button>
                      {!isFollowing(u._id) && !hasPendingRequest(u._id) && (
                        <button className="w-full bg-secondary-container text-on-secondary-container hover:bg-secondary-container/80 px-3 py-1.5 rounded-lg text-label-sm font-label-sm font-bold transition-colors" onClick={() => toggleFollow(u._id)}>Follow Back</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Follow Back / History Collapsible */}
          <div className="overflow-hidden">
            <button 
              className="w-full flex items-center justify-between p-4 hover:bg-surface-container-high transition-colors rounded-xl"
              onClick={() => toggleSection('followBack')}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">history</span>
                <h3 className="text-label-md font-label-md text-on-surface">Follow Back / History</h3>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant transition-transform duration-200" style={{ transform: expandedSections.followBack ? 'rotate(180deg)' : '' }}>expand_more</span>
            </button>
            
            {expandedSections.followBack && (
              <div className="px-2 pb-2">
                {acceptedFollowBackRequests.length === 0 && requestHistory.length === 0 ? (
                  <div className="text-center py-6 text-on-surface-variant">
                    <span className="material-symbols-outlined block text-[32px] opacity-50 mb-2">history</span>
                    <span className="text-body-sm">No request history yet</span>
                  </div>
                ) : requestHistory.filter(h => !searchStr || (h?.from?.username || '').toLowerCase().includes(searchStr)).map((h, idx) => {
                  const fromRaw = h?.from;
                  const from = fromRaw && typeof fromRaw === 'object' ? fromRaw : {};
                  const fromId = String(from?._id || fromRaw || `hist-${idx}`);
                  const fromUsername = from?.username || 'Unknown user';
                  const fromAvatar = from?.avatar;
                  const status = h?.status || 'pending';
                  const alreadyFollowing = isFollowing(fromId);
                  const alreadyPending = hasPendingRequest(fromId);
                  const isValidId = fromId && fromId.length > 6 && !fromId.startsWith('hist-');
                  
                  return (
                    <div key={`${fromId}-${h?.requestedAt || idx}`} className="flex flex-col gap-2 p-3 rounded-xl hover:bg-surface-container transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-bold shrink-0 overflow-hidden">
                          {fromAvatar ? <img src={fromAvatar} alt="u" className="w-full h-full object-cover" /> : (fromUsername || 'U').slice(0, 1).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-label-md font-label-md text-on-surface truncate">{fromUsername}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${status === 'accepted' ? 'bg-green-500/20 text-green-500 border border-green-500/30' : status === 'declined' ? 'bg-red-500/20 text-red-500 border border-red-500/30' : 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30'}`}>{status}</span>
                            <span className="text-[10px] text-on-surface-variant">{new Date(h?.respondedAt || h?.requestedAt || Date.now()).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      {status === 'accepted' && isValidId && (
                        <div className="mt-1">
                          <button
                            className={`w-full px-3 py-1.5 rounded-lg text-label-sm font-label-sm font-bold transition-colors ${alreadyFollowing || alreadyPending ? 'bg-transparent border border-outline text-on-surface-variant cursor-default' : 'bg-primary text-on-primary hover:bg-primary/90'}`}
                            disabled={alreadyFollowing || alreadyPending}
                            onClick={() => {
                              if (!alreadyFollowing && !alreadyPending) toggleFollow(fromId);
                            }}
                          >
                            {alreadyFollowing ? '✓ Following' : (alreadyPending ? '⏳ Pending...' : '+ Follow Back')}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (sidebarTab === 'discover') {
      const displayUsers = discoverSearch.trim() 
          ? discoverSearchResults
          : suggestions;

      return (
        <div className="flex flex-col gap-2 py-2" style={{ minHeight: 0 }}>
          {displayUsers.length === 0 ? (
            <div className="text-center py-10 text-on-surface-variant">
              <span className="material-symbols-outlined block text-[40px] opacity-50 mb-2">search_off</span>
              <span className="text-body-sm">{discoverSearch.trim() ? "No users found" : "No suggestions right now"}</span>
            </div>
          ) : displayUsers.map(u => {
            const following = isFollowing(u._id);
            const pending = hasPendingRequest(u._id);
            const blocked = blockedSet.has(String(u._id));
            
            return (
              <div key={u._id} className="flex flex-col gap-3 p-3 rounded-xl bg-surface-container-low border border-outline-variant hover:bg-surface-container transition-colors">
                <div className="flex items-center gap-3 flex-1 min-w-0" onClick={() => openUserProfile(u)} style={{ cursor: 'pointer' }} title="View profile">
                  <div className="w-12 h-12 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-bold shrink-0 overflow-hidden text-headline-sm">
                    {u.avatar ? <img src={u.avatar} alt="u" className="w-full h-full object-cover" /> : (u.username || 'U').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-label-md font-label-md text-on-surface truncate">{u.username}</div>
                    {pending && <div className="text-[10px] font-bold text-yellow-500 mt-1">⏳ Pending</div>}
                  </div>
                </div>
                
                <div className="flex gap-2">
                  {blocked ? (
                    <button className="flex-1 bg-error/10 text-error hover:bg-error/20 px-3 py-1.5 rounded-lg text-label-sm font-label-sm font-bold transition-colors" onClick={() => unblockUser(u._id)}>Unblock</button>
                  ) : (
                    <>
                      <button
                        className={`flex-1 px-3 py-1.5 rounded-lg text-label-sm font-label-sm font-bold transition-colors ${following || pending ? 'bg-transparent border border-outline text-on-surface-variant' : 'bg-primary text-on-primary hover:bg-primary/90'}`}
                        onClick={() => toggleFollow(u._id)}
                      >
                        {pending ? 'Cancel' : (following ? 'Unfollow' : 'Follow')}
                      </button>
                      {!isAccepted(u._id) && (
                        <button className="flex-1 bg-secondary-container text-on-secondary-container hover:bg-secondary-container/80 px-3 py-1.5 rounded-lg text-label-sm font-label-sm font-bold transition-colors" onClick={() => setShowRequestModal(u)}>
                          Message
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={`chat-root ${isLightMode ? 'light light-theme' : 'dark'}`}>
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

    <div className="fixed inset-0 flex w-full overflow-hidden text-body-md font-body-md bg-surface text-on-surface">
        {/* Mobile Sidebar Overlay Backdrop */}
        {!sidebarCollapsed && (
          <div 
            className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm" 
            onClick={() => setSidebarCollapsed(true)} 
          />
        )}
        {/* SideNavBar Component */}
        <aside className={`fixed left-0 top-0 h-full flex flex-col pb-8 w-64 bg-surface-container-low border-r border-outline-variant z-50 transition-all duration-300 ${sidebarCollapsed ? 'sidebar-collapsed -translate-x-full md:translate-x-0' : 'translate-x-0'} pt-0`} id="sidebar">
          <div className="px-6 pt-2 pb-2 flex items-center justify-start">
            <button className="btn-interact p-2 text-on-surface-variant hover:bg-surface-container rounded-lg" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
                <span className="material-symbols-outlined" data-icon="menu">menu</span>
            </button>
          </div>
          <div className="px-6 mb-8 flex items-center gap-3 logo-container">
            <div className="w-8 h-8 min-w-[32px] bg-primary rounded-lg flex items-center justify-center">
                <span className="material-symbols-outlined text-white text-[20px]" data-icon="bolt">bolt</span>
            </div>
            <span className="logo-text text-headline-sm font-headline-sm font-bold text-primary truncate">Nexus Chat</span>
          </div>
          <div className="flex-1 space-y-1">
            <a className={`nav-item flex items-center gap-4 ${sidebarTab === 'chats' ? 'bg-primary-container/20 text-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'} rounded-xl px-4 py-3 mx-2 active:scale-95 cursor-pointer`} onClick={() => { setSidebarTab('chats'); setDiscoverSearch(''); if (isMobileViewport()) setSidebarCollapsed(true); }}>
                <span className="material-symbols-outlined shrink-0" data-icon="chat" style={sidebarTab === 'chats' ? { fontVariationSettings: '"FILL" 1' } : {}}>chat</span>
                <span className="nav-text text-label-md font-label-md truncate">Chats</span>
            </a>
            <a className={`nav-item flex items-center gap-4 ${sidebarTab === 'requests' ? 'bg-primary-container/20 text-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'} rounded-xl px-4 py-3 mx-2 active:scale-95 cursor-pointer`} onClick={() => { setSidebarTab('requests'); setDiscoverSearch(''); if (isMobileViewport()) setSidebarCollapsed(true); }}>
                <span className="material-symbols-outlined shrink-0" data-icon={requestBadgeCount > 0 ? "mark_email_unread" : "mail"}>{requestBadgeCount > 0 ? "mark_email_unread" : "mail"}</span>
                <span className="nav-text text-label-md font-label-md truncate">Requests</span>
                {requestBadgeCount > 0 && <span className="tab-badge bg-primary text-white rounded-full px-2 text-[10px] ml-auto">{requestBadgeCount}</span>}
            </a>
            <a className={`nav-item flex items-center gap-4 ${sidebarTab === 'discover' ? 'bg-primary-container/20 text-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'} rounded-xl px-4 py-3 mx-2 active:scale-95 cursor-pointer`} onClick={() => { setSidebarTab('discover'); setDiscoverSearch(''); loadSuggestions(); if (isMobileViewport()) setSidebarCollapsed(true); }}>
                <span className="material-symbols-outlined shrink-0" data-icon="contacts">contacts</span>
                <span className="nav-text text-label-md font-label-md truncate">Explore</span>
            </a>
            <a className="nav-item flex items-center gap-4 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high px-4 py-3 mx-2 rounded-xl active:scale-95 cursor-pointer" onClick={() => { setShowGroupModal(true); if (isMobileViewport()) setSidebarCollapsed(true); }}>
                <span className="material-symbols-outlined shrink-0" data-icon="group_add">group_add</span>
                <span className="nav-text text-label-md font-label-md truncate">Create Group</span>
            </a>
            <a className="nav-item flex items-center gap-4 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high px-4 py-3 mx-2 rounded-xl active:scale-95 cursor-pointer" onClick={() => { openSettingsModal(); if (isMobileViewport()) setSidebarCollapsed(true); }}>
                <span className="material-symbols-outlined shrink-0" data-icon="settings">settings</span>
                <span className="nav-text text-label-md font-label-md truncate">Settings</span>
            </a>
          </div>
          <div className="mt-auto px-4 space-y-2 pb-4">
            <div className="px-2">
                <button className="btn-interact w-full text-on-surface-variant hover:bg-surface-container-high rounded-xl py-2 flex items-center gap-3" onClick={() => { setIsLightMode(!isLightMode); if (isMobileViewport()) setSidebarCollapsed(true); }}>
                    <span className="material-symbols-outlined text-[20px] shrink-0" data-icon={isLightMode ? 'dark_mode' : 'light_mode'}>{isLightMode ? 'dark_mode' : 'light_mode'}</span>
                    <span className="btn-text text-label-md font-label-md truncate">{isLightMode ? 'Dark Mode' : 'Light Mode'}</span>
                </button>
            </div>
            <div className="pt-2 border-t border-outline-variant">
                <div className="flex items-center gap-3 px-2 py-2 cursor-pointer rounded-xl hover:bg-surface-container-high transition-colors" onClick={() => { openProfileModal(); if (isMobileViewport()) setSidebarCollapsed(true); }}>
                    {localUser.avatar ? (
                        <img alt="Active User" className="w-10 h-10 min-w-[40px] rounded-full object-cover border-2 border-primary/20" src={localUser.avatar} />
                    ) : (
                        <div className="w-10 h-10 min-w-[40px] rounded-full flex items-center justify-center bg-primary text-white font-bold border-2 border-primary/20">{initials}</div>
                    )}
                    <div className="user-details overflow-hidden">
                        <p className="text-label-md font-label-md text-on-surface truncate">{displayName}</p>
                        <p className="text-label-sm font-label-sm text-primary">Active Now</p>
                    </div>
                </div>
            </div>
            <div className="pt-1 px-2">
                <button className="btn-interact w-full text-on-surface-variant hover:text-error rounded-xl py-2 flex items-center gap-3" onClick={() => { logout(); if (isMobileViewport()) setSidebarCollapsed(true); }}>
                    <span className="material-symbols-outlined text-[20px] shrink-0" data-icon="logout">logout</span>
                    <span className="btn-text text-label-md font-label-md truncate">Logout</span>
                </button>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className={`flex-1 ${sidebarCollapsed ? 'ml-0 md:ml-20' : 'ml-0 md:ml-64'} flex overflow-hidden transition-all duration-300`} id="main-content">
          {/* Conversation List Column */}
          <section className={`w-full md:w-80 lg:w-96 flex-col bg-surface-container-lowest border-r border-outline-variant ${selected ? 'hidden md:flex' : 'flex'}`}>
            <div className="p-6 pb-2 shrink-0">
              <div className="flex items-center gap-3 mb-4">
                <button 
                  className="md:hidden btn-interact p-2 -ml-2 text-on-surface-variant hover:bg-surface-container rounded-lg" 
                  onClick={() => setSidebarCollapsed(false)}
                >
                  <span className="material-symbols-outlined">menu</span>
                </button>
                <h2 className="text-headline-md font-headline-md text-on-surface m-0">
                  {sidebarTab === 'chats' ? 'Messages' : sidebarTab === 'requests' ? 'Requests' : 'Explore'}
                </h2>
              </div>
              <div className="relative mb-2">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]" data-icon="search">search</span>
                <input 
                  className="input-focus-expand w-full bg-surface-container text-body-md font-body-md rounded-xl py-2.5 pl-10 pr-4 border-none focus:ring-2 focus:ring-primary/20 outline-none" 
                  placeholder={sidebarTab === 'discover' ? "Search all users..." : "Search..."} 
                  value={discoverSearch} 
                  onChange={e => setDiscoverSearch(e.target.value)} 
                  type="text" 
                  name="sidebar-search-input"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 space-y-1 min-h-0" style={{ WebkitOverflowScrolling: 'touch' }}>
              {renderSidebarContent()}
            </div>
          </section>

          {/* Chat Window Column */}
          <section className={`flex-1 flex-col bg-surface overflow-hidden relative ${selected ? 'flex' : 'hidden md:flex'}`}>
            {selected ? (
              <>
                {/* TopNavBar Component */}
                <header className="flex justify-between items-center w-full px-4 lg:px-8 h-16 bg-surface/80 backdrop-blur-xl border-b border-outline-variant sticky top-0 z-30 shadow-sm shrink-0">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <button className="md:hidden btn-interact p-2 text-on-surface-variant rounded-lg shrink-0" onClick={() => setSelected(null)}>
                      <span className="material-symbols-outlined" data-icon="arrow_back">arrow_back</span>
                    </button>
                    <div className="flex items-center gap-4 cursor-pointer flex-1 min-w-0" onClick={selected.isGroup ? openGroupDetails : () => openUserProfile(selected)}>
                      <div className="relative shrink-0">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center bg-secondary-container text-on-secondary-container font-bold overflow-hidden">
                          {selected.avatar ? <img alt="avatar" className="w-full h-full object-cover" src={selected.avatar} /> : (selected.username || 'U').slice(0, 1).toUpperCase()}
                        </div>
                        {!selected.isGroup && onlineUsers[selected._id] && (
                          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-surface rounded-full"></span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h1 className="text-headline-sm font-headline-sm text-on-surface flex items-center gap-2 truncate">
                          <span className="truncate" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>{selected.username || 'User'}</span>
                            {selected.verified && <VerifiedBadge />}
                          </span>
                          {selected.isGroup && <span className="text-[14px] text-on-surface-variant material-symbols-outlined shrink-0" onClick={(e) => { e.stopPropagation(); setEditingGroupId(selected._id); setEditGroupNameStr(selected.username || ''); }}>edit</span>}
                        </h1>
                        <p className={`text-label-sm font-label-sm truncate ${onlineUsers[selected._id] ? 'text-primary' : 'text-on-surface-variant'}`}>
                          {selected.isGroup ? `${(selected.members || []).length} members` : (onlineUsers[selected._id] ? 'Online' : 'Offline')}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 relative">

                    <button className="btn-interact p-2 text-on-surface-variant hover:bg-surface-container rounded-lg hidden sm:block">
                      <span className="material-symbols-outlined" data-icon="video_call">video_call</span>
                    </button>
                    <button className="btn-interact p-2 text-on-surface-variant hover:bg-surface-container rounded-lg hidden sm:block">
                      <span className="material-symbols-outlined" data-icon="call">call</span>
                    </button>
                    <button className="btn-interact p-2 text-on-surface-variant hover:bg-surface-container rounded-lg" onClick={() => setOpenHeaderMenu(v => !v)}>
                      <span className="material-symbols-outlined" data-icon="more_vert">more_vert</span>
                    </button>
                    
                    {openHeaderMenu && (
                      <div className="absolute top-12 right-0 bg-surface-container-highest shadow-lg rounded-xl overflow-hidden min-w-[150px] z-50 py-2 border border-outline-variant chat-header-menu">
                        {!selected.isGroup && (
                          <button className="w-full text-left px-4 py-2 hover:bg-surface-container-high text-body-md" onClick={() => { toggleFollow(selected._id); setOpenHeaderMenu(false); }}>
                            {isFollowing(selected._id) ? 'Unfollow' : (hasPendingRequest(selected._id) ? 'Cancel Request' : 'Follow')}
                          </button>
                        )}
                        {!selected.isGroup && (
                          <button className="w-full text-left px-4 py-2 hover:bg-surface-container-high text-body-md text-error" onClick={() => { blockUser(selected._id); setOpenHeaderMenu(false); }}>
                            Block
                          </button>
                        )}
                        <button className="w-full text-left px-4 py-2 hover:bg-surface-container-high text-body-md text-error" onClick={() => { setShowClearModal(true); setOpenHeaderMenu(false); }}>
                          Clear chat
                        </button>
                      </div>
                    )}
                  </div>
                </header>

                {/* Messages Thread */}
                <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 flex flex-col relative min-h-0">
                  {visibleMessages.length === 0 ? (
                    <div className="m-auto text-center text-on-surface-variant">
                      <div className="material-symbols-outlined text-[48px] opacity-50 mb-2">chat_bubble</div>
                      <p>No messages here yet.</p>
                    </div>
                  ) : (
                    visibleMessages.map((m, i, arr) => {
                      const isMe = m.from === user._id;
                      const timeStr = formatTime(m.createdAt || new Date());
                      let showTime = false;
                      if (i === 0) { showTime = true; }
                      else {
                        const prev = arr[i - 1];
                        if (formatTime(prev.createdAt || new Date()) !== timeStr) { showTime = true; }
                      }

                      return (
                        <React.Fragment key={m._id || i}>
                          {showTime && (
                            <div className="flex justify-center my-4 message-entry">
                              <span className="px-3 py-1 bg-surface-container text-label-sm font-label-sm text-on-surface-variant rounded-full tracking-wider">{timeStr}</span>
                            </div>
                          )}
                          <div className={`flex flex-col ${isMe ? 'items-end self-end' : 'items-start'} max-w-[85%] lg:max-w-[70%] message-entry`}>
                            {!isMe && selected.isGroup && (
                              <div className="text-label-sm font-label-sm text-on-surface-variant ml-12 mb-1">
                                {m.from?.username || 'User'}
                              </div>
                            )}
                            <div className={`flex items-end gap-2 ${isMe ? 'justify-end flex-row-reverse' : ''} relative group/msg`}>
                              {!isMe && (
                                <div className="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-sm font-bold shrink-0 overflow-hidden cursor-pointer" onClick={() => openUserProfile(m.from)}>
                                  {m.from?.avatar ? <img src={m.from.avatar} alt="u" className="w-full h-full object-cover" /> : (m.from?.username || 'U').slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              
                              <div className="flex flex-col gap-1">
                                {m.replyTo && (
                                  <div className="text-xs bg-surface-variant text-on-surface-variant p-2 rounded-lg opacity-80 border-l-2 border-primary mb-1">
                                    <div className="font-bold">{m.replyTo.from === user._id || m.replyTo.from?._id === user._id ? 'You' : (m.replyTo.from?.username || selected?.username || 'User')}</div>
                                    <div className="truncate max-w-xs">{m.replyTo.message ? m.replyTo.message : (m.replyTo.media ? 'Attachment' : '')}</div>
                                  </div>
                                )}

                                <div className={`${isMe ? 'bg-primary text-on-primary rounded-2xl rounded-br-none' : 'bg-surface-container-high text-on-surface rounded-2xl rounded-bl-none'} p-3 lg:p-4 shadow-sm hover:shadow-md transition-shadow relative`}>
                                  {m.isForwarded && <div className="text-[10px] italic opacity-70 mb-1 flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">forward</span> Forwarded</div>}
                                  
                                  {m.media && (
                                    <div className="mb-2">
                                      {m.media.type?.startsWith('image/') ? (
                                        <img src={getMediaSrc(m.media)} alt="media" className="max-w-[200px] lg:max-w-[300px] rounded-lg cursor-zoom-in" onClick={() => setViewImageUrl(getMediaSrc(m.media))} />
                                      ) : m.media.type?.startsWith('video/') ? (
                                        <video controls className="max-w-[200px] lg:max-w-[300px] rounded-lg">
                                          <source src={getMediaSrc(m.media)} type={m.media.type} />
                                        </video>
                                      ) : m.media.type?.startsWith('audio/') ? (
                                        <audio controls className="max-w-[200px] lg:max-w-[300px]">
                                          <source src={getMediaSrc(m.media)} type={m.media.type} />
                                        </audio>
                                      ) : (
                                        <a href={getMediaSrc(m.media)} download={m.media.name} className="flex items-center gap-2 bg-black/10 p-2 rounded-lg hover:bg-black/20 transition">
                                          <span className="material-symbols-outlined">description</span> {m.media.name}
                                        </a>
                                      )}
                                    </div>
                                  )}
                                  
                                  {m.message && <p className="text-body-md font-body-md whitespace-pre-wrap break-words">{m.message}</p>}
                                </div>
                              </div>

                              <span className="text-[10px] font-label-sm text-on-surface-variant mb-1 shrink-0 px-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                                {formatTime(m.createdAt)}
                              </span>

                              <div className={`absolute top-0 ${isMe ? '-left-8' : '-right-8'} opacity-0 group-hover/msg:opacity-100 transition-opacity z-10`}>
                                <button className="p-1 text-on-surface-variant hover:text-primary rounded-full bg-surface shadow-sm" onClick={() => setOpenMenuId(openMenuId === (m._id || i) ? null : (m._id || i))}>
                                  <span className="material-symbols-outlined text-[16px]">more_vert</span>
                                </button>
                                {openMenuId === (m._id || i) && (
                                  <div className="absolute top-6 left-0 bg-surface-container-highest shadow-lg rounded-xl overflow-hidden min-w-[120px] z-20 py-1 border border-outline-variant message-options">
                                    <button className="w-full text-left px-3 py-1.5 hover:bg-surface-container-high text-xs" onClick={() => { setReplyingTo(m); setOpenMenuId(null); }}>Reply</button>
                                    <button className="w-full text-left px-3 py-1.5 hover:bg-surface-container-high text-xs" onClick={() => { openForwardModal(m); setOpenMenuId(null); }}>Forward</button>
                                    {isMe && <button className="w-full text-left px-3 py-1.5 hover:bg-surface-container-high text-xs" onClick={() => { setEditingMessage(m); setMsg(m.message); setOpenMenuId(null); }}>Edit</button>}
                                    <button className="w-full text-left px-3 py-1.5 hover:bg-surface-container-high text-xs text-error" onClick={() => { setShowDeleteModal(m); setOpenMenuId(null); }}>Delete</button>
                                  </div>
                                )}
                              </div>
                            </div>
                            {isMe && (
                              <div className="flex items-center gap-1 mt-1 mr-1">
                                {m.isEdited && <span className="text-[10px] italic text-on-surface-variant mr-1">Edited</span>}
                                <span className="text-[10px] font-label-sm text-primary">{m.seen ? 'Read' : 'Sent'}</span>
                                <span className="material-symbols-outlined text-[12px] text-primary" data-icon={m.seen ? 'done_all' : 'check'}>{m.seen ? 'done_all' : 'check'}</span>
                              </div>
                            )}
                          </div>
                        </React.Fragment>
                      );
                    })
                  )}
                  
                  {typingUser === selected._id && (
                    <div className="flex items-center gap-2 text-on-surface-variant text-sm italic animation-slide-up-fade">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-primary/50 rounded-full animate-bounce"></span>
                        <span className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                        <span className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                      </div>
                      {selected.username || 'User'} is typing...
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input Field */}
                <footer className="p-4 lg:p-6 bg-surface-container-lowest border-t border-outline-variant shrink-0">
                  {replyingTo && (
                    <div className="flex items-center justify-between bg-surface-variant p-2 px-4 rounded-xl mb-3 text-sm">
                      <div className="truncate">
                        <span className="font-bold text-primary mr-2">Replying to {replyingTo.from === user._id || replyingTo.from?._id === user._id ? 'yourself' : (replyingTo.from?.username || 'User')}</span>
                        <span className="text-on-surface-variant">{replyingTo.message || 'Attachment'}</span>
                      </div>
                      <button className="text-on-surface-variant hover:text-error shrink-0 ml-2" onClick={() => setReplyingTo(null)}>
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  )}
                  {selectedMedia && (
                    <div className="flex items-center justify-between bg-surface-variant p-2 px-4 rounded-xl mb-3 text-sm">
                      <div className="flex items-center gap-2 truncate">
                        <span className="material-symbols-outlined">attachment</span>
                        <span>{selectedMedia.name}</span>
                      </div>
                      <button className="text-on-surface-variant hover:text-error shrink-0 ml-2" onClick={() => setSelectedMedia(null)}>
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  )}
                  {editingMessage && (
                    <div className="flex items-center justify-between bg-surface-variant p-2 px-4 rounded-xl mb-3 text-sm border border-primary/30">
                      <div className="truncate">
                        <span className="font-bold text-primary mr-2">Editing message</span>
                      </div>
                      <button className="text-on-surface-variant hover:text-error shrink-0 ml-2" onClick={() => { setEditingMessage(null); setMsg(""); }}>
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  )}
                  <div className="max-w-max-width-chat mx-auto relative flex items-center gap-2 lg:gap-3">
                    <button className="btn-interact p-2 text-on-surface-variant hover:bg-surface-container rounded-full" onClick={onMediaBtnClick} title="Attach file">
                      <span className="material-symbols-outlined" data-icon="attach_file">attach_file</span>
                    </button>
                    <input ref={mediaFileRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt" style={{ display: 'none' }} onChange={onMediaFile} />
                    
                    <div className="flex-1 relative group emoji-picker-container">
                      <input 
                        className="input-focus-expand w-full bg-surface-container-low text-body-md lg:text-body-lg font-body-lg px-4 lg:px-6 py-3 lg:py-4 rounded-2xl border-b-2 border-transparent focus:border-primary focus:ring-0 outline-none shadow-sm" 
                        placeholder={editingMessage ? "Edit message..." : "Type a message..."} 
                        type="text" 
                        value={msg} 
                        onChange={handleTyping} 
                        onKeyDown={onKeyDown}
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <button className="hidden md:flex btn-interact p-2 text-on-surface-variant hover:text-primary" onClick={() => setShowEmojiPicker(!showEmojiPicker)} title="Add emoji">
                          <span className="material-symbols-outlined" data-icon="sentiment_satisfied">sentiment_satisfied</span>
                        </button>
                      </div>
                      {showEmojiPicker && (
                        <div className="absolute bottom-[110%] right-0 z-50 shadow-2xl rounded-2xl overflow-hidden">
                          <EmojiPicker 
                            theme={isLightMode ? 'light' : 'dark'} 
                            onEmojiClick={(emojiObject) => setMsg(prev => prev + emojiObject.emoji)}
                          />
                        </div>
                      )}
                    </div>
                    <button className="btn-interact w-10 h-10 lg:w-12 lg:h-12 bg-primary text-on-primary rounded-full flex items-center justify-center shadow-lg hover:shadow-primary/30 shrink-0" onClick={send}>
                      <span className="material-symbols-outlined" data-icon="send" style={{ fontVariationSettings: '"FILL" 1' }}>send</span>
                    </button>
                  </div>
                </footer>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-surface">
                <div className="w-24 h-24 bg-primary-container rounded-3xl flex items-center justify-center mb-6 shadow-lg shadow-primary/20 animate-slide-up-fade">
                  <span className="material-symbols-outlined text-[48px] text-on-primary" style={{ fontVariationSettings: '"FILL" 1' }}>bolt</span>
                </div>
                <h2 className="text-headline-lg font-headline-lg text-on-surface mb-2 animate-slide-up-fade" style={{ animationDelay: '0.1s' }}>Welcome, {displayName}!</h2>
                <p className="text-body-lg font-body-lg text-on-surface-variant max-w-md animate-slide-up-fade" style={{ animationDelay: '0.2s' }}>
                  {acceptedUserList.length === 0
                    ? 'Head to Explore to find and connect with people.'
                    : 'Select a chat from the sidebar to start messaging.'}
                </p>
              </div>
            )}
          </section>
        </main>
      </div>

      {/* ─── MODALS ──────────────────────────────────────────────────────── */}

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

      {/* Forward Message Modal */}
      {showForwardModal && forwardingMessage && (
        <div className="modal-overlay">
          <div className="modal-content forward-modal" style={{ maxWidth: '420px' }}>
            <h2>Forward message</h2>
            <div className="forward-preview">
              <div className="forward-preview-label">Selected message</div>
              {forwardingMessage.media ? (
                <div className="forward-preview-media">Attachment{forwardingMessage.media.name ? `: ${forwardingMessage.media.name}` : ''}</div>
              ) : (
                <div className="forward-preview-text">{getMessagePreview(forwardingMessage.message)}</div>
              )}
            </div>
            <input
              type="text"
              value={forwardSearch}
              onChange={e => setForwardSearch(e.target.value)}
              placeholder="Search chats or groups"
              className="forward-search"
            />
            <div className="forward-target-list">
              {filteredForwardTargets.length === 0 ? (
                <div className="empty-tab" style={{ margin: '12px 0' }}>
                  <div className="empty-icon">🔎</div>
                  <div>No matching chats</div>
                </div>
              ) : filteredForwardTargets.map(target => (
                <button
                  key={target._id}
                  className="forward-target-item"
                  onClick={() => sendForwardedMessage(target)}
                >
                  <div className="user-avatar" style={{ position: 'relative' }}>
                    {target.avatar ? <img src={target.avatar} alt="u" /> : (target.username || target.name || 'U').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="forward-target-info">
                    <div className="user-name">{target.username || target.name || 'Chat'}</div>
                    <div className="user-subtitle">{target.isGroup ? 'Group' : 'Direct message'}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="modal-btn cancel" onClick={() => { setShowForwardModal(false); setForwardingMessage(null); }}>Cancel</button>
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
        const isMe = profileUser._id === localUser._id;
        const PdisplayName = profileUser.displayName || profileUser.username || 'User';
        const Pinitials = PdisplayName.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();

        const followingIds = (profileUser.following || []).map(String);
        const followerIds = (profileUser.followers || []).map(String);
        const pendingIds = (isMe ? (localUser.pendingFollowing || []) : []).map(String);
        const listIds = followModalTab === 'following' ? followingIds : (followModalTab === 'followers' ? followerIds : pendingIds);
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
                  <div style={{ fontWeight: 700, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{PdisplayName}</span>
                    {profileUser.verified && <VerifiedBadge />}
                  </div>
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
                {isMe && (
                  <button
                    className={`follow-tab-btn ${followModalTab === 'pending' ? 'active' : ''}`}
                    onClick={() => setFollowModalTab('pending')}
                  >
                    {pendingIds.length} Pending
                  </button>
                )}
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
                    <div className="empty-icon">{followModalTab === 'following' ? '👣' : (followModalTab === 'pending' ? '⏳' : '👥')}</div>
                    <div>{followModalTab === 'following' ? "You don't follow anyone yet" : (followModalTab === 'pending' ? 'No pending requests' : 'No followers yet')}</div>
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
                      <div style={{ fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>{u.username}</span>
                        {u.verified && <VerifiedBadge />}
                      </div>
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
                      {followModalTab === 'pending' ? (
                        <button
                          className="btn-follow btn-unfollow"
                          style={{ fontSize: '10px', padding: '3px 8px' }}
                          onClick={() => toggleFollow(u._id)}
                        >
                          Cancel Request
                        </button>
                      ) : (
                        <button
                          className={`btn-follow ${isFollowing(u._id) || hasPendingRequest(u._id) ? 'btn-unfollow' : ''}`}
                          style={{ fontSize: '10px', padding: '3px 8px' }}
                          onClick={() => toggleFollow(u._id)}
                        >
                          {isFollowing(u._id) ? 'Unfollow' : (hasPendingRequest(u._id) ? 'Cancel Request' : '+ Follow')}
                        </button>
                      )}
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
            <div className={`modal-content profile-modal ${profileModalMode === 'settings' ? 'settings-modal' : ''}`} onClick={e => e.stopPropagation()}>

              {/* Close button */}
              <button className="profile-close-btn" onClick={() => { setShowProfileModal(false); setProfileEditMode(false); }}>✕</button>

              {profileModalMode === 'profile' && (
                <>
                  {/* Cover banner */}
                  <div className="profile-modal-cover" />

              {/* Avatar */}
              <div className="profile-avatar-wrap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
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
                {isMe && profileUser.avatar && (
                  <button 
                    onClick={removeAvatar}
                    style={{ background: 'transparent', border: '1px solid rgba(255, 59, 48, 0.4)', color: '#ff4d4f', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', transition: 'all 0.2s' }}
                    onMouseOver={e => e.target.style.background = 'rgba(255, 59, 48, 0.1)'}
                    onMouseOut={e => e.target.style.background = 'transparent'}
                  >
                    Remove Photo
                  </button>
                )}
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
                    <div className="profile-display-name" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span>{profileUser.displayName || profileUser.username}</span>
                      {profileUser.verified && <VerifiedBadge />}
                    </div>
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

              {!isMe && (
                <div className="profile-section">
                  <button
                    type="button"
                    className="report-user-btn"
                    onClick={() => openReportModal(profileUser)}
                  >
                    Report account
                  </button>
                </div>
              )}
              </>
              )}

              {isMe && profileModalMode === 'settings' && (
                <div className="account-settings-panel" style={{ marginTop: '20px' }}>
                  <div className="account-settings-title">Account Settings</div>
                  {/* Invisible honeypot input to trap aggressive browser autofill */}
                  <input type="text" name="username" autoComplete="username" style={{ display: 'none' }} />
                  <div className="account-settings-grid">
                    <div className="profile-field">
                      <label className="profile-label">
                        {localUser?.googleId ? 'Current Password (optional for Google accounts)' : 'Current Password'}
                      </label>
                      <input
                        type="password"
                        className="profile-input"
                        value={passwordDraft.currentPassword}
                        onChange={e => setPasswordDraft(d => ({ ...d, currentPassword: e.target.value }))}
                        placeholder={localUser?.googleId ? 'Leave blank to set a password' : 'Current password'}
                      />
                    </div>
                    <div className="profile-field">
                      <label className="profile-label">New Password</label>
                      <input
                        type="password"
                        className="profile-input"
                        value={passwordDraft.newPassword}
                        onChange={e => setPasswordDraft(d => ({ ...d, newPassword: e.target.value }))}
                        placeholder="New password"
                      />
                    </div>
                    <div className="profile-field">
                      <label className="profile-label">Confirm Password</label>
                      <input
                        type="password"
                        className="profile-input"
                        value={passwordDraft.confirmPassword}
                        onChange={e => setPasswordDraft(d => ({ ...d, confirmPassword: e.target.value }))}
                        placeholder="Confirm new password"
                      />
                    </div>
                  </div>
                  <button className="modal-btn submit" onClick={updatePassword} disabled={accountActionBusy} style={{ width: '100%', marginTop: '10px' }}>
                    {accountActionBusy ? 'Updating...' : 'Update Password'}
                  </button>

                  <div className="delete-account-box">
                    <div className="delete-account-title">Password Recovery</div>
                    <div className="delete-account-copy">Send a reset link to your email if you want to change the password outside this page.</div>
                    <button className="modal-btn submit" onClick={sendPasswordResetLink} disabled={accountActionBusy} style={{ width: '100%' }}>
                      {accountActionBusy ? 'Sending...' : 'Send Reset Link'}
                    </button>
                  </div>

                  <div className="delete-account-box">
                    <div className="delete-account-title">Delete Account</div>
                    <div className="delete-account-copy">Enter your current password to permanently delete this account and all of its messages.</div>
                    <input
                      type="password"
                      className="profile-input"
                      value={deletePassword}
                      onChange={e => setDeletePassword(e.target.value)}
                      placeholder="Current password"
                    />
                    <button className="modal-btn cancel delete-account-btn" onClick={deleteAccount} disabled={accountActionBusy}>
                      {accountActionBusy ? 'Deleting...' : 'Delete Account'}
                    </button>
                  </div>
                </div>
              )}

              {profileModalMode === 'profile' && (
                <>
                  {/* Stats */}
                  <div className="profile-stats">
                <div className="profile-stat" onClick={() => { setShowProfileModal(false); setFollowModalTab('following'); setShowFollowModal(true); }}>
                  <div className="profile-stat-num">{(profileUser.following || []).length}</div>
                  <div className="profile-stat-label">Following</div>
                </div>
                {isMe && (
                  <>
                    <div className="profile-stat-divider" />
                    <div className="profile-stat" onClick={() => { setShowProfileModal(false); setFollowModalTab('pending'); setShowFollowModal(true); }}>
                      <div className="profile-stat-num">{(profileUser.pendingFollowing || []).length}</div>
                      <div className="profile-stat-label">Pending</div>
                    </div>
                  </>
                )}
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
                      className={`modal-btn ${(isFollowing(profileUser._id) || hasPendingRequest(profileUser._id)) ? 'cancel' : 'submit'}`} 
                      style={{ flex: 1 }}
                      onClick={() => toggleFollow(profileUser._id)}
                    >
                      {isFollowing(profileUser._id) ? 'Unfollow' : (hasPendingRequest(profileUser._id) ? 'Cancel Request' : 'Follow')}
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
              </>
              )}

              {/* Blocked Users Section */}
              {isMe && profileModalMode === 'settings' && (
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

      {showReportModal && reportTarget && (
        <div className="modal-overlay" onClick={() => setShowReportModal(false)}>
          <div className="modal-content report-modal" onClick={e => e.stopPropagation()}>
            <div className="report-modal-title">Report account</div>
            <div className="report-modal-user">Reporting @{reportTarget.username || 'user'}</div>
            <div className="input-group">
              <select
                className="profile-input"
                value={reportReason}
                onChange={e => setReportReason(e.target.value)}
              >
                <option value="">Select a reason</option>
                <option value="fake_account">Fake account / impersonation</option>
                <option value="spam">Spam / unsolicited messages</option>
                <option value="abuse">Abusive or harmful behavior</option>
                <option value="scam">Scam or suspicious activity</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="input-group">
              <textarea
                className="profile-input profile-textarea"
                rows="4"
                placeholder="Additional details (optional)"
                value={reportDetails}
                onChange={e => setReportDetails(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowReportModal(false)}>Cancel</button>
              <button className="modal-btn submit" onClick={submitReport}>Submit Report</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Group Detail Modal ─────────────────────────────────────────────────── */}
      {showGroupDetailModal && selected?.isGroup && (
        <div className="modal-overlay" onClick={() => setShowGroupDetailModal(false)}>
          <div className="modal-content" style={{ maxWidth: '430px', maxHeight: '78vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <div
                className="user-avatar"
                style={{ width: '54px', height: '54px', borderRadius: '12px', cursor: 'pointer', flexShrink: 0 }}
                onClick={() => selected.avatar && handleAvatarClick(selected.avatar)}
                title="View group icon"
              >
                {selected.avatar ? <img src={selected.avatar} alt="group" style={{ borderRadius: '12px' }} /> : (selected.username || 'G').slice(0, 1).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '18px', fontWeight: 700 }}>{selected.username || 'Group'}</div>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{(selected.members || []).length} members</div>
              </div>
              <button
                onClick={() => setShowGroupDetailModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: '22px', cursor: 'pointer', lineHeight: 1 }}
                title="Close"
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Members
            </div>

            <div style={{ marginBottom: '10px', fontSize: '12px', color: 'var(--muted)' }}>
              Admins: {selectedGroupAdminIds.length > 0
                ? selectedGroupAdminIds.map(id => selectedGroup.admins?.find(a => String(a._id || a) === String(id))?.username || 'User').join(', ')
                : 'Unknown'}
            </div>

            {isSelectedGroupAdmin && (
              <div style={{ marginBottom: '14px', padding: '10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                <button
                  className="btn-follow"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 12px' }}
                  onClick={() => setShowGroupAddPanel(v => !v)}
                >
                  <span style={{ fontSize: '15px', lineHeight: 1 }}>+</span>
                  <span>{showGroupAddPanel ? 'Close Add Members' : 'Add Members'}</span>
                </button>

                {showGroupAddPanel && (
                  <div style={{ marginTop: '10px' }}>
                    {availableUsersToAdd.length === 0 ? (
                      <div style={{ fontSize: '12px', color: 'var(--muted)' }}>No more users available to add.</div>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={groupAddSearch}
                          onChange={e => setGroupAddSearch(e.target.value)}
                          placeholder="Search users..."
                          style={{ width: '100%', borderRadius: '8px', background: 'rgba(0,0,0,0.25)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 10px', marginBottom: '8px' }}
                        />

                        <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.7px' }}>Following</div>
                        <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '6px', marginBottom: '10px' }}>
                          {followedUsersToAdd.length === 0 ? (
                            <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '8px' }}>No followed users found.</div>
                          ) : followedUsersToAdd.map(u => {
                            const isChecked = groupAddMemberIds.includes(String(u._id));
                            return (
                              <label key={u._id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', borderRadius: '6px', cursor: 'pointer', background: isChecked ? 'rgba(110,231,183,0.08)' : 'transparent' }}>
                                <input type="checkbox" checked={isChecked} onChange={() => toggleGroupAddMember(u._id)} />
                                <span style={{ flex: 1, fontSize: '13px' }}>{u.username}</span>
                                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{onlineUsers[u._id] ? 'Online' : 'Offline'}</span>
                              </label>
                            );
                          })}
                        </div>

                        <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.7px' }}>Suggestions</div>
                        <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '6px' }}>
                          {suggestedUsersToAdd.length === 0 ? (
                            <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '8px' }}>No suggested users found.</div>
                          ) : suggestedUsersToAdd.map(u => {
                            const isChecked = groupAddMemberIds.includes(String(u._id));
                            return (
                              <label key={u._id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', borderRadius: '6px', cursor: 'pointer', background: isChecked ? 'rgba(110,231,183,0.08)' : 'transparent' }}>
                                <input type="checkbox" checked={isChecked} onChange={() => toggleGroupAddMember(u._id)} />
                                <span style={{ flex: 1, fontSize: '13px' }}>{u.username}</span>
                                <span style={{ fontSize: '11px', color: suggestionIdSet.has(String(u._id)) ? '#6ee7b7' : 'var(--muted)' }}>
                                  {suggestionIdSet.has(String(u._id)) ? 'Suggested' : 'User'}
                                </span>
                              </label>
                            );
                          })}
                        </div>

                        {groupAddMemberIds.length > 0 && (
                          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--muted)' }}>Selected: {groupAddMemberIds.length}</div>
                        )}

                        <button
                          className="btn-follow"
                          style={{ marginTop: '10px', padding: '7px 14px' }}
                          onClick={addMembersToGroup}
                          disabled={groupAddMemberIds.length === 0}
                        >
                          Add Selected
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(selected.members || []).filter(Boolean).map(member => {
                const memberObj = typeof member === 'string' ? selected.members?.find(m => String(m._id || m) === member) || { _id: member } : member;
                const memberId = String(memberObj?._id || member);
                const memberName = memberObj?.username || 'User';
                const memberAvatar = memberObj?.avatar;
                const isMe = memberId === String(localUser?._id);
                const isMemberAdmin = selectedGroupAdminIds.includes(memberId);
                return (
                  <div
                    key={memberId}
                    className="follow-user-row"
                    style={{ borderRadius: '10px', padding: '8px 10px', background: 'rgba(255,255,255,0.02)', cursor: 'pointer' }}
                    onClick={() => {
                      setShowGroupDetailModal(false);
                      openUserProfile(memberObj || memberId);
                    }}
                  >
                    <div className="user-avatar" style={{ flexShrink: 0 }}>
                      {memberAvatar ? <img src={memberAvatar} alt="u" /> : memberName.slice(0, 1).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {memberName} {isMe ? '(You)' : ''}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        {isMemberAdmin ? 'Admin • ' : ''}{onlineUsers[memberId] ? 'Online' : 'Offline'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {isSelectedGroupAdmin && !isMemberAdmin && (
                        <button
                          className="btn-follow"
                          style={{ padding: '4px 10px', fontSize: '11px', background: 'rgba(96,165,250,0.25)' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            makeGroupAdmin(memberId);
                          }}
                        >
                          Make Admin
                        </button>
                      )}
                      {isSelectedGroupAdmin && !isMemberAdmin && (
                        <button
                          className="btn-follow btn-unfollow"
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeGroupMember(memberId);
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default Chat;
