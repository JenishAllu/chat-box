const router = require('express').Router();
const Group = require('../models/Group');
const mongoose = require('mongoose');

function populateGroup(query) {
  return query
    .populate('members', 'username avatar')
    .populate('admin', 'username avatar');
}

// Create a new group
router.post('/', async (req, res) => {
  try {
    const { name, members, creatorId } = req.body;
    if (!name || !creatorId) {
      return res.status(400).json({ error: 'name and creatorId are required' });
    }

    const memberSet = new Set((members || []).map(String));
    memberSet.add(String(creatorId));
    const newGroup = await Group.create({
      name,
      members: Array.from(memberSet),
      admin: creatorId
    });
    const populated = await newGroup.populate([
      { path: 'members', select: 'username avatar' },
      { path: 'admin', select: 'username avatar' }
    ]);
    return res.status(201).json(populated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Get all groups for a user
router.get('/:userId', async (req, res) => {
  try {
    const groups = await populateGroup(Group.find({ members: req.params.userId }));
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
    const group = await populateGroup(Group.findByIdAndUpdate(req.params.groupId, { avatar }, { new: true }));
    return res.json(group);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update group avatar' });
  }
});

// Update group name
router.put('/:groupId/name', async (req, res) => {
  try {
    const { name } = req.body;
    const group = await populateGroup(Group.findByIdAndUpdate(req.params.groupId, { name }, { new: true }));
    return res.json(group);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update group name' });
  }
});

// Add members to group (admin only)
const addMembersHandler = async (req, res) => {
  try {
    const { requesterId, memberIds } = req.body;
    if (!requesterId || !Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ error: 'requesterId and memberIds are required' });
    }

    const group = await Group.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (String(group.admin) !== String(requesterId)) {
      return res.status(403).json({ error: 'Only admin can add members' });
    }

    const validMemberIds = memberIds
      .map(id => String(id))
      .filter(id => mongoose.Types.ObjectId.isValid(id));
    if (validMemberIds.length === 0) {
      return res.status(400).json({ error: 'No valid member IDs provided' });
    }

    const updated = await populateGroup(Group.findByIdAndUpdate(
      group._id,
      { $addToSet: { members: { $each: validMemberIds } } },
      { new: true }
    ));
    return res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to add members' });
  }
};

router.put('/:groupId/members/add', addMembersHandler);
router.post('/:groupId/members/add', addMembersHandler);
router.put('/:groupId/members', addMembersHandler);
router.post('/:groupId/members', addMembersHandler);
router.put('/:groupId/add-members', addMembersHandler);
router.post('/:groupId/add-members', addMembersHandler);
router.put('/:groupId/member/add', addMembersHandler);
router.post('/:groupId/member/add', addMembersHandler);

// Remove member from group (admin only)
const removeMembersHandler = async (req, res) => {
  try {
    const { requesterId, memberId } = req.body;
    if (!requesterId || !memberId) {
      return res.status(400).json({ error: 'requesterId and memberId are required' });
    }

    const group = await Group.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (String(group.admin) !== String(requesterId)) {
      return res.status(403).json({ error: 'Only admin can remove members' });
    }
    if (String(memberId) === String(group.admin)) {
      return res.status(400).json({ error: 'Admin cannot be removed. Transfer admin first.' });
    }

    group.members = (group.members || []).filter(id => String(id) !== String(memberId));
    await group.save();

    const updated = await populateGroup(Group.findById(group._id));
    return res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
};

router.put('/:groupId/members/remove', removeMembersHandler);
router.post('/:groupId/members/remove', removeMembersHandler);

// Transfer admin role (admin only)
const transferAdminHandler = async (req, res) => {
  try {
    const { requesterId, newAdminId } = req.body;
    if (!requesterId || !newAdminId) {
      return res.status(400).json({ error: 'requesterId and newAdminId are required' });
    }

    const group = await Group.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (String(group.admin) !== String(requesterId)) {
      return res.status(403).json({ error: 'Only current admin can transfer admin role' });
    }

    const isMember = (group.members || []).some(id => String(id) === String(newAdminId));
    if (!isMember) {
      return res.status(400).json({ error: 'New admin must be a group member' });
    }

    group.admin = newAdminId;
    await group.save();

    const updated = await populateGroup(Group.findById(group._id));
    return res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to transfer admin' });
  }
};

router.put('/:groupId/admin', transferAdminHandler);
router.post('/:groupId/admin', transferAdminHandler);

module.exports = router;
