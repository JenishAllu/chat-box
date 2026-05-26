const { normalizeUsername } = require('./usernameValidator');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function deriveRiskProfile(userLike = {}, context = {}) {
  const username = normalizeUsername(userLike.username);
  const createdAt = userLike.createdAt ? new Date(userLike.createdAt) : null;
  const ageMinutes = createdAt ? (Date.now() - createdAt.getTime()) / 60000 : null;

  let suspiciousScore = Number(userLike.suspiciousScore || 0);
  let reputation = Number(userLike.reputation || 100);
  let warnings = Number(userLike.warnings || 0);

  if (context.reason === 'verification') {
    reputation += 10;
    suspiciousScore -= 10;
  }

  if (context.reason === 'report') {
    reputation -= 20;
    suspiciousScore += 15;
    warnings += 1;
  }

  if (!userLike.verified) {
    suspiciousScore += 8;
  }

  if (ageMinutes !== null && ageMinutes < 10) {
    suspiciousScore += 12;
  } else if (ageMinutes !== null && ageMinutes < 60) {
    suspiciousScore += 5;
  }

  if (/[0-9]{4,}/.test(username)) {
    suspiciousScore += 10;
  }

  if (/(.)\1{3,}/.test(username)) {
    suspiciousScore += 8;
  }

  if (!normalizeUsername(username)) {
    suspiciousScore += 15;
  }

  if ((userLike.reports || 0) >= 3) {
    suspiciousScore += 20;
  }

  if ((userLike.reports || 0) >= 5 || reputation <= 40 || suspiciousScore >= 80) {
    return {
      suspiciousScore: clamp(Math.round(suspiciousScore), 0, 100),
      reputation: clamp(Math.round(reputation), 0, 100),
      warnings,
      accountRiskLevel: 'high',
      isBlocked: true,
    };
  }

  const accountRiskLevel = suspiciousScore >= 50 ? 'medium' : 'low';

  return {
    suspiciousScore: clamp(Math.round(suspiciousScore), 0, 100),
    reputation: clamp(Math.round(reputation), 0, 100),
    warnings,
    accountRiskLevel,
    isBlocked: Boolean(userLike.isBlocked),
  };
}

function applyTrustUpdate(user, context = {}) {
  const profile = deriveRiskProfile(user, context);
  user.suspiciousScore = profile.suspiciousScore;
  user.reputation = profile.reputation;
  user.warnings = profile.warnings;
  user.accountRiskLevel = profile.accountRiskLevel;
  if (profile.isBlocked) {
    user.isBlocked = true;
  }
  return user;
}

module.exports = {
  clamp,
  deriveRiskProfile,
  applyTrustUpdate,
};