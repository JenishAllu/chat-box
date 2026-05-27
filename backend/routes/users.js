
const router = require("express").Router();
const User = require("../models/User");
const Message = require("../models/Message");
const Group = require("../models/Group");
const Report = require("../models/Report");
const bcrypt = require("bcryptjs");
const auth = require("../middleware/auth");
const { applyTrustUpdate } = require("../utils/accountTrust");
const { sanitizeUser } = require("../utils/sanitizeUser");

router.use(auth);

function getRoom(a, b) {
  return [a, b].sort().join('_');
}

async function addRequestHistory(targetId, requesterId, status = 'pending') {
  const target = await User.findById(targetId);
  if (!target) return;
  target.requestHistory = target.requestHistory || [];
  target.requestHistory.push({
    from: requesterId,
    status,
    requestedAt: new Date(),
    respondedAt: status === 'pending' ? null : new Date(),
  });
  await target.save();
}

async function resolveLatestPendingHistory(targetId, requesterId, status) {
  const target = await User.findById(targetId);
  if (!target || !Array.isArray(target.requestHistory)) return;

  for (let i = target.requestHistory.length - 1; i >= 0; i -= 1) {
    const entry = target.requestHistory[i];
    if (String(entry.from) === String(requesterId) && entry.status === 'pending') {
      entry.status = status;
      entry.respondedAt = new Date();
      await target.save();
      return;
    }
  }
}

function requireSelf(req, res, targetId) {
  if (String(req.user._id) !== String(targetId)) {
    res.status(403).json({ error: 'You can only access your own account data' });
    return false;
  }
  return true;
}

// GET user by ID
router.get("/:id", async (req, res) => {
  try {
    if (!requireSelf(req, res, req.params.id)) return;
    const user = await User.findById(req.params.id).select("-password -emailOtp -otpExpiry");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Failed to get user" });
  }
});

// GET accepted chats for a user
router.get("/:id/accepted-chats", async (req, res) => {
  try {
    if (!requireSelf(req, res, req.params.id)) return;
    const user = await User.findById(req.params.id).populate('acceptedChats', '-password -emailOtp -otpExpiry');
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user.acceptedChats || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load accepted chats" });
  }
});

// GET chat requests for a user
router.get("/:id/chat-requests", async (req, res) => {
  try {
    if (!requireSelf(req, res, req.params.id)) return;
    const user = await User.findById(req.params.id).populate('chatRequests', '-password -emailOtp -otpExpiry');
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user.chatRequests || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load chat requests" });
  }
});

// GET search users
router.get("/search", async (req, res) => {
  try {
    const query = req.query.q;
    const excludeId = req.query.excludeId;
    if (!query) return res.json([]);
    const regex = new RegExp(query, 'i');
    
    const filter = {
      $or: [{ username: regex }, { displayName: regex }]
    };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    
    const users = await User.find(filter).select("-password -emailOtp -otpExpiry").limit(50);
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

// GET user suggestions (users not followed, not blocked, not self)
router.get("/:id/suggestions", async (req, res) => {
  try {
    if (!requireSelf(req, res, req.params.id)) return;
    const me = await User.findById(req.params.id).select("-password -emailOtp -otpExpiry");
    if (!me) return res.status(404).json({ error: "User not found" });


    const excludeIds = [
      me._id,
      ...(me.following || []),
      ...(me.pendingFollowing || []),
    ].map(String);

    const suggestions = await User.find({
      _id: { $nin: excludeIds },
    }).select("-password -emailOtp -otpExpiry").limit(20);

    res.json(suggestions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get suggestions" });
  }
});

// GET request history for a user
router.get('/:id/request-history', async (req, res) => {
  try {
    if (!requireSelf(req, res, req.params.id)) return;
    const user = await User.findById(req.params.id)
      .populate('requestHistory.from', 'username avatar')
      .select('requestHistory');

    if (!user) return res.status(404).json({ error: 'User not found' });

    const history = (user.requestHistory || [])
      .slice()
      .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));

    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load request history' });
  }
});

// PUT update avatar
router.put('/:id/avatar', async (req, res) => {
  try {
    if (!requireSelf(req, res, req.params.id)) return;
    const { avatar } = req.body;
    await User.findByIdAndUpdate(req.params.id, { avatar });
    const user = await User.findById(req.params.id).select('-password -emailOtp -otpExpiry');
    return res.json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update avatar' });
  }
});

// PUT follow a user (stores as pending until target accepts request)
router.put('/:id/follow/:targetId', async (req, res) => {
  try {
    const { id, targetId } = req.params;
    if (!requireSelf(req, res, id)) return;
    if (id === targetId) return res.status(400).json({ error: "Cannot follow yourself" });

    const target = await User.findById(targetId).select('blocked');
    if (!target) return res.status(404).json({ error: 'User not found' });
    if ((target.blocked || []).map(String).includes(String(id))) {
      return res.status(403).json({ error: 'Cannot send follow request' });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $addToSet: { pendingFollowing: targetId } },
      { new: true }
    ).select('-password -emailOtp -otpExpiry');

    // Send chat request to target; follow relation will be created on acceptance.
    await User.findByIdAndUpdate(targetId, {
      $addToSet: { chatRequests: id },
    });
    await addRequestHistory(targetId, id);

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed' });
  }
});

// PUT unfollow a user
router.put('/:id/unfollow/:targetId', async (req, res) => {
  try {
    const { id, targetId } = req.params;
    if (!requireSelf(req, res, id)) return;
    const user = await User.findByIdAndUpdate(
      id,
      { $pull: { following: targetId, pendingFollowing: targetId } },
      { new: true }
    ).select('-password -emailOtp -otpExpiry');
    await User.findByIdAndUpdate(targetId, { $pull: { followers: id, chatRequests: id } });
    await addRequestHistory(targetId, id, 'unfollowed');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// PUT send a standalone chat request (without following)
router.put('/:id/request-chat/:targetId', async (req, res) => {
  try {
    const { id, targetId } = req.params;
    if (!requireSelf(req, res, id)) return;
    if (id === targetId) return res.status(400).json({ error: "Cannot request yourself" });

    // Check if target has blocked requester
    const target = await User.findById(targetId);
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.blocked && target.blocked.map(String).includes(String(id))) {
      return res.status(403).json({ error: "Cannot send request" });
    }

    // Add request to target's chatRequests
    await User.findByIdAndUpdate(targetId, { $addToSet: { chatRequests: id } });
    await addRequestHistory(targetId, id);
    const user = await User.findById(id).select('-password -emailOtp -otpExpiry');
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send chat request' });
  }
});

// PUT accept a chat request from requesterId
router.put('/:id/accept-chat/:requesterId', async (req, res) => {
  try {
    const { id, requesterId } = req.params;
    if (!requireSelf(req, res, id)) return;

    const targetUpdate = {
      $pull: { chatRequests: requesterId },
      $addToSet: { acceptedChats: requesterId, followers: requesterId },
    };

    // Remove from chatRequests, add to acceptedChats and followers for target
    const user = await User.findByIdAndUpdate(
      id,
      targetUpdate,
      { new: true }
    ).select('-password -emailOtp -otpExpiry');

    const requesterUpdate = {
      $addToSet: { acceptedChats: id, following: id },
      $pull: { pendingFollowing: id },
    };

    await User.findByIdAndUpdate(
      requesterId,
      requesterUpdate
    );
    await Message.updateMany(
      { room: getRoom(id, requesterId), isRequest: true, requestStatus: 'pending' },
      { requestStatus: 'accepted' }
    );
    await resolveLatestPendingHistory(id, requesterId, 'accepted');

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to accept chat request' });
  }
});

// PUT decline a chat request from requesterId
router.put('/:id/decline-chat/:requesterId', async (req, res) => {
  try {
    const { id, requesterId } = req.params;
    if (!requireSelf(req, res, id)) return;

    const user = await User.findByIdAndUpdate(
      id,
      { $pull: { chatRequests: requesterId } },
      { new: true }
    ).select('-password -emailOtp -otpExpiry');
    await User.findByIdAndUpdate(requesterId, { $pull: { pendingFollowing: id } });
    await Message.updateMany(
      { room: getRoom(id, requesterId), isRequest: true, requestStatus: 'pending' },
      { requestStatus: 'declined' }
    );
    await resolveLatestPendingHistory(id, requesterId, 'declined');

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to decline chat request' });
  }
});

// PUT block a user
router.put('/:id/block/:targetId', async (req, res) => {
  try {
    const { id, targetId } = req.params;
    if (!requireSelf(req, res, id)) return;
    const user = await User.findByIdAndUpdate(id, {
      $addToSet: { blocked: targetId },
      $pull: { following: targetId, pendingFollowing: targetId, followers: targetId, acceptedChats: targetId, chatRequests: targetId },
    }, { new: true }).select('-password -emailOtp -otpExpiry');
    await User.findByIdAndUpdate(targetId, {
      $pull: { following: id, pendingFollowing: id, followers: id, acceptedChats: id, chatRequests: id },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// PUT update profile (displayName + bio)
router.put('/:id/profile', async (req, res) => {
  try {
    if (!requireSelf(req, res, req.params.id)) return;
    const { displayName, bio } = req.body;
    const update = {};
    if (displayName !== undefined) update.displayName = displayName;
    if (bio !== undefined) update.bio = bio;
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password -emailOtp -otpExpiry');
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT change account password
router.put('/:id/password', async (req, res) => {
  try {
    if (!requireSelf(req, res, req.params.id)) return;
    const { currentPassword, newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ error: 'newPassword is required' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const hasLocalPassword = Boolean(user.password);

    // If the account already has a local password stored, always require
    // the caller to provide `currentPassword` and validate it. This
    // applies to both regular and OAuth-created accounts once a local
    // password has been set (the OAuth-created password becomes the
    // canonical current password for subsequent update/delete actions).
    if (hasLocalPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'currentPassword is required' });
      }
      const matches = await bcrypt.compare(currentPassword, user.password);
      if (!matches) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// DELETE account and clean related references
router.delete('/:id', async (req, res) => {
  try {
    if (!requireSelf(req, res, req.params.id)) return;
    const { currentPassword } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const hasLocalPassword = Boolean(user.password);
    // Require currentPassword verification only if the account has a
    // local password stored. OAuth-only accounts without a local
    // password can be deleted while authenticated via token.
    if (hasLocalPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'currentPassword is required' });
      }
      const matches = await bcrypt.compare(currentPassword, user.password);
      if (!matches) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
    }

    await Message.deleteMany({ $or: [{ from: req.params.id }, { to: req.params.id }] });

    const groups = await Group.find({ $or: [{ members: req.params.id }, { admins: req.params.id }, { admin: req.params.id }] });
    for (const group of groups) {
      group.members = (group.members || []).filter(memberId => String(memberId) !== String(req.params.id));
      group.admins = (group.admins || []).filter(adminId => String(adminId) !== String(req.params.id));
      if (String(group.admin || '') === String(req.params.id)) {
        group.admin = group.admins[0] || group.members[0] || null;
      }
      if (group.admin && !(group.admins || []).some(adminId => String(adminId) === String(group.admin))) {
        group.admins = [group.admin];
      }
      await group.save();
    }

    await User.updateMany(
      {},
      {
        $pull: {
          following: req.params.id,
          pendingFollowing: req.params.id,
          followers: req.params.id,
          blocked: req.params.id,
          chatRequests: req.params.id,
          acceptedChats: req.params.id,
        }
      }
    );

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// GET list of blocked users (populated)
router.get('/:id/blocked', async (req, res) => {
  try {
    if (!requireSelf(req, res, req.params.id)) return;
    const me = await User.findById(req.params.id).populate('blocked', '-password -emailOtp -otpExpiry');
    if (!me) return res.status(404).json({ error: 'User not found' });
    res.json(me.blocked || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get blocked users' });
  }
});

// PUT unblock a user
router.put('/:id/unblock/:targetId', async (req, res) => {
  try {
    const { id, targetId } = req.params;
    if (!requireSelf(req, res, id)) return;
    const user = await User.findByIdAndUpdate(
      id,
      { $pull: { blocked: targetId } },
      { new: true }
    ).select('-password -emailOtp -otpExpiry');
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

// POST report a user
router.post('/report', async (req, res) => {
  try {
    const reporterId = req.user._id;
    const { targetId, reason, details } = req.body;

    if (!targetId || !reason) {
      return res.status(400).json({ error: 'targetId and reason are required' });
    }

    if (String(reporterId) === String(targetId)) {
      return res.status(400).json({ error: 'You cannot report yourself' });
    }

    const target = await User.findById(targetId);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existing = await Report.findOne({ reporter: reporterId, target: targetId });
    if (existing) {
      return res.status(409).json({ error: 'You already reported this user' });
    }

    target.reports = Number(target.reports || 0) + 1;
    target.warnings = Number(target.warnings || 0) + 1;
    target.reputation = Math.max(0, Number(target.reputation || 100) - 20);
    applyTrustUpdate(target, { reason: 'report' });
    if (target.reports >= 5 || target.reputation <= 40 || target.suspiciousScore >= 80) {
      target.isBlocked = true;
    }
    await target.save();

    const report = await Report.create({
      reporter: reporterId,
      target: targetId,
      reason: String(reason).trim(),
      details: String(details || '').trim(),
      riskSnapshot: {
        suspiciousScore: target.suspiciousScore || 0,
        accountRiskLevel: target.accountRiskLevel || 'low',
      },
    });

    return res.status(201).json({
      message: 'Report submitted',
      report,
      target: sanitizeUser(target),
    });
  } catch (err) {
    console.error(err);
    if (err.code === 11000) {
      return res.status(409).json({ error: 'You already reported this user' });
    }
    return res.status(500).json({ error: 'Failed to submit report' });
  }
});

// POST fetch multiple user profiles by ID
router.post('/profiles', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const mongoose = require('mongoose');
    const limitedIds = ids.slice(0, 100).filter(id => mongoose.Types.ObjectId.isValid(id));
    const users = await User.find({ _id: { $in: limitedIds } }).select('-password -emailOtp -otpExpiry');
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

module.exports = router;

