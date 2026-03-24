
const router=require("express").Router();
const User=require("../models/User");

router.get("/",async(req,res)=>{
  const users=await User.find().select("-password");
  res.json(users);
});

// update avatar (expects { avatar: <dataUrl> })
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

module.exports=router;
