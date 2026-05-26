
const mongoose=require("mongoose");
const userSchema=new mongoose.Schema({
  username: {
    type: String,
    unique: true,
    required: true,
    lowercase: true,
    trim: true,
  },

  email: {
    type: String,
    unique: true,
    required: true,
    lowercase: true,
    trim: true,
  },

  googleId: {
    type: String,
    default: null,
    index: true,
    sparse: true,
  },

  password: {
    type: String,
    required: true,
  },

  realName: {
    type: String,
    required: true,
    trim: true,
  },

  verified: {
    type: Boolean,
    default: false,
  },

  phone: {
    type: String,
    default: null,
    trim: true,
  },

  phoneVerified: {
    type: Boolean,
    default: false,
  },

  emailOtp: {
    type: String,
    default: null,
  },

  otpExpiry: {
    type: Date,
    default: null,
  },

  passwordResetTokenHash: {
    type: String,
    default: null,
    index: true,
    sparse: true,
  },

  passwordResetTokenExpiry: {
    type: Date,
    default: null,
  },

  passwordResetOtpHash: {
    type: String,
    default: null,
    index: true,
    sparse: true,
  },

  passwordResetOtpExpiry: {
    type: Date,
    default: null,
  },

  reports: {
    type: Number,
    default: 0,
  },

  reputation: {
    type: Number,
    default: 100,
  },

  warnings: {
    type: Number,
    default: 0,
  },

  suspiciousScore: {
    type: Number,
    default: 0,
  },

  accountRiskLevel: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'low',
  },

  isBlocked: {
    type: Boolean,
    default: false,
  },
  avatar:{type:String,default:null},         // profile picture (data URL)
  displayName:{type:String,default:''},       // shown name (editable, different from username)
  bio:{type:String,default:''},               // short bio / status
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  pendingFollowing: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
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
