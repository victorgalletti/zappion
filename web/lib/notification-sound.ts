// SPDX-License-Identifier: AGPL-3.0-only
let context: AudioContext | undefined;

function audioContext() {
  if (!context || context.state === "closed") {
    const Constructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Constructor) context = new Constructor();
  }
  return context;
}

export async function unlockNotificationSound() {
  try {
    const audio = audioContext();
    if (audio?.state === "suspended") await audio.resume();
  } catch {
    /* autoplay blocked */
  }
}

export function playNotificationTone(): boolean {
  try {
    const audio = audioContext();
    if (!audio || audio.state !== "running") return false;
    [660, 880].forEach((frequency, index) => {
      const start = audio.currentTime + index * 0.12;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.035, start + 0.015);
      gain.gain.linearRampToValueAtTime(0, start + 0.1);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start);
      oscillator.stop(start + 0.11);
    });
    return true;
  } catch {
    return false;
  }
}

export async function testNotificationSound() {
  await unlockNotificationSound();
  playNotificationTone();
}
