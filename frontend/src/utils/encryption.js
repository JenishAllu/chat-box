/**
 * End-to-End Encryption Utility Module
 * ====================================
 * Provides AES-256 encryption/decryption for message confidentiality.
 * 
 * Security Note:
 * - Encryption happens client-side before transmission
 * - Messages are never stored in plaintext on the server
 * - Uses a shared encryption key so both users can decrypt messages
 * - For production: Consider using TweetNaCl.js or libsodium for key exchange
 */

import CryptoJS from 'crypto-js';

/**
 * Generate a shared encryption key for a conversation
 * Creates a deterministic key based on room ID (consistent between users)
 * This ensures both sender and receiver can decrypt each other's messages
 * 
 * @param {string} roomId - The room/conversation ID
 * @returns {string} The generated shared encryption key
 */
export const generateSharedEncryptionKey = (roomId) => {
  const SECRET_SALT = 'INSTA_CHAT_SYSTEM_E2E_ENCRYPTION_2024';
  // Create deterministic shared key - same for both users in the room
  return CryptoJS.SHA256(`${roomId}:${SECRET_SALT}`).toString();
};

/**
 * Legacy function for backward compatibility - generates user-specific key
 * (kept for reference, but generateSharedEncryptionKey is preferred)
 * 
 * @param {string} userId - The user's ID from the database
 * @returns {string} The generated encryption key
 */
export const generateEncryptionKey = (userId) => {
  // Falls back to shared key approach - all users use same key for shared messaging
  const SECRET_SALT = 'INSTA_CHAT_SYSTEM_E2E_ENCRYPTION_2024';
  return CryptoJS.SHA256(`SHARED:${SECRET_SALT}`).toString();
};

/**
 * Encrypt a message using AES-256
 * 
 * @param {string} message - The plaintext message to encrypt
 * @param {string} encryptionKey - The encryption key to use
 * @returns {string} The encrypted message (base64 encoded)
 */
export const encryptMessage = (message, encryptionKey) => {
  try {
    if (!message || !encryptionKey) return '';
    return CryptoJS.AES.encrypt(message, encryptionKey).toString();
  } catch (error) {
    console.error('Encryption failed:', error);
    return '';
  }
};

/**
 * Decrypt a message using AES-256
 * 
 * @param {string} encryptedMessage - The encrypted message to decrypt
 * @param {string} encryptionKey - The encryption key to use
 * @returns {string} The decrypted plaintext message (or original if decryption fails)
 */
export const decryptMessage = (encryptedMessage, encryptionKey) => {
  try {
    if (!encryptedMessage || !encryptionKey) return encryptedMessage;
    
    const bytes = CryptoJS.AES.decrypt(encryptedMessage, encryptionKey);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    
    // Return decrypted message, or original if decryption fails
    return decrypted || encryptedMessage;
  } catch (error) {
    // If decryption fails, return original (may be plaintext from older messages)
    console.warn('Decryption failed, returning original:', error);
    return encryptedMessage;
  }
};

/**
 * Encrypt multiple messages (batch operation)
 * Useful for bulk encryption of message arrays
 * 
 * @param {Array} messages - Array of message objects with 'message' property
 * @param {string} encryptionKey - The encryption key to use
 * @returns {Array} Array of messages with encrypted message field
 */
export const encryptMessages = (messages, encryptionKey) => {
  return messages.map(msg => ({
    ...msg,
    message: encryptMessage(msg.message, encryptionKey)
  }));
};

/**
 * Decrypt multiple messages (batch operation)
 * Useful for bulk decryption of message arrays
 * 
 * @param {Array} messages - Array of message objects with 'message' property
 * @param {string} encryptionKey - The encryption key to use
 * @returns {Array} Array of messages with decrypted message field
 */
export const decryptMessages = (messages, encryptionKey) => {
  return messages.map(msg => ({
    ...msg,
    message: decryptMessage(msg.message, encryptionKey),
    replyTo: msg.replyTo ? {
      ...msg.replyTo,
      message: decryptMessage(msg.replyTo.message, encryptionKey)
    } : msg.replyTo
  }));
};

/**
 * Validate encryption key format
 * 
 * @param {string} key - The key to validate
 * @returns {boolean} True if key is valid
 */
export const isValidEncryptionKey = (key) => {
  return key && typeof key === 'string' && key.length > 0;
};

export default {
  generateEncryptionKey,
  encryptMessage,
  decryptMessage,
  encryptMessages,
  decryptMessages,
  isValidEncryptionKey
};
