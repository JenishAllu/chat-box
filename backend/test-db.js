const mongoose = require('mongoose');
const Message = require('./models/Message');
const User = require('./models/User');

require('dotenv').config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("Connected to DB.");
    const msgs = await Message.find({});
    console.log("Total messages:", msgs.length);
    if(msgs.length > 0) {
      console.log("Sample message:", msgs[msgs.length - 1]);
    }
    const users = await User.find({});
    console.log("Total users:", users.length);
    process.exit();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
