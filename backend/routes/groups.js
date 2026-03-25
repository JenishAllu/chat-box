const router = require('express').Router();
const Group = require('../models/Group');

// Create a new group
router.post('/', async (req, res) => {
  try {
    const { name, members, admin } = req.body;
    const newGroup = await Group.create({ name, members, admin });
    const populated = await newGroup.populate('members', 'username avatar');
    return res.status(201).json(populated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Get all groups for a user
router.get('/:userId', async (req, res) => {
  try {
    const groups = await Group.find({ members: req.params.userId }).populate('members', 'username avatar');
    return res.json(groups);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Update group avatar
router.put('/:groupId/avatar', async (req, res) => {
  try {
    const { avatar } = req.body;
    const group = await Group.findByIdAndUpdate(req.params.groupId, { avatar }, { new: true })
      .populate('members', 'username avatar');
    return res.json(group);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update group avatar' });
  }
});

module.exports = router;
