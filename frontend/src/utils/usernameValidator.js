const RESERVED_USERNAME_PARTS = ['admin', 'support', 'official', 'owner', 'instagram', 'whatsapp', 'aws', 'render'];

export function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

export function validateUsername(username) {
  const normalized = normalizeUsername(username);

  if (normalized.length < 3) {
    return { valid: false, message: 'Username must be at least 3 characters long' };
  }

  if (normalized.length > 25) {
    return { valid: false, message: 'Username must be at most 25 characters long' };
  }

  if (!/^[a-z0-9._]+$/.test(normalized)) {
    return { valid: false, message: 'Username can only contain letters, numbers, underscore, and dot' };
  }

  if (RESERVED_USERNAME_PARTS.some(part => normalized.includes(part))) {
    return { valid: false, message: 'Username contains a reserved or impersonation word' };
  }

  if (normalized.startsWith('.') || normalized.endsWith('.') || normalized.includes('..')) {
    return { valid: false, message: 'Username format is invalid' };
  }

  return { valid: true, username: normalized };
}

export default validateUsername;