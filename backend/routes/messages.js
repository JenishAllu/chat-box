const router = require('express').Router();
const Message = require('../models/Message');
const User = require('../models/User');

// helper for creating a consistent room id between two users
function getRoom(a, b) {
  return [a, b].sort().join('_');
}

// mark all incoming messages in a room as seen
router.post('/seen', async (req, res) => {
  try {
    const { userId, otherId } = req.body;
    const room = getRoom(userId, otherId);
    await Message.updateMany({ room, to: userId, seen: false }, { seen: true });
    return res.sendStatus(200);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to mark messages seen' });
  }
});

// get unread message counts per sender for a given user
router.get('/unread/:userId', async (req, res) => {
  try {
    const unseen = await Message.aggregate([
      {
        $match: { to: req.params.userId, seen: false, $or: [{ isRequest: { $ne: true } }, { requestStatus: 'accepted' }] }
      },
      {
        $group: { _id: '$from', count: { $sum: 1 } }
      }
    ]);
    // convert to { [senderId]: count } format
    const counts = {};
    unseen.forEach(item => {
      counts[item._id] = item.count;
    });
    return res.json(counts);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load unread counts' });
  }
});

// get pending message requests grouped by sender
router.get('/requests/:userId', async (req, res) => {
  try {
    const pending = await Message.aggregate([
      {
        $match: {
          to: req.params.userId,
          isRequest: true,
          requestStatus: 'pending'
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$from',
          latestMessage: { $first: '$message' },
          latestCreatedAt: { $first: '$createdAt' },
          messageCount: { $sum: 1 },
          latestMedia: { $first: '$media' }
        }
      }
    ]);

    const senderIds = pending.map(item => item._id);
    const users = await User.find({ _id: { $in: senderIds } }).select('-password');
    const userMap = new Map(users.map(user => [String(user._id), user]));

    const result = pending.map(item => ({
      from: userMap.get(String(item._id)) || null,
      latestMessage: item.latestMessage,
      latestCreatedAt: item.latestCreatedAt,
      messageCount: item.messageCount,
      latestMedia: item.latestMedia || null
    })).filter(item => item.from);

    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load message requests' });
  }
});

// return all messages for a conversation (sorted by creation time)
router.get('/:userId/:otherId', async (req, res) => {
  try {
    const { isGroup } = req.query;
    let room;
    if (isGroup === 'true') {
      room = req.params.otherId;
    } else {
      room = getRoom(req.params.userId, req.params.otherId);
    }
    const msgs = await Message.find({ room, deletedBy: { $ne: req.params.userId } })
      .sort('createdAt')
      .populate({
        path: 'replyTo',
        select: 'message media from _id',
        populate: { path: 'from', select: 'username displayName avatar' }
      })
      .populate('from', 'username displayName avatar')
      .lean();
    return res.json(msgs);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load messages' });
  }
});

module.exports = router;
