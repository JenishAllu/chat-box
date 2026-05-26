/**
 * Premium Web Audio API Synth Engine for Chat UI
 * Generates pleasant micro-synth sound effects procedurally.
 * Zero asset network footprint, zero loading delays, instant latency response!
 */

const AUDIO_KEYS = {
  ALL: 'sound_enabled_all',
  SEND: 'sound_enabled_send',
  RECEIVE: 'sound_enabled_receive',
  NOTIFICATION: 'sound_enabled_notification',
};

// Check if a sound category is enabled (defaulting to true)
function isSoundEnabled(key) {
  try {
    const all = localStorage.getItem(AUDIO_KEYS.ALL);
    if (all === 'false') return false;
    
    if (key !== AUDIO_KEYS.ALL) {
      const specific = localStorage.getItem(key);
      if (specific === 'false') return false;
    }
    return true;
  } catch {
    return true;
  }
}

// Set sound category preference
export function setSoundPreference(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) {
    console.error('Failed to save sound settings', e);
  }
}

// Get all preferences
export function getSoundPreferences() {
  return {
    all: isSoundEnabled(AUDIO_KEYS.ALL),
    send: isSoundEnabled(AUDIO_KEYS.SEND),
    receive: isSoundEnabled(AUDIO_KEYS.RECEIVE),
    notification: isSoundEnabled(AUDIO_KEYS.NOTIFICATION),
  };
}

let audioCtx = null;

// Initialize or return Audio Context lazily (due to browser autoplay policies)
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// 1. Synthesize a pleasant "swoosh" sound for sent messages
export function playSendSound() {
  if (!isSoundEnabled(AUDIO_KEYS.SEND)) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = 'triangle';
    // Frequency sweeps up rapidly from 150Hz to 600Hz
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.12);
    
    // Gain starts silent, swells briefly, and fades out
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    
    osc.start(now);
    osc.stop(now + 0.2);
  } catch (e) {
    console.error('Audio send playback error:', e);
  }
}

// 2. Synthesize a pleasant pop / plucked drop sound for received messages
export function playReceiveSound() {
  if (!isSoundEnabled(AUDIO_KEYS.RECEIVE)) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = 'sine';
    // Plucked pitch drop: 400Hz drops to 180Hz
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.1);
    
    // Smooth lowpass filter pluck
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(200, now + 0.15);
    
    // Fast pluck gain envelope
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    
    osc.start(now);
    osc.stop(now + 0.18);
  } catch (e) {
    console.error('Audio receive playback error:', e);
  }
}

// 3. Synthesize a bright harmonized chime sound for notifications / requests
export function playNotificationSound() {
  if (!isSoundEnabled(AUDIO_KEYS.NOTIFICATION)) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    // Create dual harmonized tones (a beautiful major third interval: A5 & C#6)
    const frequencies = [880, 1109]; // A5 and C#6
    
    frequencies.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.04); // Stagger them slightly like a chime strum
      
      const duration = 0.35;
      gain.gain.setValueAtTime(0, now + idx * 0.04);
      gain.gain.linearRampToValueAtTime(0.08, now + idx * 0.04 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.04 + duration);
      
      osc.start(now + idx * 0.04);
      osc.stop(now + idx * 0.04 + duration + 0.05);
    });
  } catch (e) {
    console.error('Audio notification playback error:', e);
  }
}
