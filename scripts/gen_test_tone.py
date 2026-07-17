"""Generate a short test tone WAV (stdlib only) for manual QA of the player."""
import math
import os
import struct
import wave

OUT = os.path.join(os.path.dirname(__file__), "..", "test_audio", "tone.wav")
os.makedirs(os.path.dirname(OUT), exist_ok=True)

RATE = 22050
DURATION = 40  # seconds
FREQ_A = 440.0
FREQ_B = 660.0

with wave.open(OUT, "w") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    frames = bytearray()
    for i in range(RATE * DURATION):
        t = i / RATE
        # Change tone every 10s so looping/seeking is audible & distinguishable
        freq = FREQ_A if (int(t) // 10) % 2 == 0 else FREQ_B
        sample = int(32767 * 0.3 * math.sin(2 * math.pi * freq * t))
        frames += struct.pack("<h", sample)
    w.writeframes(bytes(frames))

print("wrote", os.path.abspath(OUT))
