
const router = require("express").Router();
const User = require("../models/User");
const Message = require("../models/Message");
const Group = require("../models/Group");
const bcrypt = require("bcryptjs");

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

// GET user by ID
router.get("/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Failed to get user" });
  }
});

// GET accepted chats for a user
router.get("/:id/accepted-chats", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate('acceptedChats', '-password');
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
    const user = await User.findById(req.params.id).populate('chatRequests', '-password');
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
    
    const users = await User.find(filter).select("-password").limit(50);
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

// GET user suggestions (users not followed, not blocked, not self)
router.get("/:id/suggestions", async (req, res) => {
  try {
    const me = await User.findById(req.params.id).select("-password");
    if (!me) return res.status(404).json({ error: "User not found" });


    const excludeIds = [
      me._id,
      ...(me.following || []),
      ...(me.pendingFollowing || []),
    ].map(String);

    const suggestions = await User.find({
      _id: { $nin: excludeIds },
    }).select("-password").limit(20);

    res.json(suggestions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get suggestions" });
  }
});

// GET request history for a user
router.get('/:id/request-history', async (req, res) => {
  try {
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
    const { avatar } = req.body;
    await User.findByIdAndUpdate(req.params.id, { avatar });
    const user = await User.findById(req.params.id).select('-password');
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
    ).select('-password');

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
    const user = await User.findByIdAndUpdate(
      id,
      { $pull: { following: targetId, pendingFollowing: targetId } },
      { new: true }
    ).select('-password');
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
    const user = await User.findById(id).select('-password');
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

    const targetUpdate = {
      $pull: { chatRequests: requesterId },
      $addToSet: { acceptedChats: requesterId, followers: requesterId },
    };

    // Remove from chatRequests, add to acceptedChats and followers for target
    const user = await User.findByIdAndUpdate(
      id,
      targetUpdate,
      { new: true }
    ).select('-password');

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

    const user = await User.findByIdAndUpdate(
      id,
      { $pull: { chatRequests: requesterId } },
      { new: true }
    ).select('-password');
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
    const user = await User.findByIdAndUpdate(id, {
      $addToSet: { blocked: targetId },
      $pull: { following: targetId, pendingFollowing: targetId, followers: targetId, acceptedChats: targetId, chatRequests: targetId },
    }, { new: true }).select('-password');
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
    const { displayName, bio } = req.body;
    const update = {};
    if (displayName !== undefined) update.displayName = displayName;
    if (bio !== undefined) update.bio = bio;
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT change account password
router.put('/:id/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) {
      return res.status(400).json({ error: 'Current password is incorrect' });
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
    const { currentPassword } = req.body;
    if (!currentPassword) {
      return res.status(400).json({ error: 'currentPassword is required' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) {
      return res.status(400).json({ error: 'Current password is incorrect' });
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
    const me = await User.findById(req.params.id).populate('blocked', '-password');
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
    const user = await User.findByIdAndUpdate(
      id,
      { $pull: { blocked: targetId } },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

module.exports = router;

