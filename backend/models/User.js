
const mongoose=require("mongoose");
const userSchema=new mongoose.Schema({
  username:{type:String,unique:true},
  email:{type:String,unique:true},
  password:String,
  avatar:{type:String,default:null},         // profile picture (data URL)
  displayName:{type:String,default:''},       // shown name (editable, different from username)
  bio:{type:String,default:''},               // short bio / status
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  blocked: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  chatRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // incoming chat requests
  acceptedChats: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // users I can chat with
  requestHistory: [{
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'declined', 'followed', 'unfollowed'], default: 'pending' },
    requestedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date, default: null }
  }]
},{timestamps:true});
module.exports=mongoose.model("User",userSchema);
