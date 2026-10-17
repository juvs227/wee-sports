import csv
from collections import defaultdict
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.cm as cm
import numpy as np

# Load CSV
sessions = defaultdict(lambda: {'label': None, 'samples': []})
with open('swing_data.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        sid = row['session_id']
        sessions[sid]['label'] = row['label']
        sessions[sid]['samples'].append((int(row['t_offset_ms']), float(row['magnitude'])))

swings = {sid: d for sid, d in sessions.items() if d['label'] == 'swing'}
not_swings = {sid: d for sid, d in sessions.items() if d['label'] == 'not_swing'}
print(f"Sessions: {len(swings)} swings, {len(not_swings)} not-swings")

colors = cm.plasma(np.linspace(0.1, 0.9, max(len(swings), 1)))
swing_peaks = [(sid, max(s[1] for s in d['samples'])) for sid, d in swings.items()]
not_swing_peaks = [(sid, max(s[1] for s in d['samples'])) for sid, d in not_swings.items()]

# ── Figure 1: Swing time-series overlaid ────────────────────────────────────
fig1, ax1 = plt.subplots(figsize=(12, 5))
for i, (sid, d) in enumerate(swings.items()):
    ts = [s[0] for s in d['samples']]
    mags = [s[1] for s in d['samples']]
    ax1.plot(ts, mags, color=colors[i], alpha=0.8, linewidth=1.5, label=f'swing {i+1}')
ax1.set_title('Swing magnitude over time (all swings overlaid)', fontsize=13)
ax1.set_xlabel('Time offset (ms)')
ax1.set_ylabel('Acceleration magnitude (m/s²)')
ax1.legend(fontsize=8, loc='upper right')
ax1.grid(True, alpha=0.3)
fig1.tight_layout()
fig1.savefig('swing_timeseries.png', dpi=150)
print("Saved: swing_timeseries.png")

# ── Figure 2: Peak magnitude per session ────────────────────────────────────
fig2, ax2 = plt.subplots(figsize=(12, 5))
for i, (sid, peak) in enumerate(swing_peaks):
    ax2.scatter(i, peak, color='#f90', s=80, zorder=3, label='swing' if i == 0 else '')
offset = len(swing_peaks) + 2
for i, (sid, peak) in enumerate(not_swing_peaks):
    ax2.scatter(offset + i, peak, color='#4af', s=80, zorder=3, label='not swing' if i == 0 else '')

if swing_peaks and not_swing_peaks:
    max_not_swing = max(p for _, p in not_swing_peaks)
    min_swing = min(p for _, p in swing_peaks)
    if min_swing > max_not_swing:
        threshold = (max_not_swing + min_swing) / 2
        ax2.axhline(threshold, color='#f66', linestyle='--', linewidth=1.5,
                    label=f'candidate threshold: {threshold:.1f} m/s²')
        print(f"\nClean separation!")
        print(f"  Max not-swing peak:  {max_not_swing:.2f} m/s²")
        print(f"  Min swing peak:      {min_swing:.2f} m/s²")
        print(f"  Candidate threshold: {threshold:.2f} m/s²")
    else:
        print(f"\nOverlap of {max_not_swing - min_swing:.2f} m/s² — no clean threshold yet")
        print(f"  Max not-swing peak: {max_not_swing:.2f}")
        print(f"  Min swing peak:     {min_swing:.2f}")

ax2.set_title('Peak magnitude per session (swings vs not-swings)', fontsize=13)
ax2.set_ylabel('Peak acceleration magnitude (m/s²)')
ax2.set_xticks([])
ax2.legend(fontsize=10)
ax2.grid(True, alpha=0.3, axis='y')
fig2.tight_layout()
fig2.savefig('swing_peaks.png', dpi=150)
print("Saved: swing_peaks.png")
