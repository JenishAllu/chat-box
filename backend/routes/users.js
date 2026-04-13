
const router = require("express").Router();
const User = require("../models/User");

// GET all users (excluding password)
router.get("/", async (req, res) => {
  const users = await User.find().select("-password");
  res.json(users);
});

// GET user suggestions (users not followed, not blocked, not self)
router.get("/:id/suggestions", async (req, res) => {
  try {
    const me = await User.findById(req.params.id).select("-password");
    if (!me) return res.status(404).json({ error: "User not found" });


    const excludeIds = [
      me._id,
      ...(me.following || []),
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

// PUT follow a user (also sends a chat request to them)
router.put('/:id/follow/:targetId', async (req, res) => {
  try {
    const { id, targetId } = req.params;
    if (id === targetId) return res.status(400).json({ error: "Cannot follow yourself" });

    const user = await User.findByIdAndUpdate(
      id,
      { $addToSet: { following: targetId } },
      { new: true }
    ).select('-password');

    // Add to target's followers AND send a chat request
    await User.findByIdAndUpdate(targetId, {
      $addToSet: { followers: id, chatRequests: id },
    });

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
      { $pull: { following: targetId } },
      { new: true }
    ).select('-password');
    await User.findByIdAndUpdate(targetId, { $pull: { followers: id } });
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

    // Remove from chatRequests, add to acceptedChats for both
    const user = await User.findByIdAndUpdate(
      id,
      {
        $pull: { chatRequests: requesterId },
        $addToSet: { acceptedChats: requesterId },
      },
      { new: true }
    ).select('-password');

    await User.findByIdAndUpdate(requesterId, {
      $addToSet: { acceptedChats: id },
    });

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
      $pull: { following: targetId, followers: targetId, acceptedChats: targetId, chatRequests: targetId },
    }, { new: true }).select('-password');
    await User.findByIdAndUpdate(targetId, {
      $pull: { following: id, followers: id, acceptedChats: id, chatRequests: id },
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

